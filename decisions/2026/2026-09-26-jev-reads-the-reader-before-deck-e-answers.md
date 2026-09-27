---
date: "2026-09-26"
title: "Jev reads the reader before Deck-E answers"
decided_by: "Chey (via Claude). Chey approved Jev on 2026-09-26 (\"implement"
areas: ["agents","decks"]
supersedes: []
---
## 2026-09-26 — Jev reads the reader before Deck-E answers

**Decided by:** Chey (via Claude). Chey approved Jev on 2026-09-26 ("implement
Jev, yes. Use it wherever it would improve a user's experience with Deck-E") and
confirmed that TypeSafe AI is a US company, so `typesafe-ai` joins the "US
frontier labs only" list in `models.ts` rather than being an exception to it.

**Decision:** Behind `DECKE_JEV` (default off), each `/api/chat` request gets
one typed evaluation by `typesafe-ai/jev` of the reader's latest message before
the model runs (`reflex.ts`, `jev.ts`); a turn with browser or approval legs
repeats it per leg, because the server keeps nothing between requests, and only
the leg carrying the reader's message may force (found by Astra in review). Three answers act, each only above a threshold chosen on a labelled
eval set: a plain collection change pins step one's `toolChoice` to `log_cards`,
which raises the signed consent card and cannot write without it; a walk to a
list, deck or other non-set page takes `escort` out of view; and a refusal said
in words ("stop researching the meta, you already did") is added to the declined
ledger and outranks the reader-mention bypass. Jev never approves a write. On a
timeout (`DECKE_JEV_TIMEOUT_MS`, default 800 ms), an HTTP error, a malformed or
low-confidence answer, or the switch off, the turn runs exactly as before. Every
call asks the Gateway for zero data retention and pins the provider to
TypeSafe. The call is plain HTTP to `/v1/evaluate`: `experimental_evaluate`
needs `ai` 7.0.105 and this repo pins 7.0.94, the version the signed approval
replay was verified against.

**Why, and why this is not the classifier `api/chat.mjs` rejected:** that
comment rejects "a classifier turn in front of every message" because it "taxes
the 90% that do not need one" and "a misroute is INVISIBLE". Both were true of an
LLM turn and are measured false here. The tax: a reflex read is ~854 input
tokens, $0.000036 (≈0.3% of a ~$0.0115 chat turn), no output tokens, p50 279 ms
and p95 418 ms over 198 calls through the Gateway (from a residential
connection), under a hard deadline. The misroute: every answer carries a
probability, and an action fires only above its threshold; below it the turn is
today's. On `apps/api/src/decke/eval/judgments.json` (66 synthetic reader
messages, three paid passes, identical results each time):

| Judgment | Today | With Jev |
|---|---|---|
| Force the consent card for a collection change (20 of 66) | 0 / 20 (nothing forces it) | 20 / 20, 0 false forces |
| Hide `escort` for a page it cannot reach (8) | 0 / 8 | 8 / 8, 0 false hides |
| Hear a spoken refusal (8) | 0 / 8, and the bypass re-opens 7 of them | 8 / 8, 0 false refusals |
| A declined family handled right afterwards (13) | 6 / 13 | 13 / 13 |

Thresholds: force at p ≥ 0.5 (the weakest true positive was 0.56, the strongest
negative 0.30), destination p ≥ 0.85 / confidence ≥ 0.7, decline p ≥ 0.8.

**Implications:** TypeSafe AI is a new data processor for the reader's latest
message, Deck-E's previous reply and the page path. No separate collection or
account records are attached, but those fields are not redacted and may contain
ownership counts, card IDs, account details or deck/list IDs. Its retention is
unconfirmed: the Gateway lists `zdr: "none"`, Vercel's guide offers ZDR per
request, and TypeSafe offers ZDR to enterprise customers only; measured, the
Gateway honours the per-request flag by skipping a non-ZDR host (SECURITY.md).
Jev's model id is unpinned on the Gateway, so the thresholds must be re-measured
with `scripts/decke-jev-eval.mjs` when it changes (`--replay` re-scores saved
answers for free). The eval set is synthetic and small, written and labelled by
one author; it is the first persisted offline eval corpus for Deck-E and is
scored for today's heuristics in CI (`judgmentsEval.test.ts`). Jev's cost rides
inside the flat chat-turn charge (no new charge, no token settlement) and is
logged per call as tokens and Gateway-reported cost, never with reader text; it
is not written as a usage operation, because recording a provider start would
stop an aborted turn's credit being refunded. The research report's code map was
corrected against the code: `ai` is 7.0.94 (not 7.0.66), `research_meta` is
already in the name-level decline set, and `escort`'s description already
routes lists and decks to `goTo`/`journey`. Body reflexes (the report's #4) were
not built: no in-code heuristic exists to beat, it would restructure `express`
and the client state machine, and whether his body should react before his
words is the owner's taste call.
