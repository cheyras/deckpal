# DeckPal administration

Open **Administration** at `/admin` from desktop or mobile navigation. It shows
the sections and target actions authorized by the current server response.
**Dev tools** is a separate destination at `/devtools`.

**Implementation record, 2026-09-15:** this guide describes the code through
migrations 068–071 and its isolated verification. It does not assert those
migrations, a production release, or new Stripe configuration have been applied.
Use the schema-first runbook in DEPLOYMENT.md and record live results separately.

## One role per account

Every existing and newly created account has exactly one canonical role, default
User. Roles do not combine into a permission union.

| Built-in role | Tier | Main boundary |
|---|---:|---|
| User | 10 | Ordinary personal product access; may opt into beta features. |
| Superuser | 20 | User access plus eligibility to opt into every experiment. |
| Contributor | 30 | Ordinary personal access plus permitted development tools; no Administration. |
| Admin | 40 | Permitted administration; may assign only User or Superuser to targets currently in those built-in roles. |
| Superadmin | 50 | May assign roles through Superadmin and edit allowed role definitions; cannot modify an existing Owner or assign Owner. |
| Owner | 60 | Protected ownership and exclusive per-user AI override authority. |

Contributor's restriction concerns administration of other users, roles, global
settings and finances. Contributors retain their own profile, subscription,
credit wallet and other ordinary User self-service. A custom tier-30 role has
the same ceiling: editable permission bits cannot create administrative access.

Assignment checks both the destination and the target's current role, including
suspended targets. An Admin cannot demote a Contributor/Admin/Superadmin to User
as a way around the boundary. Use the server's `actions` and
`assignableRoleIds`; stale account or role revisions require reload and review.

Superadmins and Owners can create custom roles at tiers 10, 20, 30 or 40 and
edit permitted names, descriptions and permissions. Built-in identity, key, tier
and deletion are protected; protection is separate from `canEdit`/`canDelete`.
Safe built-in definitions remain editable except Owner. Custom roles cannot
manufacture reserved ownership, role-governance or lifecycle authority.
Role deletion requires no remaining members.

## Bootstrap, migration and recovery

For an existing initialized deployment, migration 068 seeds canonical Owner
from the trusted `admin_state.bootstrap_owner` record. For new initialization,
the trusted existing cloud account configured by `DESIGN_EDITOR_USER_ID`, or
the supported self-host local identity, is recorded once and assigned Owner.
Runtime authority is protected Owner membership, never mutable email, browser
input or JWT profile metadata. Owner and Superadmin are distinct.

Migration 068 preserves prior assignments in a private snapshot and archive.
The old `admin_user_role` name becomes a read-only compatibility projection over
`admin_account.role_id`. Deprecated `roles[]` readers receive one summary;
Owner appears there using the existing Superadmin summary. New authority uses
`role` and `isOwner`, never that facade. No second writable membership store
exists. Ambiguous legacy custom/multiple assignments require explicit reviewed
mapping; the migration fails atomically rather than guessing. See DEPLOYMENT.md.

The database protects the last active Owner under the governance lock. There is
no ordinary Owner-transfer UI. Keep tested recovery access to the existing
Owner's authentication and a verified backup. Superadmin is useful operational
access but does not replace Owner authority. Do not clear the bootstrap sentinel,
edit JWT claims, change retired allowlists or modify archives as recovery.
An application suspension is separate from an Auth-provider ban.

Old Deck-E and labeler environment lists no longer grant feature access or
silently promote new accounts. Existing legacy labelers retain their narrow
development capability through reviewed migration; legacy Deck-E alone becomes
ordinary User. Self-host remains behind its reverse proxy. Preview hostnames
never bypass permission or feature checks.

## Onboard and find development tools

1. Have the person sign in with an ordinary account, then identify it in Users.
2. An authorized Superadmin/Owner chooses the one suitable role; a restricted
   Admin may assign only User/Superuser within the target boundary above.
3. Review the server-enabled action, revisions and reason, then save once.
4. The person opens **Dev tools**; verify the assignment in Audit.

Dev tools lists Design system, Chat UI gallery, Character comparison, Scanner
harness, Quad labeler and Training photo review according to capability.
Product Scanner and Deck-E experiments belong in normal product navigation and
Profile feature preferences, not this directory. Training photos can contain
private contributor captures. Design editing still requires its local service.
No administrative MCP or Deck-E automation tools are added.

## Feature lifecycle and personal opt-in

Scanner and Deck-E begin as experimental. Superadmins and Owners configure
release stages; opt-ins are personal and revisioned.

| Lifecycle | Access for an active account |
|---|---|
| Released | Available to every User and higher role. |
| Beta | Every user, including Superadmin/Owner, must explicitly opt in. |
| Experimental | Superuser, Contributor and Admin may opt into every experiment; Superadmin/Owner access is automatic. |
| Disabled | Unavailable to everyone, including Owner. |

Disabled stops new requests and provider attempts, including nested attempts
and retries. Work already sent to a provider may finish. Role grants for
`scanner.use`/`decke.use` do not bypass lifecycle policy; SQL derives these
permissions centrally. Feature opt-in is separate from Deck-E visibility and
conversation-sharing consent.

## Permission and table conventions

`roles.assign` and `roles.manage` are structural governance capabilities, not
checkboxes in editable role permission sets. Read/write pairs such as
`users.read`/`users.manage` and `credits.read`/`credits.manage` still gate their
ordinary actions. The server also returns role definition capabilities,
per-target actions and current feature access; hiding a button is not authority.

Growing lists use the shared semantic DataTable: Users, Roles, Audit, credit
orders/packs/statements, usage, feature catalog and Dev tools. Supported filters,
stable server paging or complete-list sorting, loading/error/empty states and
explicit row actions remain inside the content column at mobile widths.
Sort direction uses the shared SVG Icon with accessible header labels.

Administration shares a 120-request budget per 60 seconds, including its credit
routes; the wallet has a separate 180-request budget. These are per-account,
per-API-instance limits. On 429, respect Retry-After. Database Checkout retains
60 requests and 10 new orders per hour.

## Suspend access, revoke connectors and review changes

In a user's detail page, **Suspend account** requires a reason. It blocks new
private application access and revokes that account's tokens and outstanding
OAuth codes. **Reactivate account** restores account access; it does not un-revoke
old connector credentials. **Revoke connectors** disconnects those credentials
without suspending the web account. Manual token minting, OAuth exchange and
revocation serialize so revoke-all cannot miss a token that was still committing.

Permissions and status are read from the database for new requests and
rechecked inside privileged mutations. The browser refreshes permissions on
focus, session changes and bounded staleness. Already-running requests or
provider work can finish; downloaded data and previously issued signed object
URLs cannot be recalled. Suspension is application access control, not a
Supabase Auth account deletion or ban.

**Audit** provides paginated action/actor/target filters and safe before/after
records. Role assignments, status changes, revocations, defaults, policy/pack
changes, balance adjustments and eligible hold resolutions are recorded.
Manual balance adjustments and hold resolutions require a meaningful reason.
Policy and pack changes are audited without a separate reason field. The record
is not a provider usage invoice.

## Set application defaults

**Settings → App defaults** controls **Visual style** (Premium/Classic) and
**Top bar** (Translucent cover/Flat). Changes affect accounts without an explicit
choice. Existing personal choices remain, and reading a default does not save
it as a personal override. No unused collection-goal or binder-layout controls
are presented as implemented defaults.

## Set AI credit economics

A credit is an integer service unit, not a promise of cash redemption. Since
migration 081, Deck-E usage is **metered**: a reader pays the model cost the
Gateway reports for each reply, plus markup. **Settings → AI credit economy**
sets **USD value per credit**, **Provider-cost markup (%)**, **Reply hold
(credits)**, **Minimum reply hold (credits)**, **Low-balance warning (credits)**
and **Overage buffer maximum (credits)**. The old flat per-operation estimates
(chat turn, analysis, deck plan) are retired: once a metered (version 2) policy
is stored, a flat one cannot be saved, and the database refuses flat charges.
A reply's charge is:

```text
credits = reported provider USD × (1 + markup % / 100) / USD value per credit
```

Pricing stores dollar amounts in microUSD (1 USD = 1,000,000 microUSD) and markup
in basis points (1% = 100 bps); the UI accepts decimal USD and percentages. The
charge is fractional: whole credits leave the balance as the fractions add up,
and the remainder (always under one credit) is carried per user. A provider
operation with no reported cost is not charged. An explicit unlimited
reservation spends zero.

Example: a reply reported at **$0.02**, markup **50%**, credit value **$0.01**
costs **3 credits**. The marked-up amount is $0.03; its gross margin is 33.3%,
not 50%, before payment fees and other costs. That comparison assumes credits
are actually sold at the nominal $0.01 each. A **100-credit pack for $1.00** has
that effective unit price; pricing the same pack at $2.00 changes its sales
economics independently. Usage markup is not added to the pack checkout price.

Before a paid reply starts, the server holds up to **Reply hold** whole credits
(fewer if the balance is smaller) and refuses the reply when less than **Minimum
reply hold** is available, or while the account has debt or a refund/dispute
hold. Deep Think holds a multiple of the reply hold (migration 083). At
settlement the reply pays its metered cost out of the hold, returns the unused
part in the same transaction, and takes any excess from the rest of the balance.
A reply that costs more than the wallet holds still finishes: DeckPal's overage
buffer covers the difference, and the reader never owes it. Migration 081 seeded
the buffer at 2,000 credits. **Overage buffer maximum** caps future refills;
nothing refills the buffer yet, and an empty buffer still covers an overshoot,
its own balance going negative.

Migration 081 converted the stored flat policy into a metered one, keeping its
enablement, credit value, markup and low-balance threshold, and adding a
25-credit reply hold, a 3-credit minimum and a 2,000-credit buffer maximum.
Balances were not changed. The **Observed provider costs** panel served the flat
estimates and is not shown for a metered policy; **AI usage** still reports
known and unknown costs.

Saving creates a prospective pricing revision. Existing integer balances and
past charges are not recalculated; accepted work keeps its pricing snapshot.
One HTTP chat leg is one hold and one settlement, and its deep work and retries
are provider operations summed into that settlement. Exact accepted-request
replays are rejected rather than obtaining another free invocation; changed
requests are charged independently.

Ensure eligible users have appropriate balances before enabling charging.
Use **Users → AI credits → Adjust credits** with a signed whole-number delta
and reason. Positive credits repay debt first. Disabling credit charging
returns ordinary accounts to daily-cap mode; an explicit unlimited override
bypasses debit/daily allowance but retains operational budgets and all access,
debt and hold restrictions. Neither mode erases the ledger.

### What cancellations cost

The hold and its ledger entry are atomic and fail closed if accounting cannot
establish the policy or balance. However a reply ends (completed, failed,
cancelled or abandoned), it settles at the reported cost of the provider
operations that actually ran, so a reply cancelled before any model call costs
nothing and its whole hold comes back. Settlement is idempotent per request. A
hold still unsettled after 15 minutes is settled as abandoned on the reader's
next wallet read. Recovery skips holds currently locked by another transaction,
avoiding a wait cycle with direct cancellation; a later wallet read recovers
them after the lock is released. Refresh the wallet later if a returned hold has
not appeared. Accounting connections are released across a model stream.

## Owner controls: user AI overrides

Only Owner can change a user's unlimited AI setting or optional provider-cost
markup override. These settings belong to the user independently of role.
`markupBps: null` inherits the global policy; `0` is valid zero markup.
Changes require the current override revision and a reason, and are audited.

Unlimited uses an explicit zero-debit reservation and records actual usage;
it does not mint a large balance or manufacture a refund. Debt, refund/dispute
holds, suspension, feature restrictions and operational limits still apply.
New work cannot select a revoked override or stale global price. Already
reserved work keeps its frozen terms; bound nested work can inherit the
started, unrefunded parent's snapshot within its operational window.
Existing integer balances, debts and past settlements are not repriced.

## Review AI usage and conversation consent

AI usage is server-written before model work and independently of browser
history saves. A parent records each HTTP request; distinct provider-attempt
rows capture response, research and planning work, including local SDK retries,
fallbacks, nested calls, cancellation and failure. Attempt IDs and idempotent
finalization prevent double counting. Upstream attempts that the Gateway does
not report cannot be invented.

Cost is a validated reported USD decimal or unknown. Explicit reported zero is
valid; absent/malformed cost is never zero. Rows include token/cache/reasoning
evidence when supplied, status and timestamps, known/unknown coverage, full
server commit SHA and PR attribution. The trusted preview PR system ID takes
precedence over a squash-merge subject; missing provenance remains null.
The implementation supplies no guessed token-rate fallback. Aggregate known and
unknown counts refer to provider operations, not parent requests. Financial
estimates read both historical flat snapshots and effective-policy envelopes;
a missing operation estimate is counted as unpriced.

**AI usage** filters user, conversation, category, status, date, model, build,
PR and cost source with bounded paging. Lists and observations contain no
prompts, responses, tool arguments/output, raw errors or hidden context.
Admin, Superadmin and Owner may inspect metadata and current-consented detail;
Contributor has no administrative usage access.
Usage reads require an active application session, tier 40 or higher and current
`admin.access`. Custom roles lose metadata and shared-content access immediately
when that permission is removed; the capability projection uses the same rule.

The account-wide sharing switch from migration 071 is retired. Migration 078
turned it off for every account and deleted the excerpts it had collected, so
**AI usage** now shows usage metadata only. Sharing is per chat: a reader
shares one chat when Deck-E asks or with feedback, or turns on Profile → **Always
share my Deck-E chats** (off by default). **Let Deck-E ask to share chats** (on
by default) only matters while always sharing is off. A shared copy is
pseudonymised, kept 180 days unless the reader stops sharing it from Deck-E's
History, and read on **Deck-E chats** with the `decke.improvement.read`
permission. `/privacy` lists what a shared copy holds.

The retired excerpts held only the current user message and visible assistant
response. Own history remains separate and may contain personal tool records;
client-posted content/build/cost is never administrative telemetry authority.
The browser sends the same conversation ID, sequence and exchange UUID on every
leg and history POST. The server validates ownership and accepted correlation,
retains immutable personal history, and reuses the request's generation build.
Old/missing correlation stays private and unattributed. Deleting own history
also withdraws its optional administrative excerpts while preserving metadata.

Private responses are no-store. The browser clears sensitive state on identity
and consent changes; open administrative detail refetches every ten seconds
and on focus, withholding content while unavailable/refetching. Withdrawal
cannot recall text already seen or copied. Observed costs are reporting only;
they do not change past charges.

## Offer credit packs and diagnose payment setup

Packs start empty. In **Settings → Credit packs**, create a name, integer credit
quantity and explicit USD sale price; activate **Available for new purchases**
when ready. Limits are 1–1,000,000 credits and $1.00–$500.00 per pack. Edits or
deactivation affect new checkout attempts, while pending orders retain their
frozen pack name, credits, cents, currency and revisions.

Users open **AI credits** from Profile, `/credits` or the chat's **Top up**
action. The wallet shows balance, operation prices, debt and a paginated
statement. A purchase sends only the selected pack and a retry identifier;
the server owns price, customer and order metadata. Returning from Stripe
does not itself grant credits: the wallet waits for a server-confirmed order.

**Payment readiness** inspects existing Stripe configuration read-only. It
requires hosted mode, a trusted HTTPS return origin, the secret key/signing
secret and an enabled webhook matching this HTTPS origin, exact `/api/stripe/webhook`
path, mode and all nine required credit event subscriptions. A delivery query
is allowed for deployment protection and never displayed by readiness; credentials
and fragments are rejected. Pagination is bounded and reports incomplete
verification rather than success. Results may be cached for 60 seconds. No new readiness flag is
needed, and the app does not create or modify a Stripe webhook. See
DEPLOYMENT.md for the nine credit events; retain the existing support events.

“Ready” means configuration/subscriptions were found, not that a real payment
was tested. A missing key, unreadable webhook list, wrong URL/mode or missing
event is reported. A wallet can also refuse purchases because Deck-E access
or charging is disabled, no active pack exists, or a payment hold applies.
Credit purchases are hosted-only; self-host still has administrative credit
policy/wallet functionality. Support subscriptions and one-time gifts remain
a separate product and do not purchase credits.

## Operate orders, refunds and debt

**Overview → Credit activity** selects 7/30/90 days. Gross sales and refunds
describe the cohort of purchases paid in that window; the refund value is
cumulative refunds on those purchases, not necessarily refunds issued inside
the same window. Pending orders, held wallets and debt counts describe current
state. This financial summary reports metered credits spent with the provider
cost reported for them, the credits the overage buffer covered and its current
balance, plus estimated cost for older flat-priced spends; the separate AI usage
view shows observed reported/unknown provider costs. Older unpriced spends are
reported separately. Filter **Credit orders** by user ID/status.

Signed webhooks reconcile current Stripe session, payment, customer, refund
and dispute state. Unique order fulfillment prevents duplicate grants.
Per-order reconciliation revisions reject stale snapshots instead of letting
an older webhook clear a newer hold.

A successful partial refund reverses `ceil(pack credits × refunded cents /
original cents)`. Open or lost disputes reverse the relevant pack credits;
pending refunds hold purchases and usage without treating pending money as
settled. Failed/cancelled refunds release their pending hold. Reversals use
available balance first and record any shortfall as explicit debt, never a
negative spendable balance. Later grants repay debt before becoming spendable.

Review the payment in Stripe and the user's statement before adjusting anything.
A reasoned positive adjustment may repay debt; it is a new ledger event, not a
cash refund. **Resolve purchase hold** clears an eligible closed lost-dispute
hold only after debt is zero and no pending refund/open dispute remains. It
does not restore lost credits or override an unresolved payment. There is no
refund-issuing button or manual “mark paid” shortcut in Administration.

## Contributor checks and deployment

Run the focused `test:admin` and `test:admin-credits` API suites, the guarded
`test:integration` PostgreSQL runner, and root `test:browser` as documented
in CONTRIBUTING.md. The database fixture rehearses selected dependencies and
migrations 064–071, including direct SQL/RLS and concurrency boundaries; it is
not a full historical migration replay. Browser APIs/sessions and Stripe/model
responses are isolated fixtures. They do not establish live payment readiness.
