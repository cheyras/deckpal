---
date: "2026-08-23"
title: "Credits replace the daily meter, and a deep call asks first"
decided_by: "the owner, on both counts. Built by Claude, **switched off**."
areas: ["commerce"]
supersedes: []
---
## 2026-08-23 — Credits replace the daily meter, and a deep call asks first
**Decided by:** the owner, on both counts. Built by Claude, **switched off**.
**Decision:** (1) migrations 041/042 add `decke_credit_balance` and
`decke_credit_event`; `apps/api/src/decke/credits.ts` prices work against
measured cost. Inert until `DECKE_CREDITS_ENABLED=true`. (2) Every deep tool now
declares `needsApproval`, and the consent card carries his restatement of the
request.

**Why credits:** the two daily counters produced what the owner called a useless
agent — *"he basically kind of becomes useless when this happens… I'm using him
but he can't really do anything."* The failure is not the number: a per-tier cap
leaves a HALF-DEAD AGENT, present and answering and unable to do the thing you
opened him for, which is the shape of every defect this pass exists to remove.
I recommended keeping cheap features alive at zero and **the owner overruled it**:
*"He can chat and lookup but he can only pretend to do other stuff and that
sucks."* He is right — an agent that can only pretend is worse than one honestly
away. One balance, hard stop.

**Why a balance row and an event log:** the balance is spent by a single
conditional `UPDATE … WHERE balance >= $2`, so the check and the decrement are
under one row lock and zero-rows-affected IS the refusal. Summing the log
instead cannot be spent atomically without SERIALIZABLE or a table lock — two
concurrent turns would each read enough and each spend, and the whole point of a
hard stop is that it cannot be crossed. The log is the audit trail these will
need once they are bought.

**Why deep calls now ask:** they were exempt with an argued reason — *"asking
about a read is friction with no safety behind it, and friction people learn to
click through is worse than none."* Correct about safety, silent about COST. A
deep call is a sub-agent with its own model and up to 210 s, and under credits it
is the only thing a reader can run out of. Measured on camera: asked for "a new
deck, doesn't have to be good", he spent one before anything was confirmed, then
spent another. The friction argument is answered by what the card SAYS — his
restatement of the request, so the tap confirms a specific piece of work — and
the spend is gated by construction, because `charge()` runs inside an execute the
SDK will not run until approved.

**Implications:** **041 creates every balance at zero**, so setting the flag
before granting balances makes Deck-E unavailable to everybody at once. Order:
migrate → grant → flag. 039 stays in place so it is reversible. `CREDIT_USD` is
expressed as measured model COST; **the retail price of a top-up is not encoded
anywhere and is the owner's to set**, as is the payment integration — this
builds the mechanic and stops at the paywall. Neither migration has been run
against any database (contract B9).

