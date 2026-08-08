# FRONTEND.md — DeckScout front-end stack + performance plan

> **Scope.** Stack selection, virtualization, image delivery, offline/PWA, build strategy,
> and specialist components for the DeckScout front-end. Written against `UI-SPEC.md`
> (design contract), `DECISIONS.md` (binding decisions), `research/DATA-LAYER.md`
> (corpus + image facts) and `research/BEHAVIOR-SPEC.md` (filter/sort surface).
>
> **Date of record: 2026-07-24.** Every version number below was read from the npm
> registry on this date, not from memory. Nothing here was installed, built, or run —
> the only local execution was read-only inspection plus one 8-image `ffmpeg` benchmark
> in the session scratchpad (§B.3.4).

**Confidence legend**

| Mark | Meaning |
|---|---|
| **[verified: …]** | Read from a cited primary source (official docs, npm registry, this box's config) on 2026-07-24. |
| **[measured]** | Produced by a command run in this session; the command is shown. |
| **[inferred]** | Reasoned from the above. A judgement, not a fact. |
| **[unverified]** | Could not be established. Listed so we don't pretend otherwise. §7. |

---

## 0. Verdicts

| # | Question | Verdict |
|---|---|---|
| 1 | React 18 or 19? | **React 19.2.8.** 19 is the only `latest` line; there is no React 20. The brief's "React 18" is stale. |
| 2 | Vite major? | **Vite 8.1.5** — Rolldown (Rust) is now the single bundler. This is what makes on-Pi builds comfortable. |
| 3 | Tailwind major? | **Tailwind 4.3.3**, CSS-first `@theme`. Our 77 flat semantic tokens map onto it almost 1:1; the **spacing scale is the one real friction** (§A.4). |
| 4 | Router? | **TanStack Router 1.170.18.** React Router 8 declares `node >= 22.22.0`; this box is on Node 20.20.2 and six pm2 services depend on that. Plus type-safe search params are the whole reason we're putting filters in the URL. |
| 5 | Virtualization? | **TanStack Virtual 3.14.8**, driven by a measured column count from `ResizeObserver`. Not `VirtuosoGrid` — it requires equally-sized items and owns the scroller. |
| 6 | Charts? | **Hand-rolled SVG on `d3-scale` + `d3-shape` (21.1 KB gzip).** Recharts 3.10 is 143.9 KB gzip — 2.2× the entire React runtime, for one chart. |
| 7 | Build on the Pi? | **Yes.** Rolldown removes the reason not to. Budget ~10–12 min cold, ~40–70 s warm, ~1.2 GB peak; run `nice -n 10`, keep `tsc` out of the deploy path. |
| 8 | PWA on LAN? | **Blocked as currently routed.** `http://the.grid/deckscout/` is not a secure context → no service worker, no install, no offline. Fixable with split-horizon DNS on the dnsmasq already running here (§C.1). This is the single most important finding in this document. |
| 9 | Offline on a phone? | **Catalog metadata: yes. All 1.87 GB of art: no, on any phone.** Ship a bounded "offline pack" (~50–120 MB) and be honest in the UI (§C.5). |
| 10 | Virtualized grid + drag-and-drop? | **Do not build it.** Split the surfaces: grid is virtualized and never draggable; binder is paginated and never virtualized. The hard combination dissolves (§E.2). |

---

## 1. Evidence base

| Source | How |
|---|---|
| Package versions, `engines`, peer deps, publish dates | `registry.npmjs.org/<pkg>` **[measured]**, 2026-07-24 |
| Minified+gzip sizes | `bundlephobia.com/api/size` **[verified]**; React runtime re-measured locally with the arm64 `esbuild` already on this box + `gzip -9` **[measured]** |
| Tailwind v4 theming | `tailwindcss.com/docs/theme`, `/docs/upgrade-guide` **[verified]** |
| Vite `base`, targets, Rolldown | `vite.dev/config/shared-options`, `vite.dev/guide/build`, `vite.dev/blog/announcing-vite8` **[verified]** |
| PWA base/scope defaults | `vite-plugin-pwa` `src/options.ts` on `main` **[verified]** |
| Storage quota + eviction | `webkit.org/blog/14403`, MDN *Storage quotas and eviction criteria* **[verified]** |
| Secure contexts | MDN *Secure Contexts* **[verified]** |
| This box's ingress | `/etc/nginx/sites-available/{thegrid,brain-public}`, `/etc/nginx/snippets/*`, `/etc/nginx/nginx.conf`, `nginx -V`, `ss -tln`, `systemctl` **[measured]** |
| Comparable on-Pi Vite app | `/home/cheyras/ColorSplash` (Vite 6 + React 19, 66 TS files → 352 KB single chunk) **[measured]** |

---

# A. Stack confirmation

## A.1 The version-pinned manifest

All read from the npm registry on **2026-07-24** **[measured]**.

### Runtime — counts against the initial bundle

| Package | Version | gzip | Why |
|---|---|---|---|
| `react` | **19.2.8** (pub 2026-07-21) | 3.2 KB | Only `latest` line. `next`/`canary` are 19.3.0-canary. No React 20 exists. |
| `react-dom` | **19.2.8** | 63.4 KB | `react-dom/client`, minified locally + `gzip -9`. |
| `@tanstack/react-router` | **1.170.18** (2026-07-13) | 38.7 KB | `engines: node >= 20.19` — compatible with this box. |
| `@tanstack/react-query` | **5.101.4** (2026-07-21) | 13.3 KB | v5 is still the current major. |
| `@tanstack/react-virtual` | **3.14.8** (2026-07-22) | 7.3 KB | Headless; supports `lanes` + `gap`. |
| **Runtime floor** | | **125.9 KB gzip** | Before one line of our code. |

### Build-time — costs nothing at runtime

| Package | Version | Note |
|---|---|---|
| `vite` | **8.1.5** (2026-07-16) | `engines: ^20.19.0 \|\| >=22.12.0` → **Node 20.20.2 satisfies it.** |
| `@vitejs/plugin-react` | **6.0.4** | Oxc-based React transform in v6. |
| `tailwindcss` | **4.3.3** (2026-07-16) | |
| `@tailwindcss/vite` | **4.3.3** | `peer: vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8` → v8 OK. Official recommended integration. |
| `@tanstack/router-plugin` | **1.168.23** | `peer: vite >=5 … \|\| >=8.0.0`, `@tanstack/react-router ^1.170.18`. File-based routing + codegen. |
| `vite-plugin-pwa` | **1.3.0** (2026-05-05) | `peer: vite ^3 … ^8`, `workbox-build ^7.4.1`, `workbox-window ^7.4.1`. |
| `workbox-build` / `workbox-window` | **7.4.1** | `workbox-build` `engines: node >= 20` → OK. |
| `typescript` | 5.x | Not in the deploy path (§D.3). |

### Lazy chunks — must not be in the entry bundle

| Package | Version | gzip | Route |
|---|---|---|---|
| `d3-scale` + `d3-shape` | 4.0.2 / 3.2.0 | 15.6 + 5.5 = **21.1 KB** | Price/value charts (§E.1) |
| `@dnd-kit/core` + `@dnd-kit/sortable` | 6.3.1 / 10.0.0 | 13.9 + 3.6 = **17.5 KB** | Binder + list reorder (§E.2) |
| `@tanstack/react-query-persist-client` | 5.101.4 | 3.0 KB | Offline hydration (§B.4) |
| `idb-keyval` | 6.3.0 (2026-07-08) | ~1 KB | IndexedDB persister backing store |

### Explicitly rejected

| Package | Version | Why rejected |
|---|---|---|
| `react-router` | 8.3.0 | `engines: node >= 22.22.0` — see §A.5. |
| `react-virtuoso` | 4.18.11 | Equally-sized items only, owns the scroller — see §B.2. |
| `recharts` | 3.10.0 | **143.9 KB gzip** for one chart type. |
| `echarts` / `@observablehq/plot` / `victory` / `@nivo/line` | — | 359 / 125 / 105 / 90 KB gzip. Not in the conversation. |
| `@atlaskit/pragmatic-drag-and-drop` | 2.0.1 | Native HTML5 DnD → touch is documented as unusable. §E.2. |

## A.2 React 19 is the sane default

**[verified: registry.npmjs.org/react]** `dist-tags` on 2026-07-24: `latest: 19.2.8`,
`canary: 19.3.0-canary-…`, `experimental: 0.0.0-experimental-…`. React 18 is two majors
of maintenance behind and receives no feature work. The brief's "React 18 + Vite +
Tailwind + TanStack Query" was copied from `pokecollector`'s README, which is a
description of *that* project's lockfile, not a recommendation for ours.

What React 19 actually changes for us, concretely:

- **`ref` as a prop.** `forwardRef` is no longer needed. Our component inventory (§UI-SPEC 3)
  is ~40 components, most of which need to forward a ref to a DOM node — that's ~40 fewer
  wrappers.
- **`useDeferredValue` with an initial value** and improved transition scheduling. This is
  the mechanism we use to keep the filter/sort chip row responsive while a 21,828-row
  re-sort commits (§B.5, INP budget).
- **Document metadata + stylesheet hoisting.** Lets route components declare `<title>`
  and `<link rel="preload">` inline, which matters for the card-detail hero image.
- **`use()`** for reading promises/context conditionally — useful in route loaders.

**Risk:** none of our chosen dependencies cap React below 19. Peer ranges checked
**[measured]**: `@tanstack/react-router` `>=18 || >=19`; `@tanstack/react-virtual`
`^16.8 || ^17 || ^18 || ^19`; `@dnd-kit/core` `>=16.8`; `@visx/*` `^18 || ^19`.

## A.3 Vite 8 — and why it changes the on-Pi build answer

**[verified: vite.dev/blog/announcing-vite8]** Vite 8.0 shipped **2026-03-12** and replaces
the historical esbuild(dev) + Rollup(prod) split with **Rolldown**, a single Rust bundler.
The announcement cites 10–30× faster builds with named cases (Linear 46 s → 6 s;
Mercedes-Benz.io −38%). Node support is stated as "Node.js 20.19+, 22.12+", matching the
`engines` field **[measured]** `^20.19.0 || >=22.12.0`.

This is the difference between "build elsewhere and rsync" and "build on the Pi", so it is
load-bearing for §D. Two costs to record honestly:

- **[verified]** Install size grows ~15 MB over Vite 7 (10 MB lightningcss, 5 MB Rolldown
  binaries). Both publish `linux-arm64` artifacts.
- **[unverified]** No official statement on peak *memory* during a Rolldown build. The
  reasoning that it is lower than Rollup's is **[inferred]** from the module graph living
  in Rust rather than in V8 heap — see §D.2, where I size the build from the dependency
  graph instead of trusting that.

**Default build target [verified: vite.dev/guide/build]:** Baseline Widely Available —
Chrome ≥111, Edge ≥111, Firefox ≥114, **Safari ≥16.4**. Keep the default. Do **not** add
`@vitejs/plugin-legacy`: it doubles the bundle output and every device that will ever load
this app is a phone or laptop we personally own.

## A.4 Tailwind v4 and our 77 flat tokens

**[verified: tailwindcss.com/docs/theme]** v4 replaced `tailwind.config.js` with the CSS-first
`@theme` directive. A variable declared inside `@theme` produces **both** a CSS custom
property **and** the matching utility classes. Variables are namespaced, and the namespace
determines which utilities appear:

`--color-*` → `bg-/text-/border-/fill-…` · `--font-*` · `--text-*` (font size) ·
`--font-weight-*` · `--tracking-*` · `--leading-*` · `--breakpoint-*` · `--container-*` ·
`--spacing-*` · `--radius-*` · `--shadow-*` / `--inset-shadow-*` / `--drop-shadow-*` ·
`--blur-*` · `--aspect-*` · `--ease-*` · `--animate-*` · `--perspective-*` · `--tab-size-*`.

**[verified]** Browser floor for v4: **Safari 16.4+, Chrome 111+, Firefox 128+** — it depends
on `@property` and `color-mix()`. Note this is *the same floor Vite 8 targets by default*
(Firefox aside: 128 vs 114). One consistent baseline: **Safari 16.4 / Chrome 111 / Firefox 128.**

### A.4.1 Colour, radius, shadow, type — a clean fit

Our token set is 77 flat semantic roles with **no primitive ramp** (UI-SPEC §1.1). That is
exactly the shape `@theme` wants. `--color-surface-tertiary: #282D38` yields
`bg-surface-tertiary`, `border-surface-tertiary`, `text-surface-tertiary` — no `-500`
suffix required, no palette tier to invent. The ready-to-paste block in UI-SPEC §1.10 is
already correct v4 syntax.

Two refinements to it:

1. **Use `@theme static`.** **[verified]** `@theme static` emits every declared variable into
   the output CSS even when no utility references it. We *want* that: the icon system
   (UI-SPEC §1.2 "Icons") sets three custom properties per icon *inline from JS*, so those
   token values must exist as CSS variables at runtime regardless of whether Tailwind's
   scanner saw a class name for them. Without `static`, an unused-in-markup token is
   dropped and the icon renders `unset`. This is a silent-failure class of bug; take the
   ~2–3 KB.
2. **Do not reset the default palette.** UI-SPEC's block adds tokens without
   `--color-*: initial`. Keep it that way — the stock ramp is only emitted for utilities
   actually used, so it costs nothing, and it gives us an escape hatch for the
   *invented* type-colour palette (UI-SPEC §1.3) without a naming fight.

### A.4.2 Spacing — the one genuine mismatch

UI-SPEC §1.4 is explicit: pkmn.gg's spacing is **not a 4-pt scale**. `6px` (170 uses),
`10px` (138), `5px` (24), `15px` (4), `18px` (50) and the card grid's literal
`gap: 30px 53px` are all load-bearing.

**[verified]** In v4, the numeric spacing utilities are generated as
`calc(var(--spacing) * <n>)` from a single `--spacing` multiplier; *named* spacing steps
come from the separate `--spacing-*` namespace.

UI-SPEC §1.10 proposes `--spacing: 2px`. **I recommend against it**, for a reason that is
about human and LLM behaviour rather than CSS:

- With `--spacing: 2px`, `p-4` means **8px**. Every React developer, every code example on
  the internet, and every model that will ever touch this repo reads `p-4` as 16px. The
  mistake is silent — the page just looks subtly wrong, and nothing type-checks it.
- `53` is odd, so it is not expressible at all on a 2px base except as `gap-x-26.5`.
- The measured values are pixel readings off a screenshot, not a designed ratio. Encoding
  them as a multiplier pretends there's a system where there isn't one.

**Recommendation:**

```css
@theme static {
  /* Leave the multiplier at the Tailwind default so p-4 == 16px, as everyone expects. */
  --spacing: 0.25rem;

  /* The site's non-4pt values become NAMED steps. Semantic, greppable, unmistakable. */
  --spacing-hair:      5px;   /* space-hair      */
  --spacing-tight:     6px;   /* p-tight, gap-tight — the single most common gap on pkmn.gg */
  --spacing-snug:     10px;
  --spacing-cozy:     15px;   /* profile collection grid gap */
  --spacing-loose:    18px;
  --spacing-grid-y:   30px;   /* card grid ROW gap */
  --spacing-grid-x:   53px;   /* card grid COLUMN gap — gap-x-grid-x */
}
```

Then `gap-y-grid-y gap-x-grid-x` reproduces `gap: 30px 53px` and *says what it is*.
Anything genuinely one-off uses a v4 arbitrary value (`pt-[53px]`) with zero config.

**Trade-off accepted:** two spacing vocabularies coexist (numeric 4-pt for new work, named
for site-measured values). That is a truthful representation of the source material —
UI-SPEC §1.4 itself says "use the 4-pt subset for anything new."

### A.4.3 Breakpoints, and a real hazard

UI-SPEC §4.3 marks the whole ladder **[I]** except 1440 — it was reverse-engineered from
`react-native-unistyles`' stock breakpoints. Declaring
`--breakpoint-sm: 576px; --breakpoint-md: 768px; --breakpoint-lg: 992px; --breakpoint-xl: 1200px;`
in `@theme` **does not remove** Tailwind's defaults (`sm:640 md:768 lg:1024 xl:1280 2xl:1536`) —
it *overrides the same names*, silently redefining what `lg:` means for anyone who has
Tailwind muscle memory. `md` collides at 768 (harmless); `sm`, `lg`, `xl` do not.

**Recommendation:** override them anyway (matching the reference beats matching Tailwind),
but put a comment block at the top of `theme.css` stating the redefinition explicitly, and
add `--breakpoint-*: initial` before the overrides so `2xl` doesn't survive at 1536 while
we also define it at 1440. A half-overridden breakpoint set is the worst of both.

### A.4.4 Fonts — self-host, do not hotlink

UI-SPEC §1.8: Inter variable is the only family. **Measured** from the Google Fonts CSS API:

| Subset | woff2 |
|---|---|
| `latin` | **47.1 KB** |
| `latin-ext` | 83.1 KB |
| cyrillic / greek / vietnamese | 10–25 KB each |

BRIEF §5 forbids telemetry and requires offline resilience, so Google Fonts is out —
`ColorSplash/index.html` on this box hotlinks `fonts.googleapis.com` **[measured]**; do not
copy that pattern. Self-host `latin` + `latin-ext` as two `@font-face` rules with
`unicode-range`, so the 83 KB `latin-ext` file only downloads if a card artist's name needs
it. Practical cost on first load: **47.1 KB**. `font-display: swap`, `<link rel="preload">`
the latin file, and keep `"Inter Fallback"` in the stack exactly as UI-SPEC specifies so
the swap doesn't reflow.

## A.5 Router: TanStack Router, and it isn't close

**BEHAVIOR-SPEC §5.4 is the requirement.** pkmn.gg keeps *zero* filter state in the URL —
a scan of every `href` across 24 DOM captures found only `?tab=`, `?redirect=`, `?signature=`.
We are deliberately deviating: `sort`, `dir`, `view`, `goal`, `owned`, `type`, `rarity`,
`energy`, `supertype`, `q`, `page` all go in the URL. That makes search-param handling the
single highest-traffic API in the app, not an afterthought.

| Criterion | TanStack Router 1.170.18 | React Router 8.3.0 |
|---|---|---|
| **Node** **[measured]** | `engines: node >= 20.19` ✅ | `engines: node >= 22.22.0` ❌ |
| React peer **[measured]** | `>=18 \|\| >=19` | `>=19.2.7` |
| Search params | First-class typed state layer | `useSearchParams` → `URLSearchParams` |
| Validation | `validateSearch` + Standard Schema (Valibot/ArkType/Effect need no adapter; Zod v4 direct) | Hand-rolled |
| Types | Search + path params inferred end-to-end into `<Link>`, `navigate()`, `useSearch()` | Path params typed in v7+; search params are `string \| null` |
| Nested/array params | Structured JSON serialisation with structural sharing | Manual encode/decode every read and write |
| Middleware | `retainSearchParams(['view'])`, `stripSearchParams({ sort: 'number' })` | None |
| Sub-path | `basepath` router option **[verified]** | `basename` |
| gzip **[verified]** | 38.7 KB | 58.9 KB (v7.18.1: 58.9 KB) |

**The Node line is decisive on this specific box.** `/home/cheyras/CLAUDE.md` documents
native-module ABI mismatch after a Node version change as a *recurring failure mode* here,
and six pm2 services the user depends on run on the system Node 20.20.2. **[verified: pnpm.io/settings]**
`engineStrict` defaults to `false`, so pnpm would *warn* rather than refuse — which is worse,
not better: we'd be shipping a dependency whose maintainers only test on Node 22+, on a box
where upgrading Node has a real blast radius. React Router **7.18.1** (`node >= 20.0.0`) is
the compatible alternative, but choosing a router's previous major on day one to dodge a
runtime constraint is a bad start.

The functional argument stands independently. Concretely, the set-page filter state:

```ts
// routes/series.$series.$set.tsx
const cardSearch = v.object({
  sort:  v.optional(v.picklist(['number','name','rarity','price','artist']), 'number'),
  dir:   v.optional(v.picklist(['asc','desc']), 'asc'),
  view:  v.optional(v.picklist(['grid','table','binder']), 'grid'),
  goal:  v.optional(v.picklist(['complete','master','grandmaster']), 'complete'),
  owned: v.optional(v.picklist(['all','have','need','dupes']), 'all'),
  type:  v.optional(v.array(v.string()), []),      // -> ?type=["fire","water"]
  q:     v.optional(v.string(), ''),
})

export const Route = createFileRoute('/series/$series/$set')({
  validateSearch: cardSearch,                       // Standard Schema, no adapter
  loaderDeps: ({ search }) => ({ sort: search.sort, dir: search.dir, owned: search.owned }),
  search: { middlewares: [retainSearchParams(['view']), stripSearchParams(cardDefaults)] },
})
```

`stripSearchParams` keeps default-valued params out of the URL, so the canonical set URL
stays `/series/sv/sv03.5` and only *deviations* appear — which is precisely the "costs
nothing, strictly better UX" that BEHAVIOR-SPEC §5.4 asks for. `retainSearchParams(['view'])`
carries the grid/table/binder choice across navigations without threading it manually.
Doing the equivalent on `URLSearchParams` is ~200 lines of bespoke, untyped, individually
buggy encode/decode.

**Caveats, stated plainly:**
- TanStack Router's route tree is codegen'd by `@tanstack/router-plugin`; a stale
  `routeTree.gen.ts` produces confusing type errors. Gitignore it and generate on build.
- TypeScript inference across a large route tree is the known cost centre. With ~20 routes
  (UI-SPEC §5 route map) this is fine; it bites at hundreds.
- Version churn: 1.170.x in July 2026 vs 1.132 alpha tags in the same registry entry. Pin
  exactly and upgrade deliberately.

## A.6 Sub-path deployment — the constraint, made concrete

`DECISIONS.md` (2026-07-24, remote access) fixes ingress as the existing nginx vhosts, and
`DATA-LAYER.md` §1 already reserved the convention: `/deckscout/` + `/api/deckscout/` →
`127.0.0.1:3700`. **[measured]** every existing app on this box follows
`location /<name>/ { proxy_pass http://127.0.0.1:<port>/<name>/; }`. So the app is served
from `/deckscout/`, never from a domain root, on **both** vhosts.

Every layer that can get this wrong, and the setting that fixes it:

| Layer | Setting | Notes |
|---|---|---|
| Vite | `base: '/deckscout/'` | **[verified]** rewrites JS-imported asset URLs, CSS `url()`, and `.html` asset refs at build. **Trailing slash required.** |
| Runtime URL building | `import.meta.env.BASE_URL` | **[verified]** statically replaced — must be written *literally*; `import.meta.env['BASE_URL']` does not work. |
| Router | `createRouter({ basepath: '/deckscout' })` | **[verified]** "useful for mounting a router instance at a subpath". Note **no** trailing slash here, unlike Vite. |
| PWA manifest | `start_url`, `scope` | **[verified: vite-plugin-pwa src/options.ts]** both default to `resolveBasePath(viteConfig.base)` — inherited automatically. |
| Service worker | `sw.js` emitted at `/deckscout/sw.js` | **[verified]** `src/html.ts` injects `${options.buildBase}${options.filename}`. A SW at `/deckscout/sw.js` can only control `/deckscout/*` — which is what we want. Do **not** try to widen it with `Service-Worker-Allowed`. |
| Workbox SPA fallback | `workbox.navigateFallback` | Default is the *relative* `'index.html'` **[verified: options.ts]**, resolved against the SW's own URL → `/deckscout/index.html`. **Set it explicitly to `/deckscout/index.html`** rather than relying on that. |
| API base | `/api/deckscout/` | Separate nginx location; keep it a sibling of `/deckscout/`, never nested, so the SW's navigation fallback can't swallow API 404s. |
| Static images | `/deckscout/img/…` | nginx `alias`, never through Node (§B.3.6). |
| Dev server | `base: '/deckscout/'` + `server.allowedHosts` | §D.4. |

**Reject `base: './'`.** Relative base is the usual "we don't know the deploy path" answer,
but it breaks client-side routing: a deep URL like `/deckscout/series/sv/sv03.5/006` resolves
relative asset URLs against `/deckscout/series/sv/sv03.5/`, 404ing every chunk. We know our
path. Hard-code it.

**Trap worth naming.** Because `base` is baked in at build time, a build made for `/deckscout/`
cannot be served at `/`. Add a `scripts/verify-base.mjs` postbuild check that greps `dist/index.html`
for `/deckscout/assets/` and fails the build otherwise. That is thirty seconds of work and it
prevents the exact expensive-late failure the brief warns about.

---

# B. Performance — the core of the problem

## B.1 What we are actually up against

From `DATA-LAYER.md` §3.6 and `UI-SPEC.md` §4.4 / §5:

| Surface | Items | Notes |
|---|---|---|
| Set page (151) | 207 tiles | Full page height measured at **33,884 px** @390 (UI-SPEC §5.2) |
| Pokémon detail (Charizard) | ~200 tiles | **24,698 px** tall — "the heaviest page on the site; it must be virtualised in our build" (UI-SPEC §5.5) |
| Pokédex index | **1,025** sprite tiles | 15,649 px @390 |
| Full collection browse | **21,828** cards with images | 23,444 total rows |
| Variants | 35,648 | Owned-badge row per tile |

Tile geometry **[verified: UI-SPEC §3.2]**: 207.81 × 364.52 desktop; image 207.81 × 290.52;
74 px footer; `gap: 30px 53px`; 4 columns @1440, **2 columns @390** (167.5 px wide, 22 px gap,
16 px gutters).

Naive DOM cost of the Charizard page at 2 columns: ~200 tiles × ~14 elements (image, badge,
name, price, number, rarity glyph, 3 variant badges, wrappers) ≈ **2,800 nodes**, plus 200
decoded images. On a mid-range phone that is a multi-second scripting + layout stall and a
real risk of a renderer OOM. Virtualization is not an optimisation here, it is a
correctness requirement.

## B.2 Virtualization

### The options, current as of 2026-07-24 **[measured]**

| Library | Version | gzip | Grid model | Verdict |
|---|---|---|---|---|
| **`@tanstack/react-virtual`** | 3.14.8 (2026-07-22) | **7.3 KB** | Headless. Compose a row virtualizer with a computed column count, or use `lanes` | ✅ **Recommended** |
| `react-virtuoso` | 4.18.11 (2026-07-17) | 18.6 KB | `VirtuosoGrid` — **"displays equally-sized items"**, "variable-height items are not supported" **[verified: virtuoso.dev grid-responsive-columns]** | ❌ |
| `virtua` | 0.49.3 (2026-07-11) | 5.9 KB | Zero-config list + grid | ⚠️ Strong runner-up; smallest; pre-1.0 |
| `react-window` | 2.3.0 (2026-07-20) | 4.2 KB | v2 is a full rewrite | ⚠️ Rewrite is young; ecosystem still catching up |
| `masonic` | 4.1.0 (2025-04-22) | 5.9 KB | Masonry-specialised | ❌ We have uniform tiles, not masonry; 15 months stale |
| CSS `content-visibility: auto` | — | **0 KB** | Browser-native skip-rendering | ⚠️ See below |

### Why not `VirtuosoGrid`

It is the obvious "responsive grid" answer and it is the wrong one here, for two documented
reasons **[verified: virtuoso.dev/react-virtuoso/virtuoso-grid/grid-responsive-columns]**:

1. **"The `VirtuosoGrid` component displays equally-sized items"** and *"variable-height items
   are not supported."* Our tile is *nominally* uniform — but the name row is a fixed 23 px
   line box (UI-SPEC §1.8) that will wrap to two lines for long card names ("Iron Hands ex",
   "Miraidon ex — Special Illustration Rare"), and the owned-badge row varies with variant
   count (1–4 badges, UI-SPEC §3.3). Either we force `line-clamp-1` and lose information, or
   we fight the library.
2. It renders and owns its own scroller. The set page has a fixed 78 px header and a
   *page-level* scroll containing a banner, a 6-column stat strip, a filter bar and a view
   toggle *above* the grid (UI-SPEC §5.2). A component-owned scroll container means either
   a nested scroller (bad on iOS: momentum, rubber-banding, two scrollbars) or hoisting the
   whole page into the virtualizer's `components.Header`, which makes the banner a
   second-class citizen.

### Why TanStack Virtual

- **Headless** **[verified: tanstack.com/virtual]** — it "does not ship with or render any
  markup or styles". It gives us `virtualItems` with offsets; the grid stays *our* CSS Grid,
  with *our* `gap: 30px 53px`, *our* `repeat(auto-fill, minmax(168px, 1fr))`. UI-SPEC §4.4's
  recommendation survives intact.
- **`useWindowVirtualizer`** virtualizes against the *document* scroll, not a nested
  container. That is the one that matches the reference layout, and it is why the banner /
  stat-strip / filter-bar stack above the grid keeps working with zero contortion.
  `scrollMargin` handles the offset of the grid within the page.
- **`lanes` + `gap`** **[verified: tanstack.com/virtual API]** — `lanes` divides the list into
  columns ("items are assigned to the lane with the shortest total size"), `gap` inserts
  consistent spacing. Straight `lanes` is a *masonry* placement, which is wrong for a grid
  where reading order must be row-major (sorted by card number!). **Use the row-virtualizer
  pattern instead**: virtualize *rows* of `ceil(count / columns)`, render `columns` tiles per
  row. `lanes` is the wrong tool here despite looking like the right one — worth knowing
  before someone reaches for it.
- 7.3 KB gzip, actively released (2026-07-22).

### The responsive-column problem, solved concretely

Variable column count is the thing that breaks naive virtualization. Handle it explicitly:

```tsx
// One ResizeObserver on the grid container is the source of truth for column count.
const [cols, setCols] = useState(2)                       // SSR-safe mobile default
useLayoutEffect(() => {
  const el = gridRef.current!
  const ro = new ResizeObserver(([e]) => {
    const w = e.contentRect.width
    // Mirrors UI-SPEC §4.4: minmax(168px, 1fr) with a 53px column gap.
    setCols(Math.max(1, Math.floor((w + GAP_X) / (MIN_TILE + GAP_X))))
  })
  ro.observe(el); return () => ro.disconnect()
}, [])

const rowCount = Math.ceil(items.length / cols)
const rv = useWindowVirtualizer({
  count: rowCount,
  estimateSize: () => ROW_H,        // tileImageH + FOOTER_74 + GAP_Y
  overscan: 3,                      // ~3 rows above/below — see budget below
  scrollMargin: gridRef.current?.offsetTop ?? 0,
})
```

**Caveat list — read this before implementing:**

1. **`cols` changes must reset the virtualizer.** On orientation change 2 → 3 columns,
   `rowCount` changes and every cached row measurement is stale. Key the virtualized
   subtree on `cols` so React remounts it, and restore scroll by *item index*, not pixel
   offset. Getting this wrong looks like "rotating my phone scrolls me to a random card".
2. **Row height must be exact, not estimated.** Because tiles are uniform-by-construction
   (fixed aspect-ratio image box + fixed 74 px footer + `line-clamp-2` name), we can compute
   `ROW_H` arithmetically and skip `measureElement` entirely. That removes the single
   biggest source of virtualization jank (measure → reflow → re-measure). **Enforce it**:
   `line-clamp-2` on the name, fixed-height owned-badge row even at one variant.
3. **`overscan: 3` rows, not items.** At 2 columns that's 6 tiles ≈ 98 KB of `low.webp`
   pre-fetched; at 4 columns, 12 tiles ≈ 197 KB. Tuned in §B.3.5 against the HTTP/1.1
   connection cap.
4. **Scroll restoration.** TanStack Router has `scrollRestoration`; it restores *pixel*
   offsets, which are meaningless if `cols` differs from when you left. Persist
   `firstVisibleIndex` in router state and call `scrollToIndex` on restore.
5. **Sticky filter bar.** UI-SPEC §4.5 records the filter/chip row as *not* sticky in any
   capture, and window virtualization + `position: sticky` inside the scroll container is a
   classic bug pairing. Keep it non-sticky — which happens to match the reference.
6. **`content-visibility: auto` is not a substitute.** **[verified: MDN]** it reached Baseline
   only in **September 2024** and Safari support is partial. Our floor is Safari 16.4
   (March 2023). It is a legitimate *belt-and-braces* addition on the overscan band
   (`contain-intrinsic-size: auto <ROW_H>px`), but it cannot carry 21,828 items — the DOM
   nodes still exist, and node count itself is what kills a phone.
7. **Binder view is exempt.** It is paginated by construction (§E.2). Do not virtualize it.

**`virtua` 0.49.3 is the runner-up** and I want to be honest that it is close: 5.9 KB, real
grid support, actively released. It is pre-1.0 and less battle-tested. If TanStack Virtual's
window-mode `scrollMargin` fights the fixed header during Phase 3, `virtua` is the swap, and
the swap is contained to one component.

## B.3 Images

This is where a Pi-served, phone-consumed card app lives or dies. **21,828 images, 1.87 GB.**

### B.3.1 What we actually have **[verified: DATA-LAYER §3.4, §5.1]**

| Quality | Dimensions | Mean bytes | p90 |
|---|---|---|---|
| `low.webp` | **245 × 337** | **16,427 B** | 21,552 B |
| `high.webp` | **600 × 825** | **69,363 B** | 96,190 B |

*"There is no resolution above 600×825."* Origin sends `cache-control: max-age=31536000`;
assets are immutable.

### B.3.2 The DPR-2 arithmetic nobody has done yet

An `<img srcset>` candidate is chosen by comparing `w` against `CSS-width × devicePixelRatio`.
Our render widths come from UI-SPEC §3.2 / §4.4:

| Context | CSS width | DPR 1 needs | DPR 2 needs | `low` (245w) | `high` (600w) |
|---|---|---|---|---|---|
| Grid tile @390 (2 col) | 167.5 px | 168 | **335** | ✗ 1.37× upscale | ✓ (69 KB × 207 = **14.4 MB/set**) |
| Grid tile @1440 (4 col) | 207.8 px | 208 | **416** | ✓ / ✗ | ✓ |
| Deck grid @1440 | 232.6 px | 233 | 465 | ✗ | ✓ |
| Card-detail hero | 396 px | 396 | **792** | ✗ | ✗ **1.32× upscale — upstream cap** |

**Two findings fall out of this, and both are new:**

1. **The mobile grid is the bad case.** On a DPR-2 phone the browser correctly decides `low`
   is insufficient and reaches for `high` — 69.4 KB × 207 cards = **14.4 MB for one set page**.
   That is the single largest avoidable cost in the app.
2. **The card-detail hero is permanently slightly soft on a DPR-2 display.** 600w against a
   792 device-px requirement. Nothing we can do; TCGdex has no larger asset. Record it so
   nobody spends a day hunting a "blurry image bug" that is an upstream limit.

### B.3.3 Recommendation: derive a third `mid` tier ourselves

We hold `high.webp` (600×825) on disk. Deriving a 400w tier costs one batch job.

**[measured]** on this Pi, 8 real `high.webp` files across eras (`base1`, `bw1`, `xy1`, `sm1`,
`swsh1`, `sv01`, `sv03.5`, `swsh3`), `ffmpeg -vf scale=W:-1 -c:v libwebp -compression_level 6`:

| Target | Quality | Mean bytes | Full-corpus (× 21,828) | Encode |
|---|---|---|---|---|
| source `high` | — | 70,885 B | 1,514 MB | — |
| 400w | 82 | 42,272 B | 923 MB | 3.6 s/img, 1 core |
| **400w** | **75** | **33,046 B** | **721 MB** | 3.6 s/img, 1 core |
| 340w | 80 | 31,136 B | 680 MB | 2.5 s/img |
| 340w | 75 | 26,402 B | 576 MB | 2.5 s/img |

**Recommend 400w @ q75 → mean 33.0 KB, +721 MB.** 400w covers DPR-2 mobile (335 needed) *and*
DPR-1 desktop deck grid (233) with margin, and is a clean 2× of the desktop DPR-1 tile.

- **Disk:** 1.96 GB (DATA-LAYER's plan) + 0.72 GB = **~2.68 GB**, still inside the agreed
  **4 GB cap** with ~1.3 GB of headroom.
- **Mobile set page: 14.4 MB → 6.8 MB.** A 2.1× reduction on the worst path in the app.
- **Encode time:** at 3.6 s/img on one `ffmpeg` core, the full corpus is 21,828 × 3.6 / 4 cores
  ≈ **5.5 hours** — a one-off, `nice`-d, resumable background job alongside the existing
  2.4-hour image warm. **[inferred]** `sharp`/libvips would be roughly an order of magnitude
  faster (~35 min) since it avoids per-image process spawn; `sharp` publishes prebuilt
  `linux-arm64` binaries. Neither tool is installed on this box today — `ffmpeg` and
  ImageMagick `convert` are **[measured]**; `libwebp7` is present but `cwebp` is not.
- **Amends `DECISIONS.md`:** the open item currently reads "WebP only, **both** resolutions".
  This makes it three. Flag at the Phase 1 checkpoint; it is a +721 MB decision, not a
  free one.

**If rejected**, the fallback is: serve `low` on mobile and accept a 1.37× upscale. Card art
is the *product* here, so I would not accept it — but it is a legitimate call and it costs
nothing.

### B.3.4 The tile markup

```html
<!-- Aspect-ratio box: geometry is fully determined before any byte arrives. -->
<div class="relative w-full rounded-lg bg-surface-tertiary"
     style="aspect-ratio: 245 / 337">
  <img
    src="/deckscout/img/en/sv/sv03.5/006.low.webp"
    srcset="/deckscout/img/en/sv/sv03.5/006.low.webp  245w,
            /deckscout/img/en/sv/sv03.5/006.mid.webp  400w,
            /deckscout/img/en/sv/sv03.5/006.high.webp 600w"
    sizes="(min-width: 992px) 208px, (min-width: 576px) 33vw, 50vw"
    width="245" height="337"
    loading="lazy" decoding="async"
    alt="Charizard ex — 151 #006"
    class="absolute inset-0 h-full w-full rounded-lg object-cover" />
</div>
```

Point by point:

- **`aspect-ratio` + `width`/`height` on the `<img>`** → the layout box exists before the
  network does. This is how CLS goes to ~0, not to 0.1.
- **Deliberate spec deviation.** UI-SPEC §3.2 measures pkmn.gg's image at 207.81 × 290.52
  (ratio 0.7153) with **`object-fit: fill`** — i.e. they *squash* a 0.7273 asset by 1.6%.
  A separate `aspect-ratio: 0.714286/1` (5∶7, the physical card) appears on skeletons.
  Our TCGdex assets are **245/337 = 0.7270**. I recommend using the **asset's own ratio**
  and `object-fit: cover`: nothing is squashed and nothing is cropped. Consequence: the tile
  footprint becomes 207.81 × ~359.8 instead of 364.52 — **4.7 px shorter than the measured
  reference**. That is a conscious trade of 4.7 px of grid rhythm against not distorting
  card art. Record it in DECISIONS.md so a future re-capture doesn't "fix" it back.
- **`loading="lazy"`** is *partly redundant* under virtualization (off-window tiles aren't in
  the DOM) but still governs the overscan band. Keep it.
- **`decoding="async"`** keeps WebP decode off the main thread — this is what protects INP
  during a fast flick-scroll, and it is free.
- **`fetchpriority`**: set `fetchpriority="high"` and `loading="eager"` on **row 0 only**
  (the LCP candidates), and on the card-detail hero. Everywhere else, leave it default.
  Marking everything high marks nothing high.
- **No blur-up / LQIP.** The placeholder is the tile itself: `bg-surface-tertiary` at the
  exact final geometry, which is precisely UI-SPEC §3.22's measured card skeleton. A
  base64 LQIP would add ~400–800 B *per card* to every API response — ~17 MB across the
  corpus — to replace a flat `#282D38` rectangle that the design system already specifies.
  Reject it. (`low.webp` at 16.4 KB is *itself* small enough to be its own placeholder; if
  we later want progressive reveal, `low` → `mid` swap in the same `<img>` is free.)
- **Sprites are different.** UI-SPEC §3.19: Pokédex sprites are *animated GIFs* at intrinsic
  45×49–106×77, with an "Animations" toggle. 1,025 animated GIFs decoding simultaneously is
  a phone-killer. Virtualize the sprite grid identically, and wire the Animations toggle to
  swap animated GIF → static first frame (or a static PNG sprite). Default the toggle
  **off** on mobile. That is a *performance* control disguised as a preference — say so in
  the tooltip.

### B.3.5 Concurrency, and what the vhosts actually do **[measured]**

I read the live nginx config. Three findings materially affect image delivery:

| Finding | Evidence | Impact |
|---|---|---|
| **LAN vhost is plaintext HTTP/1.1.** `listen 80 default_server;` `server_name thegrid thegrid.local;` — no `ssl`, no `http2 on` | `/etc/nginx/sites-available/thegrid` | Browsers cap **6 concurrent connections per origin** on HTTP/1.1. Every 7th image queues. |
| **Public vhost is HTTPS + HTTP/2.** `listen 443 ssl; http2 on;` Let's Encrypt, HSTS | `/etc/nginx/sites-available/brain-public:33-46` | Multiplexed; nginx `http2_max_concurrent_streams` defaults to 128. |
| **gzip is effectively off for our assets.** `gzip on;` but `gzip_types` is **commented out** | `/etc/nginx/nginx.conf:47-54` | **[verified: nginx.org]** default is `gzip_types text/html;`. So **JS, CSS and JSON are served uncompressed today.** |

Consequences and actions:

1. **JS/CSS/JSON are currently uncompressed on this box.** Our 190 KB-gzip entry bundle
   would ship as ~620 KB. Fix: `nginx -V` shows **`--with-http_gzip_static_module`** is
   compiled in **[measured]**, and `ngx_brotli` is **not**. So: precompress `dist/` at build
   time (`find dist -name '*.js' -o -name '*.css' -o -name '*.svg' | xargs gzip -9 -k`) and
   add `gzip_static on; gzip_vary on;` to the DeckScout locations. This is better than runtime
   gzip — the Pi compresses once at `-9` instead of per-request at `-1`. **Do not** add
   `gzip_types` globally; that changes behaviour for six other services. Scope it to the
   pokedex locations only. **Never gzip `image/webp`** (already compressed; wastes CPU).
2. **Over HTTP/1.1 on LAN, 6 connections is the ceiling.** At 16.4 KB/`low` image that is
   ~98 KB in flight — which is exactly why `overscan: 3` rows is the right number: it keeps
   the request queue at roughly one connection-generation deep so a flick-scroll doesn't
   build a 200-deep queue the browser then has to cancel.
3. **Over HTTP/2 on the public vhost, the danger inverts.** 128 concurrent streams of image
   requests, *each one triggering an Authelia `auth_request` subrequest*
   (`/etc/nginx/snippets/authelia-protect.conf` **[measured]**), is a self-inflicted DoS on a
   Pi. Two mitigations, and the second needs a user decision:
   - **App-side (do this regardless):** the virtualizer already bounds in-flight images to
     window+overscan. Additionally set `http2_max_concurrent_streams 32;` on the DeckScout
     server block.
   - **Policy (ask the user):** exempt `location /deckscout/img/` from `auth_request`. The
     images are Nintendo/TPC card art, not personal data — the *collection* is the private
     part, and that lives behind `/api/deckscout/`. Exempting images removes ~21,828 auth
     subrequests from a full browse. **This is a security-posture change on a public vhost
     and must not be made silently.** Present it; do not decide it here.
4. **Serve images from nginx, never from Node.** `location /deckscout/img/ { alias /home/cheyras/pokedex/data/images/; expires max; add_header Cache-Control "public, immutable"; }` — matching the origin's own `max-age=31536000`, and matching DATA-LAYER §5.3's plan. `sendfile` + the page cache means a warm image costs the Pi almost nothing.
5. **`open_file_cache`.** With 21,828 small files on a microSD, `open_file_cache max=8000 inactive=600s;` on the image location is worth having; it caches the fd + stat and avoids repeated inode lookups on a card that is not fast at random I/O (47 MB/s sequential **[DATA-LAYER §1]**).

## B.4 Data fetching

### The shape of the problem

A set page needs 207 rows. A full collection browse needs up to 21,828. Rough per-tile
payload (id, localId, name, image path stem, rarity, supertype, variant count, main-variant
price, owned qty per variant): ~150–200 B of JSON. So:

| Query | Rows | JSON | gzip **[inferred]** |
|---|---|---|---|
| One set | 207 | ~35 KB | ~9 KB |
| One Pokémon's cards | ~200 | ~34 KB | ~9 KB |
| Pokédex index | 1,025 | ~60 KB | ~14 KB |
| **Full catalog** | **21,828** | **~3.7 MB** | **~700 KB** |

### The rule: sets are whole, the catalog is windowed

**Fetch a whole set in one request. Never paginate a set.** 9 KB gzip is one round trip on
LAN, and BEHAVIOR-SPEC §5.3 is explicit **[D, article C2]**: *"sorting is instantaneous
client-side reordering, must not stall on sets with hundreds of cards."* Client-side sort
requires the client to hold the set. Server pagination would make every sort chip a network
round trip and directly violate the observed behaviour. This also makes the set page work
offline for free.

**The full-catalog browse is the opposite.** 700 KB gzip and 21,828 objects in a phone's JS
heap (~15–25 MB after V8 object expansion **[inferred]** — DATA-LAYER §2.4 measured 6.4×
JSON→object expansion for exactly this data) is not something to do on every visit.

| Surface | Pattern | Why |
|---|---|---|
| Set / Pokémon / list / deck | **Whole collection in one `useQuery`** | ≤207 rows, ~9 KB gzip, enables client-side sort per BEHAVIOR-SPEC |
| Pokédex index (1,025) | **Whole, per generation** | 10 generations ≈ 100 rows each; the gen pill tabs (UI-SPEC §5.4) are already the pagination |
| Full-catalog browse / search | **Windowed server query**, `useInfiniteQuery`, 100 rows/page, `getNextPageParam` from a keyset cursor | Never `OFFSET` on 21k rows on microSD — keyset on `(sort_key, card_id)` |
| Search-as-you-type | Server-side above 2,000 candidate rows; client-side below | §B.5 INP budget |
| Prices | **Separate query, separate cache key** | Prices change hourly; catalog changes weekly. Coupling them throws away the catalog cache every price sync. |

**Infinite scroll vs pagination:** infinite for the catalog (matches the reference's endless
grid), but with **URL-persisted position** — because we put state in the URL (§A.5),
`?page=N` is the reload anchor. Pure infinite scroll with no URL anchor means reload =
scroll from the top, which is exactly the pkmn.gg failure BEHAVIOR-SPEC §5.4 tells us to
deviate from.

### Cache sizing on a phone

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:  5  * 60_000,      // catalog is synced weekly; 5 min is generous
      gcTime:     24 * 60 * 60_000, // MUST be >= persister maxAge — see below
      retry: 1,                     // LAN: it either works or the Pi is down
      refetchOnWindowFocus: false,  // a phone focuses constantly; this is a battery tax
      networkMode: 'offlineFirst',  // serve cache when the Pi is unreachable
    },
  },
})
```

**[verified: tanstack.com/query persistQueryClient]** *"Set your QueryClient's `gcTime` equal
to or higher than the persister's `maxAge`. If lower than `maxAge`, garbage collection will
kick in and discard the stored cache earlier than expected."* The hydration default is
5 minutes, which would silently defeat persistence. This is the #1 way these setups fail.

Per-query overrides:
- Catalog/set queries: `staleTime: Infinity` + explicit invalidation on sync completion.
  There is no reason to re-fetch immutable card metadata.
- Price queries: `staleTime: 15 * 60_000`.
- Collection mutations (`have`/`need`/`dupes`, quantity stepper): **optimistic updates**.
  The stepper is the highest-frequency interaction in the app (UI-SPEC §3.4) and must feel
  instant regardless of the Pi's round trip. `onMutate` writes the cache, `onError` rolls
  back, `onSettled` invalidates.

**Heap ceiling:** cap the persisted cache at roughly **8 MB serialised**. Reasoning: iOS
Safari's per-origin quota is generous (§C.4), but a phone's *JS heap* is not — Safari on an
older iPhone will terminate a tab well before the storage quota is reached. 8 MB serialised
≈ 50 MB expanded ≈ two full-catalog snapshots. Enforce it in `dehydrateOptions.shouldDehydrateQuery`
by allow-listing query keys rather than trusting a size check after the fact.

### What to persist to IndexedDB

**[verified]** `createAsyncStoragePersister` is the async persister; back it with `idb-keyval`
(6.3.0, 2026-07-08). `localStorage` is **not** an option — **[verified: MDN]** Web Storage is
capped at ~5 MiB per origin and is synchronous, so a 3 MB write blocks the main thread and
tanks INP.

| Data | Persist? | Rationale |
|---|---|---|
| Set/series metadata (218 sets) | ✅ Always | ~200 KB; the app's navigation skeleton |
| Card metadata for **visited** sets | ✅ LRU, cap 40 sets | 40 × 35 KB = 1.4 MB. Covers "the sets I actually collect". |
| The user's collection rows | ✅ Always | The single most important thing to have offline. Small. |
| Lists + decks | ✅ Always | Small, user-authored, high value |
| Pokédex index (1,025) | ✅ Always | ~60 KB |
| Last-known prices per owned card | ✅ Always | BRIEF §5: "shows last-known prices" offline |
| Full-catalog window pages | ❌ Never | Unbounded; re-fetchable in 40 ms on LAN |
| Price *history* series | ❌ Never | Chart-route-scoped; fetch on demand |

Set `buster` to the build hash so a deploy invalidates a schema-incompatible cache instead
of hydrating garbage. This is one line and it prevents a whole class of "the app is broken
after update, clearing site data fixes it" report.

## B.5 Budgets

Round numbers are a smell. Each of these is derived.

### Initial JS bundle

| Component | gzip | Source |
|---|---|---|
| `react` + `react-dom/client` | **66.6 KB** | **[measured]** esbuild-minified + `gzip -9` on this box |
| `@tanstack/react-router` | 38.7 KB | **[verified]** bundlephobia |
| `@tanstack/react-query` | 13.3 KB | **[verified]** |
| `@tanstack/react-virtual` | 7.3 KB | **[verified]** |
| **Vendor floor** | **125.9 KB** | |
| App shell: route tree, layout, ~15 primitives, card tile, filter bar, query hooks | ~45 KB | **[inferred]** — comparable: ColorSplash on this box is 352 KB *unminified-total* for 66 files **[measured]** |
| Tailwind output (77 `@theme static` tokens + used utilities) | ~14 KB | **[inferred]** |
| **Target — entry chunk, set-page route** | **≤ 185 KB gzip** | |
| **Hard fail (CI)** | **250 KB gzip** | |

**Must be lazy chunks, not entry:** charts (21.1 KB), DnD (17.5 KB), deck builder, binder,
scanner, stream tools, profile insights. `defaultPreload: 'intent'` on the router prefetches
them on hover/touch **[verified: RouterOptions]**, so the split costs nothing perceptible.

Enforce with a Rolldown output-size assertion in CI, not a human eyeballing `dist/`.

### LCP — target **≤ 1.2 s** p75, hard fail **2.0 s**

**[verified: web.dev/articles/vitals]** the Core Web Vitals "good" line is 2.5 s at p75.
I am setting a materially tighter target and I want the reason on record: **2.5 s is
calibrated for the public internet** — DNS, TLS to a distant origin, third-party scripts,
ads, an uncontrolled LCP image. We have *none* of those. Our origin is one Wi-Fi hop away,
our LCP element is a 16.4 KB WebP, and there is no third-party JavaScript at all. Accepting
2.5 s here would be accepting ~1.5 s of waste.

Derivation for a mid-range phone (Pixel 6a class) on LAN:

| Step | ms | Basis |
|---|---|---|
| Connection (LAN HTTP/1.1, no TLS) | ~10 | Same-subnet RTT ~1–3 ms |
| HTML (2 KB) + preload discovery | ~15 | |
| Entry JS+CSS 185 KB gzip → ~600 KB raw | ~40 transfer | 50 Mbit/s effective Wi-Fi to a phone |
| Parse + compile + execute 600 KB | ~600 | **[inferred]** ~1 MB/s main-thread JS on mid-tier mobile |
| React mount + first shell paint | ~80 | |
| Route loader → `/api/deckscout/sets/sv03.5` (9 KB gzip) | ~60 | Postgres keyset query + Express + LAN |
| Grid layout, 12 tiles | ~60 | Geometry precomputed; no measure pass |
| Row-0 images: 6 × 16.4 KB, `fetchpriority=high` | ~80 | One HTTP/1.1 connection generation |
| **Total** | **~945 ms** | |

Target 1.2 s leaves ~25% headroom. 2.0 s is the "something regressed" alarm. Note the
dominant term is **JS execution, not network** — which is why the bundle budget is the
lever that matters, and why adding Recharts (143.9 KB gzip ≈ +450 KB raw ≈ **+450 ms of LCP**)
to the entry chunk would be catastrophic rather than merely wasteful.

### Interaction latency (INP) — target **≤ 120 ms** p75, hard fail **200 ms**

**[verified]** CWV "good" INP is ≤200 ms. Again, tighter, because our interactions are local:

| Interaction | Work | Budget |
|---|---|---|
| Sort chip toggle (207-card set) | Re-sort 207 by precomputed key + re-render ≤12 visible tiles | **≤50 ms** |
| Sort chip toggle (21,828-card browse) | Sort key is server-side; client only swaps the query key | ≤80 ms (optimistic paint from cache) |
| Quantity stepper +/− | Optimistic cache write + one badge re-render | **≤30 ms** |
| Search typing | 150 ms debounce; ≤2,000 rows client-side, above that server-side | ≤120 ms to first result |
| Filter chip (Have/Need/Dupes) | URL write + `useDeferredValue` re-filter | ≤120 ms |
| Grid scroll | Virtualizer row swap | **≤16 ms/frame** — this is 60 fps, not INP, and it is the one to watch |

Two mechanisms carry this: (a) `useDeferredValue` so the chip's own visual state commits in
the high-priority render and the grid re-flows in a transition; (b) **precomputed sort keys**
— the tile row carries `sort_number`, `sort_name_ci`, `sort_rarity_ord`, `sort_price_cents`
as scalars so a client sort is a numeric comparator, never a `localeCompare` or a
`parseFloat` per comparison. Sorting 21,828 pre-keyed objects is ~5–15 ms **[inferred]**;
sorting them with `localeCompare` is ~10× that.

### CLS — target **≤ 0.02**, not 0.1

**[verified]** the CWV line is 0.1. We should not need a tenth of it. Every tile's geometry
is fully determined before any byte arrives (fixed `aspect-ratio` box, fixed 74 px footer,
`line-clamp-2` name, fixed-height badge row); the header is 78 px fixed and the sidebar
274 px fixed (UI-SPEC §3.1); the font is preloaded with a matched fallback. The only
plausible shift sources are (a) the set banner's blurred hero image — give it a fixed
`aspect-ratio` too, and (b) the stat strip reflowing when prices arrive — reserve the
digits. Any measured CLS above 0.02 is a bug with a specific cause, not "the cost of doing
business".

### Transfer budget, first visit to a set page

185 KB (JS+CSS gzip) + 47.1 KB (Inter latin) + 9 KB (set JSON) + 98 KB (6 above-fold
`low.webp`) ≈ **340 KB**. Full scroll of a 207-card set adds ~3.3 MB (`low`) on desktop or
~6.8 MB (`mid`) on a DPR-2 phone. Repeat visit, service worker warm: **~9 KB** (the set
JSON revalidation) — everything else is cache-first immutable.

---

# C. Offline / PWA

## C.1 ⛔ The blocker: LAN access is not a secure context

**This is the finding that should change the plan, and nobody has hit it yet.**

**[verified: MDN Secure Contexts]** Service workers, the Cache API, Web App Manifest
installation and `navigator.storage.persist()` all require a **secure context**. The
potentially-trustworthy HTTP exceptions are exactly `http://127.0.0.1`, `http://localhost`,
`http://*.localhost` and `file://`. A plain-HTTP LAN hostname or private IP —
`http://the.grid/…`, `http://192.168.x.x/…` — **is not a secure context.**

**[measured]** the LAN vhost on this box:

```
/etc/nginx/sites-available/thegrid:2   listen 80 default_server;
/etc/nginx/sites-available/thegrid:4   server_name thegrid thegrid.local;
```

No `ssl`, no cert, no `http2`. Meanwhile:

```
/etc/nginx/sites-available/brain-public:33  listen 443 ssl;
/etc/nginx/sites-available/brain-public:35  http2 on;
/etc/nginx/sites-available/brain-public:36  server_name cheyrasnet.tplinkdns.com;
/etc/nginx/sites-available/brain-public:37  ssl_certificate /etc/letsencrypt/live/cheyrasnet.tplinkdns.com/fullchain.pem;
```

**Therefore, as currently routed: on LAN there is no service worker, no offline mode, no
install prompt, and no persistent storage — on any browser.** The brief's PWA requirement
is not partially met on LAN; it is entirely unavailable. The only working PWA path today is
the public HTTPS vhost, which routes through Authelia (§C.6) and out to the internet and
back for a device sitting three metres from the Pi.

### The fix, and it is cheap

**`dnsmasq` is already running on this box [measured]** (`systemctl` reports
`dnsmasq.service … active running`; `ss -tln` shows `0.0.0.0:53`). One line of split-horizon
DNS makes the existing, already-valid Let's Encrypt certificate serve LAN clients:

```conf
# /etc/dnsmasq.d/deckscout-splithorizon.conf   (ILLUSTRATIVE — needs user approval)
address=/cheyrasnet.tplinkdns.com/<pi-lan-ip>
```

LAN clients using the Pi as their resolver then reach `https://cheyrasnet.tplinkdns.com/deckscout/`
over the LAN, with a valid cert, HTTP/2, and a real secure context — **no hairpin NAT, no
second certificate, no new daemon.** Everything in this section then works identically on
LAN and remote.

**Caveats, stated honestly:**
- Only applies to clients that use the Pi (or the router, if it forwards to the Pi) for DNS.
  A phone with DNS-over-HTTPS forced on (iOS "Private Relay", or a manually set 1.1.1.1)
  bypasses it and hairpins out to the WAN.
- HSTS is already set (`max-age=31536000`) on that hostname **[measured]**, so once a device
  has visited it once, it will *only* ever try HTTPS there. That is good, and it also means
  a misconfigured split-horizon fails closed and visibly rather than silently downgrading.
- It changes DNS behaviour for a service the user depends on. **Do not apply it.** Present
  it at the Phase 1 checkpoint alongside the other infrastructure questions.

**Alternatives, ranked:**
1. **Split-horizon DNS (above).** Zero new components, reuses a valid public cert. ✅
2. Second nginx server block on 443 for `deckscout.lan` with a private-CA cert, and install
   the CA on each device. Works, but iOS requires manually trusting the CA in Settings →
   General → About → Certificate Trust Settings, and it expires. Meh.
3. Accept "no PWA on LAN; PWA only over the public hostname". Functional, but means the
   phone in the same room round-trips through the WAN. Poor.
4. Self-signed cert. **No** — service workers will not register on a cert-error origin, so
   this does not even solve the problem.

**Until this is resolved, treat everything below §C as designed-but-not-deliverable, and do
not let Phase 7 discover it.**

## C.2 Service worker strategy per asset class

Use **`vite-plugin-pwa` 1.3.0** with **`strategies: 'injectManifest'`**, not `generateSW`.
Reason: three of our five caching rules need logic that `generateSW`'s declarative
`runtimeCaching` cannot express cleanly — the Authelia redirect guard (§C.6), the bounded
offline-pack image quota (§C.5), and cross-cache eviction coordination. `injectManifest` lets
us write `src/sw.ts` with Workbox 7.4.1 modules and still get the precache manifest injected.

| Asset class | Strategy | Cache | Expiration |
|---|---|---|---|
| **App shell** (`index.html`, entry JS/CSS, Inter woff2, icons, brand `.webm` loader) | **Precache** (`precacheAndRoute(self.__WB_MANIFEST)`) | `deckscout-precache-<buildhash>` | Replaced wholesale on deploy; `cleanupOutdatedCaches: true` (plugin default **[verified]**) |
| **Lazy route chunks** | Precache too | same | Total dist JS+CSS is ~600 KB raw. Precaching all of it makes every route work offline for the price of one background fetch. |
| **Catalog API** (`/api/deckscout/sets/**`, `/cards/**`, `/pokedex/**`) | **StaleWhileRevalidate** | `deckscout-api-catalog` | `maxEntries: 300`, `maxAgeSeconds: 7d`. Catalog is immutable-ish; instant paint then refresh. |
| **Price API** (`/api/deckscout/prices/**`) | **NetworkFirst**, `networkTimeoutSeconds: 3` | `deckscout-api-prices` | `maxAgeSeconds: 24h`. BRIEF §5 wants *last-known* prices offline — NetworkFirst gives exactly that. |
| **Collection mutations** (POST/PATCH) | **Never cached.** Queue with `BackgroundSyncPlugin` | `deckscout-mutations` | `maxRetentionTime: 24h`. Lets you tick cards off in a card shop with no signal. |
| **Card images** (`/deckscout/img/**`) | **CacheFirst** | `deckscout-img-v1` | See §C.5 — bounded, and the bound is the whole design problem |
| **Set logos / symbols** (218 sets, ~4.4 MB **[DATA-LAYER §5.2]**) | **CacheFirst**, precache-on-install | `deckscout-chrome` | Never expire. 4.4 MB buys a fully-navigable offline app. |

`registerType`: **`'prompt'`**, not `'autoUpdate'`. **[verified: options.ts]** `'prompt'` is
the plugin's own default. Auto-update swaps the SW mid-session, and this app holds
significant unsaved-feeling client state (a filter/sort/scroll position deep in a 21,828-card
browse). Show the toast that UI-SPEC §3.14 already specifies — bottom-right, `--shadow-sticker`,
14px/700 — with "Update available · Reload".

`navigateFallback: '/deckscout/index.html'` and `navigateFallbackDenylist: [/^\/api\//]` so an
API 404 surfaces as a 404, not as a silently-served HTML shell (a bug that presents as
"JSON.parse: unexpected token <").

## C.3 Storage quota reality

**[verified: MDN *Storage quotas and eviction criteria* + webkit.org/blog/14403]**

| Browser | Per-origin quota | Group/overall | Eviction |
|---|---|---|---|
| **Chrome / Edge** (Android) | **up to 60% of total disk**, both best-effort and persistent | No group limit | LRU across origins under pressure; persistent origins skipped |
| **Firefox** | best-effort: min(10% of disk, **10 GiB** group limit); persistent: 50% of disk, cap 8 TiB, exempt from group limit | 10 GiB per site | LRU under pressure |
| **Safari / WebKit** (macOS 14+, **iOS 17+**) | **~60% of total disk** for browser apps; ~15% for embedded web content (in-app browsers) | **80% of disk** overall for browser apps; 20% for non-browser | LRU by last user interaction **+ the 7-day rule** |

**The old numbers are dead.** The widely-repeated "iOS gives you 50 MB of Cache Storage and
500 MB of IndexedDB" figures are pre-iOS-17 and are still the top search results in 2026.
Since **Safari 17 / iOS 17**, iOS Safari's per-origin quota is ~60% of device disk. On a
128 GB iPhone with 40 GB free that is tens of gigabytes — **quota is not the binding
constraint any more.**

## C.4 The constraint that *is* binding on iOS: eviction

**[verified: MDN]** *"Safari proactively evicts data when cross-site tracking prevention is
turned on. If an origin has no user interaction, such as click or tap, in the last seven days
of browser use, its data created from script will be deleted. Cookies set by server are
exempt."*

This covers IndexedDB, Cache Storage, localStorage, sessionStorage **and service worker
registrations**. For a collection app opened a few times a month, that is fatal — you'd
reinstall the cache every time.

Two documented escapes, and we want both:

1. **Home-screen install.** A web app added to the Home Screen is not part of Safari and
   maintains its own days-of-use counter, reset by actually opening the app. **[verified:
   webkit.org/blog/14403]** Home Screen web apps have the same origin and overall quota as
   in-browser.
2. **`navigator.storage.persist()`.** **[verified: MDN]** LRU eviction *"only applies to
   origins that are not persistent and skips over origins that have been granted data
   persistence."* **[verified: webkit.org/blog/14403]** *"WebKit currently grants a request
   based on heuristics like whether the website is opened as a Home Screen Web App."*

So the correct sequence, and it must be in this order:

```ts
// Call AFTER the user has installed to Home Screen and interacted — not on first paint.
// On iOS the grant heuristic is display-mode-aware; asking too early gets a soft 'false'.
if (navigator.storage?.persist) {
  const already = await navigator.storage.persisted()
  if (!already && window.matchMedia('(display-mode: standalone)').matches) {
    const granted = await navigator.storage.persist()
    // Surface the answer. If false, the offline pack is best-effort and we must say so.
  }
}
```

Also surface `navigator.storage.estimate()` (`{ usage, quota }`) in a Settings → Offline
panel, with a "Download offline pack" button and a "Clear cached art" button. **If we cannot
guarantee persistence, the honest move is to show the user what we have and let them
re-warm it — not to pretend.**

**Android Chrome:** none of this drama. 60% of disk, no 7-day rule, `persist()` granted
based on engagement/install signals. Android is the easy platform here; iOS sets the design.

## C.5 The 1.87 GB problem, answered honestly

**A phone cannot hold the image cache, and no amount of clever service-worker code changes
that.** The numbers, from DATA-LAYER §5.2 plus §B.3.3 above:

| Tier | Full corpus | Fits on a phone? |
|---|---|---|
| `low.webp` only | **358.6 MB** | Technically yes under iOS 17 quota. **Still a terrible idea.** |
| `low` + `mid` | 1,080 MB | No |
| `low` + `mid` + `high` | **2,594 MB** | Absolutely not |

Even where quota permits 358 MB, spending it is wrong: it is a ~6-hour background download
over Wi-Fi, it competes with the user's photos for flash, and iOS will evict it the first
time the device is under storage pressure and the app hasn't been opened.

**So define what offline actually means, in three tiers, and say so in the UI:**

| Tier | Contents | Size | Always available? |
|---|---|---|---|
| **Tier 0 — Shell** | App shell, 218 set logos + symbols, set/series metadata, Pokédex index, the user's full collection / lists / decks, last-known prices for owned cards | **~5–6 MB** | ✅ Precached on install. This is the floor and it should never fail. |
| **Tier 1 — Visited** | `low.webp` for every card the user has actually looked at, LRU-capped at **2,000 images ≈ 33 MB** | ~33 MB | ✅ Automatic, invisible, CacheFirst + `ExpirationPlugin({ maxEntries: 2000 })` |
| **Tier 2 — Offline pack (opt-in)** | `low.webp` for every card in the user's collection **plus** every card in their tracked sets. A serious collector with 3,000 owned cards across 15 sets ≈ 3,000 + ~3,100 set cards ≈ 6,100 images ≈ **100 MB** | ~50–120 MB | ⚙️ Explicit button in Settings → Offline, with a size estimate *before* download, a progress bar, and a Delete button |

**What offline can mean:** browse and search the whole catalog *by metadata*, see every set's
progress, edit your collection (queued via Background Sync), read last-known prices, and see
real art for everything you own and everything in the sets you're working on.

**What offline cannot mean:** scrolling a set you've never opened and seeing card art.
That will show the `--surface-tertiary` skeleton (UI-SPEC §3.22) with the card name and
number — which is genuinely usable, and is what we should show rather than a broken-image
icon. Build that empty state deliberately; it is the most-seen offline state.

**Desktop is different.** A laptop can hold all 358 MB of `low`. Offer the Tier-2 button a
"whole catalog (358 MB)" option when `navigator.storage.estimate().quota` exceeds ~5 GB —
but *never* default it on.

## C.6 The Authelia interaction — a specific PWA failure mode

**[measured]** `/etc/nginx/snippets/authelia-protect.conf` ends with:

```
error_page 401 =302 https://$host/authelia/?rd=$target_url;
```

An expired Authelia session turns **every** request — including `fetch('/api/deckscout/...')`
from inside the service worker — into a **302 to an HTML login page**. The classic failure:
the SW caches that HTML under the API's cache key, and from then on the app "loads" but every
query returns a login page. Users experience it as permanent, unexplainable corruption that
only a full site-data clear fixes.

Three guards, all mandatory:

1. **Never cache a redirected or non-JSON response.** In the SW route handler, reject when
   `response.redirected === true`, or `response.type === 'opaqueredirect'`, or
   `!response.headers.get('content-type')?.startsWith('application/json')`.
2. **Detect the auth boundary and surface it.** On such a response, `postMessage` to all
   clients and render a "Session expired — sign in again" state, rather than falling through
   to stale cache and pretending everything is fine.
3. **Prefer `fetch(..., { redirect: 'manual' })`** for API calls so a 302 is observable rather
   than silently followed into HTML.

Separately: **the service worker script itself must not be gated.** `/deckscout/sw.js` and
`/deckscout/manifest.webmanifest` need to be reachable for registration and install. If
Authelia 302s `sw.js`, the browser refuses to register a SW whose response isn't JavaScript,
and the PWA silently never installs — with no console error that names the cause. Give them
their own `location` with `auth_request off;`, or accept that install only works while a
session is live. **Another item for the checkpoint list.**

---

# D. Building on the Pi

## D.1 The question

Can a Vite production build of this app run comfortably on 4 cores with ~4.5 GB available
**[measured: `free -m` → 4,524 MB available; `nproc` → 4; load 0.23]**, alongside Gitea,
nginx, six pm2 services and six containers?

**Yes — and Vite 8 is why.** I did not run a build, per the brief. Here is the reasoning.

## D.2 Sizing from the dependency graph

**Module count.** Our runtime dependency set is deliberately small: React (2 packages),
TanStack Router + Query + Virtual (~6 with internals), Tailwind (build-time only, Rust/Oxide
engine), d3-scale + d3-shape (~15 tiny d3 submodules), dnd-kit (~4). Plus our own ~150–200
source modules for a ~40-component design system and ~20 routes. **Total graph ≈ 700–1,000
modules [inferred].** For scale: a typical Next.js commerce app is 4,000–8,000.

**Comparable on this exact hardware [measured].** `/home/cheyras/ColorSplash` — Vite 6,
React 19, 66 TS files, 420 KB of source, `node_modules` 253 MB — builds to a single 352 KB
chunk. Its `deploy.sh` runs `pnpm install --frozen-lockfile && pnpm build` **on the Pi**,
in production, today. So the box already does this; the only question is whether ~4× the
source survives it.

**Where the memory actually goes:**

| Phase | Peak RSS | Basis |
|---|---|---|
| `pnpm install` (~450 MB `node_modules` **[inferred]** from ColorSplash's 253 MB + Vite 8's +15 MB + our extra deps) | ~400–600 MB | pnpm's isolated `nodeLinker` **[verified: pnpm.io/settings]** hardlinks from the store; disk and RAM both benefit |
| Vite/Rolldown transform + bundle | **~500–800 MB** | Module graph lives in **Rust**, not V8 heap — this is the whole point of Vite 8 |
| Tailwind Oxide scan | ~80 MB | Rust engine |
| Node process overhead + plugin JS | ~250 MB | |
| **Peak** | **~1.0–1.2 GB** | Against 4.5 GB available |
| `tsc --noEmit` (**if** in the same command) | **+700 MB–1.4 GB** | TypeScript's checker is the memory hog, not the bundler |

**Time [inferred]:**

| | Cold (no `node_modules`) | Warm |
|---|---|---|
| `pnpm install --frozen-lockfile` | 4–7 min (microSD, inode-heavy; DATA-LAYER §2 measured a 38,925-file checkout at 4.6 min) | 10–25 s |
| `vite build` (Rolldown) | 40–70 s | 40–70 s |
| Precompress `dist` with `gzip -9` | 3–6 s | 3–6 s |
| **Total** | **~10–12 min** | **~60–100 s** |

## D.3 Recommendation: build on the Pi, with three guardrails

**Build on-device.** It matches the box's existing convention (`ColorSplash/deploy.sh`),
avoids a second toolchain, and keeps `docker compose up -d` / `deploy.sh` as the whole
story — which is what BRIEF §6's definition of done asks for. Cross-building on a laptop
adds an arm64/x64 divergence risk for no benefit, since Vite output is architecture-neutral
JavaScript.

Guardrails:

1. **`nice -n 10 ionice -c2 -n7 pnpm build`.** This box runs six pm2 services the user
   depends on. A build that steals all four cores for 70 seconds is a user-visible outage of
   Lumina/ColorSplash/podscribe. Deprioritise it. Cheap insurance.
2. **Keep `tsc` out of the deploy path.** The idiomatic `"build": "tsc -b && vite build"` is
   what would actually put this over the edge — TypeScript's checker, not Rolldown, is the
   memory and time hog. Make it:
   ```jsonc
   "build":      "vite build",                    // deploy path — fast, low memory
   "typecheck":  "tsc --noEmit",                  // CI / pre-commit only
   "build:full": "pnpm typecheck && pnpm build"   // local dev
   ```
   Types are a *source correctness* concern; they have nothing to say at deploy time about a
   commit that already passed CI.
3. **Do not raise the Node heap by default.** `--max-old-space-size` is a *ceiling*, not an
   allocation, and V8's default on an 8 GB box is already ~2 GB — comfortably above our
   ~1.2 GB estimate. If a build ever does OOM, the correct first response is to check whether
   `tsc` crept back into the command, not to raise the ceiling. If genuinely needed:
   `NODE_OPTIONS=--max-old-space-size=2048`. Setting 4096 on a shared box invites the OOM
   killer to pick a pm2 service instead.
4. **Watch the microSD, not the CPU.** DATA-LAYER §5.4 measured this box already writing
   **6.84 GB/day** at idle. A cold `pnpm install` writes ~450 MB of tiny files. Prefer
   `--frozen-lockfile`, never `--force`, and don't rebuild `node_modules` on every deploy.

**Escape hatch if it does struggle:** build in a `tmpfs` (`--outDir /dev/shm/deckscout-dist`,
then `rsync` to `dist/`). ~200 MB of the 8 GB RAM, and it removes the microSD from the build
loop entirely. Worth doing on day one, honestly — it's one line and it protects the card.

## D.4 Dev-server workflow through nginx

The dev server must serve from `/deckscout/` too, or every path assumption differs between dev
and prod — the exact class of bug the sub-path constraint is about.

```ts
// vite.config.ts  (illustrative)
export default defineConfig({
  base: '/deckscout/',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src', filename: 'sw.ts',
      registerType: 'prompt',
      manifest: { /* start_url + scope inherit base — verified */ },
      injectManifest: { globPatterns: ['**/*.{js,css,html,woff2,svg,webp,webm}'] },
      devOptions: { enabled: false },   // see caveat below
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 3709,                          // inside the 3700–3709 block DATA-LAYER reserved
    strictPort: true,
    allowedHosts: ['.the.grid', 'cheyrasnet.tplinkdns.com'],
    proxy: { '/api/deckscout': { target: 'http://127.0.0.1:3700', changeOrigin: true } },
  },
})
```

Two ways to reach it, and I recommend the first:

- **Direct, over an SSH tunnel** (`ssh -L 3709:127.0.0.1:3709 pi`) → `http://localhost:3709/deckscout/`.
  `localhost` **is** a secure context **[verified: MDN]**, so the service worker, install
  prompt and storage APIs all work in dev *without* touching nginx. HMR works over the
  tunnel with no `hmr.clientPort` gymnastics. **This is the clean answer** and it means we
  never reload nginx for development — which `/home/cheyras/CLAUDE.md` explicitly warns
  about.
- **Through nginx**, only when testing the real ingress: a temporary
  `location /deckscout/ { proxy_pass http://127.0.0.1:3709/deckscout/; }` with WebSocket upgrade
  headers for HMR, and `server.hmr.clientPort = 443` on the public vhost. Requires an nginx
  reload → **requires asking the user**. Reserve it for pre-Phase-7 verification.

`allowedHosts` matters: **[measured]** ColorSplash already sets `allowedHosts: ['.the.grid']`
for exactly this reason — Vite blocks unknown Host headers by default and the failure
message ("Blocked request") does not obviously point at nginx.

**Caveat on `devOptions.enabled`:** leave the dev service worker **off**. A live SW in dev
caches modules and produces "my change didn't apply" confusion that costs hours. Test the
SW against `vite preview --base /deckscout/` over the SSH tunnel instead — a real build, a real
SW, on a secure `localhost` origin.

---

# E. Charts and specialist components

## E.1 Price-history charts

**UI-SPEC §3.16 is explicit: the chart is `U`** — *"Price-history chart was U — the card-detail
'Price' tab was never opened."* We have zero evidence of pkmn.gg's chart. **We are designing
it, not reproducing it.** That freedom should be spent on token fidelity and touch feel, not
on a library's opinions.

### The candidates, measured **[verified: bundlephobia, 2026-07-24]**

| Library | Version | gzip | Render | Touch/tooltip | Verdict |
|---|---|---|---|---|---|
| `recharts` | 3.10.0 | **143.9 KB** | SVG | Good | ❌ 2.2× the React runtime, for one chart |
| `echarts` | 6.1.0 | 359.3 KB | Canvas | Excellent | ❌ Absurd here |
| `@observablehq/plot` | 0.6.17 | 125.0 KB | SVG | Weak | ❌ |
| `victory` | 37.3.6 | 105.2 KB | SVG | Good | ❌ |
| `@nivo/line` | 0.99.0 | 90.2 KB | SVG | Good | ❌ |
| `chart.js` | 4.5.1 | 66.8 KB full | Canvas | **Excellent** out of the box | ⚠️ ~35–45 KB tree-shaken **[inferred]**; imperative; theming from JS means reading tokens via `getComputedStyle` |
| `lightweight-charts` | 5.2.0 | 59.6 KB | Canvas | **Excellent** — built for mobile trading | ⚠️ Purpose-built for price series; but carries a TradingView attribution requirement and its own theming model |
| `@visx/*` composed | 4.0.0 | ~48 KB (scale+shape+axis+tooltip+curve) | SVG | You build it | ⚠️ Mostly a d3 re-export with React ergonomics |
| `uplot` (+`uplot-react` 1.2.4) | 1.6.32 | **21.3 KB** | Canvas | ⚠️ Weak — desktop-first; touch needs community plugins | ⚠️ Fastest, smallest library option |
| **`d3-scale` + `d3-shape`, our own SVG** | 4.0.2 / 3.2.0 | **21.1 KB** | SVG | We control it entirely | ✅ **Recommended** |

### Recommendation: hand-rolled SVG on `d3-scale` + `d3-shape`

The decisive facts:

1. **The workload is trivial.** A price-history chart is **one series** over 30 / 90 / 365
   points (DATA-LAYER: price history accrues from our own syncs). Collection-value-over-time
   is the same shape. There is no dataset here that justifies a canvas renderer or a
   charting engine. Every library above is priced for a problem we don't have.
2. **Token fidelity is the actual requirement.** UI-SPEC §3.16 is unambiguous: *every* price
   renders in `--change-positive` `#35F197`; deltas use `--change-positive` / `--change-negative`;
   the panel is `--surface-tertiary` at `--radius-lg`; grid lines want `--divider-subtle`;
   the crosshair wants `--border-focus`. In SVG each of those is literally
   `stroke="var(--color-divider-subtle)"` — the chart inherits the design system for free and
   stays correct if a token ever changes. Canvas libraries require reading every token out of
   CSS with `getComputedStyle` at mount and re-reading on theme change. UI-SPEC §2.3 keeps
   the seams for a future light scheme; a canvas chart is the one component that would break.
3. **Touch is better in SVG here, not worse.** One `<rect>` overlay with `touch-action: none`
   and a `pointermove`/`pointerdown` handler doing a binary search over the x-scale gives
   crosshair-follows-finger with zero library. That is ~30 lines and it is *more* controllable
   than any library's tooltip API — including making the tooltip avoid the finger, which is
   the thing every library gets wrong on mobile.
4. **21.1 KB, in a lazy chunk.** Only the card-detail Price tab and the profile
   value-history view load it. It never touches the entry budget.

**Scope of what we write:** `scaleTime` + `scaleLinear` from d3-scale; `line()` + `area()` +
`curveMonotoneX` from d3-shape; axes and gridlines as plain JSX (~40 lines — d3-axis is
imperative DOM manipulation and fights React, skip it); a crosshair overlay; a range selector
that reuses the existing sort-chip component (UI-SPEC §3.8) for `24h / 7d / 30d / 1y / All`,
matching BEHAVIOR-SPEC §11's documented `24h / 7d / 30d` trend windows.

**Honest caveat:** this is ~250–350 lines of our code that a library would have given us. I
am recommending it because the alternative that best matches our needs (`uplot`, 21.3 KB) has
a documented weak touch story on a phone-first app, and the one with the best touch story
(`lightweight-charts`, 59.6 KB) brings a theming model that fights a 77-token CSS-variable
design system. **If the team wants a library anyway, take `uplot` + a touch plugin** — same
size, less code, worse fingers. Do not take Recharts.

**Also note:** UI-SPEC §3.6 records that **no circular progress meter exists anywhere on
pkmn.gg** — set completion is bar-based, with a salmon→yellow gradient fill and milestone
dots at 25/50/75%. That is a hand-rolled component, not a chart library's gauge. Same for
the profile's energy-type count grid (§3.18) and the deck-builder's `0/60` dock track (§3.23).
**No chart library is needed for any progress UI in this app.**

## E.2 Drag-and-drop, and the risk to call out loudly

### The requirement

- **Lists:** BEHAVIOR-SPEC §6 — `Custom` sort *is* the manual arrangement; **[D]** changelog
  C3 explicitly fixed *"Dragging to reorder cards in your lists had stopped responding on
  phones and tablets. Touch dragging behaves like it used to."* **Touch drag is a
  first-class, evidenced requirement.**
- **Binder:** BEHAVIOR-SPEC §7 — 9 / 12 / 4-pocket pages, slot identity, empty slots as
  placeholders, drag-reorder, search-to-slot. DECISIONS.md correction #8: *"The 9-pocket
  positioned binder is ours to build."*

### The library

| Option | Version | gzip | Touch | Verdict |
|---|---|---|---|---|
| `@dnd-kit/core` + `@dnd-kit/sortable` | 6.3.1 / 10.0.0 | 13.9 + 3.6 KB | ✅ Pointer Events — works identically on mouse and touch | ✅ **Recommended** |
| `@dnd-kit/react` | 0.5.0 (2026-06-11) | 32.3 KB | ✅ | ⚠️ The rewrite. Actively released but **pre-1.0**. |
| `@atlaskit/pragmatic-drag-and-drop` | 2.0.1 | tiny core | ❌ **Native HTML5 DnD** | ❌ Touch is documented as unusable; open issues on iOS multi-drag and touch-start ergonomics. Disqualifying. |
| `react-dnd` | 16.0.1 | — | ❌ | ❌ **Last published 2022-04-19** — unmaintained. |

**Recommend `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0**, with the risk stated:
**core was last published 2024-12-05 [measured] — 19 months of no releases.** That is not
abandonment (the team is shipping `@dnd-kit/react`), but it is a maintenance signal. The
mitigation is that our usage is confined to one `<BinderPage>` and one `<SortableList>`
component, so a future migration to `@dnd-kit/react` v1 is a two-file change. Note it in
DECISIONS.md and revisit when `@dnd-kit/react` reaches 1.0.

### ⚠️ The known-hard combination — and how we avoid it entirely

**Virtualized grid + drag-and-drop is genuinely hard, and it fails in specific ways:**

1. `SortableContext` needs the full ordered id array. Under virtualization only ~20 of 21,828
   items are mounted, so drop targets outside the window **do not exist in the DOM**.
2. Auto-scroll during drag mounts/unmounts items *underneath the pointer*, so dnd-kit's
   cached collision rects go stale mid-gesture; the drop indicator jumps or lands on the
   wrong slot.
3. Dragging to a position 400 rows away requires scrolling the virtualizer while a drag is
   active — the two systems fight over the scroll container.
4. On touch, all of the above happens while the browser is also trying to decide whether the
   gesture is a scroll. iOS is the worst case.

**Do not solve this. Design it away.** The reference material already tells us how:

- **Binder view is paginated, not scrolled.** BEHAVIOR-SPEC §7 items 5 and 8: search
  *"brings you to the right **page** and slot"*; *"which binder **page** and slot"*. A binder
  page is **9, 12, or 4 cards**. That is a bounded, fully-mounted DOM set — **virtualization
  is neither needed nor wanted**, and dnd-kit operates on ≤12 sortable nodes with fixed
  slot geometry. This is the easy case, not the hard one.
- **Grid view is virtualized and read-only.** Reordering happens in binder view. Grid view's
  ordering comes from the sort chips (BEHAVIOR-SPEC §5.3), which are a URL param, not a drag.
- **Custom-sorted list reorder happens in binder view too**, or in a compact non-virtualized
  reorder mode with a "Reorder" toggle. If a list is large enough to need virtualization
  (>200 items), offer *move-to-position* (a numeric input / "move to page N slot M") instead
  of a drag across 400 rows — which is a better interaction on a phone anyway.

**Rule to write into ARCHITECTURE.md: a component is either virtualized or draggable. Never
both.** If someone later proposes a virtualized draggable grid, this is the paragraph to
point at.

### E.3 Other specialist needs

| Need | Recommendation | Note |
|---|---|---|
| Test-hand / sample draw (BRIEF §2) | Nothing. `Array` shuffle + CSS transforms | 7-card fan; a spring library is not warranted |
| PTCG Live import/export | Nothing. Hand-rolled parser | Line-oriented text format |
| Virtualized **table** view (UI-SPEC §3.8 records Table view as **U**) | Same TanStack Virtual row virtualizer + plain `<table>` with `table-layout: fixed` | Don't reach for TanStack Table until we know what columns Table view actually has |
| CSV / PDF export (BRIEF §2) | CSV: hand-rolled. **PDF: server-side** | A client-side PDF lib (`pdf-lib`, `jspdf`) is 100–300 KB gzip. The Pi already has ImageMagick and headless Chromium **[measured]**. Generate PDFs on the backend. |
| Card scanner (BRIEF §2, optional) | Deferred; lazy route | `@zxing/library` or WASM; must never touch the entry bundle |
| Toast / popover / modal primitives | Hand-rolled on `<dialog>` + Popover API where baseline allows, else React Aria | UI-SPEC §3.13 records **no modal was ever captured** — we're designing it. Don't import a 40 KB headless-UI kit for three components. |
| Icons | Ship our own SVG sprite | UI-SPEC §1.2: icons take **three** colour inputs (resting/fallback/hover) as CSS custom properties. No icon library models that. UI-SPEC §1.3: 11 energy glyphs are ours to draw. |

---

# 7. What I could not verify

| # | Item | Status |
|---|---|---|
| 1 | **Peak build memory for Vite 8 / Rolldown.** No official figure published; the "lower than Rollup" claim is **[inferred]** from the Rust module graph. §D.2's 1.0–1.2 GB is an estimate. Only a real build settles it — deliberately not run. | **[unverified]** |
| 2 | **Tree-shaken `chart.js` size.** The 66.8 KB figure is the full package. My ~35–45 KB tree-shaken estimate is **[inferred]**; measuring it requires installing and bundling. | **[unverified]** |
| 3 | **Vite 8 changes between 8.0 and 8.1.5.** Read the 8.0 announcement; did not read the 8.1 changelog. | **[unverified]** |
| 4 | **Tailwind 4.1 / 4.2 / 4.3 deltas.** The upgrade guide covers v3→v4 only; incremental v4 changes are not documented there. Our token mapping uses only `@theme`/`@theme static` semantics, which are stable since 4.0. | **[unverified]** |
| 5 | **Whether iOS Safari's 7-day rule exempts a granted-`persist()` origin *in addition to* Home-Screen apps.** MDN states LRU eviction skips persistent origins; the ITP 7-day rule is described separately. The two escapes are documented independently; whether either alone suffices is not stated by WebKit. **We should use both.** | **[unverified]** |
| 6 | **`sharp`/libvips encode throughput on this Pi.** The ~35 min full-corpus figure is **[inferred]** ~10× from the **[measured]** 3.6 s/img `ffmpeg` result. `sharp` is not installed here. | **[unverified]** |
| 7 | **Real LCP/INP on the user's actual phone.** Every number in §B.5 is derived. They are targets to *measure against* in Phase 3, not claims. A sibling agent owns browser work; this needs a real device on the real LAN. | **[unverified]** |
| 8 | **`http2_max_concurrent_streams` current value.** Not set in the vhosts, so nginx's default (128) applies; not confirmed against this nginx build's compiled default. | **[unverified]** |
| 9 | **`@dnd-kit/react` 0.5.0 API stability.** Pre-1.0. Recommendation stands on `@dnd-kit/core` 6.3.1 instead. | **[unverified]** |

---

# 8. Decisions this document asks the Phase 1 checkpoint to make

Not for a subagent to decide. Each has a real cost or a real blast radius.

1. **Split-horizon DNS for `cheyrasnet.tplinkdns.com` on the running dnsmasq** — the only
   cheap way to get a secure context (and therefore *any* PWA) on LAN. Changes DNS behaviour
   for services the user depends on. **§C.1. Highest priority; everything PWA depends on it.**
2. **Exempt `/deckscout/img/` (and `/deckscout/sw.js`, `/deckscout/manifest.webmanifest`) from
   Authelia** on the public vhost. Security-posture change; also removes ~21,828 auth
   subrequests from a full browse and unblocks SW registration. **§B.3.5, §C.6.**
3. **Add a third `mid` (400w, q75) image tier: +721 MB, ~5.5 h one-off encode.** Halves the
   worst path in the app (mobile set page 14.4 MB → 6.8 MB). Amends DECISIONS.md's "both
   resolutions". **§B.3.3.**
4. **Scope `gzip_static on` to the DeckScout nginx locations** and precompress `dist` at build.
   JS/CSS/JSON are served **uncompressed on this box today** (`gzip_types` commented out).
   Do not change it globally — six other services share that config. **§B.3.5.**
5. **Accept the 4.7 px tile-height deviation** from UI-SPEC §3.2, in exchange for not
   squashing or cropping card art (`aspect-ratio: 245/337` + `object-fit: cover`). **§B.3.4.**
6. **Accept the spacing-token approach** (`--spacing` stays at the 4-pt default; site-measured
   odd values become *named* steps) rather than UI-SPEC §1.10's `--spacing: 2px`. **§A.4.2.**
7. **Accept the offline honesty**: Tier-0 shell always, Tier-1 visited art automatic, Tier-2
   opt-in pack ~50–120 MB. The full 1.87 GB image cache is a desktop-only proposition and a
   phone will never hold it. **§C.5.**
