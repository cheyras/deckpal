import assert from 'node:assert/strict'

// Initial group weights estimate the split of the measured single-runner job.
// Refresh them from TIMING suite lines after a successful sharded CI run.
// Longest-first packing stays stable even if discovery order changes.
export const durations = {
  'typecheck': 5,
  'selfhost-catalog': 35,
  'selfhost-admin': 180,
  'selfhost-feedback': 180,
  'cloud-catalog': 35,
  'cloud-admin': 180,
  'cloud-feedback': 180,
  'cloud-writes': 60,
  'authreturn': 35,
  'chat': 120,
  'payment-history': 15,
}

export function shardSuites(suites, count) {
  assert.ok(Number.isInteger(count) && count > 0, 'Shard count must be a positive integer')
  const shards = Array.from({ length: count }, () => ({ weight: 0, suites: [] }))
  for (const suite of [...suites].sort((a, b) =>
    (durations[b.name] ?? 60) - (durations[a.name] ?? 60) || a.name.localeCompare(b.name))) {
    const target = shards.reduce((best, shard) => shard.weight < best.weight ? shard : best, shards[0])
    target.suites.push(suite)
    target.weight += durations[suite.name] ?? 60
  }
  return shards.map(shard => shard.suites.sort((a, b) => a.name.localeCompare(b.name)))
}

export function parseShard(args) {
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--shard'),
    'Usage: test-browser.mjs [--shard i/n]')
  if (!args.length) return null
  const match = /^(\d+)\/(\d+)$/.exec(args[1])
  assert.ok(match, 'Shard must be i/n, with 1-based i')
  const index = Number(match[1]), count = Number(match[2])
  assert.ok(Number.isSafeInteger(index) && Number.isSafeInteger(count) && index >= 1 && count >= 1 && index <= count,
    'Shard must satisfy 1 <= i <= n')
  return { index, count }
}
