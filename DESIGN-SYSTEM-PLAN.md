# DeckPal Design-System Editor — Implementation Plan

**Status:** proposed — awaiting product-owner sign-off on the items in §8.1 before
any implementation begins.
**Prerequisite reading:** `DESIGN-SYSTEM-AUDIT.md` (same directory). This plan
builds directly on that audit and does not restate its evidence; section
references of the form "audit §N" point there.
**Branch/worktree:** `design-system` at `/home/cheyras/deckpal-worktrees/design-system`.

---

## 0. What is being built, in one paragraph

A dev-only route, `/design`, inside the existing web app. At the top: every
design token from `apps/web/src/theme.css`, each rendered as a real editable
control (color pickers, px steppers, font selector). Changing a token instantly
re-themes the live primitive/component catalog rendered below it (and the whole
app, since overrides are applied to `document.documentElement`). Below the
tokens: a catalog of every UI primitive and every repeated component, rendered
in their real states from type-checked, co-located gallery files, each with
per-prop knobs. Persisting any change goes through a **change-application
layer** with two lanes: token value edits are applied deterministically to
`theme.css` by a Vite dev-server plugin (and logged), while component/primitive
change requests are queued as structured JSON that a real agent (a Claude Code
session via a repo skill first; an opt-in SDK daemon later) picks up, reasons
about, and applies to the actual source files — which the running dev server
then hot-reloads, closing the loop visually on the same page. Alongside the
editor surface, the componentization backlog from audit §4 is executed so the
catalog is actually complete.

---

## 1. Architecture

### 1.1 The core decision: where "apply a change" lives

**Decision: the change-application endpoints live in a Vite dev-server plugin,
not in the Express API (`apps/api`).**

Why this matters and why it wins:

- **Structural prod-safety.** `apps/api` deploys to production twice over
  (Vercel serverless + self-host pm2). Any source-file-writing endpoint added
  there needs runtime guards to not exist in prod, and a guard is a bug waiting
  to happen. A Vite plugin's `configureServer` middleware exists *only* while
  `vite dev` runs — it is not part of `vite build` output and cannot ship. The
  capability is absent from production by construction, not by configuration.
- **Same process, same filesystem, same worktree.** The Vite dev server already
  runs from `apps/web` in the exact worktree whose files need editing. Writing
  `theme.css` from the process that is also watching `theme.css` means the
  write and the hot-reload are inherently consistent — no cross-worktree
  confusion (the audit flagged the `DECKPAL_DEV_API_PORT` port-per-worktree
  convention; this design sidesteps the problem entirely: no new port, no
  proxy entry, the endpoints are same-origin on :5199).
- **No auth surface needed.** The dev server binds localhost only (no `host`
  option in `vite.config.ts`), so the write capability is reachable only by
  the developer's own machine.

### 1.2 The two-lane change-application model (the answer to "send changes back to an agent")

This is the part with no precedent (audit §6.4), so it is specified precisely.
The honest observation driving the design: **not all edits carry the same
judgment content.**

- Swapping `--color-action-primary: #ffd54a` for `#f5c832` is a mechanically
  unambiguous single-line substitution. Routing it through an LLM adds latency,
  cost, and failure modes while adding zero judgment. Blind field-replacement
  is not a downgrade here — it is the correct tool.
- "Make the primary button feel heavier" or "the md size should be 46px tall"
  or "add a Space Grotesk option" are *not* mechanically unambiguous. They
  require deciding whether the change is a default-prop edit, a new variant, a
  token promotion, or a multi-file change (a new font means installing a
  `@fontsource` package *and* adding an `@import` *and* editing `--font-sans`).
  That is agent work, and stubbing it with rigid field-to-file mapping would
  be the facade the brief warns against.

So: **two lanes, one shared ledger, one shared UI.**

**Lane A — deterministic token apply.** `POST /__design/tokens/apply` performs
an anchored, validated, single-declaration text replacement in `theme.css`
(details §2.4). Every apply is appended to the same ledger the agent lane uses,
so an agent later reading history sees the full picture. If the owner decides
they want tokens agent-mediated too, the plugin takes a `tokenLane:
'direct' | 'agent'` option and Lane A requests are simply enqueued into Lane B
instead — the UI does not change. **This is an explicitly flagged scope call,
not a silent downscope: the owner's verbatim ask says changes go "back to an
agent"; Lane A is proposed as the default for pure value swaps because it is
strictly better UX for that case, and it is reversible by flipping one option.
Owner sign-off requested in §8.1.**

**Lane B — agent-mediated change requests.** Everything that is not a pure
token value swap becomes a structured `ChangeRequest` JSON file in a queue
directory (`design-requests/queue/`), written by `POST /__design/requests`.
This deliberately mirrors the proven bug-reporter shape (audit §6.4: UI writes
a structured artifact, an agent acts on it) but makes the loop *live*: the UI
polls request status, and because the agent edits source files in the same
worktree the dev server is watching, the applied change hot-reloads into the
catalog the owner is looking at. Two interchangeable consumers drain the queue:

1. **Phase 3a — a Claude Code skill** (`.claude/skills/design-requests/SKILL.md`).
   The owner runs a Claude Code session in the worktree and invokes the skill
   (or asks "process design requests"); the session drains `queue/`, applies
   each request with real judgment, writes a result JSON, moves the file to
   `done/` or `failed/`. This is B9-friendly: a human is supervising the agent
   in the loop, every edit lands in the git working tree uncommitted, and
   `git diff` is the review surface. Near-zero new infrastructure; the agent is
   a *real* reasoning agent (the very session the owner already works with),
   not a script.
2. **Phase 3b (opt-in, needs explicit approval) — an SDK daemon**
   (`scripts/design-agent/agent.mjs`, started manually via `pnpm design:agent`).
   Uses `@anthropic-ai/claude-agent-sdk` `query()` per request with
   `cwd` = worktree root, tools restricted to `Read`/`Grep`/`Glob`/`Edit`/`Write`
   scoped to `apps/web/src/**` (enforced via the SDK permission callback), a
   `maxTurns` cap, and a heartbeat file so the UI can show "agent online".
   This gives the synchronous "I clicked, the agent did it, I watched it
   happen" feel. It never commits; it never touches files outside the scope; it
   only runs while the owner has deliberately started it.

**The queue directory is the contract.** The UI, the plugin, the skill, and the
daemon all speak `design-requests/` JSON. Swapping 3a for 3b (or running both at
different times) requires zero UI changes. This is the "clear seam where a real
agent could be swapped in" made concrete — except the seam ships *with* a real
agent consumer (the skill) in the same phase, so there is no stub period.

**Why not MCP (deckpal-mcp) as the transport?** Audit §6.4 correctly notes the
auth/transport is solved there — but deckpal-mcp is a *production* server scoped
to database rows, deployed publicly. Adding "write to `apps/web/src/**`" tools
to it would put source-file-write capability behind a production endpoint,
which is exactly the wrong blast radius for a local dev tool. Rejected.

**Why not Storybook?** No existing install (audit §5); it would be a second app
with its own build, outside the PWA/token/HMR context, and its addon model
would still leave the agent channel as custom work. The in-app route gets
token-override propagation and dev-server HMR for free and keeps the catalog
rendering in the *real* app context. The project's own pre-build research
already validated an in-app unlinked showcase route (audit §5,
`/primitives-showcase`); this plan is that recommendation grown to cover
tokens + editing.

### 1.3 Route and gating

- **Route:** `/design`, TanStack route registered in `apps/web/src/main.tsx` —
  **only when `import.meta.env.DEV`**. Because Vite statically replaces
  `import.meta.env.DEV` with `false` in production builds, the entire route
  subtree (component, gallery files, knob controls) is dead-code-eliminated
  from the prod bundle, which also keeps it out of the service-worker precache
  manifest (audit §6.1's PWA concern) with no SW config changes. Concretely, in
  `main.tsx` build the children array first, conditionally push, then
  `addChildren`:

  ```ts
  const routeChildren = [indexRoute, authRoute, /* …existing… */ searchRoute]
  if (import.meta.env.DEV) {
    routeChildren.push(
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/design',
        component: lazyRouteComponent(() => import('./routes/design/DesignSystem')),
      }),
    )
  }
  const routeTree = rootRoute.addChildren(routeChildren)
  ```

- **Chrome/auth treatment:** add `'/design'` to `CHROMELESS_PATHS` in
  `apps/web/src/lib/landingRoute.ts`. That makes it public (no `AuthGuard`
  bounce, no authenticated queries mounting) and chromeless (no sidebar
  stealing width from the catalog). Harmless in prod: the route does not exist
  there, so the pathname never matches. The design page renders its own thin
  header (title, "changes pending" indicator, agent-status pill).
- **Dev-server note for parallel worktrees:** `vite.config.ts` pins port 5199.
  If another worktree's dev server is already up, run this one with
  `pnpm --filter deckpal-web dev -- --port 5299`. The `/__design` endpoints
  are same-origin so no other config changes.

### 1.4 Complete file map (new files)

| Path (worktree-relative) | What it is |
|---|---|
| `apps/web/vite-plugins/design-editor.ts` | Vite plugin: `configureServer` middleware for all `/__design/*` endpoints; theme.css parser + anchored writer; request-queue writer/reader; ledger appender |
| `apps/web/src/routes/design/DesignSystem.tsx` | The route component: page layout, section nav (Tokens / Primitives / Components / Pending), request-status panel |
| `apps/web/src/routes/design/TokenPanel.tsx` | Token section: fetches `GET /__design/tokens`, renders per-category controls, wires live overrides + save |
| `apps/web/src/routes/design/useTokenOverrides.ts` | Override store: `Map<tokenName, value>` in React state; effect applies/removes `document.documentElement.style.setProperty()`; exposes `set/reset/resetAll/savedAck` |
| `apps/web/src/routes/design/knobs.tsx` | Knob control components: `ColorKnob` (native `<input type=color>` + alpha/format-preserving text field), `PxKnob`, `SelectKnob`, `BooleanKnob`, `TextKnob`, `NumberKnob` |
| `apps/web/src/routes/design/galleryTypes.ts` | `GalleryMeta<P>` / `KnobDef` types (§3.2) |
| `apps/web/src/routes/design/CatalogSection.tsx` | Discovers `*.gallery.tsx` via `import.meta.glob`, renders each entry: states grid + knob strip + "Send to agent" composer |
| `apps/web/src/routes/design/RequestsPanel.tsx` | Change-request list: polls `GET /__design/requests`, shows queue/working/done/failed + agent summaries + files changed |
| `apps/web/src/routes/design/designApi.ts` | Thin typed client for the `/__design/*` endpoints |
| `apps/web/src/components/**/*.gallery.tsx` | One per cataloged primitive/component, co-located with its component (§3) |
| `.claude/skills/design-requests/SKILL.md` | Phase 3a queue consumer: the agent playbook for draining `design-requests/queue/` |
| `scripts/design-agent/agent.mjs` | Phase 3b opt-in SDK daemon |
| `design-requests/` (gitignored) | `queue/`, `working/`, `done/`, `failed/`, `ledger.ndjson`, `agent-heartbeat.json` |

Modified files: `apps/web/vite.config.ts` (add plugin), `apps/web/src/main.tsx`
(conditional route), `apps/web/src/lib/landingRoute.ts` (chromeless path),
`.gitignore` (add `design-requests/`), root `package.json` (`design:agent`
script, phase 3b only), plus the componentization work in §4.

### 1.5 Endpoint surface (all under `/__design/`, dev server only)

| Endpoint | Shape |
|---|---|
| `GET /__design/health` | `{ ok: true, worktree: "<abs path>", branch: "<git branch>" }` — lets the UI display which checkout it is editing (guards against "wrong worktree" confusion) |
| `GET /__design/tokens` | `{ fileHash: string, tokens: TokenInfo[] }` — parsed fresh from `theme.css` on every call (disk is the source of truth, never a cache) |
| `POST /__design/tokens/apply` | body `{ name, newValue, expectedValue }` → `200 { fileHash }` on success; `409` if the current on-disk value ≠ `expectedValue` (stale panel; client refetches); `422` if `newValue` fails category validation |
| `POST /__design/requests` | body: `ChangeRequest` sans `id` → `201 { id }`; writes `design-requests/queue/<id>.json` + ledger line |
| `GET /__design/requests` | `{ agentAlive: boolean, requests: RequestStatus[] }` — scans the four state dirs (newest 50), merges result JSONs; `agentAlive` from heartbeat-file freshness (< 15 s) |

`TokenInfo`: `{ name, value, category: 'color'|'radius'|'shadow'|'font'|'text'|'ease'|'breakpoint'|'z', section: string /* from the ── comment headers */, block: 'theme'|'root', livePreviewable: boolean, note?: string }`.

---

## 2. Token panel design

### 2.1 Parsing `theme.css`

The file is highly regular (verified by reading it in full): two blocks
(`@theme static { … }` and `:root { … }`), declarations matching
`^\s*--([a-z0-9-]+(--[a-z-]+)?):\s*(.+);` with optional trailing comments, and
`/* ── section ── */` headers giving human grouping. The plugin parses with a
small line-based scanner (no CSS-parser dependency): track which block it is
in, capture the most recent section header, emit one `TokenInfo` per
declaration. Anything below the `:root` block (the base styles, `.brand-wordmark`,
etc.) is out of scope and never touched.

### 2.2 Control per category (what actually exists — no invented categories)

Per audit §1.2, the categories that exist are: colors (~79), radii (6),
shadows (3), type sizes (12 paired with line-heights), one font family, one
easing, two breakpoints, nine z-index layers. **There is no spacing scale
(audit §1.4), and this plan does not fabricate one** — see §8.2 for what that
means and the sign-off it needs.

| Category | Control | Live preview? | Notes |
|---|---|---|---|
| `--color-*` (opaque hex) | Native `<input type="color">` + hex text field (no picker dependency in phase 1) | Yes | Serialized back as lowercase hex matching file style |
| `--color-*` (`rgb(r g b / a)` translucent forms — 9 exist) | Color input for the RGB part + a 0–1 alpha slider; serializer preserves the `rgb(r g b / a)` spelling so the file diff stays minimal | Yes | |
| `--radius-*` | Number stepper with `px` unit | Yes | |
| `--shadow-*` | Raw text field + a live swatch card rendering the shadow (structured shadow editor is deliberate overkill for 3 tokens) | Yes | |
| `--text-*` size steps | Number stepper for size **with a linked line-height field**; a "keep ratio" toggle (default on) scales `--text-*--line-height` proportionally when the size changes — this resolves the pairing question audit §1.1 flagged | Yes | Saving writes both declarations (two `tokens/apply` calls, or one call per token — client sends two) |
| `--font-sans` | Select of curated stacks (Inter Variable [current], system-ui stack, and 2–3 more that need no new font files) + free-text override | Yes | **Adding a real new font is an agent-lane request** (`kind: 'font-add'`): it requires installing a `@fontsource` package and adding an `@import`, i.e. multi-file judgment work — a deliberately showcased Lane B use case, not a token write |
| `--ease-standard` | Free-text field | Yes | |
| `--breakpoint-*` | Number stepper, **marked "applies on save only"** | **No** — media queries compile the value into `@media (min-width: 1068px)` literals; a runtime custom-property override cannot reach them. Save → Tailwind rebuild → CSS HMR still lands in ~1 s, so the loop is save-then-see instead of drag-and-see. The panel says so on the control | |
| `--z-*` | Number stepper, **marked "declared but not wired"** | No | Audit §1.1: consumers use raw `z-[20]` arbitrary values, not the tokens — editing the token changes nothing until call sites are converted to `z-(--z-chrome)` var-syntax utilities (backlog item C11, §4) |

**Colors that live outside `theme.css`** (audit §1.5: the 11 energy-type colors
in `EnergyIcon.tsx`, `#ff9d42` warning orange, `#1a1d24` track, the sort-glyph
triple): the token panel does **not** pretend to edit these in phase 1. The
"Pending" section (§3.4) lists them as known off-theme values with their
promotion backlog items. After phase 2 promotes them into `theme.css`, they
appear in the panel automatically (the panel is parse-driven, not
hand-maintained).

### 2.3 Live propagation mechanism

Tailwind v4 emits utilities as `var()` references (`.bg-surface-primary {
background-color: var(--color-surface-primary) }`) — this is the premise the
audit already validated (§5) and **the first task of phase 1 is a 10-minute
smoke test confirming it in the served CSS** (risk R1, §8.3). Given that:

1. `useTokenOverrides` holds `{ [tokenName]: value }` in state.
2. An effect diffs the map against the previous render and calls
   `document.documentElement.style.setProperty(name, value)` /
   `removeProperty(name)`. Inline styles on the root element out-specific the
   `:root`-level declarations, so **every** `var()` consumer in the entire app
   re-resolves instantly — the catalog below, and also every real page,
   because the override outlives navigation within the SPA session.
3. A persistent "Design preview active — N overrides · Reset · Back to /design"
   floating pill (rendered by `DesignSystem.tsx` via a portal, mounted only
   while overrides exist) lets the owner walk the *real* app under the
   candidate palette before saving — this falls out of the mechanism for free
   and is worth the ~40 lines.
4. **Save** = `POST /__design/tokens/apply`, then on `200` remove the local
   override for that token. The plugin's write touches `theme.css`; Vite's
   watcher triggers a Tailwind rebuild and CSS HMR replaces the stylesheet
   in-place (no reload); the new on-disk value is now what renders. The
   visible sequence — override cleared, appearance unchanged — is itself
   confirmation the disk write took.
5. **Reset** (per-token and all) just clears overrides; disk was never touched.

### 2.4 The anchored write (Lane A mechanics)

`tokens/apply` must never corrupt `theme.css`:

- Locate the **single** line matching `--<name>: <expectedValue>;` (comparing
  the declaration value with whitespace normalized; trailing `/* … */` comments
  preserved verbatim). Zero matches → `409` (stale). More than one → `500`
  (invariant broken; never write).
- Validate `newValue` by category before writing: colors must parse as
  `#rgb/#rrggbb` or `rgb(r g b / a)`; radii/text/breakpoints as `<number>px`;
  z as integer; font/ease/shadow as a single-line declaration with no `;`, `}`,
  or newline characters. `422` otherwise.
- Replace only the value span, write the file atomically (write temp +
  rename), append a ledger line:
  `{ ts, lane: 'direct', kind: 'token-set', name, from, to }`.
- Undo story: git. The working tree is the review surface; `git checkout -- 
  apps/web/src/theme.css` reverts, `git diff` audits. The ledger is history for
  the agent's benefit, not a second undo system.

---

## 3. Primitive & component catalog design

### 3.1 Discovery — data-driven, not hand-maintained

`CatalogSection.tsx` runs
`import.meta.glob('../../**/*.gallery.{ts,tsx}', { eager: true })` (rooted at
`routes/design/`, so it sweeps all of `src/`). Every gallery module default-
exports a `GalleryMeta`. Adding a component to the catalog = creating one
co-located file next to it; nothing central to edit. Since the glob lives
inside the DEV-only route module, gallery files are also excluded from prod
bundles.

### 3.2 `GalleryMeta` — type-checked against the real prop surface

```ts
// apps/web/src/routes/design/galleryTypes.ts
export type KnobDef<V> =
  | { kind: 'boolean' }
  | { kind: 'text' }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'select'; options: readonly V[] }

export interface GalleryMeta<P> {
  name: string
  /** repo-relative source path — REQUIRED; this is what the agent lane edits */
  source: string
  section: 'primitive' | 'component'
  description?: string
  component: React.ComponentType<P>
  /** the states grid: each entry renders once, labeled */
  variants: ReadonlyArray<{ label: string; props: P }>
  /** knob keys are constrained to REAL prop names — a typo or a removed prop is a tsc error */
  knobs?: { [K in keyof P]?: KnobDef<P[K]> }
  /** starting props for the interactive knob instance */
  defaults: P
}
```

A gallery file (e.g. the future `apps/web/src/components/ui/Button.gallery.tsx`):

```tsx
import { Button, type ButtonProps } from './Button'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export default {
  name: 'Button',
  source: 'apps/web/src/components/ui/Button.tsx',
  section: 'primitive',
  component: Button,
  defaults: { variant: 'primary', size: 'md', children: 'Save changes' },
  variants: [
    { label: 'primary / md', props: { variant: 'primary', size: 'md', children: 'Save' } },
    { label: 'danger / md', props: { variant: 'danger', size: 'md', children: 'Delete' } },
    { label: 'ghost / sm', props: { variant: 'ghost', size: 'sm', children: 'Cancel' } },
    { label: 'primary / disabled', props: { variant: 'primary', size: 'md', disabled: true, children: 'Save' } },
    { label: 'primary / loading', props: { variant: 'primary', size: 'md', loading: true, children: 'Saving…' } },
  ],
  knobs: {
    variant: { kind: 'select', options: ['primary', 'secondary', 'danger', 'ghost', 'dashed'] },
    size: { kind: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { kind: 'boolean' },
    loading: { kind: 'boolean' },
  },
} satisfies GalleryMeta<ButtonProps>
```

`satisfies GalleryMeta<ButtonProps>` is the load-bearing move: **the knob list
and every variant's props are compile-time-checked against the component's
actual prop types.** When a prop is renamed, `tsc --noEmit` (already the
repo's typecheck gate) fails on the gallery file. This is "data-driven off the
real components" without runtime docgen machinery.

Feature components whose props are domain objects (e.g. `CardTile` needs a
card) get fixture props in their gallery file — small hand-built mock objects,
which is the honest cost of rendering them outside a data context. Components
that fetch internally (e.g. `Avatar`'s hooks) are cataloged via their
presentational subcomponents (`AvatarDisc` with explicit props) rather than the
hook-coupled wrappers; where that is impossible the entry renders inside an
error boundary with a "requires live session" note rather than being silently
omitted.

### 3.3 What "editable here" means per entry — two distinct verbs

1. **Knobs (ephemeral).** Each entry renders one *interactive instance* driven
   by local state seeded from `defaults`; the knob strip mutates that state.
   This is exploration — nothing persists, navigating away discards it.
   Combined with token overrides from the panel above, the owner can see e.g.
   "candidate gold + ghost/lg button" simultaneously.
2. **"Send to agent" (persistent — Lane B).** Every entry has a composer:
   a free-text intent box, pre-filled context (component name, `source` path,
   current knob state, any active token overrides), and a submit that `POST`s a
   `ChangeRequest`. The knob state matters: "make *this* (variant=ghost,
   size=sm) the default" is expressible without the owner typing prop names.
   The agent decides *how* the intent maps to source — default-prop change,
   new variant, token promotion, etc. The UI never pretends a component edit is
   a form-field write.

### 3.4 Page structure (top to bottom)

1. **Header** — title, worktree/branch from `/__design/health`, agent-status
   pill (`agentAlive`), link to RequestsPanel.
2. **Tokens** (§2) — grouped by the parsed section headers (surfaces, text &
   links, actions, status/feedback, borders/icons, brand/pro/promo, variant
   accents, radii, elevation, typography, motion, breakpoints, z-index).
3. **Primitives** — every `section: 'primitive'` gallery: `ui.tsx` exports
   (`Content`, `BackPill`, `SetSymbolTile`, `Spinner`, `ErrorState`), the
   `Icon` set (a 42-glyph grid with size/strokeWidth knobs), `EnergyIcon`
   (11 types + unknown-type fallback), the `authUi.tsx` primitives (`Field`,
   `SubmitButton`, `FormAlert`, `StatusPanel`), and each phase-2 extraction as
   it lands (`Button`, `Tabs`, `EmptyState`, …).
4. **Components** — every `section: 'component'` gallery: `CardTile`,
   `CardImage`, `SpriteTile`, `SetLogo`, `SetSymbolTile` states, `LevelRing`,
   `ProgressCluster`, `FilterControls` members, `SignInPrompt`, `Modal` family,
   `SetHeader`, `TableView` row, `BinderView` pocket, deck chips
   (`VersionChip`, `SourceChip`, `ResultBadge`, `RecordSpans`), `ValueChart`
   (fixture series), etc.
5. **Pending extraction** — a hand-authored-once constant
   (`apps/web/src/routes/design/pending.ts`) listing every audit-§4 gap not yet
   closed and every known off-theme color (§2.2), each with its backlog id.
   Entries are deleted as phase 2 lands them; the section renders a
   completeness meter ("14 of 19 patterns componentized"). This keeps the
   surface honest about what it is still missing instead of implying
   completeness.

### 3.5 RequestsPanel

Polls `GET /__design/requests` every 3 s while the page is open. Each row:
kind, target, intent excerpt, status chip (queued / working / done / failed),
and when done: the agent's summary + `filesChanged` list + a "hot-reloaded"
hint. No approve/reject UI in-app — **git is the review surface** (deliberate:
building a second review UI inside the app would duplicate what `git diff`
plus the owner's editor already do better).

---

## 4. Componentization backlog (audit §4 → sequenced worklist)

Ordering principle: extract the primitives that unblock the most call sites and
the most catalog value first; call-site adoption rides with each extraction
(extract-then-adopt in the same item, so duplication actually decreases —
an extracted-but-unadopted primitive is a fourth copy, not a fix). Every item
ships with its `.gallery.tsx` in the same commit — that is what makes the
catalog complete over time without a separate documentation pass.

**New primitive home:** `apps/web/src/components/ui/` (directory), keeping
`ui.tsx` as-is initially and re-exporting new primitives from it so existing
imports keep working.

| # | Item | Extract | Adopt at | Depends on | Audit ref |
|---|---|---|---|---|---|
| C1 | **`Button`** — variants `primary\|secondary\|danger\|ghost\|dashed` × sizes `sm\|md\|lg` × `disabled\|loading` (the spec BEHAVIOR-SPEC §13.3 already wrote); `loading` renders the inline spinner, which is why C2 lands first or together | `components/ui/Button.tsx` | `ListModals` (×3), `BugReport`, `PurchaseSetMenu`, `DecksIndex` (2 modals), `DeckBuilder` (2 modals), `authUi.SubmitButton` (becomes a thin wrapper), `authUi` `CTA_*` strings (replaced by `<Button>`), `Landing`'s `PrimaryCta`/`GhostCta` (unify — closes §4.12) | C2 | §4.1, §4.12 |
| C2 | **`Spinner` API broadening** — add `size?: number` and `inline?: boolean` to the existing `ui.tsx` `Spinner`; the 9 hand-rolled rings become calls | 9 files listed in audit §4.2 | — | — | §4.2 |
| C3 | **`CounterBox` dedupe** — lift the byte-identical component; fix the `#15181f`/`#fff` hex → `var()` drift while touching it | `components/ui/CounterBox.tsx` | `CardTile`, `TableView` | — | §4.3, §1.5 |
| C4 | **`ProgressBar` + `ProgressRing`** — track/fill/milestone-dots API; **promote `--color-track-subtle: #1a1d24` into `theme.css`** in the same commit (7 hardcodings die) | `components/ui/Progress.tsx` | `ProgressCluster`, `ListDetail.ListProgress`, `SeriesIndex.CompletionRing`, `SeriesDetail.SetRow`, `Scan.MatchTile`, `ListsIndex.ProgressBar` | — | §4.4, §1.5 |
| C5 | **`EmptyState`** — icon + title + body + optional CTA, dashed-border variant (the documented-but-unbuilt `EmptyStateMessage`) | `components/ui/EmptyState.tsx` | `DecksIndex`, `ListDetail` | C1 (CTA is a `Button`) | §4.7 |
| C6 | **`Tabs`** — one component, `variant: 'underline' \| 'pill'`; collapses the 4 hand-rolled idioms (Profile underline, CardDetail/DeckBuilder thin underline, Insights pills ×2) | `components/ui/Tabs.tsx` | `Profile`, `Insights`, `CardDetail`, `DeckBuilder` | — | §4.8 |
| C7 | **`SelectableCard`** — the identical-className active/inactive option card | `components/ui/SelectableCard.tsx` | `DecksIndex.NewDeckModal`, `ListModals.ListFormModal` | — | §4.6 |
| C8 | **`StatTile`** — `variant: 'bare' \| 'boxed' \| 'card'` covering the three shapes (two of which are both named `Stat` today) | `components/ui/StatTile.tsx` | `SetHeader`, `Profile`, `Insights` | — | §4.10 |
| C9 | **FilterControls adoption** — no new code; make `ListDetail` import `OwnershipStrip`/`SortChips`, make `SearchResults` import `SortChips`; replace the copy-pasted `#15181f/#d3b745/#484f60` glyph hexes with tokens in the one surviving implementation (`#d3b745` is an accidental color — pick `--color-action-primary` deliberately or promote it, owner's call in review) | — | `ListDetail`, `SearchResults` | — | §4.5, §1.5 |
| C10 | **`useDismiss` hook** (outside-click + Escape) and optionally a thin `Popover` | `components/ui/useDismiss.ts` | `PokedexIndex.OwnFilterMenu`, `SeriesIndex.MobileControls` | — | §4.9 |
| C11 | **Token wiring fixes** — convert `z-[N]` call sites to `z-(--z-*)` var utilities (makes z tokens real, §2.2); promote `--color-warning: #ff9d42` and adopt at the 9 DeckBuilder sites + reconcile the stray `amber-400`/`red-400` uses; promote the 11 energy colors to `--color-energy-*` tokens consumed by `EnergyIcon`; `Profile` banner gradient + remaining §1.5 hex drift → `var()` | `theme.css` + call sites | per item | — | §1.5, §1.1 |
| C12 | **`RecordSpans` import fix** — delete `DecksIndex.DeckCard`'s inline copy, import from `routes/deck/intelShared` | — | `DecksIndex` | — | §4.11 |
| C13 | **authUi relocation** — move `Field`, `FormAlert`, `StatusPanel` to `components/ui/` (they are primitives, audit §2.4); `routes/auth/authUi.tsx` re-exports for compatibility; kills the `AgentAccess` → `routes/auth` boundary crossing | `components/ui/Field.tsx` etc. | `authUi` (re-export), `AgentAccess` | C1 (SubmitButton) | §2.4 |

Sizing guidance for the implementation phase: C1+C2 is the big one (touches ~10
files); C3, C5, C7, C8, C12 are each small; C4, C6, C9, C13 are medium; C11 is
wide-but-mechanical and safe to split per-token. Each item is independently
commit-able and browser-verifiable — do not batch them into one change.

---

## 5. Phasing

Each phase ends demoable and mergeable on its own.

**Phase 0 — Sign-off (no code).** Product owner reviews §8.1 approvals.
Outcome: a `DECISIONS.md` entry recording the approved change-application
model (this is the B9 gate). Nothing else may start first.

**Phase 1 — The surface + Lane A (deterministic tokens) + read catalog.**
- Day-one smoke test: confirm `var()` emission in served CSS (risk R1).
- `design-editor.ts` plugin with `health`, `tokens`, `tokens/apply`, the
  ledger, and the `design-requests/` scaffolding + `.gitignore` entry (the
  queue dirs exist and `requests` endpoints work from day one — the Lane B
  *seam* ships in phase 1 even though its consumer is phase 3).
- `/design` route (DEV-gated), TokenPanel with live overrides + save,
  preview pill, galleries for everything that already exists (§3.4 items 3–4,
  ~20 gallery files), Pending section fully populated.
- Demo: open `/design`, drag the gold `--color-action-primary`, watch every
  primitive below re-theme live, walk to `/decks` under the override, come
  back, hit Save, `git diff` shows exactly one changed line.

**Phase 2 — Componentization (C1–C13).** Sequenced per §4; the catalog and
Pending meter update with each item. Can be split into 2a (C1–C5) and 2b
(C6–C13) if the implementation agent wants two passes. Demo: catalog shows
`Button` in 5 variants × 3 sizes; grep shows zero remaining `animate-spin`
hand-rolls; Pending meter at 100%.

**Phase 3a — Agent lane with a supervised consumer.**
- `RequestsPanel` + per-entry "Send to agent" composers.
- `.claude/skills/design-requests/SKILL.md`: the playbook — claim a request by
  moving it to `working/`, read `source` from the request, apply the intent
  with judgment, write `done/<id>.json` `{ id, status, summary, filesChanged,
  startedAt, finishedAt, agent }`, never commit, leave review to `git diff`.
- Demo: from the catalog, request "Button md height 46px"; in a Claude Code
  session run the skill; watch the catalog hot-reload the taller button and
  the RequestsPanel show the agent's summary.

**Phase 3b (opt-in, separate approval) — SDK daemon** for the synchronous
feel: `scripts/design-agent/agent.mjs`, `pnpm design:agent`, heartbeat →
`agentAlive` pill flips to online, requests drain without a human session.

**Phase 4 — Polish and stretch (each item optional, owner-prioritized):**
`font-add` agent flow end-to-end; a `scripts/design-drift-check.mjs` that
fails when new off-token hexes or `animate-spin` hand-rolls appear (keeps the
system honest after this initiative ends); spacing-scale proposal doc (§8.2)
if the owner wants to pursue it; docs/wiki sync finalization (§7).

---

## 6. Verification plan (per AGENTS.md standards)

Every phase: browser verification at desktop width **and** 390px (the token
panel and catalog must both be usable on mobile width — expect the token grid
to stack). `pnpm --filter @deckpal/db build && pnpm -r
--workspace-concurrency=1 exec tsc --noEmit` stays green.

Specific proofs, phase by phase:

1. **Live propagation proof (phase 1):** with dev server running, set
   `--color-action-primary` to an unmistakable value (e.g. `#ff00ff`) via the
   picker. Confirm — without any reload — the catalog buttons *and* a real
   page (navigate to `/series`) render magenta. Screenshot before/after.
2. **Disk-write proof (phase 1):** hit Save, then in a shell:
   `git -C /home/cheyras/deckpal-worktrees/design-system diff --stat apps/web/src/theme.css`
   → exactly one file, one changed line, correct value. Confirm the Vite log
   shows a CSS HMR update and the page still renders the new value after the
   local override was cleared. Then hard-reload with DevTools open — value
   persists (it is on disk, not in memory). Revert with `git checkout`.
3. **Stale-write proof (phase 1):** open `/design` in two tabs; save different
   values for the same token; the second tab must get a `409` and refetch, and
   `theme.css` must contain exactly one of the two values, uncorrupted.
4. **Prod-exclusion proof (phase 1):** `pnpm --filter deckpal-web build`,
   then `grep -r "__design" apps/web/dist/` and check the emitted SW precache
   manifest for any design-route chunk — both must be empty/absent. Also
   confirm no `/__design` route exists on the built preview
   (`vite preview` → 404) and none on the deployed prod API.
5. **Gallery type-safety proof (phase 1, transient):** rename a knob key in
   one gallery file to a non-existent prop; confirm `tsc --noEmit` fails;
   revert. (Do not commit the breakage — this is a one-time demonstration that
   the mechanism works.)
6. **Componentization proofs (phase 2):** per item, before/after screenshots
   of every adopted call site at both widths (the extraction must be visually
   identical unless the item says otherwise); `grep -rn "animate-spin"
   apps/web/src` count drops to the primitive itself; `#1a1d24` count drops to
   the one token declaration; etc. — the audit's own grep numbers are the
   regression baseline.
7. **Agent-lane proof (phase 3a):** submit a real request from the UI; verify
   `design-requests/queue/<id>.json` contents match the composer; drain via
   the skill; verify `done/<id>.json`, the `git diff` in the named `source`
   file, the HMR-updated catalog, and the RequestsPanel row. Then a failure
   case: submit an intentionally impossible request ("edit a file that doesn't
   exist") and confirm it lands in `failed/` with an error surfaced in the UI
   rather than hanging.
8. **Daemon scope proof (phase 3b):** attempt (via a crafted request) to get
   the daemon to write outside `apps/web/src/**`; the permission callback must
   refuse and the request must fail cleanly.

---

## 7. Documentation-sync budget (AGENTS.md gate 6 — same sitting, not later)

- `DECISIONS.md`: phase-0 entry (change-application model + B9 approval), and
  one entry per phase landing.
- `ARCHITECTURE.md` + wiki **Architecture**: new "Design-system editor (dev
  tooling)" section once phase 1 merges.
- Wiki **Frontend-Research** and **UI-Spec**: the token panel supersedes parts
  of the static token tables; note the editor as the living source.
- Wiki **Decision-Log** + **Contribution Record**: per standing protocol.
- `README.md`: only if the apps table / feature bullets change (they should
  not — this is dev tooling, not a shipped feature; state that explicitly).

---

## 8. Open risks, tradeoffs, and required approvals

### 8.1 Needs explicit product-owner sign-off BEFORE implementation (B9)

1. **The write capability as a category:** a dev-server endpoint that writes to
   `apps/web/src/theme.css`, and an agent (skill-driven or daemon) that edits
   files under `apps/web/src/**`, both scoped to the local worktree, never
   committing. B9 says infrastructure-adjacent mutations need explicit
   approval — this is the ask, stated once, for the category.
2. **Lane A for token value swaps** (deterministic write instead of
   agent-mediated — §1.2). The verbatim ask routes *everything* through an
   agent; this plan deliberately deviates for pure value substitutions and
   needs the owner to accept (or veto — the `tokenLane: 'agent'` fallback is
   one option flip) that deviation.
3. **Phase 3b daemon** (unsupervised agent process editing source): separate,
   later approval; phase 3a's supervised skill needs only approval #1.
4. **New dependency count:** phase 1–3a as specified adds **zero** new web-app
   dependencies (native color input, no Storybook, no CSS parser). Phase 3b
   adds `@anthropic-ai/claude-agent-sdk` as a root devDependency. Any future
   color-picker/font-preview niceties that want a dependency come back for
   approval per normal review.

### 8.2 Spacing tokens — explicitly out of scope (flagged, not silent)

Audit §1.4: 2,441 arbitrary-pixel spacing utilities, zero spacing tokens.
"Editable spacing tokens" would mean designing a scale, then a ~2,400-call-site
migration — an initiative of comparable size to this entire plan. Proposal:
phase 4 produces a short proposal doc (candidate scale, migration strategy,
effort estimate) and the owner decides separately. The token panel simply has
no spacing section until then; the Pending section says why.

### 8.3 Technical risks

- **R1 — `var()` emission assumption.** The entire live-preview mechanism
  assumes Tailwind v4 utilities reference custom properties. High confidence
  (it is v4's documented model and the audit asserts it), but it is phase 1's
  first verification, not an article of faith. If some category inlines values
  (breakpoints are the known case), that category degrades to save-then-HMR —
  the same UX breakpoints already have, not a project-stopper.
- **R2 — HMR feedback loops.** The plugin writes files the dev server watches.
  Expected behavior is one rebuild per save; verify no watch loop (write-
  atomic-rename can look like two events on some platforms). Mitigation if
  seen: debounce/ignore-own-write bookkeeping in the plugin.
- **R3 — gallery fixture drift.** Fixture props for domain components can go
  stale against schema changes. Mitigation: fixtures are typed against the
  component props (tsc catches shape drift), and galleries render inside an
  error boundary so one broken fixture never blanks the whole catalog.
- **R4 — agent edit quality.** Lane B's agent may express a change differently
  than the owner imagined. This is by design (judgment, not field-mapping) —
  the mitigations are the uncommitted working tree, the `filesChanged` summary
  in the UI, and `git diff` review. Cost/latency: one request ≈ one short
  agent run; the skill (3a) rides an existing session, the daemon (3b) should
  default to a mid-tier model with a `maxTurns` cap.
- **R5 — two humans/agents in one worktree.** The queue consumer must run in
  *this* worktree (the skill playbook and daemon both assert
  `/__design/health`'s worktree path matches their cwd before acting). The
  main `/home/cheyras/deckpal` worktree is never touched.
- **R6 — catalog completeness is a treadmill.** New components added after
  this initiative could skip gallery files. Mitigation: the phase-4 drift
  check, plus a one-line contribution note in `CONTRIBUTING.md`/`AGENTS.md`
  ("new shared component ⇒ new `.gallery.tsx`") — proposed there, owner
  approves as part of normal doc review.

---

## 9. Summary for the implementation agent

Start at phase 0 (get §8.1 approvals — do not skip). Then phase 1 in this
order: R1 smoke test → `design-editor.ts` plugin (health/tokens/apply/ledger +
queue scaffolding) → route registration + chromeless entry → `useTokenOverrides`
→ TokenPanel → gallery types + knobs → gallery files for existing
primitives/components → Pending section → the §6 proofs 1–5. Phase 2 executes
§4's table top to bottom, one commit per item, each with its gallery file and
call-site adoption. Phase 3a adds the composers, RequestsPanel, and the skill.
Everything else is opt-in. When in doubt about intent, this file plus
`DESIGN-SYSTEM-AUDIT.md` are the record; genuinely new judgment calls go to the
product owner, not into silent scope changes.
