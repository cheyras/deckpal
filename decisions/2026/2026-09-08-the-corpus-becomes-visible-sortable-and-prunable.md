---
date: "2026-09-08"
title: "The corpus becomes visible, sortable and prunable"
decided_by: "@cheyras, on being told where the labels go: *\"Yes please,"
areas: ["frontend"]
supersedes: []
---
## 2026-09-08 — The corpus becomes visible, sortable and prunable

**Decided by:** @cheyras, on being told where the labels go: *"Yes please,
sortable by label, and also deletable."* Implemented by Claude Opus 5.

Labels have been written to `card-art/dev-flags/` since the labeler shipped and
there has never been a way to look at them. A corpus you cannot see is one you
cannot audit: a run where the reader was pressing the wrong reason chip, or
where every row came back `seededFrom: 'default'` because the model never
loaded, stays invisible until a training run fails weeks later and somebody goes
digging in a bucket. `/dev/quad-harvest` is that view.

### `?meta=1`, because the listing knows objects and the verdict is inside one

Storage's list endpoint reports size, type and etag — never content. So the
listing could say an id exists and not whether it was a card, a card back or a
reason-coded negative, which makes a harvest view a wall of thumbnails.

`GET /dev/scan-flags?meta=1` fetches each sidecar and returns a summary. **Opt
in**, because it costs one request per row; every existing caller that only
wants ids is unchanged and still one call. The fetches go through a new
`mapLimit` at 12-way concurrency — the comment fetch beside it has always been
an unbounded `Promise.all` and got away with it because comments are rare, which
is not true of summaries, and 300 simultaneous fetches out of a serverless
function is how you find its socket limit in production rather than here.

### Sorting by "label" is five orders, and none of them is alphabetical

A row's label is not a scalar: a verdict, a reason code when negative, and — on
sweep captures — how far the live pipeline got. `harvest.ts` declares each
order explicitly, and the reason each is what it is:

* **Verdict**: negatives, then backs, then positives, then unknown. Negatives
  are what a corpus review hunts (they are the rows a detector gets wrong);
  positives are the hundreds already going right. Alphabetical would give
  back/negative/positive — the order of their spelling.
* **Sweep stage**: `proposed` first, `locked` last. HARDEST first: a frame the
  model half believed and the gate refused is the most valuable thing a room
  sweep produces; a lock is the pipeline working.
* **Presence**: LOW first. A low `hasObj` on a row labelled as a real card is a
  detector miss, which is the one thing this corpus exists to find. `hasObj: 0`
  is a reading and not a missing one — the `!av`-instead-of-`av == null` bug
  that would bury the single most interesting row is pinned in the tests.

`unknown` covers rows written by the OTHER two producers sharing this prefix
(the harness's frame flags, the scanner's reports). They are not quad labels,
they still list, and they still count — a row that exists and cannot be
described is exactly what a total should not quietly omit.

### Delete is permanent, and the confirmation is where the row is

`DELETE /dev/scan-flags/:id` removes the png, the json AND the comment sidecar.
The comment is not optional cleanup: an orphaned `<id>.comment.json` would keep
appearing in the listing loop's `commentPaths` map forever, attached to an id
whose frame no longer exists. Absent objects are not an error, so a partial
delete retried finishes the job rather than 404ing on the piece already gone.

There is no recycle bin: these are unmanifested debug captures with no
`image_asset` row to soft-delete and no restore path that would not be a second
feature. So the confirmation lives in the UI, on a row the reader can see, as
two taps with the second one labelled `delete forever` — rather than in a
`?purge=true` flag they would learn to append without reading.

**Same gate as the labeler**, asserted rather than assumed: `scannerGate.test.ts`
now compares the two `beforeLoad` bodies for equality modulo the path. It lists
frames photographed in the owner's house and can destroy them; a viewer of the
corpus and a writer to it are the same person.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 691/691, 0
skipped (13 new); `deckpal-api test:pure` 379/379; `deckpal-web build` clean.

