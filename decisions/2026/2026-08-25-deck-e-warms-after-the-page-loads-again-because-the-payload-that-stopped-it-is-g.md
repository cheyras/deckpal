---
date: "2026-08-25"
title: "Deck-E warms after the page loads again, because the payload that stopped it is gone"
decided_by: "Claude, on the owner's ruling: *\"If we can [shrink the runtime],"
areas: ["agents","decks","frontend"]
supersedes: []
---
## 2026-08-25 — Deck-E warms after the page loads again, because the payload that stopped it is gone
**Decided by:** Claude, on the owner's ruling: *"If we can [shrink the runtime],
I'd feel just fine at this point just pre-warming him immediately after the full
first page renders, rather than waiting until hover."*

**Decision:**

1. **The runtime chunk drops the RectAreaLight LTC tables.** `ltc.ts` fetches
   `models/decke/ltc.bin` (64 KB) and installs the textures into `UniformsLib`
   itself; `scripts/decke/gen-ltc.mjs` emits it. The chunk goes **962 KB -> 722
   KB minified, 310 KB -> 199 KB over the wire**, and 307 KB of JavaScript
   number literals stop being parsed on every load.
2. **The SDF glyph atlas is 640x256, not 2560x1024** — 288 KB -> 39 KB.
3. **PMREM is NOT precomputed.** Asked for, investigated, rejected on the
   numbers — see below.
4. **He warms after `load`, at idle**, instead of on hover. `DeckeButton`'s
   `onWarm` stays as the path for anyone who hovers inside that gap.

**Why:**

The LTC tables are the whole reason the chunk was that size: 241 KB of the 962
KB minified, being two 64x64 BRDF lookup tables written out as JS source. Two
things had to be measured before moving them, and the obvious version of this
optimisation is a REGRESSION:

- **Shipping all four tables as binary is worse than the status quo** — 192 KB
  raw / 151 KB brotli against the 108 KB the JS source compresses to. Decimal
  text compresses better than float32. Only the FP16 pair (64 KB / 51 KB) wins.
- **FP16 for both slots costs nothing visible.** `WebGLLights` picks FP32
  wherever `OES_texture_float_linear` exists, i.e. most desktops. Pointing both
  slots at FP16 moves six states by a worst mean of **0.0081/255**, max
  difference 2, zero pixels off by more than 8 — against a bit-exact A/A
  control, and confirmed a second time against three's own addon after the
  binary loader was written (same 0.0081, so the loader is faithful).

The atlas was 512 px per glyph for glyphs drawn inside eyes about 40 px across.
An SDF is designed to stay crisp far below its source resolution; 128 px cells
cost a worst mean of **0.040/255**. 64 px is where it starts to show
(`alert_scribble` reaches a max difference of 84), so 128 is the floor taken.

**PMREM, and why not:** `compileEquirectangularShader()` is 2 ms, the first
`fromEquirectangular` is 354 ms and the second is 1 ms — so the cost is a
one-time blur-shader compile, which Chrome then caches on disk like every other
shader. The output is 336x256 half-float, **672 KB raw**. Precomputing it would
trade 354 ms of first-visit GPU work for several hundred KB on every first
visit, which is backwards when the complaint is data. Not done, deliberately.

**Implications:**

- **The eager warm is a return to something that was deliberately deleted, and
  it is only safe because both reasons for deleting it are gone.** It cost 5.9
  MB of assets plus a ~1.14 MB chunk, and it put the 3D body and the launcher
  chip on screen together on every page — the "two Deck-Es" defect. The payload
  is now 545 kB of assets and a 199 kB chunk over the wire, and the second
  defect was fixed independently by `setEntryScale(0)` at the end of loading.
  VERIFIED with the project's own reproduction rather than reasoned about:
  `capture-decke.mjs --scene idle` reports
  `{"characterBodyVisible":false,"launcherChipVisible":true,"twoDeckEs":false}`
  with the warm firing at 4.3 s. **If the payload ever grows back, hover-warming
  is the correct thing to return to, and that harness is how to tell.**
- That harness's presence probe had to be corrected in the same commit: it read
  "a visible canvas" as "a visible character", which is no longer the same
  thing — the canvas is now mounted and rendering on every page with `entryScale`
  at 0. It consults `__decke.entryScale` where available and falls back to the
  old canvas test where it is not, so a production run still reports a possible
  defect rather than silently passing.
- **Save-Data and 2G opt out** and fall back to warming on intent. `navigator.connection`
  is feature-detected; its absence means "no objection", not "no character".
- The warm waits for `load` and then an idle callback with a 4 s timeout, so it
  never competes with first paint, and a page that never goes idle still gets him.
- Total: **744 kB over the wire** to have him ready, against 4543 kB before this
  work started, with the engine cost down from 7.4 s to 0.95 s.

