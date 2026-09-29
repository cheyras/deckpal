# Deck-E credits from actual model cost — contract

Owner rulings (2026-09-28/29): credits map to actual money, never a per-run
price; 1 credit = 1¢ today (`microUsdPerCredit` stays adjustable); each reply
holds **25 credits** up front, or whatever is left down to a **3-credit**
minimum; unused hold comes straight back. The migration is run by the owner
AFTER the code ships, so the code must keep flat pricing working until the
migrated policy exists.

Background design (current-flow citations, money risks):
`/home/cheyras/work/dco/run/S1-credits-design/DESIGN.md` — this contract
supersedes it where they differ (migration number, policy keys, hold sizing,
Jev, gating).

## 0. The gate: policy version

- **v1 (legacy, today):** exactly `{enabled, microUsdPerCredit, markupBps,
  estimatedMicroUsd:{chatTurn,analysis,planDeck}, lowBalance}` — flat prices.
- **v2 (metered):** exactly `{version:2, enabled, microUsdPerCredit, markupBps,
  lowBalance, legHoldCredits, legHoldMinCredits}`; integers;
  `1 ≤ legHoldMinCredits ≤ legHoldCredits ≤ 10000`.
- Migration **079** inserts a new current revision in v2 shape, preserving
  `enabled`, `microUsdPerCredit`, `markupBps`, `lowBalance`, with
  `legHoldCredits=25`, `legHoldMinCredits=3`. Historical revisions untouched.
- Code decides flat vs metered **only** from the policy the request froze:
  `version === 2` ⇒ metered. Before 079 is applied every path behaves exactly
  as today. Nothing else (env var, feature flag) toggles it.
- `unlimited` accounts and `enabled:false` (daily-turn mode) are unchanged in
  both versions: no hold, existing daily meter.

## 1. SQL — `packages/db/src/migrations/079_decke_metered_credits.sql`

Never edit shipped migrations (B4). All functions `SECURITY DEFINER SET
search_path=pg_catalog`, schema-qualified, and — like 077 — callable only with
the API's server claim (`deckpal_server_request`); revoke everything from
`PUBLIC`/`anon`/`authenticated`, then grant `EXECUTE` on the entry points below
to `authenticated` only (guarded, as 077 does, for plain-Postgres self-host).
Money arithmetic is SQL `numeric`, never float.

Schema (from the design): `decke_ai_request.charged_credits` →
`numeric(24,12)`; tables `decke_metered_credit` (per-user fractional carry,
`0 ≤ x < 1`), `decke_metered_reservation` (request_id PK/FK, user_id,
`held_credits int`, `cap_credits numeric`, `provider_started_at`,
`created_at`), `decke_metered_settlement` (request_id PK/FK, known USD, exact
credits, whole credits, unknown-operation count, coverage, status). RLS on,
no client policies.

Entry points (exact names/signatures):

- `decke_metered_begin(p_request uuid) RETURNS jsonb` — after
  `decke_usage_begin`, before any provider call. Idempotent per request.
  Lock order governance → wallet control → balance (as 070/077).
  - request `charge_mode` `paid` + v2 frozen policy:
    `available = balance − carry`. Payment hold ⇒
    `{allowed:false, reason:'payment_hold', balance}`; debt ⇒
    `{allowed:false, reason:'debt', balance, debt}`; `available <
    legHoldMinCredits` ⇒ `{allowed:false, reason:'insufficient', balance,
    needed: legHoldMinCredits}`. Else debit
    `held = LEAST(legHoldCredits, integer balance)` whole credits and set
    `cap = held − carry` ⇒ `{allowed:true, mode:'paid', heldCredits, capCredits,
    balance}` (balance after the debit).
  - `unlimited`/`daily` ⇒ `{allowed:true, mode, heldCredits:0, capCredits:null}`
    and no wallet movement.
  - Decimal values are returned as JSON strings.
- `decke_usage_operation_begin` and `decke_usage_external_operation_begin` are
  `CREATE OR REPLACE`d so that, when `p_spend IS NULL` and the request holds a
  metered reservation, they (a) refuse with **SQLSTATE `DKCAP`** once the
  request's known cost in credits ≥ `cap_credits`, else (b) stamp
  `provider_started_at` on first use and insert the operation. Every other
  input keeps its current behaviour (flat spends, daily mode, Jev in daily).
- `decke_metered_status(p_request uuid) RETURNS jsonb` —
  `{knownCredits, capCredits, capReached}` (strings/bool) for the chat loop.
- `decke_metered_settle(p_request uuid, p_status text) RETURNS jsonb` —
  idempotent (a replay returns the stored row). Sums `decke_ai_operation.cost_usd`
  over ALL of the request's operations (chat steps, research, Jev); converts
  with the request's FROZEN policy + override revisions
  (`credit_effective_policy(user, revision, override)` — never current policy);
  adds to the carry; retains whole credits from the hold, releases the rest;
  cost beyond the hold goes through `credit_apply_delta` so an overrun becomes
  debt, never a negative wallet. Operations without a cost count as unknown ⇒
  coverage `partial`/`unknown`; unknown cost is never guessed. Writes
  `charged_credits` (exact). Returns `{credits, wholeCredits, knownCostUsd,
  coverage, balance}`.
- `decke_metered_recover(p_user text) RETURNS integer` — settles reservations
  older than 15 minutes with no settlement as `abandoned` (known cost only);
  internal, invoked by `credit_wallet_read`, not granted to clients.
- `CREATE OR REPLACE` `credit_validate_policy` (accept exact v1 OR exact v2),
  `credit_quote_read` (v2: `{enabled, lowAt, mode:'metered', holdCredits,
  holdMinCredits, pricingRevision, unlimited, overrideRevision}`; v1 unchanged
  plus `mode:'flat'`), `credit_wallet_read` (recover first; `balance` exact
  string = integer balance − carry; `heldCredits` = open holds),
  `credit_events_read` (internal hold/release rows hidden; one "Deck-E chat"
  row per settled leg with its exact fractional delta),
  `decke_import_fix_finish` (use the generic carry; migrate existing
  `decke_import_fix_credit` fractions into it so there is one liability).
- `credit_spend_create_effective` under a v2 frozen policy raises `22023`
  ("flat pricing retired") — nothing may call it once metered.

## 2. API (TypeScript / `api/chat.mjs`)

- `credits/policy.ts`: `CreditPolicy = LegacyPolicy | MeteredPolicy`,
  `isMetered()`. Stored reads accept either exact shape; admin `PUT` accepts
  the version currently stored (so an admin cannot switch to v2 before 079
  exists). Flat helpers remain only for v1.
- Chat leg, metered + paid: `decke_metered_begin` replaces `reserveCredits`;
  no per-research reservation (research runs under the leg's hold, still one
  operation per call); `finishAiRequest` settles after pending operations and
  records exact credits. `DKCAP` from an operation begin is not an error to the
  reader: the chat loop's `stopWhen` also consults `decke_metered_status` after
  each step and stops before starting another call once `capReached`; the turn
  ends with Deck-E saying, in his voice, that this is as far as he can take it
  in one go and offering to keep going (a new message is a new leg and hold).
- Refusals keep today's 429 + spoken out-of-credits text; `needed` is
  `legHoldMinCredits`.
- `x-decke-credits` becomes a decimal string (balance after the hold);
  `x-decke-credits-low` unchanged; `-1` still means "charging off".
- `GET /me/credits`: metered adds `mode:'metered'`, `holdCredits`,
  `holdMinCredits`, `heldCredits`, `balance` (number, ≤4 dp) and
  `balanceExact` (string); omits `prices`. Flat mode unchanged plus
  `mode:'flat'`. `GET /me/credits/events` rows may carry fractional deltas.
- The notices shown to readers/admins (`CHARGE_NOTICE`, `ESTIMATE_NOTICE`)
  get metered versions that describe the hold and actual-cost settlement.

## 3. Web

- Wallet (`/credits`): metered explains "You pay what the AI model actually
  costs; each reply briefly sets aside up to N credits and returns what it
  didn't use"; balance and statement show up to 4 decimals; exact value on
  hover/detail. Flat mode renders as today.
- Chat: decimal `x-decke-credits`; refetch `/me/credits` when a reply
  finishes (headers are written before settlement).
- Admin Settings: edits v2 fields (hold, minimum, rate, markup, low balance,
  enabled) when the stored policy is v2; v1 editor unchanged otherwise.

## 4. Verification

- SQL: real Postgres 16 (`~/pg16`, see the DB lane spec): begin race for the
  last credits, replayed begin/settle, chat+research+Jev sum, abort before and
  after invocation, partial/unknown cost, overrun to debt, cap refusal
  (`DKCAP`), stale recovery, frozen revision, import-fix carry migration,
  grants/RLS, wallet/statement decimals, and v1 behaviour intact before 079.
- The full `scripts/test-db-integration.mjs` run passes.
- Unit: policy normalisation both shapes, decimal math, chat gating, header,
  web rendering/math.
