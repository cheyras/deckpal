---
date: "2026-08-12"
title: "Interface tuning pass from the 2026-08-12 screen recording"
decided_by: "user (screen recording + narration, `~/Movies/CursorCaptures/capture-20260812-185915`)."
areas: ["frontend"]
supersedes: []
---
## 2026-08-12 — Interface tuning pass from the 2026-08-12 screen recording
**Decided by:** user (screen recording + narration, `~/Movies/CursorCaptures/capture-20260812-185915`).
**Decision:** a named list of interface corrections, applied on `design-system`.

- **Set header**: no art/gradient wash — it sits on the page surface like everything
  else. Row 1 is set identity left + actions right; row 2 gives the collected/level
  progress the full width. Logo enlarged (103→132px).
- **Back control**: no longer a raised pill. `theme.css .back-plate` — face is the page
  surface, pressed in by a dark top inner edge and a lit bottom edge, shaped as a
  left-pointing plate (bevel via clip-path, tip blunted ~4px, other corners radius-sm).
  All seven call sites already route through `BackPill`, so this was one edit.
- **Tabs**: the underline variant padded only its bottom, so under the premium skin —
  which turns the active tab into a raised tile whose box IS that padding — the label sat
  jammed against the tile's top edge. Padding is now symmetric.
- **Card modal**: the deck-scoped panel became a leading **tab** ("In this deck") instead
  of a block stacked above the card body, which had repeated the art and the name/set line
  the body renders inches below. Hero image is `sticky` on the two-column layout; the
  scroll container's top edge is masked with a fade whose distance MATCHES its top padding,
  so nothing dims until it actually leaves (no scroll listener needed).
- **Insights**: labels inside the change-tinted panel take `--color-change-positive-label`
  / `--color-change-negative-label` (emerald-200 / red-200) — grey on the green wash read
  as dirt.
- **Pokédex**: the completion bar routes through the `Progress` primitive, so its track is
  the recessed `--color-track-subtle` like every other bar rather than a raised light rail.
- **Series set rows**: the logo is a full-bleed section (card's radius on the left, square
  right edge, own gradient), the set code badge shares the title line, and the progress bar
  runs the full remaining width instead of being capped at 120px.
- **Collapsed nav rail**: the mark and the expand control share one centred cell and
  cross-fade on hover/focus. Previously the chevron sat beside the mark and shoved it off
  the rail's centre line, out of alignment with the nav icons below.
- **Deck history diff**: brand primary for additions, secondary (rose) for removals, in the
  UI face with `tabular-nums` — not status green/red in monospace. The W/L record keeps its
  status colours; that one IS a win/loss statement.

**Root cause found while doing this — one skin rule, five symptoms.**
`premium.css` set `position: relative` on `.bg-action-primary`, `.bg-action-brand`,
`.btn-fill-*` and `.bg-surface-tertiary.rounded-full` to host its `::after` sheen. Those
selectors are keyed on utility classes and this file is UNLAYERED, while Tailwind's
utilities live in `@layer utilities` — so it beat `.absolute` on any element wearing both,
silently dropping it back into normal flow. That is what caused, and is now fixed by
guarding the declaration with `:not([class*='absolute'])` (substring, so `nav:absolute` and
`focus:absolute` opt out too):
- the Profile photo vanishing — its disc is `absolute … rounded-full bg-surface-tertiary`,
  so it collapsed to 0px tall, taking the image and the fallback glyph with it;
- the level badge and camera button stranded below the ring instead of overlaid on it;
- the card modal's close button appearing centred — it is coded `absolute right-[10px]`
  inside a `justify-center` flex header, so going static let the flex centre it. The user
  read this as a design flaw ("it's in the center and I don't like it"); it was this bug;
- the Pokédex `LVL n` tile badges and CardTile quantity badges leaving their corners.
`position: relative` only ever existed to give a STATIC element a containing block; an
already-positioned element has one and must not be overridden. **Keep the guard.**

**Design-system ledger:** `routes/design/pending.ts` listed C6–C13 as outstanding when all
eight had in fact landed and been adopted (verified per call site), and `completionStats()`
hardcoded `done = 5` against a denominator of only the unfinished items — hence the
nonsensical "5/8" badge. Entries now carry a `status` and stay in the file, so the tab is a
ledger of what the system covers and the meter is derived: **13/13**. Three of the four
off-theme values are promoted; the spacing scale stays explicitly `out-of-scope` (plan §8.2)
rather than posing as debt in progress.

**Deferred, needs its own branch:** deck records scoped to VARIANT rather than card. The
user's stated requirement is that "2 Normal + 1 Reverse Holofoil" be two deck entries and
that the modal's tab show exactly the variants present. `deck_card` is keyed
`PRIMARY KEY (deck_id, card_id)` with an explicit "deck lists are variant-agnostic" comment;
`owned` already SUMs across all variants and `price` is a `LATERAL … is_primary LIMIT 1`
estimate. Reaching the user's model is a migration + backfill, the version-snapshot format
(and the History diff that reads it), five `deck_card` write sites, PTCG-Live/PDF/mass-entry
export aggregation, the MCP deck tools, and a variant picker in the add-card flow — see
`roadmap/plans/variant-scoped-decks.md`. The new tab already renders its entries as a LIST
for this reason, so the migration supplies more rows rather than reshaping the component.

**Follow-up, same day — the back plate was rebuilt.** The first attempt used
`clip-path` for the bevel and inset box-shadows for the stamp. The user rejected it:
the shadow "cuts off the shadow on the corners", "doesn't follow that curvature",
"shows up just on that left side", and "makes the tip feel square instead of rounded".
All correct, and all the same cause — an inset shadow is painted in the border box and
clipped afterwards, so along a clipped bevel it does not exist. Splitting it into a
rounded box plus a nose SVG failed too: two shapes have two outlines, so the edge bands
either seam at the junction or, on a 12×28 nose, a band heavy enough to match the body
floods the triangle solid.

The shipped build is ONE measured SVG path for the whole silhouette (rounded point,
rounded shoulders, rounded right corners), with the stamp drawn as two copies of that
same path nudged ±y and clipped back inside it. Width comes from a ResizeObserver, not
`preserveAspectRatio="none"` — stretching a viewBox would make the point shallower on
long labels and turn the corner arcs into ellipses. The face is `transparent`: the
surface shows through, texture included, which is what "the same colour as the surface"
actually means and what a solid fill could not deliver once the skin began painting a
textured background.

