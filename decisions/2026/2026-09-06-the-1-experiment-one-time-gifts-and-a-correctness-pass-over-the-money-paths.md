---
date: "2026-09-06"
title: "The $1 experiment, one-time gifts, and a correctness pass over the money paths"
decided_by: "the owner, across a working session on `feat/pwyw-billing`."
areas: ["general"]
supersedes: []
---
## 2026-09-06 — The $1 experiment, one-time gifts, and a correctness pass over the money paths

**Decided by:** the owner, across a working session on `feat/pwyw-billing`.
Three product decisions and one review, logged together because the last one
changed the shape of the first three.

### 1. The $1 experiment (migrations 055/056, later 058)

*"Make it so that half the time, there is also a $1 option — gather data on
which one was shown and the result, so that later we can analyze whether
including a $1 option results in higher conversions or if it just results in
people defaulting to a lower amount and therefore less revenue."*

Two ladders differing by exactly one rung. The arm is assigned once by
`random()` inside `billing_touch_visit`, stored on the account and never
recomputed — sticky per ACCOUNT rather than per device, because a cookie split
counts one person twice in different arms and produces a confident wrong answer.
Every exposure, answer and dismissal goes to `billing_ab_event` with the arm
stamped on the row.

**The headline number is revenue per exposure, not conversion rate.** A $1 rung
will almost certainly raise the share who pay something; the entire question is
whether it drags the median down far enough that revenue falls. An experiment
that only recorded conversions could not have answered the thing that was asked.

### 2. One-time contributions (migration 057)

*"If they select 0, I'd like a follow-up asking them if they'd like to make a
one-time contribution instead. So we lead with subscription, but follow up with
the option to do one-time."*

One follow-up, only after $0, never in the profile card — there $0 means "stop
my support", and following a cancellation with another ask is the behaviour this
product was written not to have. It reuses the subscription's card path rather
than growing a second one.

It has its OWN event kind. Recording it as `chose` would have folded a one-time
$25 into a monthly-recurring sum — a 12× overstatement — landing
preferentially in whichever arm produces more $0 answers, i.e. biased toward the
thing being measured.

### 3. A testing override that disables itself

The prompt is deliberately hard to see twice, which also makes it untestable.
`?prompt=` forces it, works only while `stripeMode` is `test` (read server-side
off the key's prefix), and labels its events `forced-` so they are excludable.
It switches itself off when live keys arrive rather than depending on anyone
remembering to remove it.

### 4. The correctness pass, and why it happened

A fresh-context review of the whole branch was commissioned before merge, on the
owner's instruction that *"this is payments so it needs to be correct"*. It
returned a no-go with seven money-path defects. The security model — webhook
signatures, RLS, no card data, no secrets in logs — was found sound; the
correctness of the Stripe interactions was not. What was wrong, and now is not:

- **A transient Stripe error orphaned a paying subscription.** `ensureCustomer`
  caught EVERY error from `customers.retrieve` and fell through to creating a
  new customer. A timeout or a 429 during any billing request would mint an
  empty customer, overwrite `stripe_customer_id`, show the reader "$0, no card",
  drop that customer's webhooks — and leave the old subscription charging
  monthly, invisibly, with no way to stop it in the app. Only `resource_missing`
  now falls through; everything else propagates as a 502 the reader can retry.
- **Replacing a card never reached the subscription.** Creation pinned the first
  paying card at the SUBSCRIPTION level, which Stripe charges in preference to
  the customer default, while adopting a new card only updated the customer. The
  whole dunning path — "updating your card here puts it straight" — changed
  nothing, and never retried the failed invoice either. The pin is gone, the
  customer default is the single source of truth, and the outstanding invoice is
  now paid.
- **Retrying an abandoned first payment charged the old amount.** An
  `incomplete` subscription has a FINALIZED invoice; repricing it does not
  regenerate one. Pick $25, abandon the bank's challenge, come back, pick $1 —
  and the confirm charged $25. `incomplete` is no longer modifiable; it is
  cancelled and replaced.
- **Replacing a card un-cancelled a pending stop.** The profile card re-sent the
  current amount to promote a new card, and that path sets
  `cancel_at_period_end: false`. Somebody who said $0 and then updated an
  expiring card would have been billed the next month. Card replacement is now
  its own endpoint that touches neither the amount nor the cancellation.
- **No idempotency keys on subscription or payment-intent creation.** Two tabs,
  two charges. Keyed per customer, amount and one-minute bucket, so a
  double-submit collapses and a deliberate retry still works.
- **Success screens asserted outcomes they had not checked.** Completing a bank
  challenge is not the same as the charge succeeding; both the subscription and
  the one-off path showed "Thank you — genuinely" on the strength of
  `handleNextAction` not erroring. Both now read the actual status.
- **The experiment counted itself wrong.** Every completion also recorded a
  dismissal (the prompt acks on the way out of a finished flow too); forced-mode
  dismissals were unlabelled; and the documented sum double-counted every amount
  change. All three fixed, and the corrected query lives in `billing/store.ts`
  because 055's header cannot be edited (B4).
- **`SUPPORT_METADATA_KEY` was written and never read**, while the lookup took
  whatever subscription came first — so a hand-arranged subscription on the same
  customer would have been repriced by the next in-app change. It now filters.

**Implications:** migrations 055—060 are additive; 053—057 are applied,
058—060 are not yet. The review is re-run from fresh context until it returns
clean twice, on the owner's instruction. Nothing here changes the product
decisions above — it changes whether they were implemented correctly.

### 5. Round two: a cross-account disclosure, and a double charge

The second fresh-context audit found something the first had not, and it was
mine. `billing_apply_stripe` is executable by `authenticated`, so it is callable
over PostgREST with the anon key the SPA ships. 054's header argued this was
safe because the write "will only ever land on its own row" — true, and not
sufficient, because `stripe_customer_id` is a pointer into somebody else's
money. Planting a stranger's customer id in your own row would have had the
webhook, which resolved accounts purely from that column, sync their card brand,
last four, expiry and subscription state onto it.

Closed in both halves so it stays closed: the webhook now asks Stripe whether
the customer's metadata names the row owner (every route already did — the
webhook was the one path that did not, which is why it was the way in), and 059
pins the column write-once.

Also that round: the one-off idempotency key was bucketed by the minute, so a
charge that succeeded and then failed downstream told the reader to "check your
profile" — which shows no gift history — and their honest retry a minute later
was a second real charge. And two tabs at different amounts both created a
subscription, the loser billing invisibly forever.

### 6. Round three: the fixes fought each other

Worth recording because it is the argument for the loop. 059's write-once pin
broke `ensureCustomer`'s recovery path: when Stripe says a stored customer is
deleted it makes a new one, and the follow-up write then raised "cannot be
repointed" — on every request, minting an orphan Stripe customer each time.
060 adds release-to-NULL, which is safe in the way repointing is not: NULL
cannot be aimed at anybody.

And `cancelStraySubscriptions`, added in round two under a commit titled "stop
double-charging", did not. Cancelling a subscription does not refund the invoice
it has already collected, so the two-tab race still billed both first months and
reported success twice. It now refunds before cancelling, and the three
money-moving routes take a per-account advisory lock so the race does not happen
at all.

Two comments in that round also described behaviour the code did not have: a
client re-post that was never written, and a fix that had only half applied
because the script making it aborted midway. In a branch where each round reads
the last one's comments as evidence, a confidently wrong comment is a defect,
and they are recorded here rather than quietly corrected.

Also: a declined one-off could never be retried. Stripe replays a stored
response for an idempotency key for 24 hours, declines included, so holding the
attempt id across a decline meant every retry got the cached refusal without the
bank being asked again — while the screen said "try again, or use a different
card". The id is now kept across AMBIGUOUS failures, which is where it prevents
a double charge, and minted afresh after a settled one.

### 7. Round four: one cast, and the whole feature was dead

The lock added in round three to stop the two-tab double charge was
`pg_advisory_xact_lock(8534071, hashtextextended($1, 0)::int)`. `hashtextextended`
returns a 64-bit bigint and a cast to `int4` in Postgres is range-checked, not
truncating — so it raises `integer out of range` for essentially every uuid.
Measured against real Postgres: 0 of 200 survived. The lock is taken before the
try/catch on all three money routes, so in production every subscribe, every card
change and every gift would have been a 500, including choosing $0 in the
onboarding modal. Nobody could have paid anything.

It failed safe — the raise happens before any Stripe call, so no money moved —
and it was invisible to the test suite, which never enters SUPABASE_MODE and
where `lockAccount` is a deliberate no-op. That is the lesson worth keeping: the
tests are green on a code path production does not take. The single-argument
form is now used, with the namespace folded into the hashed string, and it is
verified against Postgres rather than reasoned about.

Three more from the same round, all in the one-off gift:

A declined card is a THROWN error, not a `paid: false` response — so round
three's "a decline can now be retried" fix sat on a branch declines never reach,
and the comment above it described the opposite of what the code did. Twice now
in this feature a fix has landed one branch away from the bug. The retry rule is
now written where the decline actually arrives: a 400 is a settled refusal and
earns a fresh attempt id, anything else is ambiguous and keeps the old one.

`chargeOnce` returns `paid: false` for a `processing` intent as well as for a
refusal. The challenge path knew that; the path with no challenge did not, and
told the reader "nothing has been charged" while minting a new attempt id — an
invitation to pay twice, with the new id guaranteeing the second charge would go
through. The intent's status now travels with the verdict, because the boolean
alone cannot be spoken aloud.

And `/one-time/confirm` verified only that the intent belonged to the account,
which is true every time the same intent is submitted. One paid gift could be
posted twenty times, and a subscriber could post their own first-invoice intent
and have a recurring charge counted as one-off support. It now checks the
metadata this flow stamps, and migrations 061/062 give the event log a
`dedupe_key` so the write is unique per account per Stripe object.

**On the "two independent locks" claim.** 059 and 060 each said the write-once
pin and the webhook's ownership check would hold alone if the other were
refactored away. That is not true: release-to-NULL followed by a set is two
permitted calls that together reach any customer id no other row holds. The
disclosure stays closed because of the ownership check, full stop. The pin is
depth — it makes a repoint deliberate, two-step, card-summary-wiping and now
logged, rather than a single silent write. SECURITY.md carries the accurate
version; the two migration headers are left as shipped, because they are applied
migrations and correcting them in place is what B4 forbids.

⚠️ **That last clause was wrong, and §33 acts on it.** 059 and 060 are NOT
applied — they are in the 058—063 batch the owner has still to run — so B4
never forbade correcting them, and the sentence left two headers claiming
"either fix alone closes the disclosure" for twenty-five rounds, directly above
the check a refactorer would delete. Both are corrected in place now, along with
`webhook.ts`'s copy of the same claim. The lesson is the one this branch keeps
relearning: a reason not to do something is a factual claim, and it expires.

### 8. Round five: a JavaScript catch does not undo a Postgres raise

The first review to come back GO, and it still found something worth the round.

`recordAbEvent` wraps its call in try/catch and logs a warning, on the reasoning
that an analytics row is never worth failing a payment over. That reasoning is
right and the code did not implement it. In SUPABASE_MODE every statement in a
request runs inside the one transaction the RLS middleware opens, so when the
function RAISEd, Postgres put that transaction into the aborted state and every
later statement failed — the catch swallowed the JavaScript error while the
whole request rolled back at COMMIT. An account that had deliberately spammed
itself past the new daily ceiling could then make a gift, have Stripe charge it,
and have the entire database side rolled back behind a 502, with every retry
replaying the same charged intent.

Two changes, both wanted. The ceiling now DROPS the event instead of raising,
because it is the only guard a caller might brush against by accident. And the
API takes a SAVEPOINT around the call, so the two guards that DO still raise —
the amount cap and the unknown kind, both unreachable from our own code — roll
back the event write and nothing else. Verified against real Postgres: without
the savepoint the following statement fails with "current transaction is
aborted" and the request's writes are lost; with it, they commit.

That is three rounds in a row where a comment described behaviour the code did
not have, and this one was in a migration header as well. The pattern is
specific enough to name: the comments have been right about the INTENT and wrong
about whether the mechanism achieves it. Reasoning stops at the language
boundary — JavaScript's error handling looks like it contains a database error,
and does not.

Four smaller things from the same round. The amount is part of Stripe's
idempotency key, so holding the attempt id across an ambiguous failure only
protected a retry at the SAME amount — the chooser stayed live under the words
"do not pay again", and nudging $25 to $20 would have made a second real charge.
It is frozen now until the attempt resolves. The subscription's challenge path
never learned the `processing` lesson the one-off path learned last round, and
would have said "nothing has been charged, try again" for money still in flight,
where retrying cancels the incomplete subscription and starts a second first
month. `/setup-intent` creates the Stripe customer and took no lock, so two tabs
opening the card form raced into 059's pin and left an orphan customer behind.
And `refundStraySubscription` refunded `latest_invoice` only, which is right for
the two-tab race it was written for and wrong for the case it is insurance
against — a stray that survived because the cleanup itself failed, and has been
billing quietly for months. Refunding one of three months is worse than
refunding none, because it looks settled.

### 9. Round six: the same miss, on the branch the fix was written for

Round five froze the one-off amount after an ambiguous failure, because the
amount is inside Stripe's idempotency key and a retry at a different amount is a
second real charge rather than a retry. It froze the thrown-error path and left
both `processing` branches unfrozen — the two places where the screen says "do
not pay again" in so many words. Gift $25, watch it go to `processing`, nudge
the still-live chooser to $20, press: $45 for one gift. Section 8 above said "it
is frozen now until the attempt resolves", which was not true when it was
written.

That is four rounds running, and the shape never changes: the diagnosis is
right, the fix is right, and it lands on one of the two or three branches that
reach the fault. Worth stating as a rule for anyone extending this file — when
you fix a payment path, enumerate every branch that reaches the state you are
fixing and put the fix on all of them, or put it somewhere all of them pass
through. A comment saying "fixed" is worth nothing next to that list.

The round also found a refund that could take back real money. `paused` is in
`LIVE_STATUSES` but not `MODIFIABLE_STATUSES`, so an amount change on a
subscription the owner had paused from the dashboard takes the CREATE path, and
the stray sweep that follows would have found the paused subscription "live, and
not the one we are keeping" and refunded its entire collected history before
cancelling it. Months of legitimate support given back for changing an amount.
`paused` is excluded from the sweep now, and the function's docstring no longer
claims a guarantee it cannot enforce from the inside — the caller's filter is
what makes it true.

Three smaller ones. `/refresh` is a re-read and was creating Stripe customers:
unlocked, so two concurrent calls raced into 059's pin, and it minted a customer
for any $0 account that touched it, contradicting the rule two routes over that
$0 with nothing on file never reaches Stripe at all. A refund that threw
mid-sweep abandoned the remaining months while the caller cancelled anyway, so
each month now fails on its own and an incomplete refund is logged with the
subscription id the owner needs to finish it by hand. And the webhook's
claim-before-process dropped an event for good when processing failed: 053
reasoned that the next event for the customer would repair the row, which is
true of everything except the terminal events — there is no next event after
`customer.subscription.deleted` on an immediate cancel. The claim is released on
failure, which is safe because every handler is a full re-read rather than an
increment.

### 10. Round seven: round six broke its own rule in the same commit

Section 9 wrote the rule down — enumerate every branch that reaches the state
you are fixing — and then fixed the one-off's three `processing` branches and
left the subscription's. Choosing a new amount while a first payment is settling
cancels the subscription the money is heading for, so the charge lands against a
cancelled subscription where the stray sweep never looks, and then bills a fresh
first month beside it. Two months for one, the same shape as the gift.

The fix is deliberately not another branch. `setSupport` refuses outright when
the existing subscription is `incomplete` and its first payment is `processing`,
checked once at the top rather than at the two places that cancel — so a third
cancel added later cannot miss it. The client disables its controls too, but
that is now the belt and not the braces. `requires_action` is deliberately NOT
treated as in flight: that is the abandoned challenge, and refusing it would
break "pick $25, walk away, come back, pick $1", which is a fix from round one.

The webhook ledger had the same shape of problem one level down. 053 wrote the
event id before processing so two deliveries could not both act, and the handler
read the row's existence as "already done" — two different facts in one column.
A concurrent delivery got a 200 while the first attempt was still running, so
round six's release-on-failure fired into a void Stripe had already stopped
retrying; and an attempt killed between claim and completion never reached the
release at all. 063 splits `claimed_at` from `processed_at`: only processed
earns a duplicate 200, a fresh claim answers 409 so Stripe comes back, and a
claim older than five minutes belongs to a dead attempt and may be taken over.
Verified against real Postgres including the backfill of existing rows.

Two smaller ones, both about `paused`. Round six stopped the stray sweep
refunding a paused subscription's whole history; it did not stop an amount
change from creating a SECOND subscription beside the paused one, which would
double-bill the day the owner resumed it, nor stop `$0` from reporting "you are
on $0" while the paused subscription waited to start charging again. Amount
changes are refused outright while a managed subscription is paused, because
nothing in this app pauses one — the owner did it from the dashboard, and
undoing it is a dashboard action too. And `/portal` was the last route reaching
`customerFor` without the advisory lock, which matters because `customerFor`
WRITES when Stripe says the stored customer is gone: the state every account
that touched the test-mode preview is in if the go-live cleanup is skipped.

Also recorded, not fixed: `billing_release_customer` has no "not while you are
subscribed" check. Adding one means deciding from the row's CACHED status, and
the one time it matters is when that cache is wrong — which is precisely the
state that produced the 502 loop in §6. It is self-harm with no reach into
anyone else's data, so it is named in SECURITY.md instead of patched with a
constraint that would trade a real outage for a self-inflicted one.

### 11. Round eight: the sentence that had never reached a browser

Round seven made two refusals — "your bank is still processing your last
payment" and "your support is paused" — and taught `stripeFailure` to let a
deliberate refusal past its 502 wrapper. Both classes extended plain `Error`
with a `status` property bolted on, and `errorMiddleware` honours `ApiError` and
nothing else: it does not read a `status` property. So every one of those
refusals reached the reader as **500 Internal server error**, and so did the
502 wrapper — which means "Open your profile to check whether it went through
before trying again", the sentence written in round one to stop a one-off being
paid for twice, had never once been rendered in a browser in any round of this
work.

The money was still safe, but by luck: a 500 falls on the AMBIGUOUS side of the
client's 400-means-settled rule, so the frozen amount and the held attempt id
did their job anyway. What was lost was every explanation. API.md documented the
two 400s and the round-seven commit claimed "a deliberate refusal stays a 400";
neither was true.

Same class as the last five rounds, one layer lower: the diagnosis right, the
mechanism stopping one step short of the reader, and the docs describing the
intent. So this round adds the thing none of the previous ones had — a test on
the error funnel itself, including an explicit assertion that a plain Error
carrying `status = 400` is NOT honoured. 118 pure tests had never touched it,
which is how it survived seven reviews.

The pass-through is now `err instanceof ApiError`, which also closes a hazard
the property check had left open: stripe-node's own errors carry `statusCode`,
and had they carried `status`, duck-typing would have let raw upstream messages
through to the browser.

Three smaller. A stray subscription whose first payment was still settling could
be cancelled by the sweep — its invoice is not `paid` yet, so the refund pass
finds nothing, and the charge lands against a cancelled subscription where
nothing ever looks again; the same in-flight refusal `setSupport` makes now
guards the sweep. A paused subscriber was shown the monthly check-in, where
every possible answer is refused, so the prompt is suppressed for `paused` and
the profile has copy for it instead of "you are on $0, which is a perfectly good
answer". And the one-off's Give button stayed enabled while the amount was
frozen: pressing it cannot double-charge, but on the challenge path Stripe
replays the original `requires_action`, `handleNextAction` fails on it, and the
copy then asserts "nothing has been charged" over money still settling.

### 12. Round nine: a personal access token could spend your money

Every billing route sat behind `resolveIdentity` alone, and a personal access
token (`dsk_—`) resolves to a user exactly as a session does. So a token could
set somebody's monthly amount, charge a one-off of up to $500 against their
saved card, cancel their support, and open a Stripe portal session showing their
invoice history, billing address and card management.

These are tokens minted specifically to hand to third-party AI clients. The
repo's own doctrine already said this — `/tokens`, `/avatar` and `/oauth` are
behind `requireSession` on the reasoning that "a token reads a collection, it
does not restyle the account" — and money is account administration by any
reading of that sentence. The billing router was written after those and simply
did not inherit the rule. `requireSession` now, and no client loses anything:
both web surfaces use sessions.

Second, the one thing this review could not settle from the code. The webhook's
signature is over the exact bytes Stripe sent, and Vercel's Node helpers can
read and JSON-parse the body before `express.raw()` gets the stream — the same
interference `http.ts`'s `toBuffer` exists for on the avatar routes. Parsed, the
bytes are unrecoverable: key order and whitespace are gone. The failure looks
identical to a wrong secret, so EVERY delivery 400s while cards go on being
charged, which is the worst state this feature has.

It cannot be proven from here, only observed on a real deployment, so the code
now makes it observable: recoverable shapes are recovered, and the one that
cannot be says so — a 500 whose log names `NODEJS_HELPERS=0` and DEPLOYMENT.md,
rather than a signature error nobody could act on. The go-live runbook's
"send a test webhook and confirm a 200" step remains a real gate, not a
formality.

Also this round: the regression test added in round eight would have passed a
revert of the round-eight fix, because it constructed its own `ApiError`s rather
than naming the two refusal classes. They are exported and asserted now — a
test that cannot fail on the change it guards is scenery.

Two known gaps, recorded rather than fixed. A stray subscription skipped because
its first payment was settling is never revisited — §25 corrects this sentence,
which said "only revisited on the account's next amount change" and was wrong
about every path. The honest close is a sweep where all three paths converge, or
on the webhook's `invoice.paid`, and adding one in the ninth round of a review
loop is precisely how rounds six and seven went wrong. And a supporter above the $500 ceiling is arranged by hand, so their
subscription must be stamped with the `deckpal_support` metadata or `pullState`
cannot see it and the check-in asks the product's largest supporter for money
every month for ever; that is now in the runbook and beside the error message
that sends them to email.

### 13. Round ten: the first GO, and the four things it still found

No blocker and no money defect. Four small ones, and two of them are the same
class this loop keeps producing — a guard that covers one writer and a sentence
that describes it as if it covered both.

`support_cents` was clamped inside `billing_apply_stripe` (059), which covers
every write a ROUTE makes. The webhook does not go through the RPC; it writes
`pullState`'s figure straight to the table as its owner. The only subscription
that can exceed the ceiling is the >$500 supporter the runbook has the owner
arrange by hand — and for one of those, the row flip-flopped between the
clamped and the real figure depending on which writer went last, and above
$5,000 the webhook's UPDATE violated 053's CHECK, so every event for that
customer failed for ever, wedging the row permanently stale. Clamping in
`pullState` puts it at the source both writers share, which is the only version
of "clamped display" that was ever true.

The other: `express.raw()` does not necessarily hand over the parsed object when
a platform layer has consumed the stream. body-parser skips only a request it
believes was already read, so it can re-read an ended stream and hand over a
ZERO-LENGTH Buffer — which passes `isBuffer`, fails the signature check, and
produces the misleading 400 that round nine's whole diagnostic branch exists to
stop giving. Empty is now treated as lost; Stripe never signs an empty body.

And `attemptId` — the string that makes a double-submitted gift one charge —
was documented as required and implemented as optional, falling back to a coarse
minute bucket when absent or malformed. That is the protection silently
downgraded for any caller that is not our own client. It is required now.

### 14. Round eleven: `succeeded` was not on the list

The in-flight guard added in round seven enumerated `processing` and argued
carefully about why `requires_action` is excluded. It never considered
`succeeded`, and there is a window where an `incomplete` subscription has one:
the subscription is read first and its payment intent second, so a reader who
completes their bank's challenge in another tab in that gap — or Stripe's own
`incomplete` → `active` transition simply not having landed — presents exactly
that pair.

Letting it through cancels a subscription that has already collected a month.
The replace path has no refund sweep for it, either: once cancelled it is
outside `LIVE_STATUSES`, so `cancelStraySubscriptions` never sees it again, the
money is silently kept, and the new subscription bills a second first month. An
`incomplete` subscription whose payment has succeeded is mid-transition, and
"give it a minute and reload" is the right answer to every request about it.

Round ten's empty-body fix had the same shape at a smaller scale: it landed on
the Buffer branch and left the Uint8Array and ArrayBuffer ones, so a
zero-length body in either of those shapes still produced the misleading 400 the
function exists to prevent. The emptiness test is now after the recovery rather
than inside one branch of it — which is the general form of the fix this loop
has needed nine times: put the check where the paths converge.

Three sentences corrected against their code. SECURITY.md said a Stripe error's
message never reaches the log; it is true of `stripeFailure`, the only funnel
that can see a decline, and untrue of three writers outside it whose calls are
reads, cancels and refunds. `store.ts`'s header said the plain-SQL arm lets
`pnpm dev --local` exercise the prompt scheduling; every billing route gates on
`billingAvailable()`, which requires SUPABASE_MODE, so those arms are
unreachable today and are documentation of intent rather than a tested path.
API.md said every endpoint answers `available: false` rather than an error on a
Stripe-less deployment; the reads do, and the money routes deliberately refuse
with a 400 instead, because a page may ask what the tier is but nothing should
quietly no-op a payment.

### 15. Round twelve: two dead ends, and a comment that was wrong about its own fix

Nothing that costs money this round. Two ways to strand a reader, and both are
the familiar shape.

The subscription flow's post-challenge check fires for two OPPOSITE reasons: a
payment that landed while the subscription's status lags, and a card refused
after authenticating. Round eleven latched the controls on both, because it read
the SUBSCRIPTION's status — which cannot tell them apart — leaving a declined
reader with a disabled chooser and nothing to do but reload, beneath a sentence
inviting them to try again. Worse, the comment added with that latch said the
server refuses the retry "regardless", and it does not: `firstPaymentInFlight`
correctly lets a settled refusal through, which is the whole point of it
excluding `requires_payment_method`. The latch now follows the INTENT's status,
which is the thing that actually knows.

And a one-off refused after the bank's challenge arrives as `actionError`, a
third path a decline can take, and that branch neither rotated the attempt id
nor thawed the amount. The next press replays Stripe's stored response for the
same key — the original `requires_action` and a secret for an intent no longer
in that state — so `handleNextAction` fails on it and every retry loops until
the sheet is closed and reopened.

⚠️ **That paragraph was written before the change it describes, and the change
did not land.** The script making it aborted on an earlier hunk and the edits
after it never ran, so §15 shipped claiming a fix the tree did not contain —
in the commit titled "a comment wrong about its own fix". Round thirteen caught
it. Recorded rather than silently corrected, because it is the second time a
half-applied edit has produced a confidently false comment here (see §6), and
the lesson is procedural: after an edit script, GREP FOR THE CHANGE. An
assertion that a script ran is not evidence that it finished.

The 24-hour idempotency replay has now caused three separate bugs in this file,
each on a different path a decline can arrive by; the rule is stated once and
applied on all three: settled refusals rotate the id, ambiguity keeps it AND
freezes the amount.

Two counts corrected. SECURITY.md said three writers log a Stripe message
outside the funnel; there are five, and the signature-verification line is one
of them. API.md put `/prompt-shown` on the list of endpoints answering the
common shape; it answers `{ recorded }`, deliberately, as its own entry sixty
lines later says.

### 16. Round thirteen: the fix that was written down but not written

The blocker was §15 itself. Round twelve's edit script aborted on an earlier
hunk, so the one-off's `actionError` rotation never reached the tree while the
commit message and DECISIONS both said it had. Both consequences were live: a
card refused after the challenge looped for ever on Stripe's replayed
`requires_action`, and an ambiguous `actionError` left the chooser unfrozen
under the words "nothing has been charged" — a nudge from $25 to $20 there is a
second real charge, the exact shape round six was a headline fix for, on the
third branch.

It is in now, on all three paths, with the ambiguous side freezing rather than
inviting. The procedural lesson is written into §15: grep for the change after
an edit script, because "the script printed ok" is not evidence it finished.

The same round found the client calling a SUCCESSFUL amount change a decline.
`PAID_STATUSES` was `active`/`trialing`, which is right for a first payment and
wrong for a `past_due` subscriber changing their amount from the profile: the
update succeeds, the server records the `chose`, and the reader is told "your
bank confirmed it, but the payment did not complete" with a retry that is
idempotent and therefore loops. It mirrors the API's `PAYING` set now, which is
what "settled" has meant on the server all along.

And the post-challenge branch reads `lastIntent`, which is null when no
challenge happened — an `incomplete` subscription whose first charge is
settling or was refused off-session, and unknowable from the client. It no
longer asserts a refusal there: only an intent that actually says
`requires_payment_method` or `canceled` gets the decline copy, and everything
else locks and says the payment has not finished settling, which is what the
server enforces anyway. `chargeOnce`'s `attemptId` is required rather than
optional, so the minute-bucket fallback cannot be re-armed by a future caller.

### 17. Round fourteen: locks that erred toward stranding

Second consecutive round with no money defect. What it found were guards
answering a question they had not asked.

Rounds twelve and thirteen made the ambiguous side of `actionError` freeze the
amount and lock the chooser, on the reasoning that a connection lost after the
challenge may have left money moving. True — but "not a `card_error`" also
covers the reader simply CLOSING the bank's window, where nothing was charged
and the server explicitly allows a new amount (`requires_action` is deliberately
not in flight). Those readers were locked behind a control only a page reload
reopens, mid-onboarding. Both branches now retrieve the intent and lock only on
`processing` or `succeeded`. One extra read, and the guard stops guessing.

The profile's "use a different card" panel ignored the `settled` flag the
endpoint returns. `retryOpenInvoice` sits behind it and a new card can be
refused as readily as the old one; the dunning modal checked this and the
profile panel did not, so somebody replacing a card to clear a failed payment
saw the panel close and reasonably took that as done.

**Known gap, recorded not fixed.** A first charge that goes to `processing`
WITHOUT a bank challenge settles minutes later with nobody on the page, so no
`chose` event is ever recorded for that conversion — and the one-off has the
same hole for the same reason, plus one of its own: the `processing` response
carries no intent id to the browser, so `/one-time/confirm` could not be called
for it even if somebody were still there. The lagging-status case is
now reported (the client asks again once the subscription catches up), but the
genuinely-later case needs the webhook to record it — and the webhook knows the
arm from the row and does not know the prompt context. It is analytics only,
roughly arm-neutral, and building a webhook-side experiment recorder in the
fourteenth round of a review loop is exactly what §12 warns against.

⚠️ **§44 reverses the decision below.** 053's header was right and this entry
was wrong: `prompt_last_shown_at` is stamped when the ask is SHOWN, and
`/prompt-shown` does it now.

Also noted, not editable: 053's header says `prompt_last_shown_at` is stamped
when the re-ask "has been shown". It is stamped on `/prompt-ack`, i.e. when the
sheet is closed, so a reader who kills the tab with the modal open is re-asked
next session — defensible (an unanswered ask was not settled) and described
correctly in API.md and here. 053 is applied, so B4 forbids correcting the
header in place; this paragraph is the correction.

### 18. Round fifteen: two readings of one fact

Third consecutive round with no money defect, and the finding worth keeping is a
new shape of the old mistake. Round fourteen taught the one-off's ambiguous
`actionError` branch to ASK the intent instead of assuming — and then used the
answer for one of the two decisions that branch makes. Freezing consulted the
intent; ROTATING still went by the error type. So a settled refusal that only
the retrieve could see kept its attempt id, and the next press replayed Stripe's
stored `requires_action` for ever: the round-twelve retry loop, surviving on a
sub-reading of the round-fourteen fix.

One reading now drives both. Where a guard makes two decisions about the same
fact, the fact is read once.

The profile's card panel showed the new "it still did not go through" alert
directly above the dunning note that says updating your card will put it right.
The reader had just updated their card and it had not. The note is suppressed
while the error is up; the error is the newer fact.

And the known analytics gap in §17 has a one-off half, recorded there: a gift
that goes to `processing` without a challenge cannot be confirmed later either,
because the response carries no intent id to the browser.

### 19. Round sixteen: the same rule, one component over

Fourth consecutive round with no money defect. §18's rule — where a guard
makes two decisions about one fact, read the fact once — was applied to the
one-off's `actionError` branch and not to the subscription's, which sits eleven
lines away and does exactly the same thing. Its retrieve drove the lock and the
error type still drove the sentence, so a refusal the intent named plainly was
described to the reader as "we could not confirm what your bank decided". Not a
stuck state this time (the subscription create key is derived from the replaced
subscription's id, so each retry is a fresh key) — but the asymmetry is the
tell, and a rule recorded in one branch and not its twin is not a rule.

Three more. The note suppression added last round was keyed to THERE BEING an
error rather than to WHICH error: "could not open the billing portal" has
nothing to say about a failed payment or a pending stop, and it hid the dunning
guidance until another portal attempt or a card save — potentially for ever.
The suppression is keyed to the error's subject now.

The one-off's ambiguous branch retrieves the intent, sees `succeeded`, holds the
id — and did not report it. We are on that branch because the BROWSER lost
track of the challenge, not because the gift failed; skipping the report lost a
real conversion for no reason except which branch the reader arrived on. It
calls `/one-time/confirm` there now, which is dedupe-keyed and safe to repeat.

And the amount chooser keeps the last VALID amount selected when an entry is
rejected — right for the picker, since typing 750 over 75 should not drop you
to nothing, and wrong for the button, which went on offering "Support $75/month"
beneath a field reading 750 and an error. The server charges what the button
says so nothing was mischarged; the reader was misled at the one moment they
must not be. The chooser reports an unusable entry and both submit buttons
disable on it.

### 20. Round seventeen: the first round with nothing above minor

Fifth consecutive round with no money defect, and the first where nothing found
rose above MINOR. Both findings were the same shape as §19's, one turn further
in: round sixteen taught the ONE-OFF's ambiguous branch to report a gift the
retrieve says landed, and did not teach the SUBSCRIPTION's twin the same thing.
A reader whose browser loses track of the challenge ends with a live, charging
subscription whose `chose` is never recorded — and the population that lands
there is challenge-heavy issuers, which is exactly the bias `/one-time/confirm`
was built to prevent. It reports now.

The other: the dunning alert set by a card that failed to settle is about a fact
that can stop being true. Stripe's own dunning may collect the invoice minutes
later, and the alert — which suppresses the status note while it is up — would
go on hiding a note that by then reads "next payment on the 14th". Any refetch
showing the account no longer needs attention retires it.

**The residual worth stating plainly.** `firstPaymentInFlight` is read-then-act,
not atomic: the subscription is read, then the intent, then the cancel. A
challenge completing inside that window still cancels a just-paid subscription,
and a cancelled one is outside `LIVE_STATUSES` so no sweep ever refunds it. §14
narrowed this from "any lag" to "a single round trip", and closing it entirely
means either a Stripe-side lock that does not exist or a cancel-then-verify
compensation that would itself need a refund path. It is left as it is,
deliberately, and named here so the next person does not discover it as a
surprise.

### 21. Round eighteen: an effect that fired on its own flag

Second consecutive round with nothing above minor. The one worth reading is the
retire-effect added last round, which was keyed on `errorHidesNote` as well as on
the query data — so it ran the instant the flag was SET, against whatever
snapshot happened to be cached. An account that went `past_due` after the page
loaded had its brand-new "the outstanding payment still did not go through"
cleared in the same tick by data that still said `active`, and the reader was
left believing the card fix had worked. It is keyed on `dataUpdatedAt` now:
retirement needs a genuinely new fetch, which is what the sentence describing it
always said.

The other three. `SupportPrompt` inferred "they answered" from `onState`, which
`SupportFlow` also calls on failure and ambiguous branches — because the card
summary and the status on screen must stay honest whatever happened. A reader
who tried, failed and closed the sheet therefore recorded NEITHER a `chose` nor
a `dismissed`: the exposure vanished from the experiment. There is an explicit
`onAnswered` now, fired at the two points where an answer exists.

`actionError.message ??` took precedence over the settled-versus-ambiguous
sentence, in both twins. A decline's message is the reader's own and better than
anything written here; every other error's text says nothing about whether money
moved, and preferring it replaced the one sentence that does. Stripe's words for
a refusal, ours for everything else.

And SECURITY.md now names what the write-once pin does NOT do: the first write
is unchecked, because the RPC cannot ask Stripe who owns a customer id. The
disclosure stays closed on the ownership checks; what is left is that squatting
an id another account will later store turns their billing into unique-violation
errors until an operator clears the row. Accepted and named, so it is
diagnosable rather than mysterious.

### 22. Round nineteen: a signal that did not reach the branch that proved it

Third consecutive round with nothing above minor, and the finding is the same
family again, one level smaller. Round eighteen separated "they answered" from
"the state changed" and fired the new signal at the settled outcomes — but not
at the ambiguous branch where the RETRIEVE proves the subscription is paying. So
that branch reported the conversion and did not claim it as an answer, and
closing the sheet posted a dismissal on top of the `chose`: both outcomes
against one exposure, which is precisely the overlap the signal exists to end.
It fires there now, and on the lagging-status branch beside it.

§21 and the docstring both said the signal fires "at the two points where an
answer exists". The tree had three when that was written and has five now, and
the docstring lists them. This is the fourth time in this branch a comment has
been confidently wrong about its own change — §6, §15, §19 and here — which
is why every round's prompt now tells the reviewer to treat prose as a claim.

Round eighteen's rule was "Stripe's words for a refusal, ours for everything
else", implemented as "ours unless `settled`". Those differ: `settled` is also
reached when only the retrieve saw the refusal, and there `actionError` is a
library failure whose text — "the PaymentIntent supplied is not in the
requires_action state" — says nothing a reader can act on, and it displaced the
sentence that does. Keyed on `card_error` now, in both twins, which is what the
rule said.

Also recorded, not editable: 053's header says the webhook resolves an account
by subscription id when an event carries no customer, and
`billing_account_subscription_idx` exists to serve that lookup. `webhook.ts`
never queries by subscription id — `customerIdOf` always resolves a customer,
falling back to `previous_attributes` for `payment_method.detached`. The index is
unused. 053 is applied, so B4 forbids correcting the header in place; this
paragraph is the correction, and the index is left alone rather than dropped in
the nineteenth round of a review loop.

### 23. Round twenty: freezing on proof, when the proof is what fails

The first finding above minor in four rounds, and it is round fourteen's fix
read back the wrong way round.

Round fourteen stopped the ambiguous branches locking on ASSUMPTION and had them
ask the intent instead — rightly, because "not a card_error" also covers an
abandoned challenge and locking on that stranded readers. But it then froze only
on a PROVEN `processing`/`succeeded`, and the retrieve most often fails for the
same reason the `actionError` happened: the network is still down. `status` is
then null, and the one-off's chooser stayed live under the words "do not pay
again", with the money's fate unknown.

That is a real second charge. The amount is inside the idempotency key, so
nudging $25 to $20 is a NEW key, not a retry — and the comment sitting under it
said keeping the attempt id "is the side that cannot double-charge", which is
true only of a retry at the same amount, the very thing an unfrozen chooser
stops it being. The subscription twin had the same client gap and is backstopped
by `firstPaymentInFlight`; the one-off has no server-side equivalent, because
nothing checks for an in-flight gift before creating a fresh intent.

The list is inverted now: thaw only for the states that PROVE nothing was taken
— `requires_payment_method`, `canceled`, `requires_action`,
`requires_confirmation` — and freeze for everything else, null included. A
wrong freeze costs a reload. A wrong thaw costs $20. Both twins.

Two smaller. When the retrieve PROVES the payment landed, both branches locked
and reported the conversion and then told the reader "we lost the connection
before your bank answered" — the retrieve's answer driving the lock and the
report but not the sentence, the last tail of §18's family. They say it went
through now. And `boot()` re-runs on `SIGNED_IN`, which supabase-js re-fires on
tab focus, so a refire inside the window between closing the sheet and the ack
committing reopened the modal on somebody who had just answered it. `exposed`
kept the experiment honest through that; a second ref now keeps the reader's
answer honoured.

### 24. Round twenty-one: a guard on the door and not on the timer

Nothing above minor, and the useful finding is that round twenty's own fix was
put where the function BEGINS rather than where it acts. `closedHere` was
checked on entry to `boot()` and after the session read — but not after the
`billingVisit` await, and not inside the 1400ms timer that actually opens the
sheet. A boot scheduled a beat before the reader answered fired a beat after,
and `setOpen(true)` put the modal back in front of somebody who had just
answered it. `close()` has no re-entry guard, so dismissing it again posted a
second `dismissed` against one exposure; and the reopened flow remounts against
that boot's now-stale state, so a reader who had just chosen $5 saw a button
reading "Continue with $0" and pressing it set `cancel_at_period_end` on the
subscription they made ninety seconds earlier.

The explicit dismiss button had the same shape of gap: the ✕ takes
`!answered.current` and "Not right now" took a flat `true`. Two branches leave
the flow on `choose` AFTER an answer is recorded, with the chooser and submit
disabled, so that button is the reader's only live control — and pressing it
posted a dismissal on top of the `chose`.

**The receipt was promised six times and guaranteed nowhere.** `chargeOnce` set
no `receipt_email`, so the promise rested on an account-wide Stripe setting
nothing in this repo turns on. That matters more than it sounds: a standalone
PaymentIntent produces no invoice, so the billing portal has no record of it
either, and 057 deliberately gives the profile no gift history. "Do not pay
again — check your email for a receipt, or your profile" was, for a one-off,
three places that could not answer. The charge names the address now, the
runbook has a step for customer emails, and the two strings no longer send
anybody to a profile that has nothing to show them.

And the last tail of §18's family, in both twins: the freeze read four states
and the sentence read two, so an ABANDONED bank window — nothing charged,
controls deliberately left live — was described as "do not pay again",
contradicting the button in front of the reader. `provenSafe` is hoisted and
drives the freeze, the rotation and the sentence together. The `confirmOneTime`
on that branch also returns the only fresh billing state we have and was
discarding it.

### 25. Round twenty-two: the string that renders, and the string that was fixed

Round twenty-one corrected the two client-side sentences that sent a one-off
contributor to a profile with no gift history. Neither of them renders. Every
real 502 from `/one-time` is an `ApiError` whose message the client shows
verbatim, and THAT sentence — in `stripeFailure` — still said "open your
profile". So the fix landed on the fallback and not on the path, which is this
loop's oldest shape at its most literal.

It matters because of what a gift leaves behind: nothing. 057 gives the profile
no gift history by design, and a standalone PaymentIntent produces no invoice,
so the Stripe portal has nothing either. On the one path where the reader most
needs a true instruction, both surfaces named were provably empty. `stripeFailure`
now takes the kind and sends a subscription's reader to their profile, which
does show subscription state, and a gift's reader to their receipt — which is
why round twenty-one made `chargeOnce` name `receipt_email` rather than trust an
account setting. There is a test for the gift half.

Second: the one-off's proved-success branch reported the conversion and left the
reader on the chooser. The only live control there was "No thanks", which took
them to a done screen reading "you're on $0, nothing changes" — the app telling
somebody who had just paid $25 that nothing was paid. And the thank-you rendered
inside `FlowError`, in red. Both twins now END where the happy path ends: the
proved branch is the happy path wearing a different coat, so it records the
answer, marks the flow spent, rotates the attempt id and shows the done screen.

Third, a comment that contradicted itself: `cancelStraySubscriptions` said a
skipped stray "is picked up on the account's next amount change and not before".
It has one call site, `setSupport`'s CREATE path — and a stray only exists
alongside a live subscription we kept, so the next amount change finds that one,
takes the UPDATE branch, and never sweeps. The $0 branch is worse: it sets
`cancel_at_period_end` on the modifiable subscription only, so "stop my support"
leaves the stray billing. Nothing revisits it. §12's sentence carried the same
error and is corrected. (§25 first said §17 — the wrong section, in the entry
written to correct a wrong sentence. Round twenty-three caught that too.) Understating a known gap is how it gets deprioritised.

### 26. Round twenty-three: the exit that contradicted the warning above it

Round twenty-two fixed the "you're on $0, nothing changes" screen for the ONE
one-off branch where the payment was proved, and left the four where it is
merely UNKNOWN — which is the worse half. On all four the chooser and the Give
button are frozen and "No thanks" is the reader's only live control, and it
navigated straight to that screen, erasing "do not pay again" in the same
transition. A reader whose $25 was still settling was told nothing was paid, and
then got a receipt. While an attempt is outstanding that button now closes the
sheet instead: the $0 answer is already saved, the ack is already due, and
nothing claims anything about the gift.

`/setup-intent` and `/portal` were still saying "open your profile to check
whether it went through". Neither can have had anything go through, and
`/setup-intent` is on the GIFT leg too — a $0 answerer with no card reaches it
from "Continue to card". They have their own sentence now, which is the third
`kind`.

Two about this loop's own machinery. The gift-502 test asserted on an `ApiError`
written out in the test, so the sentences it checked were the sentences it
supplied: it could not fail on anything, one round after §12 recorded exactly
that lesson about round eight's test. `stripeFailure` is exported and the tests
call it. They pin the sentences and NOT the call sites, which needs a request
through a route and a database this suite does not have — said plainly in the
test rather than implied, and the call sites are: `/setup-intent` no_charge,
`PUT /subscription` subscription, `/payment-method` subscription, `/one-time`
one_time, `/one-time/confirm` one_time, `/refresh` subscription, `/portal`
no_charge.

And §25 cited the wrong section for its own correction — §17 rather than §12
— in the entry written to correct a wrong sentence. Eight rounds now.

### 27. Round twenty-four: the branch that KNEW, and the one that guessed

The subscription's `processing` branch — where the bank has accepted the
payment and `handleNextAction` says so — was the only outcome branch in
`commit()` not firing `onAnswered`. Its strictly MORE ambiguous sibling, where
the status is null and the code cannot tell settling from refused, already did.
So `PUT /subscription` recorded no `chose` (the subscription is `incomplete`, so
`settled` was false), the branch never asked again, and dismissing — the only
live control once `inFlight` disables the rest — posted a `dismissed` for a
reader whose money was on its way. That biases whichever arm attracts more
challenge-then-`processing` payments, which is the bias `/one-time/confirm` was
built to prevent.

The `onAnswered` docstring said FIVE places and the tree had six: round
twenty-two added the gift's proved-landed branch and left the sentence, one
round after §22 corrected the same sentence for the same reason. It says seven
now, lists them, and says to keep the list in step or delete the count. Ninth
instance in this branch.

The done screen's $0 copy is not context-aware, and the profile card is one of
its two render sites: choosing $0 there produced "if you ever want to chip in,
it is on your profile page under Supporting DeckPal" — rendered inside that
section, on that page, under a button offering to take you back to where you
already were. Both are gated on `context` now.

And a deploy-sequencing hazard the runbook did not name. It warns about 059
without 060; it did not warn about 059 without THE CODE. `billing_release_
customer` is called from `customerFor`, which ships with this deploy, so between
the migration run and the deploy the running code writes a replacement customer
id straight through — and 059 raises "cannot be repointed" on every request
for any account whose stored id is unusable, minting an orphan Stripe customer
each time. By the runbook's own account that is every account that touched the
test-mode preview. Running the cleanup SQL BEFORE the migrations removes the
hazard rather than mitigating it: with no stored id there is no replacement path
to take.

### 28. Round twenty-five: a card the profile showed and nothing would charge

`defaultCard` deliberately falls back to any ATTACHED card when the customer has
no invoice default — somebody who entered a card and closed the tab still has
one on file, and pretending otherwise invites them to type it twice. So
`pullState` writes "Visa ···· 4242" onto a row whose customer Stripe would
refuse to bill, and `setup_intent.succeeded` makes that happen without the
reader coming back at all.

`chargeOnce` was fixed for exactly this, in round ten, with a comment reading
"the same card `defaultCard` displays, or the profile is lying". `setSupport`
was not. A returning reader whose row shows a card skips the card step, so no
`setupIntentId` is sent, so `adoptSetupIntent` — the only thing that sets the
invoice default — never runs; the subscription is created with no payment
method, and `finishFirstPayment` confirms an intent that has nothing to confirm
with. That is a `StripeInvalidRequestError`, not a card error, so there is no
reader-facing copy: a 502 saying "check whether it went through" when nothing
could have, identically on every retry. They can never subscribe from that flow,
and the only escape is a button on the profile card nothing points them to.

The recovery is one helper now, called from both charging paths, so the display
fallback and the two chargers cannot disagree again. That is the fix this
feature has needed ten times over: put it where the paths converge.

Three smaller. The gift's `processing` branch has the same analytics gap as the
subscription's — it settles minutes later with nobody there, `/one-time`
records only a succeeded intent, and no webhook records gifts because a
standalone PaymentIntent produces no invoice. The subscription side was named in
§17 and the gift side was named nowhere; it is named now, where the branch is.

060's header said an abusive release "inconvenienced nobody". Detaching a PAYING
row is real self-harm: the subscription keeps charging, the app shows $0,
`/portal` refuses, and re-subscribing bills twice. SECURITY.md already had the
accurate version and `routes/billing.ts` already flagged that 059's and 060's
headers overstate things; 060 is unapplied, so B4 permits correcting it in place
and it is corrected.

And the go-live cleanup cleared the Stripe cache and the experiment but not the
prompt clock, so an account shown the modal during the preview would have got up
to thirty days of silence after cutover — unverifiable, because `?prompt=` is
inert under live keys. A statement resets `prompt_last_shown_at`; `visit_count`
and `onboarded_at` are deliberately kept, because 053's backfill exists to give
an existing account the check-in rather than the welcome. Verified against real
Postgres in the order the runbook now prescribes: cleanup on the 053—057
schema, then 058—063 on top.

### 29. Round twenty-six: the shared helper that still disagreed

Round twenty-five made one helper so the card the profile SHOWS is the card
Stripe CHARGES. It unified the missing-default case and left the one branch
above it: `defaultCard` requires `pm.card`, so a NON-card invoice default — a
bank debit, or a Link PaymentMethod that is not card-backed — falls through to
the attached-card list, while the new helper returned it. Same lie, inverted:
the profile showing a card while Stripe charged something else. Both now take
the same three steps in the same order, and if an account has only a non-card
method both answer "no card" — the profile says so and the charge fails with a
named wiring error, which is the right way round.

The two callers also disagreed about what a null from that helper MEANS.
`chargeOnce` threw a named wiring error; `setSupport` ignored it and created the
subscription anyway, so `finishFirstPayment` confirmed an intent with nothing to
confirm: a 502 on every retry and a discarded `incomplete` subscription each
time. One helper, one meaning.

Named honestly rather than fixed: **Link is the one thing in this feature that
could not be settled by reading the code.** The Payment Element offers it
deliberately, it is normally card-backed, and if it ever presents as a non-card
PaymentMethod it lands in the same dead end as a bank debit. The runbook now
says to pay once with Link on live keys before inviting anybody, and to confirm
the profile shows a card and a second charge works.

Two more. "Nothing to enter until the next step" sat above the button on the
chooser — true for somebody who has not typed a card, and false for a
returning reader, where that button IS the charge. A sentence promising another
chance to change your mind, immediately above the control that takes the money.
Gated on `hasCard` now.

And the runbook's ordering did not compose: step 5's "run the cleanup SQL first"
lives inside a block headed "do the whole of this in TEST mode first", while the
cleanup section says "after the live keys are in place" and never said where the
migrations go. A reader following it literally would have run a go-live wipe in
test mode. There is an explicit six-step cutover list now: keys, cleanup,
migrations, deploy, re-run the webhook gate against the LIVE endpoint (the
signing secret differs, so the test-mode pass does not carry), then a real card
and a Link payment.

### 30. Round twenty-seven: two of the three branches that lock

No money defect. The finding is §27's, one branch over, for the third time in
this file: where the controls lock because the payment may be settling, that is
an answer given. `commit()` has three branches that lock, and two fired
`onAnswered`. The one left out is the branch where the RETRIEVE proved
`processing` — less ambiguous than the post-refresh branch, which already
fired. So a reader whose issuer challenged them, whose confirmation the browser
lost, and whose money is on its way had their only live control record a
walk-away, with no `chose` ever.

The lock and the answer are now one reading of one fact, inside the same `if`.
The docstring says eight and lists them; it has said two, five and seven while
the tree had three, six and seven.

And the module header's input inventory was three ways wrong: it named one id
and claimed "two ids", it predated both `attemptId` and `paymentIntentId`, and
it pointed at `service.ts` for a check that lives in `routes/billing.ts`. It is
now the same six-item list SECURITY.md carries, with where each is validated,
and both say to change the other.

**On Link.** Round twenty-six recorded it as unsettleable from the code; this
round sharpened why it matters. Apple Pay and Google Pay produce CARD
PaymentMethods — `card.wallet.type` is `apple_pay`/`google_pay` — so
requiring `pm.card` is safe for wallets, verified against the shipped SDK types.
But `PaymentMethod.Type` has a top-level `'link'` distinct from a card whose
wallet is Link, and a `type: 'link'` method would land in the bank-debit dead
end: both selectors return null, the profile says "no card on file", and every
attempt 502s. DEPLOYMENT step 6 is the only thing that catches it. **Treat it as
a gate, not a smoke test: if Link fails, do not invite anyone to pay.**

### 31. Round twenty-eight: the fix that overlapped its own sibling

Round twenty-seven added a branch beside one it overlaps. `succeeded` is not in
`provenSafe` — nothing was "safe", the money moved — so with the two written
as independent `if`s a proved success ran BOTH: `refreshBilling` twice for one
conversion. `/refresh` has no dedupe key, so one answer became two `chose` rows,
and `onAnswered`'s idempotence hid half of it. Verified in Postgres: 055's
published header query reports 1000¢ for a 500¢ conversion. `store.ts`'s
corrected `DISTINCT ON (user_id)` query is immune, which is why it is minor and
not serious — but the header query is the one somebody pastes.

They are `else if` now: one branch per outcome. That is this loop's own shape
appearing in the fix FOR this loop's own shape, one round later.

While there: the success branch handed `onState(next)` upward — the
PRE-challenge state — and discarded both refresh results, so the profile behind
the sheet could show $0 under a thank-you until a reload. It takes the refresh's
answer now, as the one-off twin already did.

And the input inventory exists in THREE places. Round twenty-seven fixed the two
it was looking at; API.md still carried the original defect verbatim — one id
named, "two ids" claimed. All three now list the same items and say to change
all three. All three were also missing a seventh input: `dismissed` on
`/prompt-ack`, which decides which of the two exposure outcomes is written. It
is inside SECURITY.md's already-accepted "an account can write a plausible event
about itself", but a list that says "and no more" has to be right.

### 32. Round twenty-nine: numbers beside lists have an expiry date

No money defect. Four small things, and three of them are the same lesson.

The input inventory's header said "Six things, and no more" above a list of
seven: round twenty-eight added `dismissed` to the list and left the word. The
security inventory told a reviewer the surface was smaller than the code
accepts. That is the third count-versus-list mismatch this feature has shipped
— the `onAnswered` docstring said two, five and seven while the tree had
three, six and seven — so the count is simply gone. A number beside a list is
a fact with an expiry date, and nothing checks it.

`promptDue`'s header listed four tests over a body of five. The missing one is
the `paused` gate: a dashboard-paused subscription reports zero cents, falls
straight through "anyone paying is never asked again", and every answer to the
modal it would then see is refused. The inline comments were complete; only the
summary a reader starts from was short.

`settled` in `commit()` had become write-only. It seeded `provenSafe` and was
then reassigned by a line nothing read — because `settled` earns its name in
the one-off twin, where it gates rotating the attempt id and thawing the frozen
amount, and a subscription has neither. A variable named like a guard that
guards nothing is worse than no variable; there is one now, and it says why the
twins differ.

And `close()` set `closedHere` without reading it, so two presses of the dismiss
button inside one commit window posted the ack twice — two `dismissed` rows
for one exposure, with no dedupe key. Exactly the shape §31 records for `chose`,
on the other outcome. The ref was already there; it was simply never tested at
the point that needed it, which is §21's "a guard on the door and not on the
timer" for the third time.

### 33. Round thirty: a reason not to act, which had expired

No money defect. The one worth reading is why a wrong sentence survived
twenty-five rounds.

`webhook.ts` and 059's header both said the metadata check and the write-once
pin were independent — "either fix alone closes the disclosure; both together
mean it stays closed if one is refactored away". §7 established in round three
that this is false: 060 permits release-to-NULL, so release-then-set reaches any
unheld customer id, and only the ownership check closes the cross-account
disclosure. §7 then declined to fix the headers, giving a reason: they are
applied migrations, and B4 forbids it.

They are not applied. 059 and 060 are in the 058—063 batch still waiting to be
run. So the sentence sat directly above the check a refactorer would delete,
inviting exactly that deletion, protected by a justification that was never
true. **A reason not to act is a factual claim, and it expires.** All three
copies are corrected, and `webhook.ts`'s now opens "THIS CHECK IS THE CONTROL.
DO NOT DELETE IT."

Two more counts, in the fourth and fifth places this feature keeps them.
`stripe.ts` — the module that OWNS the configuration gate — said "billing
needs three values and the interesting failure is having two", above a gate
reading `present === 4` and beside its own example of the dangerous state, which
is a deployment missing only the webhook secret. And `customerFor`'s docstring
said "the same three things" over a two-item list, missing item one: the
ownership check itself. Both fixed; `promptDue`'s summary, which said four over
a body of five and numbered two of them differently from the code, is now
un-numbered like the input inventory, for the reason §32 gives.

Also: `SupportFlow`'s own state diagram omitted the one-time step — a quarter
of the machine, with its own frozen-attempt exit — and `identity.ts` described
`currentUserEmail`'s single caller when there are two, the second being the
`receipt_email` that §24 made load-bearing.

### 34. Round thirty-one: the correction that landed on three of seven copies

Round thirty corrected the "either fix alone closes the disclosure" claim in
`webhook.ts`, 059 and SECURITY.md, and said "all three copies are corrected".
There were seven. The four it missed:

`service.ts`, directly above `ensureCustomer`'s metadata check — the TWIN of
the one `webhook.ts` now labels "THIS CHECK IS THE CONTROL. DO NOT DELETE IT."
— said migration 054 "is what stops a browser writing one" and called the
check "the second lock on the same door". Both halves are false, and 054 is in
fact the migration that CREATES the browser-reachable write: `billing_apply_
stripe` takes a `stripe_customer_id` and is executable by `authenticated`.
Verified in Postgres: one RPC call puts any unheld customer id into a NULL row,
no release needed. A refactorer reading "second lock" deletes the check as
redundant, and `POST /portal` then opens a Stripe billing portal on a stranger's
customer — invoice history, billing address, card management.

`routes/billing.ts` and API.md carry the same denial, and they are two of the
three copies of the inventory whose own instruction is "if you change one,
change all three" — the third, SECURITY.md, was the accurate one. And 060's
opening still credited the pin with closing the disclosure, in the migration
whose release-to-NULL is the reason it does not.

Separately, a runbook line that could have cost real money: "It is off until all
four `STRIPE_*` variables above are set." `billingAvailable()` requires THREE.
With three of four the tier is live — the prompt renders, cards are taken,
subscriptions are created — and nothing is ever heard back about a renewal, a
failure or a cancellation, which DEPLOYMENT itself calls the worst state this
feature has. An owner working the list top-to-bottom would have taken a real
card into it. The two thresholds are now named as two. (API.md had the same
conflation in one word, "configured", which means three variables for the routes
and four for `/health`.)

### 35. Round thirty-two: the correction that missed a paragraph in its own file

Round thirty-one rewrote 060's opening to say the pin does NOT close the
disclosure, and left the paragraph forty lines below that repeats it — "the
disclosure 059 closed needs the ability to name a target, and naming a target is
exactly what is still forbidden". Both halves wrong, in the same file, in the
same edit. Round thirty missed four copies across the repo; round thirty-one
missed one inside the file it was editing. **Grep before believing a correction
landed** is now written into 060 itself.

The same round-31 edit also left a stale pair citing each other: 060 said
"`routes/billing.ts` already notes that 059's and 060's headers overstate the
guarantee", present tense, about headers it had just corrected — and
`routes/billing.ts` said SECURITY.md "has the accurate version", when five files
now do. A citation is a claim about another file's contents and goes stale the
moment that file changes.

And `store.ts`'s own header said "every write here goes through one of the three
SECURITY DEFINER functions in migration 054". There are six, across four
migrations. It was true when written; the two added since are `billing_ensure_
row` and `billing_release_customer` — the second of which is the one function
that can zero a paying row, so a reader auditing the write surface from the
module that OWNS the write path was blind to exactly the one worth auditing.
SECURITY.md had been updated to six; the module had not. `webhook.ts` carried
the same count.

Also corrected: DEPLOYMENT said the deployed code "hard-requires every one of
058—063" and then named 059, 060, 062 and 063. 058 is a stepping stone — 062
drops and replaces its function outright — and it errs safe, but a list that
names four things after claiming six is the count-drift class again.

### 36. Round thirty-three: a false citation, written beside the rule against them

Round thirty-two named the stale-citation class and fixed two of them. In the
same commit it wrote a NEW false one, twelve lines above the paragraph telling
the reader to grep before believing a correction landed: 060's self-harm note
said "SECURITY.md carries the same account, and so now do 059's header,
`webhook.ts`, `service.ts`, `routes/billing.ts` and API.md". Only SECURITY.md
does. The other five carry a DIFFERENT account — the pin-versus-ownership-check
correction — and API.md does not mention release at all. Broadening a citation
from two files to six while correcting citations is a good demonstration of why
the class needs naming: a list of files is a claim about each of them.

`lockAccount`'s docstring said the lock is taken "on all three money routes".
Seven take it. Three was true in round four, and the sentence is the blast radius
a future regression here would be measured against — it understated it by more
than half. It now says "every route that takes it", with the number as an aside,
for the reason §32 gives about numbers beside lists.

And the `answered` ref in `SupportPrompt` still said `onState` "fires only after
a write the server accepted, so it is the honest signal". Round eighteen replaced
that mechanism with `onAnswered` and wrote the opposite into the JSX 135 lines
below, so the file has carried two contradicting statements about one ref for
fifteen rounds. The docstring is the one somebody reads first, and acting on it
— concluding `onAnswered` is redundant — re-opens the both-outcomes overlap
that §21, §22, §24, §27 and §30 went into closing.

### 37. Round thirty-four: the code answered, executed rather than read

Eight consecutive rounds had returned only prose defects, which is either
convergence or a reviewer drifting toward the easy target. So this round was
told to spend its budget on the code and the SQL and to report prose only if it
was load-bearing. It did, and it did not find a code defect.

What makes that worth recording is HOW it looked. It did not read the money
paths — it ran them: the compiled `service.js` driven against an in-memory
Stripe; the real `billingRouter` mounted on Express over PGlite; the real
webhook handler over the real 053—063 with Stripe's own signature verifier.
The scenarios it executed are the ones this loop has been arguing about in
prose for thirty rounds: two tabs at different amounts (the lock serialises
them; with the lock defeated, the sweep refunds all three months of the loser
with per-invoice keys); a card that 3-D-Secures and then declines ($1 billed,
not $25); Stripe transitioning a subscription between two of our reads
(`PaymentInFlightError` on every amount including $0, nothing cancelled); a
webhook arriving mid-request (its pre-commit snapshot resolves the old customer,
whose ownership check then fails, so it writes nothing); a retry storm (409 for
a live claim, takeover for a stale one, release-and-retry for a failure); and
the disclosure attack end to end — a stranger's `cus_` planted through the RPC
surface, then a genuinely signed `invoice.paid` delivered for it, and NOTHING of
the victim's card reached the attacker's row. Flipping the customer's metadata
makes it sync, which proves the ownership check is the thing doing the work.

The RLS surface was tried rather than reasoned about, as `authenticated` and as
`anon`: every write to all three tables is 42501, `billing_event` is unreadable,
all six definer functions refuse `anon`, the pin refuses a repoint but not a
release-then-set, and the daily ceiling returns rather than aborting — verified
25P02 with and without `store.ts`'s savepoint, which is the difference between a
gift charged-and-rolled-back and one recorded.

Six prose defects came with it, and the one worth naming is the third copy of
the three-versus-four threshold: the `STRIPE_SECRET_KEY` env row still said
"what is NOT safe is having this and not the other three", sixteen lines above
the note §34 added saying the opposite. The others: SECURITY.md credited 058
with guards that live in 062 (which drops 058's function outright) and omitted
the 200/day ceiling; the `attemptId` was listed among "object references, both
checked the same way" when it is neither an object reference nor checkable;
`SupportPrompt` said two branches lock where three do, and four rounds closed
the overlap where five did.

### 38. Round thirty-five: an empty field that charged $5 a month

Thirty-four rounds READ the React components. This one MOUNTED them — the real
`SupportFlow` and `AmountChooser` bundled against React 19 in jsdom, with Stripe
and the API stubbed — and found a money bug in the first thing it drove.

`customProblem` returns null when the custom cell is open and EMPTY, so the
chooser reported itself valid. But `typeCustom` never calls `onChange` for an
empty field, so the parent keeps the last valid amount. An open, blank "Other"
box, no preset selected — and a live button reading "Support $5/month".

Executed end to end: a $0 account taps Other, types 5, backspaces to go back to
$0, presses the button, and is subscribed at $5 a month, thanked for it. The
other way in is worse because it looks like caution: type 750, read "that is
more than $500 a month", clear the field to think again, and the button quietly
returns to a live $75.

§19 wrote the rule — "the field and the button must not disagree at the moment
of payment" — and applied it to the REJECTED entry. Empty is the other half,
and it is both the cell's initial state and where a rejected entry lands when
you clear it. The message still stays quiet while the field is untouched
(nagging somebody who has typed nothing is its own defect); the cell simply
reports itself unusable, which is what the button reads.

Second: a supporter who presses "stop my support" while their card is failing
was shown "$5 / month — thank you, this covers the servers" over "updating
your card will put it right", with nothing anywhere acknowledging the stop they
had just asked for. The app recorded the cancellation and never said so, and
then asked them to fix their card every three days for a month — about ten
modals on the way out. Both facts are true and both are now said, stop first,
because the outstanding month is real; and the dunning clock for somebody who
has asked to stop is the ordinary monthly one. Asked, not nagged. Five tests
pin it.

**The lesson is about the loop, not the feature.** Nine rounds of prose findings
were read here as convergence. They were a reviewer running out of places it had
been TOLD to look. Redirecting round thirty-four to execute the server found
nothing, which was real evidence; redirecting round thirty-five to execute the
CLIENT — the one surface thirty-four rounds had only ever read — found a
defect that takes money from somebody who was trying to say $0. Where the
reviews are looking is a bigger lever than how hard they look.

### 39. Round thirty-six: the seams between the components

§38 said where the reviews look matters more than how hard. This round was given
that as its first task — decide the largest surface nothing had executed —
and it picked the two MOUNT SITES and the contract between them: `SupportPrompt`
and `SupportSettings` driven in a real DOM with a real query client, ~665 lines
no round had ever run, plus `CardForm` reached through them and `SupportFlow`
driven THROUGH its frames rather than standalone. The defects were in the seams:
who records what when the sheet closes, and what the card step does with the
flow's locks.

**The sheet's ✕, Escape and backdrop were live for the whole of every payment.**
Only the flow's own dismiss link was disabled while busy. Press "Give $10 once",
meet the bank's challenge, close the sheet: `confirmSetup` resolves into a
component that no longer exists, the $10 is charged, and the reader never
reaches the done screen that exists specifically to say "one time only —
nothing recurring has been set up and there is nothing to cancel". A one-off
leaves no profile history by design (057), so the Stripe receipt becomes their
only record that it happened. And `onAnswered` never fires, so the exposure
records a `dismissed` on top of the server's `chose` — the both-outcomes
overlap §21, §22, §24, §27 and §30 spent five rounds closing, reopened at the
one point the answer signal structurally cannot cover.

The card step was the worse half: `busy` lives inside `CardFields`, so from the
frame's side nothing was happening for the entire challenge. `onBusy` is
threaded from `CardForm` through `SupportFlow` to the prompt, which refuses to
close while a write is in flight. Refusing is better than taking it: the write
finishes, the reader sees what happened to their money, and one outcome is
recorded instead of two.

Second: the `processing` and ambiguous branches set their locks and return
WITHOUT changing `step`, and both locks hang off controls the card step does not
render. A reader who got there from the card step saw a fully live "Support
$5/month" directly beneath "Do not try again" — on the only step a first-time
contributor can reach `commit()` from, with the branch's own comment claiming
the lock stopped them reaching for it. The card step now says what happened and
offers Close or Reload, the treatment the `!stripePromise` dead end already had.

Three smaller, all found by running rather than reading: the chooser's
validation messages are monthly-only and were shown verbatim on the one-time
surface ("or pick $0", where that ladder has no $0 rung; "more than $500 a month"
for a single gift) — the same class `label` and `showMostCommon` were added
for. `SupportSettings` deleted its entire section on a failed REFETCH, triggered
by its own `query.refetch()` after a successful amount change, against a header
promising a quiet line. And the card panel updated local state without
refreshing the shared cache, so leaving the profile and returning inside the 60s
`staleTime` showed the card that had just been replaced.

### 40. Round thirty-seven: the transaction is not the request

The surface nobody had executed was the one every billing request runs inside:
the RLS middleware in `index.ts`, and what it does to a money-moving request
that ends by any path other than `res.finish`. Round thirty-four ran the routes
on a hand-rolled Express lookalike and only ever drove requests that COMPLETED.
This round extracted the shipped middleware verbatim and ended requests early.

`lockAccount`'s docstring said the lock "is held for the rest of the
transaction, which in SUPABASE_MODE is the rest of the request". It is not. The
middleware commits on `res.on('finish')` and rolls back — destroying the
connection — on `res.on('close')` or the 30s watchdog, while Express leaves
the handler running. A suspended tab, a dropped connection or a slow Stripe call
releases the lock and kills the transaction while the handler is still inside
`subscriptions.create`, which then completes unserialised. The docstring also
only ever reasoned about the WAITER being bounded by the watchdog; the HOLDER is
bounded by it too, and that is the dangerous half.

`cancelStraySubscriptions` is the net and mostly holds — executed: $600
collected, $100 refunded, one subscription left live. But it deliberately skips
a stray whose first payment is `processing`, and its own comment said "NOTHING
REVISITS IT… reaching it needs the advisory lock to have already failed AND a
card left `processing`." This round's point is that the first precondition is
one suspended tab. Executed end state: two live subscriptions, $6/month, nothing
refunded, the profile showing $5 — and "stop my support" cancelling only the
one the row knows about, leaving the other billing for ever. That is what
`service.ts` itself calls the worst shape a billing bug can take, reached from a
single tab.

Three fixes, and the shape of them matters. The sweep now also runs from the
webhook's `invoice.paid`, which is the ONE actor guaranteed to run after a
`processing` charge has settled and can therefore refund the stray the
create-path sweep must skip — the fix `service.ts` had been suggesting to
itself for twelve rounds while the false docstring made it look optional. The
two money routes call `commitRequestTx` before responding, so a suspended tab
loses neither the row nor the conversion (the row heals from a webhook;
`billing_ab_event` never does, and the loss was biased toward slow networks and
mobile, so it did not cancel between arms). And the docstring now says what the
lock is: one of three things that make the two-tab case safe, not the whole
answer.

**The lesson repeats §38's, one layer down.** The prose was not merely wrong; it
was the CITED REASON another file used to deprioritise its own known gap. A
false sentence about a mechanism is worse than no sentence, because it is load-
bearing for decisions made elsewhere.

⚠️ **§41 corrects two claims in this entry.** "So a suspended tab loses neither
the row nor the conversion" is not what `commitRequestTx` achieves — it covers
a failing cleanup COMMIT, not a disconnect, because `res.on('close')` destroys
the connection before the handler reaches it. And the webhook sweep as written
here cancelled the wrong subscription.

### 41. Round thirty-eight: my fix cancelled the subscription that was paying

Round thirty-seven pointed the webhook at `cancelStraySubscriptions` with the
keeper taken from `row.subscription_id`. That is `pullState`'s choice: the
NEWEST subscription in `LIVE_STATUSES` — a set containing `incomplete` and
`paused` — falling back to the newest of ANY status, `canceled` included. A
display choice, promoted to a mandate to cancel and refund.

Executed through the product's own routes and its own webhook: a reader paying
$5 for months, plus an abandoned `incomplete` $10 attempt left by a suspended
tab — R37's own premise — which is NEWER. The next renewal's `invoice.paid`
kept the ghost, refunded every month the real subscription had collected, and
cancelled it. Three variants do the same behind a `paused` keeper, behind a
`canceled` one, and for a manual invoice carrying no subscription at all. And it
ran on EVERY renewal for EVERY supporter, outside the request transaction and
therefore outside the advisory lock every money route takes. I closed a gap
reachable by a race and opened one reachable by a renewal.

`sweepDuplicatePayingSubscriptions` is the narrow replacement, and every clause
is load-bearing: one snapshot, so the keeper is chosen from the same list the
strays are filtered out of (R37's version left an UPDATE and a SELECT between
the two, and a subscription created in that ~200ms gap was refunded while the
request creating it still ran); PAYING-only on both sides, so a keeper that is
not collecting is not a keeper and a stray with nothing to refund is left to
expire; and NOTHING HAPPENS unless two paying support subscriptions exist on one
customer, which no correct sequence produces. The row's subscription wins if it
is paying, else the OLDEST does — "newest wins" is right for the create path,
where the last write is the chosen amount, and exactly wrong for a sweep.

⚠️ **§42 corrects that last sentence, which described what was avoided while the
code did it.** `row.subscription_id` IS the newest live subscription — it is
`pullState`'s display choice — so the preference matched the newest whenever
the newest was paying and the `?? oldest` fallback never ran. The keeper is the
oldest, unconditionally, with no preference argument for a caller to get wrong.

Second: §40 said `commitRequestTx` means "a suspended tab loses neither the row
nor the conversion". It does not. `res.on('close')` fires at the disconnect and
DESTROYS the connection, so the next query throws and the commit is never
reached — executed: charge landed, `support_cents` 0, no events, identical to
before. What it does cover is a cleanup COMMIT that fails at `res.on('finish')`,
which is real and worth having. Both sentences are corrected; the disconnect
case is open, and closing it is a change to the middleware's lifetime model.

Third, and the most instructive: I added the commit to the two routes that
CHARGE and to none of the four that record an outcome. The justification was
measurement bias — and committing only the paying answers makes that bias
worse and directional. The $0 branch is the answer most people give, by the
route's own comment, and lost its `chose` AND its prompt ack, bringing the
onboarding modal back for somebody who had just answered it and been told 200.
`/prompt-ack` lost dismissals, the experiment's other outcome. `/prompt-shown`
lost exposures, its denominator. `/one-time/confirm` lost 3-D-Secure gifts —
the endpoint that exists BECAUSE losing those "would have quietly biased
whichever arm attracted more of them". All six commit now.

**Three rounds, three fixes of mine that were themselves defective** (§31's
missed copies, §39's overlapping branches, and this). The pattern is not
carelessness about the diagnosis; it is that a fix is written against the case
that prompted it and shipped without asking what ELSE now reaches the new code.

### 42. Round thirty-nine: the same wrong keeper, twice, under a header saying otherwise

Round thirty-eight replaced round thirty-seven's sweep because it cancelled the
subscription that was paying. The replacement did it too.

`preferId` came from `row.subscription_id`, and `row.subscription_id` IS
`pullState`'s display choice: `managedSubscription` returns the NEWEST live
subscription. So `paying.find(s => s.id === preferId)` matched the newest
whenever the newest was paying, and the `?? oldest` fallback was dead in exactly
the case it existed for. The header said "the OLDEST paying one does" and named
newest-wins as the thing being avoided. Executed: a six-month supporter with a
day-old duplicate had all six months refunded and the six-month subscription
cancelled; twelve months against a `past_due` duplicate the same; and a reader
who had answered $0 had their own winding-down subscription cancelled and four
months given back while the stray was kept — that last being the very case the
webhook sweep was added for.

The keeper is the oldest now, unconditionally. **There is no preference
parameter**, because the previous two attempts both got the preference wrong and
a parameter is where the mistake lived. Between two subscriptions that are both
charging there is no reader intent to respect: one is an accident, and age is
the only fact that reliably separates the one with history and a billing date
the reader recognises from the one made by mistake. Refunding the older is the
expensive error; refunding the younger is the cheap one.

**And the path had no test.** Fifty billing tests, none on the only function in
the feature that cancels subscriptions and issues refunds — driven by a public
unauthenticated endpoint, outside the request transaction, unattended. Three
wrong keepers shipped past a green suite and were each caught by a reviewer
executing the code. Stripe is a parameter, so a stub that records what it was
asked to cancel and refund pins the decision without a network or a database.
Six tests now do, and they were checked the way §26 says to check a regression
test: flipping the keeper back to newest-wins fails three of them.

Separately, `limit: 20` on a newest-first list of ALL statuses was a correctness
bug, not a performance choice. Twenty `canceled` or `incomplete_expired` records
newer than the live one made the live one invisible: the row synced to
`canceled`/$0 while Stripe went on billing, the profile showed $0, the reader
was re-asked, and the next answer took the CREATE path and built a second live
subscription. `ourSubscriptions` pages, and reports `hitLimit` so the sweep
refuses to act on a snapshot it knows is partial.

**Four rounds, four defective fixes of mine.** §41 named the pattern as shipping
against the prompting case. This round adds the sharper version: three of the
four were caught only because a reviewer EXECUTED the new code, and the fourth
lived under a comment asserting the opposite of what it did. The test is the
part I keep skipping, and it is the only one of these that would have caught the
defect without a reviewer.

### 43. Round forty: age was never the question

Fifth defective fix in five rounds, and the first one where the reviewer handed
back the derivation I should have made three rounds ago.

`managedSubscription` is `ours.find(LIVE)` over a NEWEST-FIRST list, so the app
addresses the newest live subscription — the profile card,
`billing_account.subscription_id`, `setSupport`'s `modifiable`, and the
`cancel_at_period_end` that "stop my support" sets. It follows that whenever two
are both paying, the one the app CANNOT see is always the OLDER one; if the
stray were newer, the profile would be showing it. Round thirty-nine kept the
oldest, and therefore kept the invisible one every time. Executed: a reader
pressed "stop my support", had four months of their own $5 refunded, and was
left on an ACTIVE $25 subscription with no cancellation pending, on the
subscription the app has no UI for.

So: round thirty-eight kept the newest and refunded six and twelve months of
real support; round thirty-nine kept the oldest and destroyed the reader's own.
Neither age answers it, because age is not the question. The question is which
subscription is REAL, and the evidence is money already collected. Most paid
invoices wins; on a tie the newest, because that is the one every other part of
the system addresses, so what survives is what the profile, the amount and the
stop button all point at.

Second defect, in the OTHER sweep and older than any of this:
`cancelStraySubscriptions` excludes `paused` under a comment explaining exactly
why — "months of legitimate support given back for changing an amount" — and
excludes nothing else, while `refundStraySubscription` refunds EVERY paid
invoice ever. Executed: twelve paid months at $5, an abandoned `incomplete` $25
attempt, a nudge from $5 to $3 — $60 refunded and the year-old subscription
cancelled. The create path may only undo what happened on its own watch, so it
now takes a floor timestamp read before its first Stripe call, refunds nothing
older, and REFUSES to touch a candidate carrying older paid history at all,
logging it for a person to look at.

And the tests I added last round pinned a rule that was false. They asserted on
`created`, so they would have passed under any age-based rule and told me
nothing about whether the rule was right. Rewritten around collected history and
checked against BOTH historical wrong rules: newest-wins fails three, oldest-wins
fails three, the shipped rule passes.

**Five rounds, five defective fixes.** The through-line is not haste. It is that
I have been choosing between candidate rules by argument, and each argument was
locally reasonable — "respect the reader's last choice", "the older one has
history" — while none was derived from what the rest of the system actually
does with the answer. The reviewer's `managedSubscription` observation is one
line of code, and it settles the question outright. Derive the invariant from
the code that consumes it; do not reason about which rule sounds fairer.

### 44. Round forty-one: treating an absence of information as a fact

Sixth defective fix in six rounds, and this time the shape is one sentence:
**an absence of information was recorded as a fact.** Three separate places, one
mistake.

`.catch(() => [])` on the keeper rule turned "I could not read the invoices"
into "there are none" — the one reading a rule built on collected money must
never make. It is asymmetrically dangerous: whichever subscription's lookup
fails is scored zero and therefore ALWAYS loses. Stripe's 429s concentrate on
renewal days, which is exactly when this sweep runs. Executed: a 429 on the
twelve-month subscription's invoice list cancelled the reader's real
subscription, kept the stray, refunded nothing (the same call was broken), and
logged MONEY OWED about the one it had just destroyed. The twin `.catch` on the
create-path guard did the mirror: it re-opened round forty's protective refusal
into a cancel. The keeper rule now lets the read throw — the outer catch then
leaves both subscriptions alone, which is the safe direction — and the guard
fails CLOSED, because the question it asks is "may I destroy this?".

`managedSubscription` was `find(LIVE_STATUSES)`, and `LIVE_STATUSES` contains
`incomplete`. So a newer ABANDONED attempt outranked a subscription Stripe was
actually billing, `pullState` refused to report an incomplete's price, and the
row read $0. Executed against the real migrations: a reader billed $5 a month
for twelve months saw $0 on their profile and was shown the recurring check-in
— the ONE invariant this feature exists to guarantee, broken by an ordering
choice made for the UI. Their next answer then found `modifiable === null`, took
the CREATE path, and built a second live subscription beside the one already
billing, which is where every sweep defect of the last five rounds gets its
material. Paying is preferred now, then merely live, then most recent.

And the `since` floor compared against a bare clock reading with a strict `<`,
so the losing tab's invoice was excluded whenever that tab simply started first
— the ordinary shape of the race the sweep exists for — leaving both
subscriptions billing. It carries a minute of tolerance now: generous for a race
measured in seconds, four orders of magnitude short of a billing cycle.

**Separately, and not my fix: the prompt was re-shown on every page load.**
`prompt_last_shown_at` was stamped only by `/prompt-ack`, i.e. only if the
reader touched the sheet. §17 called that defensible — "an unanswered ask was
not settled" — on the assumption that ignoring a modal is rare. It is not:
reload, navigate away, or close the tab and nothing was written. Executed:
twelve page loads, twelve `shown` events, the clock still NULL, `promptDue`
still `checkin`. The reader is nagged where the spec says "once, then monthly",
and `cents_per_exposure` — the number that decides whether the $1 rung ships
— gets a denominator dominated by whoever reloads most, a population
converting at zero, with 062's 200/day ceiling truncating the worst offenders so
the distortion is not even linear. `/prompt-shown` stamps the clock now,
including the once-ever flag for onboarding. §17 is marked reversed.

Two tests, both checked against the old behaviour. And the superseded keeper
derivations are DELETED rather than left stacked: rounds thirty-seven to
thirty-nine kept reintroducing each other's rule from comments that had outlived
their code.

### 45. Round forty-two: the first round where my own fixes held

Six rounds running, the next review found the last one's fix defective. This
time all four of round forty-one's held under execution — the reordered
`managedSubscription` across thirteen subscription states, the throwing keeper
rule under 429s on one, two and all lookups, the 60-second floor against a
five-second race and a year-old subscription that renewed thirty seconds ago,
and the prompt clock against the real migrations (thirteen loads, one exposure,
one stamp). It also found a net improvement nobody had asked for: an active
subscription with a newer `paused` one used to throw `SubscriptionPausedError`
and lock the reader out of changing their own live amount, and now does not.

The defects were on `SupportSettings` — `SupportFlow`'s OTHER mount site, the
only surface a supporter uses after onboarding, and the one nothing had ever
executed.

**"No card on file — none is needed while you are on $0" was unconditional.**
A supporter at $5 a month who removes their card in Stripe's own portal — the
one THIS CARD LINKS TO eight lines below — saw "Next payment of $5 on the 4th"
and "none is needed while you are on $0" at the same time. In `past_due` it was
worse: "updating your card will put it right" directly above "none is needed".
The reader is told not to act, and the renewal fails. Also reachable through a
Link or bank-debit method, which `service.ts` already documents as reading "no
card on file".

**And the settings card's own controls stayed live during a charge.** §39 closed
exactly this on the prompt — the `writing` ref that refuses to close the sheet
mid-payment — and the other mount site never got it. Worse here, because "Use
a different card" does not merely close a sheet: `{panel === 'amount' &&
<SupportFlow …>}` means pressing it UNMOUNTS the flow. Executed: the charge
landed, `onState` and the refetch never fired, and the card went on reading "$0
/ month — you are on $0, which is a perfectly good answer". A bank step-up in
flight was simply dropped.

Two smaller, both mine. The sweep's `catch` swallowed the keeper-rule throw and
then answered 200, so Stripe never retried and my own comment's "the next
`invoice.paid` tries again" meant the next RENEWAL — up to a month of
double-billing from a 429 that would have cleared in seconds. It rethrows. And
that comment recommended `Promise.allSettled`, which cannot be adopted without
deciding what a REJECTED lookup scores — every answer to which is the
`.catch(() => [])` round forty-one removed. A comment arguing for the change
that re-opens the bug it sits on is the worst kind this file produces.

### Deploy state (standing — update it, do not move it)

⚠️ This block belongs to the FEATURE, not to whichever round is last. Rounds
forty-one through forty-three each inserted their narrative above it, so it
drifted forward one heading per round and ended up asserting that a round which
shipped no migrations had shipped three. §44 added 061—063; nothing since has
added any.

⚠️ **CORRECTED 2026-09-07, by asking production instead of asserting.** Every
round from thirty-four onward was told "053—057 applied, 058—063 pending",
and both docs said it. `migrate:status` against the production database, run
from this branch's worktree (the main checkout has none of these files, which is
why nobody had checked), says otherwise:

**053—056 were applied. 057—063 were pending — SEVEN, not six.**

**✅ RESOLVED 2026-09-07: all seven are now applied. `migrate:status` reports
0 pending, 63 total.** Verified by asking the schema rather than the runner:
`billing_ensure_row()`, `billing_release_customer()` and the FOUR-argument
`billing_record_ab_event(text, text, integer, text)` all exist (the three-arg
version is gone, as 062 intends); `billing_event.claimed_at` is `NOT NULL` and
`processed_at` exists; `billing_ab_event.dedupe_key` and its partial unique
index exist; and 057's CHECK now admits `chose_one_time`.

⚠️ **The cleanup SQL has NOT been run.** The documented order is cleanup first,
and the reason is 059's write-once pin: code without `billing_release_customer`
writes a replacement customer id and gets "cannot be repointed" on every
request. That hazard does not exist here, and the order was inverted knowingly:
production's billing tier is OFF (no Stripe keys in the Production
environment), so no production code path touches these rows at all, and the
only code that does — the branch preview — is the new code, which has 060. The
cleanup is still REQUIRED before go-live, for the reasons it always was: one
account still carries a cached test-mode subscription that would read as a
fictional "$N a month", and thirteen test-mode experiment rows would seed the
$1 result with the owner's own testing.

057 is the one that widens `billing_ab_event`'s `kind` CHECK to admit
`chose_one_time`. Without it every one-time gift's analytics write violates the
constraint, is swallowed by `recordAbEvent`'s savepoint, and is lost with a
console warning while the charge stands. So the one-time analytics path has
never once written a row against the real database — every test gift taken on
the preview was silently unrecorded. Harmless in itself (the cutover deletes
every experiment row anyway) but it means that path's only executions have been
in harnesses.

The sequential runner applies whatever is pending, so "run the migrations" was
always going to pick 057 up. What was wrong was the REASONING every round did on
top of a false premise — including a cutover rehearsal that seeded its database
as 053—057 and therefore never exercised the real 056—063 upgrade.

They must be applied together and in order, after the go-live cleanup SQL and
adjacent to the deploy — 059 without 060 is worse than neither, because it
recreates the orphan-minting loop 060 exists to fix. DEPLOYMENT.md carries the
cutover.

### 54. Go-live, and the two bugs a Stripe we wrote could not contain

**2026-09-08. The tier is live.** Migrations 057-063 applied (production was at
056, not 057 — see below), live Stripe objects created, five Production
variables set, cleanup run, a real signed webhook delivery verified end to end,
and the owner paying $1 a month.

**The premise everyone had been reasoning from was wrong.** Every round from
thirty-four on, and both docs, said `053`-`057` were applied to production. They
were not: `057` had never been applied. Nobody caught it because a
`migrate:status` from the main checkout — which has none of these files — reports
a tidy "0 pending, 52 total". It took asking the actual database from the
branch's own worktree. `057` widens `billing_ab_event`'s `kind` CHECK to admit
`chose_one_time`, so every one-time gift's analytics write had been violating the
constraint and being swallowed by `recordAbEvent`'s savepoint. **Ask the
database. Documentation about the database is not the database.**

**Then the first live payment failed, and the reason is the lesson of the whole
project.** From Stripe's own request log:

> You cannot confirm with `off_session=true` when `setup_future_usage` is also
> set on the PaymentIntent.

Stripe sets `setup_future_usage` on a subscription's first invoice itself — it is
how the card becomes usable for renewals — so `finishFirstPayment`'s intent
ALWAYS carried it and `off_session` was ALWAYS rejected. **That path could never
have worked for anybody.** Fifty rounds of review, every PGlite harness, every
adversarial sweep: all of them ran against a Stripe stand-in written from our own
understanding of the API, and a stand-in can only ever confirm the understanding
that built it. The one line that could only fail against real Stripe was the one
line nothing tested.

A second of the same family surfaced the moment Link was tried: paying through
Link attaches a PaymentMethod of `type: 'link'` with no `card` object.
`ensureDefaultPaymentMethod` required `pm.card` and refused it, so a supporter
who used Link and never separately typed a card could not subscribe at all —
Stripe would have billed them without complaint; DeckPal was the only refusal in
the chain. The profile compounded it by reading "no card on file" beside a
renewing subscription, because `shape()` gated the whole object on `last4`.

**The correction is `scripts/stripe-contract-check.mjs`**, wired up as
`pnpm --filter deckpal-api test:stripe-contract`. It drives the Stripe CLI
against TEST mode, asserts the calls this app makes are calls Stripe accepts, and
reproduces the go-live bug on demand on a fresh customer so the guard is
falsifiable rather than decorative. It found two false passes in itself while
being written — a refusal case on a second subscription, which carries no
`setup_future_usage` and therefore had nothing to refuse, and a `catch` that
never fired because the Stripe CLI exits 0 and prints API errors as JSON.
**Run it on any change to `billing/service.ts`.**

**Honesty defects, fixed in the same pass**, because they turned one failure into
three:

- `stripeFailure` logged only `type` and `requestId` for Stripe errors,
  withholding the message to keep decline copy out of a shared log. But
  `StripeCardError` is caught and returned *before* that line, so everything
  reaching it is operational text. The caution cost the diagnosis: the only
  trace was `unknown`, in a log window that had already rolled.
- A `StripeInvalidRequestError` is conclusive — Stripe refused the call, so
  nothing was charged — and the reader was told "check whether it went through".
  That branch now outranks even the gift branch: pointing somebody at a receipt
  for a charge that never happened leaves them waiting for an email that will
  never arrive.
- The profile described `incomplete` as "your bank asked for confirmation".
  It covers three situations and the one that happened involved no bank at all
  (`next_action: null`, invoice never attempted).

**Also recorded, because it was observed rather than theorised:** aggressive
polling of `/api/health` during a deploy exhausted the Supabase pooler —
`EMAXCONN, limit: 200` — and every route 500'd, not just billing. That is §53's
outstanding connection-per-request finding, reproduced accidentally. It cleared
on its own once the polling stopped, and it remains the top item on the list.

### 53. Sweep B: a charge that existed only at Stripe, and a pool that one person could drain

The fourth reviewer in the parallel sweep found the worst defect of the whole
review, and it had been reachable since the one-off shipped.

**A gift could be charged and recorded nowhere.** A one-off produces no invoice
and no subscription, so — unlike every other way money moves here — NO webhook
event covered it. `HANDLED` had no `payment_intent.*` member. If the request
died between Stripe taking the money and the database write, the charge existed
only at Stripe, the reader got a 502 saying it had failed, and nothing in the
product could ever learn otherwise. That is not a theoretical window: the RLS
watchdog reclaims a connection at 30s, and `POST /one-time` makes 8 sequential
Stripe round trips — 16 on an account with a long subscription history — so one
slow Stripe minute is enough. Executed: intent `succeeded`, `billing_ab_event`
empty, `stripe_synced_at` NULL, HTTP 502. Recovery depended entirely on the
reader's browser re-posting the same attempt id, i.e. on the reader still being
there.

`payment_intent.succeeded` is handled now. It is filtered to intents this flow
stamped (the same event fires for every subscription invoice), it goes through
`syncCustomer`'s ownership check like every other path, and it is idempotent
with both routes by construction: all three write `once:<intent id>` and 061's
partial unique index collapses them. The context travels in the intent's own
metadata, because a webhook that guessed would file a profile-card gift as a
prompt conversion and put it in the experiment's numerator with no exposure
behind it.

**And one person with twelve tabs could take the site down.** In SUPABASE_MODE
the RLS middleware holds one pooled connection for a request's whole lifetime,
the pool's `max` IS the server's concurrency (12 against the Supabase pooler),
and a request waiting on `lockAccount` holds a connection while doing nothing
at all. Executed against the real `pg-pool`: twelve same-account requests took
every connection, eleven of them merely waiting, and an unrelated request —
`/health`, a card search, the Stripe webhook — then blocked the full 10s
`connectionTimeoutMillis` and answered 500. The only thing that had ever freed
them was the 30s watchdog.

`SET LOCAL lock_timeout = '4s'` bounds it, and the loser gets a 409 that says
what happened rather than a timeout. **That removes the trigger, not the
shape.** Twelve DIFFERENT accounts transacting during a slow Stripe minute still
exhaust the pool, because the real problem is holding a database connection
across a network call to Stripe. The fix is to release it across the Stripe leg
and reacquire after — a change to the middleware that wants a real Postgres to
verify against, which this machine does not have. **Outstanding, and recorded
here rather than quietly carried:**

- Release the pooled connection across the Stripe leg (the real fix for the
  above).
- Give the webhook its own small pool: it is mounted outside the RLS middleware
  and shares the request pool, so the load that loses a write also blocks the
  actor that repairs it.
- `ourSubscriptions` runs three times per `PUT /subscription` — 16 of that
  route's 21 Stripe calls on a paged account are `subscriptions.list`. Reading
  it once and threading it through cuts the worst-case hold from ~39s to well
  inside the watchdog. Deferred deliberately: it is a refactor of the money
  path, and the review's own history is that money-path refactors written at
  the end of a session are where the defects come from.

Also fixed: `/one-time/confirm` committed inside its `if (paid)` branch, and
`commitRequestTx` ends the transaction — which releases the advisory lock. Up
to seven Stripe round trips and a full cached-row overwrite then ran
unserialised behind it, where the other three money routes measured zero. It
commits after `applyStripe` now, as they do.

**Method note, again.** This sweep could not model true multi-connection
Postgres — no Docker, no local Postgres, and PGlite is single-connection — and
said so rather than faking it. What it did instead is the reason its numbers are
trustworthy: the real `pg-pool` with a stubbed wire client, so queueing, `max`,
FIFO waiters and `connectionTimeoutMillis` are production's own code. The Stripe
round-trip COUNTS are measured; the seconds are arithmetic on them.

### 52. The parallel sweep: the code was ready, the RUNBOOK was not

Four reviewers at once, on the four surfaces nothing had executed — the
self-host branch, the connection budget, the webhook's serverless edge, and the
cutover procedure itself. One round of wall-clock instead of four, which is how
this should have been run from the start.

**The finding that mattered was not in the code.** Every previous round audited
what the software does; none audited the document a human follows to turn it on.
Walked step by step against a database seeded to production's current state, the
runbook fails three independent ways, any one of which is sufficient:

- **The migration step had no command and never mentioned `SUPABASE_MODE`.**
  With it unset the runner skips 054/056/058/059/060/062 and the CLI printed
  `present` for each — the same word it prints for work already done. 061 and
  063 still apply, so the run looks partly successful, and the deploy then hard-
  fails on `billing_ensure_row()`. The CLI now prints `SKIPPED` and a warning
  naming the variable; `MigrationResult` carries `skipped` so the two facts are
  distinguishable at the type level rather than by eye.
- **"Deploy this branch"** named a branch that is not the production branch, and
  the file documented no deploy mechanism at all. Its literal reading is
  `vercel --prod` from a feature worktree.
- **The four `STRIPE_*` variables exist only in Preview, git-branch-scoped to
  `feat/pwyw-billing`.** That scope stops matching at the merge and Production
  was never configured, so the tier would have come up silently off.

And the one with teeth: **the go-live cleanup SQL is unconditional and was
unwrapped**. Four autocommitting statements, so a failure at the third leaves
the first two applied — and re-running it after go-live wipes real supporters.
Executed: a row carrying a live customer, a live subscription and $25/month came
back nulled, with no error and no audit trail, while Stripe went on charging.
It is one transaction now, under a banner that says what it does after go-live.
Its predicates were checked column-by-column over sixty seeded accounts and are
correct — the danger was never the SQL, it was the absence of a fence.

Also fixed: the webhook gate told the operator to look for a **400**, and
raw-body-lost is a **500** `raw_body_lost` — 400 means a wrong secret or a
replay. That gate is the only detector for "every delivery rejected while cards
keep charging", and its diagnostic pointed at the wrong variable in both
directions. `API_BASE_PATH` had an empty notes cell despite being the difference
between a working endpoint and a 404 on every delivery forever. `SUPABASE_MODE`
was read by the billing gate and absent from the environment table (B11).
DEPLOYMENT.md now also carries a rollback section — the migrations are NOT
reversible, so rollback is Instant Rollback plus cancelling in Stripe by hand —
and a secret-rotation procedure, which was absent entirely.

**The code came back clean, with one latent hole worth closing.** The self-host
branch is dead *and* correct: `pnpm migrate` reaches 063 on both a virgin and an
already-migrated self-host database, and every self-host arm executes cleanly.
But `lockAccount` returned quietly outside SUPABASE_MODE, and nothing degrades
loudly if it does nothing. With the gate forced open — one plausible future
change, letting self-hosters take money — two concurrent `PUT /subscription`
produced two live subscriptions on one customer, each having collected its own
first invoice. It throws now. The self-host arms of `applyStripe` and
`recordAbEvent` are missing the guards that live in the @supabase-only
migrations (the write-once pin, the amount clamp, the daily ceiling); that is
recorded in the function rather than fixed, because the branch is unreachable
and a fix nobody executes is a liability of its own.

The webhook edge came back clean on everything that decides money: `rawBody()`
is byte-exact for every shape including a non-ASCII payload arriving as a
string, mount order is right, and no ledger path leaves an event stuck. Two
comments overclaimed and were corrected: 063 said "every handler here is
idempotent" when what the ledger actually guarantees is that no delivery is
answered 2xx before its work completed — a takeover CAN run concurrently with a
still-live original, and that is safe only because of what today's handlers are.
And the claim release is not claim-scoped, which costs one extra re-execution
and never a lost event; it is documented where somebody would need it rather
than migrated for on its own.

**Method note.** Every sweep was required to prove its harness could FAIL before
trusting a pass, after round forty-eight found a suite that had silently
no-op'd. It paid: one sweep's mutation testing (eight one-behaviour mutants
against its own assertions) found two of its own checks passing for the wrong
reason, and another found a false PASS caused by a fake Stripe resolving in a
microtask, so two "concurrent" requests never actually interleaved.

### 51. Round forty-nine, and the end of the loop

**The loop stops here.** Its exit condition — two consecutive fresh-context
rounds finding nothing — was not achievable as written: a reviewer told to hunt
adversarially on a fresh surface every round will always return something, and
rounds 47-49 returned progressively smaller things, two of them defects in the
previous round's own fix. That is churn, not convergence. The rule that replaces
it: **a round blocks the deploy only if it finds a MEDIUM-or-worse defect that
moves money, loses money, leaks data, or tells the reader something untrue about
their account.** Everything else is a list, and the list is triaged, not looped.

Round forty-nine found one of each, and both are fixed here.

**The two-tab reversal (medium, money, and a lie).** Every guard against asking
twice is a `useRef` scoped to ONE MOUNT — `exposed`, `closedHere`, `answered`,
`writing`. Two tabs are two mounts and nothing joined them. Executed over the
real router: an account restored into two tabs at browser start-up, both told
the check-in is due (neither has acked), both opening the modal. The reader
answers $5 in tab A — a real subscription, really charged. Tab B still shows the
same ask against pre-answer state, its primary button reading "Continue with
$0". Pressing it set `cancel_at_period_end` on the subscription made seconds
earlier and told them "your $0 is saved … nothing about your account changes".

The advisory lock and the idempotency keys do not touch this: those collapse
CONCURRENT submits, and these two are sequential and minutes apart. **What is
wrong with the second request is not that it raced — it is that it was composed
against a state that no longer exists**, and the server cannot tell that from a
change of mind because both are "set my support to $0" from somebody who
supports $5. Only the browser knows what it was showing. So it says so:
`PUT /subscription` takes an optional `expectedCents` /
`expectedCancelAtPeriodEnd`, disagreement is a 409 `stale_state` refused before
anything touches Stripe, and the client reconciles and shows the true state
rather than reporting a failure. Both halves are checked because a pending stop
changes no amount, and the amount alone would let a stale tab silently
un-cancel.

Optional, deliberately: a caller that omits it behaves exactly as before, so
this can never refuse a request for want of a field. The residual is a tab
running the PREVIOUS bundle across the deploy — it cannot send what it does not
know about, and it is unprotected until reloaded.

**And one ask is now one row.** Both tabs recorded an exposure, so one question
put once to one person produced two denominators, and answering in one tab while
dismissing in the other produced two mutually exclusive outcomes — the same
overlap §21/§22/§24/§27/§30 closed WITHIN a mount, arriving by a route a `useRef`
cannot see. `shown` and `dismissed` now carry a dedupe key (061) built from the
surface and the DAY. The day rather than `prompt_last_shown_at`, because that
stamp is written by whichever tab gets there first, so the two tabs disagree
about it exactly when they are milliseconds apart — which is the case this is
for. Nothing legitimately shows the same surface twice in a day: the check-in is
monthly, dunning every three days, onboarding once ever. `forced-` contexts are
exempt or the manual override could be used once a day.

**The gate regression (low).** Round forty-eight's `mode-mismatch` arm returned
before the missing-variable list was built, which made it the very mistake it
had just fixed one branch over: in the four states where the keys disagree and
the product id is absent the tier is OFF — every money route 400s, Stripe.js
never loads — and the operator was told the browser was talking to the wrong
account. In the two where the webhook secret is also missing, nothing named it,
so a cutover would fix the keys, redeploy, and only then meet the fourth
variable. One warning now, every true thing in it.

### 50. Rounds forty-seven and forty-eight: the money paths held; the gate lied

Forty-seven found nothing — the first clean round in fourteen. It drove the
wind-down and dunning lifecycle over months of webhook traffic: $X to $0 sets
`cancel_at_period_end` rather than cancelling outright, the paid month is still
displayed, **no prompt reaches anyone while they are winding down**, the
period-end pair lands them on $0/canceled, nothing is charged for the month
after they stopped, and the ex-supporter rejoins the ordinary monthly check-in.
Replacing a card mid-wind-down does not un-cancel the subscription, which is the
reason `/payment-method` exists as its own route.

Forty-eight re-verified that independently and found the previous round's
evidence weaker than it looked: the fake invoices in the lifecycle harness
carried no `customer`, so every `invoice.paid` delivery had been a silent no-op
and `sweepDuplicatePayingSubscriptions` had never actually run in any of them.
Corrected, everything still passes, plus a randomised long-run — four accounts,
fourteen months, ten seeds, 1,120 invariant checkpoints — with no violation and
no spurious refund. **A harness that cannot fail is the same defect as a test
that cannot fail, and it hid inside a round that reported success.**

Its own finding was in the configuration gate, and in both halves it was the
same mistake: a sentence that was true of one state printed for several.

`billingGateWarning()` appended "a deployment with a secret key but no webhook
secret takes cards and then never hears about a renewal" to EVERY partial
state. A deployment missing only the secret key cannot take a card at all —
`billingAvailable()` is false and every money route 400s — and was told it was
charging people and losing their renewals. An operator who believes it rolls
back a deployment that was safely off; one who learns to discount it discounts
it in the one case where it is true. The sentence is now chosen by the state.

And both this module and `lib/billing.ts` claimed that serving the publishable
key from the same process as the secret key made a live/test disagreement
"unreachable". It removes the build-time half of the split, not the
disagreement: the two remain independent runtime variables. Executed —
`sk_live_…` beside `pk_test_…` reported `configured`, warned about nothing, and
answered every route 200, while the browser loaded Stripe.js on the test account
and every confirmation failed against a live client secret. The tier was
entirely dead and the deployment said it was healthy. `/health` now reports
`mode-mismatch`, and the API warns on boot.

**Reported, not enforced.** The mismatch does NOT turn billing off. Turning the
tier off on a prefix comparison is a severe action, and a false positive would
be a worse outcome than the state it prevents; an unfamiliar prefix (a
restricted key, a future format) is never called a mismatch. B11 asks that the
state be visible from outside, and it now is. Two keys from different accounts
in the SAME mode remain invisible to the gate — cutover step 6, pay once with a
real card, is still the only thing that catches that, and DEPLOYMENT.md says so.

### 49. Round forty-six: two fixes that fixed the example and not the defect

Both findings this round were mine, both from the round before, and both have
the same shape: the fix was written against the case that produced it and
stopped exactly where that case stopped.

**A refusal one caller could not express.** Forty-five gave `Sheet` a way for a
caller to say "I am refusing to close": return `false`. `BugReport` refuses —
`if (busy) return` while a report is submitting — and returned `undefined`, and
it reaches `Sheet` through `ListModals`' `Modal`, whose prop type was
`onClose: () => void`, so that caller could not have said `false` even if it
had wanted to. Executed against the real component: Escape mid-submit played
the exit, the caller declined to unmount, and the panel and the full-screen
scrim stayed at `opacity: 0 forwards` — an invisible, pointer-eating,
focus-trapped `fixed inset-0` overlay with the page scroll-locked and the
reader's typed report inside it, escapable only by a reload that loses the
report. That is the exact bug forty-four's unconditional restore existed to fix,
reintroduced by the fix for the fix. **When you give a shared component a new
protocol, the type that fans it out to callers is part of the change.**

**A validated context that still excluded itself.** Forty-five checked
`/prompt-shown`'s `context` against an allow-list and mapped rejects to the
literal `'unknown'`. Every CTE of the analysis filters `context IN
('onboarding','checkin')`, and `'unknown'` is no more in that set than `'zzz'`
was: replaying forty-five's own twenty-account cohort against its own fix
reproduced the 25% fabricated separation in full — 250.0 against 200.0 on a
cohort that was level. Posting `'settings'`, a value the allow-list ADMITS, did
it too. An exposure's surface is its `kind`, which is validated, so the body is
not read for it at all now.

And the mirror image, unlooked-for both times: forty-five hardened the
denominator and left every outcome route taking `context` verbatim, `forced-`
prefix included, in LIVE mode — the prefix the analysis excludes. Executed:
four identical $5 payers, two of them labelling their own answer `forced-`, and
half the numerator disappeared while every subscription went on billing. One
allow-list now governs every `recordAbEvent` call site.

**Stated rather than hidden:** an account can still name a real prompt surface
for an answer it gave from the profile card, and the API cannot tell that from
an honest one. Gating on a matching exposure row was considered and rejected —
the exposure POST is fire-and-forget, so anyone who answers before their own
exposure lands would lose their conversion, which biases against fast answers
and is worse than what it fixes. `billing_record_ab_event` is granted to
`authenticated` regardless, so nothing at this layer is a boundary; 062's
200/day ceiling is what bounds the volume.

**Also verified, not changed:** an account with no arm has its events dropped,
which is correct — the arm decides which ladder a person was SHOWN, so
assigning one at outcome time would stamp an answer with an arm that could not
have influenced it. A dropped row is a missing one; that would be a fabricated
one. Recorded in `recordAbEvent` so a later round does not "fix" it.

**Round forty-six also cleared the one-time contribution path**, driven end to
end for the first time over the real router, the real migrations and a stateful
Stripe: one charge per gift, concurrent posts collapsed by the lock and the
idempotency key, 3-D-Secure recorded only at `/one-time/confirm` and only once,
cross-account and subscription-invoice intents refused, declines retryable under
a rotated attempt id, and 062's ceiling dropping an event without rolling back
the charge.

### 48. Round forty-five: a fix in a shared component, and a race I did not close

Round forty-four's `Sheet` fix cleared the close latch unconditionally. That is
invisible where `onClose` unmounts by a plain `setState` — React batches the
two — and NOT invisible where it unmounts through TanStack Router, which
commits navigation inside `startTransition` after an async `router.load()`.
There the restore lands as its own painted frame with the panel still mounted
and no longer closing, so `animation-name` flips back to `sheet-panel-up`, and a
name change RESTARTS the animation. The card sheet — the app's most-used
modal, on five routes — read as "slide out, slide back in, vanish".

This is the only change in forty-five rounds that touched a component outside
the billing feature, and it regressed it. `onClose` returns `false` to mean
refused now, and the sheet restores itself only then. **A shared primitive
should not be taught a billing-specific behaviour by widening its default; it
should be given a way for one caller to say something.**

Second, and mine as well: round forty-four replaced `setState` + `refetch` with
a bare `setQueryData`, on the stated ground that it "puts react-query's own
ordering in charge". It does not. `setQueryData` neither cancels nor supersedes
an in-flight fetch, and that fetch's success dispatch overwrites it. Executed: a
`past_due` supporter dismisses the dunning modal (which invalidated, starting a
GET against the old row), then replaces their card; the write lands, the panel
shows the new card, and the stale GET arrives and reverts the panel AND the
cache to the dead card and "your last payment did not go through" — to
somebody who has just done exactly that, whose money has already moved. And
round forty-four deleted the `refetch` that used to correct it a moment later,
so with a 60-second `staleTime` it did not self-heal. Both writers cancel first
now, and the prompt seeds the cache instead of invalidating it, because it was
holding the fresh state all along.

Third: the `kind` validation I added was a no-op. `kind` is used in exactly one
place — `ackPrompt(userId, kind === 'onboarding')` — which already rejected
everything the new set rejected, so an unrecognised kind still returned 200 and
still stamped the clock. It 400s now, as `/prompt-ack` does. And stripping a
client-supplied `forced-` closed one door beside an open one: all three CTEs of
the analysis filter `context IN ('onboarding','checkin')`, so ANY unrecognised
string achieves the same self-exclusion. Executed over twenty identically-
behaving accounts: two non-payers in one arm posting `context: 'zzz'` produced a
25% fabricated separation on the number that decides whether the $1 rung ships.
Context is validated against the set the analysis trusts.

**The verified-correct half is worth recording too.** The card-recovery path was
driven whole for the first time — `POST /payment-method` through
`customerFor`, `adoptSetupIntent`, `retryOpenInvoice` and `applyStripe`, over the
real router and the real migrations — and the server half is sound: the
invoice is really paid, the subscription-level card pin is cleared, `settled`
agrees with the database, no phantom conversion is recorded, a cross-account
SetupIntent is refused with nothing adopted, and a `past_due` account that has
also asked to stop keeps its pending stop while still paying the month it used.

### 47. Round forty-four: a refusal that left an invisible wall

The sharpest finding is the interaction between two of my own fixes. `Sheet`'s
`requestClose` optimistically stamps `data-closing`, latches a timer it never
resets, and relies on an invariant `theme.css` states outright: "the element
unmounts a frame after the animation ends". Round forty-two made that false by
having the billing sheet REFUSE to close while a payment is in flight.

Executed: press Escape during a bank challenge on a $25 gift — the commonest
panic action on a slow payment — and the panel AND the full-screen scrim
animate to `opacity: 0 forwards`, stay mounted, and dead-latch every subsequent
Escape, ✕ and backdrop click. The reader is left under an invisible,
pointer-eating, focus-trapped `fixed inset-0` overlay until they reload. They
never see the done screen saying "one time only, nothing recurring has been set
up" — which, by 057, is a gift's only in-app record. The latch clears itself
now, so a refused close plays the exit and comes back.

`POST /me/billing/payment-method` was the only money-moving route without
`commitRequestTx`, and `retryOpenInvoice` calls `stripe.invoices.pay`. Executed
with the finish-COMMIT failing: the invoice was PAID, the client got
`settled: true` and the new card, and the row stayed `past_due` with
`card_last4` NULL — so the supporter who had just fixed their card was told
"your last payment did not go through" and "no card on file, so your next
payment will fail". `customerFor`'s repoint is lost in the same rollback, so the
row keeps pointing at a dead customer while a live one holding their card is
orphaned.

**And the experiment's headline number was measuring the wrong thing.** 055's
header query — the one somebody will paste, because it sits beside the table
— pools every context. `payment_issue` records an exposure that can NEVER
convert (both writers exclude it), so it is pure denominator, and it scales with
the number of PAYERS, penalising the better-converting arm hardest. `settings`
records a conversion with no exposure behind it, and repeats every time somebody
changes their amount. Measured over forty seeded accounts: a true 2.00x
separation read as 2.50x after one dunning cycle, and one account changing its
amount four times contributed 4300c against zero exposures. 055 is applied, so
the correction is a runbook line telling the owner to run `store.ts`'s query
instead. ⚠️ §48 corrects the parenthesis this sentence carried: `store.ts`'s
`exposures` and `monthly` CTEs already filtered context — round twenty-six did
that — and round forty-four added the filter to `one_off` alone. The measured
defect was in 055's header query only; implying `store.ts` had been repaired
overstated it.

Three smaller. My wind-down copy told a `past_due` supporter who had also
cancelled that "nothing further will be charged" — Stripe's dunning does not
stop because you cancelled, so it costs the owner the month that was used, and
it is the same adjacent-contradiction shape one state over. `SupportSettings`
and the shared query cache were two uncoordinated writers, so a fetch started by
the modal's invalidate could land after a card replacement and revert the panel
to the old card and `past_due`; the writers seed the cache now, and the modal's
invalidate sits below both close guards. And `/prompt-shown` validated neither
`kind` nor `context`, so a caller could label its own real exposures `forced-`
— the prefix the analysis trusts to exclude test traffic — and delete itself
from the denominator.

Also corrected: DEPLOYMENT's `PUBLIC_APP_ORIGIN` row called the variable
optional and claimed the `Host`-derived default "yields https://deckpal.app",
which is why nobody set it. It yields whatever host answered, so every alias and
preview URL returns the reader somewhere else. It is marked **set it**.

### 46. Round forty-three: the panel that was not guarded, and the card that did not listen

Round forty-two's fixes held. Its guard did not reach far enough: `writing` was
wired to the amount panel and not to the CARD panel, which is the other write on
that surface and the more dangerous one. `writing` stayed false for the whole of
the bank's `confirmSetup` AND the whole of `replacePaymentMethod` — which runs
`retryOpenInvoice`, i.e. `stripe.invoices.pay` — so "Open billing portal"
stayed live, and that button is a full page navigation.

Executed: a `past_due` supporter reads "updating your card will put it right",
opens the panel, and during the bank's modal presses the button five lines below
labelled "Invoices, receipts and billing details". Navigate during
`confirmSetup` and no card is ever attached, the invoice is never retried,
dunning runs to `unpaid` and the subscription cancels — for somebody who
thought they had fixed it. Navigate during `replacePaymentMethod` and the charge
lands while the `settled: false` warning is lost.

**And the two mount sites did not know about each other.** `SupportPrompt` holds
local state from `api.billingVisit()`; `SupportSettings` holds
`useQuery(['billing'])` with a 60-second `staleTime`; nothing connected them. On
/profile — where the modal renders directly over that card, and where
`payment_issue` is shown to people who ARE paying — answering the modal left
the card underneath reading "$0 / month, you are on $0, which is a perfectly
good answer" and still offering "Chip in". Press it and the flow opens against
stale state, re-sends the amount (no double charge, the update branch is
idempotent) and records a SECOND `chose`, attributed to `settings`, with no
matching exposure and no dedupe key. A phantom conversion in the numerator of
the number that decides whether the $1 rung ships. The sheet invalidates the
shared cache now, on both the answer and the close.

Also: the new no-card warning fired during the wind-down month, telling somebody
who had explicitly cancelled that "your next payment will fail" directly beneath
the note saying support stops on the 3rd — the same adjacent-contradiction
shape it was added to fix, mirrored, and a solicitation aimed at someone who has
said no. And the card panel had no way out when a publishable key is missing;
`SupportFlow`'s identical branch has had a Close and a Reload since round one,
for the reason it states: an unreachable dead end is one deploy configuration
away from being a reachable one.
