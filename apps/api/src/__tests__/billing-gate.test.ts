/**
 * The configuration gate (contract B11), in its own file for one reason:
 * `SUPABASE_MODE` is read once at import time, and every interesting state of
 * this gate is a cloud state. Node's test runner gives each FILE its own
 * process, so the env is set here before the module is pulled in — which a
 * static import in the main billing suite could not do.
 *
 * What is being protected: a deployment must be able to see from outside which
 * configuration state it is in, and the description it is given must be TRUE of
 * that state. Round forty-eight found the warning telling three of the four
 * partial states the opposite of their own situation, and found a fifth state
 * — the two keys naming different Stripe modes — that reported itself healthy
 * while every card confirmation in the browser failed.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.SUPABASE_MODE = '1';
const { billingAvailable, billingGateStatus, billingGateWarning, stripeMode } = await import('../billing/stripe.js');

const KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SUPPORT_PRODUCT_ID',
  'STRIPE_WEBHOOK_SECRET',
  'VITE_STRIPE_PUBLISHABLE_KEY',
] as const;

/** Run `fn` with exactly this environment, and put the real one back. */
function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
  const prev = new Map(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    // ⚠️ `process.env.X = undefined` stores the STRING "undefined", which every
    // `!!value` check in the gate reads as configured. A key meant to be absent
    // must be absent from this object, not present and undefined.
    assert.notEqual(v, undefined, `withEnv: ${k} must be omitted, not undefined`);
    process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const FULL = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  STRIPE_SUPPORT_PRODUCT_ID: 'prod_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
};

describe('the billing gate names the state it is actually in', () => {
  test('all four values present and agreeing is `configured`, with nothing to warn about', () => {
    withEnv(FULL, () => {
      assert.equal(billingGateStatus(), 'configured');
      assert.equal(billingGateWarning(), null);
      assert.equal(billingAvailable(), true);
    });
  });

  test('nothing set is `unset`, and says the tier is off', () => {
    withEnv({}, () => {
      assert.equal(billingGateStatus(), 'unset');
      assert.match(String(billingGateWarning()), /the pay-what-you-want tier is OFF/);
    });
  });

  test('ARMED AND DEAF: a secret key with no webhook secret is described as taking cards', () => {
    // The one state this module exists to name. `billingAvailable()` is true,
    // so cards really are taken and renewals really are never heard about.
    const armed: Record<string, string> = { ...FULL };
    delete armed.STRIPE_WEBHOOK_SECRET;
    withEnv(armed, () => {
      assert.equal(billingGateStatus(), 'partial');
      assert.equal(billingAvailable(), true);
      const w = String(billingGateWarning());
      assert.match(w, /missing STRIPE_WEBHOOK_SECRET/);
      assert.match(w, /ARMED AND DEAF/);
    });
  });

  test('...and a partial that CANNOT take a card is not told that it is taking cards', () => {
    // The defect: this sentence was appended unconditionally, so a deployment
    // missing only the secret key — every money route 400s, no card can be
    // taken — was warned that it was charging people and losing their renewals.
    for (const missing of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_SUPPORT_PRODUCT_ID'] as const) {
      const env: Record<string, string> = { ...FULL };
      delete env[missing];
      withEnv(env, () => {
        assert.equal(billingGateStatus(), 'partial', missing);
        assert.equal(billingAvailable(), false, missing);
        const w = String(billingGateWarning());
        assert.match(w, new RegExp(`missing ${missing}`), missing);
        assert.doesNotMatch(w, /ARMED AND DEAF/, missing);
        assert.match(w, /The tier is OFF until all four are set/, missing);
      });
    }
  });

  test('a live secret key beside a test publishable key is `mode-mismatch`, not `configured`', () => {
    // Reported, not enforced: the tier stays available on purpose.
    withEnv({ ...FULL, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }, () => {
      assert.equal(billingGateStatus(), 'mode-mismatch');
      assert.equal(billingAvailable(), true);
      assert.match(String(billingGateWarning()), /THESE MUST MATCH/);
    });
    withEnv({ ...FULL, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }, () => {
      assert.equal(billingGateStatus(), 'mode-mismatch');
    });
  });

  test('an unfamiliar prefix is never called a mismatch', () => {
    // A restricted key, or a format Stripe has not shipped yet, is not evidence
    // of a fault. Inventing one here would turn a working deployment's /health
    // red during a cutover, which is the failure this check must not cause.
    withEnv({ ...FULL, STRIPE_SECRET_KEY: 'rk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }, () => {
      assert.equal(billingGateStatus(), 'configured');
      assert.equal(stripeMode(), 'live');
    });
    withEnv({ ...FULL, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_weird_x' }, () => {
      assert.equal(billingGateStatus(), 'configured');
    });
  });

  test('a mismatch that CANNOT take a card does not claim the browser is talking to Stripe', () => {
    // The mismatch arm returned before the missing list was built, so it made
    // the same mistake as the partial arm one round earlier: four states where
    // the tier is OFF were told the browser was loading Stripe.js on the wrong
    // account. Nothing loads Stripe.js on a deployment whose routes all 400.
    withEnv({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, () => {
      assert.equal(billingGateStatus(), 'mode-mismatch');
      assert.equal(billingAvailable(), false);
      const w = String(billingGateWarning());
      assert.match(w, /THESE MUST MATCH/);
      assert.match(w, /The tier is OFF until all four are set/);
      assert.doesNotMatch(w, /The tier is ARMED: it can take a card right now/);
      assert.match(w, /Also missing: STRIPE_SUPPORT_PRODUCT_ID/);
    });
  });

  test('...and a mismatch that is ALSO missing the webhook secret names it', () => {
    // Otherwise a cutover fixes the keys, redeploys, and only then discovers
    // the fourth variable — two round trips on the state DEPLOYMENT.md says
    // not to go live without.
    const env: Record<string, string> = { ...FULL, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' };
    delete env.STRIPE_WEBHOOK_SECRET;
    withEnv(env, () => {
      assert.equal(billingGateStatus(), 'mode-mismatch');
      assert.equal(billingAvailable(), true);
      const w = String(billingGateWarning());
      assert.match(w, /The tier is ARMED: it can take a card right now/);
      assert.match(w, /Also missing: STRIPE_WEBHOOK_SECRET/);
    });
  });

  test('a fully-configured mismatch has nothing else to report', () => {
    withEnv({ ...FULL, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }, () => {
      const w = String(billingGateWarning());
      assert.match(w, /The tier is ARMED/);
      assert.doesNotMatch(w, /Also missing/);
    });
  });

  test('a mismatch is still reported when a fourth value is missing too', () => {
    // Mismatch outranks partial: both are true, and only one of them makes
    // every payment fail today.
    withEnv({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x', STRIPE_SUPPORT_PRODUCT_ID: 'prod_x' }, () => {
      assert.equal(billingGateStatus(), 'mode-mismatch');
    });
  });

  test('whitespace is not configuration', () => {
    withEnv({ STRIPE_SECRET_KEY: '   ', STRIPE_PUBLISHABLE_KEY: '\t' }, () => {
      assert.equal(billingGateStatus(), 'unset');
      assert.equal(billingAvailable(), false);
    });
  });

  test('the alias still supplies the publishable key', () => {
    const env: Record<string, string> = { ...FULL };
    delete env.STRIPE_PUBLISHABLE_KEY;
    withEnv({ ...env, VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }, () => {
      assert.equal(billingGateStatus(), 'configured');
      assert.equal(billingAvailable(), true);
    });
  });
});
