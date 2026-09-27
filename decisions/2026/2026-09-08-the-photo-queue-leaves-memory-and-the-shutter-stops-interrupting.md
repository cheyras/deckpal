---
date: "2026-09-08"
title: "The photo queue leaves memory, and the shutter stops interrupting"
decided_by: "@cheyras: *\"make it so that I can take a bunch of photos one"
areas: ["general"]
supersedes: []
---
## 2026-09-08 — The photo queue leaves memory, and the shutter stops interrupting

**Decided by:** @cheyras: *"make it so that I can take a bunch of photos one
after another and they all end up in a persistent queue… mass upload a bunch of
photos at once — again, so that they're in the same queue and I can pull each
image in the queue at my leisure, adjust the crop, define the quad, and/or set
whatever tags."* Implemented by Claude Opus 5.

**"Not enough light" already existed** as `too_dark` ("More light."), so nothing
was added for it — the ask was already served.

### A `useRef<File[]>` could not mean "at leisure"

The upload queue was an in-memory ref. That was right for what it was built for
— one picker interaction worked through in one sitting — and wrong for what was
asked next. *At leisure* means across a reload, a backgrounded tab, a phone that
slept, and a session that ends and resumes. A ref survives none of those, and
the failure is silent and total: the photos are gone, and they were photos of
physical cards that may no longer be on the desk.

So the queue is IndexedDB (`queueDb.ts`) — the app's first, deliberately ~200
lines of the raw API rather than a dependency: one store, five operations, no
migrations past version 1. `localStorage` was never a candidate: it stores
strings, so a photo would be base64'd (a third larger, synchronous, against a
~5 MB quota a single phone photo can exceed alone), while IndexedDB stores
`Blob`s natively. A `File` IS a `Blob`, so an upload is stored as its own
original bytes with no re-encode.

### The id is `Date.now()`, and that is a bug unless you fix it

`keyPath: 'id'` with `id = Date.now()` **silently overwrites**: `put` on an
existing key replaces it, and a hundred picked files enqueue in well under a
millisecond. One photo would be stored, ninety-nine would vanish, and nothing
would report an error. Ids therefore advance past a stalled clock — and past a
clock that jumps BACKWARD, which phones do. Pinned in `queueDb.test.ts`,
because no test that adds items one at a time against a real clock can see it.

The whole batch also goes in ONE transaction: a hundred separate ones is a
hundred trips through the event loop, and — worse — a half-committed batch when
the quota runs out midway. It lands or it does not.

### Rapid capture, and what the shutter stores

A `Rapid` toggle in capture mode (off by default) makes the shutter file the
frame and stay live, instead of freezing it and opening the editor. Off by
default because a reader labelling as they go still wants the editor, and taking
that flow away would cost more than the mode adds.

**The frame is stored at the camera's own resolution as a JPEG, not as a
canonical square.** The crop step comes later and cannot invent pixels a 416 px
square already discarded — deciding the crop at shutter time would defeat the
crop stage shipped this morning. JPEG at 0.92 puts a 1080p frame near 300 KB, so
a hundred-card run is tens of megabytes rather than the hundreds a PNG would
hold; the detector never sees these bytes, only the canonical square built from
them after cropping, so the quality that matters is "can a human place corners
on it".

In rapid mode the screen does not change when the shutter is pressed, so the
queue depth sits beside it: a count that moves is the only feedback the press
landed.

### A row retires from the queue AFTER it is labelled, not when it is opened

Removing on open would lose the photo if the reader backed out, reloaded, or the
save failed — precisely the loss a persistent queue exists to prevent. Finishing
one photo then opens the next, because that is what a worked queue is for.

### Uploads no longer open an editor

They go straight to the queue and the reader lands on the Queue tab. A
hundred-file pick is a batch to work through, not a hundred-deep stack of modal
state — and now that the batch survives the tab, holding it open was the only
reason to open it immediately.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 697/697, 0
skipped (4 new); `deckpal-web build` clean. NOT browser-verified — IndexedDB
quota behaviour, the camera JPEG path and the blob-URL revocation in
`QueueStage` all want a real device.

