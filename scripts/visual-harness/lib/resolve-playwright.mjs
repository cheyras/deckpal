/**
 * Resolve Playwright from wherever it actually is — the same policy as
 * `scripts/decke-gates.mjs`, which keeps its OWN copy of this logic BY DESIGN
 * and must not be pointed here: that suite has one dependency (Playwright,
 * resolved at runtime) and imports nothing from this harness, so a gate run
 * never fails because a sibling harness was refactored (see the isolation
 * note above CHARACTER_RUNTIME in decke-gates.mjs). Do not "deduplicate" the
 * two copies; keep their POLICY in step by hand if either changes.
 *
 * DELIBERATELY NOT A DEPENDENCY OF THIS REPO. CI installs with a frozen
 * lockfile on every push and runs no browser; adding Playwright to
 * `apps/web/package.json` (or the root) would make every build pay for a tool
 * only an operator runs by hand, and it would put Playwright's own dependency
 * tree into `pnpm-lock.yaml` for no CI benefit. `.qa-account` and
 * `decke-gates.mjs` already document this same trade for the same repo.
 *
 * So: use it if it resolves from cwd/node_modules, and otherwise take an
 * explicit path rather than guessing. `PLAYWRIGHT_MODULE` should point at a
 * `playwright` package directory, e.g. one produced by
 * `npm install playwright` in a scratch folder outside the repo.
 *
 *   npm install playwright   (in any scratch folder, e.g. the OS temp dir)
 *   PLAYWRIGHT_MODULE=/path/to/that/node_modules/playwright \
 *     node scripts/visual-harness/run-visual-smoke.mjs
 *
 * The browser BINARY is separate from the npm package and lives in a shared,
 * version-keyed cache at `%LOCALAPPDATA%\ms-playwright` (Windows) —
 * `~/.cache/ms-playwright` on Linux/macOS — so installing the `playwright`
 * package into a throwaway scratch folder does not mean downloading Chromium
 * again if a matching revision is already cached there (from a prior
 * `@playwright/test` or `playwright` install on the same machine, at the same
 * pinned version). `npx playwright install chromium` from that scratch folder
 * pulls it down if it is missing.
 */
import { join } from 'node:path'
import { createRequire } from 'node:module'

export async function resolvePlaywright() {
  try {
    return await import('playwright')
  } catch (err) {
    const explicit = process.env.PLAYWRIGHT_MODULE
    if (!explicit) {
      console.error(
        [
          'playwright is not installed and PLAYWRIGHT_MODULE is unset.',
          '  npm install playwright   (in a scratch folder, e.g. the OS temp dir)',
          '  npx playwright install chromium   (from that same folder, once)',
          '  PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/visual-harness/run-visual-smoke.mjs',
        ].join('\n'),
      )
      throw err
    }
    // `require`, not `import`. Playwright's entry point is CommonJS, and ESM
    // named-export detection does not run for a bare file URL — so
    // `import(fileURL)` resolves to a namespace whose `chromium` is undefined.
    // See decke-gates.mjs for the same note; the failure this avoids looks
    // like "Cannot read properties of undefined (reading 'launch')" three
    // frames away from the actual cause.
    return createRequire(import.meta.url)(join(explicit, 'index.js'))
  }
}
