---
date: "2026-09-11"
title: "Why nothing uploaded: HEIC, a hostage queue, and a cap above the real ceiling"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-09-11 — Why nothing uploaded: HEIC, a hostage queue, and a cap above the real ceiling

**Reported by:** @cheyras, with a screenshot of 32 queued photos — 30 `.HEIC`
rendering as the browser's torn-page glyph, two readable — and *"It does NOT
look like any of these are actually uploading though. The 'local' number is
staying the same."* Fixed by Claude Opus 5.

### The cap was above a ceiling this repo documents in three places

**Vercel rejects a serverless function's request body over 4.5 MB before the
handler runs.** `scan/router.ts` sizes itself at 4 MB and says so in a comment;
`ui/uploadNormalize.ts` opens with it; DECISIONS records it three times.

The queue route shipped at 12 MB, was "fixed" to 8 MB against `express.json`'s
12 MB limit, and both were above a ceiling the platform enforces first. Neither
could ever be the thing that refused a photo. What the reader got instead was a
platform error about nothing in particular, swallowed by a `catch`.

The budget is now **3 MB decoded** — 4 MB on the wire, the same number
`dev-flags` already uses — and the client normalizes down to it with a ladder
that steps quality and then edge until it fits, rather than making one attempt
and hoping.

**The lesson: the constraint was already written down, twice, in files this work
touched.** Reading them was cheaper than three rounds of shipping a limit that
could not fire.

### One undecodable photo held thirty-one others hostage

`flushOutbox` stopped at the first failure, reasoning that a dead network should
not be hammered with the rest of a batch. That reasoning only holds when
failures are about the NETWORK. An undecodable HEIC fails every time, forever —
and one at the head of the queue blocked every photo behind it, including the
two the browser could read perfectly well.

A per-item failure now skips that item and the loop continues; only
`navigator.onLine === false` short-circuits the run. The flush returns
`{sent, failed, remaining, error}` and the UI reports the tally.

### Chrome cannot decode HEIC, and pretending otherwise made it worse

Not a bug to fix — a format Chrome does not implement, in any path:
`createImageBitmap`, `<img>`, canvas. Safari does. The previous normalizer
caught the decode failure and **fell back to uploading the original bytes**,
which the route then stored as `image/jpeg` — manufacturing a server row exactly
as unreadable as the local one, and turning a browser limitation into corpus
corruption.

`normalizeForUpload` now THROWS rather than falling back, with the sentence the
reader needs: *"Chrome cannot read HEIC at all. Open the labeler in Safari, or
export the photos as JPEG first."* If this browser cannot read the picture, no
upload of it can be correct.

`AuthThumb` also gained an `onError`. Thirty torn-page glyphs in a grid read as
"the app is broken"; the honest message is "this browser can't open this
format", and the difference is entirely in whether anyone can act on it.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 733/733, 0
skipped (4 new); `deckpal-api test:pure` 379/379; `deckpal-web build` clean. The
new tests assert the budget arithmetic against Vercel's cap, that the flush
cannot go back to breaking on first failure, and that an undecodable photo is
refused rather than uploaded.

**Still owner-verified only.** The HEIC path needs Safari and a real iPhone
photo; nothing here can prove that from a terminal.

