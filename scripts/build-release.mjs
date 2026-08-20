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
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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
const skillsDir = join(src, 'skills')

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

const packageFiles = walk(src)
  .filter((f) => relative(src, f) !== '')
  .map((f) => ({ abs: f, rel: relative(src, f) }))
  .filter((f) => !f.rel.includes('/.'))
const uncompressedBytes = packageFiles.reduce((sum, f) => sum + statSync(f.abs).size, 0)
const fileCount = packageFiles.length

// ---- skills metadata ----
const skills = []
if (existsSync(skillsDir)) {
  for (const skillId of readdirSync(skillsDir).sort()) {
    const skillDir = join(skillsDir, skillId)
    if (!statSync(skillDir).isDirectory()) continue
    const files = walk(skillDir)
    const digest = createHash('sha256')
    for (const f of files) digest.update(readFileSync(f))
    const skillDoc = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    const nameMatch = /^name:\s*(.+)$/m.exec(skillDoc)
    const descMatch = /^description:\s*(.+)$/m.exec(skillDoc)
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
}

// ---- pack zip via system zip (deterministic-ish; -X strips attrs) ----
mkdirSync(join(ROOT, 'dist'), { recursive: true })
const zipName = `${specialistId}-${version}.zip`
const zipAbs = join(ROOT, 'dist', zipName)
execFileSync('zip', ['-q', '-r', '-X', zipAbs, ...packageFiles.map((f) => f.rel)], { cwd: src })
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
mkdirSync(join(ROOT, 'releases'), { recursive: true })
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
