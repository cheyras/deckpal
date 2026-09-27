import path from 'node:path'
import { ROOT, isolatedEnv, run } from './support.mjs'

export function browserSuites({ results, logs }) {
  return [{
    name: 'profile-owned-cards',
    async run() {
      logs.push(await run(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tests/browser/profileOwnedCards.mts')],
        { env: isolatedEnv() }))
      for (const width of [390, 1440]) results.push({ case: 'profile-owned-cards', width })
    },
  }]
}
