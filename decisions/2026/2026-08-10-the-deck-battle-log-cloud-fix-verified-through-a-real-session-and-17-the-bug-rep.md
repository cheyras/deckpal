---
date: "2026-08-10"
title: "The deck/battle-log cloud fix, verified through a real session; and #17: the bug reporter's screenshot had three independent breaks"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["decks","frontend"]
supersedes: []
---
## 2026-08-10 — The deck/battle-log cloud fix, verified through a real session; and #17: the bug reporter's screenshot had three independent breaks

**Decided by:** Claude Opus 5 on behalf of @cheyras

### Part 1 — proving the 020 `user_id` fix in the cloud

The previous entry landed `recordDeckChange` supplying `deck_version.user_id` and the
battle-log insert supplying `battle_log.user_id`, but nothing had ever exercised those
writers against the cloud database through a real authenticated session. A throwaway
confirmed user was created with the Supabase Auth admin API and driven through the
deployed app in Chromium: create deck → add cards → log a battle → edit the list →
read the version history → revert. Zero 500s, zero console errors, zero HTTP ≥ 400
across the whole session. Postgres confirms the rows and, on every one of them, a
populated `user_id` — `deck` 2/2, `deck_card` 5/5, `deck_version` 3/3, `battle_log` 1/1.
The auto-bump rule behaves as specified end to end: the battle log attached to v1, the
next card edit bumped to v2 and inserted a fresh snapshot, and the revert — because v2
had no battle logs of its own — amended v2 in place rather than opening a v3, which is
the documented semantics and not a bug. The throwaway user was then deleted; the
`app_user.id → auth.users.id` FK cascade removed every row.

**Implication:** the write path is now evidenced, not merely reasoned about. The
`user_id`-on-every-row check above is the cheap regression probe for the whole class —
a NOT NULL column added by a migration and backfilled, with no writer updated, is
invisible until someone writes a row.

### Part 2 — issue #17: three independent defects, none of them the server

The in-app reporter promised "a screenshot of this page … attached automatically" and
had been shipping issues that read *"Screenshot omitted — not available or storage not
configured."* Storage was configured and blameless: the `bug-reports` bucket exists,
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in production, and `bugs.ts`
never got any bytes to upload. All three faults are client-side, stacked: each one is
only visible once the one before it is fixed.

**1. html2canvas 1.4.1 cannot parse `oklab()`.** Reproduced by re-running the app's own
capture call against the app's own chunk in the deployed page:
`Error: Attempting to parse an unsupported color function "oklab"`. The library's last
release predates CSS Color 4; Tailwind 4 compiles every `/opacity` utility to
`color-mix(in oklab, …)`, which the browser serialises as `oklab(…)` at computed-value
time, so the walk throws on essentially the first styled element. Fixed by moving to
`html2canvas-pro` (2.3.3, MIT, maintained fork, API-compatible, parses
oklab/oklch/lab/lch/color()). The lazily-loaded chunk grows 150 KB → 246 KB minified;
it is still fetched only when someone opens the reporter.

**2. Card art taints the canvas, so `toDataURL()` throws after a successful render.**
With the colour parse fixed, the render completes and then dies on
`SecurityError: Tainted canvases may not be exported`. Card art is requested from the
same-origin path `/deckpal/images/…`, which on cloud **302-redirects to Supabase
Storage on another origin**. html2canvas decides whether to send `crossOrigin` from the
*URL* (`useCORS && !isSameOrigin`), sees a same-origin URL, and loads it with no CORS
request — so the bytes that arrive are cross-origin and unclean. Setting `crossorigin`
on the app's own `<img>` tags would not have helped: html2canvas builds its own `Image`
objects. Fixed in the `onclone` hook, which replaces every image in the *cloned*
document with a `data:` URL before the render walk — inline images are same-origin by
definition and cannot taint. The fetch is an ordinary CORS request, which the redirect
target answers with `access-control-allow-origin: *`; self-host serves the bytes
directly and is equally fine. Anything that fails to inline is blanked rather than left
in place, because a single tainted image fails the entire export.

**3. The CORS read has to happen on a URL the page has not already used.** With the
inlining in place the first end-to-end filing produced a real screenshot with two grey
holes where the deck covers should have been. An `<img>` fetches in `no-cors` mode, so
by the time the reporter opens, every card URL already has a browser-cache entry that is
not CORS-clean — and a later `cors` request for that same URL fails outright. Measured
on the deployed app: plain `fetch`, `cache: 'reload'` and `cache: 'no-store'` all throw
`TypeError: Failed to fetch`; only a distinct URL succeeds. The read therefore goes
through `?bugshot=1` — a fixed marker rather than a random nonce, so the CORS copy is
itself cacheable and a second report costs nothing, and so `sw.ts` can recognise these
reads, decline them, and let them reach the network instead of answering from an opaque
cache entry (which reads as zero bytes) or filling the 2000-entry LRU image cache with a
duplicate per card. Both image tiers already ignore unknown query parameters — the cloud
handler scans for `p=` and falls back to the pathname, self-host matches on the Express
path — so the marker needed no server change.

**Also changed:** the capture's `catch` now logs. A silent `catch {}` is why #17 could
only be reported as "no longer works" — the actual error existed in the browser and
nobody could see it. And the encode is now size-bounded (quality ladder, then a
half-scale re-encode) so a 4K viewport cannot produce a body that trips Vercel's 4.5 MB
request ceiling and lose the whole report rather than just the picture.

**Verified**, not asserted: a report filed from the deployed app as a throwaway user
produced issue #23, whose `![screenshot](…)` signed URL returns a real 1440×950 JPEG of
the deck list *including the card art*, with the matching `bug_report` row carrying the
issue number privately and no reporter identity anywhere in the public issue. Repeated
at a 390px mobile viewport (the original report came from a 428px iPhone): preview
renders, no console errors. One known cosmetic gap remains and is not worth chasing —
the brand wordmark uses `background-clip: text`, which html2canvas has never supported,
so it comes out blank in the shot.

**Implications:** any future canvas-based feature (share cards, deck images) hits the
same taint the moment it draws card art — inline first, or give the images a genuinely
cross-origin URL so `useCORS` engages. A rendering library pinned to a pre-CSS-Color-4
release is a live liability in a Tailwind 4 codebase: computed colours are now `oklab()`
by default. And the general shape of this bug is worth remembering: a `catch {}` around
a best-effort feature converts three stacked defects into one unactionable sentence in a
bug report. Log the error even when you swallow it.

---

