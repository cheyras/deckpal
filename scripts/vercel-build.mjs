// The Vercel build, as one file — vercel.json's buildCommand caps at 256
// characters (the CLI's projectSettings validator rejected the inline chain,
// 2026-09-07), and a chain that long belongs somewhere it can carry comments
// anyway. Order matters: the model fetch is first so a failed digest kills
// the build before any compile time is spent, and every workspace package
// builds before the apps that resolve their dist/ at runtime — see the
// 2026-09-06 @deckpal/matching cold-start finding in DECISIONS.md.
import { execSync } from 'node:child_process'
const steps = [
  'node scripts/fetch-embed-model.mjs',
  'pnpm --filter @deckpal/db build',
  'pnpm --filter @deckpal/matching build',
  'pnpm --filter @deckpal/storage build',
  'pnpm --filter @deckpal/agent-tools build',
  'pnpm --filter deckpal-api build',
  'pnpm --filter deckpal-mcp build',
  'pnpm --filter deckpal-web build',
]
for (const s of steps) {
  console.log(`[vercel-build] ${s}`)
  execSync(s, { stdio: 'inherit' })
}
