/**
 * Does any pair of tracked files collide on a case-insensitive filesystem?
 *
 * This exists because `apps/web/src/components/ui/DataTable.tsx` and
 * `apps/web/src/components/ui/dataTable.ts` (added in the same PR, #188) sat
 * side by side for weeks. Git — and Linux CI, which runs on a case-sensitive
 * filesystem — treated them as two unrelated files with no problem resolving
 * either. But `apps/web/src/components/ui.tsx` imports the extensionless
 * `./ui/DataTable`, and Vite/Rolldown's resolver tries candidate extensions
 * in order against that path with a plain `fs.stat`. On a standard Mac's
 * case-insensitive (but case-preserving) APFS volume, `fs.stat` for
 * `DataTable.ts` succeeds by matching `dataTable.ts` — a different file — so
 * the build resolved the WRONG module and failed with
 * `"DataTable" is not exported by ".../DataTable.ts"`. Nobody saw it because
 * CI (Linux, case-sensitive) can't reproduce a case-insensitive-filesystem
 * bug at all.
 *
 * Two hazards, both checked here from `git ls-files` alone — no build, no
 * dependencies, no filesystem probing:
 *
 *   1. Two tracked paths that become IDENTICAL when the whole path is
 *      lowercased (e.g. `Foo/bar.ts` and `foo/Bar.ts`). `git checkout` itself
 *      cannot materialize both on a case-insensitive volume — one silently
 *      clobbers the other.
 *   2. Two tracked source files in the SAME directory whose basename (minus
 *      one resolvable extension) is identical case-insensitively — e.g.
 *      `DataTable.tsx` and `dataTable.ts`. Nothing clobbers on disk, but an
 *      extensionless import of either name is a coin flip on a
 *      case-insensitive filesystem, decided by extension-resolution order
 *      and directory-entry order rather than by the import path actually
 *      written. This is the DataTable bug's exact shape.
 *
 * Kept deliberately dependency-free (node:child_process + node:path only) so
 * it costs nothing to run on every push, before any install or build step.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

// The extensions Vite/Rolldown (and Node's own ESM resolver) try against an
// extensionless specifier. Not exhaustive of every possible loader, but this
// is the resolvable set that actually bit us; a non-code pair (e.g. a `.ts`
// next to a same-named `.md`) is not a resolution hazard and is left alone.
const RESOLVABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.vue'])

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)

const byLowerPath = new Map()
for (const file of files) {
  const key = file.toLowerCase()
  if (!byLowerPath.has(key)) byLowerPath.set(key, [])
  byLowerPath.get(key).push(file)
}
const pathCollisions = [...byLowerPath.values()].filter((group) => group.length > 1)

const byDirAndStem = new Map()
for (const file of files) {
  const ext = path.extname(file)
  if (!RESOLVABLE_EXTENSIONS.has(ext)) continue
  const key = path.dirname(file) + '\u0000' + path.basename(file, ext).toLowerCase()
  if (!byDirAndStem.has(key)) byDirAndStem.set(key, [])
  byDirAndStem.get(key).push(file)
}
const importCollisions = [...byDirAndStem.values()].filter((group) => group.length > 1)

if (pathCollisions.length === 0 && importCollisions.length === 0) {
  console.log(`check-case-collisions: ${files.length} tracked files, no case-insensitive collisions. OK`)
  process.exit(0)
}

if (pathCollisions.length) {
  console.error('check-case-collisions: paths that collide on a case-insensitive filesystem (checkout will clobber one):')
  for (const group of pathCollisions) console.error('  ' + group.join('  <->  '))
}
if (importCollisions.length) {
  console.error('check-case-collisions: same-directory files whose extensionless import is ambiguous case-insensitively:')
  for (const group of importCollisions) console.error('  ' + group.join('  <->  '))
}
console.error('\nRename one file in each group so the stems no longer match case-insensitively.')
process.exit(1)
