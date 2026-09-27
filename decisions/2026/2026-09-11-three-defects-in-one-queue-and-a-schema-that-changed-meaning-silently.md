---
date: "2026-09-11"
title: "Three defects in one queue, and a schema that changed meaning silently"
decided_by: "Not recorded"
areas: ["data"]
supersedes: []
---
## 2026-09-11 — Three defects in one queue, and a schema that changed meaning silently

**Reported by:** @cheyras: *"it's not working. Also all my local ones all say
(unreadable) so even that is fucked too"*, and then, unprompted and correctly:
*"we should probably also turn them all into a single standardized file format
on upload too"*. Fixed by Claude Opus 5.

### 1. A schema whose MEANING changed without its version changing

The server-backed queue routed on the sign of the id: negative meant outbox,
positive meant server. That is true of every row that code writes — and false of
every row already on disk when it shipped. The previous queue stored outbox
items under positive `Date.now()` ids, in the same database, the same store, at
the same version.

So upgrading mid-session produced a queue full of local photos whose ids claimed
to be the server's. `queuedPhotoBlob` asked the API for bytes it had never been
given and every one rendered `unreadable`; `removeQueued` deleted them from a
server that did not have them, so nothing was deleted at all.

Routing now ASKS the store (`inOutbox`) rather than inferring from the value. A
lookup is correct for rows written by either version, and the sign stops being
load-bearing at all.

**The lesson, stated because it is the general one:** `DB_VERSION` guards the
SHAPE of a store. Nothing guards its meaning. Redefining what a field means is a
migration even when no field is added, and this one shipped without noticing it
was a migration at all.

### 2. Uploads could not have worked above ~9 MB, and said nothing

The body is base64 — 33% larger than the bytes — behind `express.json({ limit:
'12mb' })`. The route's own cap was 12 MB DECODED, which is 16 MB on the wire:
unreachable. Anything past ~9 MB decoded was rejected by the body parser before
the handler ran, with a message about JSON rather than about photographs, and
`enqueue` caught it, held the photo and reported nothing. A queue of `local`
rows that could never upload looked exactly like a queue waiting for signal.

The cap is 8 MB decoded (10.7 MB on the wire) so the route can enforce and
explain its own limit, and the flush now returns `{sent, remaining, error}` —
the reader is told why it stopped.

### 3. One format, and the trap inside fixing it

The owner's own suggestion, and it turned out to be the same bug as the others:
`dev/scanQueue.ts` writes **every** upload as `<id>.jpg` with
`content-type: image/jpeg`, unconditionally. A PNG was stored under a lie; an
iPhone HEIC was stored under a lie that most browsers then refuse to decode — so
those photos would have come back unreadable from the SERVER too, once the
outbox bug stopped masking it.

Uploads are now normalized client-side to upright JPEG, ≤2048 px on the long
edge. 2048 costs nothing: `workingFrame.MAX_REFERENCE_SIZE` caps the editor's
sharp canvas at 1600 whatever the source, so the original 12 MP frame was never
reaching the editor — it was only making the upload fail.

**The trap: re-encoding through a canvas STRIPS EXIF.** A phone photo carries
its rotation in EXIF rather than in its pixels, so a naive re-encode bakes in
the unrotated pixels and discards the flag that said which way was up — every
portrait photo lands permanently sideways in the corpus, and no later step could
recover it. `normalizeForUpload` therefore decodes through `decodeForCanvas`,
the project's existing EXIF-aware path (`createImageBitmap(file,
{imageOrientation: 'from-image'})`), so the rotation is APPLIED before it is
lost. The stored name's extension is rewritten to `.jpg` to match, because a
name that disagrees with the bytes is the same small lie.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 729/729, 0
skipped (3 new); `deckpal-api test:pure` 379/379; `deckpal-web build` clean. The
new tests are source assertions — the failure is whole-module behaviour against
a database written by code that no longer exists, and there is no seam where a
unit test could observe it. Still NOT browser-verified: the round trip wants two
real devices and a HEIC.

