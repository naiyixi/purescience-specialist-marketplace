# PureScience Specialist Marketplace (official)

The official Specialist marketplace for PureScience, consumed by the in-app
Specialist Marketplace (Settings → Specialists → 市场). Metadata lives in this
repository on the `published` branch; package artifacts are uploaded as GitHub
Release assets (see `github_release` in each release document).

## Layout

```
marketplace.json          # signed root: marketplace identity + specialist index
marketplace.json.sig      # ed25519 signature over marketplace.json (exact bytes)
releases/<id>-<version>.json   # signed-in-spirit release document (sha256-checked)
specials/<id>/            # source tree of one specialist package
  manifest.json           # { schema_version:1, id, version, exported_with_app_version }
  specialist.json         # payload: name/displayName/description/systemPrompt/skillIds/connectorIds
  skills/<skill-id>/SKILL.md
scripts/
  build-release.mjs       # pack → hash → release doc → root update → sign (one command)
  marketplace-signing.pem # PRIVATE — never commit (gitignored)
  marketplace-public.pem  # public key (DER SPKI PEM)
dist/                     # build output (gitignored)
```

## Publishing a release

```bash
# 1. build + sign (writes releases/, updates marketplace.json + .sig)
node scripts/build-release.mjs <specialist-id> <version> --tag <github-release-tag>

# 2. upload the artifact zip to a GitHub release
gh release create <tag> -R naiyixi/purescience-specialist-marketplace dist/<id>-<version>.zip

# 3. push metadata to the published branch (what the app polls)
git add marketplace.json marketplace.json.sig releases/
git commit -m "release <id> <version>"
git push origin published
```

The app polls `https://raw.githubusercontent.com/naiyixi/purescience-specialist-marketplace/published/marketplace.json`
(+ `.sig`) and verifies the ed25519 signature against the trusted key embedded in
`src/main/specialist/marketplace/official-source.ts` before showing anything.

## Signing key

- Key id: `purescience-marketplace-2026-08`
- The trusted public key must be added to PureScience's `official-source.ts`
  `trustedKeys` map (same key_id → DER-SPKI-base64 public key).
- Rotate by publishing a new key id and updating the app's trustedKeys.

## Protocol

Metadata documents follow the marketplace protocol implemented in
PureScience's `src/main/specialist/marketplace/protocol.ts`
(zod schemas + ed25519 verification + sha256 digests). Keep the two in sync.
