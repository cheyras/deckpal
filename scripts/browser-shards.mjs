import assert from 'node:assert/strict'

// The 2026-09-26 CI run measured these groups on hosted runners. Admin was
// split after its measured cloud journey reached 231s; its two new weights
// divide that work until they have their own CI timings.
// Longest-first packing stays stable even if discovery order changes.
export const durations = {
  'typecheck': 2,
  'selfhost-catalog': 33,
  'selfhost-admin-journey': 50,
  'selfhost-admin-controls': 70,
  'selfhost-feedback-primary-1280': 77,
  'selfhost-feedback-primary-390': 72,
  'selfhost-feedback-primary-428': 70,
  'selfhost-feedback-lifecycle': 67,
  'cloud-catalog': 27,
  'cloud-admin-journey': 90,
  'cloud-admin-controls': 141,
  'cloud-feedback-primary-1280': 107,
  'cloud-feedback-primary-390': 87,
  'cloud-feedback-primary-428': 146,
  'cloud-feedback-lifecycle': 129,
  'cloud-writes': 85,
  'authreturn': 14,
  'chat': 63,
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
