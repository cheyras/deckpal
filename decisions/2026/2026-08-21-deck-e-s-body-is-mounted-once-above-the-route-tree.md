---
date: "2026-08-21"
title: "Deck-E's body is mounted once, above the route tree"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["agents","decks","operations"]
supersedes: []
---
## 2026-08-21 — Deck-E's body is mounted once, above the route tree
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** the character canvas mounts in `RootComponent` as a sibling of
`{shell}` — the slot `DevBackendRibbon` occupies — and not inside `AppShell`,
not in a route. It is hidden on every chromeless path, the engine is loaded on
idle rather than eagerly, and the whole runtime is pinned into one named chunk.

**Why:** `RootComponent` returns one of two element trees depending on
`isPublicPathname(pathname)`. Crossing that boundary — `/series` → `/decks`, the
everyday case — changes the element TYPE at that position from `AppShell` to
`AuthGuard`, so React unmounts the entire subtree. A canvas inside `AppShell`
would tear down its GL context and re-fetch 5.7 MB of character on exactly the
navigation the feature exists to survive. Verified in a browser rather than
argued: after the change, the SAME canvas node survives the crossing and
`decke.glb` is fetched exactly **once** across it.

**Implications:**

- **The precache gate had to move first, and would otherwise have failed the
  build.** `check-precache.mjs` gate ONE fails if a precached script *contains*
  three.js, and `vite.config.ts` excludes the character by NAME
  (`assets/Decke-*.js`). A second lazy importer of the engine makes the bundler
  hoist it into a SHARED chunk whose name it picks, which the glob would miss —
  the failure that file's own header comment predicts. `build.rollupOptions`
  `output.advancedChunks` now pins the group to `Decke-runtime`, so the name
  holds no matter how many modules import the engine.
- **`isChromelessPathname` is the guard, reused rather than re-listed.**
  `/dev/decke` builds its own controller on its own canvas; mounting the host
  there put two Deck-Es and two GL contexts on one page and hung the route hard
  enough to time out a 30 s navigation. `landingRoute.ts` says its call sites
  must agree; a private copy of that set is how they stop agreeing.
- **The setup effect keys on a derived boolean, not on `phase`.** Keying it on
  `phase` re-runs on the transition the effect itself performs (tearing the
  controller down in a loop), and does NOT re-run when a chromeless route
  unmounts the canvas and a later navigation mounts a fresh one — leaving a live
  controller bound to a node no longer in the document.
- **Disposal drops the GL context explicitly** (`forceContextLoss()`, plus a
  `pagehide` handler). `renderer.dispose()` frees three's objects but not the
  context, and browsers cap live contexts per page at a low number.
- **Entitlement is one function.** `deckeEntitled()` is the only thing any entry
  point asks. It reuses the owner gate rather than inventing a launch flag,
  because a new environment variable owes B11 a declaration, a boot warning and
  a `/health` field — for a gate that is temporary by construction. There is no
  entitlement/plan concept in the schema (checked: zero matches across all 38
  migrations), so this cannot consult one yet.

**Measured, and worth writing down because it looks like a defect and is not:**
disposing the engine under headless SwiftShader takes **~28–37 s**, which stalls
any full-document navigation away from a page holding a live context. It is
**pre-existing and not caused by this change** — the untouched `/dev/decke`
measures 28.5 s on `main` by the same probe. It is software-rasterizer teardown
of a 2.85 MB mesh plus a 1k HDRI and its PMREM, and it does not occur on real
hardware. Anyone verifying the character headlessly will hit it and should not
go looking for a bug in the mount.

Two more headless traps, both of which cost a wrong conclusion here first: rAF
runs at about **1 Hz**, so a screenshot after a wall-clock wait photographs a
frozen frame — stop the loop and step it (`d.stop(); d.elapsed += 1/60;
d.update(1/60)`). And the procedural blinker and gaze are **seeded**, so a fixed
step count lands on the same frame of the same blink every run; a shot at 90
frames caught him mid-blink and read as "his eyes have no pupils". `nod_yes` is
in the playbook's `gaze_lock` list and pins the pupils forward for a clean look.

---

