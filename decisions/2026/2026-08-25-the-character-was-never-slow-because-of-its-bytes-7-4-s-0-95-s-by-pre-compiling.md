---
date: "2026-08-25"
title: "The character was never slow because of its bytes: 7.4 s -> 0.95 s by pre-compiling shaders"
decided_by: "Claude, after the owner tested the previous day's payload work"
areas: ["general"]
supersedes: []
---
## 2026-08-25 — The character was never slow because of its bytes: 7.4 s -> 0.95 s by pre-compiling shaders
**Decided by:** Claude, after the owner tested the previous day's payload work
and reported no improvement — *"I'm not really seeing that the load time on
Deck-E is that much better if I'm being honest. Still kind of chugs when I hover
over the chat button... Maybe that's not the load time, maybe it's something
else?"* It was something else.

**Decision:** `DeckE.precompile()` — `renderer.compileAsync(scene, camera)` —
called after `setEnvironment` and before `start()`, from all three mount sites
(`DeckeHost`, `/dev/decke`, `/dev/decke-compare`).

**Why:** The owner was right and the previous day's work was aimed at the wrong
thing. Phase timings on an RTX 5080 through ANGLE/D3D11, cold shader cache,
everything already in memory:

| phase | ms |
|---|---|
| import the module | 85 |
| construct the renderer | 40 |
| `load()` — glb, atlas, playbook, cards | 36 |
| HDRI fetch + parse | 7 |
| PMREM prefilter | 329 |
| **first frame** | **6184** |
| second frame | 1 |

The first frame is where `WebGLRenderer` compiles and links all 12 of the
scene's programs, synchronously. Cutting the payload from 4.23 MB to 0.74 MB
moved a 36 ms line item and left a 6.2 s one alone, which is exactly why it
could not be felt. `compileAsync` hands the same work to the driver's own
threads through `KHR_parallel_shader_compile`: same scene, same machine, **720
ms with a worst main-thread stall of 16 ms**, then a 53 ms first frame.

End to end on `/dev/decke`, cold shader cache, three runs each:

| | before | after |
|---|---|---|
| time to first frames | 7468 / 7357 / 7408 ms | **927 / 953 / 976 ms** |
| worst single stall | up to 6769 ms | 228 / 228 / 395 ms |

**Implications:**

- **Measuring this has two traps, and both give confidently wrong answers.**
  Chrome caches linked programs ON DISK, so a second run in the same profile
  measures the cache: the same build gave 7385 ms then 575 ms then 574 ms, and
  a median across those three would have reported 575 ms and hidden the entire
  defect. Use a fresh browser profile per run. And headless Chromium has no GPU
  — SwiftShader compiles this scene in 1.4 s and reports
  `KHR_parallel_shader_compile: false`, so it both understates the problem and
  cannot exercise the fix. The real GPU was *slower* than the software one here,
  which is not the direction anyone guesses.
- **Order is load-bearing.** `precompile()` must follow `setEnvironment`: an
  environment map changes the program define set, so compiling first compiles
  variants nothing will use and every real one is compiled again on the first
  frame — strictly worse than not calling it.
- It never throws. Where the extension is missing this degrades to the old
  behaviour, and failing to PRE-compile must not become failing to appear.
- **What is left is PMREM at 329 ms** cold, ~14 ms warm — its own shader compile,
  cached the same way. It cannot be hidden by reordering, because there is
  nothing substantial to overlap it with; removing it means shipping a
  precomputed cubemap rather than prefiltering the HDRI at load. Not done.
- The payload work from 2026-08-24 still stands and is still worth having — it
  is what a metered connection pays, and repeat opens are free — but it was
  never going to fix the stutter, and this entry exists so the next person
  reaches for a profiler before an optimiser.

