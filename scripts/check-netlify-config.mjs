import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8')

assert.match(config, /publish\s*=\s*["']apps\/web\/dist["']/)
assert.match(config, /directory\s*=\s*["']netlify\/functions["']/)

const apiRewrite = config.indexOf('from = "/api/*"')
const spaRewrite = config.indexOf('from = "/*"')
assert.ok(apiRewrite >= 0, 'API rewrite is required')
assert.ok(spaRewrite >= 0, 'SPA fallback is required')
assert.ok(apiRewrite < spaRewrite, 'API rewrite must appear before the SPA fallback')

const forbiddenAssignments = [
  /^\s*DATABASE_URL\s*=/m,
  /^\s*SUPABASE_JWT_SECRET\s*=/m,
  /^\s*(?:ANTHROPIC|AI_GATEWAY|DECKE_VERCEL_AI_GATEWAY)_API_KEY\s*=/m,
]
for (const pattern of forbiddenAssignments) {
  assert.doesNotMatch(config, pattern, 'secrets must not be committed in netlify.toml')
}

console.log('Netlify configuration contract is valid')
