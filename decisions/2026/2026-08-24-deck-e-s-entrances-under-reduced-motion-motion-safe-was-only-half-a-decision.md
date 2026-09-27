---
date: "2026-08-24"
title: "Deck-E's entrances under reduced motion: `motion-safe:` was only half a decision"
decided_by: "Claude, following the issue #49 fix (PR #88, \"Reduced motion:"
areas: ["agents","decks","operations"]
supersedes: []
---
## 2026-08-24 — Deck-E's entrances under reduced motion: `motion-safe:` was only half a decision
**Decided by:** Claude, following the issue #49 fix (PR #88, "Reduced motion:
stop the movement, keep the fades") into the surfaces that fix could not reach.

**Decision:**

Every Deck-E entrance gated with Tailwind's `motion-safe:` now names a
`motion-reduce:` sibling that fades. The travel still goes; the fade stays.

**Why:**

`motion-safe:` compiles to `@media (prefers-reduced-motion: no-preference)`.
It says what happens when movement is welcome and it says **nothing at all**
about `reduce` — under `reduce` the class simply does not apply, so the chat
panel, the minimised bar, the "Jump to latest" button and the History dropdown
did not arrive quietly, they were on the next frame, indistinguishable from a
page that never moved. That is the same defect #49 reported on the premium
skin, reached by the opposite road: there a blanket `1ms` crushed the fades
along with the travel, here the fades were never started. Neither is what
`reduce` asks for, which is less MOVEMENT — not an app that stops telling you
things happened.

The split is by property, exactly as premium.css §8 now splits it. One new
keyframe, `decke-calm-in` in theme.css, is `decke-chat-in` with the `transform`
leg cut out, and every reduced-motion entrance runs it at **220ms** — one calm
duration rather than each site's authored 160/180/220/280ms, because those
numbers pace travel of different lengths and with the travel gone there is no
length left to pace. 220ms is the value premium.css already settled on for a
reduced-motion entrance; `--px-dur` itself could not be referenced, being
defined inside `:root[data-skin='premium']`, and this has to work on `classic`.

Three judgement calls inside that:

- **The scrim's two branches name the same animation.** `sheet-scrim-in` is
  opacity and nothing else, so there is no travel in it to take away. Written
  out on both sides rather than left unguarded, so the element reads like every
  other entrance and changing the fade on one line cannot silently leave the
  other behind.
- **`decke-composer-drop` is deliberately left with no `reduce` branch.** Its
  own keyframe comment already ruled on this: the composer is not arriving, it
  is being repositioned, and *"there is no information in the travel, only
  delight."* A fade there would announce an event that did not happen.
- **`DeckeBubble` gave up `motion-reduce:transition-none`.** With both
  directions instant, a line he starts saying and a line he stops saying were
  the same event — the bubble was simply there, or simply not. It keeps the
  opacity transition and loses the travel at the source: the offset is a
  per-render JS value and therefore inline, and an inline declaration outranks
  every stylesheet, so it now goes through a `--decke-speech-pop` custom
  property that `.decke-speech-pop` reads and the `reduce` rule beside it sets
  to `none` — winning on source order, with no `!important`, the discipline §8
  states for itself.

`historyWiring.test.ts`'s X1 pin was widened to accept `motion-reduce:` as a
guard alongside `motion-safe:`, and given a second assertion that the dropdown
actually carries the reduce branch. Worth recording that the pin as written
would have **failed the fix for the defect** — it accepted only `motion-safe:`,
which is the very prefix that leaves `reduce` unhandled.

**Verified** with Playwright `reducedMotion: 'reduce'` context emulation against
the running app, reading computed styles and the Web Animations API. Under
`reduce` all six entrances resolve to an opacity-only animation
(`decke-calm-in` / `sheet-scrim-in`) at 220ms/180ms and the bubble's computed
`transform` is `none` with `transition-property: opacity`; under
`no-preference` every authored animation and duration is byte-for-byte
unchanged (`decke-chat-in` 160/180/220/280ms, `sheet-panel-up` 260ms,
`sheet-scrim-in` 180ms, and the bubble's `matrix(0.94, 0, 0, 0.94, 8, 8)`).
Frame-by-frame opacity sampling — the standard #49 set — catches 25 partial
frames on the way in, where before there were none.

**#88 is the parent commit, and that matters.** During development this branch
sat on a `main` that did not yet have it, and there the fades measured **1ms on
the premium skin** — the default and the shipping skin — because §8's blanket
`:root[data-skin='premium'] * { animation-duration: 1ms !important }` was still
swallowing them. Nothing here caused that and nothing here could have fixed it;
the numbers above were only reachable by deleting that one rule at runtime.
Rebased onto #88 they are measured directly, on `premium` and `classic` alike,
with no runtime surgery. Recorded because the pairing is not obvious from either
diff: a reader who lands only this commit on an older base will see it do
nothing at all, and conclude the wrong thing about why.

