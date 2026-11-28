#!/usr/bin/env node
/**
 * How much of the web app is still spaced off the token scale.
 *
 *   node apps/web/scripts/spacing-audit.mjs            # summary
 *   node apps/web/scripts/spacing-audit.mjs --files    # plus the worst files
 *   node apps/web/scripts/spacing-audit.mjs --file src/components/ui/Sheet.tsx
 *
 * Counts the bracketed pixel spacing utilities — padding, margin, gap and
 * space-between (`px-[16px]`, `gap-[12px]`, `-mt-[6px]`) — across src/, and
 * splits them in two:
 *
 *   ON SCALE   the value is a sanctioned step (theme.css "spacing"), so the
 *              rewrite is mechanical: `px-[16px]` → `px-4`.
 *   OFF SCALE  3px, 5px, 18px… — not a step. Each one needs a person to decide
 *              which neighbouring step it was meant to be, and to look at it.
 *
 * Read-only. It changes nothing; the migration itself is done file by file,
 * by whoever owns the file, with the page open (see /design → Pending).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** px → Tailwind step. Mirrors the list written beside `--spacing` in theme.css. */
export const SCALE = new Map([
  [0, '0'], [1, 'px'], [2, '0.5'], [4, '1'], [6, '1.5'], [8, '2'], [10, '2.5'], [12, '3'], [14, '3.5'],
  [16, '4'], [20, '5'], [24, '6'], [28, '7'], [32, '8'], [40, '10'], [48, '12'], [56, '14'],
  [64, '16'], [80, '20'],
])

const UTILITY = /(?<![\w-])(-?)((?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y))-\[(-?\d+(?:\.\d+)?)px\]/g

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      yield* walk(path)
    } else if (/\.(tsx|ts)$/.test(name) && !/\.(test|gallery)\.tsx?$/.test(name)) yield path
  }
}

const args = process.argv.slice(2)
const only = args.includes('--file') ? join(root, '..', args[args.indexOf('--file') + 1]) : null
const files = only ? [only] : [...walk(root)]

let onScale = 0
let offScale = 0
let tokenised = 0
const offValues = new Map()
const perFile = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  let on = 0
  let off = 0
  for (const m of src.matchAll(UTILITY)) {
    const px = Math.abs(Number(m[3]))
    if (SCALE.has(px)) on++
    else {
      off++
      offValues.set(px, (offValues.get(px) ?? 0) + 1)
    }
  }
  tokenised += (src.match(/(?<![\w[-])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(?:\d+(?:\.\d+)?|gutter|corner|hit)(?![\w[\]-])/g) ?? []).length
  onScale += on
  offScale += off
  if (on + off) perFile.push({ file: relative(join(root, '..'), file).replaceAll('\\', '/'), on, off })
}

console.log(`arbitrary px spacing utilities: ${onScale + offScale}`)
console.log(`  on scale  (mechanical rewrite): ${onScale}`)
console.log(`  off scale (needs a decision):   ${offScale}`)
console.log(`scale utilities already in use:  ${tokenised}`)
console.log(
  `off-scale values: ${[...offValues].sort((a, b) => b[1] - a[1]).map(([px, n]) => `${px}px×${n}`).join(', ')}`,
)
if (args.includes('--files') || only) {
  console.log('\nfiles (most first):')
  for (const f of perFile.sort((a, b) => b.on + b.off - (a.on + a.off)).slice(0, only ? 1 : 25)) {
    console.log(`  ${String(f.on + f.off).padStart(4)}  ${f.file}  (${f.off} off scale)`)
  }
}
