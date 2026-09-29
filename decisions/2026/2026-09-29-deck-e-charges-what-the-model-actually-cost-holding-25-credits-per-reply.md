---
date: "2026-09-29"
title: "Deck-E charges what the model actually cost, holding 25 credits per reply"
decided_by: "owner"
areas: ["Deck-E", "credits", "billing"]
supersedes: []
---
## 2026-09-29 — Deck-E charges what the model actually cost, holding 25 credits per reply

**Decision:** A Deck-E reply costs exactly what its model calls cost on the
Gateway — every chat step, web research and the Jev classifier — converted at
the request's frozen rate and markup (1 credit = 1¢ today), with sub-credit
fractions carried rather than rounded up. Before a reply calls any model it sets
aside a hold of 25 credits, or whatever the balance has left down to a 3-credit
minimum; when the reply finishes the actual cost is kept and the rest returns
immediately. A reply that reaches its hold stops calling models and Deck-E says
this is as far as he can take it in one go, offering to continue. Unknown cost
is recorded as unknown, never estimated into a charge.

**Why:** Flat per-run prices (1 / 4 / 75 credits) were set as estimates months
earlier and no longer described what anything cost; on Claude Sonnet 5.5 a
greeting costs about 1.6¢ and a full deck-building conversation about 52¢, so
any flat price overcharges the first and undercharges the second. The owner
wants credits to map to money ("we can change what a credit represents later").
The hold is risk control, not a price: 25 credits covers every reply measured
in the replay probes with room to spare, and the 3-credit floor keeps small
balances usable for ordinary replies.

**Implications:** Migration 081 converts the current credit policy to a
versioned metered policy and adds reservation and settlement records; the code
keeps flat pricing until that migration runs, so it ships first and the owner
migrates after. Balances and statements show up to four decimals. Import-fix's
separate fractional carry is folded into the one generic carry, so a user has a
single sub-credit liability. The hold size and minimum are policy settings the
owner can change in admin without a release.

**Overshoot is never the reader's debt (owner ruling, same day).** The cap is
checked before each model call, so the last call can carry a reply a few cents
past what a small wallet has left. The first build turned that into debt; the
owner rejected it: *"I don't want it to be like an 'owed' thing. Especially for
1 or 2 cents, that's lame. I've never had an app tell me I owed on an overage."*
Research agreed — consumer credit products (Lovable, Manus, Figma Make) let the
crossing step finish and absorb it; only developer APIs (OpenAI, Anthropic)
carry a negative balance into the next purchase. So the wallet pays what it
can, and the rest — whole credits and any fraction left on an emptied wallet —
comes out of an overage buffer that DeckPal keeps: 2,000 credits ($20) by
default, seeded full, its maximum an admin setting. Exposure is small by
construction: an overshoot needs a wallet below the hold, is at most one model
call, and leaves the wallet at zero, below the 3-credit minimum, so the next
overshoot needs a new top-up. The buffer is covered even when empty (it then
reads negative, which is the owner's signal). Refund and dispute clawbacks
still create debt; that is a payment reversal, not usage. The owner also wants
unused credits to expire into the buffer up to its maximum, and contributions
that fall short of Deck-E use to feed it; both wait for the pricing work that
sets expiry periods and that threshold.
