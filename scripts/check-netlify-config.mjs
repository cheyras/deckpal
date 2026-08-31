import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8')
const rootPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

assert.match(config, /publish\s*=\s*["']apps\/web\/dist["']/)
assert.match(config, /directory\s*=\s*["']netlify\/functions["']/)
assert.match(config, /node scripts\/prepare-netlify-data\.mjs/)
assert.match(
  config,
  /included_files\s*=\s*\[[^\]]*["']netlify\/functions\/data\/\*\*["'][^\]]*\]/,
  'deck format JSON must be copied into the function archive',
)
assert.match(config, /NODE_VERSION\s*=\s*["']20["']/)
assert.match(
  config,
  /PNPM_VERSION\s*=\s*["']10\.30\.3["']/,
  'Node 20 builds must use the pinned pnpm 10 release; pnpm 11 requires Node 22',
)
assert.equal(
  typeof rootPackage.dependencies?.express,
  'string',
  'external Netlify module express must be a root runtime dependency',
)
assert.equal(
  typeof rootPackage.dependencies?.sharp,
  'string',
  'external Netlify module sharp must be a root runtime dependency',
)
for (const packageName of ['helmet', 'pdfkit']) {
  assert.equal(
    typeof rootPackage.dependencies?.[packageName],
    'string',
    `Netlify API runtime package ${packageName} must be a root dependency`,
  )
}

const apiRewrite = config.indexOf('from = "/api/*"')
const imageRewrite = config.indexOf('from = "/deckpal/images/*"')
const spaRewrite = config.indexOf('from = "/*"')
assert.ok(apiRewrite >= 0, 'API rewrite is required')
assert.ok(
  imageRewrite >= 0,
  'card-art rewrite is required, or every <img> resolves to index.html',
)
assert.ok(spaRewrite >= 0, 'SPA fallback is required')
assert.ok(apiRewrite < spaRewrite, 'API rewrite must appear before the SPA fallback')
assert.ok(
  imageRewrite < spaRewrite,
  'card-art rewrite must appear before the SPA fallback',
)

const forbiddenAssignments = [
  /^\s*DATABASE_URL\s*=/m,
  /^\s*SUPABASE_JWT_SECRET\s*=/m,
  /^\s*(?:ANTHROPIC|AI_GATEWAY|DECKE_VERCEL_AI_GATEWAY)_API_KEY\s*=/m,
]
for (const pattern of forbiddenAssignments) {
  assert.doesNotMatch(config, pattern, 'secrets must not be committed in netlify.toml')
}

console.log('Netlify configuration contract is valid')
