---
date: "2026-08-20"
title: "A lazy route that is not precached breaks on every deploy"
decided_by: "reported live (\"Failed to fetch dynamically imported module\")"
areas: ["operations"]
supersedes: []
---
## 2026-08-20 — A lazy route that is not precached breaks on every deploy
**Decided by:** reported live ("Failed to fetch dynamically imported module")
immediately after the Deck-E framing pass shipped.
**Decision:** a failed dynamic import recovers by pulling the newest service
worker forward and reloading once, rather than dead-ending on an error screen.

**The chain, and every link of it is deliberate.** Navigations are served the
PRECACHED `index.html` — `sw.ts` binds them to it with
`createHandlerBoundToURL`, which is what makes the app work offline. An old
service worker therefore keeps serving an old shell until the user accepts the
update toast (`registerType: 'prompt'`), and that is fine, because every chunk
that shell can ask for is precached beside it and the pair is self-consistent.

Except one. `vite.config.ts` excludes `assets/Decke-*.js` from the precache
manifest, for a good reason recorded there: it is ~945 kB of three.js for a route
exactly one account can open, and precaching is eager. So that chunk alone is
always fetched from the NETWORK — by a shell that may be a deploy old, naming a
content hash the server no longer has. `Decke-DqREFuSk.js` 404s the moment
`Decke-WQw2MpqT.js` replaces it.

It is not a bug in the exclusion; the exclusion is right. It is the other half of
it, which was never written. And it recurs on EVERY deploy, for the one person
who uses that route — which is why it surfaced within minutes of shipping.

**The recovery** is in `lib/lazyRoute.ts`, and it wraps both lazy routes rather
than just the one, because the next route to be excluded will have the same
problem. On a module-fetch failure it calls `activateLatest()` — check the server
for a new `sw.js`, skip the wait, wait for the controller to change — and then
reloads once, so the fresh shell asks for a hash that exists. Verified locally
against a real deploy-shaped rebuild: the controller changes in 53 ms and the
reload lands on the new chunk. If no new worker comes forward, it UNREGISTERS
instead, because reloading into the same stale worker would spend the one retry
on a certainty; `registerPwa` puts the worker back on the next load, so the cost
is one cold cache rather than a lost offline mode.

Guarded by a session flag, so a genuinely broken chunk surfaces as an error
rather than a reload loop, and gated on a service worker actually being in
control — in dev there is none, and a failed import there is a real error that
should be seen.

