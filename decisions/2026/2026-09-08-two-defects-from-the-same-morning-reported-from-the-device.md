---
date: "2026-09-08"
title: "Two defects from the same morning, reported from the device"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-09-08 — Two defects from the same morning, reported from the device

**Reported by:** @cheyras: *"I clicked on queue and it said there was nothing.
seems like the queue is just saving to the harvest view maybe. All the images on
the harvest grid are broken links."* Both confirmed; both mine. Fixed by Claude
Opus 5.

### 1. Every harvest thumbnail was a broken image, and always would have been

The grid shipped with `<img src={api.scanFlagFileUrl(id, 'png')}>` and an
`<a href>` to the same route for the JSON. `/dev/scan-flags/*` sits behind
`labelerOnlyInProduction`, which reads the VERIFIED JWT subject — and a
browser-initiated image request or link navigation sends cookies, **never** the
`Authorization: Bearer` header `lib/api.ts` authenticates with.

Measured against the deployed endpoint while diagnosing:

```
GET https://deckpal.app/api/dev/scan-flags/<id>.png   -> 403
GET https://deckpal.app/api/dev/scan-flags            -> 403
```

Nothing could have caught it short of a browser signed in as an entitled
account: the URL was a perfectly good string, the types were right, the build
was clean, and the PR's own "not browser-verified" note named the delete path as
the risk while the whole grid was already dead.

`scanFlagFileUrl` is replaced by `scanFlagBlob`, which fetches through the same
authenticated pipeline as every other call; the caller mints a `blob:` URL it
owns and revokes. Thumbnails load **lazily** through an `IntersectionObserver`
— the listing returns up to 300 rows, and fetching every frame on mount would be
300 authenticated round trips and 300 decoded bitmaps held at once on a phone.
The JSON link became a button for the same reason the images changed.

`labeler/__tests__/gatedAssets.test.ts` pins the class rather than the instance:
no `src=`/`href=` in the labeler may name the gated route, and the URL helper
that invited it may not be re-declared.

### 2. The queue was empty because nothing was ever put in it

Rapid capture shipped **off by default**, with a reasoning that read well and
was wrong about which flow is the default one: *"a reader labelling as they go
still wants the editor, and losing that flow to a mode they did not ask for
would be worse than not having the mode."*

But the request that produced the queue was *"make it so that I can take a bunch
of photos one after another and they all end up in a persistent queue"* — the
behaviour, not a toggle for it. Shipped off, the observable result was the exact
inverse of the ask: every shutter opened the editor, every label went to the
corpus, and the Queue tab stayed empty because nothing had ever been enqueued.
The owner's own diagnosis — "seems like the queue is just saving to the harvest
view" — is precisely what was happening.

Default is now ON. The toggle stays, and reads `Rapid` / `One at a time` so the
mode is legible from the button rather than from having pressed it.

**The lesson worth keeping:** a default that inverts the requested behaviour is
not a conservative choice. Shipping a feature switched off is the same as not
shipping it, except that it also reports itself as done.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 709/709, 0
skipped (3 new); `deckpal-web build` clean. The 403 was reproduced against
production before the fix and the fix itself still wants a signed-in browser —
stated rather than implied this time.

