/**
 * Can every serverless function in `api/` actually be LOADED?
 *
 * This exists because `/api/chat` shipped to production and returned
 * FUNCTION_INVOCATION_FAILED on its first request. `@ai-sdk/gateway` was imported
 * by `api/chat.mjs` but never declared in `package.json` — it resolved locally
 * only as a hoisted transitive of `ai`, and pnpm links just the DECLARED
 * dependencies at the root, so the bare specifier could not resolve.
 *
 * Nothing caught it. Every test exercised the PIECES — the prompt builder, the
 * tools, the model routing, even the live gateway round trip — and none of them
 * ever imported the entrypoint that Vercel actually runs. A module-resolution
 * failure is invisible to a test suite that never loads the module.
 *
 * So this asserts the only thing those tests could not: that each function file
 * imports cleanly, from the repository root, with the same resolution rules the
 * deployment uses, and exports a handler.
 *
 * IT NEEDS THE SAME BUILDS THE DEPLOYMENT DOES. The functions import from
 * `apps/api/dist` and `apps/mcp/dist`, so whatever runs this must build both
 * first — `vercel.json`'s `buildCommand` is the list to keep it honest against.
 * On its first CI run this check failed on `mcp.mjs` for exactly that reason,
 * which is the guard working: locally the directory happened to exist from an
 * earlier build, and a check that only passes because of leftover state is worth
 * nothing.
 */
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const API = path.join(ROOT, 'api')

const files = readdirSync(API).filter((f) => f.endsWith('.mjs')).sort()
if (!files.length) {
  console.error('check-functions: no functions found in api/ — that cannot be right')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  const full = path.join(API, file)
  try {
    const mod = await import(pathToFileURL(full).href)
    // Vercel needs a default export to invoke. A module that loads but exports
    // nothing callable fails at request time exactly like one that cannot load.
    if (typeof mod.default !== 'function') {
      console.error(`  FAIL ${file} — loaded but default export is ${typeof mod.default}, not a function`)
      failed++
      continue
    }
    // SIGNATURE, not just existence. The runtime invokes these with Node's
    // `(req, res)`. A handler written web-style as `(request) => Response` loads
    // perfectly, exports a function, passes every check that only asks "does it
    // import" — and then throws `request.headers.get is not a function` on its
    // first real request. That shipped, and cost three deploys to find, because
    // the crash lands before the body is read and therefore looks like a module
    // that never loaded. Express apps are `(req, res, next)`, so 2 is the floor.
    if (mod.default.length < 2) {
      console.error(
        `  FAIL ${file} — handler takes ${mod.default.length} argument(s); the runtime calls it with (req, res).` +
          ` A web-style (request) => Response handler will throw on request.headers.get.`,
      )
      failed++
      continue
    }
    console.log(`  ok   ${file}`)
  } catch (err) {
    console.error(`  FAIL ${file} — ${err.code ?? 'error'}: ${String(err.message).split('\n')[0]}`)
    failed++
  }
}

if (failed) {
  console.error(`\ncheck-functions: ${failed} of ${files.length} function(s) cannot be served.`)
  console.error('If this is ERR_MODULE_NOT_FOUND, the package is imported but not declared')
  console.error('in package.json — it works locally via hoisting and fails in deployment.')
  process.exit(1)
}
console.log(`check-functions: ${files.length} function(s) load and export a handler. OK`)
// The API modules open a database pool at import time, which keeps the loop
// alive; the check is complete by here, so leave deliberately.
process.exit(0)
