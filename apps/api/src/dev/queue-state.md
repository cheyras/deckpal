# Quad labeler queue state

A logical queued photo is a **family** keyed by its original server-clock ID.
Its physical objects are `original.jpg`, `original.json`,
`replacementId(original).jpg`, and `replacementId(original).json`. The `.jpg`
extension is historical: original bytes can be HEIC. The replacement is JPEG.

| Original photo | Replacement photo | Sidecars (either or both) | Visible photo | Repair | Cleanup |
| --- | --- | --- | --- | --- | --- |
| Absent | Absent | Any | None | Refused | Refuses an orphan original sidecar; otherwise no-op |
| HEIC | Absent | Any | Original | Writes replacement JPEG and sidecar | Waits for complete replacement pair |
| JPEG | Absent | Any | Original | Refused | Waits for complete replacement pair |
| Any | Present | Any | Replacement | Completes missing/corrupt replacement sidecar | Removes original objects only after replacement pair is complete |

The rules hold for two devices because reading, repair, cleanup, and discard
take the same family advisory lock. Both physical IDs resolve to one logical
listing ID and the same current photo. A sidecar is metadata, never evidence
that its photo exists or that the other photo should be hidden. Missing
metadata gets a deterministic fallback.

The listing (since the 2026-10-04 decision) is built from ONE object listing
of both buckets, which is its snapshot. A family whose snapshot holds a photo shows it
once, under the original ID: the replacement if it was listed, else the
original, with the size the listing reported. Only the shown photo's sidecar
is read (else the original's), with no lock, at most 16 at a time; each read
gets 5 s per attempt and retries a throttle, 5xx or timeout twice. A family the
snapshot saw only as sidecars is rechecked at its photo paths under its lock,
at most two at a time, because a listing can miss a photo that exists (a page
shifting under a concurrent delete, a migration between the two bucket
listings); a sidecar alone is still not shown. So the listing never hides a
photo its snapshot saw. Like any listing, it can show a photo removed after the
snapshot was taken; opening that entry is a locked read that resolves the
family's current photo or answers 404, and a discarded family cannot be
repaired back. Holding the lock per family in the listing cost about half a
second per photo and timed the route out at a few hundred photos.
Storage reads bypass caches so a second device sees completed writes/deletes.
The objects live in the private `dev-captures` bucket and every read uses the
server's key. A photo still in the public `card-art` bucket from before
2026-09-28 is read through and deleted with its family, and the migration that
moves it (`POST /migrate-captures`) takes the same family lock, so a move can
never race a discard into resurrecting a photo.
New uploads also lock each candidate ID and check all four paths before writing,
so two devices posting in one millisecond receive different IDs.
All locked queue operations wait in one process-level FIFO before checking
out a database connection; cloud has
three dedicated session connections, while self-host reserves only one shared
request-pool connection for queue work. The advisory lock remains held through
the storage operation even if the HTTP request ends.

Repair writes the JPEG before its sidecar. A retry completes the sidecar before
reporting success. Cleanup deletes the original photo and sidecar only after
both replacement objects exist; it also removes an orphan original sidecar on
retry. Discard deletes original objects, then replacement objects. If any
deletion fails, the request fails and every surviving photo remains discoverable
for another attempt. Once discard succeeds, repair has no source and cannot
recreate a photo. A leftover original after repair is reclaimed on cleanup or
discard. Unrelated families are never touched.
