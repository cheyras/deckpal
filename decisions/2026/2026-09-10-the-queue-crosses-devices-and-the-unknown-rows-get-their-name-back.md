---
date: "2026-09-10"
title: "The queue crosses devices, and the \"unknown\" rows get their name back"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-09-10 — The queue crosses devices, and the "unknown" rows get their name back

**Reported by:** @cheyras: *"I added a whole bunch of images in the quad labeler
on my macbook. They're in the queue there, but they are NOT in the queue when I
bring it up on mobile."* and *"in the harvest, there are like 224 'unknown', not
positive or negative. I'm not sure where these came from."* Both fixed by Claude
Opus 5.

### 1. The queue was per-device, and that was never flagged as a choice

IndexedDB is per-origin PER DEVICE. When the queue was built, "persistent" was
read as "survives a reload, a backgrounded tab, a phone that slept" — all true,
all beside the point of the workflow the request actually described: photograph
a stack on whatever camera is to hand, label it wherever you happen to be
sitting. A queue that can only be worked on the machine that filled it is the
constraint the feature existed to remove.

The cross-device reading was the more likely one and it was not raised. That is
the part worth recording: the tradeoff was decided silently, inside an
implementation choice, rather than put to the owner.

**The queue is now `POST/GET/DELETE /dev/scan-queue`** (`apps/api/src/dev/
scanQueue.ts`), holding pending photos in the object store beside the labels
they become, behind the same `labelerOnlyInProduction` gate.

* **Its own prefix, `dev-queue/`.** `dev-flags/` is the corpus — finished labels
  plus the scanner's telemetry. A pending photo is neither: no verdict, and
  deleted the moment it becomes a label. Sharing the prefix would have made the
  harvest hide a fourth record type and made "what is in my corpus" answer
  "…plus what I have not looked at yet".
* **The server stamps the id.** Two devices filling one queue cannot agree on a
  millisecond, and the id is also the sort order — "the order they were shot"
  only means anything under one clock.
* **IndexedDB is demoted to an OUTBOX.** A shutter press must not fail because
  the network did; a photo taken in a shop with no signal is exactly the photo
  worth keeping. Failed uploads are held locally, shown in the queue with a
  `local` chip, and drained on mount and on the `online` event. Their ids are
  NEGATIVE — which cannot collide with a server id, sorts them ahead of every
  uploaded photo (they were taken first), and makes the sign the routing in
  `removeQueued`.

**A consequence worth naming:** queue rows no longer carry their bytes, so a
thumbnail is a fetch — and a fetch through the gate, for the reason the harvest
thumbnails already taught. Both grids now share `AuthThumb`, which owns the
fetching, the `IntersectionObserver` laziness and the blob-URL revocation. Two
copies of that is two places for the revocation to drift, and a few hundred
queued phone photos is hundreds of megabytes pinned if one leaks.

### 2. The 224 "unknown" rows are the scanner's own telemetry

`scan/ui/flags.ts` writes `capture-event`, `lock-event` and `identity-event`
into `dev-flags/` — one PNG plus JSON per event, for every lock and capture of
every scanner session. They have shared the prefix since long before the harvest
existed; the harvest simply made them visible for the first time, under a label
(`unknown`) that described the reader's knowledge rather than the record.

Two changes, no deletions — these are legitimate records and the corpus is not
the only thing in that bucket:

* **They are named.** A row that is not a quad label now shows its `type`
  (`lock-event`, `capture-event`, `identity-event`) instead of `unknown`. The
  difference between 224 mysteries and 224 telemetry rows a reader can recognise
  and skip is entirely in the word.
* **They are off by default.** `defaultVerdicts` selects the label verdicts
  present, so the harvest opens on the corpus; the chips still count them and
  one tap brings them back. The default never resolves to "nothing" — a corpus
  holding only events shows them, because a "no matches" screen over a view that
  plainly has rows in it reads as a broken screen. A reader who touches the
  filter keeps their choice across a refresh.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 726/726, 0
skipped; `deckpal-api test:pure` 379/379; `deckpal-web build` clean. The queue's
round trip is NOT browser-verified — upload, cross-device listing, and the
outbox drain all want two real devices, which is the test the owner is better
placed to run than I am.

