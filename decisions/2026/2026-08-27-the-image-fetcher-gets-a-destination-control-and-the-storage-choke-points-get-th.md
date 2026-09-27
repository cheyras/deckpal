---
date: "2026-08-27"
title: "The image fetcher gets a destination control, and the Storage choke points get their own key check"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["images"]
supersedes: []
---
## 2026-08-27 — The image fetcher gets a destination control, and the Storage choke points get their own key check
**Decided by:** Claude Opus 5 on behalf of @cheyras

**Problem.** Six `js/request-forgery` code-scanning alerts had been open and
untriaged since 2026-08-14, all rated critical (GitHub issue #96). They are not
one finding and they did not deserve one answer.

1. `packages/storage/src/fetch-source.ts` — `fetchSourceBytes` took an arbitrary
   URL with `redirect: 'follow'` and **no host check at all**. Its argument is
   either a documented derivation of the requested path (safe) or
   `image_asset.source_url` read out of Postgres, which is authoritative and
   always wins. Not anonymously exploitable today — no user-facing endpoint
   writes that column — but `redirect: 'follow'` means a *hostile or compromised
   upstream is sufficient*, with no database write: a `302` from
   `assets.tcgdex.net` to a link-local address was followed cross-origin. And the
   blast radius is unusually bad for an image fetcher: this runs in the image
   function, which holds `SUPABASE_SERVICE_ROLE_KEY`, and on success the bytes are
   republished to the **public** `card-art` bucket at a derivable path. The
   existing content checks (image content-type, magic-byte sniff, non-empty,
   under 8 MB) narrow that to an image-shaped oracle, but they are a *content*
   filter standing in for a *destination* control and were written to catch
   TCGdex soft-404s, not to be a security boundary.
2. `packages/storage/src/object-store.ts` — the URL's host is
   `process.env.SUPABASE_URL`, never attacker-controlled, so this is path
   injection into a fixed host. The key allow-list is genuinely strict but lives
   in `parseImagePath`, i.e. in the CALLER, and `objectExists`/`uploadObject`/
   `moveObject` are exported and also reached by `storage:backfill`, `rekey:set`
   and the warmers with `relative_path` values read back out of the database.
   "The key is always allow-listed" was a convention across call sites, not an
   invariant of the functions — which is also why the analyser could not see it.
3. `packages/agent-tools/src/api.ts` — `const url = base + path`, where `path` is
   assembled at tool call sites from model-supplied ids. Host redirection is not
   reachable (a `path` starting `https://` yields a malformed URL, not a hostname
   swap); parameter injection into an already-authenticated internal call is.

**Decision.**

- **An explicit upstream allow-list, re-checked on every redirect hop.**
  `packages/storage/src/upstream.ts` holds it: `assets.tcgdex.net` (card art, and
  set logos/symbols via `card_set.logo_url`/`symbol_url`, which the catalog
  import copies out of TCGdex's own JSON) and `raw.githubusercontent.com`
  (sprites, pinned to `SPRITES_SHA`). Enforced with `redirect: 'manual'` and our
  own hop loop, capped at 5, with relative `Location` headers resolved against
  the current URL. **One `AbortSignal.timeout` covers the whole chain**, so the
  caller's budget means what it meant when undici was following the hops.
- **Destination beats name, too.** The resolved addresses are checked against
  loopback, RFC1918, CGNAT, link-local (`169.254.169.254`), the documentation and
  benchmark ranges, multicast and reserved space, for both IPv4 and IPv6 —
  including the mapped / NAT64 / 6to4 shapes that smuggle an IPv4 address inside
  an IPv6 one. Non-web schemes and URLs carrying embedded credentials are refused.
- **`assertSafeObjectPath` at every exported Storage function that takes a key**
  (`packages/storage/src/object-path.ts`), using the *same* segment regex
  `parseImagePath` uses. It **throws**: `objectExists` and `headObject` both wrap
  their fetch in `catch → miss`, so a guard inside that try would turn "this key
  is dangerous" into "the object is not there" and a bulk run would count it as
  work skipped. `moveObject` checks both addresses.
- **`resolveApiUrl` for the self-hop** — `new URL()` against the configured base,
  then an assertion that the result kept the same scheme, host and path prefix
  (so a `..` cannot re-point the call), plus `encodeURIComponent` on every id the
  tool call sites interpolate.

**Why the allow-list does NOT include `assets.pkmn.gg`.** `warm:pkmn` recorded
about 58 `image_asset` rows against that host on 2026-08-10 (this file, "issue
#24: the mep art gap"), and pkmn.gg was ruled out as a source on legal grounds on
2026-08-26 — `apps/images/src/warmFromPkmn.ts` is retired and says it "must not
be reintroduced as a fallback". The rows were never purged. Adding the host to a
freshly written allow-list would be affirmatively re-blessing a source the owner
rejected, so it is left out, and leaving it out is what now *enforces* that
ruling in code rather than in a comment. The cost is bounded and known: those
objects are already in the bucket and still serve as a `HIT`, so nothing changes
for a reader; only a **refill** of one of them would newly answer the placeholder,
with the reason `host 'assets.pkmn.gg' is not an allow-listed image upstream`
visible on `X-Image-Reason` and in `warm:cloud`'s residue file. If the maintainer
wants those refills back it is one line in `IMAGE_SOURCE_HOSTS` plus an entry
here. This is flagged rather than decided quietly because it is the one part of
this change that alters behaviour beyond the security boundary.

**Why no new environment variable.** The allow-list is a code constant, not
configuration. Making it settable would hand an operator — or anything that can
write the environment — a supported way to switch the control off, which is the
opposite of what it is for. Nothing in `DEPLOYMENT.md`'s environment table
changes, so B11 has nothing to declare.

**What was checked before any of it was written**, because the issue's triage was
a starting point and not evidence: every writer of `image_asset.source_url` and
of `card_set.logo_url`/`symbol_url` was traced to see which hosts can actually
reach the fetcher. `fetchSourceBytesWithExtensionFallback` has exactly one caller
(`apps/api/src/images/handler.ts`), and the other upstreams in the repo
(`tcgcsv.com`, `downloads.s3.cardmarket.com`, `mpgateway.tcgplayer.com`,
`api.github.com`, `ai-gateway.vercel.sh`) sit on entirely separate fetch paths
and are unaffected. Nothing in the repo records `assets.tcgdex.net` issuing a
redirect for an asset URL — what it does instead is answer `200 text/html`, or
move the asset to a sibling extension — so the hop loop is headroom rather than a
requirement, and the extension ladder is untouched.

**Verified.** Full local CI-equivalent green: typecheck across all nine
workspaces, every pure suite, `scripts/check-functions.mjs`, and every build. The
new suites are 60 assertions across
`packages/storage/src/__tests__/{fetch-source,object-path,object-store-guard,upstream}.test.ts`
plus `packages/agent-tools/src/__tests__/api-url.test.ts`; against the pre-fix
sources 49 of the 60 storage assertions fail and the agent-tools suite does not
even import. The redirect case is proved against two real loopback HTTP servers,
one of them addressed under a hostname that is *not* on the allow-list, with a
hit counter asserted to stay at zero — a test that only checked the initial URL
would have passed while the bug was still there.

**Implications.**
- A stored `source_url` on any host other than the two allow-listed ones will no
  longer refill. That is the intended behaviour; it is also the first thing to
  look at if a set of images starts serving placeholders.
- `assertSafeObjectPath` uses the same regex as `SEGMENT` in `paths.ts`, so it can
  only refuse keys the read path already refuses — including the two genuinely
  unrepresentable cards `exu-!` and `exu-?` recorded in the 2026-08-26 entry. A
  bulk run that trips it now fails loudly instead of quietly skipping.
- **CodeQL is the actual acceptance test and it cannot be run locally.** The
  alerts re-evaluate when the workflow runs on the PR. Per B9 no alert was
  dismissed in the UI; that is the maintainer's call, and it should only be
  needed if an alert survives the fix.

### Addendum, same day — the analyser saw five of six, and the sixth said something true

The first push of this change closed alerts #37, #60, #39, #56 and #57 (CodeQL
run on PR #123: those five gone from `refs/pull/123/merge`), and re-raised the
`fetch-source.ts` finding as **#63** at the new `fetch()` inside the hop loop.
That is not a false positive worth arguing with: the check *decided* on the URL
but then handed the caller back the URL it had been given, so the host of the
outgoing request was still, literally, a value derived from the input.

Fixed by taking the rule's own advice — *"pick the hostname from an allow-list
instead of constructing it directly from user input"*. `originFor(host)` returns
a **constant** origin per allow-listed host, and `checkUpstreamUrl` rebuilds the
request URL from that constant plus the path. The scheme, host and port of the
socket we open now come from a `switch` over string literals; only the path
survives from the input, and it is validated after one `decodeURIComponent`
against the same `[A-Za-z0-9.-]` id space `parseImagePath` uses — checking the
decoded form because `URL` percent-encodes anything unusual, so a class that
allowed `%` would let `%00` and `%20` straight back in. An explicit port that is
not the allow-listed origin's is refused rather than silently rewritten, and a
plaintext `http://` URL to one of the two hosts is upgraded rather than refused,
because both are HTTPS-only CDNs that would answer with a redirect to exactly
that origin anyway.

Worth writing down as the general lesson: **a validator that returns the value it
validated has not narrowed anything a reader — or an analyser — can rely on.**
Returning a value built from the allow-list is a different and stronger claim
than returning the caller's value with a blessing attached.

**Confirmed.** CodeQL on PR #123 after that second push: `No new alerts in code
changed by this pull request`, and `refs/pull/123/merge` carries **zero open
code-scanning alerts of any kind** — #36, #37, #39, #56, #57, #60 and the
transient #63 all read `fixed`. Nothing was dismissed; the acceptance criterion
("zero open `js/request-forgery` alerts") is met by code. `main` still shows the
original six until this merges, which is how the diff-based check works.
---

