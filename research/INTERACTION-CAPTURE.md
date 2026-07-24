# INTERACTION-CAPTURE.md — pkmn.gg live interaction pass

> Second capture pass over **pkmn.gg**, run **signed out**, in one Chromium/Playwright session at a
> time. This pass targets everything `UI-SPEC.md` marked **U** (undetermined): interaction states,
> motion, overlays, the Table/Binder views, the card-detail Price tab, intermediate breakpoints, and
> the collapsed sidebar / mobile drawer.
>
> Method note that matters: the first pass read the `transition` **shorthand** and got `"all"`.
> This pass read the **longhands** (`transitionProperty` / `-Duration` / `-TimingFunction` /
> `-Delay`) on every element on the page, *and* walked the CSSOM to enumerate every `:hover`,
> `:focus`, `:focus-visible` and `:active` rule in every loaded stylesheet. The CSSOM walk is the
> authoritative method here — `react-native-unistyles` does emit real `:hover` rules into the
> stylesheet, so the enumeration is complete for a given page's loaded CSS chunks.
>
> **No pkmn.gg code, CSS text, or bundles were copied.** Compiled `unistyles_*` / `styles_*` hashes
> appear below only where they were used as capture selectors, and are worthless as implementation.

## Artifacts

| Path | Contents |
|---|---|
| `pkmn-gg/interactions/screens/*.png` | 88 screenshots (state crops, view switcher, binder, price chart, breakpoints, drawer, loading) |
| `pkmn-gg/interactions/data/_probe.json` | First-pass CSSOM/computed-style probe of the set page |
| `pkmn-gg/interactions/data/01-setpage-states-and-views.json` | Motion inventory + 19 default/hover/active/focus diffs + view-switcher geometry |
| `pkmn-gg/interactions/data/02-breakpoints-sidebar-binder.json` | 60-width breakpoint sweep + binary-refined boundaries, sidebar collapse, binder pocket layouts |
| `pkmn-gg/interactions/data/03-carddetail-overlays-mobile-binder.json` | Card-detail tabs, deck-builder motion, mobile drawer, clean binder geometry, icon-level hover |
| `pkmn-gg/interactions/data/04-pricechart-binder2-drawer-loading.json` | Price-chart anatomy + canvas pixel sampling, drawer scrim, loading, 768/1024 shots |
| `pkmn-gg/interactions/data/05-filterbar-table-binder3-priceui.json` | Exact filter-bar / sort-chip / view-toggle metrics, Table view, 12-/16-pocket, price-chart controls |

Pages touched (all public, signed out): `/series/scarlet-violet/151`,
`/series/scarlet-violet/151/006`, `/series/scarlet-violet/151/001`, `/search/advanced`,
`/trydeckbuilder`, `/`. Navigation was throttled to roughly one page load every 2–3 s.

---

## 1. Motion — measured

**The site is almost motionless.** Across the set page, card-detail page and deck builder, only
**four** distinct transition declarations and **one** keyframe animation exist on rendered elements.

| Where | `transition-property` | Duration | Timing function | Delay |
|---|---|---|---|---|
| Every `<button>` (header auth, binder pager `Next`, …) | `background-color` | **0.15s** | **`ease`** | 0s |
| Advanced-filters accordion; deck-builder bottom dock | `height` | **0.2s** | **`ease`** | 0s |
| Deck-builder select controls (Tailwind-styled, 9 elements) | `color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter` | **0.15s** | **`cubic-bezier(0.4, 0, 0.2, 1)`** | 0s |
| Everything else | `all` | **0s** | `ease` | 0s |

| Animation | Duration | Timing | Iterations | Delay | Fill |
|---|---|---|---|---|---|
| `AdvancedSearch_fade-in` (deck-builder filter panel, `opacity 0 → 1`) | **0.2s** | `ease` | 1 | **0.3s** | `forwards` |

Keyframe definitions present in the stylesheets (many unused on the pages captured):
`layout_placeholderCardLoading` (`left: -100% → 100%` — a sweeping shimmer for card skeletons),
`marching-ants` (background-position march), `nprogress-spinner` (`rotate(0 → 360deg)`), and six
`react-native-web` generics (`rotate 0→360`, `translateY 0→100%`, `translateY 100%→0`,
`translateX -100% → 400%`, `opacity 0→1`, `opacity 1→0`).

**So: pkmn.gg's real motion scale is two durations — `150ms` and `200ms` — both on `ease`,
plus one `cubic-bezier(0.4, 0, 0.2, 1)` that is Tailwind's stock curve, not a design decision.**
There is no card lift, no page transition, no drawer slide, no modal entrance.

## 2. Interaction states — measured (mostly "no change")

Every `:hover` / `:focus` / `:focus-visible` / `:active` rule in the set page's loaded CSS,
enumerated from the CSSOM: **21 hover rules, 8 focus rules, 3 focus-visible rules, 0 active rules.**

Then verified by real `page.hover()` / mouse-down / Tab-walk with a before/after computed-style diff:

| Element | Hover | Active (mouse down) | Keyboard focus |
|---|---|---|---|
| **Card tile (whole)** | **no change measured** | **no change measured** | not focusable |
| **Card image** | **no change measured** | **no change measured** | — |
| Card name link (`<a>`) | **no change measured** | **no change measured** | UA default ring only (`outline: auto 1px`); `:focus-visible` matches |
| Sort chip (active + inactive) | box: **no change**. Caret icons: `--icon-color #484F60` → `--icon-hover-color #60687B` when the pointer is over the caret itself | **no change** | not focusable |
| View toggle (Grid/Table/Binder) | **no change measured** | **no change measured** | not focusable |
| Sidebar nav item (inactive) | bg `#15181F` → `#1F232D`; label `#7F8596` → `#FFFFFF`; **icon unchanged** (its `--icon-hover-color` is set to `#7F8596`, identical to resting) | same as hover | not focusable |
| Sidebar nav item (already active) | **no change** (already at `#1F232D`) | **no change** | — |
| Sidebar collapse chevron | **no change measured** — rule exists (`color: var(--icon-hover-color)`) but the instance sets `--icon-hover-color: #7F8596`, equal to resting | — | not focusable |
| Header **Log In** button | bg `#282D38` → `#3B3F4B` (`--action-default-hover`), over `0.15s ease` | same colour as hover | UA default ring; site sets `outline: none` on some button classes |
| Header **Sign Up** button | bg `#FFD54A` → `#E6CA5B` (`--action-primary-hover`), over `0.15s ease` | same colour as hover | UA default ring |
| Search inputs (header + set page) | **no change** | **no change** | **no visible focus style at all** — `:focus { outline: none }` |
| "Shop" / "Purchase Set" buttons | **no change measured** | **no change measured** | — |

Additional hover rules found in the CSSOM that were not individually actuated:
`.styles_imgWrapper…:hover div { display: block }` and
`.styles_collectionCounter…:hover div:nth-child(3) { display: block }` — reveal-on-hover tooltips,
and one `:hover { display: flex }` reveal. Plus the generic icon system:
`[data-svg-icon]:hover { color: var(--icon-hover-color) }` and a **two-layer** variant that
cross-swaps `visibility` between `[data-svg-icon-layer="resting"]` and `…="hover"` — including
an ancestor form so hovering a link/button swaps its child icons.

**`:active` has zero rules site-wide. There is no pressed state.**

**Focus is effectively unstyled**: three `:focus-visible` rules and several `:focus` rules exist and
all of them *remove* the outline. Where a ring appears it is the Chromium UA default. Confidence:
measured on the set page's CSS chunk; other routes were spot-checked and behaved the same.

> **Implication for pokedex:** we are inheriting a design with essentially no interaction feedback
> and no accessible focus indicator. Reproducing that faithfully would be a regression. Recommend we
> keep pkmn.gg's *colour* deltas (they are tokenised and real) and *add* a focus ring + card-tile
> hover of our own, flagged as ours.

## 3. Overlays — what actually exists

There is **no modal, dialog, or bottom sheet anywhere reachable signed out.** Everything that looked
like it might open one is a route change or an inline accordion:

| Affordance | What it actually does |
|---|---|
| Header "advanced search" sliders icon | **Navigates** to `/search/advanced` (a full page). No popover. |
| Deck-builder "Advanced Filters ⌄" | Inline accordion on the filter panel — `height 0.2s ease`, plus `AdvancedSearch_fade-in` `0.2s ease 0.3s forwards` on the revealed content. Not an overlay. |
| Binder "Additional Variants" select | An in-flow select; its open list is a positioned panel, **no scrim, no backdrop-filter, no shadow measured**. |
| Card-detail copy-link icon | No toast rendered in the capture (`0` fixed high-z elements after the click). |
| Mobile nav | Drawer, see §7. No scrim element — see below. |

The only elements with `backdrop-filter` on any captured page remain the ones the first pass found;
none of them belong to a dialog. `--overlay-scrim-strong` **is** used — but for the binder's empty
pockets (§5), not for a modal.

**Conclusion: `UI-SPEC.md` §3.13's modal/sheet spec stays an `I` proposal. There is nothing to
measure it against.** That is now a *confirmed absence* rather than an unexplored gap.

## 4. View switcher — all three views rendered

`views-grid`, `views-table`, `views-binder` are all functional signed out on a public set page.

**Grid** — as already specified. 4 × 207.81 at 1440, `column-gap: 53px`, `row-gap: 30px`.

**Table** — no `<table>` element; a flex column of per-card groups. Each group is:
a full-width (990.25px) header bar carrying the card's own artwork bleeding in from the left
(~48px crop) + card name (14px/500 `--text-primary`) + card number; then **one row per variant**
below it: variant name (14px semi-bold white) over a ~10px `--text-muted` sub-label
("Found in Booster Packs", "Best Buy 151 Stamp", …), the price in `--change-positive`, and a
TCGplayer mark + external-link icon. Row pitch ≈48px, no rules or zebra striping, group gap 20px.
Signed out there is **no Quantity column** — the first pass's `Variant | Market Price | Quantity`
header belongs to the card-detail variant table, not this view.

**Binder** — see §5. Renders fully, but page 2+ is Pro-gated.

## 5. Binder view — the signature feature, measured

Rendered signed out at 1440 with the sidebar expanded. Pro gate is a single line of copy under the
pager ("Unlock Binder View with `PRO`", 14px/650 `--text-primary`, full content width); the binder
itself is **not** blurred or scrimmed — only page 1 is reachable (clicking `Next` does not change
the cards).

**Pocket-layout switcher** — four options as a text-tab row above the binder, 24px apart:
`9-Pocket · 12-Pocket · 4-Pocket · 16-Pocket`. Active = 14px/**650** `--text-primary` with a
**2px `#FFD54A` bottom border**, `padding: 0 0 3px`; inactive = 14px/500 `--text-muted`.

**Two-page spread (9-Pocket and 4-Pocket only).** Left and right page panels sit side by side and
together fill the 990.25px content column exactly, with a ~5px gutter between them.

| | 9-Pocket | 4-Pocket | 12-Pocket | 16-Pocket |
|---|---|---|---|---|
| Pages shown | 2 (spread) | 2 (spread) | **1** | **1** |
| Grid | 3 × 3 | 2 × 2 | 4 × 3 | 4 × 4 |
| Page panel @1440 | 492.63 × 689.77 | 492.63 × 677.67 | 990.25 wide | 990.25 wide |
| Pocket cell | 132.53 × 203.25 | 207.31 × 309.83 | 211.50 × 312.55 | 211.50 × 311.35 |
| `column-gap` / `row-gap` | 17 / 22 | 17 / 22 | 10 / 15 | 10 / 15 |
| Page padding | `18px 17px 18px 44px` (right page; mirrored on the left) | same | `12px` | `12px` |
| Page radius | 16px | 16px | 16px | 16px |
| Page background | `--surface-primary` `#15181F` | same | same | same |
| Page `box-shadow` | `none` | `none` | `none` | `none` |

- The **44px** side of the page padding is always the **spine** edge, 17px the outer edge, 18px top
  and bottom. That asymmetry is what makes the spread read as a physical binder.
- **Card image inside a pocket fills the cell width exactly** (132.53 of 132.53) at
  `aspect-ratio: 300 / 418` and `border-radius: 8px`; the cell is ~18px taller than the image.
- **Left page of a fresh 9-Pocket binder has zero pockets** — it is a blank inside-cover panel.
  Slots start on the right page.
- **Empty / not-owned pocket treatment (measured):** the card's own artwork is rendered, then
  covered by an absolutely-positioned scrim of **`rgba(21, 24, 31, 0.75)`** — exactly the
  `--overlay-scrim-strong` token — with **`border-radius: 6px`**, `z-index: 1`; a
  "Slot" / "#N" label block (`z-index: 2`, ~58px tall, centred) sits on top.
- **Pager:** right-aligned under the right-hand page, in a 492.63 × 88.13 row. `Page 1` label
  14px/700 `--text-muted`; `Next` button 81.45 × 50, `--surface-tertiary` `#282D38` fill,
  `--text-secondary` `#989EB3` label 14px/700, radius 8, `padding: 15px`, `gap: 8px`,
  `transition: background-color 0.15s ease`. **No `Previous` control on page 1.**
- **`Stack Variants:` control** — label 14px/600 `--text-primary`, followed by a **38 × 22** toggle
  switch (same geometry as the primitives-gallery toggle), on-fill violet.
- **`Additional Variants` select** — a `Hide` / `Inline` / `End` select to the right, with the
  caption "Additional Variants" beneath it.
- **@390 the spread collapses to a single page**, still 3 pockets across for 9-Pocket, card image
  104.92 × 146.67; the `Binder_sectionBackground` page panels are not present at that width.
- Controls reflow at 12-/16-Pocket: `Stack Variants` moves above the select instead of beside it.

## 6. Card detail — tabs and the price chart

**Tab strip (measured, corrects the first pass):** container 564.16 × 30, `display: flex`,
`gap: 32px`. Tab: `padding: 0 0 8px`, `cursor: pointer`, inner icon/label gap 5px.
Active = 14px/**600** `--text-primary` with a **1px** (not 2px) `#FFD54A` bottom border.
Inactive = 14px/500 `--text-muted`, no border.

| Tab | Content signed out |
|---|---|
| **Card** | Default; attacks, attributes, variant table |
| **Price** | The chart — see below |
| **TCG** | Format legality list — `Standard: Not Legal · Expanded: Legal · Gym Leader Challenge: Not Legal · Unlimited: Legal` — then an **"Other Versions"** list (same card in other sets: art thumb + name + price + number) |
| **Private Notes** `PRO` | Pro upsell card: title + explanatory copy + "Unlock With Pro" button |
| **Graded** `PRO` | Pro upsell card: "Add a Graded Card" (PSA/BGS/SGC/CGC) + "Unlock With Pro" |

### Price-history chart (measured)

- **Renderer:** a single `<canvas>`, **564 × 300 CSS px, backing store 564 × 300** (no DPR
  scaling). Not SVG, not Recharts, not a `<svg>` chart. Everything — axes, gridlines, legend,
  tooltip — is painted into the canvas.
- **Range selector:** a segmented control, track **300 × 41** with `border-radius: 8px`,
  four equal segments **74.75 × 39** with `padding: 0 12px`.
  Active = `--action-primary` `#FFD54A` fill, label **12px/700** `--action-primary-text` `#1F232D`.
  Inactive = `--surface-tertiary` `#282D38` fill, label **12px/600** `--text-secondary` `#989EB3`.
  End segments carry the directional radii `8px 0 0 8px` and `0 8px 8px 0` the first pass saw in the
  radius histogram. Options: `30 Days · 3 Months · 6 Months · 1 Year`.
- **Series:** one smooth (spline) line per variant, ~2px, no area fill, no resting point markers.
  **Series colour = the variant accent**, confirmed by canvas pixel sampling and the legend swatches:
  Normal `#FFE165` · Reverse Holofoil `#32B5FF` · **Holofoil `#9B6BFF`** · Stamp / other `#A8AEBD`.
  `#A8AEBD` is a *new* colour, not in the 77-token set.
- **Gridlines:** both horizontal and vertical, 1px, `--surface-tertiary` `#282D38` (the single most
  common colour in the canvas — 5 958 px of 169 200).
- **Axes:** y-axis labels on the left, currency-formatted at even steps (`$7.00 … $10.00` by $0.50 at
  30 days; `$0.00 … $70.00` by $10 at 1 year); x-axis date labels `M/D`, **rotated ~-30°** when
  dense. Both in a muted grey (`#A8AEBD` family), ~10px.
- **Legend:** inline row at the top-right *inside* the plot: **4 × 4 px square swatch** (no radius)
  + label 10px/550 `--text-primary`.
- **Tooltip (canvas-drawn):** rounded dark panel filled **`rgba(0, 0, 0, 0.8)`**, anchored beside
  the hovered x. Line 1 = the full date, bold white ("July 06, 2026"). Line 2 = swatch +
  `"<Variant> Market Price: $8.78"`. A filled point marker in the series colour appears on the line
  at the hovered x. There is **no DOM tooltip element** — 0 candidates found.
- **Per-variant blocks below the chart**, one per variant, 122px apart:
  swatch + variant name (10px/550 white), then two stat cards side by side —
  **194.08 × 72**, `--surface-tertiary` `#282D38`, `border-radius: 8px`, `padding: 12px 16px`;
  label 12px/600 `--text-secondary`, a 10px/450 range chip (`30 Days`) right-aligned on the same
  line, and the value below with a ▲/▼ caret: `--change-positive` green when up, warm orange when
  down. A TCGplayer button sits at the right of each block.
- **Empty / insufficient-data state was NOT observed** — every card and every range tried returned a
  populated series. Still **U**.

## 7. Sidebar collapse & mobile drawer — measured

**Collapsed sidebar (desktop):** clicking the `nav-collapse-left` chevron collapses the rail from
**274px + 1px border** to **81px + 1px border (82px total)**. Nav items keep their 56px height and
become icon-only: `padding: 0`, `justify-content: center`, 24px icon centred at x = 40.5.
Labels are removed from layout (text still present in the DOM). The active item keeps its
full-bleed `--surface-secondary` background. The chevron flips to `styles_navExpand`.
**No transition** — the change is instant.
Content column recalculates to `85% × (1440 − 82) = 1154.30px` starting at x = 183.84 — i.e. the
same 85 %-of-main rule, just against a wider main.

**Mobile nav drawer @390:** panel `MobileNavigation_container`, `position: fixed`,
**275px wide × 744 tall at y = 100** (immediately below the 99px header + 1px border),
background `--surface-primary` `#15181F`, `z-index: 10`.
**There is no scrim element.** The dimming is done by setting the *page content wrapper* to
**`opacity: 0.2`**. `<body>` gets `overflow: hidden`.
**No transition and no animation on the panel** — it appears instantly.
Drawer contents top-down: `Log In` / `Sign Up` pills (**117 × 48**, `border-radius: 300px`,
14px/600, `--action-default` and `--action-primary`) at y = 120, then the ten nav items at
275 × 56 each. The burger glyph swaps to `ui-x`.

## 8. Breakpoint ladder — measured, and it is not a ladder

A 60-width sweep from 360 → 1920 (32px steps, then binary-refined to 1px) on the set page.

**There is exactly one true layout breakpoint: `1068px`.**
At `≤1067` the sidebar is hidden and a hamburger shows; at `≥1068` the 274px sidebar renders and the
hamburger disappears. This matches a `(min-width: 1068px)` media query present in the stylesheet.

There is a second, gap-only threshold at **`567px`**: below it the card grid uses a **23px** column
gap, at and above it **53px**. (Media queries `(max-width: 566px)` / `(min-width: 567px)` exist.)

**Everything else about the card grid is fluid, not breakpointed.** The measured behaviour is:

- content column = **92 % of the viewport** when the sidebar is hidden; **85 % of the main column**
  (i.e. 85 % of `viewport − sidebar`) when it is shown. Gutters are always proportional.
- column count = as many tiles as fit at a **minimum tile width of 200px** (≥567) or **~150px**
  (<567), with a **maximum tile width of 300px** — beyond that the surplus goes into the gap.
- column gap is a **fixed 53px** (≥567) / **23px** (<567) except when the 300px cap kicks in.
- row gap is a fixed **30px**.

Measured column-count bands on the set page (`—` = same gap as the row above):

| Viewport range | Sidebar | Card cols | Tile width | Col gap | Content width |
|---|---|---|---|---|---|
| 360 – 539 | hidden | 2 | 154 → 228 | 23 | 92 % of vw |
| 540 – 566 | hidden | 3 | ~154 | 23 | — |
| 567 – 767 | hidden | 2 | 238 → **300 (capped)** | 53 → 69 | — |
| **768** | hidden | **3** | 200.17 | 53 | 706.55 |
| 768 – 1042 | hidden | 3 | 200 → 281 | 53 | — |
| 1043 – 1067 | hidden | 4 | ~205 | 53 | — |
| **1068** | **shown** | **2** | 300 (capped) | 75.8 | 698.69 |
| 1069 – 1105 | shown | 2 | 300 | — | — |
| 1106 – 1403 | shown | 3 | 206 → 279 | 53 | — |
| **1024** | hidden | **3** | 278.69 | 53 | **942.08** |
| **1440** | shown | **4** | 207.81 | 53 | **990.25** |
| 1404 – 1700 | shown | 4 | 203 → 257 | 53 | — |
| **1920** | shown | **5** | 237.25 | 53 | **1398.25** |

(390 for reference: 2 cols, tile 167.89, gap 23, content 358.80, gutter 15.59 = 4 % each side.)

Other viewports: home `<h1>` is **45px / 55px** at both 768 and 1024 (vs 72/84 at 1440);
card-detail is single-column with a 450px hero image at both 768 and 1024.

## 9. Loading / skeleton

Under a throttled connection the **initial page load is a full-viewport brand splash**, not a
skeleton: `--surface-secondary` `#1F232D` field with the centred `pkmn.gg` wordmark, plus the
`loading-logo` `.webm` (`64 × 64`, `autoplay loop`) that the first pass found in the DOM.
No `nprogress` bar rendered. Card skeletons (`layout_placeholderCardLoading`, a `left: -100% → 100%`
sweep) exist in the stylesheet but did not render during the captured loads — they are presumably
for in-app data fetches after first paint.

## 10. Blocked / still undetermined

**Blocked behind auth (not attempted — no login, no account created):**

1. Binder **page 2 and beyond** (`Next` is Pro-gated). Also the `Previous` control, which never
   appears on page 1.
2. **Private Notes** and **Graded** tab bodies (Pro upsell only).
3. Profile sort/filter chips (Pro-gated, blurred — already noted in the first pass).
4. Every signed-in affordance: owned-status badges, the quantity stepper, Pokédex caught/shiny tile
   states, trainer-level bar, list/deck creation, collection value over time.

**Still `U` after this pass:**

5. **Price-chart empty / insufficient-data state.** Every card × every range returned data.
6. **Modal / dialog / bottom sheet.** Confirmed *not to exist* anywhere reachable signed out —
   so `UI-SPEC.md` §3.13 remains our invention, now with the knowledge that we are inventing rather
   than failing to find.
7. **Toast.** The copy-link button raised no toast in the capture; the primitives-gallery toast is
   still the only evidence.
8. **Icon SVG geometry / stroke weights.** Icons render through a `<svg-icon>` custom element whose
   geometry was not extracted (and would be their asset anyway).
9. **The active view-toggle icon's recolour mechanism.** The active item's icon renders yellow in
   every screenshot, but the wrapper's `color` stays `#7F8596` and no `--icon-color` is set — the
   recolour happens inside their icon component. Effect is measured; mechanism is not.
