import assert from 'node:assert/strict'

// The 2026-09-26 CI run measured the unsplit groups (cloud feedback 386s,
// cloud admin 174s, self-host feedback 139s). Width weights divide that
// measured work; refresh them when the smaller groups have their own timings.
// Longest-first packing stays stable even if discovery order changes.
export const durations = {
  'typecheck': 2,
  'selfhost-catalog': 33,
  'selfhost-admin': 64,
  'selfhost-feedback-primary-1280': 35,
  'selfhost-feedback-primary-390': 35,
  'selfhost-feedback-primary-428': 35,
  'selfhost-feedback-lifecycle': 40,
  'cloud-catalog': 28,
  'cloud-admin': 174,
  'cloud-feedback-primary-1280': 90,
  'cloud-feedback-primary-390': 90,
  'cloud-feedback-primary-428': 90,
  'cloud-feedback-lifecycle': 120,
  'cloud-writes': 60,
  'authreturn': 11,
  'chat': 55,
  'payment-history': 16,
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
