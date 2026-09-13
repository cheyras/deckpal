# DeckPal administration

Administration lets the owner delegate access, configure app defaults and manage
AI credits without changing code. Open **Administration** in the desktop sidebar
or mobile navigation, or visit `/admin` while signed in. The navigation and
sections reflect your current permissions. The Profile **AI credits** panel
provides **Open credit wallet** and, with `admin.access`, **Administration**
links; the latter opens `/admin`.

**Release record, 2026-09-13:** see [PR #188](https://github.com/cheyras/deckpal/pull/188)
for current review and CI status. Earlier security and financial findings have
repairs, and the interrupted-upgrade permissions repair passed isolated
integration. Production migration/bootstrap and actual payments have not been
verified. Release awaits
access to the existing authorized migration/deployment workflow; deployed
configuration and Stripe subscriptions remain unverified. See DEPLOYMENT.md
before serving the new code.

## First setup and access recovery

Apply migrations **064–067 before deploying this application version**. In cloud
mode, the trusted server initializes the existing `DESIGN_EDITOR_USER_ID`
account as Super admin once; that UUID must already exist in `app_user`.
It imports existing Deck-E and labeler allowlists in the same transaction and
records an audit entry and initialization sentinel. This is not a first-user
claim: signing up, setting profile metadata, or submitting an owner ID never
creates administrative authority.

Creation migrations 064 and 066 close client permissions on their new objects
before each file commits. An upgrade stopping between files therefore leaves
those objects private; finish all required migrations before serving new code.

After initialization, roles are database-managed. Changing an old allowlist
environment variable does not restore a revoked grant or add a new administrator.
`DECKE_CREDITS_ENABLED` is likewise imported once using the exact string
`true`, after successful owner initialization; later enablement belongs in
Settings. Secrets remain in trusted server configuration.

Keep a second trusted, active Super admin and verify its sign-in before changing
the original account. The database refuses to remove or suspend the last active
Super admin, including concurrent changes. The protected role cannot be edited
or deleted, and only a current Super admin may assign it.

If the owner cannot sign in, use the other Super admin or recover the existing
owner's authentication through the deployment's trusted account-recovery
process. An application suspension is distinct from an Auth-provider ban.
If database state itself is damaged, a trusted database operator must restore
a verified backup or prepare an explicitly reviewed, audited repair. Preserve
the role, membership, account-state, audit and credit records together. Do not
clear the bootstrap sentinel, edit JWT claims, or change an old allowlist as a
recovery shortcut. There is no browser SQL editor, impersonation or account
deletion control.

Self-host starts from the configured single local account and stays behind its
reverse proxy's authentication boundary. Current deployments use UUID accounts
since migration 020; legacy bigint coverage is extra compatibility testing.
Cloud preview deployments enforce the same session and permission checks as
production. A preview URL does not grant access.

## Onboard a contributor

1. Have the person create and sign in to their ordinary DeckPal account.
2. In **Users**, search by email, username or ID; inspect the matching account.
3. In **Roles**, create a named role or clone an existing one. Select only the
   catalog permissions required for the person's work.
4. Return to the user, choose **Assign roles**, review the resulting permission
   union and enter a reason. Save.
5. Have the person reopen the relevant tool. Check **Audit** for the assignment.

Roles combine permissions; they do not define new server capabilities. An
administrator cannot grant or remove authority beyond their own, including
authority assigned to a suspended account. Role deletion requires no remaining
members. Save conflicts mean someone changed the record: review the latest
version before retrying. Settings retain a conflicting draft and offer
**Discard draft and reload latest**.

If a burst of requests returns **429**, wait the response's **Retry-After**
seconds before retrying. Administration shares a 120-request budget per
60 seconds, including credit administration; the wallet has a separate
180-request budget. These are per-account, per-API-instance limits. Checkout
also retains its database limits of 60 requests and 10 new orders per hour.

### Permission catalog

Every administrative endpoint requires `admin.access` plus its action
permission. Product tool permissions can be assigned without user or finance
administration.

| Permission | What it permits |
|---|---|
| `admin.access` | Open Administration and its permitted tool links. |
| `users.read` | Search the directory; read email/account summaries. |
| `users.manage` | Suspend/reactivate accounts and revoke connectors. |
| `roles.read` | Read roles, permissions and membership counts. |
| `roles.manage` | Create/edit/delete roles and assign permitted roles. |
| `settings.read` | Read app defaults. |
| `settings.write` | Change defaults for unset preferences. |
| `credits.read` | Read economics, wallet histories, orders and financial summaries. |
| `credits.manage` | Change future usage prices/packs, adjust credits and resolve eligible holds. |
| `audit.read` | Read recorded administrative changes and account identifiers. |
| `scanner.use` | Use the card scanner. |
| `scanner.label` | Access private training photos and labeling/review tools. |
| `design.view` | View the design system; production is read-only. |
| `diagnostics.view` | Open internal scanner, character and chat diagnostics. |
| `decke.use` | Use Deck-E, subject to account and credit restrictions. |

For a labeler, `admin.access` + `scanner.label` makes the tools discoverable
without exposing users or money. For user-role assignment through the UI,
combine `users.read`, `roles.read` and `roles.manage` with
`admin.access`. Status/connector actions additionally need `users.manage`.
Defaults editors need their read/write pair; finance editors need
`credits.read` + `credits.manage`. User-specific finance controls also need
`users.read` to open the detail page. These are UI workflow dependencies,
not a claim that a read permission itself grants write access.

**Tools** lists Card scanner, Design system, Deck-E character, Chat UI gallery,
Character comparison, Scanner harness, Quad labeler and Training photo review
according to permission. Design editing requires the local design service.
Training-photo permission includes sensitive contributor captures. Admin links
and actions are excluded from Deck-E automation; no administrative agent tools
are added.

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

A credit is an integer service unit, not a promise of cash redemption or exact
provider spend. **USD value per credit**, **Provider-cost markup (%)**, three
estimated operation costs and the low-balance threshold control future quotes.
The policy uses:

```text
credits = max(1, ceil(estimated provider USD × (1 + markup % / 100)
                      / USD value per credit))
```

The API stores dollar amounts in microUSD (1 USD = 1,000,000 microUSD) and markup
in basis points (1% = 100 bps); the UI accepts decimal USD and percentages.
Calculations round up to whole credits with a minimum of one. Analysis/research
uses the analysis price; deck plans/strategies and unrecognized deep operations
use the deck-plan price.

Example: estimated cost **$0.02**, markup **50%**, credit value **$0.01** gives
**3 credits**. The marked-up amount is $0.03; its estimated gross margin is
33.3%, not 50%, before payment fees and other costs. That comparison assumes
credits are actually sold at the nominal $0.01 each. A **100-credit pack for
$1.00** has that effective unit price; pricing the same pack at $2.00 changes
its sales economics independently. Usage markup is not added to the pack
checkout price. None of these estimates measures realized profit.

Initial values deliberately preserve the old **1/4/75** operation prices and
all existing balances/events. The initial chat estimate is stale: the UI
contrasts its $0.000143 with the $0.01153 estimate in internal model notes.
Review estimates deliberately before selling packs; neither figure is a
guarantee of actual provider billing.

Saving creates a prospective pricing revision. Existing integer balances and
past charges are not recalculated; accepted work keeps its pricing snapshot.
One HTTP chat leg and its deep work share a revision, while each priced
operation has its own charge. Exact accepted-request replays are rejected
rather than obtaining another free invocation; changed requests are charged
independently.

Ensure eligible users have appropriate balances before enabling charging.
Use **Users → AI credits → Adjust credits** with a signed whole-number delta
and reason. Positive credits repay debt first. Disabling credit charging
returns Deck-E to the existing daily-cap mode; it does not erase the ledger.

### What cancellations cost

The charge and ledger reservation are atomic and fail closed if accounting
cannot establish the policy or balance. Cancellation or setup failure before
provider invocation is refunded idempotently. Once provider work begins,
failures and cancellations retain the quoted flat charge; there is no
token-by-token settlement. Unstarted reservations expire after five minutes
and are eligible for idempotent recovery on wallet reads. Recovery skips
reservations currently locked by another transaction, avoiding a wait cycle
with direct cancellation. That transaction may refund the reservation; otherwise
a later wallet read recovers it after the lock is released. Refresh the wallet
later if a refund has not appeared. Accounting connections are released across
a model stream.

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
secret and an enabled webhook matching this origin, mode and required event
subscriptions. Results may be cached for 60 seconds. No new readiness flag is
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
state. Provider cost is estimated for priced usage; older unpriced spends are
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
migrations 064–067, including direct SQL/RLS and concurrency boundaries; it is
not a full historical migration replay. Browser APIs/sessions and Stripe/model
responses are isolated fixtures. They do not establish live payment readiness.
