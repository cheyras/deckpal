---
date: "2026-09-26"
title: "Jev checks his reply against what he did, and he corrects himself with the real card"
decided_by: "Chey (via Claude), under the 2026-09-26 approval to use Jev"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Jev checks his reply against what he did, and he corrects himself with the real card

**Decided by:** Chey (via Claude), under the 2026-09-26 approval to use Jev
wherever it improves the reader's experience of Deck-E.

**Decision:** With `DECKE_JEV=on`, once a leg's stream ends, Jev reads the
reader's message and Deck-E's reply (`audit.ts`): did the reply claim a change
or a move, and of which kind? If it claimed a collection, list, deck or
battle-log change and no tool that performs one ran this turn, the same response
continues with ONE corrective step — the same model, tools and prompt prefix,
`toolChoice` pinned to `log_cards` / `edit_list` / `save_deck` /
`add_battle_log`, the same approval secret — under a line in his voice ("One
correction: I said that as if it were done, but I hadn't actually run it. Here
it is for you to confirm."). Every one of those tools holds its change for the
signed card, so the correction can only ask. A claimed guide or walk gets the
existing first-person admission instead (a guide is a paid deep call; a walk has
no card and a forced `goTo` would invent a route). "Performed" is every tool the
turn touched — the leg's calls, every chip its handlers emitted, and the tool
parts replayed after the reader's message — because a write approved on the
previous leg executes before this request's first step. A navigation handoff is
never audited. Jev off, slow, unsure or failing: the guard chain is exactly as
before.

**Why:** Phantom actions are the angriest quotes in the owner's history, and the
guard for them (`phantomClaims`) is regex tuned for precision: on the 40-item
audit set it catches 3 of 15 phantoms and fixes none. With Jev, over three paid
passes: 15 of 15 caught, 0 of 25 clean turns flagged, the kind right in all 15;
12 of the 15 are correctable kinds and get the card, the other 3 get the
admission. The regexes stay: Jev's recall sits under their precision (a regex
hit still produces a note when the audit is off or unsure).

**Implications:** The audit adds one Jev call after each leg that spoke
(~570 input tokens, ~$0.000024, p50 269 ms / p95 371 ms measured), bounded by
`DECKE_JEV_TIMEOUT_MS`, before the response closes. A corrective step is a real
model step: it is metered like every other (`observeUsageModel`), rides inside
the flat chat-turn charge, and only runs while the turn is under `MAX_STEPS`.
The reader sees the false sentence before the correction: Jev cannot stop a
stream mid-word, so the fix is fast and honest rather than invisible. Whether
the chat model, once pinned, fills the arguments well is covered by mocked
tests and by `log_cards`' own preflight; it has not been measured live.

