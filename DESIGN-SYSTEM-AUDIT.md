# DeckPal Design-System Audit

**Purpose:** map the terrain for an in-app, live, agent-mediated design-system editor
(design tokens editable at the top, UI primitives cataloged, repeated components
cataloged and editable, componentization gaps closed). This document is read-only
research — it does not propose the editor's design. Written against the
`design-system` worktree, branch off `main`, 2026-08-11.

**How this was produced:** every file cited below was read in full (not sampled via
excerpt), plus supporting docs (`AGENTS.md`, the project wiki's `UI-Spec.md`,
`research/ROUTE-MAP.md`, `research/BEHAVIOR-SPEC.md`, `DECISIONS.md`). Route coverage:
all 22 top-level route files plus `routes/auth/*`, `routes/deck/*`. Component coverage:
all 23 files in `apps/web/src/components/`. Quantitative claims (hex-literal counts,
spinner counts, token counts) are grep-verified against the current worktree, not
estimated.

---

## 1. Design tokens — full inventory

### 1.1 Source of truth

**One file, one mechanism.** `apps/web/src/theme.css` is authoritative. It is Tailwind
**v4**, CSS-first: an `@theme static { ... }` block declares every color/radius/
shadow/typography/breakpoint token as a CSS custom property, which Tailwind's Vite
plugin (`@tailwindcss/vite`) turns directly into utility classes (`bg-surface-primary`,
`text-text-muted`, `rounded-lg`, etc.). **There is no `tailwind.config.js` anywhere in
the repo** — confirmed by `find` returning nothing, consistent with the CSS-first
config Tailwind v4 introduced. `static` in `@theme static` is deliberate (see the
file's own comment): it forces every token to emit a real utility class even if
nothing in the app currently references it, which matters for an editor that wants to
enumerate "every token" rather than only ones already in use.

A second, much smaller block of tokens — z-index layers — is declared as **plain CSS
custom properties** on a bare `:root { }`, *outside* `@theme`, because Tailwind has no
first-class z-index token concept:

```css
/* z-index layers — plain custom properties */
:root {
  --z-art: -1;
  --z-base: 0;
  --z-raised: 5;
  --z-sticky: 8;
  --z-overlay: 10;
  --z-popover: 13;
  --z-chrome: 20;
  --z-modal: 100;
  --z-toast: 9999;
}
```

These are consumed as raw `z-[20]` / `z-[100]` Tailwind arbitrary-value utilities
throughout the app (never as a `z-chrome` class), since Tailwind doesn't map `:root`
custom properties outside `@theme` to utilities automatically — worth knowing if an
editor wants "click a token, see every usage" for this category specifically.

Representative excerpt of the `@theme` block itself (colors section, verbatim):

```css
@theme static {
  /* ── surfaces ─────────────────────────────────────────────── */
  --color-surface-primary: #15181f;
  --color-surface-secondary: #1f232d;
  --color-surface-tertiary: #282d38;
  --color-surface-tertiary-subtle: rgb(44 48 59 / 0.2);
  --color-surface-tertiary-transparent: rgb(44 48 59 / 0.5);
  --color-surface-quaternary: #373d4c;
  --color-surface-raised: #3e4353;
  --color-surface-control-active: #484f60;
  --color-surface-profile-card: #282d38;
  --color-surface-on-light: #f7f9ff;
  --color-surface-on-light-border: #e0e4ef;
  --color-surface-on-light-text: #1f232d;
  --color-surface-footer: #1b1f27;
  ...
  --color-action-primary: #ffd54a;
  --color-action-primary-hover: #e6ca5b;
  ...
  --color-variant-normal: #ffe165; /* Normal */
  --color-variant-reverse-holo: #32b5ff; /* Reverse Holofoil */
  --color-variant-holofoil: #9b6bff; /* Holofoil */
  --color-variant-other: #a8aebd; /* Additional / special tier */

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px; /* DEFAULT */
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-full: 9999px;

  --shadow-elevated: 0 16px 24px rgb(0 0 0 / 0.25);
  --shadow-panel: 0 8px 12px rgb(0 0 0 / 0.25);
  --shadow-sticker: 4px 4px 4px 4px rgb(0 0 0 / 0.25);

  --font-sans: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;

  --text-base: 14px;
  --text-base--line-height: 21px;
  ...
  --ease-standard: ease;
  --breakpoint-gap: 567px;
  --breakpoint-nav: 1068px;
}
```

Note the pairing convention for type: every `--text-<size>` has a matching
`--text-<size>--line-height` — that's Tailwind v4's native mechanism for a font-size
utility to carry its own line-height (`text-base` applies both `font-size:14px` and
`line-height:21px` together). An editor that lets someone "change the base font size"
needs to either move both together or decide independently — worth flagging to the
planning phase now.

The font file itself is imported one line above the token block:
`@import '@fontsource-variable/inter/wght.css';` — the *only* font actually shipped is
Inter Variable; `--font-sans`'s fallback stack (`ui-sans-serif, system-ui, sans-serif`)
is unreachable in practice unless the variable-font `@import` fails.

### 1.2 Token categories and counts (grep-verified against `theme.css`)

| Category | Custom-property prefix | Count | Notes |
|---|---|---|---|
| Color roles | `--color-*` | **~79** distinct properties | Grouped by comment into 8 sub-families: surfaces, text/links, actions, status/feedback, borders/icons, brand/pro/promo, variant accents, (z-index is separate, see below). The project's own wiki spec (`UI-Spec.md`, written from the pre-build reference-product capture) documents **77** — the two extra are drift since that capture, not a discrepancy worth chasing. |
| Radii | `--radius-*` | 6 | sm/md/**lg (default)**/xl/2xl/full |
| Shadows | `--shadow-*` | 3 | elevated, panel, sticker — that's the entire elevation system, no more |
| Typography (size) | `--text-*` | 12 size steps | 3xs(9px) → 5xl(48px), each paired with its own `--text-*--line-height` (24 declarations total) |
| Typography (family) | `--font-*` | 1 | `--font-sans` only — no serif/mono token exists, though `font-mono` classes appear ~30× across the app as Tailwind's *built-in* (untokenized) monospace stack |
| Motion | `--ease-*` | 1 | `--ease-standard: ease` — the file's own comment says this is deliberate: *"UI-SPEC §1.9 — only these exist"*, i.e. the reference product was observed to use exactly one easing curve system-wide |
| Breakpoints | `--breakpoint-*` | 2 | `gap` (567px) and `nav` (1068px) — the file's comment: *"1068 is the ONE real one"* |
| Z-index layers | `--z-*` (plain `:root`, not `@theme`) | 9 | art(-1) → toast(9999), consumed via arbitrary-value utilities (`z-[20]`), not token-name utilities |
| **Spacing** | *(none)* | **0** | See §1.4 — there is no spacing token scale at all in this codebase. This is the single biggest gap for a "design tokens" editor to be aware of. |

### 1.3 Light/dark theming

**There is no light theme.** This is deliberate, documented, and load-bearing — do not
build toward one without reading this first:

- `theme.css`'s own header comment: *"Dark-only theming (UI-SPEC §2): pkmnDark is the
  only scheme shipped; the `data-theme="dark"` attribute on `<html>` is the
  machine-readable switch."*
- `apps/web/index.html` hardcodes both signals on the root element:
  `<html lang="en" class="pkmnDark" data-theme="dark">`, plus
  `<meta name="color-scheme" content="dark">` and `theme-color` set to the exact
  `--color-surface-primary` hex.
- The project's wiki `UI-Spec.md` (§2, written from studying the reference product
  pkmn.gg pre-build) is explicit that pkmn.gg itself ships no light theme either, but
  is architecturally *provisioned* for one (asset paths reserve a `/dark/` segment,
  there's a `pkmnDark` class implying a sibling class exists). The wiki's own
  recommendation for DeckPal, if a light scheme is ever added: key it off
  `data-theme="dark"|"light"` on `<html>`, define tokens per-scheme under
  `@media (prefers-color-scheme: dark)` as the default with `:root[data-theme="..."]`
  overriding both directions — but explicitly says *"ship dark-only for v1... building
  one speculatively is wasted effort."* That recommendation was followed; nothing
  beyond the `--color-surface-on-light-*` trio (three tokens standing in for
  "a real-world white object rendered on a dark theme" — the sign-in card, the white
  set-symbol tile, the Google OAuth button) exists.

**Implication for the editor:** "live theme switching" is not a feature this app has
today in any form — an in-app color-token editor is inherently single-palette unless
the planning phase decides to build the dark/light seam described above from scratch.

### 1.4 No spacing token scale exists

This deserves its own subsection because the task's framing ("spacing scale" as an
expected token category) doesn't hold here. Grepped across every file in
`components/` and `routes/`: **2,441 occurrences** of arbitrary-pixel Tailwind spacing
utilities (`px-[16px]`, `gap-[12px]`, `h-[44px]`, `mt-[6px]`, …) versus a small
handful of Tailwind's *default*, non-tokenized numeric scale (`w-0`, `px-0`, a couple
of `w-8`/`h-8` on spinners) that read as incidental, not intentional design-system
usage. Every real spacing decision in this app — button heights, gaps, paddings — is a
literal pixel value picked per call site, not drawn from a shared scale. There is
no `--spacing-*` token in `theme.css` at all (Tailwind v4 has a default `--spacing`
multiplier token it derives its numeric scale from, but DeckPal never touches or
overrides it, and the app doesn't use the numeric scale it would drive).

**Implication:** unlike colors/radii/shadows/typography, "editable spacing tokens" is
not a matter of exposing existing tokens in a UI — it would mean *introducing* a
spacing scale into a codebase that has never had one, which is a materially bigger
lift than the other token categories and changes what "spacing token" even means for
this project (a retrofit, not a live edit).

### 1.5 Drift: raw values that should be tokens but aren't

Sampled broadly (all of `components/`, all 22 route files, `routes/auth/*`,
`routes/deck/*`) rather than exhaustively grepped file-by-file, then confirmed exact
occurrence counts with grep. This is common, not rare:

- **`#1a1d24` — an untokenized progress-bar-track color, independently hardcoded 7
  times across 6 files**, always for the same purpose (the thin rounded background
  track behind a completion/progress bar fill): `components/ProgressCluster.tsx`,
  `routes/ListDetail.tsx` (local `ListProgress`), `routes/SeriesIndex.tsx`
  (`CompletionRing`), `routes/SeriesDetail.tsx` (`SetRow`), `routes/Scan.tsx`
  (`MatchTile`'s confidence meter), `routes/ListsIndex.tsx` (local `ProgressBar`). Six
  separate authors (or the same author six separate times) picked the identical color
  for the identical purpose and never once wrote `var(--color-*)` — strong signal this
  should be a real token (e.g. `--color-track-subtle`).

- **`#ff9d42` — an entire missing semantic color role, 9 occurrences, concentrated in
  `routes/DeckBuilder.tsx`.** This is a "legality warning / caution" orange used for:
  the not-legal rule-violation panel border (`LegalityPanel`), the offending-card
  highlight background/ring (`DeckRow`, `DeckCardContext`), the mulligan-hand warning
  text (`TestHandModal`), the export-warnings panel border/background (`ExportModal`),
  and the missing-cards value figure (`BuyMissingModal`). Unlike `success`/`error`/
  `change-positive`/`change-negative`, **no `--color-warning`-class token exists in
  `theme.css` at all** — this whole semantic role was never promoted to the token
  layer, so every call site invented the same hex independently. Compounding this: a
  few other spots reach for Tailwind's *built-in* `amber-400` / `red-400` (e.g.
  `ExportModal`'s retry-error text, `PurchaseSetMenu`'s error text) for what reads as
  the same "warning" intent — so there are actually two competing, both
  non-token, ad hoc warning colors in play.

- **Colors that happen to equal a token's value but are hardcoded as literal hex
  instead of `var(--color-*)`:** `components/CardTile.tsx` and `components/
  TableView.tsx`'s duplicated `CounterBox` (§4) both write
  `color: dark ? '#15181f' : '#fff'` — `#15181f` is exactly `--color-surface-primary`,
  and `#fff` should be `--color-text-primary` (`#ffffff`). `routes/Profile.tsx`'s
  banner-placeholder gradient (`linear-gradient(160deg,#1f232d,#282d38)`) uses the
  exact hex values of `--color-surface-secondary` and `--color-surface-tertiary`
  rather than referencing them. `components/FilterControls.tsx`'s `SortChips` and its
  near-duplicate in `routes/SearchResults.tsx` both hardcode a 3-hex palette
  (`#15181f`, `#d3b745`, `#484f60`) for the ascending/descending sort-arrow glyphs —
  two of those three match tokens exactly (`surface-primary`, `surface-quaternary`);
  `#d3b745` does not correspond to any existing token (closest is
  `--color-action-primary` `#ffd54a`, but it's a distinctly muted/darker value, i.e. a
  genuinely new, unintentional color that only exists because someone typed a hex).

- **`components/EnergyIcon.tsx`'s 11 energy-type colors** (`#5fb85f` grass, `#e8703a`
  fire, `#4a97d6` water, `#f2c518` lightning, `#a45cb0` psychic, `#c06a3a` fighting,
  `#4b5566` darkness, `#8b95a6` metal, `#e58bb8` fairy, `#c6a23e` dragon, `#d6d2c6`
  colorless) are a real, load-bearing color palette used throughout card detail,
  battle logs, and the deck builder — but they live as an in-component JS object
  (`TYPES` record), not as design tokens, unlike the visually-similar
  `--color-variant-*` family (4 tokens) that *did* get promoted into `theme.css`. If
  "every color in the app" is meant to be editable from one surface, this 11-color
  palette is currently invisible to that surface.

- **Aggregate:** a blunt grep for hex-literal patterns (`#[0-9a-fA-F]{3,6}`) across
  every file in `components/` and `routes/` returns **74 matches**. Not all are drift
  (a few, like the Black-Star-Promo mark's `#111318`/`#ffffff` in `ui.tsx`, are
  deliberately-original artwork matching real card iconography, not app chrome, and a
  reasonable exception) — but the volume confirms this is a systemic pattern, not an
  isolated slip, and any design-token editor needs a plan for surfacing (or at least
  flagging) values like these that live outside `theme.css` entirely.

---

## 2. UI primitives — full inventory

**Where the line was drawn:** a primitive is generic and reusable with no knowledge of
DeckPal's domain (a card, a deck, a list, a species). A feature component knows
about at least one of those nouns. By that test, the primitive surface of this app is
much smaller than `components/`'s 23 files suggest — most of that directory is feature
components (§3). The real primitive count is also *higher* than `ui.tsx` alone,
because a second, load-bearing primitive module exists outside `components/`
altogether (see §2.4) — a fact the planning phase needs to know before assuming
`components/ui.tsx` is the whole story.

### 2.1 `apps/web/src/components/ui.tsx` (225 lines) — read in full

| Export | Renders | Prop surface |
|---|---|---|
| `Content` | The page-body wrapper: responsive gutters + a per-page max-width cap, centered | `children`, `cap?: number` (default 1165) |
| `assetUrl` | *(helper function, not a component)* — appends a file extension to a TCGdex asset URL if missing | `url`, `ext?` |
| `setAssetUrl` | *(helper function)* — builds a local set logo/symbol path served by the image cache | `setId`, `kind: 'logo' \| 'symbol'` |
| `BackPill` | A small pill-shaped "‹ Back to X" link, used at the top of every detail page | `to`, `params?`, `label` |
| `deriveSetTag` | *(helper function)* — derives a short acronym from a set id/name for the fallback tile | `setId?`, `name?` |
| `SetSymbolTile` | The white rounded tile that shows a set's symbol image, or (internally) a `PromoStarMark`/`EnergySymbolsMark` authored glyph for special-family sets, or a derived-acronym text fallback — a real 3-way fallback ladder, never a broken image | `setId?`, `hasSymbol?`, `name?`, `size?` |
| `Spinner` | A centered spin-ring + optional label, used as a page/section loading state | `label?` |
| `ErrorState` | A centered "Something went wrong" + message block | `message` |

`PromoStarMark` and `EnergySymbolsMark` are private (unexported) helper components used
only inside `SetSymbolTile` — genuinely internal, not part of the public primitive
surface.

**Notably absent from `ui.tsx`:** no `Button`, `IconButton`, `TextInput`, `Select`,
`Checkbox`, `Badge`/`Chip`, `Tabs`, `EmptyState`, `Toast`, or `Stepper` primitive
exists anywhere in `components/`. Every one of those concepts is reimplemented
per-call-site throughout the app — this is the direct cause of most of the
componentization gaps cataloged in §4.

### 2.2 `apps/web/src/components/Icon.tsx` (309 lines) — read in full

A hand-authored, from-scratch line-icon set — the file's own comment: *"no pkmn.gg
asset is lifted."* 24×24 viewBox, `stroke="currentColor"`, default `strokeWidth`
1.75. **42 icon names** in the `IconName` union: `cards, lists, deck, pokedex,
discord, merch, pro, search, sliders, grid, table, binder, chevron-down,
chevron-left, chevron-right, star-outline, star-filled, external, menu, close, link,
minus, plus, check, check-circle, alert, copy, shuffle, download, cart, chart, user,
gear, sparkle, camera, printer, bug, book, history, logout, mail, key`. The `Icon`
component itself takes `name`, `size` (default 24), `className`, `strokeWidth`
(default 1.75). The same file also exports `BrandMark` — the app's logo glyph, sourced
from a static PNG (`public/brand-icon.png`), not a vector icon.

### 2.3 `apps/web/src/components/EnergyIcon.tsx` (211 lines) — read in full

A second, self-contained icon-set primitive: 11 original Pokémon-TCG energy-type
glyphs (grass, fire, water, lightning, psychic, fighting, darkness, metal, fairy,
dragon, colorless), each a colored-disc SVG with a white symbol baked in. Also exports
`hasEnergyIcon(type)` and `ENERGY_TYPES` (the list of known keys), and gracefully
falls back to a neutral disc + first-letter glyph for an unrecognized type name — never
a broken icon. As flagged in §1.5, its 11 fill colors are a real palette that lives
entirely inside this component's JS, not in `theme.css`.

### 2.4 The "hidden" primitive module: `routes/auth/authUi.tsx` (230 lines)

This file lives under `routes/auth/`, not `components/` — but by the primitive/feature
test above, most of it *is* a primitive module, and a fairly complete one at that. It
was written explicitly to keep four auth-adjacent pages from drifting into four
slightly different golds/radii/focus-rings (its own header comment), and it succeeds
at that locally — but it is invisible from `components/`, and at least one of its
exports has already leaked into feature-component territory: `AgentAccess.tsx`
(a `components/` file, used from the Profile page) imports `Field` and `FormAlert`
from here directly, across the `routes/auth` → `components/` boundary. Full export
list:

| Export | What it is |
|---|---|
| `AuthPage` | Full-bleed page frame (backdrop, centered card slot) for every auth surface |
| `AuthCard` | The elevated card surface auth forms sit on |
| `Field` | A labeled `<input>` with error/hint text and `aria-invalid`/`aria-describedby` wiring — this **is** the closest thing this codebase has to a generic `TextInput` primitive, and it's not in `components/` |
| `SubmitButton` | A full-width primary submit button with a built-in loading spinner |
| `CTA_PRIMARY` / `CTA_GHOST` / `CTA_QUIET` | **Raw Tailwind className strings**, not components — see §4 for why this is itself evidence of a gap |
| `FormAlert` | An inline `role="alert"` banner, three tone variants (error/info/success) |
| `StatusPanel` | A terminal-state card: haloed icon + title + body + actions, used for "check your email" / "reset link sent" type screens |

### 2.5 Everything else in `components/` — feature components, not primitives

The remaining 20 files in `components/` all reference at least one domain noun (a
card, a deck, a list, a set, a species, a battle) or a specific cross-cutting app
concern (auth session, PWA install, bug reporting) and are cataloged as feature/shared
components in §3, not primitives.

---

## 3. Repeated / shared components — full inventory

Every file in `apps/web/src/components/` not already covered in §2, plus the
shared-but-not-`components/` files worth knowing about. "Used by" is illustrative
(confirmed via import, not exhaustively grepped for every transitive caller).

| File | What it does | Used by (confirmed) |
|---|---|---|
| `AppShell.tsx` (480 ln) | The whole authenticated chrome: fixed sidebar nav (desktop), header with search + scan shortcut + bug button + identity chip, mobile drawer, and the chromeless bypass for landing/auth routes | `main.tsx` (wraps every route) |
| `AuthGuard.tsx` (54 ln) | Session gate: blocks rendering until Supabase session resolves, redirects signed-out visitors | `main.tsx` |
| `Avatar.tsx` (286 ln) | `useAvatar`/`useAvatarEditor` hooks, `AvatarDisc` (photo-or-glyph), `AvatarSpinner` — the whole profile-photo read/upload/remove story | `AppShell`, `Profile`, `Insights` |
| `BinderView.tsx` (244 ln) | The pocketed-binder view mode (4/9/12/16-pocket layouts, owned/dim treatment) | `SetDetail`, `ListDetail` |
| `BugReport.tsx` (343 ln) | The in-app bug reporter: html2canvas-pro screenshot capture (with a same-origin image-inlining workaround, documented at length in-file) + comment form, posts to `/api/bugs` | `AppShell` (via `BugButton`) |
| `CardImage.tsx` (47 ln) | Fixed-aspect-ratio (245:337) card-art box with error-hide-to-skeleton behavior | `CardTile`, `CardDetail`, `Scan`, `Profile` |
| `CardTile.tsx` (347 ln) | The signature grid tile: art, owned-quantity badge, variant-count badge, and (feature-gated) per-variant counter boxes | `GridView`, indirectly every card-grid page |
| `FilterControls.tsx` (184 ln) | `OwnershipStrip`, `SearchBox`, `SortChips`, `VariantLegend`, `ViewToggle` — the set-page filter-bar building blocks | `SetDetail`; **not consistently reused** — see §4 |
| `GridView.tsx` (112 ln) | Virtualized, fluid-column card grid (window-virtualized rows) | `SetDetail`, `SpeciesDetail`, `SearchResults`, `ListDetail` |
| `LevelRing.tsx` (80 ln) | The segmented Trainer-Level ring (10 arcs, gold-filled by progress) | `Profile`, `Insights` |
| `ListModals.tsx` (276 ln) | `Modal` (the shared dialog shell), `ListFormModal`, `AddCardModal`, `ConfirmModal` | `ListDetail`, `ListsIndex`, `BugReport` (`Modal` only), `PurchaseSetMenu` (`Modal` only), `DeckBuilder`/`DecksIndex` (`Modal`/`ConfirmModal` only) |
| `ProgressCluster.tsx` (69 ln) | The two-bar set-completion cluster (Complete + Master/Grandmaster, milestone dots) | `SetHeader` |
| `PurchaseSetMenu.tsx` (261 ln) | The "Purchase Set" modal: TCGplayer Mass Entry link builder with goal/finish options | `SetHeader` |
| `PwaUi.tsx` (125 ln) | Install-prompt button, update-available toast, offline banner — the PWA affordance layer | `AppShell` |
| `SetHeader.tsx` (123 ln) | The set-detail page header: logo, shop/purchase/print actions, symbol, progress-or-sign-in-prompt, 6-stat strip | `SetDetail` |
| `SetLogo.tsx` (62 ln) | A set's logo image, with an on-light "plate" behind it for the minority of logos that don't read on the dark theme (contrast list is precomputed offline) | `SetHeader`, `SeriesIndex`, `SeriesDetail` |
| `SignInPrompt.tsx` (62 ln) | The "what would be here if you were signed in" slot-filler (inline or banner variant) | `SetHeader`, `SeriesIndex`, `PokedexIndex`, `SpeciesDetail` |
| `SpriteTile.tsx` (55 ln) | Fixed-geometry species-sprite box with captured/uncaptured dimming and a Poké-ball-outline placeholder on 404 | `PokedexIndex`, `SpeciesDetail` |
| `TableView.tsx` (223 ln) | The flex-row "table" view mode for card lists, including its own duplicated `CounterBox` (§4) | `SetDetail`, `ListDetail` |
| `ValueChart.tsx` (203 ln) | Hand-rolled SVG line chart (zero charting dependency, by design — see §5) for collection value over time | `Insights` |
| `AgentAccess.tsx` (477 ln) | The `/profile` "Connect an AI assistant" panel: personal-access-token CRUD + full MCP connection walkthrough | `Profile` |

Two more shared modules worth knowing about that live **outside** `components/`:

| File | What it does | Used by |
|---|---|---|
| `routes/deck/intelShared.tsx` (72 ln) | `VersionChip`, `SourceChip` (labels a change as web vs. `deckpal-mcp`-authored, with a sparkle glyph), `ResultBadge`, `RecordSpans` (win/loss/tie) — shared chips for the deck-intelligence sub-tabs | `StrategyTab`, `BattlesTab`, `HistoryTab` — and *should* be used by `DecksIndex.tsx`, which reimplements `RecordSpans`' markup instead (§4) |
| `routes/deck/MarkdownView.tsx` (52 ln) | Token-styled `react-markdown` renderer (lazy-loaded, its own bundle chunk) for deck strategy guides | `StrategyTab` |
| `routes/landing/Mockups.tsx` (762 ln) | Six illustrative "product mockup" components (`AgentMockup`, `BinderMockup`, `DeckMockup`, `ProgressMockup`, `ScanMockup`, `ValueMockup`) built from real tokens and the app's own visual idioms (per `DECISIONS.md`: *"DOM/CSS/SVG built from the design tokens and the app's own idioms... no Pokémon card art"*) rather than screenshots, specifically so they don't go stale or leak real data | `Landing.tsx` only |
| `routes/auth/authUi.tsx` | See §2.4 — genuinely a primitive module, catalogued there |

---

## 4. Componentization gaps

This is the actual backlog. Every entry below is a pattern duplicated or
near-duplicated across two or more files that has **not** been extracted into a shared
component, with concrete file/line citations. Grouped by kind, ordered roughly by how
much evidence backs each one.

### 4.1 No `Button` primitive — the single largest gap

There is no `Button` component anywhere in this codebase. Every button is a raw
`<button>` with an inline Tailwind className string, and the same 2-3 visual "kinds"
(primary pill, secondary/cancel pill, danger pill, ghost) are retyped by hand
dozens of times:

- **Primary pill** (`h-[44px] rounded-full bg-action-primary px-[24px] text-[14px]
  font-bold text-action-primary-text hover:bg-action-primary-hover disabled:
  opacity-50`) appears near-verbatim in `components/ListModals.tsx` (×2:
  `ListFormModal`, and the confirm button in `ConfirmModal` uses the danger variant),
  `components/BugReport.tsx`, `components/PurchaseSetMenu.tsx`, `routes/DecksIndex.tsx`
  (`NewDeckModal`, `ImportModal`), `routes/DeckBuilder.tsx` (`TestHandModal`,
  `ExportModal`).
- **Cancel/secondary pill** (`h-[44px] rounded-full bg-surface-tertiary px-[20px]
  text-[14px] font-semibold text-text-primary hover:bg-action-default-hover`) appears
  in the same files, same call sites, paired with the button above every time.
- The project's own `routes/auth/authUi.tsx` exports `CTA_PRIMARY` / `CTA_GHOST` /
  `CTA_QUIET` as **raw className strings**, not components — a de facto admission that
  a `Button` primitive was needed and the author reached for "a shared string
  constant" rather than "a shared component" as the available escape hatch.
- The project's own prior research anticipated exactly this: `research/BEHAVIOR-SPEC.md`
  §13.3, quoting the reference product's own (unlinked, internal)
  `dom/primitives-showcase.html` capture: *"`Button` — variants `default | primary |
  danger | ghost | dashed` × sizes `sm | md | lg` × `disabled`"* — i.e. the team already
  scoped what a `Button` primitive should look like before any of this app was built,
  and it was never implemented.

### 4.2 Spinners — at least 9 independent implementations

A grep for `animate-spin` across `components/` and `routes/` returns **9 files**, each
with its own hand-rolled `<div>`/`<span>` ring (`h-[Npx] w-[Npx] animate-spin
rounded-full border-2 border-{color} border-t-transparent`), with N and the color
varying slightly (16px/action-primary-text in `authUi.tsx`'s `SubmitButton`, 15px in
`AgentAccess.tsx`, 8px `border-2 border-action-primary` full-page variant in
`AuthGuard.tsx` and duplicated twice more in `Authorize.tsx`, plus `ui.tsx`'s `Spinner`,
`Avatar.tsx`'s `AvatarSpinner`, `Scan.tsx`'s inline scanning spinner,
`routes/auth/ResetPassword.tsx`, `routes/auth/ChangePassword.tsx`). None of these
compose `ui.tsx`'s own `Spinner` — they all reimplement the ring from scratch, usually
because they need it inline (next to text, inside a button) rather than as `Spinner`'s
centered block layout, which is itself a sign the primitive's API is too narrow, not
that a primitive isn't warranted.

### 4.3 `CounterBox` — byte-for-byte duplicated component, not just a pattern

`components/CardTile.tsx` (`CounterBox`, ~L26-104) and `components/TableView.tsx`
(`CounterBox`, ~L23-101) are the same component: identical props (`label, color, dark,
qty, disabled, onInc, onDec`), identical pointer-down/long-press/right-click handler
logic, identical className string, identical inline `style` branching (including the
`#15181f`/`#fff` hex drift noted in §1.5). This isn't "a similar pattern that could be
unified" — it's the same ~80 lines of code that exists twice in the repository today.

Deck-context quantity steppers are a *related but distinct* third and fourth
implementation: `routes/CardDetail.tsx`'s `QtyStepper` (colored ± buttons, disables
based on online status) and `routes/DeckBuilder.tsx`'s inline ± steppers in `DeckRow`
and `DeckCardContext` (simpler, uncolored, no long-press) are three more independently
authored "change a quantity" controls with no shared code among any of the four.

### 4.4 Progress bars — the `#1a1d24`-track pattern, 6 independent authorings

Already introduced quantitatively in §1.5; restated here as the componentization
angle. `components/ProgressCluster.tsx`, `routes/ListDetail.tsx`'s `ListProgress`,
`routes/SeriesIndex.tsx`'s `CompletionRing`, `routes/SeriesDetail.tsx`'s `SetRow`,
`routes/Scan.tsx`'s `MatchTile` confidence meter, and `routes/ListsIndex.tsx`'s local
`ProgressBar` all hand-roll "a thin rounded track + a gradient or solid fill" with no
shared component. `ProgressCluster` and `ListDetail`'s `ListProgress` are close enough
in shape (same 25/50/75 milestone-dot idiom, same gradient) that they're near-clones of
each other specifically, not just thematically related.

### 4.5 Ownership/sort filter strips reimplemented instead of reused

`components/FilterControls.tsx` already exports `OwnershipStrip` (Show All / Have /
Need / Dupes) and `SortChips` — and `SetDetail.tsx` correctly imports and uses both.
But:
- `routes/ListDetail.tsx` does **not** import `OwnershipStrip`; it hand-writes the same
  four buttons with matching active-state styling inline (~L313-330), and hand-writes
  its own sort-chip strip (~L296-309) instead of importing `SortChips`.
- `routes/SearchResults.tsx` reimplements `SortChips` near-verbatim, **including the
  exact same non-token hex triple** (`#15181f`/`#d3b745`/`#484f60`) for the
  ascending/descending arrow glyphs that `FilterControls.tsx`'s original already has —
  strong evidence this was copy-pasted rather than independently reinvented, then never
  reconciled back into one component.

### 4.6 Selectable-option cards — identical className, two files, no shared component

`routes/DecksIndex.tsx`'s `NewDeckModal` format picker (~L104-113) and
`components/ListModals.tsx`'s `ListFormModal` kind picker use the **exact same
className string** for their active/inactive selectable-card state:
`` `rounded-lg border-2 px-[12px] py-[10px] text-left ${active ? 'border-action-
primary bg-surface-tertiary' : 'border-transparent bg-surface-tertiary/50 hover:
bg-surface-tertiary'}` ``. Clear `SelectableCard` primitive candidate.

### 4.7 Empty states — duplicated, and matches a documented-but-unbuilt primitive

`routes/DecksIndex.tsx`'s "No Decks Yet" (~L236-249) and `routes/ListDetail.tsx`'s
"This list is empty" (~L351-357) are the same shape (icon + bold title + dashed
border, centered, optional CTA) independently written with different padding/icon
sizes. This is exactly the `EmptyStateMessage` primitive the project's own research
already documented and recommended building: `research/BEHAVIOR-SPEC.md` names it
directly, quoting the reference product's primitives-showcase capture, and says
*"Build the same primitive."* It still hasn't been.

### 4.8 Tab strips — at least 4 visually distinct hand-rolled idioms

No shared `Tabs` component exists, and the app doesn't even converge on one *visual*
tab idiom — at least four different treatments are hand-coded independently:
`routes/Profile.tsx`'s underline strip (~L263-279, `border-b-2 border-action-primary`),
`routes/Insights.tsx`'s pill segmented toggle (~L49-62, `rounded-full bg-surface-
secondary p-[4px]`, plus a second, separate pill toggle for currency at ~L141-154),
`routes/CardDetail.tsx`'s single-underline tab strip (~L398-412, `border-b
border-action-primary`, thinner than Profile's), and `routes/DeckBuilder.tsx`'s tab
strip (~L696-710) — whose own inline comment reads **`// tabs — Cards · Strategy ·
Battles (n) · History (CardDetail underline pattern)`**, i.e. the author explicitly
noted they were hand-copying the visual pattern from `CardDetail.tsx` by eye rather
than importing a shared component. That comment is first-party evidence of exactly the
gap this initiative exists to close.

### 4.9 Dismissable popover menus — duplicated outside-click/Escape boilerplate

`routes/PokedexIndex.tsx`'s `OwnFilterMenu` (~L147-219) and `routes/SeriesIndex.tsx`'s
`MobileControls` (~L223-270) both hand-write the identical `useEffect` outside-click +
Escape-key dismiss logic around an absolutely-positioned panel triggered by a button.
No shared `Popover` component or `useDismiss` hook exists.

### 4.10 Stat displays — three different concepts, two of them named `Stat`

`components/SetHeader.tsx` has a local `Stat` (label above value, no box). Unrelated,
`routes/Profile.tsx` defines its **own, differently-shaped** `Stat` (~L405-412, a
`rounded-lg bg-surface-tertiary` boxed tile) — same name, different component, no
relationship. `routes/Insights.tsx` hand-rolls a third, larger stat-card shape inline
(`rounded-2xl bg-surface-secondary p-[20px]`, ~L100-126) with no name at all. A
`StatTile` primitive with size/variant props would collapse all three.

### 4.11 Win/loss/tie record markup duplicated instead of imported

`routes/deck/intelShared.tsx` already exports `RecordSpans` for exactly this.
`routes/DecksIndex.tsx`'s `DeckCard` (~L52-64) reimplements the identical
`{wins}W–{losses}L(–{ties}T)` markup inline, with matching `var(--color-success)`/
`var(--color-error)` inline styles, instead of importing it — despite both files being
in the same feature area (decks).

### 4.12 Landing's CTA buttons and `authUi.tsx`'s `CTA_*` constants are parallel, not shared

`routes/Landing.tsx` defines its own local `PrimaryCta`, `BrowseCta`, `GhostCta`
components — well-componentized *within* Landing.tsx (a positive counter-example; see
§6). But `routes/auth/authUi.tsx`'s `CTA_PRIMARY`/`CTA_GHOST` constants (§2.4) are
explicitly described in that file's own header comment as reusing *"the landing's gold
CTA"* — yet they are a **separately maintained className string**, not an import of
Landing's `PrimaryCta`/`GhostCta` components. The two are meant by design intent to
look identical (`ls-cta` class is shared via `landing.css`) but are two independent
pieces of markup — exactly the kind of silent-drift risk a token/component editor is
supposed to catch, and a fix (extracting one real `Button`/`GhostButton` used by both
Landing and auth) is implied by §4.1 anyway.

---

## 5. Existing tooling check

- **No Storybook.** Not in root `package.json`, not in `apps/web/package.json`, not
  anywhere in the monorepo's other app `package.json` files.
- **No design-token build step** (no Style Dictionary or equivalent). Tokens are
  authored directly as the source of truth in `theme.css`; there is no
  generate/transform step between "author a token" and "it's live."
- **No existing style-guide/preview route.** Confirmed by reading `main.tsx`'s full
  route tree (20 routes, all product surfaces) and grepping `apps/web/src` for any
  `import.meta.env.DEV`-gated route — the only two `DEV`-gated call sites in the whole
  app are two `console.info` calls in `pwa.ts`, not a route.
- **But a `/primitives-showcase` route is already scoped in the project's own
  pre-build research**, unbuilt: `research/ROUTE-MAP.md` §1.1 lists it directly,
  quoting the reference product's own unlinked internal storybook page (*"Live gallery
  of `Button`, `IconButton`, `Checkbox`, `TextInput`, `Select`, `CardSkeleton`,
  `EmptyStateMessage`, `ErrorBoundary`, `SvgIcon`, `Toast`"*), with the explicit
  recommendation: **"Mirror 1:1. An unlinked internal route. Build the same page — it
  is the cheapest possible way to keep our design system honest against UI Spec."**
  This was written before a single line of `apps/web` existed and has sat unbuilt ever
  since. The planning phase should treat this as a validated precedent, including the
  route name (`/primitives-showcase`) and the target primitive list, most of which
  (`Button`, `IconButton`, `Checkbox`, `TextInput`, `Select`, `CardSkeleton`,
  `EmptyStateMessage`, `Toast`) are exactly the primitives §4 independently found
  missing by reading the actual current code.
- **Tailwind version: v4** (`4.3.3` in `apps/web/package.json`, via `@tailwindcss/vite`
  `4.3.3`). Confirmed CSS-first (no `tailwind.config.js`/`.ts`/`.cjs` anywhere in the
  repo; `@theme static { }` in `theme.css` is the only config surface). This matters
  concretely for "editable design tokens": every token is already a plain CSS custom
  property on `:root`/`@theme`, which means (a) a runtime editor could preview token
  changes by writing to `document.documentElement.style.setProperty(...)` with zero
  build step, and (b) persisting a change means editing `theme.css` text directly —
  there is no JS object/config file an editor would otherwise need to parse and
  round-trip. This is meaningfully simpler than a v3/JS-config setup would have been.

---

## 6. Constraints and observations for the planning phase

### 6.1 Build tooling

- **Vite 8**, running on **Rolldown** (the Rust-based bundler Vite 8 ships as
  default) — `vite.config.ts`'s own comment: *"tsc is intentionally kept out of the
  build path (Rolldown/Vite 8)."* Typechecking is a separate step
  (`tsc --noEmit`), not part of `vite build`. Any new dev-only route/tooling added for
  this initiative should not assume `tsc` errors block the dev server the way they
  might in a webpack/ts-loader setup.
- **Dev server runs on port 5199**, proxying `/deckpal/api` → the API dev server
  (port from `DECKPAL_DEV_API_PORT`, default `3700`) and `/deckpal/images` → the
  image service (port `3701`). The `DECKPAL_DEV_API_PORT` env var exists
  specifically so parallel git worktrees (like this one) can each run their own API
  instance without port collisions — worth knowing if the design-system editor's
  "send to agent" channel needs its own dev-only endpoint, since the port-per-worktree
  convention already exists and should probably be followed rather than hardcoding a
  port.
- **Base path differs by deployment mode**: `/` on cloud (when `VITE_SUPABASE_URL` is
  set), `/deckpal/` on self-host. The router's `basepath` in `main.tsx` matches this
  automatically (`import.meta.env.VITE_SUPABASE_URL ? '' : '/deckpal'`) — any new
  route added to the tree inherits this for free, no special-casing needed.
- **PWA / service worker**: the app is a PWA with `injectManifest` (hand-written
  `src/sw.ts`), precaching all route chunks. A new dev-only route would need to either
  be excluded from precaching or accepted into it; likely a non-issue if the route is
  gated to never ship in a production build, but worth flagging since the SW config
  isn't route-aware by default (`globPatterns: ['**/*.{js,css,html,woff2,svg,png}']`
  is blanket).

### 6.2 Routing

TanStack Router, **programmatically defined** in `main.tsx` — not file-based routing.
Adding a new route is three steps, all in one file: (1) write the route's component
(anywhere, but by convention in `routes/`), (2) call `createRoute({ getParentRoute:
() => rootRoute, path: '/whatever', component: Whatever })`, (3) add the resulting
route object to the `rootRoute.addChildren([...])` array. This is low-friction — no
file-system convention to satisfy, no route manifest to regenerate. `main.tsx` also
shows two existing patterns worth reusing for a new dev-only surface:

- **`isPublicPathname`/`isChromelessPathname`** (`lib/landingRoute.ts`) — the existing
  mechanism for telling `AppShell`/`AuthGuard` that a route should render without the
  authenticated nav and without mounting authenticated queries. A design-system editor
  route would very plausibly want the same treatment (no sidebar, no auth-gated
  queries firing).
- **`cloudOnly` `beforeLoad` guard** — the existing pattern (used by `/auth/reset` and
  `/signed-out`) for a route that should redirect away in the wrong deployment mode.
  The inverse — a route that should redirect away *outside dev* — doesn't exist yet as
  a named pattern but would follow the same shape (`beforeLoad: () => { if
  (!import.meta.env.DEV) throw redirect({ to: '/' }) }`).

### 6.3 No existing "dev-only, not shown to real users" route pattern

Checked directly: no route in the app is currently gated by `import.meta.env.DEV` or
any equivalent. The only two `DEV`-gated call sites in the entire `apps/web/src` tree
are two `console.info()` calls inside `pwa.ts`. **This means there is no established
convention to follow for hiding the new design-system route from production** — the
planning phase will be establishing that convention, not extending one. The
`/primitives-showcase` precedent (§5) suggests a plausible shape (an unlinked route,
reachable by direct URL, not in the nav — which is how the *reference product* hid its
own internal storybook), which is a lower-friction option than a `DEV`-only guard if
the team is comfortable with "unlinked but technically reachable in prod."

### 6.4 "Send changes back to an agent" — what already exists vs. what's new

Two genuinely relevant, already-working precedents exist in this codebase. Neither
does the specific thing this initiative needs (apply an edit to a *source file*), but
both are proven infrastructure for pieces of the problem:

1. **The bug-report pipeline** (`components/BugReport.tsx` +
   `apps/api/src/routes/bugs.ts`) is the closest structural analog to "an in-app UI
   action produces a structured artifact for an agent to act on." Self-host mode:
   the report (description + screenshot + page URL + viewport, as YAML-frontmattered
   markdown) is written straight to disk at `issues/<id>/report.md` by the running API
   process — a live server process with local filesystem write access, invoked by an
   authenticated in-app button. Cloud mode: the same data becomes a GitHub issue via
   the REST API instead. The in-file comments on both the component and the route
   reference a **`fix-issues` skill** that's meant to "walk that dir" — **note:** at
   the time of this audit, `.claude/skills/` in this repo contains only `add-tcg`,
   `add-image-slot`, and `fill-missing-assets`; no `fix-issues` skill file currently
   exists here, so either it's a skill that lives elsewhere (global/user-level) or
   this is an aspirational reference not yet backed by a file. Either way, the
   *pipeline shape* — UI writes a structured request, an agent later reads and acts on
   it — is proven and already shipping; what's new for the design-system editor is
   making that loop live/synchronous rather than async, and having the agent write to
   source files instead of just reading a report.
2. **deckpal-mcp** (`apps/mcp`) is a live, already-deployed MCP server exposing 21
   tools (collection, decks, lists, battle logs, card search, etc.) that read *and
   write* real application data on behalf of an authenticated agent. Two independent,
   working auth channels already feed it: **personal access tokens**
   (`components/AgentAccess.tsx` + the token routes it calls — mint, list, revoke,
   shown once) and **OAuth 2.1 with PKCE** (`routes/Authorize.tsx` +
   `apps/api/src/oauthServer.ts` — a full consent-screen flow for claude.ai/ChatGPT/
   Gemini-style "Connect" buttons). This is a proven, production pattern for "an
   external agent, authenticated, performs mutations against this app" — but its
   tools are scoped to **collection/deck/list domain data in Postgres**, not to
   editing files in the git repository. Routing design-token/component edits through
   an MCP-shaped channel is architecturally plausible (the auth and transport are
   already solved problems here) but would require new tools with a completely
   different capability (write to `apps/web/src/**`, not to a database row).
3. **Neither existing channel writes to source code.** That capability — an agent
   applying a design-system-editor change to `theme.css` or a component file — is new
   work regardless of which transport (bug-report-style file drop, MCP-style live
   tool call, or something else) the planning phase chooses.

### 6.5 Contracts an implementation still has to honor

Nothing about this initiative is exempt from `AGENTS.md`'s standing rules. Two are
directly relevant: **B9** ("no unilateral infrastructure mutations... require the
maintainer's explicit approval") means an agent applying live edits to source files is
squarely inside something the maintainer needs to have explicitly signed off on as a
category of action, not just approved once. The **verification standard** ("browser
verification for UI changes... at desktop width and at 390px") applies to the editor
surface itself once built, same as any other UI work in this repo. And per the
**documentation-sync gate**, shipping this will very likely touch
`ARCHITECTURE.md`/the wiki's Frontend-Research page (new subsystem) and should get a
`DECISIONS.md` entry — not this audit's job to write, but the planning phase should
budget for it.
