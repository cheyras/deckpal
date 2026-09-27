---
date: "2026-09-07"
title: "The labeler is sized for a 200-frame session on a phone"
decided_by: "Agent, same sitting."
areas: ["general"]
supersedes: []
---
## 2026-09-07 — The labeler is sized for a 200-frame session on a phone

**Decided by:** Agent, same sitting.

**Decision:** Taps per label drop from 4 to **1** (upload, multi-select queue)
and from 3 to **2** (camera): a save now ADVANCES by itself — straight back to
the live view, or on to the next queued photo — the "Next" tap is gone, upload
takes a whole folder at once, and `CaptureStage` stays MOUNTED behind the editor
so the camera is acquired once per session rather than once per frame. The nine
rejection reasons move into a sheet one tap away; the corner handles get 44 px
hit areas around their unchanged 26/30 px markers; the root height subtracts
AppShell's `--app-header-h` instead of assuming the full viewport.

**Why:** Every one of these is a per-frame cost multiplied by several hundred.
The camera teardown alone was most of a second of black screen on every single
label. Measured at 390x844, the root's `h-dvh` put the Save button — the one
control pressed every frame — partly BELOW the fold, because the route renders
inside AppShell's 64 px header. And round 9 item 26 had already measured the
card-back toggle sitting 425 px above Save with all nine rejection chips between
them; on a 390 px phone that left almost nothing for the frame being labelled.

**Implications:**

* A failed POST no longer loses the label. `saveLabel.ts` splits encoding from
  sending, so the retry queue holds plain data (`PendingLabel`) rather than a
  canvas: the reader is advanced anyway, the queue drains on `online` and on a
  15 s backstop, and a `beforeunload` guard refuses to let a non-empty queue
  die silently. Capped at 25 (~6 MB) — past that the reader is told to stop.
* A double-tapped Save posts once, guarded by a REF (`setSaving` does not take
  effect until React re-renders, so two taps 40 ms apart both read the old
  `false`).
* Save reads the corner REF, not mirrored state — any path that ends a drag
  without a pointerup would otherwise post a quad the reader never saw, which is
  the one corruption a corpus cannot detect later.
* Still owed: `PwaUi`'s install pill is `fixed bottom-left` and overlaps the
  editor's bottom-left control; `scan/ui/camera.ts` has an unbounded
  `await video.play()` of the same family as the one fixed above. Both are
  outside this lane's files and are reported, not touched.

**Tests:** 647 web scan (7 new in `labelSchema.test.ts`; 588 was the baseline
before a concurrent scan-ui lane added its own), web typecheck and the full
`deckpal-web` build (check-api-base, check-precache, check-auth-deadlines) all
pass. Driven in headless Chrome against a local production build + `vite
preview`: 20/20 upload-and-seed checks, 6/6 camera checks, 0 page errors.

