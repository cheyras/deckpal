---
date: "2026-09-27"
title: "Allow Stripe Payment Element and Link in the browser policy"
decided_by: "Chey (via Codex)"
areas: ["security", "billing"]
supersedes: []
---
## 2026-09-27 — Allow Stripe Payment Element and Link in the browser policy
**Decided by:** Chey (via Codex)

**Decision:** Allow the Stripe.js and Link script, frame, connection, and image hosts required by Stripe's CSP guide in the Vercel document policy. Keep the existing diagnostic policies aligned with the general policy.

**Why:** DeckPal's card form embeds Stripe's Payment Element and offers Link. The first policy allowed only `js.stripe.com` scripts and frames, so Link and alternate Stripe.js frame hosts could be blocked when saving a card. Credits purchases redirect to Stripe-hosted Checkout; that flow needs no Checkout hosts in DeckPal's document policy.

**Implications:** The header check now asserts every required source separately. Browser probes verify that requests to those hosts can pass the literal policy; a real Payment Element still needs a Stripe key and SetupIntent secret, which the local fixture intentionally lacks.
