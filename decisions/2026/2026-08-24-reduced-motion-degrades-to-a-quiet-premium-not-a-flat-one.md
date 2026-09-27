---
date: "2026-08-24"
title: "Reduced motion degrades to a quiet premium, not a flat one"
decided_by: "Claude Opus 5 on behalf of @cheyras (issue #49)"
areas: ["frontend"]
supersedes: []
---
## 2026-08-24 — Reduced motion degrades to a quiet premium, not a flat one

**Decided by:** Claude Opus 5 on behalf of @cheyras (issue #49)

**Decision:** `prefers-reduced-motion: reduce` no longer collapses every
animation and transition on the premium skin to 1ms. It now stops MOVEMENT —
translate/scale/rotate travel, the rise, the draw-on, the nav pill's grow, the
hover lift, a progress fill's grow-in — and leaves the cheap opacity/colour/
shadow fades that make a state change legible running, most at their authored
speed (the entrance keeps a fade at `--px-dur`, shortened from `--px-dur-slow`
since it no longer has a translate to cover). Changed `premium.css` §8
(rewritten from one blanket `*` rule to per-section overrides matching the base
rules exactly, `!important`-free) and three matching blocks in `theme.css`
(`.px-sheet-panel`, `.px-sheet-panel[data-closing]`,
`.decke-chat-panel`/`.decke-chat-bar[data-closing]`) — in each case only the
panel/bar's travel collapses; the accompanying scrim's fade (`sheet-scrim-in`/
`sheet-scrim-out`) is left OUT of the reduced-motion block entirely so it keeps
announcing that a sheet arrived or left.

**Why:** Issue #49 — the reporter (iPhone, iOS 18.7, on `/decks`) saw none of
the design-system pass's motion. A prior investigation (logged as a comment on
the issue) ruled out a code regression: every motion-related removal since the
design-system branch was a documented, deliberate replacement, and the layer
was independently confirmed running on production (`px-rise`, `px-draw`,
`px-ping`, `sheet-scrim-in`, `sheet-panel-up` all firing, verified in a real
signed-in browser session). That investigation's leading hypothesis was that
the reporter's device has Settings → Accessibility → Motion → Reduce Motion on,
and `premium.css` §8 was, by design, collapsing everything to 1ms when it saw
that setting — which would reproduce the report exactly with the code doing
nothing wrong.

This session confirmed the hypothesis empirically on a real iOS Simulator
(iPhone 16 Pro, iOS 18.6 — the closest local match to the reporter's 18.7),
using `xcrun simctl` directly (the bundled MCP simulator controller's HID input
path is disabled in this environment — `SimDeviceLegacyHIDClient` / "No Legacy
HID port found" — so taps/screenshots went through `simctl io`/`openurl`/
`defaults write com.apple.Accessibility ReduceMotionEnabled` instead of the
tool's own tap/screenshot actions). Screen-recorded a cold load of
`https://deckpal.app/series` (public, no auth needed) with Reduce Motion off:
consecutive video frames show the content wrapper mid-fade (dimmer, then full
brightness) as `px-rise` runs. Same load with Reduce Motion on: the page pops
in fully-formed between two adjacent frames, no partial-opacity frame at
all — the motion layer runs correctly on real iOS Safari when the OS setting
is off, and the *existing* 1ms-collapse code is what erased it when the setting
is on. No iOS Safari 26 regression; the code and the hypothesis were both
right.

Once the hypothesis was confirmed, the open design question the investigation
comment raised — "whether Reduce Motion should kill *all* of it, or keep the
cheap opacity fades and drop only the movement" — resolves in favor of the
latter: killing every fade along with the travel is heavier-handed than the
accessibility guidance requires (which asks to remove *vestibular-motion*
triggers — spatial travel — not all visual change), and it produces exactly
the "the design system's animation is gone" experience the reporter hit even
though the code was behaving as designed.

**Verified:**
- iOS Simulator, Reduce Motion off vs on, against production
  (`https://deckpal.app/series`, public/unauthenticated) — screen-recorded,
  frames extracted with `ffmpeg`. Confirms the motion layer runs on real iOS
  Safari with the setting off and confirms the *prior* (unfixed) code's
  all-or-nothing collapse with it on.
- Headless Chromium (Playwright, `reducedMotion: 'reduce'` context emulation)
  against the local dev build on the fixed branch:
  - `getComputedStyle` on `.app-content > *`: `animation-duration` is `0.42s`
    under `no-preference` and `0.22s` (`--px-dur`) under `reduce` — the fade
    survives, shortened.
  - CSS OM inspection confirms the reduced-motion `@keyframes px-rise` override
    only sets `opacity` (no `transform`), so the same-named later rule wins the
    cascade and the element's transform is never touched during the run.
  - `getComputedStyle` on a button: `transition-duration` is
    `0.12s, 0.22s, 0.001s, 0.12s, 0.12s` for
    `background-color, box-shadow, transform, opacity, color` under `reduce`
    — only `transform` collapses.
  - CSS OM confirms `.px-sheet-scrim` / `.decke-chat-scrim[data-closing]` are
    absent from the reduced-motion media blocks (keep their authored fade);
    `.px-sheet-panel`, `.px-sheet-panel[data-closing]`,
    `.decke-chat-panel[data-closing]`, `.decke-chat-bar[data-closing]` are
    present at `animation-duration: 1ms`.
- Browser verification at 390px and 1440×900 (`pnpm --filter deckpal-web
  build`, then Playwright screenshots of `/series`): grain, relief and sheen
  render identically to before the change at both widths — the fix only
  touches code inside the `@media (prefers-reduced-motion: reduce)` blocks, so
  full-motion rendering is untouched by construction.
- **Not verified:** signing in with the QA account — `.qa-account` is not
  present in this worktree checkout, so authenticated surfaces (`/decks`
  itself, sheets that require sign-in to reach, Deck-E's chat panel) were
  exercised only via CSS OM inspection, not click-through. `/series` (public)
  was used as the equivalent public surface, since it carries the same
  `.app-content > *` entrance and the same nav.

**Implications:**
- Out of scope, flagged rather than fixed: `apps/web/src/character/host/
  DeckeChat.tsx`, `DeckeBubble.tsx` and `HistoryMenu.tsx` gate Deck-E's own
  entrance animations with Tailwind's `motion-safe:` variant
  (`motion-safe:animate-[decke-chat-in_...]`), which compiles to `@media
  (prefers-reduced-motion: no-preference)` — under `reduce` the class never
  applies at all, so those specific entrances currently skip straight to their
  end state with no fade whatsoever, the same all-or-nothing problem this
  decision fixes elsewhere, just via a different (TSX, not CSS) mechanism. Not
  touched here because it is a different surface (component logic, not
  `premium.css`/`theme.css`) inside a system this session does not own the
  full context of.
- `apps/web/src/routes/landing/landing.css`'s own `prefers-reduced-motion`
  block (scroll-triggered `[data-reveal]` reveals) was reviewed and left
  alone: it already hard-resets to the finished state (`opacity: 1 !important;
  transform: none !important; transition: none !important;`) specifically to
  avoid a blank-page bug if `IntersectionObserver` never fires, and a marketing
  page's one-time scroll reveals are conventionally fully static under
  `reduce` without the "quiet, not flat" concern applying — this file is not
  `premium.css`/`theme.css` and wasn't named in scope.
- No design-token or wiki page currently documents the premium pass's
  reduced-motion behavior (checked `DESIGN-SYSTEM-PLAN.md`,
  `DESIGN-SYSTEM-AUDIT.md`, and the wiki's `Frontend-Research` page — none
  mention it), so there is nothing to update there.

