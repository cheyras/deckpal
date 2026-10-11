// The card-back gate (engine/cardBack.ts): real backs are backs, and the real
// cards that came closest to the template stay cards. The looks below are
// measured, not synthetic — each is the 264-byte look (look.ts) of a real frame
// or crop, recorded 2026-10-10 from the sources named.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CARD_BACK_LOOK,
  CARD_BACK_MAX_DISTANCE,
  cardBackDistance,
  isCardBackLook,
  rotateLook180,
} from '../cardBack'
import { lookDistance, LOOK_GRID_H, LOOK_GRID_W, type CardLook } from '../look'

const look = (b64: string): CardLook => {
  const l = Uint8Array.from(Buffer.from(b64, 'base64'))
  assert.equal(l.length, 3 * LOOK_GRID_W * LOOK_GRID_H)
  return l
}

const BACKS: Record<string, string> = {
  // A replay's lock look (scripts/scan-bench/video), R20ttkcolco 341.75 s: a sleeved back, washed out.
  'video lock, sleeved':
    'ytfa2tfa4eLGycfFx8fMx8HDztPOwrfDudTixLnCtrDM4bespaPJsNHhxKHT0cy+qNnazNzi1dWap9DF1tfbuI6enLXQ2cukqbWvv8C5sq7KyMC+vLvBuIZ+fn94dYJ8Y1tiVWdKX02JbW1+goeBboyDfG5nfZSUhH1ocFtSfZSBe3d5d3N0hY59d3d3dnp+lYx8d3Z4fISUlZKHgHyAiWhre4F0amh3aXBSaWNgbVZ9g4ODhYaChIuQjZKMlY6VfYqKg4J/gYl7gYSSmIZ1dICElo6hqoZ1goWGhYWKi396hIWFhYaFhHR7hIWGhYWBdnR3foOFg36MioWCiIyNhouJk4uNjoqS',
  // dXzZTc85QtM 142.5 s: a thumb over the bottom corner — the worst-placed real back that still counts.
  'video lock, thumb on it':
    'Z36Pf395bXCOeY6GkoqPqYCNiYWGiI6TcMbJl4pSTmusxWBfdpBlSsK0e2KfeZZFlMimq864tHFKlZSixLG1g0xHaYSww3tJgHh2gZqRaU6VmZGKh3+Ebp2YlJSVlZWWWI5nfnx+iIxwb3d2e2xdb5yNiomVn5iSjoBuZluEqKKKgoiAdmuQnZCEg4OCg4iRnI2Fg4KGiJGenZmQioePl2N7jYqBdHuaeXZtbWV/YXZqcXZ2d3h4eJ15k4eGhX9+j5CMi4iUoJFrfYCEdGZvdnqMoqy+i1digId6hJaoeGh4g4ODhIOBd2p8goODgoF4aGpueYGDeXCbiXl/ho6JboqMkZOWh5mI',
  // The owner's crop of a back in a binder sleeve (quad-queue, verify-truth "Pokemon card back").
  'owner crop, binder sleeve':
    'n4eDjHuVgJSUgZSAf4iHkX2Ms7+NXUhQa8CwXmuVelSexX1ygW6SWaXHk1mkx5OcWsKymMDOqK0/XZp6pKe6bT45QGeguZJag3FhY39+bXmJe5Zrcnx6iUlvamJxUHZoWGBMY2pdVj2EgHx9goyRhox3bWlcZpigfnFreWhabpR8cnV4cnJ0f4x1cXFwcXV6l4d4c3F1dYWVlZOHfnd+ik5rfYNxa25jXXZAa2JccE+bjIyQiZiJjpWSm5GNk5ejgoWGhYR9eX97iJmluKd0bYSNmoaiupx1hYuIiIuKjYR7iYuMi4uKh3N+iI2LiYmBdnV3gIaIhH+bjoWDi42MkpSIo42RlIya',
}

const CARDS: Record<string, string> = {
  // The nearest of all 20,467 English catalog images (base5-80), and the next (me02.5-241).
  'catalog nearest':
    'WVlNTEpQVk0ECRIfIhEJBQcdRW9sRSQJHUJ2nKd+SigraJGQcJxyMShxjHJuj3YuH0V3l6V0RyQHGEFmY0IhBysrM0BENjEuPUM7SEZPUVFGR0dMSU5OTXt+fn1+fX5+gIGCfXyBgYGAgoZ4d4OBgH58gHFxeHh9f3Z0eXlzc35/dHd4dnZ0fn55eHJzgHt+gYGDd3aGg4CBgYF+foGBgIGBgYGBgYGBgYKBgYKBgYGDgYKCg4KCgYCAf4GCgICAgH93f4aDgoCEiYCIiYyIg32DgYOCiIF+fYGEgoV9hn6Ch4yJh4GJhYCBg4aBeX2Bf3+AgYF/f39/f39/f39/f39/f39/f39/',
  'catalog second':
    'sKKirq2ktKuLm6yvqaKjj62kr764o5GhnqrVpKLLlZyqusSdt86+pLG1v4SaycGdpKbKvbzNp5+ii7S/t6aeuY2UnKa0v5iVoJ6ln66nprijoZKVoKWdpoV8fX+BfGRndnp+f359eHF2eoKEgX92dneBgoWBfnxydIJ3hIdwhXt3hHKCfmqFeneGb3l7fIZ1cXuCgIKGfnt2e3x8eHuAd3h1fYR9eWZldnN0dXd5cGt6f392gIWiqYd5hYSNg4idio+Qh4qIiIuDh4CVm3uRkod9kp2BiIaMioeYuKqBhJCPio+YlnyDkI6PjYZ+gY6FiY2MopyOjYmQhZCBiIuUio2GhomLh5GV',
  // The nearest of 776 real card crops (owner, telemetry, video captures).
  'real crop nearest':
    'MjcmMDslLi86Nz02HyImPzosfHBIHjEyPjlZemVeLB8tOVt4eltMHCY5b4FiRUIoKywuS0hIKy8xOk9GV0pEKkdCRzxAQTkvIDUsGyg1JCdGb19kSFxcMn94eHt8fHd4enp4h394fHByelJvdHx5dnN6aGhmcnl6endta2CCfXp6eHl3d4V6fnV0eXZ9fXp2eXWAgH+BdHp7fIaFhoJ/fX6Bh4iKiXt9enx/foOEf3yAfoF+fn6ChHx8fnd+gYCIfYCNk5GAgIKIgY6cp4qBgYOCj5uXfYCDgIODg3t0hIGGiYOBf4GDiYiHfX1/eo2ChH98fHh+gIF/foOBgH2AgoODg4N+f4GA',
  // The nearest of 1,033 lock ticks on a ground-truth card in 14 replayed videos (SKQJEu7DDzo 899.5 s).
  'video lock nearest':
    'fZOboKqmnKGOgaOonaOcqY+NqKGVmZKSkJ6psK+xrq+mpbCyubi1lLGKnLCzs6aooK2jp6m1uLqoo62wtL+7r7+Gho2WuLOvo6ehmJqfkrKYoaKklJOesHR2eHp6eXx8dXJ7fXt7fX50dXt+fHx+f3x9fX58fH1+fH19fn18fX58fn5+fHx9fn1+fX59fX1+fX59fX18fX58f31+fXx9fn1+fX18fX5+cX99e3t9fX6JiIiJioqLiYqGhoSGiYyKiIiIhomHiYiKiIeHioiKiYqHhoaIh4mHioaFhoeGh4aHhoWFhYaGhoaFhoWGhoaFh4SFhYeHhoaIhYaHiYeFh5SGh4iLhoWH',
}

test('the template is a back either way up', () => {
  assert.equal(cardBackDistance(CARD_BACK_LOOK), 0)
  assert.equal(cardBackDistance(rotateLook180(CARD_BACK_LOOK)), 0)
  assert.deepEqual(rotateLook180(rotateLook180(CARD_BACK_LOOK)), CARD_BACK_LOOK)
  assert.equal(isCardBackLook(CARD_BACK_LOOK), true)
})

test('real backs are backs, upright or upside down', () => {
  for (const [name, b64] of Object.entries(BACKS)) {
    const l = look(b64)
    assert.ok(isCardBackLook(l), `${name}: ${cardBackDistance(l).toFixed(3)}`)
    assert.ok(isCardBackLook(rotateLook180(l)), `${name}, turned`)
  }
})

test('the real cards nearest the template stay cards, with margin', () => {
  for (const [name, b64] of Object.entries(CARDS)) {
    const d = cardBackDistance(look(b64))
    assert.ok(d > CARD_BACK_MAX_DISTANCE + 0.1, `${name}: ${d.toFixed(3)} is within 0.1 of the gate`)
  }
})

test('no look is not a back — the gate fails open', () => {
  assert.equal(isCardBackLook(null), false)
})

test('the threshold is a distance in lookDistance units, as the re-arm uses', () => {
  const l = look(BACKS['video lock, thumb on it'])
  assert.equal(cardBackDistance(l), Math.min(lookDistance(CARD_BACK_LOOK, l), lookDistance(rotateLook180(CARD_BACK_LOOK), l)))
  assert.equal(isCardBackLook(l, 0.1), false, 'a tighter gate refuses it')
})
