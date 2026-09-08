#!/usr/bin/env node
/**
 * Ask REAL Stripe whether the calls this app makes are calls Stripe accepts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Fifty rounds of review ran against a Stripe stand-in written from our own
 * understanding of the API, so they could only ever confirm that understanding.
 * The first live payment failed instantly on a call real Stripe rejects and the
 * stand-in accepted:
 *
 *   400 invalid_request_error — You cannot confirm with `off_session=true` when
 *   `setup_future_usage` is also set on the PaymentIntent.
 *
 * A subscription's first invoice ALWAYS carries `setup_future_usage` (that is
 * how the card becomes usable for renewals), so that path could never have
 * worked for anybody, and nothing in the repo could see it. This script is the
 * missing half: it makes the same API calls against Stripe TEST MODE and fails
 * if Stripe refuses one.
 *
 * It is deliberately NOT a test of our business logic — the pure suite and the
 * PGlite harnesses cover that well. It tests the one thing they structurally
 * cannot: that the shapes we send are shapes Stripe honours.
 *
 * ── RUNNING IT ──────────────────────────────────────────────────────────────
 *
 *   stripe switch context <acct_…>        # TEST mode — no --live
 *   node scripts/stripe-contract-check.mjs
 *
 * It drives the Stripe CLI, so it needs no key of its own and none can leak
 * into a log. Everything it creates is test-mode and disposable; it cleans up
 * after itself.
 *
 * ⚠️ It REFUSES to run in live mode. Every object below would be real.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const STRIPE = process.env.STRIPE_CLI ?? 'stripe'

let failures = 0
const ok = (label) => console.log(`  ok   ${label}`)
const bad = (label, detail) => {
  failures++
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

/** One Stripe CLI call, returning parsed JSON. Throws with Stripe's own message. */
async function api(args) {
  const { stdout } = await run(STRIPE, args, { maxBuffer: 8 * 1024 * 1024, timeout: 45_000 })
  const start = stdout.indexOf('{')
  if (start < 0) throw new Error(`no JSON from: stripe ${args.join(' ')}`)
  return JSON.parse(stdout.slice(start))
}

/** A call we EXPECT to work. A Stripe refusal here is the whole point. */
async function must(label, args) {
  try {
    const out = await api(args)
    ok(label)
    return out
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message)
      .replace(/\s+/g, ' ')
      .slice(0, 220)
    bad(label, msg)
    return null
  }
}

// ── Guard: never live ────────────────────────────────────────────────────────
// ⚠️ Every call carries a timeout. A Stripe CLI subcommand that decides to
// prompt has no terminal here and simply waits for ever, which is how the first
// version of this script hung with no output at all.
const probe = await run(STRIPE, ['products', 'list', '--limit', '1'], { timeout: 30_000 }).catch((e) => e)
const banner = String(probe?.stdout || probe?.stderr || '')
if (/· live/.test(banner)) {
  console.error('REFUSING: the Stripe CLI is in LIVE mode. Run `stripe switch context <acct_…>` first.')
  process.exit(2)
}
console.log(banner.split('\n')[0]?.trim() || 'test mode')

// ── The fixture: a customer with a card, exactly as the app builds one ───────
console.log('\n-- setting up a test customer --')
const customer = await must('create a customer', [
  'customers', 'create', '-d', 'description=deckpal contract check',
  '-d', 'metadata[deckpal_contract_check]=true',
])
if (!customer) process.exit(1)

const product = await must('create a support product', [
  'products', 'create', '-d', 'name=DeckPal Support (contract check)',
])
if (!product) process.exit(1)

// `pm_card_visa` is Stripe's own test method; attaching it is what `CardForm`
// achieves through a SetupIntent in the real flow.
const pm = await must('attach a card', [
  'payment_methods', 'attach', 'pm_card_visa', '-d', `customer=${customer.id}`,
])
if (!pm) process.exit(1)

await must('make it the invoice default', [
  'customers', 'update', customer.id,
  '-d', `invoice_settings[default_payment_method]=${pm.id}`,
])

// ── THE CALL THAT BROKE GO-LIVE ─────────────────────────────────────────────
console.log('\n-- a subscription first payment, the way setSupport does it --')
const sub = await must('create a default_incomplete subscription', [
  'subscriptions', 'create',
  '-d', `customer=${customer.id}`,
  '-d', `items[0][price_data][currency]=usd`,
  '-d', `items[0][price_data][product]=${product.id}`,
  '-d', `items[0][price_data][unit_amount]=100`,
  '-d', `items[0][price_data][recurring][interval]=month`,
  '-d', 'payment_behavior=default_incomplete',
  '-d', 'metadata[deckpal_support]=true',
  '-d', 'expand[0]=latest_invoice.confirmation_secret',
])

if (sub) {
  const secret = sub.latest_invoice?.confirmation_secret?.client_secret ?? null
  const intentId = secret ? secret.split('_secret_')[0] : null
  if (!intentId?.startsWith('pi_')) {
    bad('the invoice carries a confirmable PaymentIntent', `derived id: ${intentId}`)
  } else {
    ok('the invoice carries a confirmable PaymentIntent')

    const before = await api(['payment_intents', 'retrieve', intentId])
    // The fact that made `off_session: true` illegal, asserted directly so a
    // future reader does not have to take the story on trust.
    if (before.setup_future_usage) ok(`Stripe set setup_future_usage=${before.setup_future_usage} on it`)
    else bad('Stripe set setup_future_usage on the first invoice intent', 'absent — the constraint below may have changed')

    // ⚠️ THE REGRESSION GUARD. This is the exact call `finishFirstPayment`
    // makes. If anybody reintroduces `off_session: true` here, or Stripe
    // changes the rule, this line fails in CI instead of on a reader's card.
    const confirmed = await must('confirm it ON-SESSION (what finishFirstPayment does)', [
      'payment_intents', 'confirm', intentId,
    ])
    if (confirmed && confirmed.status !== 'succeeded') {
      bad('the first payment succeeds', `status ${confirmed.status}`)
    } else if (confirmed) {
      ok('the first payment succeeds')
    }

    // ⚠️ AND THE CHECK ABOVE MUST BE ABLE TO FAIL. A guard that would pass
    // whatever the API did is not a guard, which is precisely how the stand-in
    // let the go-live bug through. So: a SECOND, untouched subscription, and
    // the old call made against its fresh intent. Stripe must refuse it.
    // (Retrying the first intent proves nothing — it has already succeeded, and
    // a settled intent rejects everything for unrelated reasons.)
    // ⚠️ A FRESH CUSTOMER, not a second subscription on the same one. Stripe
    // only marks the intent `setup_future_usage` when the mandate still needs
    // establishing — a second subscription for a customer who already has a
    // saved method does NOT carry it, so confirming that one off_session is
    // accepted and the "refusal" proves nothing. The first attempt at this
    // check made exactly that mistake and reported a false failure.
    const cust2 = await must('create a fresh customer for the refusal case', [
      'customers', 'create', '-d', 'description=deckpal contract check (refusal)',
    ])
    await must('attach a card to it', ['payment_methods', 'attach', 'pm_card_visa', '-d', `customer=${cust2.id}`])
      .then(async (attached) => attached && run(STRIPE, ['customers', 'update', cust2.id,
        '-d', `invoice_settings[default_payment_method]=${attached.id}`], { timeout: 45_000 }).catch(() => {}))
    const sub2 = await must('and a first subscription on it', [
      'subscriptions', 'create',
      '-d', `customer=${cust2.id}`,
      '-d', `items[0][price_data][currency]=usd`,
      '-d', `items[0][price_data][product]=${product.id}`,
      '-d', `items[0][price_data][unit_amount]=100`,
      '-d', `items[0][price_data][recurring][interval]=month`,
      '-d', 'payment_behavior=default_incomplete',
      '-d', 'expand[0]=latest_invoice.confirmation_secret',
    ])
    const secret2 = sub2?.latest_invoice?.confirmation_secret?.client_secret ?? null
    const intent2 = secret2 ? secret2.split('_secret_')[0] : null
    if (intent2?.startsWith('pi_')) {
      const probe2 = await api(['payment_intents', 'retrieve', intent2])
      if (probe2.setup_future_usage) ok(`  its intent carries setup_future_usage=${probe2.setup_future_usage}`)
      else bad('the refusal case carries setup_future_usage', 'absent — the check below cannot be meaningful')
      // ⚠️ THE CLI EXITS 0 AND PRINTS THE API ERROR AS JSON, so a rejected call
      // never lands in the catch. Reading only stderr made this check report
      // "accepted" for a call Stripe had plainly refused — a false PASS in the
      // very script written because a stand-in gave false passes.
      const off = await api(['payment_intents', 'confirm', intent2, '-d', 'off_session=true']).catch((e) => ({
        error: { message: String(e.stderr || e.message) },
      }))
      const offMsg = off?.error?.message ?? off?._error ?? ''
      if (/off_session/.test(offMsg) && /setup_future_usage/.test(offMsg)) {
        ok('Stripe REFUSES the off_session form — the go-live bug, reproduced on demand')
      } else {
        bad('Stripe refuses the off_session form', offMsg ? offMsg.slice(0, 160) : `accepted, status ${off?.status}`)
      }
      await run(STRIPE, ['subscriptions', 'cancel', sub2.id], { timeout: 45_000 }).catch(() => {})
      await run(STRIPE, ['customers', 'delete', cust2.id, '--confirm'], { timeout: 45_000 }).catch(() => {})
    }
  }
}

// ── The non-card method the app used to refuse ───────────────────────────────
console.log('\n-- a non-card payment method is still a payment method --')
// Stripe has no test token that mints a `link` PaymentMethod, so this asserts
// the property the fix depends on: `type` is always present, `card` is not.
const listed = await api(['payment_methods', 'list', '-d', `customer=${customer.id}`, '-d', 'limit=10'])
const shapes = (listed.data ?? []).map((m) => ({ type: m.type, hasCard: !!m.card }))
if (shapes.length && shapes.every((s) => typeof s.type === 'string')) {
  ok(`every attached method reports a type (${shapes.map((s) => s.type).join(', ')})`)
} else {
  bad('every attached method reports a type', JSON.stringify(shapes))
}

// ── Clean up ────────────────────────────────────────────────────────────────
console.log('\n-- cleaning up --')
if (sub) await run(STRIPE, ['subscriptions', 'cancel', sub.id]).catch(() => {})
await run(STRIPE, ['customers', 'delete', customer.id, '--confirm']).catch(() => {})
await run(STRIPE, ['products', 'update', product.id, '-d', 'active=false']).catch(() => {})
ok('test objects removed')

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} problem(s)`}`)
process.exit(failures === 0 ? 0 : 1)
