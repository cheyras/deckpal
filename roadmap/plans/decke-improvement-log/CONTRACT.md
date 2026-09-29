# Deck-E improvement database contract

Status: implemented by migration `078_decke_improvement.sql` (owner decision,
2026-09-28). This is the frozen interface for the API, web, MCP, and
administrative reader lanes.

Collection is opt-in for one conversation at a time. Nothing in a chat is
copied merely because the reader has an account. The `ask_to_share_chat` tool
may show the consent card only after `decke_improvement_can_ask` returns
`allowed: true`; SQL makes that decision and records the ask atomically.

The improvement collection is pseudonymised, not anonymous. Free text and tool
results can still identify a person. Collection readers never receive the
stable owner pseudonym and cannot join the collection to personal history,
usage accounting, or account tables.

## Identity, prompt preference, and retention

- `user_settings.decke_share_prompts boolean NOT NULL DEFAULT true` means “Let
  Deck-E ask to share chats.” It permits a prompt; it does not share anything.
- `user_settings.decke_share_all boolean NOT NULL DEFAULT false` (added by 079)
  means “Always share my Deck-E chats.” While on, `decke_improvement_auto_share`
  shares each undecided conversation (consent source `always`) from its first
  recorded leg and `can_ask` returns false; a conversation already `declined` or
  `revoked` is never auto-shared; turning it off affects future chats only. The
  ask card's “Share all my chats” turns it on and shares the current chat.
- Redaction is best effort (owner, 2026-09-29, following ChatGPT/Claude): the
  guarantees are consent, admin-only access, retention and no account IDs;
  usernames, display names and emails are removed where they appear, including
  common encodings, and every live content write passes API redaction before
  SQL redaction as defence in depth.
- Consent is represented only by `decke_improvement_consent`, one row per
  conversation. Writers lock that row and write content only while its status
  is `shared`.
- Personal feedback remains in `decke_turn_feedback` whether or not the chat is
  shared. Its improvement copy exists only while the conversation is shared.
- Revoking deletes the one conversation's corpus in the same transaction and
  leaves a `revoked` consent row so Deck-E cannot ask again.
- Deleting an account deletes its consent and corpus through a trigger directly
  on `app_user`; deleting `user_settings` first cannot bypass cleanup.
- Conversations expire 180 days after
  `decke_improvement_conversation.updated_at`.
  `decke_improvement_purge_expired()` deletes bounded batches in a loop until
  every expired conversation is gone and returns the total; improvement readers
  also invoke it opportunistically.
- Migration 071's account-wide `decke_sharing` switch and `decke_ai_content`
  excerpts are retired by migration 078. Existing switches are disabled,
  existing excerpts are deleted, compatibility writers are metadata-only, and
  the legacy reader always returns no content.

The HMAC key is database state, never deployment configuration:

```text
decke_improvement_secret(id=1, key=32 random bytes)
owner_key       = HMAC-SHA256(key, "owner:"        + user id text)
conversation id = UUID(first 16 bytes HMAC(key, "conversation:" + client conversation UUID))
leg id          = UUID(first 16 bytes HMAC(key, "request:"      + decke_ai_request UUID))
```

The UUID helper retries with a collision domain if a derived UUID would equal
its raw input. Raw user, client conversation, exchange, request, token, email,
username, display-name, IP, and History-title values are not stored as corpus
identifiers. `decke_turn_feedback` is personal data and is not a corpus table.

The API must redact username, display name, email, email local part, and any
self-identification before calling a content writer. Both API and SQL cover
case-insensitive NFC/NFD Unicode forms, percent/form encodings, and HTML-entity
escaped `@` in email addresses, including recursively nested JSON keys, values,
and JSON encoded inside strings after decoding JSON Unicode escapes. One- and
two-character identity terms use case-insensitive whole-word matching. SQL also recursively removes raw
user/conversation/request/exchange identifiers from JSON keys and values.

## Tables

Every table below has RLS enabled. All privileges on the secret, consent, and
corpus tables are revoked from `PUBLIC`, `anon`, `authenticated`, and
`service_role`. Only security-definer functions access them. The personal
feedback table alone grants authenticated CRUD under own-row policies.

### `decke_improvement_secret`

| Column | Type | Contract |
|---|---|---|
| `id` | `smallint` PK | Always `1` |
| `key` | `bytea` | Exactly 32 random bytes |
| `created_at` | `timestamptz` | Seed time |

### `decke_improvement_consent`

| Column | Type | Contract |
|---|---|---|
| `id` | `uuid` PK | HMAC-derived improvement conversation ID |
| `owner_key` | `bytea` | 32-byte owner HMAC; never returned |
| `status` | `text` | `asked`, `shared`, `declined`, or `revoked` |
| `source` | `text` | `decke_ask`, `feedback`, or `reader` |
| `asked_at` | `timestamptz?` | Set when Deck-E initiated the prompt |
| `answered_at` | `timestamptz?` | Latest explicit answer/grant/revoke time |
| `updated_at` | `timestamptz` | Latest state change |

Consent state machine:

```text
absent  --can_ask--> asked
absent/asked/declined/revoked --explicit share--> shared
absent/asked/declined --answer no--> declined
shared --revoke--> revoked
```

Any existing state makes `can_ask` return false, including `revoked`. A reader
may later share explicitly from feedback or History; Deck-E never prompts that
conversation again. A negative answer cannot be used to stop an already shared
chat; callers use `decke_improvement_revoke`.

### `decke_improvement_conversation`

| Column | Type | Contract |
|---|---|---|
| `id` | `uuid` PK | HMAC-derived conversation UUID |
| `owner_key` | `bytea` | Owner HMAC; never returned |
| `started_at`, `updated_at` | `timestamptz` | Corpus bounds; `updated_at` is the retention anchor |
| `build_first`, `build_last` | `text?` | Earliest/latest captured build |
| `cost_usd` | `numeric(24,12)?` | Sum of known costs; NULL when none are known |
| `cost_coverage` | `text` | `complete`, `partial`, or `unknown` |
| `has_error` | `boolean` | Any failed/error leg or error event |

### `decke_improvement_turn`

Primary key: `(conversation_id, seq)`.

| Column | Type | Contract |
|---|---|---|
| `conversation_id`, `seq` | `uuid`, `integer` | Derived parent and non-negative client sequence |
| `asked`, `answered` | `text` | Redacted visible transcript |
| `tools` | `jsonb array` | Redacted History snapshot available at grant time |
| `feedback`, `feedback_comment` | `smallint?`, `text?` | `-1`/`1` and redacted comment, maximum 500 characters |
| `started_at`, `finished_at` | `timestamptz`, `timestamptz?` | Aggregate bounds |
| `latency_ms` | `integer?` | Aggregate elapsed time |
| five token columns | `bigint?` | Input/output/cache-read/cache-write/reasoning sums |
| `cost_usd`, `cost_coverage` | `numeric(24,12)?`, `text` | Known sum and coverage |
| `build_sha`, `build_pr`, `finish_reason` | nullable | Latest captured build/finish metadata |
| `has_error` | `boolean` | Failed/error leg or error event |

### `decke_improvement_leg`

| Column | Type | Contract |
|---|---|---|
| `id` | `uuid` PK | HMAC-derived request UUID |
| `conversation_id`, `seq`, `leg` | composite parent plus integer | Unique leg order per turn |
| `asked`, `answered` | `text` | Redacted leg-visible text |
| `model_id`, `provider` | `text?` | Provider identity; SQL backfill uses `mixed` for multiple values |
| `started_at`, `finished_at`, `latency_ms` | nullable timing fields | Request timing |
| five token columns | `bigint?` | Usage totals |
| `cost_usd`, `cost_source` | numeric/text | Cost and `provider_reported`, `token_rate_estimate`, or `unknown` |
| `status`, `finish_reason` | text | Lifecycle and provider finish reason |
| `build_sha`, `build_pr` | nullable | Build stamp |
| `error` | `jsonb?` | Full redacted error |
| `tool_calls` | `jsonb array` | Full redacted calls, arguments, outputs, approvals, and timings |

### `decke_improvement_event`

Primary key `(conversation_id, seq, ordinal)`; idempotency key
`(conversation_id, seq, batch, batch_ordinal)`.

It stores optional `leg_id`, non-negative `batch`, `batch_ordinal`, and global
`ordinal`, event time `at`, `kind`, and full redacted `payload`. Kinds are
`animation`, `browser_tool`, `notice`, `error`, `timing`, and `approval_ui`.

### `decke_turn_feedback`

Primary key `(user_id, conversation_id, seq)`. It stores the raw personal
`vote`, optional 500-character `comment`, and `updated_at`, with a cascading FK
to the reader's History turn. Authenticated own-row RLS applies.

### Credential additions

- `api_token.decke_improvement_read boolean NOT NULL DEFAULT false` is
  server-owned and cannot be inserted or updated by web roles.
- `oauth_code.decke_improvement_read boolean NOT NULL DEFAULT false` carries an
  explicit OAuth approval until exchange; exchange must copy it to `api_token`.

## Writer claims

All consent/content writers require:

1. `request.jwt.claims.sub = p_user`;
2. a real browser/server session accepted by `admin_is_session()`;
3. trusted claim `deckpal_server_request = true`; and
4. an active account.

Token authentication is not accepted for these reader-owned writes. Callable
functions are `SECURITY DEFINER`, `search_path=pg_catalog`, and granted only to
`authenticated` where appropriate.

Internal, fully revoked functions are:

- `decke_improvement_uuid(text, uuid) -> uuid`
- `decke_improvement_owner_key(text) -> bytea`
- `decke_improvement_redaction_terms(text) -> text[]`
- `decke_improvement_redaction_variants(text[]) -> text[]`
- `decke_improvement_redact_text(text, text[]) -> text`
- `decke_improvement_redact_json_identifiers(jsonb, text[]) -> jsonb`
- `decke_improvement_reader_json(jsonb, timestamptz) -> jsonb`
- `decke_improvement_require_writer(text) -> bytea`
- `decke_improvement_require_reader() -> text`
- `decke_improvement_recompute(uuid, integer) -> void`
- `decke_improvement_shared_owner(text, uuid) -> bytea`
- `decke_improvement_account_delete() -> trigger`

## Consent and own-History functions

### `decke_improvement_can_ask(text, uuid) -> jsonb`

Arguments are `(p_user, raw client conversation UUID)`. It verifies ownership,
locks the prompt preference, and atomically inserts `asked`. Parallel callers
cannot both receive permission.

```json
{"allowed":true,"reason":"asked"}
{"allowed":false,"reason":"prompts_disabled"}
{"allowed":false,"reason":"already_declined"}
```

The other existing-state reasons are `already_asked`, `already_shared`, and
`already_revoked`.

### `decke_improvement_answer(text, uuid, boolean, text) -> jsonb`

Arguments are `(p_user, raw conversation UUID, p_share, p_source)`. Source is
one of the three consent sources. A negative answer records `declined`:

```json
{"status":"declined","source":"decke_ask","conversationId":"derived-uuid"}
```

A share creates the corpus conversation and empty turn shells, then copies
only numeric/model/provider/build/status metadata from
`decke_ai_request`/`decke_ai_operation`. It never persists raw History content.
It returns the raw rows already available to the server so the API can redact
them:

```json
{
  "status":"shared",
  "source":"feedback",
  "conversationId":"derived-uuid",
  "backfill":{
    "turns":[{
      "seq":0,"asked":"raw question","answered":"raw answer","tools":[],
      "buildSha":"abc","buildPr":245,"finishReason":"stop",
      "createdAt":"2026-09-28T18:00:00Z"
    }],
    "requests":[{"requestId":"raw-request-uuid","seq":0,"leg":0}]
  }
}
```

The response is server-confidential and must not be forwarded to the browser.
The API redacts `backfill.turns`, calls `decke_improvement_record_backfill`,
then replays richer per-request telemetry through `record_leg`. This split is
mandatory: raw transcript/tool content must never be written by `answer`.

### `decke_improvement_record_backfill(text, uuid, jsonb) -> jsonb`

The API passes an array (maximum 1,000 turns / 1 MiB) of redacted
`{seq, asked, answered, tools}` objects. SQL verifies each personal History
turn, applies defensive redaction, and updates the shared turn shell.

```json
{"recorded":true,"count":2,"conversationId":"derived-uuid"}
```

When the conversation is not shared:

```json
{"recorded":false,"reason":"not_shared"}
```

### `decke_improvement_revoke(text, uuid) -> jsonb`

Deletes only that conversation's corpus and changes consent to `revoked`.

```json
{
  "revoked":true,
  "conversationId":"raw-client-uuid",
  "deleted":{"conversations":1,"turns":3,"legs":4,"events":12}
}
```

### `decke_improvement_list_mine(text) -> jsonb`

Recomputes HMAC IDs over the caller's own `decke_conversation` rows and returns
raw client IDs only for status `shared`, for History badges:

```json
{"items":[{"conversationId":"raw-client-uuid","sharedAt":"2026-09-28T18:00:00Z"}]}
```

## Collection writers

Every collection writer locks/checks the per-conversation `shared` state. A
missing, asked, declined, or revoked state returns
`{"recorded":false,"reason":"not_shared"}` without writing corpus data.

### `decke_improvement_record_leg(text, uuid, integer, uuid, integer, jsonb) -> jsonb`

Arguments are `(p_user, raw conversation, seq, raw request, leg, payload)`. SQL
verifies that the request belongs to that user's conversation/turn. Payload is
at most 1 MiB and contains the transcript, model/provider, timing, token/cost,
build/status/error fields, and a `tool_calls` array. Every tool item has string
`id`, `name`, `phase`, arbitrary `args`/`output`, optional approval, and optional
timestamps. On success:

```json
{"recorded":true,"conversationId":"derived-uuid","seq":3,"legId":"derived-uuid"}
```

### `decke_improvement_record_events(text, uuid, integer, integer, jsonb) -> jsonb`

Arguments are `(p_user, raw conversation, seq, batch, events)`. A batch is
1–200 events and at most 512 KiB. Replays are successful no-ops.

```json
{"recorded":true,"duplicate":false,"count":2,"firstOrdinal":4}
```

### `decke_improvement_record_feedback(text, uuid, integer, smallint, text, boolean) -> jsonb`

Arguments are `(p_user, raw conversation, seq, vote, comment, p_share)`. Vote
is `-1`, `1`, or NULL; NULL clears the personal comment. The personal feedback
row is always upserted. When `p_share=true` and the chat is not shared, the
function first performs the same grant as
`answer(..., true, 'feedback')`. It copies feedback only while shared.

```json
{"saved":true,"copied":true,"shared":true,"vote":1,"comment":"Helpful"}
```

### `decke_improvement_purge_expired() -> integer`

Deletes corpus conversations older than 180 days in bounded batches of 500,
looping until none remain, and returns the total count. Consent remains shared
so future activity can recreate the retained window. `service_role` receives
the scheduled-cleanup grant.

### `decke_usage_external_operation_begin(uuid, uuid, text, text, text, text, uuid) -> void`

The server-only Jev ledger writer accepts only `jev_reflex` and `jev_audit`,
requires the current started chat request, and reuses that request's base chat
credit reservation (or its daily mode). It inserts a distinct operation on the
same request without reserving or charging any additional credits.

## Improvement reader authorization

Readers require an active account, admin tier at least 40, `admin.access`, and
`decke.improvement.read`. Migration 078 assigns the new permission to built-in
system admin tiers 40 and above.

Browser reads also require `admin_is_session()`. Token reads require trusted
claims `deckpal_auth_kind=token` and `deckpal_token_id`, and SQL verifies the
live owned `api_token` row has `decke_improvement_read=true`. A caller-supplied
boolean claim is never trusted.

- `decke_improvement_token_capability(uuid, boolean) -> jsonb` lets an eligible
  signed-in admin grant/revoke the capability on an owned live PAT.
- `decke_improvement_oauth_capability(text, boolean) -> jsonb` records the same
  choice on an owned unexpired OAuth code.

### `decke_improvement_list(jsonb, text, integer) -> jsonb`

Limit is 1–100. Filters are `from`, `to`, `build_sha`, `build_pr`, `vote`,
`min_cost`, `max_cost`, `has_error`, `model`, and `tool`. Cursor order is
`(updated_at DESC, id DESC)`. The opaque cursor is the last pseudonymous
conversation UUID; SQL resolves its private timestamp internally. Result:

```json
{"items":[{"id":"derived-uuid","date":"2026-09-28","buildFirst":"abc","buildLast":"def","turnCount":3,"costUsd":0.01,"costCoverage":"partial","hasError":false}],"nextCursor":null}
```

### `decke_improvement_detail(uuid) -> jsonb`

Returns `{conversation, turns}`. Turns are ordered by `seq` and expose all turn
content including the History `tools` snapshot, ordered legs, and ordered
events. No response contains `owner_key`, raw request/generation IDs, or an
absolute timestamp. The conversation exposes only its UTC `date`; each turn
has an `offsetSeconds` from conversation start rounded to the nearest 10
seconds. Leg timing, durations, event offsets, and nested telemetry timestamps
or timings are omitted while array order and event ordinals preserve sequence.
Token counts are rounded to the nearest 100 and costs to the nearest $0.01
while cost coverage remains exact. The same projection applies to JSON,
Markdown, NDJSON, MCP, and script readers.

### `decke_improvement_search(text, integer) -> jsonb`

Query length is 2–100 and limit 1–50. Literal case-insensitive search covers
asked/answered text and tool-call names and returns bounded snippets plus only
the conversation UTC date.

## All-chat conversation costs

Jev reflex and audit calls create their own `decke_ai_operation` rows on the
current chat request. They reuse the chat turn's existing credit reservation
and never create an additional credit charge.

### `decke_usage_conversation_costs(jsonb, text, integer) -> jsonb`

This contains no transcript, tool, feedback, or consent data. It uses the
existing AI Usage boundary `decke_usage_require_admin()` (`admin.access`, tier
40) and therefore does not widen who can see user IDs already exposed on that
page. Filters are `from` (inclusive), `to` (exclusive), `userId`, and `model`;
limit is 1–100 and cursor order is `(lastActivity DESC, conversationId DESC)`.

```json
{
  "items":[{
    "conversationId":"raw-accounting-uuid","userId":"user-uuid",
    "firstActivity":"...","lastActivity":"...","turnCount":3,
    "requestCount":4,"operationCount":5,"knownCostCount":4,
    "unknownCostCount":1,"costUsd":0.0042,"costCoverage":"partial",
    "models":["provider/model"]
  }],
  "nextCursor":null
}
```

## Cost coverage

NULL cost is unknown and is never coerced to zero. A turn/conversation is
`unknown` when no child has known cost, `complete` when every child has known
cost, and `partial` otherwise. The all-chat rollup applies the same rule to
operations.

## Errors

| SQLSTATE | Meaning |
|---|---|
| `42501` | Missing server claim, wrong/inactive subject, identity conflict, missing admin permission/tier, or incapable token |
| `22023` | Invalid state transition, enum, schema, bound, filter, cursor, size, or required input |
| `P0002` | Settings, History turn/conversation, consent, corpus turn, token, or OAuth code unavailable |
| `23503` | Referenced personal parent does not exist |
| `23505` | Conflicting uniqueness/idempotency identity |

Malformed scalar text may surface native class-22 errors. API lanes map class
22 to `invalid_improvement_payload`, `42501` to forbidden, and `P0002` to not
found. Oversized payloads fail atomically; truncation is allowed only when the
payload records the original byte count and hash.
