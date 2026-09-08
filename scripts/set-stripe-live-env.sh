#!/usr/bin/env bash
#
# Put the two live Stripe API keys into Vercel Production, without either ever
# appearing on screen, in your shell history, in a file, or in an agent's
# transcript.
#
#   STRIPE_SECRET_KEY       sk_live_… (or rk_live_…)
#   STRIPE_PUBLISHABLE_KEY  pk_live_…
#
# ── WHY THESE TWO ARE TYPED AND THE OTHERS WERE NOT ──────────────────────────
#
# Everything else was scripted end to end. `STRIPE_SUPPORT_PRODUCT_ID` and
# `PUBLIC_APP_ORIGIN` are not credentials and are already set.
# `STRIPE_WEBHOOK_SECRET` IS a credential and is also already set, taken from
# Stripe and handed to Vercel by a script without ever being displayed — Stripe
# returns a webhook endpoint's signing secret in the response that CREATES the
# endpoint, so a program can catch it in flight.
#
# These two have no such path. Stripe exposes no API that returns your secret or
# publishable key — there is no `/v1/apikeys`, by design — so they can only be
# read by a human from the dashboard (Developers → API keys, in LIVE mode). That
# is the whole reason this script still exists.
#
# Usage:  bash scripts/set-stripe-live-env.sh
#
# What it does NOT do: print a value, write one to disk, or deploy anything.
# The merge is the deploy, and it is deliberately not in here.

set -euo pipefail

TARGET="${TARGET:-production}"

# The npm global bin is not always on PATH in a fresh Windows shell.
case ":$PATH:" in
  *":$APPDATA/npm:"*) ;;
  *) [ -n "${APPDATA:-}" ] && PATH="$PATH:$APPDATA/npm" ;;
esac

command -v vercel >/dev/null 2>&1 || {
  echo "vercel CLI not found. npm i -g vercel, then 'vercel login'." >&2
  exit 1
}

# ⚠️ Vercel commands only work from the checkout that holds `.vercel/`, and this
# script lives in a branch worktree that does not. Find the linked one rather
# than failing at the verification step with an empty table.
if [ ! -d .vercel ]; then
  for candidate in "$(git rev-parse --show-toplevel 2>/dev/null)"                    "$(cd "$(dirname "$0")/.." && pwd)"                    /e/Users/cheyr/deckpal "$HOME/deckpal"; do
    if [ -n "$candidate" ] && [ -d "$candidate/.vercel" ]; then cd "$candidate"; break; fi
  done
fi
if [ ! -d .vercel ]; then
  echo "No .vercel/ here. cd to the checkout you ran 'vercel link' in, then run this again." >&2
  exit 1
fi

echo "Linked project: $(pwd)"
vercel whoami 2>/dev/null | tail -1
echo
echo "Setting two API keys on: $TARGET"
echo "Nothing you type is echoed, stored, or printed back."
echo

# ── read, validate, send ─────────────────────────────────────────────────────
#
# The prefix check is not pedantry: a test key here is the failure the whole
# billingGate exists to name, and a secret/publishable pair from different modes
# answers every request 200 while failing every card confirmation in the
# browser. Catching it before it reaches Vercel is cheaper than catching it from
# /health afterwards.
mode_of() {
  case "$1" in
    sk_live_*|rk_live_*|pk_live_*) echo live ;;
    sk_test_*|rk_test_*|pk_test_*) echo test ;;
    *) echo unknown ;;
  esac
}

declare -A MODES=()

put() {
  local name="$1" expect="$2" value="" mode=""

  # -s: no echo. -r: backslashes are literal, which matters for whsec_ values.
  read -rsp "  $name ($expect…): " value
  echo

  if [ -z "$value" ]; then
    echo "    empty — skipped, nothing changed." >&2
    return 0
  fi

  case "$value" in
    "$expect"*) ;;
    *)
      echo "    ✗ does not start with '$expect'. Nothing sent. Check you copied the whole value." >&2
      return 1
      ;;
  esac

  mode="$(mode_of "$value")"
  MODES["$name"]="$mode"
  if [ "$mode" = test ]; then
    echo "    ✗ that is a TEST key and this is $TARGET. Nothing sent." >&2
    return 1
  fi

  # `vercel env add` refuses a name that already exists on the target, so an
  # existing one is removed first. Failure here is not fatal — the usual cause
  # is that it did not exist.
  vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true

  # The value reaches vercel on stdin and never becomes an argv entry, so it
  # cannot be read out of the process list.
  if printf '%s' "$value" | vercel env add "$name" "$TARGET" >/dev/null 2>&1; then
    echo "    ✓ set"
  else
    echo "    ✗ vercel rejected it — run 'vercel whoami' and check you are linked." >&2
    return 1
  fi

  unset value
}

put STRIPE_SECRET_KEY      sk_ || true
put STRIPE_PUBLISHABLE_KEY pk_ || true

# ── the mode-mismatch check, before anyone deploys ───────────────────────────
sk="${MODES[STRIPE_SECRET_KEY]:-}"
pk="${MODES[STRIPE_PUBLISHABLE_KEY]:-}"
if [ -n "$sk" ] && [ -n "$pk" ] && [ "$sk" != "$pk" ]; then
  echo
  echo "  ⚠️  MODE MISMATCH: the secret key is $sk and the publishable key is $pk."
  echo "      The browser would load Stripe.js on one account while the server"
  echo "      creates intents on the other: every request answers 200 and every"
  echo "      card confirmation fails. Fix both before deploying."
fi

# ── verify: names and targets only, never values ─────────────────────────────
echo
echo "On $TARGET now (names and targets only — values are never displayed):"
vercel env ls 2>/dev/null \
  | grep -Ei 'STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_SUPPORT_PRODUCT_ID|PUBLIC_APP_ORIGIN' \
  | grep -i "$TARGET" \
  | awk '{ printf "  %-28s %s\n", $1, "'"$TARGET"'" }' \
  | sort -u

echo
echo "Expected: all four STRIPE_* plus PUBLIC_APP_ORIGIN."
echo
echo "Nothing is deployed yet. The real proof is after the merge:"
echo "  curl -s https://deckpal.app/api/health | jq '{billingGate, stripeMode}'"
echo "  → {\"billingGate\":\"configured\",\"stripeMode\":\"live\"}"
echo
echo "Anything else means a value did not arrive or is the wrong one — see"
echo "DEPLOYMENT.md, which lists what each answer means."
