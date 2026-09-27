---
date: "2026-09-26"
title: "Virtualize ListDetail's Table view (PERF-03)"
decided_by: "Chey (via Claude)"
areas: ["frontend"]
supersedes: []
---
## 2026-09-26 — Virtualize ListDetail's Table view (PERF-03)
**Decided by:** Chey (via Claude)

**Decision:** `TableView.tsx` (the Table view mode for `ListDetail` and `SetDetail`) now
renders its rows through the same `useWindowVirtualizer` window-scroll row-virtualizer
`GridView.tsx` already uses, instead of `cards.map()` over the whole array. Only rows near the
viewport (plus overscan) are ever mounted, regardless of list length. Added a static (see
below) column-header legend and formal `role="list"`/`"listitem"` + `aria-setsize`/
`aria-posinset` semantics on top, since virtualizing the render was the natural point to also
give the row markup an accessible position signal it never had. `DataTable.tsx` (the shared
admin-panel table primitive) was checked and is not the right place to fix this: it's a
different component for a different data shape — its whole contract is "already filtered,
sorted and paged by the owner" (server pagination is mandatory), so it never faces an unbounded
row count the way a user's personal list can.

**Why:** Measured (this repo's `.sim/` scale-profiling fixture, 3,200 synthetic list items,
headless Chromium, CDP `Performance.getMetrics` TaskDuration + live DOM node count, both under
the shared machine-load lock, before/after back to back):

| Viewport | Metric | Before | After |
|---|---|---:|---:|
| 390×844 | DOM nodes | 29,077 | 485 |
| 390×844 | Script/render time | 3,538 ms | 88 ms |
| 1440×900 | DOM nodes | 29,077 | 485 |
| 1440×900 | Script/render time | 3,041 ms | 120 ms |

Grid and Binder were re-measured alongside and are unaffected (Grid: ~500-900 DOM nodes either
way, already virtualized; Binder: ~340 DOM nodes either way, already a real client-side pager —
confirmed neither needed a change). Post-scroll script cost also dropped (~270-320 ms → ~130-180
ms for a 20-tick wheel burst), in the same range as Grid's own scroll cost, since compositing
~500 nodes is cheaper than ~29,000 regardless of what's scrolling.

**Implications:**
- Column sort keeps working with no changes here: `ListDetail.tsx` sorts `items` into `view`
  before handing it to `TableView`, so virtualizing the render is a pure windowing change over
  whatever order it's handed — verified by rendering `?sort=name&dir=asc` vs `...desc` and
  confirming the visible rows reorder correctly under virtualization.
- Keyboard access: Tab reaches a mounted row's link and Enter opens that exact card, verified
  under virtualization. Tabbing past the last *mounted* row without scrolling first will skip
  ahead to the next focusable element outside the list rather than reveal more rows — the same,
  already-accepted tradeoff `GridView.tsx` has shipped with; not a regression this PR
  introduces.
- Find-in-page (Cmd/Ctrl+F) and the browser's native print of the on-screen table can no longer
  reach rows that aren't currently mounted — again, the same tradeoff already accepted for
  `GridView.tsx`. The **"Print checklist"** button is unaffected either way: it opens a fully
  server-rendered PDF (`GET /lists/:id/pdf`, `apps/api/src/export/router.ts` →
  `renderListPdf`), generated from the database directly, never from the client DOM — checked
  directly in the API source, not assumed.
- Attempted to also make the new column-header legend `position: sticky` under the fixed app
  nav. **Confirmed it does not work, for a reason that predates this PR**: `theme.css:315-324`
  sets `overflow-x: hidden` on `html, body` without setting `overflow-y`, and per the CSS
  Overflow spec that computes `overflow-y: auto` on both anyway — making `<body>` register as a
  CSS scroll container even though real page scroll happens on `<html>`
  (`document.scrollingElement`). Any `position: sticky` element whose nearest scrolling
  ancestor resolves to `<body>` pins to body's own (never-moving) `scrollTop` and never
  activates. Confirmed with real `page.mouse.wheel()` scroll + `getComputedStyle`, not guessed.
  This is exactly the "classic bug pairing" the wiki's Frontend-Research §B.2 caveat 5 already
  warned about for Grid's filter bar — now root-caused. It likely also silently defeats
  `DeckBuilder.tsx`'s `lg:sticky lg:top-[92px]` sidebar and `CardDetail.tsx`'s `nav:sticky
  nav:top-0` image column. Shipped the header as a plain, non-sticky legend instead of a
  visually-broken sticky one; flagged the site-wide fix (`overflow-x: clip` in place of
  `hidden`) as a separate follow-up rather than folding an unrelated global-CSS change into a
  perf PR.
- Added a standalone browser regression test, `tests/browser/listTableVirtualization.mjs`
  (`pnpm test:browser:list-table`): builds the real SPA, serves a 3,200-item fixture list, and
  asserts a bounded DOM node count at both viewports, correct sort-direction ordering, and
  keyboard Tab+Enter reaching and opening the exact focused row. Deliberately not wired into the
  shared `scripts/test-browser.mjs` orchestrator — that suite's `serve()` enforces a closed
  allowlist of known API paths shared across several concurrently-developed PRs, and growing it
  for one route this suite doesn't otherwise exercise seemed likelier to cause merge conflicts
  than to earn its keep; a good follow-up once the concurrent PR traffic on that file settles.

**Where enforced:** `apps/web/src/components/TableView.tsx`; regression test
`tests/browser/listTableVirtualization.mjs`.

### Addendum — Astra review findings, both fixed

The required independent review (`npx @openai/codex review --base origin/main`, model
`gpt-6-astra`) returned two P2 findings against the first version of this PR. Both were valid;
both are fixed as of this addendum.

**1. Off-screen card reveals broke in `SetDetail`'s Table view.** `SetDetail.tsx`'s reveal
handler (Deck-E asking to bring one card into view) used `document.querySelector(...)
.scrollIntoView()`, on the documented assumption that "the table renders every row it has, so a
reveal there is the ordinary browser problem of scrolling to an element that already exists" —
true before this PR, false after. `TableView` now accepts an optional `reveal` prop and resolves
it via `virtualizer.scrollToIndex`, mirroring `GridView`'s existing reveal effect exactly
(including its "already centred, don't re-animate" check). `SetDetail`'s old handler now only
covers Binder (which still only paginates, so a card on another page is still out of reach — a
pre-existing, unrelated limitation, unchanged). Not covered by an automated test: reproducing it
needs a synthetic large *set* (not just a large list), which this PR didn't already have a
fixture for, and building one felt disproportionate to a fix that's a near-verbatim copy of
`GridView`'s already-shipped, already-relied-upon reveal code. Verified by type-checking (the
`GridReveal` type import and `scrollToIndex` call sites are all real, shared APIs) and by direct
comparison against `GridView`'s working implementation, not by an end-to-end browser reveal
test — flagging that gap rather than claiming coverage I don't have.

**2. Header/row column misalignment for signed-in users.** The new column header assumed fixed
column positions the row markup didn't actually have: `RowCounters` (0-4 quantity chips,
depending on the card) sat between Price and the chevron with no reserved width, so `Name`'s
`flex-1` absorbed a different amount of space on every row depending on how many chips that
row's card happened to have — shifting Price's rendered position row-to-row, not just relative
to the static header. Fixed with literal (not JS-constant-interpolated — Tailwind's class
generator only sees literal strings) fixed-width columns for Variant (110px), Price (72px) and
Counters (128px), plus `min-w-0` on two flex items that otherwise refuse to shrink below their
content size and silently reintroduce the same drift. Verified empirically, not just reasoned
about: measured each visible row's Price `getBoundingClientRect().left` before and after — before,
mobile varied 262-284px across 8 rows depending on the name text length that happened to overflow;
after, constant at 254px on mobile and 1089px on desktop, at every row, regardless of that row's
own variant/counter content. Screenshots taken with a fixture card that genuinely has 0-4 standard
variants (added a small `/api/cards/:id` handler to this repo's untracked `.sim/` scale fixture
for this — not part of the PR diff) confirm it visually too.

**FLAGGED DECISION, not fixed silently:** making the 128px counters column fit at narrow widths
left literally 0 width for the card's own name when shown unconditionally (measured, not
assumed) — a phone (and, it turned out on the second review pass below, a small tablet) genuinely
doesn't have room for num + name + price + 4 quantity chips + chevron at once. Rather than pick a
smaller, less-than-honest reservation that would just move the same misalignment to a rarer case,
quantity counters are no longer shown below the `md` breakpoint in Table view at all (they still
are on Grid, and the card detail sheet still offers them) — the same gated treatment the Variant
column already had, extended to Counters. This is a real, visible behavior change from before
this PR (counters used to render, just unaligned, at every width) and is called out here for
Chey's review rather than left for someone to discover later. An alternative I considered but
didn't build without a design call: collapse the up-to-4 chips into a single compact "+"
affordance that opens a quantity picker, which could fit narrower without dropping the feature —
flagging it as the natural follow-up if the current narrow-width behavior isn't the right call.

### Addendum 2 — second Astra pass, two more valid findings, both fixed

Pushed the fixes above, then re-ran the required independent review against the new diff. Two
more valid P2 findings, both fixed:

**3. `offsetTop` is relative to the nearest transformed ancestor, not the document.** This
component's `scrollMargin` (needed so `useWindowVirtualizer` — a *window*-scroll virtualizer —
knows how far down the page its own container sits) was computed from
`containerRef.current.offsetTop`. `.offsetTop` is defined relative to the element's
`offsetParent`, which per spec becomes the nearest ancestor with a computed `transform` other
than `none` — and `lib/lateEntrance.ts`'s late-arriving page entrance (`.px-enter`, the premium
skin's default, applies to exactly this list's ancestor) runs a `translateY(10px) → none`
animation for `var(--px-dur-slow)` on load. Measured during that window, `offsetTop` returns a
value relative to that animating ancestor (typically near 0) instead of the document, so
`scrollToIndex` would land short by roughly the height of everything above the table (nav, list
header, filters). Fixed by switching to `getBoundingClientRect().top + window.scrollY`, which is
always viewport-relative regardless of any ancestor's transform — correct whether or not the
entrance animation is still running — and re-measuring on window resize (a reflow elsewhere on
the page can move this element without its own size changing, which a resize-only listener also
doesn't fully solve, but matches what a plain `getBoundingClientRect` snapshot can do without
adding a `MutationObserver` or similar for a component that isn't the one moving).

**4. The `sm` (640px) breakpoint didn't leave room for both reserved columns.** Turning on
Variant (110px) and Counters (128px) together right at 640px needs roughly 658px of content
width, but `Content`'s gutters only hand back about 608px at that exact viewport width — so from
640px up to roughly 690px, the same "`Name` collapses toward zero" failure from Addendum 1
reappeared, just at a boundary my first verification pass (390px and 1440px only) never actually
measured. Fixed by moving both reservations from `sm:` to `md:` (768px). Re-verified empirically
across the whole transition, not just spot-checked: rendered `Name` width at 390/600/640/660/680/
690/700/768/800/900/1440px is 70/280/320/340/360/370/380/178/210/310/432px — never collapses, and
the 768px step (178px, where the two columns first turn on) is comfortably readable, not merely
non-zero.

Both fixes are in the same commit as this addendum. Not independently re-verified end-to-end for
the exact "premium skin + cold load + mid-animation reveal" scenario Astra described (would need
a synthetic SET fixture with the entrance animation actively running at measurement time) — the
fix is correct by construction (`getBoundingClientRect` is unaffected by transformed ancestors by
definition, not by observed behavior in one scenario), which is why this is noted rather than
claimed as fully covered.
