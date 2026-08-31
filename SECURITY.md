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

**Authorization:** Row-Level Security (RLS) policies on every table. Catalog
data is world-readable. Per-user data (collection, decks, lists, battle logs)
is restricted to the owning user via `user_id = (SELECT auth.uid())`.

**Service role key:** The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is used
only server-side (sync jobs, catalog writes, storage uploads). It is set as a
Vercel environment variable and is never exposed to the client.

**Key handling rules:**
- The anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is safe to expose -- it is
  rate-limited and subject to RLS.
- The service role key must never appear in client-side code, browser
  `localStorage`, or git history.
- Vercel environment variables marked as server-side are not bundled into the
  SPA.

**Cloud MCP authentication.** `https://deckpal.app/mcp` accepts a personal
access token (`dsk_…`, table `api_token`) as `Authorization: Bearer <token>`
or as the URL's last path segment. Only a SHA-256 hash is stored; the raw
value is shown once, at creation, in Profile -> Agent access, and is
revocable there at any time. As of 2026-08-10 a token can also be minted
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
pool connection can ever read or write them.

**Deck-E (the AI assistant, `POST /api/chat`).** Entitlement is decided on the
server, not the browser. `entitlement.ts`'s browser-side gate only decides
whether to draw a button — verified against the deployed endpoint before this
was fixed, an ordinary signed-in account got a full model turn, billed to the
owner's Gateway key, by asking for one (DECISIONS.md 2026-08-21, "`/api/chat`
had no server-side entitlement, rate limit or spend cap"). The route now
checks `DECKE_ENTITLED_USER_IDS` plus the owner before the request body is
parsed, and every account is metered against a durable daily cap in Postgres
(`decke_usage`, migrations 039/040) — conversational turns and deep-tier calls
capped separately, since the two differ roughly 250x in price. The cap is
enforced by a single `INSERT … ON CONFLICT DO UPDATE … WHERE` statement so the
check and the charge cannot race under concurrent requests; migration 040
grants `authenticated` a SELECT policy on that table and nothing else, since an
UPDATE policy would let a signed-in user zero their own counter through
Supabase's Data API. `GET /api/health` reports `deckeEntitlement` (a status —
`nobody` / `owner-only` / `owner-plus-list` / `self-host` — never the ids, since
`/health` is unauthenticated) and `deckeLimits`.

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

**All 23 tools reach the conversational model; the write half is held by the
SDK, not filtered out.** The adapter Deck-E uses
(`apps/api/src/decke/adapters/aisdk.ts`) still *defaults* to
`annotations.readOnlyHint` — never to the verb in a tool's name, because a name
can mislead in either direction (`set_cart` sounds like a write and only composes
an outbound URL; `deck_history` sounds like a read and can roll a deck back) —
and the deep-tier sub-agents below take that default as-is, since a write tool
reachable from an *unattended* sub-agent with no reader watching a dialog is a
tool that will eventually be called by accident. The conversation is no longer an
unattended caller: `api/chat.mjs` passes `include: () => true`, and every write
declares `needsApproval`, so the turn pauses on the wire and the tool's `execute`
does not run until the reader answers. That is a mechanism rather than an
instruction — verified against the pinned `ai@7.0.66` at the wire level, and
signed, so a modified replay is rejected. What needs approval is derived from
annotations and schema: anything `destructiveHint` always, any real write always,
a preview never; when a call is classified as a preview the server writes
`dry_run: true` into the arguments explicitly rather than trusting the tool's
default, and only an explicit boolean `false` counts as permission to write.
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

One write reaches Deck-E outside the approval gate, deliberately: the
`write_strategy_guide` deep tool (below) is allowed to call `deck_strategy`,
which is dumb, idempotent storage — "replace the whole guide" — not a general
write capability.

**What he may point at, and the narrower set he may press.** Everything the
model can address is allowlisted: `uiTools.resolveTarget` resolves a selector
only if it lands inside a `[data-decke-landmark]`, navigation only within
`ROUTE_ALLOWLIST` — from which `/profile` is deliberately absent, in the
server's copy and the browser's mirror of it alike, because it mints API tokens.
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
addresses, `host:port` pairs and `for user "…"`. Every one of the 23 tools
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

**The deep tier and live research.** Four sub-agent tools
(`apps/api/src/decke/deep.ts`) give Deck-E an escalation path rather than
answering everything with the fast conversational model. `research_meta` is
the one that leaves the perimeter: it sends query text — card and archetype
names only, and its own description instructs it to never include anything
about the user, their collection or their account — to a third-party model,
`openai/o3-deep-research`, on the Vercel AI Gateway's US-frontier-labs
allowlist. That sub-agent is given **no tools at all**, which is the actual
control: text fetched from the open web is the least trustworthy input in this
system, and the only way to guarantee it cannot become an action is to hand
the thing that reads it no actions to take. Its findings are inserted back
into the conversation labelled as fetched data, into a model already
instructed never to treat instructions found in data as commands. (Recorded
honestly in DECISIONS.md 2026-08-21, "Deck-E's model routing": the
domain-allowlist control available on this Gateway for other research tools —
`include_domains` — is not available for `o3-deep-research`, since it searches
provider-side; the compensating controls here are structural rather than that
allowlist.)

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
  upstream allow-list — `assets.tcgdex.net` and `raw.githubusercontent.com`,
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
`sb-<ref>-auth-token` key), the SPA writes two of its own `localStorage` keys,
neither of which is a credential and neither of which is ever read as one:
`deckpal:skin` (the visual skin preference) and `deckpal.returning` (a single
bit, set once a session has existed in this browser, cleared by the explicit
Sign out control). `deckpal.returning` exists only so `/` can send a visitor
whose session has lapsed to the sign-in form instead of the marketing page
(`lib/returningVisitor.ts`); it carries no email, user id or token, and no
authorization decision anywhere consults it. Clearing site data resets both.

### Self-host deployment

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
