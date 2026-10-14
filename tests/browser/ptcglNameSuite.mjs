import path from 'node:path'
import { ROOT, isolatedEnv, run } from './support.mjs'

// Profile → PTCG Live name (migration 086). Its own build, fixture server and
// browser; screenshots land in the run's artifact directory.
export function browserSuites({ results, logs, out }) {
  return [{
    name: 'ptcgl-name',
    async run() {
      logs.push(await run(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tests/browser/ptcglName.mts')],
        { env: isolatedEnv(out ? { DECKPAL_PTCGL_NAME_SHOTS: path.join(out, 'ptcgl-name') } : {}) }))
      for (const width of [1280, 390]) results.push({ case: 'ptcgl-name', width })
    },
  }]
}
