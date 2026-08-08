# UI-SPEC.md — DeckScout design-system contract

> The visual/behavioural contract the DeckScout front-end is built against, distilled from
> observation of **pkmn.gg**. This document describes *design intent and measurements*.
> It deliberately contains **no pkmn.gg code, CSS, or class names** — their compiled
> `unistyles_*` hashes are worthless to us and off-limits as an implementation strategy.
> Everything here is to be rebuilt cleanly in React + Tailwind v4.

**Evidence base**

| Artifact | Location |
|---|---|
| Computed styles + full `cssVars` dump, 24 pages @1440×900 | `research/pkmn-gg/styles/*.json` |
| DOM subtree captures, 24 pages | `research/pkmn-gg/dom/*.html` |
| Desktop full-page screenshots @1440 | `research/pkmn-gg/screenshots/*--1440.png` |
| Mobile full-page screenshots @390×844, DPR 2 (captured for this spec) | `research/pkmn-gg/screenshots/{home,set-151,card-151-006,pokedex,collections,deck-public}--390.png` |
| **Live interaction pass** — state diffs, motion longhands, Table/Binder views, price chart, breakpoint sweep | `research/pkmn-gg/interactions/` + `research/INTERACTION-CAPTURE.md` |

**Confidence legend** — used throughout.

| Mark | Meaning |
|---|---|
| **M** | *Measured.* Read directly from the token dump, the computed-style capture, or a pixel scan of a screenshot. Trust the number. |
| **D** | *Derived.* Arithmetic on measured values (e.g. a gap inferred from two measured edges). Trust to ±1px. |
| **I** | *Inferred.* Reasoned from partial evidence. Treat as a design proposal, not a fact about pkmn.gg. |
| **U** | *Undetermined.* Could not be established from the captures. Listed so we don't pretend otherwise. |

---

## 1. Design tokens

### 1.1 How the token set behaves

**M** — 77 CSS custom properties are defined on the document root. They are **identical on all
24 captured pages** (every page reports the same 77 names and the same 77 values). There is no
per-page or per-route token override. This is a single, flat, semantic token layer — there is no
exposed primitive/palette tier (no `--blue-500` style ramp), only roles.

Naming convention observed: `--<role>-<subrole>-<modifier>`, e.g.
`--action-primary-strong-hover`, `--surface-tertiary-transparent`, `--halo-success`.
We adopt the same names verbatim so the spec and the implementation stay diffable against
future re-captures.

### 1.2 Colour tokens (all **M**, exact values from `cssVars`)

#### Surfaces

| Token | Value | Observed use |
|---|---|---|
| `--surface-primary` | `#15181F` | Left sidebar background; the *darkest* surface. Also `--action-danger-text`. |
| `--surface-secondary` | `#1F232D` | Page/content background, header background. The default canvas. |
| `--surface-tertiary` | `#282D38` | Cards, tiles, inactive chips, default buttons, 1px borders. The workhorse. |
| `--surface-tertiary-subtle` | `rgba(44,48,59,0.2)` | Faint fills over imagery. |
| `--surface-tertiary-transparent` | `rgba(44,48,59,0.5)` | Translucent fills over imagery (badge chips on card art). |
| `--surface-quaternary` | `#373D4C` | One step up from tertiary; inactive nav icon fill. |
| `--surface-raised` | `#3E4353` | Raised control surfaces. |
| `--surface-control-active` | `#484F60` | Pressed/active control fill. |
| `--surface-profile-card` | `#282D38` | Profile panel surface (alias of tertiary). |
| `--surface-on-light` | `#F7F9FF` | **Light-on-dark surface.** Auth card, set-symbol tile. |
| `--surface-on-light-border` | `#E0E4EF` | Border for those light surfaces. |
| `--surface-on-light-text` | `#1F232D` | Text on those light surfaces. |

> Note the inversion that defines the look: **the sidebar (`#15181F`) is darker than the page
> (`#1F232D`), and cards (`#282D38`) are lighter than the page.** Elevation reads as *lighter*,
> chrome reads as *darker*.

#### Text & links

| Token | Value | Observed use |
|---|---|---|
| `--text-primary` | `#FFFFFF` | Headings, card names, stat values. |
| `--text-body` | `#C1C7D8` | Body copy. |
| `--text-secondary` | `#989EB3` | Secondary/meta copy (dates, descriptions). |
| `--text-muted` | `#7F8596` | Labels, card numbers, inactive controls. Most-used text colour on the site. |
| `--text-primary-on-dark` | `rgba(255,255,255,0.85)` | Text over photographic/hero imagery. |
| `--link-color` | `#32B5FF` | Inline links, set-name links, `#0006`-style ID links. |
| `--link-hover-color` | `#45BCFF` | Link hover. |

#### Actions (buttons)

| Token | Value | Notes |
|---|---|---|
| `--action-primary` | `#FFD54A` | Primary CTA fill (marketing buttons, "Sign Up", gen tabs, quantity badge). |
| `--action-primary-hover` | `#e6ca5b` | |
| `--action-primary-text` | `#1F232D` | Text on primary. |
| `--action-primary-strong` | `#FFE165` | Brighter yellow — active *sort chip*, `LVL` label, `--glow-active`. |
| `--action-primary-strong-hover` | `#FFD63B` | |
| `--action-primary-strong-text` | `#1F232D` | |
| `--action-default` | `#282D38` | Neutral/secondary button fill. |
| `--action-default-hover` | `#3B3F4B` | |
| `--action-default-text` | `#FFFFFF` | |
| `--action-ghost-border` | `#3B3F4B` | Ghost + dashed button border. |
| `--action-ghost-hover` | `#282D38` | |
| `--action-ghost-text` | `#7F8596` | |
| `--action-danger` | `#ff7893` | Destructive fill (pink, not red). |
| `--action-danger-hover` | `#e6657f` | |
| `--action-danger-text` | `#15181F` | |
| `--action-brand` | `#32B5FF` | Brand-blue action ("Test Hand", toggles). |
| `--action-brand-text` | `#FFFFFF` | |

#### Status, feedback, halos

| Token | Value | Notes |
|---|---|---|
| `--success` | `#32FFCE` | Success text/border (mint). |
| `--error` | `#ff7893` | Alias of `--action-danger`. |
| `--change-positive` | `#35F197` | **All prices and positive price deltas render in this green.** |
| `--change-negative` | `#FF6B6B` | Negative price deltas. |
| `--halo-success` | `rgba(50,255,206,0.1)` | 10 % tint behind success state. |
| `--halo-error` | `rgba(255,120,147,0.1)` | 10 % tint behind error state. |
| `--halo-neutral` | `rgba(255,225,101,0.1)` | 10 % tint behind neutral/attention state. |
| `--overlay-circle-ring` | `rgba(255,225,101,0.2)` | 20 % yellow ring around circular overlays. |
| `--overlay-circle-ring-error` | `rgba(255,120,147,0.2)` | Error variant of the same. |
| `--overlay-scrim` | `rgba(44,48,59,0.7)` | Standard modal/hero scrim. |
| `--overlay-scrim-strong` | `rgba(21,24,31,0.75)` | Heavier scrim. |
| `--banner-gradient-top` | `rgba(31,35,45,0.8)` | Top of the hero-image fade. |

> There is **no `warning` token.** The "warning" role is served by `--halo-neutral` /
> `--action-primary-strong` (yellow). If we need a true warning colour we are inventing it —
> flag it in the implementation.

#### Borders, dividers, focus

| Token | Value |
|---|---|
| `--border-default` | `#282D38` |
| `--border-focus` | `#7F8596` |
| `--divider-subtle` | `#383C49` |
| `--avatar-ring-color` | `#282D38` |

#### Icons

| Token | Value | Notes |
|---|---|---|
| `--icon-default` | `#7F8596` | |
| `--icon-inactive` | `#7F8596` | |
| `--icon-hover` | `#FFFFFF` | |
| `--icon-active` | `#FFE165` | |
| `--icon-muted` | `#666f84` | |
| `--icon-muted-strong` | `#484f60` | |
| `--icon-disabled` | `#4A4F5C` | |
| `--icon-disabled-strong` | `#292e3a` | |

Icons are additionally driven by three *instance* variables set inline per-icon
(**M**, seen on every `role="img"` icon in the DOM): a resting colour, a fallback colour, and a
hover colour. Reproduce that as three CSS custom properties on the icon element rather than
hard-coding fills, so a single icon component can be recoloured per context.

#### Brand / Pro / promo

| Token | Value | Notes |
|---|---|---|
| `--pro-accent` | `#45BCFF` | Pro blue (monthly plan, PRO chips). |
| `--pro-accent-text` | `#15181F` | |
| `--pro-pink` | `#7F42FF` | Pro purple (annual plan, "SAVE 20 %" badge) — note the name says pink, the value is violet. |
| `--pro-pink-text` | `#FFFFFF` | |
| `--announcement-background` | `#3F52FF` | Announcement/indigo banner. |
| `--announcement-text` | `#FFFFFF` | |
| `--completion-grandmaster` | `#9B6BFF` | Top completion tier; **also the Holofoil variant colour** and the list quantity badge. |
| `--glow-active` | `#FFE165` | |

#### OAuth (light-surface buttons)

| Token | Value |
|---|---|
| `--oauth-google-bg` / `-border` / `-text` | `#FFFFFF` / `#E0E4EF` / `#000000` |
| `--oauth-apple-bg` / `-border` / `-text` | `#000000` / `#3B3F4B` / `#FFFFFF` |
| `--oauth-discord` | `#5865F2` |
| `--oauth-neutral-text` | `#1F232D` |

### 1.3 Pokémon energy-type colours

**M** — **There are no energy-type colour tokens.** Not one of the 77 variables encodes a type
colour. Types are rendered exclusively as **raster image assets**, one per type, fetched from a
scheme-namespaced asset path. All 11 TCG energy types are present in the DOM captures:

`colorless`, `darkness`, `dragon`, `fairy`, `fighting`, `fire`, `grass`, `lightning`, `metal`,
`psychic`, `water`

Rendered as `<img>` at 12–24 px square (**M**), never as a coloured chip with a token background.
On the Pokédex (creature, not card) side there is a second, separate family of **SVG** type icons
(`type-fire`, `type-flying` observed) rendered at 15 px with colour baked into the SVG (**M**) —
these display as small circular colour discs.

**Implication for DeckScout:** we should ship our own 11 energy glyphs as SVG and *also* define a
type-colour palette, because we will want type-tinted filter chips that pkmn.gg does not have.
That palette is **ours to invent (I)** — do not claim it came from pkmn.gg.

### 1.4 Spacing scale

**M** — from the aggregated `gap` and `padding` values over all 24 pages, ordered by frequency:

| Value | Uses (gap) | Role |
|---|---|---|
| 6px | 170 | Tightest — icon↔label, stacked meta lines |
| 10px | 138 | |
| 12px | 89 | Control row gaps, button clusters |
| 4px | 67 | Micro |
| 18px | 50 | |
| 8px | 26 | Pokédex generation-tab grid gap |
| 5px | 24 | |
| 16px | 15 | Section-internal gap, primitives sections |
| 20px | 8 | Deck/collection grid gap |
| 24px | 5 | Series grid gap, `<main>` padding |
| 15px | 4 | Profile collection grid gap |
| 30px / 53px | 5 | Card-grid row gap / column gap (literally `gap: 30px 53px`) |
| 32px, 40px, 48px, 50px | 1–4 each | Section separation; `<main>` section gap is 48px |

**Recommended scale to implement (I, but every step is measured somewhere):**
`0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 32, 40, 48, 53, 64`

This is *not* a clean 4-pt scale — pkmn.gg uses 5, 6, 10, 15, 18, 53. Reproduce those specific
values where a component measurement calls for them; use the 4-pt subset for anything new.

### 1.5 Radii

**M** — aggregated `border-radius`, by frequency:

| Value | Uses | Role |
|---|---|---|
| **8px** | 1227 | The default. Cards, tiles, buttons, inputs, chips, panels, card images. |
| 4px | 150 | Small badges, thumbnails |
| 6px | 59 | Owned-status badges, small controls |
| 16px | 52 | Large panels; profile banner top corners (`16px 16px 0 0`) |
| 12px | 30 | Medium panels |
| 5px, 10px, 20px, 24px, 25px, 30px, 32px, 40px, 48px, 50px, 60px, 70px, 85px | 1–32 each | One-off / circular art framing |
| 300px, 9999px | 54 | Pill — header auth buttons, progress tracks, toggles, avatars |
| Directional | 61 + 47 + 27 | `0 4px 4px 0`, `8px 0 0 8px`, `0 8px 8px 0` — segmented-control ends |

**Scale to implement:** `sm 4 · md 6 · lg 8 (default) · xl 12 · 2xl 16 · full 9999`.

### 1.6 Elevation / shadows

**M** — only four distinct shadows exist site-wide:

| Token / value | Uses | Role |
|---|---|---|
| `--shadow-elevated` = `0 16px 24px rgba(0,0,0,0.25)` | 70 | Popovers, floating panels, hero cards |
| `0 8px 12px rgba(0,0,0,0.25)` | 1 | |
| `0 8px 8px rgba(0,0,0,0.25)` | 2 | |
| `4px 4px 4px 4px rgba(0,0,0,0.25)` | 15 | Empty-state cards, toast (offset, not centred — a deliberate "sticker" look) |

**M** — `backdrop-filter: blur(10px)` appears 8× (and `blur(0px)` 8× as its animated-off state).
Used for scrim/glass panels over card art.

Elevation ladder to implement: **flat (`--surface-tertiary`) → raised (`--surface-raised`) →
floating (`--shadow-elevated`)**. There is no 5-step shadow ramp; do not invent one.

### 1.7 Z-index layers

**M** — observed `z-index` values and their frequency:

| Layer | Value | Frequency | Assignment (I for the labels, M for the values) |
|---|---|---|---|
| Below-content art | `-11 … -1` | 73 | Blurred hero art, decorative gradients |
| Base | `0` | 525 | Normal flow |
| Content stacking | `1 … 13` | 220 | Badges over card art, sticky sub-bars, popovers |
| App chrome | `20` | 416 | **Fixed header + fixed sidebar** |
| Toast | `9999` | 1 | Bottom-right toast |

**Recommended layer constants:** `art:-1 · base:0 · raised:5 · sticky:8 · overlay:10 ·
popover:13 · chrome:20 · modal:100 · toast:9999`. (Values 5/8/10/13 are **M**; the labels and
`modal:100` are **I** — no modal was captured.)

### 1.8 Typography

**M** — `Inter` with a local fallback face is the **only** family on every page
(`font-family: Inter, "Inter Fallback"`, 405/405 elements on the primitives page). It is used as
a **variable** font: weights `400, 450, 500, 550, 600, 650, 700, 800, 900, 1000` all occur.

**M** — `letter-spacing` and `text-transform` are **empty across all 24 pages**. pkmn.gg never
tracks or uppercases text via CSS. (The `LVL 0` / `SAVE 20%` uppercase you see in screenshots is
literal uppercase content, not a transform.)

**M — size × weight × line-height combinations, in observed frequency order:**

| Size | Weight | Line-height | Colour | Where |
|---|---|---|---|---|
| 72px | 700 | 84px | `--text-primary` (+ `#FFD54A` for the emphasised word) | Marketing H1 (home) |
| 56px | 700 | 64px | `--text-primary` | Marketing section H2 (home) |
| 48px | 800 | 58px | `--text-primary` | **Page H1** (Collections, deck name, list name) |
| 32px | 700 | — | `--text-primary` | Profile display name (I: not isolated in the dump) |
| 24px | 700 | 36px | `--text-primary` | Empty-state title |
| 18px | 700 | 27px | `--text-primary` | Section header ("Pokémon (17)") |
| 18px | 550 | 27px | `--text-primary` | Collection row-card title |
| 18px | 500 | 23px | `--text-primary` | Set-progress card title |
| 18px | 400 | 31px | `--text-secondary` | Marketing lede |
| 16px | 700 | 24px | `--action-primary-text` | Marketing CTA button label |
| 16px | 600 | 24px | `--action-primary-text` | Marketing CTA (alt) |
| 16px | 500 | 24px | `--text-muted` | Page subtitle |
| **16px** | **400** | **23px** | `--text-primary` | **Card-tile name** |
| **16px** | **400** | **23px** | `--change-positive` | **Card-tile price** |
| 15px | 800 | 15px | `--text-primary` | Set-completion percentage |
| 15px | 400 | 35px | `--text-secondary` | Marketing body / bullet copy |
| 14px | 700 | 21px | varies by button variant | **Button md/lg label** |
| 14px | 700 | 21px | `--text-muted` | Sort-chip label (inactive) |
| 14px | 600 | 17px | `--text-primary` / `--action-primary-text` | Header auth buttons |
| 14px | 500 | 21px | `--text-muted` | Tab label (inactive), view-toggle label |
| 14px | 500 | 17px | `--text-secondary` | Set-progress card date |
| 14px | 450 | 21px | `--text-secondary` | Collection row-card date |
| 14px | 400 | 23px | `--text-muted` / `--text-primary` / `--change-positive` | **Stat-strip label / value / money value** |
| 14px | 400 | 21px | `--text-muted` | Sidebar nav label (inactive) |
| 13px | 500 | 16.25px | `--text-primary` | Checkbox label |
| **12px** | **400** | **23px** | `--text-muted` | **Card-tile number (`#001`)** |
| 12px | 700 | 18px | `--text-muted` | Form field label |
| 12px | 700 | 18px | `--surface-primary` | Small button on light ("View") |
| 12px | 600 | 18px | `--text-muted` | Profile stat label |
| 12px | 550 | 22px | `--text-muted` / `--text-primary` | Showcase card number / bio |
| 12px | 500 | 21px | `--text-muted` | Footer copy |
| 12px | 500 | 18px | `--text-muted` | "+2 Variants" badge |
| 12px | 450 | 18px | `--text-secondary` | Collection row-card description |
| 12px | 400 | 20px | `--text-primary` | Type-count numerals |
| 12px | 400 | 18px | `--error` / `--success` | Field validation message |
| 11px | 700 | 16.5px | varies by button variant | **Button sm label** |
| 10px | 700 | 31px | `--text-primary` | Back-pill label |
| 10px | 700 | 15px | `--text-muted` | "/207 Collected" |
| 9px | 800 | 15px | `--action-primary` | "LVL 1" badge |

**Line-height pattern (D):** UI text uses **1.5×** (`12/18`, `14/21`); the card grid uses a fixed
**23px line box** for all three of its type sizes so name/price/number rows align on a common
rhythm; display type tightens to **1.14–1.21×**.

### 1.9 Motion

**M — measured in the interaction pass** by reading the `transition-*` and `animation-*`
**longhands** on every element (the first capture read the `transition` shorthand, which resolves to
the property list `"all"` and hides the values), and by walking the CSSOM of every loaded stylesheet.

**pkmn.gg is almost motionless.** Across the set page, card-detail page and deck builder there are
only **four** distinct transition declarations and **one** keyframe animation on rendered elements:

| Where | `transition-property` | Duration | Timing | Delay | Conf |
|---|---|---|---|---|---|
| Every `<button>` — header auth, binder pager, … | `background-color` | **150ms** | **`ease`** | 0s | M |
| Advanced-filters accordion; deck-builder bottom dock | `height` | **200ms** | **`ease`** | 0s | M |
| Deck-builder select controls (9 elements) | colour/border/opacity/shadow/transform/filter set | **150ms** | **`cubic-bezier(0.4, 0, 0.2, 1)`** | 0s | M |
| Everything else | `all` | **0s** | `ease` | 0s | M |

| Animation | Duration | Timing | Iter | Delay | Fill | Conf |
|---|---|---|---|---|---|---|
| Deck-builder filter panel reveal (`opacity 0 → 1`) | **200ms** | `ease` | 1 | **300ms** | `forwards` | M |

Keyframes defined in the stylesheets (most unused on the captured pages, **M**): a card-skeleton
shimmer (`left: -100% → 100%`), a `marching-ants` background march, a 360° spinner for a route
progress bar, and six `react-native-web` generics (rotate, translateY in/out, translateX sweep,
fade in, fade out).

**There is no card lift, no page transition, no drawer slide, no modal entrance, and no
`:active` rule anywhere on the site** (§3 and §7).

**Motion scale to implement:**

| Token | Value | Basis |
|---|---|---|
| `--duration-fast` | **150ms** | **M** — every button's `background-color` |
| `--duration-base` | **200ms** | **M** — accordion `height`, panel fade |
| `--duration-slow` | 320ms | **I** — ours; nothing on pkmn.gg is this slow |
| `--ease-standard` | **`ease`** | **M** — the site's only authored curve |
| `--ease-emphasised` | `cubic-bezier(0.4, 0, 0.2, 1)` | **M**, but this is Tailwind's stock curve on third-party controls, not a design decision |
| `--delay-reveal` | **300ms** | **M** — filter-panel fade-in delay |

Honour `prefers-reduced-motion: reduce` by collapsing all of the above to `1ms` — pkmn.gg's own
Pokédex ships an explicit **"Animations" toggle** (**M**, see §5.6), which tells us motion is
considered optional there; we should respect the OS signal as well.

### 1.10 Ready-to-paste Tailwind v4 `@theme`

```css
@theme {
  /* ── surfaces ───────────────────────────────────────────── */
  --color-surface-primary:              #15181F;
  --color-surface-secondary:            #1F232D;
  --color-surface-tertiary:             #282D38;
  --color-surface-tertiary-subtle:      rgb(44 48 59 / 0.2);
  --color-surface-tertiary-transparent: rgb(44 48 59 / 0.5);
  --color-surface-quaternary:           #373D4C;
  --color-surface-raised:               #3E4353;
  --color-surface-control-active:       #484F60;
  --color-surface-profile-card:         #282D38;
  --color-surface-on-light:             #F7F9FF;
  --color-surface-on-light-border:      #E0E4EF;
  --color-surface-on-light-text:        #1F232D;

  /* ── text & links ───────────────────────────────────────── */
  --color-text-primary:         #FFFFFF;
  --color-text-body:            #C1C7D8;
  --color-text-secondary:       #989EB3;
  --color-text-muted:           #7F8596;
  --color-text-primary-on-dark: rgb(255 255 255 / 0.85);
  --color-link:                 #32B5FF;
  --color-link-hover:           #45BCFF;

  /* ── actions ────────────────────────────────────────────── */
  --color-action-primary:              #FFD54A;
  --color-action-primary-hover:        #E6CA5B;
  --color-action-primary-text:         #1F232D;
  --color-action-primary-strong:       #FFE165;
  --color-action-primary-strong-hover: #FFD63B;
  --color-action-primary-strong-text:  #1F232D;
  --color-action-default:              #282D38;
  --color-action-default-hover:        #3B3F4B;
  --color-action-default-text:         #FFFFFF;
  --color-action-ghost-border:         #3B3F4B;
  --color-action-ghost-hover:          #282D38;
  --color-action-ghost-text:           #7F8596;
  --color-action-danger:               #FF7893;
  --color-action-danger-hover:         #E6657F;
  --color-action-danger-text:          #15181F;
  --color-action-brand:                #32B5FF;
  --color-action-brand-text:           #FFFFFF;

  /* ── status / feedback ──────────────────────────────────── */
  --color-success:          #32FFCE;
  --color-error:            #FF7893;
  --color-change-positive:  #35F197;
  --color-change-negative:  #FF6B6B;
  --color-halo-success:     rgb(50 255 206 / 0.1);
  --color-halo-error:       rgb(255 120 147 / 0.1);
  --color-halo-neutral:     rgb(255 225 101 / 0.1);
  --color-overlay-scrim:        rgb(44 48 59 / 0.7);
  --color-overlay-scrim-strong: rgb(21 24 31 / 0.75);
  --color-overlay-ring:         rgb(255 225 101 / 0.2);
  --color-overlay-ring-error:   rgb(255 120 147 / 0.2);
  --color-banner-gradient-top:  rgb(31 35 45 / 0.8);

  /* ── borders / icons ────────────────────────────────────── */
  --color-border-default:     #282D38;
  --color-border-focus:       #7F8596;
  --color-divider-subtle:     #383C49;
  --color-avatar-ring:        #282D38;
  --color-icon-default:       #7F8596;
  --color-icon-hover:         #FFFFFF;
  --color-icon-active:        #FFE165;
  --color-icon-muted:         #666F84;
  --color-icon-muted-strong:  #484F60;
  --color-icon-disabled:      #4A4F5C;
  --color-icon-disabled-strong: #292E3A;

  /* ── brand / pro / promo ────────────────────────────────── */
  --color-pro-accent:      #45BCFF;
  --color-pro-accent-text: #15181F;
  --color-pro-pink:        #7F42FF;
  --color-pro-pink-text:   #FFFFFF;
  --color-announcement:      #3F52FF;
  --color-announcement-text: #FFFFFF;
  --color-completion-grandmaster: #9B6BFF;
  --color-glow-active:            #FFE165;

  /* ── oauth ──────────────────────────────────────────────── */
  --color-oauth-google-bg:     #FFFFFF;
  --color-oauth-google-border: #E0E4EF;
  --color-oauth-google-text:   #000000;
  --color-oauth-apple-bg:      #000000;
  --color-oauth-apple-border:  #3B3F4B;
  --color-oauth-apple-text:    #FFFFFF;
  --color-oauth-discord:       #5865F2;
  --color-oauth-neutral-text:  #1F232D;

  /* ── variant accents (D — read off owned-badge + label pixels) ── */
  --color-variant-normal:        #FFE165;  /* Normal            */
  --color-variant-reverse-holo:  #32B5FF;  /* Reverse Holofoil  */
  --color-variant-holofoil:      #9B6BFF;  /* Holofoil          */

  /* ── spacing (site-observed, non-uniform on purpose) ─────── */
  --spacing: 2px;              /* Tailwind base unit → 1 = 2px  */
  /* use: p-1(2) p-2(4) p-3(6) p-4(8) p-5(10) p-6(12) p-8(16)
          p-10(20) p-12(24) p-15(30) p-16(32) p-20(40) p-24(48) */

  /* ── radii ──────────────────────────────────────────────── */
  --radius-sm:   4px;
  --radius-md:   6px;
  --radius-lg:   8px;   /* DEFAULT */
  --radius-xl:  12px;
  --radius-2xl: 16px;
  --radius-full: 9999px;

  /* ── elevation ──────────────────────────────────────────── */
  --shadow-elevated: 0 16px 24px rgb(0 0 0 / 0.25);
  --shadow-panel:    0 8px 12px rgb(0 0 0 / 0.25);
  --shadow-sticker:  4px 4px 4px 4px rgb(0 0 0 / 0.25);

  /* ── typography ─────────────────────────────────────────── */
  --font-sans: "Inter", "Inter Fallback", ui-sans-serif, system-ui, sans-serif;

  --text-3xs:  9px;   --text-3xs--line-height: 15px;
  --text-2xs: 10px;   --text-2xs--line-height: 15px;
  --text-xs:  11px;   --text-xs--line-height:  16.5px;
  --text-sm:  12px;   --text-sm--line-height:  18px;
  --text-md:  13px;   --text-md--line-height:  16.25px;
  --text-base:14px;   --text-base--line-height:21px;
  --text-lg:  15px;   --text-lg--line-height:  22.5px;
  --text-xl:  16px;   --text-xl--line-height:  24px;
  --text-2xl: 18px;   --text-2xl--line-height: 27px;
  --text-3xl: 24px;   --text-3xl--line-height: 36px;
  --text-4xl: 32px;   --text-4xl--line-height: 40px;
  --text-5xl: 48px;   --text-5xl--line-height: 58px;
  --text-6xl: 56px;   --text-6xl--line-height: 64px;
  --text-7xl: 72px;   --text-7xl--line-height: 84px;

  /* card-grid fixed line box (M) */
  --leading-card: 23px;

  /* ── motion (M unless noted — see §1.9) ─────────────────── */
  --duration-fast:   150ms;  /* M — every button's background-color   */
  --duration-base:   200ms;  /* M — accordion height, panel fade      */
  --duration-slow:   320ms;  /* I — ours; nothing on pkmn.gg is this slow */
  --delay-reveal:    300ms;  /* M — filter-panel fade-in delay        */
  --ease-standard:   ease;                          /* M */
  --ease-emphasised: cubic-bezier(0.4, 0, 0.2, 1);  /* M, but stock Tailwind */

  /* ── breakpoints (see §4.3) ─────────────────────────────── */
  --breakpoint-gap:  567px;   /* M — card-grid column gap 23px → 53px */
  --breakpoint-nav: 1068px;   /* M — the ONLY real layout breakpoint:
                                 hamburger below, 274px sidebar at/above */
  /* Column counts are NOT breakpointed — the grid is fluid. See §4.4. */
}

/* z-index layers — plain custom properties, not a Tailwind namespace */
:root {
  --z-art: -1;  --z-base: 0;   --z-raised: 5;  --z-sticky: 8;
  --z-overlay: 10; --z-popover: 13; --z-chrome: 20;
  --z-modal: 100;  --z-toast: 9999;
}
```

---

## 2. Dark / light theming

### 2.1 What was found

| Observation | Evidence |
|---|---|
| `<html class="pkmnDark">` on **all 24 pages** | **M** — `htmlClass` field, every styles JSON |
| All 77 tokens resolve to exactly **one value each**, on every page | **M** — cross-page dedupe |
| Every image asset URL embeds a **scheme segment**: `…/assets/<key>/**dark**/<variant>-v<n>.<ext>` | **M** — 40+ distinct asset URLs, `/dark/` in 100 % of them |
| Every icon element carries `data-icon-scheme="dark"` | **M** — all DOM captures |
| Icons also carry `data-icon-key` and `data-svg-icon-layer="resting" \| "hover"` | **M** |
| Tokens `--surface-on-light`, `--surface-on-light-border`, `--surface-on-light-text` exist | **M** |

### 2.2 Conclusion

**A light *theme* does not exist in anything reachable.** No `pkmnLight` class, no alternate token
values, no `prefers-color-scheme` variation, no theme toggle anywhere in 24 pages of DOM.

The `--surface-on-light-*` trio is **not** a light theme — it is a *light-surface role inside the
dark theme*, used where a real-world white object is being represented:

- the sign-in / register card (`screenshots/auth-signin--1440.png` — a genuinely white panel),
- the white rounded set-symbol tile in every set header and set-progress card,
- the Google OAuth button.

However, pkmn.gg has clearly **provisioned** for a second scheme: the `pkmnDark` class name only
makes sense as one of a pair, and every asset path reserves a scheme slot. So the architecture is
theme-ready; the theme just isn't shipped.

### 2.3 How DeckScout should key theming

Adopt the same architecture, on the assumption we may add a light scheme later:

1. **Class + attribute on `<html>`** — `class="pkmnDark"` for parity of intent, plus
   `data-theme="dark" | "light"` as the machine-readable switch (this is also what the
   Artifact/host runtime toggles, so it's the pragmatic choice).
2. **Token block per scheme.** Default the tokens under `@media (prefers-color-scheme: dark)`,
   then let `:root[data-theme="dark"]` / `:root[data-theme="light"]` override in both directions
   so an explicit user choice always wins.
3. **Scheme-namespaced assets.** Store cached artwork as
   `/<asset-key>/<scheme>/<variant>.<ext>` exactly like pkmn.gg does, so a light scheme is a
   content change, not a code change. Fall back to `dark` when a light asset is absent.
4. **Icons take three colour inputs**, not one: resting, fallback, hover. Drive them with CSS
   custom properties on the icon element so the same glyph works on dark chrome, light cards,
   and coloured buttons.
5. **Ship dark-only for v1.** Nothing in the reference has a light theme, and building one
   speculatively is wasted effort. Keep the seams; skip the second palette.

---

## 3. Component inventory

Every entry lists the screenshot to look at. All screenshots are in
`research/pkmn-gg/screenshots/`.

### 3.1 App shell

#### Header (fixed)
`set-151--1440.png` (top strip) · `pokedex--390.png` (mobile)

| Property | Value | Conf |
|---|---|---|
| Height (desktop) | **78px**, plus a **1px** bottom border in `--border-default` at y=78 | M |
| Height (mobile @390) | **99px**, plus a **1px** bottom border at y=99 | M |
| Background | `--surface-secondary` `#1F232D` | M |
| Position | Fixed; z-index 20. Confirmed by the header appearing only once in a 21 303px-tall full-page capture | M/D |
| Desktop contents, L→R | (sidebar occupies 0–274) · global search input · spacer · "Log In" · "Sign Up" | M |
| Mobile contents, L→R | hamburger (24px) · brand icon 30px + wordmark 30px · circular search button ⌀39px | M |
| Global search input | 46px tall (48 incl. border), `--surface-primary` `#15181F` fill, radius 8, leading 24px search icon, trailing 15px "advanced search" sliders icon, placeholder "Search Cards…" | M |
| Auth buttons | 115×48px (declared width 117px), **fully rounded pill** (measured corner inset 23px ≈ height/2). Log In = `--action-default`; Sign Up = `--action-primary`. Label 14px/600/17px | M |
| Mobile search button | ⌀39px circle, `--surface-tertiary` | M |

#### Sidebar (fixed)
`set-151--1440.png`, `pokedex--1440.png`

| Property | Value | Conf |
|---|---|---|
| Width | **274px**, plus **1px** right border `--border-default` at x=274 | M |
| Background | `--surface-primary` `#15181F` — darker than the page | M |
| Nav item height | **56px**, full-bleed | M |
| Active item | Background `--surface-secondary` `#1F232D`; icon + label switch to `#FFFFFF`. **No left accent bar** | M |
| Inactive item | Label `--text-muted` 14px/400/21px; icon fill `--surface-quaternary`-family greys | M |
| Icon size | 24px (20px for Discord) | M |
| Header of sidebar | brand icon 33px + wordmark 26.14px + a "collapse navigation" chevron button | M |
| Nav order | English TCG ▾ · Japanese TCG ▾ · TCG Pocket ▾ · My Lists · Deck Builder · Pokédex · Stream Tools · Discord ↗ · Merch ↗ · Pro Membership | M |
| First three items | Expandable (`ui-arrow-drop-down` / `ui-arrow-drop-up` icons present in both states) | M |
| Collapsed width | **81px + 1px border = 82px.** Nav items keep their 56px height and become icon-only: `padding: 0`, `justify-content: center`, 24px icon centred at x=40.5. Labels leave layout (text stays in the DOM). Active item keeps its full-bleed `--surface-secondary` fill. **No transition — the change is instant.** The chevron flips to an "expand" affordance | M |
| Content column when collapsed | Recomputes by the same 85 %-of-main rule: `0.85 × (1440 − 82) = 1154.30px`, starting at x=183.84 | M |
| Sidebar/hamburger switch point | **1068px.** Below it the sidebar is absent and a hamburger shows; at ≥1068 the 274px rail renders | M |
| Mobile drawer @390 | Fixed panel **275 × 744 at y=100** (directly under the 99px header + 1px border), `--surface-primary` `#15181F`, `z-index: 10`. **No scrim element** — the page content wrapper is set to `opacity: 0.2` instead. `<body>` gets `overflow: hidden`. **No transition, no animation — it appears instantly.** Contents top-down: `Log In` / `Sign Up` pills (**117 × 48**, radius 300px, 14px/600, `--action-default` / `--action-primary`) at y=120, then the ten nav items at 275 × 56. Burger glyph swaps to `ui-x` | M |

#### Footer
`primitives-showcase--1440.png` (bottom), `lists--1440.png`

Background `#1B1F27` (**M**, a one-off surface not in the token set — flag it), 278px tall,
centre-aligned column: brand icon 47.56px → wordmark 37.67px → 5 social icons at 25px →
copyright 12px/500/21px `--text-muted` → disclaimer → contact → legal link row.

### 3.2 Card tile (the signature component)
`set-151--1440.png`, `set151` grid region · `list-public--1440.png` · `deck-public--1440.png`

| Property | Value | Conf |
|---|---|---|
| Tile footprint @1440 desktop | **207.81 × 364.52 px** | M |
| Card image | **207.81 × 290.52 px**, `border-radius: 8px`, `object-fit: fill` | M |
| Image aspect ratio | **0.7153** rendered, matching the source asset's intrinsic **299×418**. A separate `aspect-ratio: 0.714286 / 1` (= 5 ∶ 7, the physical card ratio) appears on 50 elements — that is the *container/skeleton* ratio | M |
| Source image URL shape | `…/fit-in/300x418/filters:format(webp)/images/cards/<set>/<set>-<num>.png` — a thumbor-style resize service. **We must build the equivalent locally** | M |
| Footer block height | **74px** total | D |
| Reserved band under image | **≈28px** of empty space before the name row when signed out. This is where the per-variant owned badges sit when signed in (see marketing mock in `home--1440.png` @ y≈1050) | D / I |
| Name row | 16px/400, fixed **23px** line box, `--text-primary`, left-aligned | M |
| Price | Same row, right-aligned, 16px/400/23px, `--change-positive` `#35F197`. `N/A` when unpriced | M |
| Number row | 12px/400/23px `--text-muted`, left ("#001") | M |
| Rarity glyph | Same row, right — ○ Common · ◇ Uncommon · ☆ Rare · ☆☆ Double Rare (rendered as glyphs, not tokens) | M |
| "+N Variants" badge | Bottom-left **overlay on the image**, `--surface-tertiary-transparent` fill, radius ~6, 12px/500/18px `--text-muted`, count in bold | M |
| Hover transform / shadow | **None. No change measured** — not on the tile, not on the image, not on the name link. Hovering the tile and diffing all 60 captured computed properties before/after yields an empty delta, and the CSSOM contains no `:hover` rule that matches any part of the tile. pkmn.gg's card tile is completely inert on hover | M |
| Pressed / `:active` | **None. No change measured**, and there is **not one `:active` rule in the entire stylesheet** | M |
| Focus ring | **None.** The name link is reachable by Tab and matches `:focus-visible`, but the only ring is the Chromium UA default (`outline: auto 1px`). No authored focus style exists anywhere (§3.10) | M |
| **Our addition (I)** | Faithfully reproducing "no feedback at all" would be a regression. Implement `translateY(-4px)` + `--shadow-elevated` over `--duration-fast`, and a 2px `--action-primary-strong` focus ring at 2px offset. **Flag both as ours — pkmn.gg has neither** | I |

**Grid variants of the same tile** (all **M**):

| Context | Tile width | Column gap | Row gap | Cols @1440 |
|---|---|---|---|---|
| Set / list / Pokémon-detail card grid | 207.81 | **53px** | **30px** | 4 |
| Deck card grid | 232.56 | 20px | 20px | 4 |
| Profile collection grid | 236.31 | 15px | 15px | 4 |

### 3.3 Owned-status badge (per-variant)
`home--1440.png`, crop x 800–1360 / y 1050–1270 (marketing mock, at 1:1 scale)

A row of small squares directly beneath the card image, one per tracked variant.

| State | Rendering | Conf |
|---|---|---|
| Owned | Solid fill in the **variant accent colour**, radius ≈6, ~22×22, with a check glyph in `--surface-primary` (or white on darker accents) | M (pixel) |
| Not owned | Dark fill (`--surface-primary`) with a **2px border in the variant accent** | M (pixel) |
| Variant accents | Normal `#FFE165` · Reverse Holofoil `#32B5FF` (cyan) · Holofoil `#9B6BFF` | D |

Corroborated by the list page (`list-public--1440.png`), where the variant *name* under each card
is printed in the same accent: "Normal" in `#FFE165`, "Holofoil" in `#9B6BFF` (**M**, sampled).

### 3.4 Quantity stepper
`home--1440.png`, crop x 900–1240 / y 900–1120

A popover anchored to the card, listing every variant with an independent counter.

| Element | Spec | Conf |
|---|---|---|
| Panel | `--surface-primary` `#15181F`, radius ≈16, `--shadow-elevated` | M/D |
| Row | variant label (white, ~14px/700) left · `[−]` · quantity · `[+]` right | M |
| Stepper buttons | ~36×36 square, radius 8, `--surface-tertiary` fill, glyph `--icon-default` | D |
| Disabled `[−]` at qty 0 | Glyph drops to `--icon-disabled` `#4A4F5C`; button chrome stays | M |
| Quantity | ~20px/700 `--text-primary`, centred between the two buttons | D |
| Example rows | "GameStop Stamp", "EB Games Stamp", "Cosmos Holofoil", "Reverse Cosmos Holofoil" — variants are **per-set free text**, not a fixed enum | M |

An inline stepper of the same shape appears in the deck builder rows (`home--1440.png`, deck mock)
at a smaller scale — one `[−] n [+]` per deck-list row.

### 3.5 Variant chip / toggle
`card-151-006--1440.png` (variant table) · `list-public--1440.png` (label)

Two presentations of the same concept:
1. **Table row** on card detail: `Variant | Market Price | Quantity` header (12px labels), then one
   row per variant inside a `--surface-tertiary` panel with radius 8 — variant name 14px/700 white,
   sub-label "Found in Booster Packs" 12px `--text-muted`, TCGplayer button, price in
   `--change-positive`, action link in `--link-color`.
2. **Text chip** under a card tile in list view: variant name in its accent colour, 12px.

### 3.6 Set-progress bar
`set-151--1440.png` (empty state, top-right) · `home--1440.png` @ y≈770–930 (filled state) ·
`profile-squalls--1440.png` (compact, on set cards)

| Property | Value | Conf |
|---|---|---|
| Primary track | **236px × 6px**, radius full, `--surface-primary`-ish `#1A1D24` | M |
| Primary fill | **Horizontal gradient, salmon → yellow** (`--action-danger`-family → `--action-primary-strong`). Reads as "heat" — the fill gets warmer as you complete | M (pixel, on the marketing mock) |
| Milestone dots | 3 dots, **⌀10px**, `--text-muted` `#7F8596`, at **25 % / 50 % / 75 %** | M/D |
| Secondary track | Directly below, **2px** tall, same colour, same width — the **master-set** progress | M |
| Secondary fill | Solid `--success` `#32FFCE` | M |
| Count label | "**175**/207 Collected" — count 15px/800 `--text-primary`, remainder 10px/700/15px `--text-muted` | M |
| Right cluster | "LVL n" 9px/800/15px `--action-primary` · main % 15px/800/15px `--text-primary` · master % 10–12px `--text-muted` | M |
| Progress **ring** | — | **U** — no circular progress meter was found on any captured page. The set-completion display is bar-based. If we want a ring, that's **our** addition |

### 3.7 Set header / banner
`set-151--1440.png` (top 340px)

Region order, left → right / top → bottom:
1. Full-bleed **blurred set artwork** behind the whole block, with `--banner-gradient-top`
   `rgba(31,35,45,0.8)` fading it into the page (**M**).
2. **Set logo** image, ~135×103 at intrinsic 220×167, no radius (**M**).
3. Action row: "Shop" and "Purchase Set" buttons, `--surface-tertiary` fill, radius 8, ~40px tall,
   with a leading TCGplayer logo mark; label 10px/700 (**M**).
4. **Set symbol tile** — a **40×40** `--surface-on-light` white rounded square containing the
   black set symbol (**M**). Radius ≈8–12 (**D**).
5. Set-progress bar cluster (§3.6).
6. **Stat strip** — a 6-column CSS grid, `column-gap: 16px`, `padding: 16px 16px 16px 0`,
   auto-sized columns, each cell = label 14px/400/23px `--text-muted` over value
   14px/400/23px `--text-primary` (money values in `--change-positive`) (**M**).
   Set page columns: Set Name · Series · Release Date · Cards · Most Expensive Card ·
   Full Set Market Value.

The same stat-strip primitive recurs with 5 columns on deck pages (Created By · Format · Created ·
Updated · Deck Price) and list pages (Created By · Created On · # of Cards · Full List Market
Value), there rendered with **vertical hairline dividers** between cells (**M**).

### 3.8 Filter bar, sort control, view toggle
`set-151--1440.png` @ y 330–440 · `trydeckbuilder--1440.png` @ y 300–580

| Element | Spec | Conf |
|---|---|---|
| Row height | **48px** for every control in the bar | M |
| Search input | Box 295 × 48, `--surface-primary` `#15181F` fill, radius 8, 24px search icon inset, placeholder "Name or Number…" 16px `--text-muted`. **No focus style — `outline: none`** | M |
| Chip row | Full content width (990.25 @1440) × 48, `display: flex`, **`overflow-x: auto`**, chips **12px** apart | M |
| Sort chip (inactive) | 48px tall, `border-radius: 8px`, `padding: 12px`, internal `gap: 12px`. Fill `--surface-tertiary` `#282D38`, label 14px/700/21px `--text-muted`, trailing **stacked ▲▼ caret pair** at 12px in `#484F60` | M |
| Sort chip (active) | Same box. Fill **`--action-primary-strong` `#FFE165`**, label `--action-primary-strong-text` `#1F232D`. The caret for the *current* direction is `#15181F` (opaque); the other is **`#D3B745`** — a knocked-back dark yellow, not an opacity | M |
| Sort chip hover | **Chip box: no change measured.** Only the caret glyphs respond, and only when the pointer is directly over one: `#484F60 → #60687B` on an inactive caret. The active caret's hover colour equals its resting colour | M |
| Chip set (set page) | Number · Name · Rarity · Price · Artist | M |
| Chip set (deck builder) | Best Match · Number · Name · Rarity · Price · Artist · Released | M |
| Advanced filter panel | A `--surface-tertiary` panel, radius 8, containing 4 select controls (Card Type · Energy Type · Sub-Type · Set), with an **"Advanced Filters ⌄" tab hanging off its bottom edge**. It is an **inline accordion, not a popover**: `transition: height 200ms ease`, and the revealed content fades in over `200ms ease` after a `300ms` delay | M |
| Header "advanced search" sliders icon | **Navigates to `/search/advanced`** — a full page with its own search field, `Collection Mode` / `Separate Variants` toggles, the Advanced Filters accordion, the 7-chip sort row, and a "No Active Filters" empty state. **Not a popover** | M |
| Filter popover | **Does not exist.** Every filter affordance is either a route change or an inline accordion | M |
| View toggle | Right-aligned row, full content width × 21, `justify-content: flex-end`, **`gap: 20px`**. Each item = 16px icon + **5px** gap + 14px/500/21px label. Active = label `--text-primary` `#FFFFFF` + icon rendered in `--action-primary` yellow; inactive = label `--text-secondary` `#989EB3` + icon `--icon-default` `#7F8596`. **No hover change measured** on either state | M |
| Table view | **Renders signed out.** See §3.26 | M |
| Binder view | **Renders signed out** — page 1 only, page 2+ Pro-gated. See §3.25 | M |
| Pro gating | On profile pages the sort chips are **blurred out and overlaid** with "Unlock Advanced Filters and Sorting with `PRO`" (`profile-collection--1440.png`) | M |

### 3.9 Buttons

**M — measured on `primitives-showcase--1440.png` by pixel scan.** Five variants × three sizes.

| Size | Height | Label type | Notes |
|---|---|---|---|
| `sm` | **28px** | 11px/700/16.5px | |
| `md` | **39px** | 14px/700/21px | |
| `lg` | **48px** | 14px/700/21px | Same horizontal padding as `md`; only vertical padding differs |

| Variant | Fill | Label colour | Border |
|---|---|---|---|
| `default` | `--action-default` `#282D38` | `#FFFFFF` | none |
| `primary` | `--action-primary` `#FFD54A` | `#1F232D` | none |
| `danger` | `--action-danger` `#FF7893` | `#15181F` | none |
| `ghost` | transparent | `--action-ghost-text` `#7F8596` | 1px `--action-ghost-border` `#3B3F4B` |
| `dashed` | transparent | `--action-ghost-text` | 1px **dashed** `--action-ghost-border` |
| `disabled` | `--action-primary` at reduced opacity | `#1F232D` | — |
| `loading` | Renders `…` in place of the label | — | — |

Radius **8px** on all sizes (**M**).

**Button interaction states (M — measured on the header auth pair and the binder pager):**

- **Hover changes `background-color` only** — no transform, no shadow, no border change.
  `default`: `#282D38 → #3B3F4B` (`--action-default-hover`).
  `primary`: `#FFD54A → #E6CA5B` (`--action-primary-hover`). The tokenised `*-hover` values are
  therefore confirmed as the real hover fills.
- The change is transitioned: **`background-color 150ms ease`**, present on *every* `<button>`
  element on the site.
- **`:active` produces no additional change** — the pressed style equals the hover style. There is
  no `:active` rule anywhere.
- **Focus** shows only the Chromium UA ring; several button classes explicitly set `outline: none`.

Additional button shapes seen in the wild (all **M**):
- **Pill auth buttons** in the header, 115×48, fully rounded.
- **Brand button** — `--action-brand` `#32B5FF` fill, white label ("Test Hand" in the deck dock).
- **Announcement button** — `--announcement-background` `#3F52FF` ("Purchase Deck").
- **Pro buttons** — `--pro-accent` (monthly) and `--pro-pink` (annual).
- **Icon button** — square, sizes matching sm/md/lg, same five variants, radius 8.
- **FAB** — 48×48 `--action-primary`, radius 8, bottom-right of the deck-builder dock.

### 3.10 Form controls
`primitives-showcase--1440.png` @ y 760–1620

| Control | Spec | Conf |
|---|---|---|
| Text input | radius 8, 1px border; **states**: default · `extraDark` (darker fill) · error (border `--action-danger`, helper 12px/400/18px `--error`) · success (border `--success`, helper in `--success`) · disabled | M |
| Field label | 12px/700/18px `--text-muted`, sits above the field | M |
| Clear button | `×` icon button inside the input at the trailing edge | M |
| Select | Same chrome as text input + a trailing `▼` caret; error/disabled states match | M |
| Checkbox | Square, radius ~4, **checked = `--action-primary` fill with a dark tick**; unchecked = white/light fill; disabled = grey fill with a muted tick. Optional two-line label (title 13px/500/16.25px `--text-primary` + sub 12px/400/16.2px `--text-muted`) | M |
| Toggle switch | **38×22px**, radius full, knob ⌀16 white. On-fill is contextual: `--action-primary` `#FFD54A` (Pokédex "Animations") or `--action-brand` `#32B5FF` (Stream Tools options) | M |
| Focus ring | **pkmn.gg has none.** The CSSOM contains 8 `:focus` and 3 `:focus-visible` rules and **every one of them removes the outline** (`outline: none` / `outline-color: transparent`). Text inputs show nothing at all on keyboard focus; buttons and links fall back to the Chromium UA ring. `--border-focus` `#7F8596` exists in the token set but is never applied to a focus state | M |
| **Our addition (I)** | Ship a real focus ring: 2px `--action-primary-strong` at 2px offset (or `--border-focus` on light surfaces), on `:focus-visible` only. This is an accessibility fix, not a fidelity loss — flag it as ours | I |

### 3.11 Tabs
`card-151-006--1440.png` · `profile-collection--1440.png`

Horizontal text tabs, no pill chrome. Strip = `display: flex`, **`gap: 32px`**, 30px tall
(564.16 wide on card detail), over a 1px `--divider-subtle` rule spanning the full width (**M**).
Tab: `padding: 0 0 8px`, icon↔label gap 5px, `cursor: pointer`.
Inactive = 14px/**500**/21px `--text-muted`; active = 14px/**600**/21px `--text-primary` with a
**1px `--action-primary` `#FFD54A` bottom border** (**M** — measured, *not* 2px).

- Card detail tabs: `Card · Price · TCG · Private Notes PRO · Graded PRO`
- Profile tabs: `Profile · Collection · Insights · Activity · Lists · Decks · Friends`
- Pro-gated tabs carry a small `PRO` chip inline after the label (**M**).
- **No hover or focus change measured** on tab items.

Tab contents, measured signed out (**M**):

| Tab | Body |
|---|---|
| `TCG` | Format-legality list — `Standard · Expanded · Gym Leader Challenge · Unlimited`, each with `Legal` / `Not Legal` — then an **"Other Versions"** list (the same card in other sets: art thumbnail + name + price + number) |
| `Private Notes` | Pro upsell card: title, explanatory copy, "Unlock With Pro" button |
| `Graded` | Pro upsell card: "Add a Graded Card" (PSA/BGS/SGC/CGC), "Unlock With Pro" button |
| `Price` | The price-history chart — see §3.16 |

A **second underline weight** exists on the binder's pocket-layout tabs: same text-tab pattern but
**2px** `#FFD54A`, active label 14px/**650**, `padding: 0 0 3px`, items 24px apart (**M**, §3.25).

Separately, **pill tabs** exist for the Pokédex generation switcher: **86×48px**, radius 8, active
= `--action-primary` `#FFD54A` with `#1F232D` label, inactive = `--surface-tertiary` with
`#A0A2A7`-family label; 10-column grid, **8px gap** (**M**).

### 3.12 Pills / chips / badges

| Component | Spec | Conf |
|---|---|---|
| **Back pill** | `← <Destination>` — `--surface-tertiary` fill, pill radius, label 10px/700/31px `--text-primary`, ~28px tall. Appears at the top-left of every detail page | M |
| **PRO chip** | Small rounded rect, `--pro-accent`→`--pro-pink` gradient family, white 9–10px/800 label | M/D |
| **Quantity badge (deck)** | ⌀~36 **circle**, `--action-primary` `#FFD54A`, dark numeral, overlapping the bottom-centre edge of the card image | M |
| **Quantity badge (list)** | Rounded **square** ~24px, `--completion-grandmaster` `#9B6BFF`, white numeral, bottom-right of the card image | M |
| **"+N Variants"** | See §3.2 | M |
| **Attribute chip** (card detail) | `--surface-tertiary` fill, radius 8, ~34px tall, holds e.g. `Fire 🔥`, `330`, `×2`, retreat-cost symbols, `Charmeleon` | M |
| **Level badge (avatar)** | Small yellow pill with the trainer level, overlapping the bottom of the avatar ring | M |
| **Save badge** | `SAVE 20%` — `--pro-pink` fill, white 9px/800 | M |

### 3.13 Modal / sheet
**M — confirmed absent.** The interaction pass actuated every overlay-looking affordance reachable
signed out (advanced search, advanced filters, the sort/variant selects, the view switcher, the
copy-link button, the mobile nav) and **none of them opens a modal, dialog or bottom sheet.** Each is
either a route change or an inline accordion (§3.8). The one place `--overlay-scrim-strong` is
actually used is the binder's empty pockets (§3.25), not a dialog.

The mobile nav drawer is the closest thing to an overlay, and it is deliberately plain: a fixed
275px panel with **no scrim element** (the page content is set to `opacity: 0.2` instead) and **no
transition** (§3.1).

So the following stays **entirely ours (I)** — we are inventing it knowingly, not failing to find it:
desktop = centred panel, `--surface-secondary`, radius 16, `--shadow-elevated`, over
`--overlay-scrim-strong` + `blur(10px)`; mobile = bottom sheet, radius `16px 16px 0 0`, same scrim,
drag handle 4×36 in `--divider-subtle`; entry over `--duration-base` `ease`.

### 3.14 Toast
`primitives-showcase--1440.png` (right side, ~y 830–875)

Pinned **bottom-right**, `z-index: 9999` (**M**). Dark panel, radius 8, `--shadow-sticker`
(`4px 4px 4px 4px rgb(0 0 0 / .25)`), label 14px/700/21px `--text-primary`
("Info: changes saved as a draft."). Variants beyond `info` were **U**; map them to
`--halo-success` / `--halo-error` / `--halo-neutral` backgrounds (**I**).

### 3.15 Table / list rows

| Row type | Spec | Conf |
|---|---|---|
| **Collection row card** (`collections--1440.png`) | 485.13 × **200px**, radius 8, `--surface-tertiary`. Left = card art thumbnail (full-bleed to the card's left edge, ~147px wide). Right = title 18px/550/27px white · date 14px/450/21px `--text-secondary` · description 12px/450/18px `--text-secondary` · a `primary/sm` "View" button (12px/700/18px on `--action-primary`) | M |
| **Set row card** (`series-scarlet-violet--1440.png`) | 482.63 × ~130px, radius 8. Left = set logo over blurred pack art. Centre = set name 16px white + release date 12px `--text-muted`. Right = white set-symbol tile ~40px | M/D |
| **Set-progress card** (`profile-squalls--1440.png`) | 326.19 × ~185px, radius 8, **full-bleed blurred set art + dark scrim**. Top-left = set name 18px/500/23px + date 14px/500/17px. Top-right = white set-symbol tile ~28px. Bottom = the §3.6 progress cluster inline | M |
| **Deck-list row** (`home--1440.png`, deck mock) | Two columns `Name | Qty`; name 12–14px white, qty = inline `[−] n [+]` stepper. Header row in `--text-muted` | M |
| **Trend row** (`pro--1440.png` @ x 960–1420, y 1040–1400) | Card thumbnail ~24×33 radius ~3 · direction caret · delta amount. **Increase** = ▲ + `--change-positive`; **decrease** = ▼ + `--change-negative` (rendered warm-orange in situ). Panel is split into "Top Increases" / "Top Decreases" columns with a small sort-arrow icon per header | M |

### 3.16 Price display & trend indicator

- **Every** price on the site renders in `--change-positive` `#35F197`, *including* neutral prices
  (card tile prices, deck price, full-set market value). Green here means "money", not "up" (**M**).
- Missing price renders as `N/A` in `--text-muted` (**M**).
- Trend = caret glyph + delta, coloured `--change-positive` / `--change-negative` (**M**).
- Card detail shows a "Prices updated **15 hours ago**" freshness line, 12px, with the relative
  time bolded (**M**), plus the affiliate disclosure beneath.

#### Price-history chart (card detail → `Price` tab)
`interactions/screens/pricetab-{charizard,bulbasaur}-full.png` · `pricechart-tooltip-crop.png`

**M — the whole chart is painted into a single `<canvas>`, 564 × 300 CSS px with a 564 × 300 backing
store (no DPR scaling).** Not SVG, not a charting library's DOM. Axes, gridlines, legend and tooltip
are all canvas draws, so none of it is inspectable as elements — the values below come from element
measurement of the surrounding chrome plus **pixel-histogram sampling of the canvas itself**.

| Element | Spec | Conf |
|---|---|---|
| Range selector | Segmented control, track **300 × 41**, radius 8; four equal segments **74.75 × 39**, `padding: 0 12px`. Options `30 Days · 3 Months · 6 Months · 1 Year` | M |
| Range — active | `--action-primary` `#FFD54A` fill, label **12px/700** `--action-primary-text` `#1F232D` | M |
| Range — inactive | `--surface-tertiary` `#282D38` fill, label **12px/600** `--text-secondary` `#989EB3` | M |
| Range — end caps | The directional radii from §1.5: first segment `8px 0 0 8px`, last `0 8px 8px 0` | M |
| Series | One **smooth spline** line per variant, ~2px, **no area fill, no resting point markers** | M |
| Series colour | **The variant accent** — Normal `#FFE165` · Reverse Holofoil `#32B5FF` · Holofoil `#9B6BFF` · Stamp / other **`#A8AEBD`**. (`#A8AEBD` is a *new* colour, absent from the 77-token set — flag it) | M |
| Gridlines | Horizontal **and** vertical, 1px, `--surface-tertiary` `#282D38` — the most common colour in the canvas by pixel count | M |
| Y axis | Currency labels on the left at even steps (`$7.00…$10.00` by $0.50 over 30 days; `$0.00…$70.00` by $10 over 1 year), ~10px, `#A8AEBD`-family grey | M |
| X axis | Date labels `M/D`, **rotated ≈ −30°** when dense, same grey | M |
| Legend | Inline row at the **top-right inside the plot**: **4 × 4 px square swatch** (no radius) + label 10px/550 `--text-primary` | M |
| Tooltip | Canvas-drawn rounded panel, fill **`rgba(0, 0, 0, 0.8)`**, anchored beside the hovered x. Line 1 = full date, bold white ("July 06, 2026"); line 2 = swatch + `"<Variant> Market Price: $8.78"`. A filled point marker in the series colour appears on the line at the hovered x. **There is no DOM tooltip element** | M |
| Per-variant block below the chart | One per variant, 122px apart: swatch + variant name (10px/550 white), then two stat cards side by side — **194.08 × 72**, `--surface-tertiary`, radius 8, `padding: 12px 16px`; label 12px/600 `--text-secondary`, a 10px/450 range chip right-aligned on the same line, value below with a ▲/▼ caret (`--change-positive` up, warm orange down). A TCGplayer button sits at the right of each block | M |
| Empty / insufficient-data state | — | **U** — every card × every range tried returned a populated series |

**For DeckScout:** canvas is the right call for a 300-point series on a Pi-served page, but we should
render at `devicePixelRatio` (pkmn.gg does not, and their chart is visibly soft on retina). Keep the
"series colour = variant accent" rule — it is what ties the chart to the rest of the design system.

### 3.17 Avatar, banner, profile header
`profile-squalls--1440.png`, `profile-collection--1440.png`

| Element | Spec | Conf |
|---|---|---|
| Banner image | **990.25 × 247.56**, exact **4:1**, `border-radius: 16px 16px 0 0` | M |
| Avatar | **80×80**, `border-radius: 60px` (i.e. circular), sitting on a ring in `--avatar-ring-color` `#282D38`; overlaps the banner's bottom edge | M |
| Level badge | Yellow pill under the avatar showing the trainer level (e.g. `646`) | M |
| Display name | ~32px/700 `--text-primary`, centred under the avatar | M/D |
| PRO chip | Directly under the name | M |
| Left stats | `Joined` / `Friends` — label 12px/600/18px `--text-muted`, value 18px/700/27px `--text-primary`, separated by a vertical hairline | M |
| Right actions | Social link buttons ~36×36, radius 8, brand-coloured (X `#000`, Twitch violet, YouTube red) | M/D |
| Tabs | §3.11 | M |

### 3.18 Stat cards (profile left rail)
`profile-squalls--1440.png` @ y 700–1100

Stacked `--surface-tertiary` cards, radius 8, ~326px wide:
1. **Bio card** — 12px/550/22px copy with inline `--link-color` links.
2. **Collection value card** — centred label 12px/600/18px `--text-muted` over a large
   `--change-positive` figure (~24px/700), plus a small ghost "Value History" button with a
   leading sparkle icon.
3. **Catalogue card** — "English TCG" header; a two-column `Total Cards` / `Unique Cards` pair;
   then an **energy-type count grid** (3 columns) of `[type icon] [count]` pairs, one per energy
   type, with the type icon at ~16px.

### 3.19 Pokédex sprite tile
`pokedex--1440.png`, `pokedex--390.png`

| Property | Value | Conf |
|---|---|---|
| Tile | **207.81 × 169.5 px**, `--surface-tertiary` `#282D38`, radius 8 | M |
| Grid | Same 4-column / **53px** column / **30px** row grid as the card grid | M |
| Sprite | Animated GIF, intrinsic size preserved (45×49 … 106×77), centred, no radius, no scaling | M |
| Name | 14px `--text-primary`, centred | M |
| Number | 12px `--text-muted`, centred, below the name | M |
| Caught / uncaught / shiny states | — | **U** — the capture was signed-out, so every tile rendered in its default (colour) state. The marketing mock in `home--1440.png` shows a **caught** tile with a thin yellow level bar and "Lvl 4 /10 · Collect 1 to Level Up" beneath the name. **Proposal (I):** uncaught = sprite at `filter: grayscale(1) brightness(0.6)` + tile at `--surface-tertiary-subtle`; caught = full colour; shiny = full colour + `--overlay-circle-ring` glow behind the sprite |
| Animations toggle | A 38×22 toggle labelled "Animations" above the grid switches sprite animation on/off | M |

### 3.20 Trainer / Pokémon level bar
`home--1440.png` (Pokédex marketing mock, y≈2500–2900)

Thin (~4px) full-radius track inside the sprite tile, filled in
`--action-primary-strong`; label "**Lvl 4** /10" (level bold white, denominator `--text-muted`),
sub-label "Collect 1 to Level Up" 9–10px `--text-muted` (**M** from the mock, **I** for exact
metrics — this component never rendered on a live signed-out page).

### 3.21 Empty state
`lists--1440.png`, `primitives-showcase--1440.png`

Centred column: illustration image (315×188 rendered from a 1300×1100 source, `object-fit:
contain`) → title 24px/700/36px `--text-primary` → body 14px/500/21px `--text-muted` → a single
`default/md` action button. In the primitives gallery the same component is shown inside a
`--surface-tertiary` card with `--shadow-sticker` (**M**).

### 3.22 Loading / skeleton

- **Card skeleton** (**M**, `primitives-showcase--1440.png` @ y 1700–1900): a card-shaped block in
  `--surface-tertiary` with a rounded rect standing in for the artwork and 1–4 bar placeholders
  for the footer lines. Two densities exist (4-line and 1-line).
- **Loading logo** (**M**): a `<video autoplay loop playsinline preload="metadata">` element
  wrapping a `.webm`, keyed `loading-logo` / scheme `dark` / `variant-2`, rendered at **64 × 64**.
  This is pkmn.gg's page loader — an animated brand mark, not a spinner. For DeckScout, ship a small
  looping animated brand `.webm` (with an `<img>` fallback) rather than a generic spinner.
- **First paint is a full-viewport brand splash, not a skeleton** (**M**, captured under a throttled
  connection, `interactions/screens/loading-4000ms.png`): the whole viewport is
  `--surface-secondary` `#1F232D` with the centred `pkmn.gg` wordmark plus the 64px loading `.webm`.
  No route-progress bar renders, despite a spinner keyframe being defined in the stylesheet.
  The card skeleton's shimmer is a `left: -100% → 100%` sweep (**M**, keyframe body) — it exists for
  in-app data fetches after first paint, and did not render during any captured page load.

### 3.23 Deck builder dock
`trydeckbuilder--1440.png` @ y 750–900

A bar pinned to the bottom of the deck-builder viewport: `0/60 Cards` count (count bold white,
remainder `--text-muted` 10px) over a thin progress track; `Deck Price` label + green figure on
the right; a `--action-brand` "Test Hand" button on the left; a 48×48 `--action-primary` scroll-to-
top FAB at the far right. Format legality renders as `Legal Status: <value>`, with an illegal
deck shown in `--action-danger` (**M**, from the `home--1440.png` deck mock).

### 3.24 Card detail layout
`card-151-006--1440.png`, `card-151-006--390.png`

Two-column at desktop: hero card image left (~396×555, radius 8, intrinsic 400×557.33), detail
column right. Behind everything sits the card's own artwork, **heavily blurred**, faded out with
`--banner-gradient-top` (**M**). Right column order: H1 (~40px) · set-symbol tile + set-name link
(`--link-color`) · `#006/165` in `--text-muted` · tab strip · variant table · marketplace buttons
· freshness + affiliate note · attack list · attribute grid (2 columns, `column-gap: 40px`,
`row-gap: 32px`, container 564.2px). A small circular "copy link" icon button sits top-right.

### 3.25 Binder view — the signature component
`interactions/screens/binder-clean-9-Pocket.png` · `binder-9pocket-spread.png` ·
`binder-9pocket-lower.png` · `binder3-{12,16}-Pocket.png` · `binder-390.png`

**M — renders fully signed out on a public set page.** Page 1 only; `Next` is Pro-gated. The Pro
gate is a single line of copy under the pager ("Unlock Binder View with `PRO`", 14px/650
`--text-primary`, full content width) — the binder itself is **not** blurred or scrimmed.

**Pocket-layout switcher** — a text-tab row above the binder, items **24px** apart:
`9-Pocket · 12-Pocket · 4-Pocket · 16-Pocket`. Active = 14px/650 `--text-primary` with a **2px
`#FFD54A` bottom border**, `padding: 0 0 3px`; inactive = 14px/500 `--text-muted` (**M**).

**Two-page spread — 9-Pocket and 4-Pocket only.** Left and right page panels sit side by side and
together fill the 990.25px content column exactly, with a ≈5px gutter between them. 12- and
16-Pocket render as a **single full-width page** instead.

| | 9-Pocket | 4-Pocket | 12-Pocket | 16-Pocket |
|---|---|---|---|---|
| Pages shown | 2 (spread) | 2 (spread) | **1** | **1** |
| Pocket grid | 3 × 3 | 2 × 2 | 4 × 3 | 4 × 4 |
| Page panel @1440 | 492.63 × 689.77 | 492.63 × 677.67 | 990.25 wide | 990.25 wide |
| Pocket cell | 132.53 × 203.25 | 207.31 × 309.83 | 211.50 × 312.55 | 211.50 × 311.35 |
| `column-gap` / `row-gap` | 17 / 22 | 17 / 22 | 10 / 15 | 10 / 15 |
| Page padding | `18px 17px 18px 44px` | same | `12px` | `12px` |

All **M**. Every page panel: `border-radius: 16px`, background `--surface-primary` `#15181F`,
**`box-shadow: none`**.

| Property | Value | Conf |
|---|---|---|
| Page padding asymmetry | The **44px** side is always the **spine** edge, 17px the outer edge, 18px top and bottom — mirrored between the two pages. This asymmetry is what makes the spread read as a physical binder | M |
| Card image in a pocket | Fills the **cell width exactly** (132.53 of 132.53), `aspect-ratio: 300 / 418`, `border-radius: 8px`. The cell is ≈18px taller than the image | M |
| Left page, fresh binder | **Zero pockets** — a blank inside-cover panel. Slots start on the right page | M |
| **Empty / not-owned pocket** | The card artwork renders, then an absolutely-positioned scrim of **`rgba(21, 24, 31, 0.75)`** — exactly `--overlay-scrim-strong` — at **`border-radius: 6px`**, `z-index: 1`; a "Slot" / "#N" label block (`z-index: 2`, ≈58px tall, vertically centred) sits over it | M |
| Pager | Right-aligned under the right-hand page, in a 492.63 × 88.13 row. `Page 1` label 14px/700 `--text-muted`; `Next` button **81.45 × 50**, `--surface-tertiary` `#282D38`, label `--text-secondary` `#989EB3` 14px/700, radius 8, `padding: 15px`, `gap: 8px`, `transition: background-color 150ms ease`. **No `Previous` control on page 1** | M |
| Page-turn animation | **None measured** — no transition, no keyframe on any binder element | M |
| `Stack Variants:` control | Label 14px/600 `--text-primary` + a **38 × 22** toggle switch (the §3.10 toggle), on-fill violet | M |
| `Additional Variants` select | A `Hide` / `Inline` / `End` select to the right, captioned "Additional Variants" beneath | M |
| @390 | The spread collapses to a **single page**; 9-Pocket still 3 pockets across, card image 104.92 × 146.67. The page-panel element is not present at that width | M |
| Layout reflow | At 12-/16-Pocket the `Stack Variants` control moves **above** the select instead of beside it | M |

**For DeckScout:** this is the highest-value component to get right, and it is more than a 9-up grid —
the spread, the spine-side padding asymmetry, the four pocket densities, and the scrimmed
"Slot #N" empty pocket are what make it read as a binder. Note that pkmn.gg's page turn is a plain
re-render; a real page-turn animation would be **ours (I)**.

### 3.26 Table view
`interactions/screens/view-table-1440-rows.png`

**M — renders signed out.** There is **no `<table>` element**; it is a flex column of per-card
groups (`gap: 20px`). Each group:

1. A full-content-width (990.25) **header bar**, radius 8, carrying the card's own artwork bleeding
   in from the left edge (≈48px crop), then the card name 14px/500 `--text-primary` at x≈408, then
   the card number.
2. **One row per variant** beneath it, row pitch ≈48px, **no rules and no zebra striping**:
   variant name 14px semi-bold white over a ≈10px `--text-muted` sub-label ("Found in Booster
   Packs", "Best Buy 151 Stamp", "Reverse Holo \"EB Games\" stamp (Australia & NZ)"), the price in
   `--change-positive`, then a TCGplayer mark + an external-link icon.

Signed out there is **no Quantity column** — the `Variant | Market Price | Quantity` header noted in
§3.5 belongs to the *card-detail* variant table, not to this view (**M**, corrects the first pass).

---

## 4. Layout system

### 4.1 Page shell

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER — fixed, 78px + 1px border, z 20                     │
├────────────┬─────────────────────────────────────────────────┤
│ SIDEBAR    │  MAIN                                           │
│ fixed      │  x = 275 … 1440   (width 1165 @1440)            │
│ 274px      │  ┌───────────────────────────────────────────┐  │
│ + 1px      │  │ CONTENT COLUMN = 85 % of MAIN = 990.25px  │  │
│ border     │  │ (centred → ~87.4px gutter each side)      │  │
│ z 20       │  └───────────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────────┘
```

**M** — the content column is **exactly 85 % of the main column**: 1165 × 0.85 = **990.25px**, and
that number reconciles perfectly with every grid on the site:

| Grid | Arithmetic | = |
|---|---|---|
| Card grid | 4 × 207.812 + 3 × 53 | 990.25 |
| Deck grid | 4 × 232.562 + 3 × 20 | 990.25 |
| Profile collection | 4 × 236.312 + 3 × 15 | 990.25 |
| Collections / profile lists | 2 × 485.125 + 20 | 990.25 |
| Series set list | 2 × 482.625 + 25 | 990.25 |
| Series index | 3 × 314.078 + 2 × 24 | 990.23 |
| Card-detail attributes | 2 × 262.078 + 40 | 564.16 (of a 564.2 sub-column) |

So: **gutters are proportional (7.5 % each side), not fixed.** Reproduce with
`width: 85%; margin-inline: auto` on the content column, then a per-page `max-width` cap.

### 4.2 Per-page max-width caps (**M**)

| Page | Cap | Actual width @1440 |
|---|---|---|
| Profile | 1200px | 990 |
| Home (marketing) | 1300px | 932–1049 |
| Deck builder, Pro benefits | 1400px | 990 / 932 |
| Stream tools | 1600px | 990 |
| Auth | 1920px | 1296 |
| Changelog article | 800px | 800 |
| Card changelog | 900px | 900 |
| Pokédex generation panel | 480px | 480 |
| Pro plan card | 428px | 428 |
| Pokémon detail body | 850px | 850 |

`<main>` itself uses `padding: 24px; gap: 48px; display: flex; flex-direction: column`
(**M**, from the primitives page).

### 4.3 Breakpoints

**M — measured by a 60-width sweep from 360 → 1920 (32px steps, then binary-refined to 1px) on the
set page.** The earlier `sm 576 / md 768 / lg 992 / xl 1200` unistyles ladder is **wrong**; do not
implement it.

| Breakpoint | Value | What changes | Conf |
|---|---|---|---|
| `--breakpoint-nav` | **1068px** | **The only real layout breakpoint.** At ≤1067 the sidebar is absent and a hamburger shows; at ≥1068 the 274px rail renders and the hamburger disappears. Corroborated by a literal `(min-width: 1068px)` media query in the stylesheet | M |
| `--breakpoint-gap` | **567px** | Card-grid **column gap 23px → 53px**, and the grid's minimum tile width steps from ≈150px to 200px. Corroborated by `(max-width: 566px)` / `(min-width: 567px)` media queries | M |

**Everything else is fluid, not breakpointed.** Column counts, tile widths and gutters are all
computed continuously — see §4.4. There is no `sm`/`md`/`lg`/`xl` ladder to reproduce.

The content column is likewise proportional at every width (**M**):
**92 % of the viewport** when the sidebar is hidden, **85 % of the main column** (i.e. of
`viewport − sidebar`) when it is shown.

### 4.4 Card-grid column counts

**M — the grid is fluid.** The rule that reproduces every measured width:

- **minimum tile width 200px** (≥567) / **≈150px** (<567) — as many columns as fit;
- **maximum tile width 300px** — past that, surplus space goes into the **gap**, not the tile;
- **column gap fixed at 53px** (≥567) / **23px** (<567), except where the 300px cap widens it;
- **row gap fixed at 30px**;
- content column 92 % of viewport (no sidebar) / 85 % of main (sidebar).

Measured bands on the set page:

| Viewport | Sidebar | Cols | Tile width | Col gap | Content width | Conf |
|---|---|---|---|---|---|---|
| 360 – 539 | hidden | 2 | 154 → 228 | 23 | 92 % of vw | M |
| 540 – 566 | hidden | 3 | ≈154 | 23 | — | M |
| 567 – 767 | hidden | 2 | 238 → **300 (capped)** | 53 → 69 | — | M |
| **768** | hidden | **3** | 200.17 | 53 | **706.55** | M |
| 769 – 1042 | hidden | 3 | 200 → 281 | 53 | — | M |
| **1024** | hidden | **3** | 278.69 | 53 | **942.08** | M |
| 1043 – 1067 | hidden | 4 | ≈205 | 53 | — | M |
| **1068** | **shown** | **2** | 300 (capped) | 75.8 | **698.69** | M |
| 1069 – 1105 | shown | 2 | 300 | 76 → 92 | — | M |
| 1106 – 1403 | shown | 3 | 206 → 279 | 53 | — | M |
| 1404 – 1700 | shown | 4 | 203 → 257 | 53 | — | M |
| **1440** | shown | **4** | **207.81** | 53 | **990.25** | M |
| ≥1701 | shown | 5 | 200 → 237 | 53 | — | M |
| **1920** | shown | **5** | 237.25 | 53 | **1398.25** | M |
| **390** | hidden | **2** | **167.89** | **23** | **358.80** (gutter 15.59 = 4 % each side) | M |

Note the **column-count *drop* at 1068**: the sidebar appears and eats 274px, so the grid falls from
4 columns back to 2. That discontinuity is real and worth reproducing or deliberately avoiding.

Other measured mobile grids: deck grid @390 = 2 cols, 16px gutter, ~20px gap (**M**);
Pokédex grid @390 = 2 cols, **32px** gutter, ~29px gap, tile ~148px wide (**M** — note the
Pokédex page uses different gutters from the set page).

**Implementation (D — arithmetic on the measured rule):**
`grid-template-columns: repeat(auto-fill, minmax(200px, 300px)); column-gap: 53px; row-gap: 30px;
justify-content: space-between`, dropping to `minmax(150px, 1fr)` and `column-gap: 23px` below 567px.

Other measured breakpoint behaviour: the home `<h1>` is **45px / 55px** at both 768 and 1024
(vs 72/84 at 1440); card detail is single-column with a **450px** hero image at both 768 and 1024
(**M**).

### 4.5 Sticky / fixed behaviour (**M** unless noted)

- **Header** — fixed to the top, full width, z 20. Proven by its single appearance in a
  21 303px-tall full-page capture.
- **Sidebar** — fixed to the left, viewport-height, z 20. Same proof.
- **Deck-builder dock** — pinned to the bottom of the viewport (`trydeckbuilder--1440.png`).
- **Toast** — fixed bottom-right, z 9999.
- **Filter/sort chip row** — horizontally scrollable within its own container; **not** sticky in
  any capture.
- **Scroll-to-top FAB** — bottom-right of the deck-builder dock.
- Nothing else is sticky in the captures. Whether the set-page filter bar becomes sticky on
  scroll is **U**.

---

## 5. Per-screen layout notes

Route map (**M**, all 24 captures): `/` · `/series` · `/series/<series>` ·
`/series/<series>/<set>` · `/series/<series>/<set>/<number>` · `/collections` · `/lists` ·
`/lists/<uuid>` · `/decks/<uuid>` · `/trydeckbuilder` · `/pokedex` ·
`/pokedex/generation/<n>` · `/pokedex/<name>` · `/u/<username>[?tab=…]` · `/pro` ·
`/stream-tools` · `/auth/signin` · `/auth/register` · `/changelog[/<slug>]` · `/card-changelog`.
**DeckScout's IA should mirror this**, minus the multi-language TCG splits we don't need.

### 5.1 Home — `home--1440.png` · `home--390.png`
- **Header:** standard shell.
- **Regions:** full-bleed hero (`2831×939` webp, `object-fit: cover`, rendered 1165×545) with a
  72px/700/84px H1 (one word coloured `--action-primary`) → 18px/400/31px lede → primary CTA →
  "It's **100 % Free** to Join!" → Google Play badge → then six alternating feature sections, each
  = 56px/700/64px heading + 15px/400/35px copy + bullet list + CTA on one side, and a **looping
  `.webm` product demo on a coloured slab** (indigo / green / magenta / violet) on the other.
- **Grid:** none — flex column, container capped at 1300px.
- **Notable:** these demo slabs are the *only* place several signed-in components are visible
  (quantity stepper, filled progress bar, owned badges, deck dock, Pokémon level bar). They are
  the primary evidence for §3.4, §3.6 and §3.20.
- **Mobile (`home--390.png`, 6 711px tall):** single column; H1 wraps to 4 lines and drops to
  ~36px; CTA becomes full-width with 16px gutters; feature slabs stack vertically full-bleed.

### 5.2 Set page — `set-151--1440.png` · `set-151--390.png`
- **Header:** shell + blurred set art behind the top block.
- **Region order:** set banner (logo · Shop/Purchase Set · set-symbol tile · progress cluster) →
  6-column stat strip → search + sort chips → view toggle (right-aligned) → card grid.
- **Grid:** 4 × 207.81, `gap: 30px 53px`.
- **Affordances:** per-card variant badges and the quantity stepper (signed-in only); Grid /
  Table / Binder switch.
- **Mobile:** set logo centres; Shop / Purchase Set become a 2-up row; the stat strip collapses to
  3 columns with hairline dividers and wraps; the sort-chip row scrolls horizontally (the first
  chip is visibly clipped at the right edge); view toggle centres; **card grid → 2 columns**,
  16px gutters, 22px gap. Full page height 33 884px.

### 5.3 Card detail — `card-151-006--1440.png` · `card-151-006--390.png`
- See §3.24 for the desktop composition.
- **Mobile:** single column — hero card image full-width (16px gutters) on the blurred-art
  background, then title (24–28px) with `#006/165` right-aligned on the same line, set-symbol tile
  + set link, copy-link icon button right-aligned on its own row, then the tab strip (which
  scrolls horizontally), then the variant table as stacked rows. Page height 2 354px.

### 5.4 Pokédex index — `pokedex--1440.png` · `pokedex--390.png`
- **Header:** shell. Page title 24px + a `--link-color` inline CTA in the subtitle.
- **Regions:** title/subtitle → right-aligned "Animations" toggle → generation pill tabs (10-col
  grid, 86×48, 8px gap) → "Search Pokémon…" input → sprite tile grid.
- **Grid:** sprite tiles on the same 4 × 207.81 / 53 / 30 grid.
- **Mobile:** generation tabs reflow to a **3-column** grid; search input full-width; sprite grid
  **2 columns** with 32px gutters and ~29px gap. Page height 15 649px.

### 5.5 Pokémon detail — `pokedex-charizard--1440.png`
Back pill → sprite panel (target sprite centred, previous/next evolution sprites flanking it in
smaller side panels) → circular type-icon discs + `#0006` in `--link-color` → H1 ~32px → 5-column
stat strip with hairline dividers (Number · Total Cards · Types · Height · Total Market Value) →
sort chips → view toggle → card grid (4 × 207.81). 24 698px tall — this is the heaviest page on
the site; it must be virtualised in our build.

### 5.6 Collections — `collections--1440.png` · `collections--390.png`
Back pill ("← All Series") over a full-bleed blurred hero → H1 48px/800/58px → 16px/500/24px
subtitle → 2-column grid of collection row cards (485.13 × 200, 20px gaps).
**Mobile:** hero shrinks, H1 stays large, cards go **1 column** full-width with the thumbnail
still on the left. Page height 4 155px.

### 5.7 Series index & set list — `series--1440.png` · `series-scarlet-violet--1440.png`
- `/series`: 3-column grid of series tiles (314.08, 24px gaps).
- `/series/<series>`: back pill → series logo (310.84 × 89.98) on blurred art → 2-column grid of
  set row cards (482.63, 25px col / 24px row gap).

### 5.8 Lists — `lists--1440.png` (signed-out) · `list-public--1440.png`
- `/lists` signed-out: full-bleed 1165×300 banner → centred empty state (§3.21) → footer.
- `/lists/<uuid>`: back pill → H1 48px → 4-column stat strip (Created By · Created On · # of Cards
  · Full List Market Value) + copy-link icon button → list description → search + sort chips
  (leading chip is "Custom", i.e. manual ordering) → view toggle → card grid (4 × 207.81) where
  each tile additionally shows a **purple quantity badge** and a **variant name in its accent
  colour** under the number row.

### 5.9 Deck — `deck-public--1440.png` · `deck-public--390.png`
Back pill ("← My Decks") on blurred art → H1 48px/800/58px → 5-column stat strip with hairline
dividers (Created By *with avatar* · Format · Created · Updated · Deck Price in green) → action
button row (Test Hand ✋ · Export to PTCGLive ⬆ · Purchase Deck ⚡ · Image 🖼, all `default/lg` with
trailing icons) → per-supertype sections, each headed `Pokémon (17)` / `Trainer (35)` /
`Energy (n)` in 18px/700/27px with a **1px rule running from the label to the right edge** →
4-column card grid (232.56, 20px gaps) with a yellow circular quantity badge on each card.
**Mobile:** stat strip scrolls horizontally (visibly clipped); the four action buttons **stack
full-width**; card grid → 2 columns. Page height 5 998px.

### 5.10 Deck builder — `trydeckbuilder--1440.png`
Blurred hero → H1 48px with a top-right "Sign Up to Create Decks" CTA → subtitle → a row of
[search input | format select] → `--surface-tertiary` filter panel with 4 selects and the
"Advanced Filters ⌄" tab hanging off its bottom edge → sort chips (7) → results area (empty-state
brand mark when nothing is searched) → **bottom-pinned deck dock** (§3.23).

### 5.11 Profile — `profile-squalls--1440.png` · `profile-collection--1440.png` · `profile-lists--1440.png`
Banner 4:1 with radius `16px 16px 0 0` → avatar + level badge + name + PRO chip, stats on the
left, social buttons on the right, all inside one `--surface-tertiary` card → tab strip →
tab body:
- **Profile:** two columns — left rail of stat cards (§3.18, 326px), right = showcase card strip
  (4 cards + a circular next-chevron) then a 2-column grid of set-progress cards (326.19, 24px
  gaps) filtered by two selects (`English TCG`, `Mega Evolution`).
- **Collection:** search input → sort chips (**Pro-gated: blurred + overlay**) → 4-column card
  grid at 236.31 with 15px gaps.
- **Lists:** 2-column grid of list row cards (485.13, 20px gaps).

### 5.12 Pro — `pro--1440.png`
Indigo/violet patterned hero → gradient "PRO MEMBERSHIP" wordmark plate → two plan cards
(`$5/mo` monthly with a `--pro-accent` button; `$4/mo` annual with a `--pro-pink` button and a
`SAVE 20%` badge) separated by a small "or" → "Pro Membership Benefits" → 2-column benefit grid,
each = 200×100 illustration + 18px title + 14px body → a features/comparison strip lower down.

### 5.13 Stream tools — `stream-tools--1440.png`
Banner → H1 48px → subtitle → two columns: left = configuration (section title 18px, description,
"Recommended OBS size: 450×450", a [TCG select | set select] pair, a full-width
`--action-primary` "Open Overlay URL" button, then five `--action-brand` toggle switches with
14px labels, then a `Background Opacity` select), right = a live **Preview** panel
(`--surface-tertiary`, radius 8) rendering the overlay itself: set logo, `0/207 Collected`,
progress cluster, "Powered By pkmn.gg".

### 5.14 Auth — `auth-signin--1440.png`, `auth-register--1440.png`
**No header, no sidebar, no footer** (78–79 measured elements total vs 400–4 800 elsewhere) —
a standalone shell on `--surface-secondary`. Two-column split inside a 1296px container:
left = a full-height rounded artwork panel (a looping `.webm` of starter Pokémon);
right = a **light card** on `--surface-on-light` `#F7F9FF` with radius ~16, containing brand
lockup → "Log In" (~28px/700, `--surface-on-light-text`) → three OAuth buttons (Google / Discord /
Apple, each full-width, ~44px, radius 8, with their own brand tokens) → an "or" divider →
explanatory copy → email input → a full-width `--action-primary` "Send Magic Link" button →
`Need an Account? **Sign Up Free**` / `Just looking to browse? **Go Back Home**` links in
`--link-color` → legal microcopy.

> This screen is the single strongest proof that `--surface-on-light-*` is a *surface role*, not a
> theme: the rest of the page around this card stays dark.

---

## 6. Iconography & imagery

### 6.1 Icons (**M**)

- **All icons are inline SVG**, mounted through one component that takes: an icon key, a colour
  scheme, and up to three colour inputs (resting / fallback / hover). Icons declare
  `role="img"` + `aria-label`, or `aria-hidden="true"` when decorative.
- **Sizing is set per-instance in px** (not by a t-shirt scale). Observed heights:
  `7 · 12 · 15 · 16 · 20 · 24 · 25 · 26 · 28 · 30 · 33 · 37.67 · 47.56 · 72`.
  The de-facto default is **24px** for nav and **16px** for inline UI. The primitives gallery
  demonstrates 24 / 32 / 40 as the canonical trio.
- Icons are sized by either `height` or `width` (never both) so the SVG viewBox drives the other
  axis. ViewBoxes are per-icon (`0 0 24 24`, `0 0 16 20`, `0 0 110 27`, `0 -28.5 256 256`).
- **Stroke vs fill:** **U** — the SVG geometry was not captured. Visually the set reads as a
  **filled/solid** family with occasional 2px strokes; there is no thin-line/outline look.
- **Two-layer hover:** some icons render `resting` and `hover` layers as sibling spans and
  cross-fade, rather than recolouring a single path.
- **Icon inventory** (**M**, 54 distinct keys) grouped:
  - brand — `brand-icon`, `brand-logo`, `logo-pkmnggpro`, `pro-membership`, `pro-savings-flag`
  - nav — `nav-series-sets`, `nav-japanese-series-sets`, `nav-tcg-pocket-nav-icon`, `nav-lists`,
    `nav-deckbuilder`, `nav-pokedex`, `nav-stream-tools`, `nav-discord`, `nav-merch-icon`,
    `nav-collapse-left`, `nav-back-arrow`, `nav-sliders-horizontal`
  - ui — `ui-search-icon`, `ui-burger`, `ui-x`, `ui-yes`, `ui-no`, `ui-warning`, `ui-link-icon`,
    `ui-link-out`, `ui-right-arrow`, `ui-up-caret`, `ui-down-caret`, `ui-arrow-drop-up`,
    `ui-arrow-drop-down`, `drop-down-icon`
  - views — `views-grid`, `views-table`, `views-binder`
  - decks — `decks-hand`, `decks-pc`, `decks-image-generate`
  - progress — `progress-tl-progress-2`, `progress-tl-progress-7`, `profile-graph`
  - types — `type-fire`, `type-flying` (Pokédex creature types; more exist off-capture)
  - marketplace — `logo-tcgplayer`, `logo-ebay`
  - social — `social-discord`, `social-twitter`, `social-x`, `social-tiktok`, `social-instagram`,
    `social-facebook`, `social-twitch`, `social-youtube`, `social-google`, `social-apple`

### 6.2 Set symbols & set logos (**M**)

| Asset | Path shape | Rendering |
|---|---|---|
| **Set logo** | `…/images/sets/logos/<setCode>.webp` | Intrinsic **220×167** (ratio 1.3174); rendered 105–310px wide depending on context; **no radius, no crop**, always on top of blurred pack art |
| **Set symbol** | Small monochrome mark | Always inside a **`--surface-on-light` white rounded square**: **40×40** in set headers and card detail, **~28×28** on set-progress cards |
| **Series logo** | `…/images/series/logos/<slug>.png` | e.g. 898×260, rendered ~311×90 |

Set-code examples worth noting for our own data mapping: `sv3pt5` (151),
`sv10pt5_blk` / `sv10pt5_wht` (Black Bolt / White Flare).

### 6.3 Card images (**M**)

| Property | Value |
|---|---|
| Source shape | `…/fit-in/<W>x<H>/filters:format(webp)/images/cards/<set>/<set>-<num>.png?signature=…` |
| Grid thumbnail | requested `300×418`, delivered `299×418` |
| Rendered in grid | 207.81 × 290.52, `border-radius: 8px`, `object-fit: fill` |
| Rendered on detail | ~396 × 555 (intrinsic ratio 400 : 557.33) |
| Container ratio | `aspect-ratio: 0.714286 / 1` (= 5 ∶ 7) on skeleton/placeholder containers |
| Shadow | **None** on grid tiles — the tile reads flat against `--surface-secondary` |
| Holo treatment | **U** — no shine/tilt/holo effect is applied. Holo-ness is carried by the artwork itself and by the variant accent colour |

**For DeckScout:** replicate the resize service locally. Cache two derivatives per card —
`300×418` (grid) and `600×836` (detail) — plus the original. Serve WebP with a PNG fallback.
Preserve `border-radius: 8px` and `object-fit: fill` so the rounded corners of the physical card
art line up with our own corner radius.

### 6.4 Sprites & other imagery (**M**)

| Asset | Path shape | Notes |
|---|---|---|
| Pokémon sprite | `…/animated/<name>.gif` | Animated GIF at intrinsic size (45×49 → 106×77), never scaled |
| Page banner | `…/assets/<key>/dark/<variant>-v<n>.<ext>` | 1165×300 rendered, `object-fit: cover`, source 1300×500 |
| Profile banner | `…/avatars/default_banners/<n>.png` | 1200×300, exact 4:1, radius `16px 16px 0 0` |
| Avatar | `…/avatars/<hash>/<file>.png` | 100×100 source → 80×80 rendered, circular |
| Product demos | `…/assets/home-feature-*/dark/variant-N-vM.webm` | Looping muted `<video>`, not GIF |
| Loading logo | `…/assets/loading-logo/dark/variant-2-v4.webm` | `<video autoplay loop playsinline preload="metadata">` |
| Pro benefit art | `…/assets/pro-benefit-*/dark/default-v2.png` | 200×100, `object-fit: contain` |
| Energy types | `…/assets/type-energy-<type>/dark/default-v<n>.png` | 11 types, PNG |

Note the **`-v<n>` suffix on every asset filename** — a content-hash-free cache-busting scheme.
Adopt it: our image cache should version assets in the filename so we can serve them immutably.

### 6.5 Placeholder / loading treatment

- Card skeletons: `--surface-tertiary` blocks in the card's silhouette (§3.22).
- Page-level: the animated brand `.webm` (§3.22).
- Avatar fallback: an inline `data:image/svg+xml` placeholder at the final dimensions (**M**) —
  i.e. the layout never shifts when an avatar fails.

---

## 7. What we could not determine

Consolidated list of every **U** in this document, so nothing is silently invented downstream.
Items 1–6 and 9–10 were **closed by the live interaction pass** (`research/INTERACTION-CAPTURE.md`);
they are kept here, struck through, so the record of what changed stays legible.

- ~~1. **Transition durations and easings.**~~ **Closed** — §1.9. Two durations (150ms, 200ms),
  one curve (`ease`), plus one stock Tailwind curve on third-party controls.
- ~~2. **All hover / active / focus states.**~~ **Closed** — §3.2, §3.8, §3.9, §3.10. The answer is
  mostly *"no change"*: the card tile, sort chips and view toggle are inert; only buttons, sidebar
  nav items and icon glyphs respond; **there is not one `:active` rule on the site**, and every
  authored focus rule *removes* the outline.
- ~~3. **Table view and Binder view.**~~ **Closed** — both render signed out. §3.25, §3.26.
- ~~4. **Modal / dialog / bottom sheet.**~~ **Closed as a confirmed absence** — §3.13. Nothing
  reachable signed out opens one. Our modal spec is knowingly ours.
- ~~5. **Filter popover contents.**~~ **Closed** — there is no filter popover. The affordances are a
  route change (`/search/advanced`) and an inline accordion. §3.8.
- ~~6. **Price-history chart.**~~ **Closed** — §3.16. Canvas-rendered, 564 × 300, series coloured by
  variant accent.
7. **Pokédex caught / uncaught / shiny tile states.** Captures were signed-out. **Still U** — this
   is behind auth.
8. **Trainer-level bar exact metrics.** Only visible inside a marketing mock. **Still U.**
- ~~9. **Collapsed-sidebar width and the mobile drawer.**~~ **Closed** — §3.1. Collapsed rail 81px
  (+1px border); drawer 275px, no scrim (content at `opacity: 0.2`), no transition.
- ~~10. **Breakpoints between 390 and 1440.**~~ **Closed** — §4.3, §4.4. There is exactly one layout
  breakpoint (1068px) plus a gap threshold (567px); everything else is fluid.
11. **A set-progress *ring*.** No circular progress meter exists anywhere in the captures.
12. **Icon stroke weights / SVG geometry.** Only sizes and colour plumbing were captured. Icons
    render through a custom `<svg-icon>` element whose geometry was not extracted — and which is
    their asset anyway. Related: the **active view-toggle icon's recolour mechanism** is internal to
    that component (the wrapper's `color` stays `#7F8596` and no `--icon-color` is set), so the
    effect is measured but the mechanism is not.
13. **A light theme.** Provisioned architecturally, not shipped (§2).
14. **A `warning` colour role.** No such token; yellow does double duty.
15. **The footer background `#1B1F27`.** Rendered but absent from the token set — either an
    untokenised one-off or a token not exposed on `:root`. A second such colour turned up in the
    price chart: the neutral series/axis grey **`#A8AEBD`** (§3.16), also untokenised.
16. **Price-chart empty / insufficient-data state.** Every card × every range returned a populated
    series. **New U.**
17. **Toast in situ.** The card-detail copy-link button raised no toast during capture; the
    primitives gallery remains the only evidence for §3.14. **New U.**
18. **Binder page 2+, and the `Previous` control.** Pro-gated — `Next` does not advance signed out.
    **New U, blocked behind auth.**

**Blocked behind auth** (not attempted — no login, no account created): binder pagination, the
`Private Notes` and `Graded` tab bodies, profile sort/filter chips, and every signed-in affordance
(owned-status badges, quantity stepper, Pokédex caught/shiny states, trainer-level bar, list/deck
creation, collection-value-over-time).
