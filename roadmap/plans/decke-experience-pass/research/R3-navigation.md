# R3 — Deck-E's physical navigation / wayfinding system

Research only. No code changed. All paths are absolute-from-repo-root
(`E:/Users/cheyr/deckpal/...`) unless a full Windows path is given.

Primary sources read in full: `DECKE-AGENT-SPEC.md` (679 lines, status
"IMPLEMENTED, rev 2, 2026-08-22 (PR #74)"); `apps/api/src/decke/tools.ts`,
`screens.ts`, `focus.ts`, `prompt.ts`; `apps/web/src/character/decke/flight.ts`,
`pageAnchor.ts`, `sustain.ts`; `apps/web/src/character/host/useDeckeChat.ts`,
`uiTools.ts`, `runtime.ts`, `approval.ts`, `DeckeChat.tsx`, `DeckeHost.tsx`,
`DeckeBubble.tsx`; `apps/web/src/components/AppShell.tsx`,
`components/ui/HighlightRing.tsx`, `components/ui/elementHighlight.ts`,
`components/ui/DeckeBeacon.tsx`; `apps/web/src/main.tsx` (route table);
`apps/api/src/decke/adapters/aisdk.ts` (chip emission); DECISIONS.md (table of
contents + targeted greps for the incident in question).

**Headline finding, stated up front because it reframes every question below:**
the spec's own PR table (§12) puts the click tool and the "journey loop" at
**PR 10**, *after* write tools (PR 9), and PR #74 — the only commit merged since
the spec was written — implemented rev 2 of the spec, which per its own "what
implementation found" table left **the two `travel_*` states untouched** and
does not claim PR 10 shipped. Live code disagrees with that reading in one
place and confirms it in every other: the `click` tool (§9.2) **does** exist in
`apps/api/src/decke/tools.ts:385` and in the browser's `uiTools.ts`, landmarks
(§9.1) **are** now on 19 route/component files, but `data-decke-clickable` — the
second authorization click requires — is marked on exactly **two** elements in
the whole app, and neither is a cross-page link. The owner's "hop, show, click,
hop, show, click" journey is consequently unbuildable today, and the reason
splits three ways: the prompt tells the model to jump instead of hop (§5), the
click tool is never explained to the model at all (§3, §5), and no navigational
element anywhere is marked pressable (§2, §7 gap list).

---

## 1. The movement/attention primitives — signatures and animation characteristics

Six tools are defined server-side in `apps/api/src/decke/tools.ts:243-434`, of
which five are forwarded to the browser with no server `execute` (`CLIENT_TOOLS`,
`tools.ts:437`) and run in `apps/web/src/character/host/uiTools.ts:196-285`.

### `flyTo` — travel to an element and park beside it
`tools.ts:316-325`:
```ts
flyTo: tool({
  description: 'Travel to an element on the current page and park beside it. ' +
    'Use when showing them where something is. Set `point: true` to point at it on arrival.',
  inputSchema: z.object({
    selector,                                   // CSS selector, 1-120 chars
    point: z.boolean().optional(),
    highlight: z.boolean().optional(),           // ring on arrival; default true
  }),
  // No execute — browser tool.
})
```
Browser side (`uiTools.ts:203-229`): resolves the selector through the landmark
allowlist (`resolveTarget`, below), decides `foreground` vs. `background`
routing by whether the target is more than a third of the viewport width from
screen-centre and Deck-E is not already flying, and calls
`decke.flyTo({selector}, {depth:'foreground', highlight, then: point?'point':undefined, via: far?'background':undefined, scrollWith:true})`.

**Animation.** `apps/web/src/character/decke/flight.ts` is the physical
simulation: a stopping-distance velocity profile (`simulate()`,
`flight.ts:196-247`) integrated at a virtual 30 Hz, then interpolated for
playback (`sampleTrack`, `flight.ts:491-523`) — the solver is "baked on
trigger, played back", explicitly not frame-driven, because the profile is a
fixed-step integrator with no `dt`. Key characteristics:
- Asymmetric accel/decel (`ACC_FRAMES=20` vs `DEC_FRAMES=6.5`, ~4:1) — long
  wind-up, short brake, "what made the old hand-authored profile read
  mechanical" if held constant.
- Anticipation arc before departure (`ANTIC_ARC`, `ANTIC_FRAMES=7`) and an
  aimed overshoot before settling (`OVERSHOOT_FRAC/MAX`) — not an emergent
  ringing settle.
- Distance-adaptive pacing: `travelRate(distance)` (`flight.ts:95-98`) ramps
  from `TRAVEL_RATE_NEAR=1.7`× to `TRAVEL_RATE_FAR=2.95`× the solved duration,
  full ramp reached at 20 world units. A same-depth hop (~0.4–3 units) plays
  near 1.7×; a depth change (background↔foreground, 24–27 units) plays near
  2.95×. This is why `flyTo` routes a *long* cross-page-feeling hop through the
  background plane (`via:'background'`) when it is "far" on screen — going
  through depth is the dramatic, fast leg; same-depth hops are quick and crisp.
- Orientation (lean, yaw, bend/lean/twist "whip", squash, mouth) is derived
  from the *solved* velocity/acceleration curves, not authored per-leg — `lean
  follows ACCELERATION, not speed` (`flight.ts:101`), because a speed-driven
  lean cannot show braking.
- Bow/arc controls (`solveFlight` params) sweep the path off a straight line so
  a move along the camera's view axis (near-zero screen displacement) still
  reads as travel rather than a zoom.

`pageAnchor.ts` is the complementary piece for a **parked, on-screen** Deck-E:
once he is stationary beside an element, the character canvas overlay is
unpinned from the viewport and pinned into page document flow
(`pinToPage`/`unpinToViewport`, `pageAnchor.ts:88-137`) so that ordinary
browser scroll-compositing carries him with the page at no per-frame cost —
this is what makes "he should just stay scrolling directly with the page"
(the comment's words) true, and what gives the rubber-band bounce for free.

`travelAfterRoute` (`uiTools.ts:299-341`) is the piece that makes `flyTo`
usable *after a navigation*: it polls via `MutationObserver` (bounded at
6000 ms) for the destination selector to exist post-route-change, then always
routes the resulting flight `via:'background'` — "there is no continuity to
preserve by going straight" after a full page swap.

### `highlight` — ring an element without moving
`tools.ts:327-330`: `{selector, durationMs?: 500-15000}`. Browser
(`uiTools.ts:231-239`) calls `ctx.decke.highlight(selector, {durationMs})`.
Visual: `HighlightRing`/`elementHighlight.ts` — a `position:fixed` overlay
layer (`z-25`, under the character canvas at `z-30`) drawing a chasing
conic-gradient border cycling the three brand hues (cyan → rose → amber →
cyan) over a 2600 ms cycle (`elementHighlight.ts:56-152`), plus a blurred halo
pulsing underneath. Deliberately unlike any static UI state (focus, selection,
error, hover) so it reads as "something agentic is happening here." Only one
element is ever ringed app-wide (singleton, `elementHighlight.ts:199-240`).
When the page has scrolled Deck-E and his target out of the viewport,
`DeckeBeacon.tsx` draws an off-screen indicator (a "hole, not a picture" — a
ring+pointer chip with nothing drawn inside it, because the WebGL canvas
renders the actual character into that rectangle from above) pointing to where
he is, clickable to scroll him back into view (`DeckeBeacon.tsx:42-147`,
`decke/beacon.ts`).

### `goTo` — take the user to another page, then optionally travel to something on it
`tools.ts:332-347`. This is the **only tool that changes the route**:
```ts
goTo: tool({
  description: '...One call — do not try to chain a navigation and a flyTo
    yourself... Build the path from what the data tools gave you...',
  inputSchema: z.object({
    route: z.string().describe(`An in-app path, built to one of these shapes...`),
    selector: selector.optional().describe('Something to travel to once the page settles.'),
  }),
})
```
Browser (`uiTools.ts:261-277`): checks `routeAllowed`, calls the router's
`navigate(route)`, and if a `selector` was given, calls `travelAfterRoute` to
fly to it once it exists (bounded wait, background-routed flight, see above).
**If no `selector` is given, this is a bare route jump with no flight
animation at all** — the browser simply changes the URL and Deck-E's on-page
position is whatever it already was; nothing repositions him relative to the
new page. There is no engine-level "materialize on the new page" beat.

### `scrollToMe` — bring the reader's viewport to him
`tools.ts:349-353`: no arguments. Browser: `ctx.decke.scrollIntoView()`.

### `click` — press a marked, pressable control
`tools.ts:385-396`. **Exists in code**, contrary to the spec's own §9.2 framing
of it as "the missing verb" (that framing describes the state *before* PR #74;
the tool now ships):
```ts
click: tool({
  description: 'Press something on the page — a link, a tab, a "show more"
    disclosure, a view toggle. Only works on controls that have been marked as
    safe to press... Never changes their collection... One press at a time...',
  inputSchema: z.object({ selector: selector.describe('A marked, pressable control...') }),
})
```
Browser (`uiTools.ts:245-259`, `resolveClickTarget` at `uiTools.ts:121-182`):
requires **both** `[data-decke-landmark]` (pointable) and, on the closest
ancestor, `[data-decke-clickable]` (pressable) — "pointable is not pressable"
is enforced by two separate attributes, not one. Further guards: the pressed
element must actually be a `button`, an `a[href]`, or `role="button"`; an
anchor's `href` is resolved and checked against the *same* `routeAllowed`
allowlist used by `goTo` (closing a real hole found during the security
re-review: an unguarded anchor click could otherwise follow an
attacker-influenceable `href`, e.g. a TCGplayer buy link built from card data);
disabled/`aria-disabled` elements are refused. On success, a **real** DOM
`el.click()` is dispatched (not a synthetic event on `document`, so React's
root listener sees a genuine press), and the result names what was pressed
(`data-decke-label` or trimmed `textContent`) so Deck-E can say what happened
rather than just "ok".

### `express` — body language / expression (server-executed, not movement)
`tools.ts:256-314`. Writes up to 6 validated commands (`op`: `state | cardArt |
facing | idle | clearHighlight`) as a **transient** `data-decke` stream part —
never persisted to message history, never visible as text. States sustain
indefinitely once set (`sustain.ts`) rather than snapping back — a deliberate
design ("he should never snap to being done — he should stay in the state
until told to leave it").

### `showScreen` — compose a result panel (server-executed, not movement)
`screens.ts` / `tools.ts:398-432`. Not a navigation primitive but part of "show
it": a closed component palette (`heading, text, cardGrid, statTile, progress,
status, empty, table, group`), grounded against card ids actually returned by a
tool this turn (`grounding.ts`), max 12 blocks / 60 cards per screen. Relevant
to the owner's ask only insofar as it is the *other* way Deck-E "shows"
something — a panel in the chat, not a flight to a place in the app.

**Nothing among these primitives is a "step" abstraction.** There is no
`nextStep()`/`sequence()` tool; a multi-leg journey is entirely an emergent
property of the model choosing to call more than one of these tools across the
turn-loop described in §5/§7 below.

---

## 2. Resolving a named destination to a DOM element or a route — the registry, and its completeness

**Two independent, deliberately un-unified mechanisms:**

### 2a. Route resolution — no registry; the model builds a URL string from a template
`apps/api/src/decke/prompt.ts:192-225` (`ROUTE_SHAPES`) is the *only* "sitemap"
Deck-E is given, rendered into the system prompt as URL templates with prose
descriptions (`/series/<seriesSlug>/<setId> — ONE SET...`). There is **no
lookup table from a human name ("Pitch Black") to a route** — the model must
have already called a *data* tool (`search_cards`, `get_card`, `set_progress`)
this turn, read the `seriesSlug` and `setId`/`speciesId`/etc. out of that tool's
result, and string-template the URL itself. `tools.ts:40-66`
(`ROUTE_ALLOWLIST`/`isAllowedRoute`) is the security boundary this is checked
against — a prefix allowlist of `/series, /lists, /decks, /pokedex, /insights,
/scan, /search` (mirrored client-side in `uiTools.ts:41-57`), deliberately
excluding `/profile` (mints API tokens). **This is a security allowlist, not a
sitemap** — it says what's *legal*, not what exists or how to reach it, and the
spec records (`prompt.ts:161-175`) a real production failure from exactly this
gap: the model, told only `Allowed: /series, ...`, read that as an
enumeration and never built the deeper `/series/<slug>/<setId>` path until the
`ROUTE_SHAPES` templates were added to explain the prefix-matching rule.

### 2b. Element resolution — an explicit, capability-based landmark registry
`data-decke-landmark` is the allowlist attribute (`uiTools.ts:73-89`,
`resolveTarget`): a CSS selector is refused unless `document.querySelector`
finds an element whose closest ancestor carries this attribute. It is
deliberately **not name-based** — "a selector is a capability... text he reads
(card names...) is attacker-influenceable" — so the model is handed a curated
`{selector, label}` list per turn (`collectLandmarks()`,
`useDeckeChat.ts:800-826`), not a free-text search space. Landmarks are
collected fresh every leg (a `goTo` changes what's on screen), ranked
on-screen-first, then containers-before-items (`data-decke-rank="container"`),
then DOM order, and capped at **40** (`LANDMARK_CAP`, `useDeckeChat.ts:768`,
mirrored server-side per the comment — not independently verified against
`api/chat.mjs` in this pass). Surplus landmarks are silently dropped, in that
priority order, with no truncation marker to the model.

**Completeness, measured directly against the tree** (contradicts the spec's
own §9.1 "zero landmarks" claim, which describes the pre-#74 state):
`data-decke-landmark` now appears in 19 files: `AppShell.tsx` (sidebar nav
rows), `SeriesIndex.tsx`, `SeriesDetail.tsx`, `SetDetail.tsx`,
`CardDetail.tsx`, `SpeciesDetail.tsx`, `DecksIndex.tsx`, `DeckBuilder.tsx`,
`ListsIndex.tsx`, `ListDetail.tsx`, `Insights.tsx`, `PokedexIndex.tsx`,
`Scan.tsx`, `SearchResults.tsx`, `SetHeader.tsx`, `FilterControls.tsx` — 37
distinct landmark declarations total. The §9.1 table's route list is
essentially fulfilled. **`data-decke-clickable`, however, appears on exactly
two elements in the whole codebase**: `SeriesIndex.tsx:397-400` (the "Show N
series with no cards collected" disclosure button) and
`CardDetail.tsx:596-600` (the "Additional Variants" disclosure). Both are
same-page, non-navigating UI disclosures with a pure local `useState` toggle.
**No sidebar nav row, no series card, no set row, and no card grid tile is
clickable** — they are all landmarks (pointable/flyable/ringable) but none are
pressable. This is verified directly: `AppShell.tsx:163-183` marks every nav
`<Link>` with `data-decke-landmark` but never with `data-decke-clickable`;
`SeriesDetail.tsx:20-30` marks each set row the same landmark-only way.

---

## 3. Does the model have a step-by-step navigate tool, or only a route jump? (verbatim schemas)

**Only a route jump for pages, plus same-page point/ring/press.** There is no
tool named anything like `navigateSteps`, `journey`, or `followLink`. The
closest thing to "step-by-step" is that `goTo`, `flyTo`, `highlight`, and
`click` are ordinary tools the model may call repeatedly across the
multi-leg follow-up loop (§5), but nothing packages that into a single
declared capability, and nothing in the tool *descriptions* asks for it — see
§5 below for the opposite: the `goTo` description and the system prompt
actively steer the model toward a single full-URL jump.

Verbatim tool descriptions (already quoted in full in §1); the two most
relevant sentences, restated for directness:

> `goTo`: *"Take the user to another page, then travel to something on it once
> it has loaded. **One call** — do not try to chain a navigation and a flyTo
> yourself."* (`tools.ts:334-338`)

> `click`: *"Press something on the page — a link, a tab, a 'show more'
> disclosure, a view toggle... **One press at a time**, then look at what
> happened."* (`tools.ts:387-392`)

Both descriptions are written for a *single* call each turn-leg, which is
correct for what each tool does in isolation, but nothing anywhere describes
the *composition* of several such calls into a "hop, show, press, hop, show,
press" performance. That composition, if it is to exist, has to come from the
system prompt (it currently does not — see §5) or from a new orchestration
layer (§7).

---

## 4. Page/nav context the model receives per turn (verbatim)

Per leg (`streamLeg`'s POST body, `useDeckeChat.ts:556-561`):
```ts
body: JSON.stringify({
  messages: wire,
  route: window.location.pathname,
  landmarks: collectLandmarks(),   // [{selector, label}], capped at 40, see §2b
})
```
Consumed by `buildSystemPrompt` (`prompt.ts:348-617`), which renders into the
system prompt:
- **Current route**: `The user is on \`${opts.route}\`.` plus a signed-out
  caveat (`prompt.ts:596`).
- **Route shapes** (the closest thing to a sitemap — quoted in full at
  `prompt.ts:192-213`; rendered as `## Where things live` in the prompt,
  `prompt.ts:520-541`):
```
- /series — every series
- /series/<seriesSlug> — one series and the sets in it
- /series/<seriesSlug>/<setId> — ONE SET, on its own page — e.g.
  /series/mega-evolution/me05 is Pitch Black. There is no /series/<setId>...
- /series/<seriesSlug>/<setId>/<number> — one card
- /lists — saved lists
- /lists/<id> — one list
- /decks — decks
- /decks/<id> — one deck
- /pokedex — the dex
- /pokedex/<speciesId> — one species
- /insights — collection figures
- /scan — the card scanner
- /search?q=<text> — global search
```
- **Landmarks on the current page** (`## Right now` → `Landmarks you can fly
  to on this page:`, `prompt.ts:598-599`), rendered as a flat `- selector —
  label` list, or the literal string `(nothing on this page is registered as
  a landmark)` if empty. **This list carries no `data-decke-clickable`
  information at all** — the prompt gives the model selectors it may point at,
  with no signal about which of those (if any) may also be pressed. Combined
  with §5's finding that `click` is entirely undocumented in the prompt, the
  model has no way to learn from its per-turn context that clicking is even a
  strategy, let alone which landmark supports it.
- **The `## Moving around` section** (`prompt.ts:510-544`) documents *only*
  `flyTo`, `highlight`, `goTo` by name — `click` is never mentioned here or
  anywhere else in the prompt (confirmed by grep: the only occurrence of the
  string "click" in `prompt.ts` is unrelated prose, `prompt.ts:518`, "Nobody
  wants to watch you click through something you could have executed").
- **Data tools held this turn** (`## What you know, and what you look up`),
  and **today's date**.

**What is absent:** no full site map/nav graph is ever sent (only the 13
route-shape lines above, which describe URL *syntax*, not the sidebar's
grouping or which pages are reachable from which — e.g. nothing tells the
model "the series index is reached from the sidebar's 'Pokémon TCG (English)'
row" or "a set page is reached from its series page's set-row list"); no
enumeration of which landmarks are also clickable; no indication of "you are
here" within a conceptual site hierarchy beyond the raw pathname.

---

## 5. Why did it jump instead of hop? — root-caused in code

Three independent, compounding causes, none of them a bug in the sense of
broken code — each is working exactly as written, and each pushes the same
direction:

**(a) The prompt explicitly instructs a single full-URL jump for "take me to
it" / "help me find" style requests, and explicitly discourages the
alternative.** `prompt.ts:528-532`:
> *"**'Take me to it' means `goTo`, and it means the page for the thing
> itself.** A set is a page... When they ask to be taken to one, build its url
> and go — **do not stay where you are and `flyTo` something that looks
> related**, and do not stop at the index one level up."*

This is not incidental wording — the spec's own gate 5 (§13.2) is *literally*
"'Take me to it' → Lands on `/series/mega-evolution/me05` — the canonical URL,
slug included," and DECISIONS.md / `prompt.ts:161-175` records that an earlier
failure mode (stopping on `/series` instead of drilling to the set) was fixed
by making this instruction *stronger*, not weaker. The system was deliberately
tuned to jump straight to the terminal URL, because the previous defect being
fixed was the model stopping too early — nobody has since asked it to prefer a
multi-leg escorted journey over the jump, and the fix for the earlier bug
directly opposes the owner's new ask.

**(b) `click` is a real, working tool that the model is never told about.**
Confirmed by exhaustive grep of `prompt.ts`: the tool is absent from `##
Moving around` and from every other section. A model cannot choose to use a
capability its prompt never names, regardless of what `tools.ts` exposes to
the SDK's function-calling surface — and even if it inferred `click` from the
tool list alone (it is visible to `focusedTools` on step 2+, `focus.ts:115-117`),
the prompt gives it no doctrine for *when* pressing beats jumping, no
description of the click→re-check pattern the spec's §9.3 "journey" narrates
(minimise → navigate → wait → fly → highlight → click → re-check), and no
signal about which landmarks are pressable (§4).

**(c) Even a model that tried to click its way there would fail, because
almost nothing is marked pressable.** As established in §2b: the sidebar's
"Pokémon TCG (English)" row, every series card, and every set row carry
`data-decke-landmark` but not `data-decke-clickable`. `resolveClickTarget`
(`uiTools.ts:121-182`) would refuse all of them with `"that is not something I
am allowed to press"`. So the owner's described choreography — click
"Pokémon TCG", hop down, show a set row, click it, hop to a card, show it — is
not just unprompted, it is **architecturally impossible today**: the only
clickable elements in the app are two same-page accordions that go nowhere.

Given (a)+(b)+(c), the observed behaviour (teleport straight to
`/series/mega-evolution/me05`) is not a malfunction — it is the *only*
navigation strategy the system currently makes available and the *only* one
the prompt endorses for this phrasing. The "grew large" part of the owner's
report is most plausibly the character's own foreground `flyTo`/parking
framing after the page swap (a `goTo` with a resolved `selector` drives a
`travelAfterRoute` flight at `depth:'foreground'`, which sizes/frames him
close and large by design for presenting something) rather than a separate
defect — but this pass found no code path that explains an *abrupt*,
non-animated size jump distinct from ordinary foreground parking, so it is
reported here as unconfirmed rather than root-caused.

The "very long text answer" is a separate, prompt-level issue: nothing in
`prompt.ts` bounds reply length for a *non-moving* turn. The one length rule
that exists (`prompt.ts:543-544`, "When you move, keep what you say SHORT —
one or two lines... your words appear in a small speech bubble") is
conditioned on `travelling`/minimised chat, i.e. it only applies to bubble
speech beside a parked character, not to ordinary chat-panel prose — so a
turn that (per (a)) jumps directly and never enters the "he is out on the
page, minimise the transcript" flow (`onTravel`/`travelAnnounced`,
`useDeckeChat.ts:391-394`) gets no brevity discipline applied to its answer at
all, and the model is free to write at length in the full chat panel.

---

## 6. What the transcript records for a navigation — structured action rows, or only prose?

**Only prose, plus one unrelated mechanism (data-tool chips) that does not
cover navigation at all.** `ChatMessage` (`DeckeChat.tsx:135-158`) has exactly
three payload fields: `text` (prose), `screen?` (a `showScreen` panel), and
`tools?: ToolChip[]`. Chips render as pills reading `"${title}…"` while
running and `"${title}"` once done (`DeckeChat.tsx:519-540`), e.g. "Checking
your collection…" → "Read 604 cards."

**Chips are emitted from exactly one place**: the server's
`onEvent`/execute-wrapper for the *23 `@deckpal/agent-tools` data/write tools*
in `apps/api/src/decke/adapters/aisdk.ts:56-69` (`ToolEvent` type, `phase:
'start'|'ok'|'error'`), forwarded to the browser as a `data-decke-tool`
transient part and only handled by `onToolChip` in `useDeckeChat.ts:263-279,
621-628`. **`flyTo`, `highlight`, `goTo`, `scrollToMe`, and `click` have no
server `execute` at all** (they are pure `CLIENT_TOOLS`, `tools.ts:437`) —
they never pass through `aisdk.ts`'s wrapper, so **no chip is ever emitted for
any movement action.** `express` and `showScreen` *do* have server `execute`
(`tools.ts:263-313, 402-431`) but write their payload straight to a
`transient` stream part without going through `onEvent`/chip machinery either
— so body-language and screen composition are also chip-less.

The consequence, stated plainly: today, if Deck-E flies somewhere, rings
something, clicks something, and flies again, **the transcript shows nothing
of that sequence structurally.** The only trace is whatever he chose to say in
prose (in the minimised bubble, per `onTravel`, or in the main chat panel if
he never minimised), and — per §5(a) — the common case is that he never even
enters the minimised/bubble mode, because a direct `goTo` jump *does*
minimise on `pending.some(c => c.name !== 'scrollToMe')` (`useDeckeChat.ts:391`)
so a single `goTo` call *would* trigger it, but with only one leg there is
only one bubble line, not the sequence of "traveled to X" / "clicked Y" rows
the owner is asking for.

---

## 7. What a turn-by-turn route plan needs — what exists, what is missing

| Component | What exists today | What is missing |
|---|---|---|
| **Sitemap source of truth** | `ROUTE_SHAPES` (`prompt.ts:192-213`) — 13 URL-template lines with one-line descriptions, hand-authored, prompt-only. `ROUTE_ALLOWLIST` (`tools.ts:40-48`) — a 7-entry prefix security allowlist, mirrored client-side. `NAV` array in `AppShell.tsx:90-97` — the actual sidebar structure (6 rows, one expandable into a live series sub-list) — **not exposed to the model at all**, and not the same data as `ROUTE_SHAPES`. | A single structured sitemap (ideally the source both `ROUTE_SHAPES` and `NAV` render from) that also encodes the **nav hierarchy** — "the series index is reached via the sidebar's Pokémon TCG row; a set page is reached via a row in its series page's set list; a card page is reached via a row in its set page's variant table" — which is exactly the graph the owner is describing when he says Deck-E "needs to know the site map." Nothing like this exists; `ROUTE_SHAPES` describes URL *syntax*, not the click-path between pages. |
| **Resolver: label → route/element** | Two *disjoint* half-resolvers: (a) route templates the model fills in from data-tool results (§2a) — works, but only reachable if the model already looked the entity up; (b) the landmark registry (§2b) — works for *elements on the current page only*, capped at 40, re-collected per leg. | No resolver that goes the other direction the owner describes: "Pokémon TCG" (a nav label) → the sidebar `<Link>` element **and** its target route, as one fact the model can act on with a single verb ("click this to get there"). Today the model must separately know the route shape *and* separately be handed the sidebar's landmark selector; nothing connects "this label" to "this is how you get to the next hop." |
| **Sequencer: interleave travel/outline/click/speak** | The multi-leg follow-up loop in `useDeckeChat.ts` (`legBudget`, `MAX_LEGS=4`, `MAX_APPROVAL_REPLAYS=2`, `approval.ts:205-248`) *can* carry several tool calls across several turns/legs — this is real infrastructure, not a stub, and it already handles minimising the transcript on the first travel leg (`onTravel`, `useDeckeChat.ts:391-394`) and re-collecting fresh landmarks per leg (essential once a `goTo` changes the page). | No prompt doctrine and no orchestration layer that *chooses* to spend legs this way (hop→show→click→hop→show→click→speak) versus one `goTo` jump — the choice is entirely up to what the model infers from a prompt that (§5a) tells it to do the opposite. There is also no per-leg "narrate one short line, then act" discipline outside the bubble-speech-length rule, which (§5) only applies once `travelling` is already true. |
| **Transcript renderer for action rows** | `ToolChip` rendering exists and is well-built (server-truth-backed, 1:1 with real invocations, phase-aware) — but scoped *only* to the 23 `@deckpal/agent-tools` data/write calls (§6). The visual language (`decke-shift` pills, `title`/`summary`) is directly reusable. | A parallel or extended chip type for movement/click events — "Traveled to the Pokémon TCG link," "Clicked it," "Traveled to Pitch Black," "Clicked it" — sourced from the *client* tool results (`uiTools.ts` return values already carry a sayable `reason`, e.g. `"pressed ${label}"` at `uiTools.ts:257-258`) rather than the server wrapper, since these tools have no server `execute` to hang an `onEvent` off. Needs its own transient part type and its own `onXChip` handler in `useDeckeChat.ts`, or a widened `ToolChip`/`data-decke-tool` contract the client-tool runner also emits into. |

---

## 8. Cross-route continuity — does Deck-E survive a route change mid-sequence?

**Yes, robustly, and this part is solid.** `DeckeHost` is mounted once, as a
sibling of the router's public/private conditional inside `RootComponent`
(`main.tsx`), specifically *not* inside `AppShell` — documented at length in
`DeckeHost.tsx:1-28` and in DECISIONS.md's "2026-08-21 — Deck-E's body is
mounted once, above the route tree" entry. The reasoning: `/series → /decks`
changes the element type from `AppShell` to `AuthGuard` at that tree position
(depending on public/private), which would unmount and rebuild a
character-in-`AppShell` on every such navigation, tearing down its WebGL
context and reloading 5.7 MB of assets. Mounting as a sibling of that
conditional means only a *full document load* destroys him — and even that is
handled: `pagehide` explicitly force-loses the GL context before unload
(`runtime.ts:159-196`) and StrictMode double-mount races are coalesced via a
deferred-dispose singleton (`runtime.ts:81-152`).

Practical consequence for a journey: `useDeckeChat`'s hook state (the
`messages` array, `busy`, the in-flight `abortRef`/turn loop, `asking`
approval state) lives in `DeckeHost`, so a `goTo` call inside a leg — which
calls TanStack Router's `navigate()`, a client-side route swap, not a full
reload — does **not** interrupt the turn loop, does **not** reset the
transcript, and does **not** require the character to reload. `flyTo` calls
issued in the *next* leg (after a `goTo`) correctly re-resolve landmarks
against the *new* page (`collectLandmarks()` re-run per leg,
`useDeckeChat.ts:521-524`) and `travelAfterRoute`'s `MutationObserver`
(`uiTools.ts:299-341`) exists specifically to wait out the new page's async
data load before flying. So the *engine and conversation* survive a
route change mid-sequence by construction; what does **not** survive
implicitly is *the model's decision to keep going* — each leg is a fresh
model turn re-billing the whole prompt+history (`flight.ts`/`approval.ts`
header commentary; MAX_LEGS caps this at 4 ordinary legs + up to 2 approval
replays per turn), so a long, many-hop journey is bounded by that budget, not
by the character's own persistence.

---

## Complete route/sitemap inventory (as of this pass)

Route table source: `apps/web/src/main.tsx` (`createRoute` calls). Cross-referenced
against `ROUTE_SHAPES` (`prompt.ts:192-213`) and `ROUTE_ALLOWLIST`
(`tools.ts:40-48`).

| Path | Component (routes/) | In `ROUTE_ALLOWLIST`? | In `ROUTE_SHAPES` (model-visible)? | Landmarks present? |
|---|---|---|---|---|
| `/` | `Landing.tsx` | no | no | n/a (chromeless — Deck-E doesn't mount, `DeckeHost.tsx:88-103`) |
| `/series` | `SeriesIndex.tsx` | yes | yes | yes (series grid + each series card; "Show N others" is the only clickable element on this page) |
| `/series/$series` | `SeriesDetail.tsx` | yes (prefix) | yes | yes (set-list container + each set row) |
| `/series/$series/$set` | `SetDetail.tsx` | yes (prefix) | yes | yes (via `SetHeader.tsx`, `FilterControls.tsx`, plus the page itself) |
| `/series/$series/$set/$number` | `CardDetail.tsx` | yes (prefix) | yes | yes (card image, variant rows, variant table container, price block; "Additional Variants" disclosure is clickable) |
| `/lists` | `ListsIndex.tsx` | yes | yes | yes |
| `/lists/$id` | `ListDetail.tsx` | yes (prefix) | yes | yes |
| `/decks` | `DecksIndex.tsx` | yes | yes | yes |
| `/decks/$id` | `DeckBuilder.tsx` | yes (prefix) | yes | yes |
| `/pokedex` | `PokedexIndex.tsx` | yes | yes | yes |
| `/pokedex/$speciesId` | `SpeciesDetail.tsx` | yes (prefix) | yes | yes |
| `/insights` | `Insights.tsx` | yes | yes | yes |
| `/scan` | `Scan.tsx` | yes | yes | yes |
| `/search` | `SearchResults.tsx` | yes | yes (`/search?q=<text>`) | yes |
| `/profile` | `Profile.tsx` | **no** (deliberate — mints API tokens) | no | n/a |
| `/u/me` | alias for `/profile` | no | no | n/a |
| `/auth`, `/auth/reset` | `Auth.tsx` | no | no | n/a (chromeless) |
| `/authorize` | `Authorize.tsx` | no | no | n/a (chromeless) |
| `/signed-out` | (inline route) | no | no | n/a (chromeless) |
| `/design` | (design-system tool) | no | no | n/a (chromeless) |
| `/dev/decke` | (character dev harness) | no | no | n/a (Deck-E explicitly excluded to avoid a double WebGL context, `DeckeHost.tsx:89-93`) |

**Sidebar nav (`AppShell.tsx:90-97`, the `NAV` array — the thing the owner
literally means by "Pokémon TCG"):**
```
Pokémon TCG (English)  → /series          (expandable: reveals live series sub-list)
My Lists               → /lists           (gated)
Deck Builder           → /decks           (gated)
Pokédex                → /pokedex
Insights               → /insights        (gated)
Scan Card              → /scan            (gated)
```
Every row carries `data-decke-landmark={"[data-decke-nav=\"" + to + "\"]"}`
(`AppShell.tsx:174-182`). **None carry `data-decke-clickable`.**

---

## Gap list — exactly what is missing to deliver the owner's described behaviour

Ordered as the owner narrated it: *hop out of chat → travel to the "Pokémon
TCG" link → show it (outline) → click it → hop down → show a set row → click
it → hop to a card → show it → click it → say "here it is" → and log each
step as a transcript row interleaved with his own short lines.*

1. **Prompt doctrine that prefers a multi-hop escorted journey over a direct
   `goTo` jump, for requests phrased like "help me find X".** Today
   `prompt.ts:528-532` explicitly instructs the opposite ("build its url and
   go — do not stay where you are and flyTo something that looks related").
   This is the single highest-leverage fix and is pure prompt work — no new
   tool needed to at least get `flyTo`+`highlight` hopping to the *sidebar*
   entry before the `goTo`, if landmarks were also documented as
   sequenceable.

2. **`click` documented in the system prompt**, with guidance on when
   pressing a marked link is preferable to jumping (e.g., "when the user asks
   you to *find* or *show* something rather than to be *taken* there
   instantly, prefer clicking your way there one hop at a time so they can
   follow along"). Currently absent entirely (§4, §5b).

3. **`data-decke-clickable` on navigational elements**, starting with the
   sidebar `NAV` rows (`AppShell.tsx:163-183`), series cards
   (`SeriesIndex.tsx`), and set rows (`SeriesDetail.tsx:20-30`) — each
   requires the same security review the spec's §9.2 already demands for any
   new clickable element (anchors need the `routeAllowed`-style href check
   `uiTools.ts:160-177` already performs; the sidebar's `<Link>`s render to
   internal client-side routes so this should be low-risk, but must go
   through the same review discipline as the existing two clickable elements
   to avoid the exact self-violation the spec's own rev 1 table committed).
   Without this, `click` cannot do anything the owner is asking for — it can
   only expand the two existing same-page accordions.

4. **A "compact/plan the hops" step or explicit multi-leg doctrine**, i.e.
   something that gives the model (or a thin orchestration layer in front of
   it) the equivalent of the sitemap graph described in §7's "Sitemap source
   of truth" row — not just URL syntax, but "row X's landmark selector is how
   you get from here to there." This can be prompt-only (teach the model to
   read the landmark list as also being the way to progress) or a small
   planning tool, but currently nothing bridges "I know the destination route"
   and "I know which on-screen link to press to get one hop closer to it."

5. **Structured transcript "action rows" for movement**, distinct from the
   existing 23-tool data chip mechanism (§6). Needs: (a) a transient part type
   emitted by the *client* tool runner (`runUiTool` in `uiTools.ts`) rather
   than the server `execute` wrapper, since `flyTo`/`highlight`/`goTo`/`click`
   have no server-side execution to hang a chip on; (b) a corresponding
   `onXChip`-style handler wired into `useDeckeChat.ts`'s per-leg handler set
   (`LegHandlers`, `useDeckeChat.ts:486-492`) so each client tool's real
   result (`{ok, reason}` — already sayable, e.g. `"pressed the Mega
   Evolution set row"`) becomes a rendered row; (c) a renderer in
   `DeckeChat.tsx` alongside the existing `tools?.length` chip block
   (`DeckeChat.tsx:519-540`) that interleaves these with his short spoken
   lines in the order they occurred, which the message-per-turn model
   currently cannot express (chips are grouped per assistant message, not
   ordered against interleaved prose within one leg).

6. **A short-reply discipline that applies regardless of whether the turn
   ends up "travelling."** The existing brevity rule (`prompt.ts:543-544`) is
   conditioned on movement happening at all; per §5, a turn that (today)
   jumps straight there via a single `goTo` sometimes never triggers the
   minimised/bubble mode in a way that reads as a "journey," and separately,
   any turn that does *not* call a movement tool gets no length discipline at
   all. Tightening item 1 (preferring hops) will naturally route more traffic
   through the already-short bubble-speech path, which is likely the
   cheapest fix for "he gave such a long response" — but it should be
   verified once items 1–3 land, since the long-answer complaint may
   partially be independent of the jump-vs-hop choice.

7. **(Lower priority, unconfirmed defect) Investigate the "grew large"
   report** against real `flyTo`/`goTo` foreground-parking framing once items
   1–3 change the navigation path — it may resolve itself if the destination
   is reached by a sequence of same-depth/background-routed hops rather than
   one long-distance foreground `travelAfterRoute` flight straight from the
   chat-open framing to a brand-new page's landmark.

None of items 1–6 require touching the flight/physics engine (`flight.ts`,
`pageAnchor.ts`, `sustain.ts`), the highlight ring (`elementHighlight.ts`), or
the approval/write machinery (`approval.ts`) — those are complete and correct
for what the owner is asking. The gap is entirely in (a) prompt doctrine, (b)
one missing markup attribute on navigational elements, and (c) a transcript
rendering path for client-tool results that mirrors one that already exists
for server-tool results.
