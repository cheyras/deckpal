# R1 — Deck-E host layer: mount, lifecycle, load cost, chat shell, positioning

All paths are relative to `E:\Users\cheyr\deckpal` unless given absolute.
Line numbers are as read on 2026-08-22 at commit `209150f`.

---

## 1. Mount & lifecycle map

### 1.1 Call graph, boot → visible

```
main.tsx:471  createRoot(...).render(<RouterProvider>)
main.tsx:69   RootComponent()
main.tsx:100-106   return <>{DevBackendRibbon}{shell}<DeckeHost/></>   // ALWAYS rendered,
                                                                        // sibling of the
                                                                        // public/private
                                                                        // shell swap
  -> host/DeckeHost.tsx:88  DeckeHost()
     ├─ useRouterState -> chromeless = isChromelessPathname(pathname)      [line 101-103]
     ├─ useState entitled=false; useEffect -> deckeEntitled().then(setEntitled)  [154-161]
     │     -> host/entitlement.ts:36 deckeEntitled()
     │         DEV -> true always [45]; self-host -> true always [48];
     │         cloud -> api.me(); entitled = me.decke ?? me.owner===true [65]
     ├─ useEffect "warm the engine once the page has settled"              [166-177]
     │     condition: entitled && !chromeless && phase==='idle'
     │     requestIdleCallback(start, {timeout:4000}) OR setTimeout(start,1500)
     │     start() => setPhase('loading')                                  <<< AUTOMATIC,
     │                                                                          no click
     ├─ active = entitled && !chromeless && (phase==='loading'||'ready')   [273]
     └─ useEffect [active]                                                 [275-406]
           if !active return
           loadDeckeRuntime()  ->  host/runtime.ts:41
              import('../decke/DeckE')                    // "Decke-runtime" chunk
              import('three/examples/jsm/loaders/HDRLoader.js')
           acquireDeckE(canvas, () => new runtime.DeckE({...startAt:'home'...})) [296-306]
           decke.load()  -> decke/DeckE.ts:600-730
              Promise.all([
                GLTFLoader().loadAsync(decke.glb)            [602]  2.92 MB
                loadPlaybook(baseUrl)  -> fetch playbook.json [603, playbook.ts:200] 187 KB
                loadCards(baseUrl)     -> fetch cards.json    [604, cards.ts:90]      44 KB
                TextureLoader().loadAsync(symbol_sdf_atlas.png)[607]                 1.07 MB
              ])
              ... build rig/cards/eyes, applyPose, this.anchor = homeCorner(...) [690]
              this.setState('boot', ...)                                    [728]
           runtime.loadEnvironment(baseUrl)
              -> HDRLoader().loadAsync(studio_small_09_1k.hdr) [runtime.ts:51]  1.61 MB
           decke.setEnvironment(hdr)
           measure(); decke.start(); setPhase('ready'); setLive(decke)
     canvas className has `opacity-0` -> `opacity-100` once phase==='ready',
        transition-opacity duration-500                                     [423-426]
```

**Everything from "warm the engine" onward runs with no user interaction**, as long as
`entitled && !chromeless`. `DeckeButton`'s own `onWarm` (pointer-enter/touch/focus,
`host/DeckeButton.tsx:57-61,69-71`) is a *second*, redundant trigger for the same
`setPhase('loading')` — by the time a real user could hover the button, the
`requestIdleCallback`/1.5 s timer in `DeckeHost.tsx:166-177` has, in the overwhelming
majority of sessions, already fired.

### 1.2 Asset/chunk table (real measured bytes, from `apps/web/dist` build present in the
repo at commit time, and `apps/web/public/models/decke/`)

| Asset | Raw bytes | Gzip | Eager or lazy | Loaded by |
|---|---:|---:|---|---|
| `assets/Decke-runtime-CFre3AQz.js` (three.js r0.185.1 + all of `character/decke/**`, one pinned chunk — `vite.config.ts:220-231`) | 1,199,040 (1.14 MB) | 358,482 (350 KB) | **Lazy** — only via `import()` in `runtime.ts:44-47`, but that import fires automatically ~1.5–4 s after page settle (§1.1) | `loadDeckeRuntime()` |
| `assets/Decke-ZTg4OOpy.js` (the `/dev/decke` route's own thin wrapper around the shared runtime chunk) | 24,596 | 8,518 | Lazy, owner-route only | `main.tsx:395` `lazyRoute(() => import('./routes/dev/Decke'))` |
| `models/decke/decke.glb` | 2,918,432 (2.85 MB) | — (binary, not gzip-served as text) | Lazy but automatic (see §1.1) | `DeckE.ts:602` |
| `models/decke/studio_small_09_1k.hdr` | 1,608,057 (1.57 MB) | — | Lazy but automatic | `runtime.ts:51` |
| `models/decke/symbol_sdf_atlas.png` | 1,069,793 (1.05 MB) | — | Lazy but automatic | `DeckE.ts:607` |
| `models/decke/playbook.json` | 186,833 (183 KB) | — | Lazy but automatic | `playbook.ts:200` |
| `models/decke/cards.json` | 44,311 (43 KB) | — | Lazy but automatic | `cards.ts:90` |
| `models/decke/card_back.webp` | 77,824 (76 KB) | — | Lazy but automatic | `DeckE.ts:653` |
| `models/decke/markers.json` | 3,696 | — | Only `/dev/decke` parity mode, not the host | n/a |
| **Total `public/models/decke/`** | **5,791,946 (5.7 MB)`du -sh`** | — | — | — |

Total network weight paid on a normal visit that never touches the button, once
entitled and on a non-chromeless page: **≈ 6.9 MB raw** (1.14 MB JS + 5.7 MB models),
**≈ 6.5 MB of it precache-relevant** — this is the exact number `vite.config.ts:160-168`
excludes from the service-worker manifest by name (`models/**`, `assets/Decke-*.js`), on
the stated premise that "the route is lazy, so … the cost is paid only by whoever
actually opens it" (`vite.config.ts:163-166`). **That premise is false for the persistent
host**: `DeckeHost` is not gated on a click, only on `entitled && !chromeless`
(`DeckeHost.tsx:166-167`), so every entitled visitor to a non-chromeless page pays the
whole 6.9 MB automatically, on a timer, whether or not they ever look at the corner.

`three` itself (`node_modules/three@0.185.1`) is the majority of the 1.14 MB
`Decke-runtime` chunk; `character/decke/**` (the 32 TypeScript modules, ~15.2 KLOC per
`wc -l`) makes up the rest.

### 1.3 Who actually reaches this path in production

`host/entitlement.ts:36-66` — fails closed. In cloud production a visitor is entitled
only if `me.decke` (server: owner **or** `DECKE_ENTITLED_USER_IDS`) is true
(`entitlement.ts:65`). In dev (`import.meta.env.DEV`, line 45) and self-host (line 48)
**everyone** is entitled, unconditionally — which is why the "immediately" bug reproduces
for the owner (or any dev-mode session) on essentially every page load.

---

## 2. The "always present" root cause

**The condition that decides whether the heavy runtime loads is `DeckeHost.tsx:166-177`,
and it is a timer, not a click:**

```ts
// host/DeckeHost.tsx:163-177
useEffect(() => {
  if (!entitled || chromeless || phase !== 'idle') return
  const start = () => setPhase('loading')
  const w = window as ...
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(start, { timeout: 4000 })
    return () => ...cancelIdleCallback?.(id)
  }
  const t = setTimeout(start, 1500)
  return () => clearTimeout(t)
}, [entitled, chromeless, phase])
```

Once `phase` becomes `'loading'`, the second effect (`active` at line 273, effect body
275-406) is unconditionally allowed to run and does the full load described in §1.1,
ending in `setPhase('ready')` (line 375) and `setLive(decke)` (line 376). The `<canvas>`
element (rendered unconditionally whenever `entitled && !chromeless`, see the early
return at line 408) fades from `opacity-0` to `opacity-100` over 500 ms purely as a
function of `phase === 'ready'` (lines 423-426) — **there is no gate here on "has the
user clicked the button."**

**Every place this condition is set / could be influenced:**

1. `DeckeHost.tsx:166-177` — the automatic idle/timeout warm (the actual culprit).
2. `DeckeButton.tsx:57-61` (`warm()`, called from `onPointerEnter`/`onTouchStart`/`onFocus`,
   wired at `DeckeButton.tsx:69-71`) — the *intended* trigger, which calls the host's
   `onWarm` prop (`DeckeHost.tsx:440`: `onWarm={() => setPhase((p) => (p === 'idle' ? 'loading' : p))}`).
   This is a no-op in practice because #1 has almost always already fired first.
3. `DeckeButton.tsx` onClick → `onOpen` → `DeckeHost.tsx:439` `setChatOpen(true)` — does
   **not** touch `phase` at all; it only opens the chat panel and (via the effect at
   `DeckeHost.tsx:227-263`) flies him to the chat stand point. It never gates the load.
4. `entitlement.ts:36-66` gates *whether he loads at all*, not *when* — see §1.3.

The button's own doc comment (`DeckeButton.tsx:12-15`) states the intended contract
explicitly — *"the button is a cheap 2D stand-in that warms the real runtime on intent —
pointer-enter or touch"* — but effect #1 above races and wins almost every time, which is
why the button now reads as decorative rather than load-bearing.

**Fix shape implied by this evidence (for the planning agent):** removing or gating
`DeckeHost.tsx:166-177` behind real intent (hover/focus/touch on the button, or first
scroll/idle *and* nothing else) is the single change that stops the automatic load. The
canvas's opacity-fade-in at `phase==='ready'` (lines 423-426) then naturally stops firing
until the button warms it. Everything else (chat-open flight, sizing, facing) is
downstream of this and unaffected by fixing it.

---

## 3. Sizing

**One writer, by the file's own doc comment** (`DeckeHost.tsx:63-84`):

```ts
// host/DeckeHost.tsx:61
const CHAT_COMPACT = 0.5

// host/DeckeHost.tsx:81-84
function characterHeightFor(w: number, h: number, compact: boolean): number {
  const full = Math.min(300, h * 0.3, w * 0.55)
  return Math.round(compact ? full * CHAT_COMPACT : full)
}
```

- `full` caps at **300 px**, or 30% of viewport height, or 55% of viewport width —
  whichever is smallest.
- `compact` is computed at the call site: `const compact = chatOpenRef.current && w < NAV_BREAKPOINT`
  (`DeckeHost.tsx:330`) — **compact (half-size, 150 px cap) applies ONLY on a phone
  (`w < NAV_BREAKPOINT = 1068`) while the chat is open.** On desktop, `compact` is always
  `false`, so the chat-open size is the *same* `full` size as his idle/home size — up to
  300 px tall, uncapped by anything panel-related. This is the direct cause of "too big,
  especially desktop": the desktop chat panel is `420 × min(620, 100vh-140px)` px
  (`DeckeChat.tsx:441`) and a 300 px-tall character standing beside it at `STAND_DESKTOP`
  is roughly half the panel's own height.
- Applied via `decke.stage.setCharacterHeight(px)` (`DeckeHost.tsx:332`), which — per the
  extensive comment at `DeckeHost.tsx:72-80` — **dollies the camera** rather than scaling
  the mesh; changing it moves the whole scene's pixel-to-world mapping, so any position
  solved before this call is wrong afterward. (This is why the effect order matters for
  travel; see §4.)
- `NAV_BREAKPOINT = 1068` (`DeckeChat.tsx:91`, matching `--breakpoint-nav: 1068px` in
  `apps/web/src/theme.css:253`).
- The panel's own "silhouette" box for gutter/park purposes is derived, not measured
  independently: `SILHOUETTE = 1.28`, `SILHOUETTE_ASPECT = 0.76` (`DeckeChat.tsx:121-122`),
  `parkH = Math.round(characterPx * SILHOUETTE)`, `parkW = Math.round(parkH * SILHOUETTE_ASPECT)`
  (`DeckeChat.tsx:257-258`).
- Underlying body dimensions the engine itself is authored to: `BODY_W = 1.75`,
  `BODY_D = 1.15`, `BODY_H = 2.4` blender units (`constants.ts:20-23`).

---

## 4. Placement / anchoring

### 4.1 Idle / home (before chat, and whenever `returnHome()` fires)

- `HOME_INSET = { x: 0.17, y: 0.22 }` (`dom.ts:35`) — home is a **viewport-relative**
  point, inset 17% from the right edge and 22% from the bottom, computed by
  `homeCorner(camera, baseDistance)` (`dom.ts:295-304`), unprojected through
  `viewportToBlender` (`dom.ts:57-89`).
- Set at construction time, before any load-time async work, as part of `load()`:
  `this.anchor.copy(homeCorner(...))` (`DeckE.ts:690`), guarded only by
  `opts.startAt !== 'staging'` — the host always passes `startAt: 'home'`
  (`DeckeHost.tsx:301`).
- `returnHome()` (`DeckE.ts:1225-1234`) re-solves the same `homeCorner` and is called:
  whenever the chat closes (`DeckeHost.tsx:231-233`, in the effect at 227-263), and
  whenever the chat opens (`DeckeChat.tsx:273-278`, `decke?.returnHome()` right before
  `lockScroll()` — he is sent home an extra time on open, before being flown to the
  stand spot).
- No breakpoint distinction for home — it's the same fractional viewport corner on
  desktop and mobile.

### 4.2 Chat-open stand point

```ts
// host/DeckeChat.tsx:78            desktop: left-of-centre, out on the open page
export const STAND_DESKTOP = { x: 0.36, y: 0.58 }
// host/DeckeChat.tsx:88            mobile fallback if the DOM landmark isn't mounted yet
export const STAND_MOBILE = { x: 0.14, y: 0.84 }
// host/DeckeChat.tsx:81            what DeckeHost looks for on a phone
export const PARK_LANDMARK = 'data-decke-park'
```

- **Desktop:** always the fractional-viewport point `STAND_DESKTOP` (`DeckeHost.tsx:249-253`),
  via `d.flyTo({x, y}, {depth:'foreground', highlight:false, centre:true})`. The chat
  panel itself sits at `bottom-[24px] right-[24px]`, 420 px wide (`DeckeChat.tsx:441`), so
  the character (at `x=0.36` of viewport width — left of the panel, well out on the open
  page) and the panel are two separate, disconnected screen regions. This is the literal
  "sits far from the chat panel on desktop" — there is no code that reads the panel's
  actual `getBoundingClientRect()` on desktop at all; `STAND_DESKTOP` is a hand-picked
  constant with no relationship to the panel's real position or width.
- **Mobile:** flies to the DOM landmark `[data-decke-park]` if present
  (`DeckeHost.tsx:242-248`), which is a `pointer-events-none` empty div positioned
  `left: 10px; bottom: 6px` inside the (full-screen) panel, sized `parkW × parkH` from
  §3 (`DeckeChat.tsx:568-580`). Falls back to `STAND_MOBILE` fraction only if the
  landmark selector doesn't resolve yet (`DeckeHost.tsx:249-253` again, same call site,
  `wide` false branch).
- Both calls pass **`centre: true`**, and that is the load-bearing detail for §5 below:
  `solvePark(..., {centre:true})` returns `{ position }` with **no `facing` field**
  (`dom.ts:279-293`, specifically 284-290), by explicit design —
  `dom.ts:276-277`: *"`facing` is absent for a centre park, deliberately: a point has no
  inward, so the caller's facing is left alone rather than being invented here."* This
  invariant is pinned by a unit test: `__tests__/park.test.ts:119`
  `assert.equal(on.facing, undefined, 'a centre park must leave facing to the caller')`.
- The whole chat-open re-position runs in the effect at `DeckeHost.tsx:227-263`, keyed on
  `[chatOpen, live, wide]`. Order is explicit and documented as load-bearing: **resize
  first** (`measureRef.current?.()`, line 230) **then** solve/fly the destination (inside
  a 320 ms `setTimeout` + one `requestAnimationFrame`, lines 235-255) — because
  `setCharacterHeight` dollies the camera and a destination solved before the dolly lands
  wrong after it (comment block `DeckeHost.tsx:204-226`).

### 4.3 Travelling (a UI tool/LLM flies him to a page element)

- `flyTo(target, opts)` (`DeckE.ts:1101-1179`) → `solvePark`/`parkBeside`
  (`dom.ts:146-221`) when **not** `centre`. `parkBeside` computes a real "beside the
  element, facing inward" position and an explicit `facing` (`dom.ts:219`:
  `facing = side === 'right' ? 1 : -1`), chosen from which half of the screen the target
  rect's centre falls in (`dom.ts:175-189`), with an edge exception that flips sides
  rather than let him go off-screen (`dom.ts:181-189`).
- This is the ONE code path that already computes a correct inward-facing yaw — it's
  only the two *centre* parks (home-adjacent chat stands) that don't.

---

## 5. Facing / gaze

### 5.1 Yaw (body facing)

- `facing` is a continuous scalar in `[-1, +1]`, animated over
  `FACING_TURN_MS = 866.7 / 1.75 ≈ 495.3 ms` (`DeckE.ts:121`, matches README's "495ms").
  Applied as `this.rig.facing.rotation.y = ((1 - this.facing) / 2) * FACING_YAW_DEG * DEG`
  (`DeckE.ts:1986`), where `FACING_YAW_DEG = 80.39` (`DeckE.ts:109`) — the two authored
  directions are 80.39° apart, not a full about-face.
- **Sign convention, stated explicitly in `dom.ts:203-219`:** `facing` is in *his* frame.
  `+1` turns him to *his* right, which reads on screen as turning to **screen LEFT**.
  Confirmed independently by `useDeckeChat.ts:848`:
  `decke.setFacing(c.value === 'left' ? 1 : -1)` — i.e. the LLM-facing verb `"left"` maps
  to the numeric value `+1`.
- **Default facing is `+1`** (`private facing = 1`, `DeckE.ts:454`) — i.e. by default he
  faces **screen-left**. Nothing at boot, at `startAt:'home'`, or in either chat-open
  `flyTo` call ever changes this, because both those calls are `centre:true` and (§4.2)
  centre parks never set a facing (`dom.ts:276-277`); `flyTo` then does
  `this.setFacing(park.facing ?? this.facingTarget)` (`DeckE.ts:1158`) — `park.facing` is
  `undefined`, so the previous facing (still the boot default, `+1`/screen-left) is simply
  re-asserted.
- **Consequence, desktop:** he stands at `STAND_DESKTOP = {x:0.36,...}` — left of centre —
  while the chat panel is at the bottom-right. To look at the panel he needs to face
  screen-right, i.e. `facing = -1`. He is left at `+1` (screen-left) — **facing away from
  the panel, out into the open page.**
- **Consequence, mobile:** he stands at the `[data-decke-park]` landmark, which is
  anchored `left:10px; bottom:6px` inside the full-screen panel (`DeckeChat.tsx:575-576`)
  — i.e. to the *left* of the composer/transcript column. To look at the conversation he
  needs to face screen-right, `facing = -1`. Again left at the default `+1`
  (screen-left) — **facing away from the text**, even though (per the complaint) his
  *position* on mobile is already correct.
- This is a single, well-isolated defect: neither `parkOn` (`dom.ts:245-256`, "his facing
  is left to the caller, because a point has no inward") nor `solvePark`'s centre branch
  needs to change — and must not, per the pinned test `park.test.ts:119`. The fix has to
  live at the two call sites in `DeckeHost.tsx:243-253`, either by passing an explicit
  facing alongside `centre: true` (would need a new `flyTo` option, since `FlyOptions`
  today has no independent facing field — `DeckE.ts:1101` signature) or by calling
  `decke.setFacing(...)` explicitly right after/alongside the `flyTo` calls.

### 5.2 Gaze (pupil aim)

- **The gaze target is ALWAYS anchored to the live camera position**, plus a per-pose
  offset — this is fundamental to the whole system, not a per-state choice:
  `gazeTarget(camera, gx, gy, gz, out)` (`look.ts:165-178`) does
  `camera.getWorldPosition(out); out.x += gx; out.y += gy; out.z += gz`. Every state
  ("thinking" included) is fundamentally "look at the camera, offset by this much" — see
  the module's own header (`look.ts:1-51`), which explains this is a rebuild of a Blender
  "Copy Location with offset" constraint that did not survive glTF export.
- `aimPupil` (`look.ts:125-151`) converts that world-space target into each eye's local
  tangent-space aim, clamps to `PUPIL_ROAM = { x: 0.115, z: 0.225 }` (`look.ts:67`), gain
  `GAZE_GAIN = 0.2563` (`look.ts:60`).
- **The "thinking" state's authored offset is small relative to camera distance**, so it
  reads as "still basically looking at the camera": `playbook.json` state `thinking`
  (`compileState`/`evalState` in `playbook.ts`) carries `gx: -1.7, gz: 1.05` for nearly
  its whole 2480 ms duration (only the last two beats at 2160/2320/2480 ms taper the
  offset down toward 0, i.e. *back* toward dead-on-camera). At the staging camera distance
  (`BLENDER_CAMERA.position` magnitude ≈ 8.87 blender units, `constants.ts:41`), a
  `gz=1.05` vertical offset works out to roughly `atan(1.05/8.87) ≈ 6.8°` above the
  camera — a slight upward tilt, not a clear "look up and away." This matches the
  complaint precisely: *he is still mostly looking at the camera, with only a mild
  upward/lateral nudge, during "thinking."*
- Compare to what "look up and away" would require: either a much larger `gz` (and
  `gy`, i.e. push the target further from the camera so the deviation angle grows) in the
  `thinking` state's playbook data, or a code-level override in `DeckE.ts` that swaps the
  gaze target away from `gazeTarget(camera,...)` entirely while `thinking` is active
  (there is currently no such override path — `gazeTarget` is always camera-relative,
  called once per frame; see the `look.ts:1-51` header note that a per-state gaze that is
  NOT camera-relative is not something this module currently expresses).
- The state's `gx` sign is negated by `resolveFacing` for the current facing
  (`rig.ts:624-638`, specifically `pose.gx *= facing`, line 637) — this must run *after*
  procedural gaze layers compose (`DeckE.ts:2115-2126`, comment explains why), and is
  already correctly ordered; changing "thinking"'s gaze does not interact with this
  bug.
- Playbook data lives in `apps/web/public/models/decke/playbook.json` (186.8 KB,
  generated by `scripts/decke/gen-playbook.py` per `playbook.ts:6-9` — the header warns
  the Python generator has been broken since 2026-08-16, so hand-editing the committed
  JSON, or fixing the generator, are the two live paths to changing `thinking`'s gaze
  numbers).

---

## 6. Open/close transition

**What currently animates:**
- The **chat PANEL** (a flat 2D DOM element) animates in via CSS keyframes:
  desktop `decke-chat-in` — `opacity 0→1`, `transform: translateY(16px) scale(0.94) → none`,
  280 ms `cubic-bezier(0.2,0.9,0.3,1)` (`theme.css:704-713`, applied at
  `DeckeChat.tsx:441`). The keyframe's own comment (`theme.css:697-703`) states intent:
  *"It GROWS OUT OF THE BUTTON… this is the moment the character is summoned, and a panel
  that simply appears reads as a webpage while one that expands from where you clicked
  reads as him arriving."* **In practice the transform-origin is not tied to the button's
  actual DOM position** — it's a fixed bottom-right anchored panel, not a
  `transform-origin` computed from `getBoundingClientRect()` of the button.
- Mobile panel: `sheet-panel-up`, `translateY(100%) → none`, 260 ms
  (`DeckeChat.tsx:442`, keyframe reused from the generic sheet system,
  `theme.css:611-618`).
- Scrim: `sheet-scrim-in`, opacity fade, 180 ms (`DeckeChat.tsx:414-415`).
- The **character** does perform a real 3D flight from wherever he currently is (usually
  home corner) to the stand point, via `flyTo` (§4.2) — this genuinely is "travel," and
  is the one part of the requested behaviour that already exists.
- The **button** fades/scales in once on its own mount (`decke-button-in`,
  `theme.css:787-790`, `translateY(10px) scale(0.9)→none`, 320 ms) — irrelevant to
  open/close, this is initial-page-load only.

**What does NOT animate, contrary to the desired "absent until clicked → scale up from
zero → travel":**
- The **character himself never scales from zero.** He is either not loaded (canvas
  fully transparent, `opacity-0`) or loaded and rendered at his full, constant on-screen
  height (`characterHeightFor`, §3) — the canvas-level fade (`DeckeHost.tsx:423-426`,
  500 ms opacity 0→100) is the *only* "appearing" animation he has, and per §2 it fires on
  a timer, unrelated to the click.
- There is no whole-body screen-space scale animation anywhere in `DeckE.ts`/`rig.ts`.
  The only "squash" is `sq`, a small per-pose deformation channel
  (`CHANNEL_RANGE.sq: {min:-0.3, max:0.6}`, `constants.ts:148`) applied via
  `rig.squash.scale.set(sxy, sz, sxy)` (`rig.ts:254`) — this is a per-frame *shape*
  squash used by the `boot` state (starts at `sq: -0.18`, playbook.json `states.boot`),
  not a screen-space scale-up-from-zero of the whole character.
- Because he is already visible at `homeCorner` well before the button is clicked (§2),
  clicking "open chat" today looks like: *character already standing in the corner* →
  *flies sideways to the stand point* → *panel pops up beside him*. There is no "he
  appears out of nothing and grows."

---

## 7. Chat shell anatomy (DOM/CSS)

All from `host/DeckeChat.tsx`, class strings quoted verbatim.

**Scrim** (`DeckeChat.tsx:409-418`):
```
fixed inset-0 cursor-default bg-black/45 backdrop-blur-[3px]
motion-safe:animate-[sheet-scrim-in_180ms_ease-out_backwards]
z-[15]   (desktop)   /   z-[24]   (mobile)
```

**Panel** (`DeckeChat.tsx:433-444`):
```
role="dialog" aria-modal="true" aria-label="Chat with Deck-E"
style: --decke-gutter: <gutter>px
fixed z-[25] flex flex-col

desktop:
  bottom-[24px] right-[24px] h-[min(620px,calc(100vh-140px))] w-[420px]
  rounded-[18px] border border-border-default bg-surface-primary shadow-2xl
  motion-safe:animate-[decke-chat-in_280ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]

mobile:
  pointer-events-none inset-0
  motion-safe:animate-[sheet-panel-up_260ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]
  (no background of its own — the scrim behind is the only darkening/blur; the
   panel is literally glass, per the file's own header comment DeckeChat.tsx:28-32)
```

**Header** (`DeckeChat.tsx:445-460`): `flex shrink-0 items-center justify-between
px-[16px] py-[12px]`, bottom border on desktop only; title "Deck-E"; a 32×32 close
button.

**Transcript / scroll container** (`DeckeChat.tsx:471-474`):
```
flex flex-1 flex-col overflow-y-auto px-[16px] pb-[12px]
```
Bottom-aligned via `mt-auto` on the message `<ul>` (`DeckeChat.tsx:480`), deliberately
*not* `justify-end` on the scroller — the file explains (`DeckeChat.tsx:463-469`) that
`justify-end`/`align-items` pushing content past the flex start makes the overflow
unreachable (`scrollHeight === clientHeight`).

**Mobile "park box"** (`DeckeChat.tsx:568-580`) — invisible landmark, not a visual
element:
```
pointer-events-none absolute opacity-0
left: 10px; bottom: 6px; width: <parkW>px; height: <parkH>px
data-decke-park attribute
```

**Composer** (`DeckeChat.tsx:647-700`):
```
decke-composer pointer-events-auto flex shrink-0 items-center gap-[8px] py-[10px] pr-[16px]
border-t border-border-default   (desktop only)
```
Left padding is `calc(16px + var(--decke-gutter))` (`theme.css:842-843`), the
"clearance" so the input never starts under the character on mobile.

**Minimised bar** (`DeckeChat.tsx:378-397`, when `travelling`): a floating pill,
`fixed inset-x-[12px] bottom-[12px] z-[25] ... nav:right-[24px] nav:w-[420px]`.

**Z-index stack, whole system** (comment block `DeckeChat.tsx:34-40` + confirmed at each
site): scrim 15 (desktop)/24 (mobile) < panel 25 < canvas 30
(`DeckeHost.tsx:420,424` `z-30`) < speech bubble 31 (`DeckeBubble.tsx:117`) < modals 100 <
toasts 9999. App chrome (`--z-chrome`) is 20 (`theme.css:287`), which is why the canvas
(`z-30`) is deliberately above it — `DeckeHost.tsx:417-419` comment: *"he has to be able
to park beside and point at a nav item."*

**Portal target / render strategy:** there is no React portal — `DeckeChat` renders
directly into the tree at the position `DeckeHost` occupies (a sibling of the router
outlet, `main.tsx:100-106`). The character himself is **not drawn inside the panel** at
all — he's drawn by the single always-on `<canvas>` (`DeckeHost.tsx:420-427`) *above*
the panel; the panel just reserves an invisible box (`data-decke-park`, mobile) or leaves
open page space (`STAND_DESKTOP` fraction, desktop) for the canvas layer's render of him
to occupy. `DeckeChat.tsx:1-40` documents at length why a second render inside the panel
was rejected (would duplicate him / a naive panel would occlude the canvas).

**Reflow-on-scroll mechanism** (`DeckeChat.tsx:309-355`): a DOM-attribute-driven
(`data-clear="true"`), not React-state-driven, margin toggle on `.decke-shift` elements,
recomputed on transcript scroll/resize/message-change, comparing each bubble's bottom
edge to the park box's top edge minus `CLEAR_PAD = 10` (`DeckeChat.tsx:133,315`).

---

## 8. Public API surface (what a plan should drive against)

### 8.1 Imperative controller (`decke/DeckE.ts`, consumed via `host/runtime.ts`'s
`DeckEInstance` type)

Documented in full in `decke/README.md:59-75`. The methods relevant to this pass:

```ts
decke.setState(name, { mode?, durationMs?, then? })
decke.setFacing(value: number, { animate?: boolean })   // DeckE.ts:1081
decke.flyTo(target: {selector}|{rect}|{x,y}, {
  depth?: 'foreground'|'background', side?: 'auto'|'left'|'right',
  highlight?: boolean, centre?: boolean, then?: string, via?: 'background', scrollWith?: boolean
})                                                        // DeckE.ts:1101
decke.returnHome()                                        // DeckE.ts:1225
decke.highlight(target, {durationMs?})                    // DeckE.ts:1217
decke.clearHighlight()                                    // DeckE.ts:1221
decke.stage.setCharacterHeight(px)                        // sizing, DeckeHost.tsx:332
decke.screenRect()                                        // polled for the speech bubble
decke.scrollIntoView()                                    // DeckeBeacon click handler
decke.getState().highlighted                              // read by DeckeBubble's avoid rect
```

`FlyOptions` (the type behind `flyTo`'s second argument, `DeckE.ts` near line 1101) has
**no independent `facing` field today** — this is the gap a plan fixing §5.1 will need to
either fill (add `facing?: number` to `FlyOptions`, honoured even when `centre: true`) or
work around (call `setFacing` explicitly alongside the two `DeckeHost.tsx` `flyTo` calls).

### 8.2 Declarative LLM command surface (`decke/commands.ts:25-113`, `runCommands()` at
line 182)

```ts
type Command =
  | { op:'state', value, blendMs?, mode?:'sustain'|'once', durationMs?, then?, count?, cards?, autoClose? }
  | { op:'cardArt', slot, card }
  | { op:'idle', blendMs? }
  | { op:'highlight', selector, durationMs? }
  | { op:'clearHighlight' }
  | { op:'keyframes', beats, loop?, then?, blendMs? }
  | { op:'facing', value:'left'|'right'|number, animate? }   // 'left' -> setFacing(1)
  | { op:'talk', value, weight? }
  | { op:'channel', channel, value }
  | { op:'flyTo', selector?, x?, y?, depth?, side?, highlight?, then? }   // NOTE: no `centre` exposed here either
  | { op:'home' }
  | { op:'clearChannels' }
```
`commandSchema(stateNames)` (`commands.ts:610`) presumably JSON-schemas this for the LLM
tool definition — not read in full for this pass, but relevant if a plan wants the model
itself to be able to say "face the chat."

### 8.3 Browser-side UI tools (`host/uiTools.ts`)

```ts
CLIENT_TOOLS = ['flyTo', 'highlight', 'goTo', 'scrollToMe', 'click']   // uiTools.ts:32
runUiTool(...)                                                         // uiTools.ts:196
```
These are the tool names the server-driven chat (`useDeckeChat.ts`) can invoke on the
client; `useDeckeChat.ts:848` is where `op:'facing'` from the wire protocol turns into
`decke.setFacing(...)`.

### 8.4 Host-owned React state a plan will touch

`DeckeHost.tsx` owns: `entitled`, `phase` (`'idle'|'loading'|'ready'|'failed'`), `chatOpen`,
`wide` (breakpoint), `charPx` (published size), `himRect` (polled position while
travelling), `travelling`. All of `DeckeChat`'s and `DeckeButton`'s sizing/position
behaviour is downstream of these via props — there is deliberately **one writer** for
each (documented repeatedly in the file's own comments, e.g. `DeckeHost.tsx:63-70,
111-124`).

---

## 9. Risks & landmines

1. **`__tests__/park.test.ts:119`** hard-asserts `solvePark(..., {centre:true}).facing === undefined`
   with the comment "a centre park must leave facing to the caller." **Do not fix §5.1 by
   making `solvePark`/`parkOn` return a facing for centre parks** — that breaks a pinned
   invariant and (per its own history, `dom.ts:274` "One function, both callers, so the
   two can no longer drift apart") was itself the fix for an earlier bug where `flyTo`
   and the re-solve path disagreed. Fix at the `DeckeHost.tsx` call sites instead.

2. **`look.test.ts`** pins `aimPupil`/`gazeTarget` against the glb's *baked bind pose* at
   the *staging camera* (not against any specific playbook state). Changing the
   `thinking` state's `gx`/`gz` values in `playbook.json` does not touch this test, but
   any change to `look.ts`'s gain/roam constants (`GAZE_GAIN`, `PUPIL_ROAM`) would need to
   be re-validated against it (`__tests__/look.test.ts:45-56`).

3. **`playbook.json` is generated, and the generator is broken.** `playbook.ts:6-9`:
   *"the committed `_raw/playbook.json` is stale by four states and must not be used"* —
   the live `apps/web/public/models/decke/playbook.json` (187 KB) is the actual source of
   truth consumed at runtime, and it is NOT regenerable via
   `scripts/decke/gen-playbook.py` right now (broken since 2026-08-16, per
   `README.md:6-9`). **Any change to the `thinking` state's gaze beats must be hand-edited
   directly into the committed JSON**, since the normal generation pipeline cannot be
   trusted to reproduce it, and doing so risks drifting from "the character wiki's
   normative Python" without anyone noticing until the generator is fixed.

4. **`setCharacterHeight` dollies the camera, not a mesh scale** (`DeckeHost.tsx:72-80`
   comment). Any sizing change must preserve the "resize before solving a destination"
   ordering already encoded in the effect at `DeckeHost.tsx:227-263`, or repeat the bug
   this file says was already debugged once ("he standing wherever that corner used to
   be").

5. **`vite.config.ts:220-231`'s `advancedChunks` naming (`Decke-runtime`) is load-bearing
   for the service-worker precache exclusion** (`vite.config.ts:160-168`,
   `globIgnores: ['models/**', 'assets/Decke-*.js']`). If a fix to §1/§2 changes how/where
   `DeckE`/`three` are imported (e.g. splitting the runtime differently, or adding a new
   lazy entry point), the emitted chunk name must still match `assets/Decke-*.js` or the
   PWA will silently start precaching ~1.14 MB of three.js for every visitor again — this
   is called out explicitly as "the exact failure the gate's own header comment predicts"
   (`vite.config.ts:216-219`).

6. **`scripts/decke-gates.mjs`** is a Playwright-driven verification suite (not part of
   CI — deliberately not a repo dependency, see its own header) that browser-tests
   real behaviour (URLs navigated to, network requests made) against a running
   deployment, using a `.qa-account` (never the owner account, per `AGENTS.md` B12). It
   is the closest thing to an existing regression harness for "does clicking actually do
   what it claims" and should be consulted/extended rather than bypassed when verifying
   any fix to the button/warm/load behaviour. It was NOT read in full for this pass
   (large file, header + first ~200 lines reviewed) — the planning agent should grep it
   for existing gates that touch load timing, entitlement, or facing before adding new
   ones, to avoid duplicating.

7. **`entitlement.ts`'s cache** (`cached: Promise<boolean> | null`, module-level,
   `entitlement.ts:25`) means `deckeEntitled()` only ever calls `/me` once per session
   (`resetDeckeEntitlement()` exists as an explicit test seam / sign-in transition
   escape hatch, line 69). Not a landmine for this task, but relevant context: entitlement
   state does not react to a mid-session plan change without that reset.

8. **StrictMode double-invoke / one-GL-context-per-canvas discipline** in `runtime.ts`
   (`acquireDeckE`/`releaseDeckE`, lines 91-123, deferred dispose via `setTimeout(...,0)`)
   is unrelated to the six complaints but is exactly the kind of thing an over-eager
   "just add an effect that also does X on mount" fix could break — any new effect
   touching `phase`/`active` should be checked against React 19 StrictMode's synchronous
   remount behaviour described in the file's own comment block (lines 68-79).

9. **`DECKE-AGENT-SPEC.md`** (repo root) is about a different topic — the tool-use /
   agent-capability rev-1 postmortem (approvals, dry-runs, execute wrappers) — and does
   not address any of the six visual/lifecycle complaints in this task. It is not a
   constraint on this work, just worth knowing it exists so it isn't mistaken for
   relevant prior art.

10. **`PARITY.md`** is a visual-regression record against the Blender source, keyed to
    silhouette IoU at specific reference poses/camera. Its own header
    (lines 1-5) already flags that gaze changes (from `look.ts`'s camera-constraint
    rebuild) make some of its stills "a comparison against a different thing" —
    i.e. **PARITY.md is already known-stale on gaze** and should not be treated as a
    blocking gate for a `thinking`-state gaze change; it is a record, not a CI check.
