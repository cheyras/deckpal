# Security Policy

## Reporting a vulnerability

DeckPal is maintained by one person. If you find a security issue, please
report it privately:

- **Preferred:** [GitHub Security Advisory](https://github.com/cheyras/deckpal/security/advisories/new)
  on `cheyras/deckpal`.
- **Alternative:** Email cheyras@gmail.com with "DeckPal security" in the
  subject.

There is no bug bounty. I will respond on a best-effort basis -- typically
within a few days. Please do not open a public issue for security vulnerabilities.

## Security model

DeckPal has two deployment modes with different security models.

### Cloud deployment (Vercel + Supabase)

**Authentication:** Supabase Auth provides email + OAuth sign-in. The SPA
manages sessions via `@supabase/supabase-js`. API requests carry a Supabase
JWT as `Authorization: Bearer <token>`, verified by the API middleware.

Every read of that session goes through `apps/web/src/lib/authSession.ts`, which
puts a four-second deadline on it — `@supabase/auth-js` puts none on the token
refresh the read can trigger, and an unbounded one held the whole app on a blank
page (issue #75). **The deadline fails closed and is not an authorization
decision.** Past it the request goes out with NO `Authorization` header and takes
the server's 401, rather than being sent with a stale or assumed credential;
equally, a timeout is never treated as a sign-out, so a stalled network cannot
end a session or bounce a signed-in user to `/auth`. A build gate
(`apps/web/scripts/check-auth-deadlines.mjs`) keeps that single choke point
single.

**Post-auth redirect (`/auth?next=`, `/auth/reset?next=`).** Every gated entry
point (a locked nav row, an expired session, a deep link that required
sign-in) hands `/auth` a `next` value naming where to return once signed in.
`apps/web/src/lib/landingRoute.ts`'s `safeNextPath` is the one function that
judges a `next` value safe: it parses with `new URL(value, location.origin)`
and compares origins — the same algorithm the eventual navigation runs, so
the check and the navigation cannot disagree — after rejecting every control
and whitespace character and `\` up front (2026-09-26 fixed a bypass where a
tab character, `/\t/evil.example`, survived a hand-written prefix-check
blocklist, since the WHATWG URL parser's own tab-stripping turns it into a
cross-origin redirect after a real sign-in). It returns the parsed
`pathname + search + hash`, never the raw string, so nothing downstream can
diverge from what was validated.

**Authorization:** Row-Level Security (RLS) policies on every table. Catalog
data is world-readable. Per-user data (collection, decks, lists, battle logs)
is restricted to the owning user via `user_id = (SELECT auth.uid())`.

Supabase serves the `public` schema over PostgREST to anyone holding the anon
key, so RLS is only the answer if nothing routes around it. Three shapes did,
until migration 072 (security audit, 2026-09-26; DECISIONS.md):

- **Views run as their caller.** A view without `security_invoker = true` runs
  as its owner and skips RLS; one such view exposed every user's collection to
  the anon key from migration 020 until 072. Every view is now an invoker view,
  and `packages/db/src/__tests__/migrationLint.test.ts` refuses a new view
  created any other way.
- **Own-row policies do not restrict columns.** `user_profile` is writable by
  its owner only in the avatar columns the API writes, and an avatar object key
  can belong to one profile at a time, so nobody can point their profile at
  another user's photo and have the API delete it. A revoked `api_token` cannot
  be un-revoked, and its identity columns never change (a trigger, for every
  writer); client roles cannot delete token rows, so a revoked row cannot be
  deleted and its hash minted again.
- **Foreign-key checks ignore RLS.** A deck's cards, versions and battle logs,
  and a binder's placements, reference their parent by `(id, user_id)`, so a
  row can only hang off a parent its own owner owns.

The database integration suite (`apps/api/src/__integration__/reach.mjs`)
applies every migration with Supabase's default grants and asserts that the
anon role and a second signed-in user reach none of a user's rows in any table
or view in `public`.

**Server secret key:** `SUPABASE_SERVICE_ROLE_KEY` holds a Supabase `sb_secret_…`
key after rotation. It bypasses RLS and is used only server-side for Storage
and manifest access. Server requests send it on `apikey`, never as a Bearer
token. The old service-role JWT remains supported only during migration.

**Key handling rules:**
- The publishable key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, also
  `VITE_SUPABASE_ANON_KEY`) is safe to expose; RLS still governs data access.
- The server secret key must never appear in client-side code, browser
  `localStorage`, or git history.
- Vercel environment variables marked as server-side are not bundled into the
  SPA.

**Cloud MCP authentication.** `https://deckpal.app/mcp` accepts a personal
access token (`dsk_…`, table `api_token`) as `Authorization: Bearer <token>`.
Only a SHA-256 hash is stored; the raw value is shown once, at creation, in
Profile -> Agent access, and is revocable there at any time.

**No token in the URL (2026-09-28).** The endpoint also still accepts the token
as the URL's last path segment (`/mcp/dsk_…`), but only so connectors already
set up that way keep working; DeckPal no longer offers it anywhere. A request
path is written to the hosting provider's request logs, so a token placed there
ends up stored in those logs. The Agent access page now leads with OAuth
(paste the bare `https://deckpal.app/mcp`, sign in, approve) and offers a token
only as an `Authorization: Bearer` header; the MCP server's 401 names only those
two routes. Anyone with an old path-form connector can reconnect with OAuth and
revoke the old token.

As of 2026-08-10 a token can also be minted
automatically via a real OAuth 2.1 authorization server (dynamic client
registration, RFC 7591; authorization-code + PKCE S256, RFC 6749/7636;
discovery metadata, RFC 8414/9728) -- `apps/api/src/oauthServer.ts` and
`apps/api/src/routes/oauth.ts`. Every OAuth-registered client is public (no
secret is issued; PKCE is mandatory instead), `redirect_uri` is exact-matched
against what the client registered (rejected requests never redirect, closing
the open-redirect path), authorization codes are single-use with a ~5 minute
TTL, and the token the flow ultimately mints is the exact same `api_token`
row the manual flow produces -- OAuth is a bridge onto the existing
credential, not a second one. `oauth_client` and `oauth_code` have RLS
enabled with zero grants (migration 033): only the server's RLS-bypassing
pool connection or narrowly authorized SECURITY DEFINER consent functions can
access them; browsers receive no direct table grants.

**OAuth consent names the destination, and connections expire (migration 075,
security audit SEC-07).** Dynamic client registration is open, so
`client_name` is whatever a registrant typed: before 075 any site could
register as "Claude", and the consent screen led with that name in bold while
the host receiving the approval sat in a muted line below. Now:

- **Who is asking is decided by the redirect, on the server**
  (`classifyRedirect`, `packages/db/src/oauth.ts`). Only an exact, documented
  callback is **Verified** and named by us: `https://claude.ai/api/mcp/auth_callback`
  and its `claude.com` twin. Any other redirect is **Unverified**, headed by its
  host, with the registered name quoted as a claim; a loopback redirect (Claude
  Code and other local clients) is also Unverified, with the extra warning the
  MCP spec asks for, since any local program can listen there. Exact URLs, not
  hosts: a host match would badge a path that forwards the code elsewhere. The
  Profile row is named after the destination too (`Claude (OAuth ·
  evil.example)`), so a lookalike never sits in the list as plain "Claude".
- **A connection's secrets rotate and expire.** An approval is still one
  `api_token` row (listed, revoked and governed exactly as before), but its own
  hash is sealed and its working secrets live in `oauth_token`: a one-hour
  access token (`dsk_…`) and a single-use 90-day refresh token (`dsr_…`,
  never accepted as a bearer). Each refresh returns a new pair and moves the
  connection's `expires_at` 90 days out; unused for 90 days, it lapses. A used
  refresh token stays for a day as a tripwire: presented again within a minute
  it is refused (most likely the client racing its own renewal) and nothing
  else happens; later, the whole connection is revoked (OAuth 2.1 §4.3.1 reuse
  detection). One refresh token never yields two pairs, so the chain cannot
  fork into two that renew independently. Every access token resolves
  through its row, so revoke-all, suspension and Revoke end it with no race.
- **Read-only is a real scope.** The consent screen offers it only when
  `GET /oauth/client` includes the new server's `trust` field; an older API
  ignores scope and therefore gets a full-access choice alone. A `read`
  connection is served only the `readOnlyHint` tools, inside a `BEGIN READ
  ONLY` transaction, and the REST API refuses its every non-GET request with
  `403 insufficient_scope` before any route runs (`enforceTokenScope`). The one
  exception is `POST /massentry`, which only builds cart links and which the
  read tool `set_cart` uses.
- **Tokens reach what the consent screen says.** `/decke` (Deck-E
  conversations), `/me/showcase` and `/me/settings` now require a session, like
  `/tokens`, `/avatar` and billing.
- **Server-owned columns stay server-owned.** 075 takes table-level INSERT and
  UPDATE on `api_token` from client roles and grants back only what the app
  uses as the user (mint: `user_id, name, token_hash, prefix`; revoke and touch:
  `name, last_used_at, revoked_at`), so nobody can PATCH a read-only connection
  to full or push its expiry out over PostgREST. `oauth_token` has RLS and no
  client grant at all. Composes with 072 (PR #204), which freezes a token's
  identity and makes revocation final.
- **Backward compatibility.** Every token that existed before 075, hand-made or
  OAuth-minted (including live claude.ai connectors), keeps `expires_at NULL`
  and full scope and resolves exactly as before. Nothing forces a reconnect;
  reconnecting replaces an old connection with a renewing one. Hand-made tokens
  still never expire, because the URL-pasting clients they exist for cannot
  renew. Until 075 is applied, the code resolves tokens through their pre-075
  statements and refuses only new OAuth connections (503), never existing ones.

**Deck-E (the AI assistant, `POST /api/chat`).** Entitlement is decided on the
server, not the browser. `entitlement.ts`'s browser-side gate only decides
whether to draw a button — verified against the deployed endpoint before this
was fixed, an ordinary signed-in account got a full model turn, billed to the
owner's Gateway key, by asking for one (DECISIONS.md 2026-08-21, "`/api/chat`
had no server-side entitlement, rate limit or spend cap"). The route now
checks lifecycle-derived database `decke.use` permission and account status. Enabled
credit policy reserves an atomic debit/ledger/pricing snapshot before provider
work and refuses accounting failures; disabled credit policy retains the
existing daily counters for ordinary accounts. An explicit unlimited override
still requires current access and holds/budgets. Exact accepted-request replays are rejected rather
than granting free repeated work. The public health response reports
`administration` and `deckeEntitlement` readiness/status without account IDs.

**The conversation the browser sends is bounded before anything pays for it**
(SEC-04, 2026-09-26). The charge is flat per request while every step re-bills
the whole context, so `/api/chat` reads at most 256 KB, streamed, and validates
the history with zod before any ledger, credit accounting or model call: at
most 200 messages, `user`/`assistant` roles only, text and `tool-<name>` parts
only (no `file` part the provider would fetch, no `reasoning`/`source-*`, no
`system` message written by the browser), and no part over 60,000 characters.
Past a size limit the answer is 413; a wrong shape is 400. The model sees the
current turn whole (capped at 240,000 characters) plus the newest history that
fits 40 messages and 160,000 characters; recent finished tool outputs are
individually capped before replay. Ledgers derived from history still read all
of it. `route` and each
landmark string are clipped to 200 characters (`apps/api/src/decke/wireBounds.ts`).


**Import fixes (`POST /api/decks/import/fix`).** This separate read-only route
checks the same current `decke.use` permission on the server, charges the daily
turn meter before invoking the model, and uses the dedicated Deck-E Gateway key.
When paid credits are enabled, admission debits one whole-credit hold through
the existing ledger. Settlement uses the provider-reported fractional cost and
returns any unused hold in the same transaction as the usage record. Chat sees
the held balance, so it cannot spend the same last credit. A fix admitted before
account suspension can still settle, but suspension prevents new fixes.
If a settlement connection fails after admission, the API retries the
request-bound settlement. A wallet read releases an unsettled hold after a
15-minute grace period and records the provider cost as unknown; both paths
are idempotent.
It does not create a deck. The model may choose only keys from
catalogue candidates; a suggested replacement is returned only when the ordinary
import resolver lands on that exact catalogue card. The browser asks the reader
to confirm, then rechecks the edited list before the existing import write.
An incomplete 400-printing candidate page produces no suggestion.
The request's catalogue and collection reads use its RLS-scoped connection.
Admission commits and releases that connection before the model call; settlement
uses the same shared pool afterward, even if the browser disconnects. Narrow
server-only database functions enforce the daily
limit, account ownership, usage recording and idempotent fractional settlement. A direct
browser RPC cannot invoke them without the server's request claim.


Deck-E holds **no credential of his own**. He carries the caller's own
Supabase JWT — the same one the browser sent — and forwards it to deckpal-api
for every write, so Row-Level Security applies to him exactly as it does to
the person he is talking to, and there is no service-role key anywhere on this
path. His database reads run the same per-request RLS session shape as the
REST API and the MCP server (`BEGIN` + `set_config('request.jwt.claims', …)` +
`SET LOCAL role = 'authenticated'`), opened lazily per tool call and released
— destroyed, not pooled, on a timeout or an abort — the instant the call
returns, so a dropped connection can never be handed to the next request still
carrying a stranger's claims.

**All 25 tools reach the conversational model; the write half is held by the
SDK, not filtered out.** The adapter Deck-E uses
(`apps/api/src/decke/adapters/aisdk.ts`) still *defaults* to
`annotations.readOnlyHint` — never to the verb in a tool's name, because a name
can mislead in either direction (`set_cart` sounds like a write and only composes
an outbound URL; `deck_history` sounds like a read and can roll a deck back) —
and every write
declares `needsApproval`, so the turn pauses on the wire and the tool's `execute`
does not run until the reader answers. That is a mechanism rather than an
instruction — verified against the pinned `ai@7.0.66` at the wire level, and
signed, so a modified replay is rejected. What needs approval is derived from
annotations and schema: anything `destructiveHint` always, any real write always,
a preview never; when a call is classified as a preview the server writes
`dry_run: true` into the arguments explicitly rather than trusting the tool's
default, and only an explicit boolean `false` counts as permission to write.
This shared adapter policy remains the MCP contract; the narrow conversational
exception is `POST /api/chat`: its `log_cards` apply intent omits model-facing
`dry_run`, and after mandatory successful preflight the server forces
`dry_run: false` only with the SDK-signed approval. Read-only
`preview_card_changes` always forces `dry_run: true`; failed or unresolved plans
return evidence without writing. Existing human approval, replay, identity and
idempotency protections remain in force.
For an approved `log_cards` call, Deck-E derives the collection write's
idempotency key from the SDK tool-call ID and signed input after approval; the
collection endpoint scopes it to the authenticated user. Unsigned conversation
metadata is excluded. Replaying that same approval across a 15-minute boundary therefore
cannot apply the change twice; a new call can still record a new acquisition.
`ARCHITECTURE.md` §15e carries the protocol.

**The consent card can commit a corrected batch from the browser, and that is a
second write path carrying no new authority.** When the reader edits what the
card asked about — striking a row, picking a printing he did not know — the held
call's arguments are *not* touched, because the SDK signs over them. Instead the
corrected batch goes through `POST /collection/batch` from the browser under the
reader's own Supabase JWT, the same endpoint, the same RLS and the same
idempotency machinery the rip flow already uses; the held call is then settled as
a denial carrying the real response as its reason, so his account of the turn
stays true. The idempotency key is scoped to the held call rather than to
content, because a caller-supplied key is honoured unbucketed and unbounded and a
pure-content key would let the second identical correction return the first one's
response having written nothing. Nothing here is reachable without a session that
could already have made the same write from the collection UI.

**What he may point at, and the narrower set he may press.** Everything the
model can address is allowlisted: `uiTools.resolveTarget` resolves a selector
only if it lands inside a `[data-decke-landmark]`, navigation only within
`ROUTE_ALLOWLIST` — from which `/profile` is deliberately absent, in the
server's copy and the browser's mirror of it alike, because it mints API tokens.
Both copies accept a path only if URL resolution leaves it unchanged and refuse
encoded dots and separators, so a dot segment cannot walk an allowed prefix to
`/profile`, `/admin` or `/devtools` (SEC-12).
The `journey` tool takes landmark references rather than free CSS,
validated at parse time so a bad plan is refused whole before its first step. A
free selector would be a capability; the allowlist is what bounds it.

Pressing is a **second** authorisation on top of the landmark, because pointable
is not pressable: `data-decke-clickable`. It is on five files — the sidebar nav
rows, the series cards, the set rows, and two same-page disclosures — which
resolved to ten marked elements when the attribute was verified reaching a real
signed-in DOM at 1440 and 393, against two before this. The two it replaced were
both same-page accordions that navigate nowhere, which is why walking somebody to
a set by actually pressing things was previously impossible.
The runtime cannot inspect what a React `onClick`
does, so "a marked element never writes" is a property of the **marking
discipline**, not of any control. That discipline is enforced two ways. Each
marking carries its four-point finding inline next to the attribute, where a
reviewer reading the diff will see it: no write, destination on the route
allowlist, nothing touching auth or anything destructive, and genuine
navigation. And an audit test in
`character/host/__tests__/uiTools.test.ts` fails whenever a new file gains the
attribute, so an addition is a deliberate act with a reviewer attached.

That audit used to scan `routes/` non-recursively, which meant the single most
valuable element to mark — the sidebar nav in `components/AppShell.tsx` — was
the one marking the audit could not see; it now scans the whole of `src` and
records paths relative to it. Its detector used to match the attribute alone on
its own line, one of four ways to write the same marking, so the discipline could
be escaped by reformatting; it now strips comments, requires JSX attribute
position, and is itself pinned by fixtures covering both the spellings it must
catch and the mentions it must not. A second test reads `NAV` out of
`AppShell.tsx` and runs every destination through the real `routeAllowed`,
because that marking sits on `<Link to={item.to}>` inside a loop — a seventh
entry pointing at `/profile` would otherwise inherit it silently.

What is honestly *not* checked is stated in the test file rather than faked: no
static test asserts that a marked element never writes, because that property
depends on what a closure does transitively through hooks a node test cannot
evaluate, and every approximation either passes on a real write or fails on the
two audited disclosures. A test that cannot fail on the thing it names is worse
than no test.

**A failed tool never tells the model where the database is.** A `pg` error's
message is built from the connection parameters, so `password authentication
failed for user "deckpal"` and `connect ECONNREFUSED 10.1.2.3:5432` are what a
tool's catch sees precisely when the database is unreachable -- the moment every
tool fails at once and the model is most likely to be asked what went wrong.
That text is not a log line: it is a tool result, so it enters a model's context
and, on the MCP path, a third-party model provider's. Two controls stand there.
`safeToolError` (`apps/api/src/decke/adapters/aisdk.ts`) handles an error that
escapes a handler: it allowlists our own deliberate errors by class and reduces
everything else to `it failed with <code>`. `errText`
(`packages/agent-tools/src/shared.ts`) handles the far more common case, an
error a handler caught and formatted itself: a driver error becomes its
SQLSTATE, a statement timeout keeps its "narrow the query" hint, and the
fallback that carries our own readable messages is scrubbed of DSNs, IP
addresses, `host:port` pairs and `for user "…"`. Every one of the 24 tools
formats through it -- not only the ones whose file runs SQL, because whether a
given catch can reach the database is a call-graph question that was already
answered wrongly once (issue #94: `log_cards` resolves cards over SQL before its
write leaves the process, and printed the raw message). A source guard in
`packages/agent-tools/src/__tests__/toolErrors.test.ts` fails the build if a
tool source formats a caught error itself, and the same file runs the real
handlers against a database that throws to prove the result text stays clean.

**Model-written markdown renders under a URL and image allowlist.**
`lib/markdownSafety.ts` is shared by the chat transcript
(`character/host/chat/ChatMarkdownBody.tsx`) and the deck strategy view
(`routes/deck/MarkdownView.tsx`), which draws the guide Deck-E's own
`deck_strategy` tool writes over a context containing card text, deck
descriptions and list names — strings other people typed. Links are limited to
`http`, `https` and `mailto` plus relative, a stricter set than react-markdown's
default (which also permits `irc:` and `xmpp:`), with the protocol extracted by
colon position rather than by parsing so `java\nscript:` fails the allowlist
instead of being normalised through it. **No remote image is ever fetched** —
both surfaces map `img` to a text placeholder, so no URL the model produced
reaches a `src`. Real card art gets to the transcript through `CardRow`, which
resolves ids against our own catalog endpoint.

The image rule closed a live hole rather than hardening a hypothetical one:
`MarkdownView` had no `img` entry in its component map, so react-markdown's
default applied and `![](https://attacker.example/p.gif)` inside a strategy guide
was a real remote image firing on render, handing the reader's IP and referrer to
whoever got a string into the model's context. Both surfaces are pinned by tests
that render genuinely hostile input and assert the attacker's host does not
appear in the output, verified failable by removing the guard from one surface
and watching only that one go red. Raw HTML is never parsed on either surface —
`rehype-raw` is not used, so an `<img onerror=…>` becomes literal text — and
`skipHtml` is deliberately *not* set, because showing the reader what the model
actually wrote is honest and equally safe.

### Deck-E web research and deck checks

`web_research` sends its query to Perplexity and treats returned material as
untrusted data. Its source URLs are HTTPS-only and sent to the browser for
display only; they are never placed in the chat model's context, which receives
source hosts instead. Favicons are fetched from `icons.duckduckgo.com` under CSP
`img-src`; that request gives DuckDuckGo the source hostname and the viewer's IP
address.

`POST /decks/check` is read-only under the caller's RLS context and accepts only
bounded deck input. The live chat request's current turn is capped at 240,000
characters in addition to the SEC-04 history window.

The deck widget's Save is the reader's own click, not a model write, so it has no
approval card — which makes WHICH deck it writes over the thing to guard. When
`showDeck` names a `deck_id`, the server resolves it among the reader's own decks
with their token (RLS) before the widget may offer "Save as new version", and the
button names the stored deck, never a model-written label. That target (`base`) is
server-only: `showScreen`'s schema has no field for it and `sanitizeScreen` strips
it from any deck block. `POST /decks/save` checks ownership again (`404` for any
deck that is not the caller's), and the version save always lands as a new
version, so the list it replaced stays in the deck's history and can be reverted.

**Jev is a data processor under Vercel's zero-retention agreement with TypeSafe** (verified 2026-09-27).
With `DECKE_JEV=on`, each reader message is judged by `typesafe-ai/jev` (TypeSafe
AI, San Francisco) through the Vercel AI Gateway before Deck-E answers
(`apps/api/src/decke/reflex.ts`). What it receives: the reader's latest message
(clipped to 2,000 characters), Deck-E's previous reply (last 800) and the page
path — and, for the after-turn audit (`audit.ts`), the reply he just gave (last
2,000). No separate collection or account records, or photos, are attached, but
those text fields and the path are not redacted: a reader can include ownership
counts, card IDs or account details in their message, Deck-E can repeat them,
and a deck or list path can contain an ID. Every request
sets `zeroDataRetention: true` and pins the provider with `only: ["typesafe-ai"]`.
That pin matters: measured on 2026-09-26, the Gateway otherwise routes Jev to a
second host (DigitalOcean) first, and with the flag it skips that host as
ZDR-ineligible. **Through the Gateway, TypeSafe does not retain what it is sent.** Vercel's
AI Gateway ZDR page (https://vercel.com/docs/ai-gateway/security-and-compliance/zdr, updated
2026-09-22) lists TypeSafe AI as a ZDR provider on the Gateway under this agreement: "Except as
necessary to comply with its legal obligations, TypeSafe shall not retain (a) prompts that are
Customer Data for any longer than is necessary to generate Output for Customer and (b) Output for
any longer than necessary to enable TypeSafe to fulfil its obligations to Customer under the
Agreement." With `zeroDataRetention: true` the Gateway routes only to ZDR providers and FAILS the
request (`no_providers_available`) rather than falling back to one that retains, so the flag is
what makes this hold: never remove it. Two caveats. The Gateway's model list still shows
`zdr: "none"` for Jev (the per-provider agreement governs routing; the model field lags or
reflects other hosts). And per-request ZDR requires a Vercel Pro or Enterprise team; the
2026-09-26 measurement above shows the Gateway filtering Jev's hosts by ZDR on DeckPal's team.
TypeSafe's own direct-customer policy (ZDR for enterprise only) does not apply to Gateway traffic.
TypeSafe does not train on requests (`no_training: "all"`). The owner accepted Jev's data use on
2026-09-27 either way. Jev never approves anything and is not a
control: its vendor documents that text in its state can move its answers, so
its judgments only ever raise a consent card, hide a tool the reader cannot use,
add a refusal, or run one corrective step that can itself only raise a consent
card. A claimed list, deck or battle-log deletion gets an admission rather than
forcing an edit tool that cannot delete. Each failure is today's behaviour. Off
by default; `GET /health` reports `deckeJev`.
For corrective list, deck and battle-log calls, `dry_run: false` is inserted
into the parsed, signed tool input before the approval card is issued. The
write still executes only after that signed approval is replayed; ordinary
calls keep their preview default.

### Deck-E improvement chats (migration 078)

The improvement corpus is deliberately narrower than Deck-E History: no chat is
copied unless its reader explicitly shares that one conversation. The risks here
are unusually content-heavy: a name can appear in nested tool output; a reader's
collection can itself be identifying; a mistaken administrator role or token
capability could expose the corpus; telemetry can become an unbounded shadow
transcript; and a model that asks too often can turn a nominal choice into a bad
experience.

The controls are correspondingly at the collection boundary, not in the model
prompt. The database atomically permits `ask_to_share_chat` at most once per
conversation and only when the reader has left prompts enabled; every answer,
including decline and revoke, prevents another ask in that conversation.
Writers use HMAC pseudonyms derived with a database-held key, retain no raw
user/conversation/request IDs, and recursively redact account terms and raw
identifiers from text and JSON before a corpus write. The corpus tables have
RLS and `REVOKE ALL`; their security-definer reader functions require an active
administrator with `decke.improvement.read`. A token reader additionally needs
an explicitly admin-granted, live `decke_improvement_read` capability — it is
never silently added to a token or trusted from a caller claim.

Telemetry payloads are bounded and collection writes are rate-limited. The
daily `decke_improvement_purge_expired()` job removes corpus conversations after
180 days; stopping sharing removes that conversation's saved copy immediately.

This does not make shared chats anonymous. A reader can type identifying facts,
and an unusual collection or tool result can identify them despite redaction.
It also cannot protect against an authorised administrator or authorised agent
misusing information they are permitted to read, a compromised database-held
HMAC key, or copies an authorised reader makes outside DeckPal. Those are why
access is intentionally limited to administrators and tools they explicitly
authorise, rather than general staff or anonymous analytics.

**Server-side request forgery — where the server is allowed to fetch from.**
Two outbound paths were hardened on 2026-08-27 (GitHub issue #96, six critical
`js/request-forgery` code-scanning alerts):

- **Cold image fills.** `packages/storage/src/fetch-source.ts` fetches an asset's
  bytes from `image_asset.source_url` — a column written by importers and
  warmers, not by any user-facing endpoint. It previously accepted any URL and
  used `redirect: 'follow'`, which meant *the destination was never checked at
  all*: a `302` from an otherwise-trusted CDN to an internal or link-local
  address was followed cross-origin. That matters more here than for a typical
  fetcher, because this code runs in the image function (which holds
  `SUPABASE_SERVICE_ROLE_KEY`) and, on success, republishes the bytes to the
  PUBLIC `card-art` bucket at a derivable path. It now enforces an explicit
  upstream allow-list — `assets.tcgdex.net`, `raw.githubusercontent.com` and
  `images.pokemontcg.io` (approved card-art fallback, 2026-08-31),
  the only two hosts any code path can derive — with `redirect: 'manual'` and the
  host re-checked on **every hop**, plus a resolved-address check that refuses
  loopback, RFC1918, CGNAT and link-local answers (`169.254.169.254` included).
  Non-web schemes and URLs carrying embedded credentials are refused outright,
  as is an explicit port that is not the allow-listed one. The outgoing request
  is then **rebuilt from a constant origin selected by that hostname** rather
  than from the URL we were handed, so the scheme, host and port of the socket
  we open are never derived from the input; only the path survives, and it is
  checked after one decode against the same `[A-Za-z0-9.-]` id space
  `parseImagePath` allows.
  The pre-existing content checks (image content-type, magic-byte sniff,
  non-empty, under 8 MB) are unchanged and remain complementary: they catch a
  bad *body* from a good host, the allow-list catches a bad *host*.
  `packages/storage/src/upstream.ts` is the single definition; a refusal is
  reported like any other upstream miss, so it surfaces on the response's
  `X-Image-Reason` header and in `warm:cloud`'s residue file rather than
  failing silently.
- **Object keys at the Storage choke points.** `objectExists`, `headObject`,
  `uploadObject`, `moveObject`, `deleteObject` and `publicObjectUrl` address a
  fixed host (`SUPABASE_URL`), so the exposure was path injection rather than
  host redirection — but the key's allow-list lived in `parseImagePath`, in the
  caller, and the bulk paths (`storage:backfill`, `rekey:set`, the warmers) reach
  those functions with `relative_path` values read back out of Postgres.
  `assertSafeObjectPath` (`packages/storage/src/object-path.ts`) now runs at each
  of those functions, using the same segment allow-list the read path uses, and
  **throws** rather than answering "not found" — a dangerous key must not be
  mistaken for a cache miss. `encodeURI()` was never the boundary it looks like:
  it escapes neither `/` nor `%`.
- **The agent self-hop.** `packages/agent-tools/src/api.ts` built its URL as
  `base + path`, where `path` is assembled from model-supplied ids. It now
  resolves through `new URL()` against the configured base and verifies that the
  result keeps the same scheme, host and path prefix, and the tool call sites
  percent-encode the ids they interpolate. Host redirection was not reachable
  there; parameter injection into an already-authenticated internal call was.

**Known limits of the above.** The allow-list is enforced on the hostname and on
the addresses that name resolves to at check time; `fetch` resolves the name
again when it connects, so a determined DNS-rebinding attacker who already
controls DNS for one of the two allow-listed CDNs is narrowed but not excluded.
Closing that needs a connector that validates the socket's peer address, which is
a larger change and has not been made. Note also what the list does *not* do: it
never enumerates blocked hosts. A source that has been ruled out is denied by the
same default as any host nobody has considered, so adding an upstream is always a
deliberate act — a new entry plus a DECISIONS.md record of who approved it and on
what licensing basis.

**What the browser persists.** Besides Supabase's own session (its
`sb-<ref>-auth-token` key), the SPA writes its own `localStorage` key
`deckpal:skin` (the visual skin preference), which is not a credential and is
never read as one. Clearing site data resets it. Browsers that used DeckPal
before 2026-10-04 may still hold `deckpal.returning`, a one-bit routing hint
that sent a lapsed session from `/` to the sign-in form. It was removed when
`/` became the marketing page for every signed-out visitor; nothing reads it,
and it never held an email, user id or token.

**HTTP security headers on the SPA (2026-09-26).** The Supabase session above,
including its refresh token, lives in `localStorage` — the ordinary place for
a token-based SPA to keep it, but it means an XSS on `deckpal.app` would be a
persistent account takeover, not just a stolen session. `apps/api/src/index.ts`
puts `helmet()` in front of the Express API, but on Vercel the HTML document
itself is served by the **static layer**, which never touches Express or
helmet — so until this date it shipped no `Content-Security-Policy`,
`X-Frame-Options`, `X-Content-Type-Options` or `Referrer-Policy` at all
(DECISIONS.md 2026-09-26). `vercel.json`'s `headers` array now attaches, to
every path except `/api/*` (helmet already covers those):
- **`Content-Security-Policy`**, enforcing (not report-only — there is no
  `report-uri`/`report-to` collector in this app, so report-only mode would
  collect nothing and simply delay real protection). `default-src 'self'`,
  with narrow, purpose-scoped exceptions: `https://js.stripe.com` and
  `https://*.js.stripe.com` for Stripe.js scripts and payment frames,
  `https://hooks.stripe.com` for payment challenges, and
  `https://api.stripe.com` for payment requests. The Payment Element offers
  Link, so `frame-src` and `connect-src` also allow `https://link.com` and
  `https://*.link.com`, while `img-src` allows `https://*.link.com`.
  These are the hosts in [Stripe's CSP guide](https://docs.stripe.com/security/guide#content-security-policy)
  for the payment flow in `apps/web/src/components/billing/CardForm.tsx`.
  `https://*.supabase.co`/`wss://*.supabase.co` cover
  Storage/Realtime — a wildcard rather than one project's hostname, since any
  Vercel+Supabase fork (`DEPLOYMENT.md`) has its own project ref and should
  not have to edit this file to unblock its own images; `data:`/`blob:` for
  the scanner's captured frames, the bug reporter's `html2canvas-pro`
  screenshot, and card art; `'wasm-unsafe-eval'` for the scanner's
  onnxruntime-web engine. `frame-ancestors 'none'` closes the clickjacking gap
  (below) and `object-src 'none'`/`base-uri 'self'`/`form-action 'self'` are
  the standard hardening trio. `script-src` carries **no** `'unsafe-inline'`:
  the one inline script in `apps/web/index.html` (the first-paint watchdog,
  which must stay inline — a watchdog that needs a request of its own cannot
  cover a failure to fetch, exactly the #75 bug it exists to prevent) is
  allow-listed by its exact `sha256-` hash instead, recomputed from the live
  file and checked against `vercel.json` on every run by
  `scripts/check-security-headers.mjs`.
- **`X-Frame-Options: DENY`** and CSP's `frame-ancestors 'none'` together
  (belt-and-suspenders for older browsers): confirmed framing was previously
  possible — `/authorize` (the OAuth consent screen) and any page with a
  destructive control could be embedded in a hostile iframe. Third-party
  storage partitioning means a framed copy loads signed out, which is what
  kept this at medium severity rather than high.
- **`X-Content-Type-Options: nosniff`** and **`Referrer-Policy:
  strict-origin-when-cross-origin`**.
- **`Permissions-Policy`**: `geolocation=()` (unused, denied outright), but
  **`camera=(self)` and `microphone=(self)` stay allowed** — the scanner needs
  the camera today, and scanner voice annotation (shipping) needs the
  microphone. Locking these to `()` the way a generic hardening pass would is
  the wrong instinct here; `self` still excludes every third-party frame.

`scripts/check-security-headers.mjs` (wired into `test:security-headers` and
CI) asserts the header set exists with these properties — not by string
equality, but by parsing the live directives, so a future edit that quietly
drops `frame-ancestors` or lets the hash drift fails the same way
`scripts/check-redirects.mjs` catches a redirect regression.

The permission-gated `/dev/scan-harness` diagnostic route loads its HTML in a
separate same-origin iframe. Its shipped OpenCV build creates JavaScript
functions while loading, so only that iframe document permits `'unsafe-eval'`;
the surrounding app document retains the stricter policy even when reached
through client-side navigation. The service worker fetches the iframe document
from the network so its special header is preserved, and the browser check
starts OpenCV through the real Dev tools link.
Missing `/assets/` files are excluded from both Vercel's app-shell rewrite and
the service worker's navigation fallback. A nonexistent harness-shaped URL
therefore returns a missing-file response rather than the app under the
harness's looser policy.

**SEC-14, in the same change: private API responses are `no-store`, not
`no-cache`.** `apps/api/src/http.ts`'s `userCache()` (used by every
collection/decks/lists/dex/insights/avatar/export route) sent `private,
no-cache, must-revalidate`, which still permits a shared disk cache to keep a
revalidated copy around — on a shared device, a stale copy of one account's
collection JSON could sit on disk after that account signs out. It now sends
`private, no-store`, matching this document's own "all private APIs are
no-store" promise and the service worker's own
`NetworkOnly` route (`apps/web/src/sw.ts`), which already forces
`fetchOptions: { cache: 'no-store' }` for every non-catalog GET — this only
tightens the HTTP contract to match what the app already assumed. The PDF
export routes (`apps/api/src/export/router.ts`) carried the same stale
`no-cache` literal and are fixed the same way.

### Rate limiting (REST API)

Two layers of in-memory rate limiting were added to the REST API
(`apps/api/src/rateLimit.ts`, mounted in `createApp`):

**Pre-auth ingress guard (ordinary base-path API router).** A limiter runs on
the ordinary base-path API router (`/api` on Vercel, `/deckpal/api`
self-host) **before** `authMiddleware`/token resolution and **before** the RLS
`pool.connect()`, so even unauthenticated catalog reads are bounded — the RLS
middleware acquires a database connection for anonymous requests too, so a
Bearer-only guard would leave no-header floods unbounded. **600 requests/minute
per source IP per process.** On the real Vercel runtime
(`process.env.VERCEL === '1'`) a narrow resolver keys on the validated platform
`x-vercel-forwarded-for` (preferred) or `x-forwarded-for`; Vercel overwrites
these at ingress, so a client cannot spoof them. Outside Vercel, forwarding
headers are **ignored** and the raw socket peer is used. Express `trust proxy`
stays at its default **false** (not loopback), and no new production env
variable is required — the existing `VERCEL` is platform-provided, not user
input. The Stripe raw-body webhook is mounted separately on `app` ahead of
that router and is outside this guard, as is the bare-origin OAuth discovery /
`/register` / `/token` handlers — **which now carry their own limiter, below**
— and the MCP transport at `/mcp`, a separate function (`api/mcp.mjs`, **also
now its own limiter, below**).

**Per-user session routes.** `/tokens` (20/min), `/avatar` (10/min),
`/oauth` (30/min), `/bugs` (10/hour), all `/admin` (120/min) and all
`/me/credits` (180/min) are guarded after authentication/resolved self-host
identity and (for `/tokens`, `/avatar`, `/oauth`, `/admin`, `/me/credits`)
`requireSession`, before RLS acquires its request connection. Cloud
anonymous/PAT callers are rejected before their per-user budget. Self-host uses
its resolved local account. Authentication lookup and trusted bootstrap can
access their own pool earlier, so this is specifically an RLS-connection
boundary. Active-account and action/SQL permission checks still follow RLS.
`/bugs` does not require a browser session (a personal access token may file
a report; self-host's resolved local identity must too), only identity — see
"Bug/feature reports are keyed per account" below for why it moved off `req.ip`.

**The public OAuth "Connect" endpoints (SEC-09).** `/register`, `/token` and
the two `/.well-known/oauth-*` discovery documents are mounted at the bare
origin, ahead of the base-path router above, so none of its limiters ever ran
for them — `POST /register` in particular was an unauthenticated
`oauth_client` INSERT with **no rate limit anywhere upstream of it**. Each of
the four now carries its own `oauthPublicRateLimit`
(`apps/api/src/rateLimit.ts`), **30 requests/minute per source IP**, checked
before the host allowlist and before any body is read. It is keyed the same
way the ingress guard is (validated platform IP on Vercel, raw socket peer on
self-host) because none of these four requests carries a credential yet —
there is nothing else to key on — and it uses a distinct store prefix
(`oauth-public`) from the ingress guard's `preauth`, so the two budgets never
fight over one shared counter for the same IP.

**MCP (SEC-09).** `/mcp` (`apps/mcp/src/cloud.ts`) now carries two limiters,
for two different threats:

1. A **global pre-resolution counter**, 300 requests/minute per instance,
   checked before `resolveToken`'s database lookup, so a flood of
   unresolvable tokens never reaches the pool. It is deliberately ONE shared
   counter, not one per credential: an unauthenticated caller can mint
   unlimited distinct credential strings for free, and a per-credential check
   at this stage — the first version of this fix — let a flood of 10,000
   fabricated Bearer values fill the bounded map's admission capacity,
   rejecting even a brand-new, never-before-seen credential for a full
   sweep window afterward (reproduced and fixed before this shipped). A
   global counter has no per-key capacity to exhaust.
2. A **per-token budget**, 60 requests/minute, checked only after
   `resolveToken` succeeds, keyed on the resolved `tokenId` rather than the
   raw credential string. This is the fairness guarantee: no single
   legitimate token can crowd out another token's share. Keying on `tokenId`
   (a database-verified uuid) rather than the raw string is what makes a
   bounded map safe here — an attacker cannot mint many `tokenId`s for free
   the way it can vary a Bearer header, since each one costs a real account
   plus `/register`'s and `/token`'s own rate limits and `MAX_ACTIVE_TOKENS`.

A request with no credential at all is already the cheapest path in that
handler (an immediate 401, no DB) and is metered by neither layer.

**Why the credential, not the IP, for the per-token layer.** Every other
limiter in this file keys on the caller's IP because that is the identity
available before authentication. `/mcp`'s fairness layer is the one place
that reasoning breaks: claude.ai (and every other hosted MCP connector) makes
its calls from that provider's own shared egress IPs, common to every one of
that provider's users. An IP-keyed limit there would let one heavy user on a
shared connector exhaust the bucket for every other user behind the same
egress IP — silencing a stranger's MCP access because of a heavy neighbor,
the exact class of bug SEC-11 fixes for `/bugs` below, one hop upstream.

**Bug/feature reports are keyed per account, not per source IP (SEC-11).**
`routes/bugs.ts` used to run its own hand-rolled 10/hour bucket keyed on
`req.ip`, bypassing the shared `resolveClientKey` helper every other limiter
in this file uses. Behind a reverse proxy (self-host, `trust proxy` false)
that is always the same loopback peer — one shared bucket for the whole
deployment — and on Vercel it read the raw, unvalidated `req.ip` rather than
the platform-checked forwarding header. Either way, one signed-in user filing
(or scripting) 10 reports silenced the reporter for every other user sharing
that bucket. The route already requires identity by the time it runs, so it
is keyed on `req.user.id` now (`bugsRateLimit`, same shape as `/tokens` and
`/avatar`), giving each account its own 10/hour budget regardless of IP.

Ingress, admin and wallet use genuine `express-rate-limit` 8.7.0 middleware
with `BoundedExpressStore` over the existing store. All adapters share its
10,000-key cap with distinct prefixes; admission at capacity fails without
evicting an active key. Store errors fail closed. No skip rules, response-based
counter refunds or validation suppression are configured. Budget exhaustion returns
429 with Retry-After seconds and Cache-Control: no-store. Each request consumes
each applicable budget once, so nested credit routes do not double-charge
administration. Token/avatar/OAuth guards retain their existing implementation.

**What these budgets are — and are not.** All application budgets are bounded
in-memory fixed windows, **per process / per serverless function instance**,
reset on restart or cold start. Bounded key capacity (`MAX_KEYS`) and amortised
expiry avoid memory growth and per-rejection full-map scans. The guard stops
retry storms and casual abuse; it does **not** protect from distributed or
network flooding, and reverse-proxy / platform controls remain the deployment
boundary. Never claim distributed-quota protection.

⚠️ Same shape as the billing limiter below: per-process means each serverless
instance keeps its own budget, so a caller spread across instances gets a
multiple of the limit. The budgets are speed bumps, not boundaries.

**MCP scope.** The MCP transport at `/mcp` (separate `api/mcp.mjs` function)
is **not** covered by the 600/min guard — it is a different function entirely
— but it is no longer uncovered: it carries its own two-layer limiter (see
above). The MCP token/OAuth **management** endpoints (`/tokens`,
`/oauth`, `/avatar`) are REST routes on the base-path router and use these
REST controls. Existing MCP-specific security details are unchanged.

### Body-size limits (REST API), per route (SEC-08)

Until this fix, ONE `express.json({limit:'12mb'})` sat on `app`, ahead of
*every* route — including `preAuthFloodGuard`, `authMiddleware` and the
bare-origin OAuth routes — sized only for the bug reporter's screenshot. Every
other route paid the same 12 MB ceiling before anything unauthenticated was
even throttled, and a handful of concurrent oversized bodies could push the
serverless function toward its memory limit: an internal audit measured
roughly **22×** JSON-to-heap amplification (4.5 MB of JSON body retained
~100 MB of heap; 12 MB retained ~268 MB). It also
made `/register`'s and `/token`'s own 16 KB parsers dead code:
`express.json()` no-ops on a request whose body a *prior* matching parser
already consumed (checked via body-parser's own `req._body` flag), so
whichever parser for a given path ran **first** decided its limit — and the
blanket 12 MB parser on `app` always ran first for every path.

**The fix is per-route parsers, most-specific first**, mounted on the ordinary
base-path router (`createApp` in `apps/api/src/index.ts`) immediately after
`preAuthFloodGuard` — ahead of `authMiddleware`, the per-user rate limits and
the RLS connection acquisition, since none of them are needed to bound a
body's size — so a flood is throttled, and an oversized body rejected, before
either a byte is read or a pooled connection is claimed. The identity-free
`/client-errors` handler also sits here, after its own parser and the default
parser, so its crash report is available as `req.body` before any database
work. Every character-count cap this repo already had (`MAX_TEXT`,
`STRATEGY_MAX`, `RAW_LOG_MAX`, …) is a
JS string length — UTF-16 **code units**, not the UTF-8 **bytes** a limit
here actually measures — and `/decke`, `/lists` and `/decks` are reachable
over the plain REST API (a personal access token, an MCP client, a script),
not only this repo's own browser client, so the limit has to hold for
whatever a caller's OWN JSON encoder does, not just this repo's. A raw-UTF-8
client (this repo's browser code, `JSON.stringify`) costs up to 3 bytes per
BMP code unit outside Latin-1 (CJK, Hangul, Cyrillic — most of the world's
scripts). An ASCII-safe-escaping client — Python's `json.dumps` defaults to
`ensure_ascii=True`, and it is a common default elsewhere too — costs **6**:
`\uXXXX` is 6 ASCII bytes for what was 1 code unit. Two review passes each
caught a version of this: the first sized the table below at ×3 and omitted
`/decks` entirely; the second found ×3 itself insufficient once measured
against an actual ASCII-escaped body (a supported 50,000-character `rawLog`,
`json.dumps`-encoded, is 300,013 bytes). Every number below is now the ×6
worst case.

| Route | Limit | Why |
|---|---|---|
| `/bugs` | 12 MB | The screenshot dataURL. `MAX_IMG_BYTES` is 8 MB decoded; base64 costs +33%, so a full-size screenshot is ~10.7 MB on the wire before the JSON wrapper and the 20 KB text fields (×6 for escaped multibyte text is still negligible against the image). |
| `/client-errors` | 32 KB | The crash beacon sends route, message, stack and build id. Even if all four fields reach their logged lengths and each character is ASCII-escaped, the JSON stays under 32 KB. This limit runs before the unauthenticated logging handler and its 20/minute/IP limiter. |
| `/dev/scan-queue` | 4200 KB | The labeler queue photo. `MAX_PHOTO_BYTES` (3 MB decoded) divides evenly by 3, so its base64 form is EXACTLY 4 MB on the wire — leaving no room for the `{"jpg":…,"name":…,"source":…}` wrapper around it. A bare 4 MB parser 413'd a real max-size upload (caught in review); 4200 KB leaves ~104 KB of headroom. Base64 is pure ASCII with no characters JSON needs to escape further, so neither multibyte ratio above applies. Owner-only in production. |
| `/dev/scan-flags` | 4200 KB | The scan-harness flag capture: `pngBytes + metaJson` combined, decoded, capped at 3 MB — same exact-boundary arithmetic as `/dev/scan-queue` above when nearly the whole budget is the base64 PNG. Owner-only in production. |
| `/decke` | 2 MB | One Deck-E transcript-history turn (`routes/deckeHistory.ts`): two 24,000-char text fields plus up to 60 tool records, each up to ~2,000 chars. At the ×6 worst case that's ~1 MB before JSON structure; 2 MB leaves real headroom. This is the transcript-history endpoint, **not** the live chat stream — Deck-E's chat (`api/chat.mjs`) is a separate Vercel function with its own body handling, unaffected by any of this and untouched here. |
| `/lists` | 2 MB | `POST /:id/items/bulk` allows 500 items, each with its own 500-char note — at ×6 that's ~1.43 MB before structure. 2 MB leaves headroom without reopening the ceiling for every other `/lists` route. |
| `/decks` | 512 KB | `PUT /:id/strategy` (`STRATEGY_MAX` 40,000 chars) and `POST /:id/logs` / `/log-preview` (`RAW_LOG_MAX` 50,000 chars) are the two biggest single-field caps outside the routes above — at ×6 the larger is ~293 KB (matches the 300,013-byte reproduction above almost exactly), already over the 100 KB default. |
| everything else | **100 KB** | Every other route posts small JSON (ids, filters, short text) with nothing near the caps above, even at ×6. |

`/register` and `/token` keep their own existing 16 KB parsers
(`apps/api/src/oauthServer.ts`) — unchanged code, now actually effective, for
the reason above: nothing on `app` reads their body first any more.

Oversized bodies are surfaced as a proper `413 payload_too_large` JSON error
(`apps/api/src/http.ts`'s `errorMiddleware`), not the generic `500` a bare
body-parser error used to produce — the same translation `scan/router.ts`
already did by hand for its own raw-body parser, now done once for every
`express.json()`-guarded route.

**Verified:** `apps/api/src/__tests__/bodyLimits.test.ts` sends real HTTP
requests at each boundary (just under / just over each limit) and asserts the
413/200 split, including a real multibyte case (a full-length Japanese
strategy guide and battle log against `/decks`, and a full-length Japanese
transcript turn against `/decke`) in BOTH raw-UTF-8 and ASCII-escaped
serialization, a real base64-encoded max-size photo
(`Buffer.alloc(3*1024*1024).toString('base64')`, not an ASCII approximation)
against `/dev/scan-queue` and `/dev/scan-flags`, a normal `/client-errors`
beacon whose fields appear in the log and an oversized one rejected before
logging, and a regression control that reproduces the shadowing bug on
purpose by reversing the mount order —
proving the ordering above is load-bearing, not cosmetic.
`apps/api/src/__tests__/rateLimit.test.ts` separately asserts the exact mount
order in `index.ts`'s own source, including that the whole block now
precedes `authMiddleware`.

### Self-host images rate limiting

`apps/images` stays bound to `127.0.0.1`. **Health is 60 requests/min before
the `cacheStats` DB work**, and the four sprite/set/card asset routes share a
generous **3000/min budget before filesystem/DB work**. Identity is the socket
peer; behind the ordinary loopback proxy these are coarse shared
**process/peer** budgets, **not** per-end-user quotas. Existing cache headers,
placeholders, path guards and provenance behaviour stay unchanged; no asset
writes, migrations or nginx changes happened.

### Content-type sniffing

`sniffContentType` (`packages/storage/src/sniff.ts`, shared by both image
tiers) returns `application/octet-stream` for malformed non-byte input types.
Genuine `Buffer`/`Uint8Array` including nonzero-`byteOffset` views are
supported. Object, string and array values are rejected via
`util.types.isUint8Array`, which checks the internal `[[TypedArrayName]]` slot.
The in-app bug reporter's screenshot upload (`apps/api/src/routes/bugs.ts`)
uses the same sniffer, for the same reason: see "Bug-report privacy" below.

### Bug-report privacy (2026-09-26)

The in-app bug/feature-request reporter (`apps/web/src/components/BugReport.tsx`,
`apps/api/src/routes/bugs.ts`) files a labeled **public** GitHub issue in cloud
mode (see AGENTS.md B10). Three things are enforced so that publishing a
report cannot publish more than the reporter chose to:

- **Disclosure before Submit.** The modal states, before the report is sent,
  whether the description, page path, screen size and browser will be posted
  publicly on GitHub (all four are in the issue body; the last two were missing
  from this sentence until 2026-09-27),
  using the API's actual issue setting. It explains that any screenshot is
  saved separately, and lets the reporter exclude it with a checkbox. This did not exist
  before 2026-09-26 — the reporter was told a screenshot would be "attached,"
  never that it would be public.
- **No screenshot at all on a sensitive page.** `isSensitiveBugPage` (mirrored
  in both files, same shape as the `isAllowedRoute`/`routeAllowed` pair for
  Deck-E navigation) refuses to capture, or to store one sent anyway, for any
  `/admin`, `/profile` or `/credits` page, including mixed-case and encoded URLs the router
  accepts. Those can show account details that
  are not the reporter's to publish — most acutely, `/admin/users` renders
  other signed-in users' email addresses. The server-side check is a
  backstop, not a formality: it runs regardless of what the client sends, so
  a stale bundle or a hand-built request cannot bypass it.
- **No link to the screenshot in the public issue, ever.** Until 2026-09-26,
  a saved screenshot got a Supabase Storage **signed URL valid for one year**,
  posted directly in the issue body — readable by anyone who found the issue,
  for that whole year, no sign-in required. The issue body now says only that
  a screenshot was saved privately (never a URL); the project owner reaches
  the bytes through Supabase Storage or the private `bug_report` row, by
  Report-ID. See the SEC-06 entry in `decisions/2026/` for why this shape was chosen over a
  short-lived signed URL, and for the disposition of the pre-existing public
  issues that carried the old year-long links.

The reported page path is also stripped of its query string and fragment
(client and server, independently) before it is stored or published — a
search box or a `?next=` parameter can carry something identifying that the
page path itself never would. The screenshot's declared content type is never
trusted: `decodeScreenshot` sniffs the actual bytes (see "Content-type
sniffing" above) and rejects anything that isn't a real PNG, JPEG, or WebP,
the same rule the avatar upload path already enforced.

### Scanner and labeler captures are private (2026-09-28)

The quad labeler's photos and labels, the scan harness's "Flag frame"
captures, the product scanner's capture/lock/identity reports, their JSON and
comment sidecars (`dev-flags/`) and the labeler's pending photos
(`dev-queue/`) are photographs taken in the owner's house. Until 2026-09-28
they were stored in the **public** `card-art` bucket — the catalog-art CDN —
under millisecond-timestamp names. The `/dev/scan-flags` and `/dev/scan-queue`
routes were gated, but the objects were not: anyone who guessed a timestamp
could fetch a photo straight from Supabase with no sign-in.

They now live in a **private** bucket, `dev-captures`
(`packages/storage/src/capture-store.ts`):

- **Every read, list, write and delete carries the server's service key**, on
  Storage's authenticated object route. Nothing in the API or the web app can
  build a public URL for a capture, and the tests pin that
  (`apps/api/src/dev/__tests__/privateCaptures.test.ts`,
  `apps/web/src/scan/labeler/__tests__/captureMigration.test.ts`).
- **The bytes reach a browser only through the labeler gate**
  (`labelerOnlyInProduction`, `scanner.label`), as `Cache-Control: private,
  no-store` responses fetched with the bearer token — never by URL, never
  cacheable by a shared cache.
- **The bucket creates itself, private.** The API creates `dev-captures` with
  `public: false` the first time it needs it (an idempotent Storage-API call
  with the service key; no migration, no dashboard step). If a bucket with
  that name already exists and is public, the API refuses to store anything in
  it and says so, rather than recreating the leak.
- **The legacy public copies are moved, not copied.**
  `POST /dev/scan-queue/migrate-captures` (labeler-gated; the labeler and
  harvest pages call it in the background until it reports `done`) copies each
  object to the private bucket create-only, reads the copy back and compares
  length and SHA-256, and only then deletes the public object. A public object
  is never deleted without a verified private copy; an object whose key is
  already taken privately by different bytes is kept under
  `legacy-conflicts/` instead of overwriting either. The handle it uses on
  `card-art` can only read, list and delete keys under `dev-flags/` and
  `dev-queue/` — it cannot write, and it cannot address catalog art.

Until a public copy has been moved it stays reachable at its old public URL,
exactly as before this change; nothing about the move widens access. See the
`decisions/2026/` entry "Scanner and labeler captures move to a private bucket".

### Migration CLI error safety

The migration CLI (`packages/db/src/cliErrors.ts`) replaces open-ended error
stringification with a **closed set** of fixed diagnostics keyed on an
explicit pg/system error-code allowlist. It never includes `err.message`,
`err.stack`, `err.detail` or `String(err)` — a `pg` message is built from
connection parameters and can carry the full DSN with credentials. It avoids
getters, `toString` and any coercion: `safeReadCode` reads the `code`
descriptor as a data property only, and the `getOwnPropertyDescriptor` call
it makes **can** trigger a hostile Proxy trap during descriptor inspection —
those trap exceptions are caught and discarded (never logged or stringified),
returning a fixed diagnostic. Dictionary membership is guarded as own-only.
Unknown code strings are never echoed: a code like `TOPSECRET` would
leak through a regex redactor, which is why a redactor (or an uppercase-code
regex) is insufficient — a redactor can only scrub shapes it enumerates, and a
hostile `code` property is a value, not a pattern.

### Dependency advisories

Addressed via version floors and within-major `pnpm` overrides (resolved
versions in `pnpm-lock.yaml`): `sharp >= 0.35.4` (`sharp@0.35.4`), `hono >= 4.13.5`
(`hono@4.13.7`), `qs >= 6.16.0` (`qs@6.16.0`), `fast-uri >= 3.1.6`
(`fast-uri@3.1.7`). `hono` is explicit in `apps/mcp/package.json` because
optional peer resolution otherwise retained the vulnerable version. The
existing Dependabot batch plus the `sharp` and `github-script` updates are
consolidated into this changeset. `actions/github-script` v7→v9 is an Actions
**major** upgrade, not a minor update. Permissions/approval logic is unchanged.

### Self-host deployment

**Browser content policy:** The API's Helmet policy permits same-origin and
`blob:` workers so the quad labeler can decode HEIC photos, and permits
same-origin, `data:`, and `blob:` images so private photo previews display.
`script-src` remains same-origin only; the HEIC decoder's CSP build does not
need JavaScript evaluation. A reverse proxy that replaces the API's
`Content-Security-Policy` header must preserve these two narrowly scoped
allowances or HEIC repair and photo previews will fail.

**Authentication:** The API has no built-in authentication. It is designed to
sit behind a reverse proxy that handles auth (e.g., nginx + an SSO gateway, Caddy
with SSO, or any auth-capable proxy). **Never expose the API directly to the
internet** without a proxy -- doing so makes your entire collection readable
and writable by anyone.

**The MCP server** (`apps/mcp`) authenticates requests via the `x-brain-key`
HTTP header, validated against the `DECKPAL_MCP_KEY` environment variable.
Allowed client hosts are configured via `MCP_ALLOWED_HOSTS`.

### Network binding (self-host)

Self-host deployments should bind all services to `127.0.0.1`. The reverse
proxy is the sole ingress point.

### Deployment checklist (self-host)

1. Place a reverse proxy with authentication in front of the API.
2. Keep all services bound to `127.0.0.1`.
3. Set `DECKPAL_MCP_KEY` to a strong random value if you use the MCP server.
4. Set `MCP_ALLOWED_HOSTS` to only the hosts that should reach the MCP server.
5. Never commit `.env` or other files containing credentials.

## Payments

DeckPal's hosted tier asks each account what it would like to pay per month and
accepts **$0** as a real answer. Nothing in the product is gated on the number:
there is no entitlement column and no locked feature, which is worth stating in
a security document because it means a forged "I am a supporter" claim would buy
an attacker nothing at all.

### The money routes are rate-limited, and honest about what that buys

`/me/billing` is behind `billingRateLimit` (`routes/billing.ts`): 40 requests a
minute, keyed on the **authenticated account** rather than the IP, because every
route there requires a session and IP is both wrong on shared networks and
useless behind serverless egress. Flagged by CodeQL (`js/missing-rate-limiting`,
high) on a router that authorises and moves money.

⚠️ It is a speed bump, not a boundary. The counters are per-process, so each
serverless instance keeps its own and a determined caller spread across
instances gets a multiple of the limit. What makes repetition SAFE is elsewhere
and unchanged: an idempotency key on every charge, a per-account advisory lock
on the money routes, migration 062's daily ceiling on experiment writes, and
Stripe's own limits. What the limiter stops is a broken client or a retry storm
becoming a wall of Stripe customers before anyone notices. It fails **open**: a
false positive would refuse a payment somebody is trying to make.

### Payment history is an ownership-checked provider read

`GET /me/billing/history` accepts only a validated `support|credits` selector and a bounded signed cursor. It derives the customer pointer from the authenticated actor’s rows, treats that pointer as untrusted, retrieves the Stripe customer, and requires exact `metadata.deckpal_user_id` ownership and the configured live/test mode before every customer-filtered charge list. Cursors bind actor, kind, and a hash of the current customer generation; they expose no customer id and cannot cross accounts or history types. Responses are `private, no-store`; the identity-change cache reset removes browser history queries. The support pointer comes from a parameterized SELECT under request RLS, so an absent row stays absent rather than invoking the shared row-creation path.

The adapter exposes only customer retrieval and customer-scoped charge listing. It never calls customer recovery/creation, payment mutation, webhooks, invoices, or accounting writes. Returned fields are allowlisted, settled amounts use `amount_captured`, refunds cannot exceed captured money, provider errors are generic, and receipt links require credential-free HTTPS on exactly `pay.stripe.com`. Each of the two Stripe calls is independently capped at 4 seconds with zero network retries; middleware continues to own the pooled request connection through response cleanup, as required by B2. Missing pointers are explicitly scoped empty current-account results; foreign/deleted customers and provider outages fail rather than claiming no payments. Coverage is not a permanent ledger: payments attached to older replaced/deleted customers may be absent.

### No card data reaches this system, and none could be stored

The card number, expiry and CVC are typed into **Stripe's own cross-origin
iframe** (the Payment Element, served from `js.stripe.com`). They are entered
into Stripe's document, not DeckPal's: no React state in this app ever holds a
digit of a card, no request to this API ever carries one, and there is no column
in `billing_account` (migration 053) that could hold one. What DeckPal receives
and caches is the display summary Stripe hands back for a saved instrument —
brand, last four digits, expiry month and year — and nothing else.

That is what keeps this deployment within PCI SAQ-A. It is a property of the
code rather than a promise: self-hosting Stripe.js would break the iframe origin
and is therefore forbidden, not merely discouraged.

Stripe.js is fetched only when a payment surface calls `loadStripe`:
`lib/billing.ts` imports `@stripe/stripe-js/pure`. Until 2026-09-26 it imported
the package's main entry, which injects the script as a side effect of being
imported, so every page load, signed out or not, fetched Stripe.js and opened
Stripe's `m.stripe.network` fraud-signals frame (PERF-01).

### The webhook's signature is its only authentication, and there is no fallback

`POST /api/stripe/webhook` is unauthenticated by necessity — Stripe holds no
session. The `Stripe-Signature` check is therefore the entire access control on
the endpoint that decides which accounts are recorded as paying. If
`STRIPE_WEBHOOK_SECRET` is unset the route answers **503 and processes nothing**;
it never falls back to trusting the body, which would make "mark yourself a
supporter" a public endpoint.

The route is mounted on the bare Express app ahead of the JSON parser (the
signature covers the exact bytes sent) and outside the RLS middleware (a Stripe
delivery has no identity to resolve).

### The Stripe customer id is a capability, and the database treats it as one

`billing_account.stripe_customer_id` is a pointer into Stripe. If an account
could write it, it could point its own row at somebody else's customer — the
row-ownership check would still pass, it is still their own row — and then read
back that stranger's card summary or start a subscription billed to their card.

Supabase exposes PostgREST to anyone holding the anon key, and the anon key is
in the SPA bundle by design, so "only the API writes this" is not something the
API can decide. Migration 054 makes it the database's decision instead:

- **RLS:** `SELECT` on your own row. No INSERT, UPDATE or DELETE policy.
- **Privileges:** `REVOKE ALL — GRANT SELECT`, because Supabase's bootstrap
  grants `authenticated` write privileges on new public tables by default. A
  write then fails loudly with `42501` rather than quietly affecting zero rows,
  and keeps failing even if a future migration adds a permissive policy.
- **Writes go through six `SECURITY DEFINER` functions** —
  `billing_touch_visit`, `billing_ack_prompt`, `billing_apply_stripe` (054),
  `billing_record_ab_event` (056), `billing_ensure_row` and
  `billing_release_customer` (059/060) — which derive the row from
  `auth.uid()` and never from an argument, each writing only the columns its
  name describes. There is no user id to forge.
- **The webhook verifies ownership with Stripe, and that is the control that
  closes the disclosure.** Before writing, `syncCustomer` retrieves the Stripe
  customer and checks its own `metadata.deckpal_user_id` names the account it is
  about to update; every API route does the same through `ensureCustomer`. The
  hole it closes: `billing_apply_stripe` is reachable from the browser over
  PostgREST with the anon key the SPA ships, the webhook used to resolve an
  account from `stripe_customer_id` alone, and customer ids are not secrets —
  so planting a stranger's `cus_—` in your own row would have synced their card
  brand, last four, expiry and subscription state onto it.
- **`stripe_customer_id` is write-once at the database level** (059), as depth
  behind that check rather than as a second independent lock. It may be set
  while NULL and re-asserted to the same value; a direct repoint is refused.
  ⚠️ Read that precisely: 060 permits releasing it to NULL, and release-then-set
  is two permitted calls that together reach any customer id no other row is
  currently holding. What the pin actually buys is that a repoint cannot happen
  silently or by accident — it takes a deliberate two-step, the row's card
  summary is wiped in between, and the server logs it (`customerFor`). Earlier
  headers in 059 and 060 described the two halves as independent, such that
  either alone would hold. That was wrong, and the ownership check above is
  load-bearing on its own.
- **The write-once pin permits the FIRST write to any value.** There is no
  ownership check at write time — the RPC cannot ask Stripe — so an account
  whose `stripe_customer_id` is still NULL can plant an arbitrary `cus_—`. The
  disclosure stays closed, because the webhook and every route verify the
  customer's metadata names the row owner before reading anything from it. What
  remains is a nuisance: the column is UNIQUE, so squatting an id that another
  account will LATER legitimately store turns that account's billing requests
  into unique-violation errors until an operator clears the row. It needs
  knowing a live customer id before its owner's row records it — a window
  measured in the seconds between `ensureCustomer` and `applyStripe` — and
  recovery is one UPDATE. Accepted, and named so it is diagnosable rather than
  mysterious.
- **`billing_release_customer` can be called by the account it belongs to**
  (060), and deliberately carries no "not while you are subscribed" check. Such
  a check would read the row's CACHED subscription status to decide, and the one
  time it matters is when that cache is wrong — which is the state that sent
  this feature into a 502 loop once already (DECISIONS §6). Detaching your own
  row from your own paying subscription is self-harm with no reach into anybody
  else's data: the subscription keeps charging at Stripe, the app shows $0, and
  re-subscribing bills a second time. Accepted, and named here rather than
  patched with a constraint that would recreate a real outage to prevent a
  self-inflicted one.
- **Those functions are reachable over PostgREST**, because `authenticated` must
  be able to execute them and the anon key is in the SPA by design. The inputs
  are therefore constrained in the FUNCTION, not in the route: the experiment
  arm is read from the caller's own row rather than accepted as a parameter, and
  the function refuses an `amount_cents` outside `0≤50000` (the product's own
  ceiling), an unrecognised event kind, and more than 200 events from one
  account in a day. Those live in **062**, not 058: 058 introduced the first two
  and 062 drops its function outright and re-creates them alongside the ceiling
  and the dedupe key, so a change to the cap belongs in 062. A caller can still
  write a plausible event about themselves; they cannot forge an arm, an amount
  the API would reject, or anybody else's row.
- **Defence in depth in the API:** a stored customer id is only used when the
  Stripe customer's own `metadata.deckpal_user_id` names this account.

`billing_event` (the webhook's replay ledger) has RLS enabled, no policy, and no
grant to either role.

### What the browser may send

An amount, and a `setupIntentId` on the one leg where a card was just entered —
that id being verified to belong to this account's customer, and to have
succeeded, before it is used. One more object reference, checked the same way:
a `paymentIntentId` on `/one-time/confirm`, verified to belong to this account's
customer AND to carry the metadata marking it a one-off this flow created.

And an `attemptId`, which is NOT an object reference and gets no ownership check
— correctly, because there is nothing at Stripe to check it against. It is a
client-generated opaque string constrained to `[A-Za-z0-9_-]{8,64}` because it
goes into a Stripe idempotency key, which is what makes a retried gift one
charge rather than two. Its only power is over the caller's own retries.

Customer ids, subscription ids, prices, payment-method ids and statuses are all
resolved server-side and never accepted from a request. `/refresh` accepts an
`amountCents` and deliberately ignores it: the recorded figure is what Stripe
says the subscription bills.

It also sends three analytics values: the prompt `kind`, validated against
`onboarding|checkin|payment_issue`; a `context`, checked against the four
surfaces the analysis knows and replaced with `settings` otherwise — and not
read at all on the two prompt endpoints, where the exposure is filed under its
validated `kind`; and a `dismissed` boolean on `/prompt-ack` that decides which
of the two exposure outcomes is written. The `forced-` prefix marking test
traffic is the server's to write: a client sending one is honoured only in
Stripe test mode.

⚠️ The `context` was free text until round forty-six, and that was not the
harmless field it looks like. Every CTE of the analysis filters `context IN
('onboarding','checkin')`, so an unrecognised string removed the account from
the denominator and a client-written `forced-` removed its answer from the
numerator — either one moved a level twenty-account cohort by 25% when
executed. None of them touches money, and all three remain inside the accepted
limit below: an account can still write a plausible event about itself through
the RPC directly, which is why the validation is hygiene rather than a
boundary. The experiment ARM is the one field that would make the measurement
forgeable, and it is deliberately not among them: `billing_record_ab_event`
reads it from the caller's own row.

`routes/billing.ts`'s module header and API.md carry the same inventory; if you
change one, change all three.

### A testing override that switches itself off

`?prompt=onboarding|checkin|payment_issue` forces the support prompt open, so a
surface designed to be hard to see twice can be tested at all. It works **only
while `stripeMode` is `test`**, which is read server-side off the secret key's
own prefix — so it stops working the moment live keys are configured, rather
than relying on anyone remembering to remove it. It can force a modal; it cannot
charge anything, and events recorded under it carry a `forced-` context so they
are excluded from the experiment.

### Logging

Stripe error objects can carry a payment method and a customer. In
`stripeFailure` — the funnel every route's Stripe call passes through, and the
only one that can see a decline — the API logs the error **type** and the
Stripe **request id**, and nothing else from them: a decline's message is the
reader's own copy and does not belong in a server log.

Writers outside that funnel do log a Stripe message: the webhook's
processing failure, the webhook's signature-verification failure (the message
alone, never the body or the signature — it is what tells a wrong secret from a
replay), and the three lines in the duplicate-subscription refund sweep. Their
calls are reads, cancels and refunds — never a confirm or a charge, which is
where a decline can arise — so the messages are of the "No such customer" kind.
The sweep in particular is the one place where a silent failure means money kept
by mistake. It DOES log the message of an error that is not Stripe's,
because the same funnel catches our own throws and reducing "no payment method
on file for a one-time charge" to `type: unknown` hid the wiring failure it
exists to expose. Keys are never logged, and `/health` reports only which of four configuration states the
deployment is in (`configured` / `partial` / `unset` / `self-host`) plus the
mode read off the key's prefix.

## The privacy page (2026-09-27)

`/privacy` (`apps/web/src/routes/Privacy.tsx`) tells readers what deckpal.app
collects and names every outside service that receives it. Its claims are read
from the code, so **a change to where data goes is a change to that page, in the
same PR**. The triggers:

- a new or different Deck-E model or provider (`apps/api/src/decke/models.ts`),
  or a change to which requests set `zeroDataRetention` (today only Jev's);
- a new origin in the CSP (`vercel.json`). The page's "no third-party analytics
  or tracking scripts" rests on that allow-list being DeckPal, Supabase and
  Stripe (with Stripe's Link);
- a new field in the public bug-report issue (`formatIssueBody`);
- anything new sent to Stripe (`billing/service.ts`, `credits/payments.ts`);
- a new third-party service, email sender, or scheduled job that reads user data.

Facts that are legal or business decisions (operator, contact address,
retention periods, age limit, applicable law) are drawn on the page as
"To decide" markers until the maintainer supplies them. The processor list and
the file behind each entry are in
`decisions/2026/2026-09-27-privacy-page-and-its-processor-list.md`.

## Data retention: deleted lists and decks

Since 2026-08-19 (migration 038), deleting a list or a deck is **reversible and
therefore not immediate erasure**. The row is marked `deleted_at`, disappears
from every read, and is **kept indefinitely** until the owner purges it.

There is no automatic sweeper. That is a deliberate choice over an unenforced
"we keep it 30 days", which would read as *gone soon* while the rows sat there
forever — but it means a user who deletes something and expects it destroyed has
to say so:

- **Web:** *Recently deleted* on the Lists and Decks pages → **Delete forever**.
- **REST:** `DELETE /lists/:id?purge=true`, `DELETE /decks/:id?purge=true`.
- **MCP:** `delete_list(purge: true)`, `delete_deck(purge: true)`.

A purge is a real `DELETE` and cascades exactly as the old behaviour did — for a
deck that means its version history and every battle log. It is the one path in
the API with no undo, and it is the only one.

**Account deletion is unaffected.** Every one of these tables cascades from
`app_user`, so removing a user still removes their soft-deleted rows.

## Scanner voice: where speech goes

Voice commands in the scanner (an opt-in beta, `scanner_voice`) use the browser's
own Web Speech API. The browser vendor does the recognition. Safari sends speech
to Apple, and iOS says so in its own permission prompt. Chrome sends it to
Google. DeckPal's code never sends, logs or stores audio or transcripts. A
transcript exists only in page memory, long enough to be matched against a
fixed command grammar. It is not attached to scan telemetry, bug reports or any
request. The bug reporter excludes the live caption, pending voice chips,
screen-reader announcement and Verify warnings from its screenshot, including
recent and ignored speech. Its report text comes only from what the reporter
types. The explainer shown before the first browser prompt tells the reader
the same thing. The microphone is only on while the reader has the Voice
control on during the scan step. Hiding the page, leaving the scan step or
leaving the route stops it.

## The mutation log

Migration 036 records every change made through DeckPal — collection quantities,
lists, decks, strategy guides — with a `before` and an `after` snapshot. Two
properties are load-bearing:

- **It is per-user and RLS-enforced.** `mutation_batch` and `mutation_event`
  carry `user_id`, and migration 037 gives them own-row policies matching
  `collection_event`'s. Verified against a Supabase-shaped database under the
  real `authenticated` role: a second user sees none of another's rows and
  cannot insert one on their behalf.
- **It is append-only, including for its own owner.** `mutation_event` has
  SELECT and INSERT policies and no UPDATE policy, because RLS policies are not
  column-scoped and Supabase exposes every policied table through the Data API —
  an UPDATE policy would let a user rewrite their own `before`/`after` through
  PostgREST. An audit trail the audited party can edit is not an audit trail.
  "Was this reverted?" is therefore the presence of a later event pointing at
  it, not a mutable flag.

The snapshots contain card ids, quantities, list/deck names and strategy-guide
text — the same user data as the tables they describe, and no more.

## Administration, ownership, consent and credits (2026-09-15)

Every account has one canonical role. Tier ceilings, immutable built-in identity
and the current target role constrain mutations under the governance lock.
Admin can assign User/Superuser only to current built-in User/Superuser targets;
Superadmin cannot alter Owner or assign Owner. Role definitions are
Superadmin/Owner operations; editable permissions never grant reserved governance.
Protected Owner membership is seeded from trusted bootstrap state and is
independent of mutable email/JWT profile data. Last-active-Owner protection is
checked in SQL. A read-only old-reader facade does not create a second authority.

Contributor has no administrative APIs or other-user/global financial controls.
Contributor retains ordinary own-account profile, subscriptions and credit wallet
through an active browser session. PAT/OAuth tokens cannot administer, inspect
wallets, purchase credits or change sharing; no new administrative agent tools
exist. Dev tools is a separate capability-filtered browser surface.

A central SQL resolver derives Scanner/Deck-E access from lifecycle and personal
opt-in. Raw permission grants and preview hostnames cannot bypass it. Disabled
blocks new requests/provider attempts, including retries/nested work, for Owner
too; already-started remote work may finish. Suspension remains application
access control, separate from an Auth ban, and affects new requests, token/MCP
resolution and restrictive owned-data policy. Revoke-all also consumes OAuth
codes and coordinates with mint/exchange; reactivation does not revive them.

Only Owner may mutate user unlimited/nullable-markup revisions. Unlimited
reserves zero credits explicitly without synthetic grants and retains debt,
refund/dispute holds, access and operational budgets. New reservations cannot
select revoked policy; legitimate reserved and bounded nested work use frozen
snapshots. Flat quoted charges, idempotent pre-start refunds/recovery,
nonnegative spendable balances, debt repayment and Stripe reconciliation
remain unchanged. No automatic token-cost settlement exists.

Server usage accepts a durable request before invocation and writes distinct
local provider-attempt rows. It stores allowlisted cost/token/build/status fields,
never raw prompts, responses, tool arguments/output, hidden context or raw errors
in general telemetry. Reported decimal zero is distinct from missing/unknown;
upstream retries unreported by Gateway cannot be reconstructed.

The first credit start and provider-attempt row commit atomically after current
authority and payment holds are checked under the relevant locks. The SDK call
sets a synchronous invocation latch. A known cancellation or lost database
acknowledgement before that call retains an exact-operation compensation path;
it cannot refund completed/failed invocations or an earlier real retry attempt.

Optional content is stored separately from metadata. Sharing defaults off;
the first accepted exchange leg fixes consent epoch. Every administrative detail
and conversation read requires active target, current enabled consent and that
same epoch. Off deletes optional excerpts; off-on cannot resurrect old content.
Active users can withdraw after losing Deck-E access or when it is disabled.
Only the current user message and visible assistant response qualify. Personal
history may retain the user's own tool records but is never the source of
administrative cost/build authority. Exact owned accepted correlation is checked
before a supplied exchange is linked; immutable duplicate writes cannot rewrite
the generation stamp. Deleting own history also removes its administrative
excerpts, preserving metadata.

Usage reads require an active application session, tier 40 or higher and current
`admin.access`. Custom roles lose metadata and shared-content access immediately
when that permission is removed; the capability projection uses the same rule.
Contributor is denied. Lists, aggregates, observation filters and errors contain no shared text.
All private APIs are no-store. Identity/consent changes clear sensitive browser
queries; open detail uses zero cache lifetime, refetches on focus/every 10 seconds,
and hides stale content while refetching or unavailable. Previously seen/copied
text cannot be recalled. Service-worker private/authorized requests remain
NetworkOnly; existing anonymous catalog/art/shell cache boundaries remain.

Creation ACLs close new objects before numbered migration commits; web roles
receive only named checked functions. The normal runner commits each file
independently, so a failed migration rolls back that file, not earlier committed
files. Preserve shipped checksums and finish the reviewed sequence. An old-reader
view is compatibility for reading, not permission to restore multi-role writes.
No schema-wide grants or credential/configuration shortcuts are part of recovery.

The shared admin limiter remains120requests/60seconds and the wallet 180/60,
per user/API instance; 429 includes Retry-After. Database checkout limits remain.
Signed financial events validate current identity, amount, currency, mode,
refund and dispute state before unique settlement. Protected delivery queries
may match the correct HTTPS origin/exact webhook path without appearing in
readiness output. Configuration discovery is not proof of real delivery.
