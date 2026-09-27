---
date: "2026-09-26"
title: "Deck-E hardening: a bounded conversation, a normalised route, a guide write bound to its deck"
decided_by: "Chey (via Claude)"
areas: ["agents","decks","frontend","operations"]
supersedes: []
---
## 2026-09-26 — Deck-E hardening: a bounded conversation, a normalised route, a guide write bound to its deck

**Decided by:** Chey (via Claude)

**Decision:** Three findings from the 2026-09-26 security audit are closed in
code. **SEC-04:** `/api/chat` reads at most 256 KB, streamed, and validates the
conversation with zod before any ledger, credit accounting or model call: at
most 200 messages of 80 parts, `user`/`assistant` roles only, text and
`tool-<name>` parts only (so no `file`, `reasoning`, `source-*` or `system`
message from the browser), and no single part over 60,000 characters (a pasted
battle log plus words). A request past a size limit is a 413 the reader sees as
"That's more than I can read in one go"; a wrong shape is a 400. The model is
shown the reader's current turn whole, approvals included, plus the newest
prior history that fits 24 messages and 64,000 characters, cut at a message
boundary and started on a reader message. Every ledger derived from history
(declines, failing tools, what he already said, the paste, research
provenance, the charge hash) still reads the whole validated array. The
browser trims to the same window before sending (`chat/wireWindow.ts`), drops
a message the server already refused, and tells the reader once per
conversation when the start of the chat falls out of the window. Replies that
leave the window still send what the two conversation-wide ledgers need (the
failing-tool breaker and the already-told record) in a separate `evidence`
field the server never shows the model: the breaker's STATE compacted into at
most 4 messages, one per turn depth, each carrying every tool still failing at
that depth since it last worked — plus the newest lookup records in the
remaining room, at most 24 messages. So a tool that failed in two turns stays
switched off however long the chat gets and however many tools are failing
(found by Astra across three review passes: trimming dropped the evidence, a
last-24 slice evicted old failures, and one message per failure could still
cut a tool). A question queued while Deck-E loads is set aside as the current
turn before the window is applied, so an oversized one still reaches the
server and comes back as the 413 it is. And because a bounded window can be
byte-identical across two genuinely new exchanges, the replay-protection key
(`chatChargeReference`) now includes the browser's `exchangeId` and `seq`; a
retried leg of the same exchange still collides and is still refused. `route` is
clipped to 200 characters and each landmark string to 200. **SEC-12:** both
route allowlists (`isAllowedRoute`, `routeAllowed`) accept a path only if URL
resolution leaves it unchanged, and refuse `%2e`/`%2f`/`%5c`/`%00` and control
characters, so `/decks/../profile` no longer reaches `/profile`. **SEC-13:**
`write_strategy_guide`'s sub-agent holds `deck_strategy` through
`bindGuideWrite`: a write must resolve to the same deck as the approved `deck`
argument, and one write is all an approval buys. Reads are unchanged.

**Why:** The charge is flat per request while each of up to twelve steps
re-bills the whole context, so an unbounded client-built history let any
`decke.use` account buy large turns on the owner's key (the audit's proof
carried a 4 MB text part and a PDF `file` URL through the pinned SDK). The
window is 64,000 characters rather than smaller because the paste channel's
ordinary shape is "paste, then say yes on the next turn", and the paste must
still be in the prior window on that turn. The route and guide fixes each turn
a prompt-text promise into a check in code.

**Implications:** A very long conversation now loses its oldest turns from
the model's view; the reader is told, and a new chat is the remedy. Declines
and the other ledgers are unaffected by trimming. `WINDOW_MESSAGES`,
`WINDOW_PRIOR_CHARS`, `PART_MAX_CHARS` and `EVIDENCE_MAX` are mirrored between
`apps/api/src/decke/wireBounds.ts` and `apps/web/src/character/host/chat/wireWindow.ts`
and pinned by `wireBounds.test.ts`; `isNormalPath` is mirrored between
`tools.ts` and `uiTools.ts` and pinned by `tools.test.ts`. A guide sub-agent
that fails its one write cannot retry within the same approval. No schema,
environment variable or deployment change.
