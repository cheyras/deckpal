import assert from 'node:assert/strict'

// The 2026-09-26 CI run measured these groups on hosted runners. Admin's
// table and access weights divide its measured 168s cloud / 91s self-host
// controls run until the smaller groups have their own CI timings.
// Longest-first packing stays stable even if discovery order changes.
export const durations = {
  'typecheck': 2,
  'selfhost-catalog': 33,
  'selfhost-a11y': 15,
  'selfhost-admin-journey': 55,
  'selfhost-admin-tables-1280': 35,
  'selfhost-admin-tables-390': 35,
  'selfhost-admin-access': 30,
  'selfhost-feedback-primary-1280': 77,
  'selfhost-feedback-primary-390': 72,
  'selfhost-feedback-primary-428': 70,
  'selfhost-feedback-lifecycle': 67,
  'cloud-catalog': 27,
  'cloud-a11y': 35,
  'cloud-admin-journey': 60,
  'cloud-admin-tables-1280': 55,
  'cloud-admin-tables-390': 55,
  'cloud-admin-access': 58,
  'cloud-feedback-primary-1280': 107,
  'cloud-feedback-primary-390': 87,
  'cloud-feedback-primary-428': 146,
  'cloud-feedback-lifecycle': 129,
  // Measured 537s before the GLC/debounce regressions; reserve room for those
  // journeys instead of packing other suites against the old 85s estimate.
  'cloud-writes': 720,
  // Labeler queue groups (#240): estimates until they have their own CI timings.
  'selfhost-queue': 45,
  'cloud-queue': 50,
  'cloud-labeler-formats': 65,
  'authreturn': 14,
  'chat': 63,
  'error-boundary': 50,
  'payment-history': 15,
  'payment-history-proof': 20,
  'scanner-voice-proof': 20,
  'list-table-virtualization': 8,
  'profile-owned-cards': 30,
  // Estimated from local runs (build + Chromium 70s + WebKit 9s, drawing off).
  'decke-show': 150,
  // Estimated from local runs: its own build, then Chromium and WebKit at 390.
  'decke-chat-phone': 70,
  // Measured 12s locally (a 3s cloud build, then two widths of static pages);
  // padded for hosted runners until it has its own CI timing.
  'privacy': 40,
  // Measured 25s locally (a 7s fixture build, Chromium at 1440 and 390, WebKit
  // at 390); padded for hosted runners until it has its own CI timing.
  'decke-deck-widget': 50,
}

export function shardSuites(suites, count) {
  assert.ok(Number.isInteger(count) && count > 0, 'Shard count must be a positive integer')
  if (count === 1) return [[...suites].sort((a, b) => a.name.localeCompare(b.name))]
  const shards = Array.from({ length: count }, () => ({ weight: 0, suites: [], exclusive: false }))
  // This long visual case made a concurrent catalog screenshot fail once.
  // Reserve a runner for it while every other group remains duration-packed.
  const exclusive = new Set(['cloud-feedback-primary-428'])
  // Reserve isolated cases before heavier ordinary suites can occupy every
  // runner (notably when a local run asks for only two shards).
  for (const suite of [...suites].sort((a, b) =>
    Number(exclusive.has(b.name)) - Number(exclusive.has(a.name)) ||
    (durations[b.name] ?? 60) - (durations[a.name] ?? 60) || a.name.localeCompare(b.name))) {
    const available = shards.filter(shard => exclusive.has(suite.name) ? !shard.suites.length : !shard.exclusive)
    assert.ok(available.length, 'No runner available for suite ' + suite.name)
    const target = available.reduce((best, shard) => shard.weight < best.weight ? shard : best, available[0])
    target.suites.push(suite)
    target.weight += durations[suite.name] ?? 60
    target.exclusive = exclusive.has(suite.name)
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
