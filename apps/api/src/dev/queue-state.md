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

The rules hold for two devices because listing, reading, repair, cleanup, and
discard take the same family advisory lock. Object listing only discovers
candidate families; each candidate is rechecked at its photo paths under that
lock. Both physical IDs resolve to one logical listing ID and the same current
photo. A sidecar is metadata, never evidence that its photo exists or that the
other photo should be hidden. Missing metadata gets a deterministic fallback.
Storage reads bypass caches so a second device sees completed writes/deletes.
New uploads also lock each candidate ID and check all four paths before writing,
so two devices posting in one millisecond receive different IDs.
Each listing advances at most two families at a time. All queue operations wait
in one process-level FIFO before checking out a database connection; cloud has
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
