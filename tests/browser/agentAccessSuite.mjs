import path from 'node:path'
import { ROOT, isolatedEnv, run } from './support.mjs'

// Profile → Agent access: read-only personal access tokens (migration 085).
// Its own build, fixture server and browser; screenshots land in the run's
// artifact directory.
export function browserSuites({ results, logs, out }) {
  return [{
    name: 'agent-access',
    async run() {
      logs.push(await run(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tests/browser/agentAccess.mts')],
        { env: isolatedEnv(out ? { DECKPAL_AGENT_ACCESS_SHOTS: path.join(out, 'agent-access') } : {}) }))
      for (const width of [1280, 390]) results.push({ case: 'agent-access', width })
    },
  }]
}
