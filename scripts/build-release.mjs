#!/usr/bin/env node
// Build a Specialist release: pack specials/<id>/ → dist zip → compute digests →
// write releases/<id>-<version>.json → update marketplace.json root → sign it.
//
// Usage:
//   node scripts/build-release.mjs <specialist-id> <version> \
//     [--tag <github-release-tag>] [--license <SPDX>] [--repo <url>] [--commit <sha>]
//
// The artifact zip must be uploaded to a GitHub release (the tag/asset_name below), then
// the signed marketplace.json + marketplace.json.sig are pushed to the `published` branch.

import { execFileSync } from 'node:child_process'
import { createHash, sign } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SIGNING_KEY = join(ROOT, 'scripts', 'marketplace-signing.pem')
const PUBLISHER = { id: 'naiyixi', name: 'Naiyixi' }
const MARKETPLACE_ID = 'purescience-official'

const [specialistId, version] = process.argv.slice(2)
if (!specialistId || !version) {
  console.error('usage: build-release.mjs <specialist-id> <version> [--tag T] [--license L] [--repo U] [--commit S]')
  process.exit(1)
}
if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(specialistId)) {
  console.error(`invalid specialist id: ${specialistId}`)
  process.exit(1)
}

const args = process.argv.slice(4)
const opt = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const tag = opt('--tag', `v${version}`)
const license = opt('--license', 'MIT')
const repo = opt('--repo', `https://github.com/naiyixi/purescience-specialist-marketplace`)
const commit = opt('--commit', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim())

const src = join(ROOT, 'specials', specialistId)
const specialRoot = readFileSync(join(src, 'specialist.json'), 'utf8')
const manifestDoc = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'))
const specialist = JSON.parse(specialRoot)

// ---- walk files (sorted for determinism) ----
const walk = (dir) => {
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

// ---- shared-skill resolution ----
// Skill IDs declared in specialist.json skillIds resolve to the specialist's own
// skills/<id>/ directory first, then to the shared library specials/_shared/<id>/.
// Shared skills are authored once under _shared/ and inlined into each release zip,
// so the same content digest ships everywhere and no specialist duplicates files.
const SHARED_ROOT = join(ROOT, 'specials', '_shared')
const localSkillsDir = join(src, 'skills')
const resolveSkillDir = (id) => {
  const local = join(localSkillsDir, id)
  if (existsSync(local) && statSync(local).isDirectory()) return local
  const shared = join(SHARED_ROOT, id)
  if (existsSync(shared) && statSync(shared).isDirectory()) return shared
  return null
}
const declaredSkillIds = Array.isArray(specialist.skillIds) ? [...specialist.skillIds] : []
const localSkillDirs = existsSync(localSkillsDir)
  ? readdirSync(localSkillsDir).filter((d) => statSync(join(localSkillsDir, d)).isDirectory())
  : []
// Drift guard: a local bundled skill that is not declared is a package error.
for (const id of localSkillDirs) {
  if (!declaredSkillIds.includes(id)) {
    console.error(`error: local skill dir skills/${id} exists but is not declared in specialist.json skillIds`)
    process.exit(1)
  }
}

const skills = []
const skillEntries = [] // { abs, rel } with rel rooted at the zip root
for (const skillId of declaredSkillIds) {
  const dir = resolveSkillDir(skillId)
  if (!dir) {
    console.error(
      `error: declared skill "${skillId}" not found under skills/ nor specials/_shared/`
    )
    process.exit(1)
  }
  const files = walk(dir)
  for (const f of files) skillEntries.push({ abs: f, rel: `skills/${skillId}/${relative(dir, f)}` })
  const skillDoc = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const nameMatch = /^name:\s*(.+)$/m.exec(skillDoc)
  const descMatch = /^description:\s*(.+)$/m.exec(skillDoc)
  const digest = createHash('sha256')
  for (const f of files) digest.update(readFileSync(f))
  skills.push({
    id: skillId,
    name: skillId,
    display_name: nameMatch?.[1]?.trim() ?? skillId,
    description: descMatch?.[1]?.trim() ?? '',
    path: `skills/${skillId}`,
    content_digest: digest.digest('hex'),
    file_count: files.length,
    uncompressed_bytes: files.reduce((sum, f) => sum + statSync(f).size, 0)
  })
}

// Specialist-owned files (everything except its skills/ tree, which is now
// represented exclusively by the resolved skill entries above).
const srcEntries = walk(src)
  .filter((f) => {
    const rel = relative(src, f)
    return rel !== '' && !rel.includes('/.') && !rel.startsWith(`skills${'/'.charAt(0)}`)
  })
  .map((f) => ({ abs: f, rel: relative(src, f) }))
const packageFiles = [...srcEntries, ...skillEntries]
const uncompressedBytes = packageFiles.reduce((sum, f) => sum + statSync(f.abs).size, 0)
const fileCount = packageFiles.length

// ---- pack zip via system zip (deterministic-ish; -X strips attrs) ----
// Output goes to releases/ (NOT dist/, which is gitignored): the zip must be committed to the
// published branch so jsDelivr can serve it as the artifact CDN for CN users.
mkdirSync(join(ROOT, 'releases'), { recursive: true })
const zipName = `${specialistId}-${version}.zip`
const zipAbs = join(ROOT, 'releases', zipName)
// Stage the resolved file set (specialist files + inlined shared skills) into a
// temp tree so zip entries always carry the canonical skills/<id>/ prefix.
const stage = mkdtempSync(join(tmpdir(), 'ps-release-'))
try {
  for (const f of packageFiles) {
    const dest = join(stage, f.rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(f.abs, dest)
  }
  execFileSync('zip', ['-q', '-r', '-X', zipAbs, '.'], { cwd: stage })
} finally {
  rmSync(stage, { recursive: true, force: true })
}
const zipBytes = readFileSync(zipAbs)
const artifactSha256 = createHash('sha256').update(zipBytes).digest('hex')

const release = {
  schema_version: 1,
  specialist_id: specialistId,
  version,
  source: { repository: repo, commit, license },
  artifact: {
    path: `releases/${zipName}`,
    github_release: { tag, asset_name: zipName },
    sha256: artifactSha256,
    compressed_bytes: zipBytes.length,
    uncompressed_bytes: uncompressedBytes,
    file_count: fileCount
  },
  defaults: { skill_ids: specialist.skillIds ?? [], connector_ids: specialist.connectorIds ?? [] },
  skills,
  connectors: []
}
writeFileSync(join(ROOT, 'releases', `${specialistId}-${version}.json`), JSON.stringify(release, null, 2) + '\n')

// ---- update marketplace.json root ----
const rootPath = join(ROOT, 'marketplace.json')
const root = JSON.parse(readFileSync(rootPath, 'utf8'))
const releasePath = `releases/${specialistId}-${version}.json`
const entry = {
  id: specialistId,
  display_name: manifestDoc.displayName ?? specialist.displayName ?? specialistId,
  summary: specialist.description ?? '',
  publisher: PUBLISHER,
  latest: { version, release: { path: releasePath, sha256: artifactSha256 } }
}
const idx = root.specialists.findIndex((s) => s.id === specialistId)
if (idx >= 0) root.specialists[idx] = entry
else root.specialists.push(entry)
root.revision = `${new Date().toISOString().slice(0, 10)}-${root.specialists.length}`
writeFileSync(rootPath, JSON.stringify(root, null, 2) + '\n')

// ---- sign the root ----
signRoot(rootPath)

console.log(`==> packed  ${zipAbs} (${zipBytes.length} bytes, sha256 ${artifactSha256.slice(0, 16)}…)`)
console.log(`    release ${specialistId}-${version}.json (${skills.length} skills, ${fileCount} files)`)
console.log(`    root    marketplace.json (${root.specialists.length} specialists) + marketplace.json.sig`)
console.log(`    upload  ${zipName} to GitHub release "${tag}", then push marketplace.json(.sig) to published`)

function signRoot(filePath) {
  const bytes = readFileSync(filePath)
  const key = readFileSync(SIGNING_KEY, 'utf8')
  const signature = sign(null, bytes, key).toString('base64')
  const pub = readFileSync(join(ROOT, 'scripts', 'marketplace-public.pem'), 'utf8')
  const pubDer = pub.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const sig = {
    schema_version: 1,
    algorithm: 'ed25519',
    key_id: 'purescience-marketplace-2026-08',
    public_key: pubDer,
    signature
  }
  writeFileSync(`${filePath}.sig`, JSON.stringify(sig, null, 2) + '\n')
}

function existsSync(p) {
  try { statSync(p); return true } catch { return false }
}
