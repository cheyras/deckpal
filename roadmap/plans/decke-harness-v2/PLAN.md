# Deck-E harness v2 — a front door, pathways, and a Deep Think tier

Status: PLAN (2026-10-10). Owner brief: the 2026-10-10 voice note (summarised in §1).
Research behind it: §2 (sources inline). Supersedes nothing yet; each phase
gets its own decision file when it ships.

## 1. What the owner asked for

- **Haiku 5.5 is the front door.** Every request starts cheap. Haiku judges what
  the request needs: handle it, hand it up to Sonnet 5.5, or — only when it truly
  pays — offer the top tier (Opus 5.5), which has a name and asks the reader's
  permission because it costs more.
- **Deck-E approaches each kind of job like someone who knows the job**:
  building decks with the reader (not grabbing a top list), planning collection
  completion, making lists, versioning a deck from its battle results, logging
  and *analysing* battles, researching when it actually helps. Pathways, not
  scripts: the steps adapt to what was asked and what is known.
- **Battle logging works, and the notes are worth reading later.** Triage the
  game: a nothing-burger gets a quick record and a line; a complex game, a new
  archetype, or an archetype the reader keeps meeting gets a real analysis — Sonnet, or
  Deep Think plus research. A PTCG Live paste is rich; an in-person "I lost to a
  guy spamming X" is thin, so Deck-E asks a few good debrief questions (a Q&A
  card, like Claude's AskUserQuestion) to close the gap.
- **Interim updates.** Groups of tool calls with a short "found this, now
  checking that" between them, instead of a silent minute and one big reply.
- **Cost-conscious by default**: cheap for everyday requests, spend saved for
  the ones that benefit.

## 2. What the research says (and how it lands here)

Measured or vendor-tested findings that shape the design. Full reports were
gathered 2026-10-09/10; the load-bearing sources are linked.

1. **A small model is a good triager when it fills a rubric, not when it grades
   itself.** Haiku 5.5 is built for "classification, routing, extraction"
   ([what's new](https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5)).
   Models' self-reported confidence is overconfident
   ([Xiong et al.](https://arxiv.org/abs/2306.13063)); cascades only pay when the
   deferral signal detects *this* model failing
   ([Bouchard 2026](https://arxiv.org/abs/2605.06350)); Anthropic measured
   Haiku 5.5 consulting an Opus advisor on 0 of 198 questions
   ([cost guide](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).
   → Haiku fills **structured fields** (pathway, signals, missing inputs); **code**
   maps them to a tier, with hard floors and guard-driven escalation.
2. **Haiku 5.5 alone is not the deck-building brain.** It ties Sonnet 5.5 on
   bounded tool work (τ²-Airline 74.9% vs 74.7%, at 7% of the cost —
   [OpenRouter](https://openrouter.ai/benchmarks/tau2-bench-airline)) but trails
   on judgment (GDPval 1620 vs 1840; every task-measured comparison users posted
   went to Sonnet). Anthropic: Sonnet/Opus "remain better choices for complex
   agentic tasks". → Deck building, deck iteration and deep analysis have a
   **Sonnet floor**.
3. **Long always-on prompts make small models worse.** Haiku 5.5 with a long
   system prompt at low effort "is more likely to skip a search, stop early, or
   skip a check"
   ([Haiku 5.5 guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5));
   instruction-following decays with instruction count
   ([IFScale](https://arxiv.org/abs/2507.11538)). Deck-E's prompt is 29.6k chars,
   ~9.5k of it navigation. → **Slim core prompt + one pathway block per request**
   (progressive disclosure, as Agent Skills do).
4. **Pathways = natural-language procedures with code guardrails.** Intercom Fin
   Procedures and Decagon AOPs: steps can be skipped/revisited, validation lives
   in code. Anthropic: "templates not scripts", high freedom for advice, low
   freedom for fragile writes. → Each pathway: trigger, goal, required inputs,
   suggested steps with branches, research policy, tier floor, **definition of
   done** checked by a tool.
5. **Interim progress measurably helps — if it carries content.** CHI 2026 in-car
   agent study: stepwise updates with intermediate results vs silence → perceived
   speed d=1.01, trust d=0.38 ([arXiv 2602.15569](https://arxiv.org/html/2602.15569v2)).
   Anthropic's "you haven't spoken in a while" nudge roughly halved long silent
   stretches with no cost change (Opus 5.5 guide). GPT-5.1 guidance: 1–2
   sentences every few tool calls, each with a concrete outcome. → Prompt the
   cadence, batch parallel calls, and fix the stop rule that can end a turn after
   an interim line (§4.6).
6. **Agents under-ask, and bad questions annoy.** Interaction lifts underspecified
   tasks up to 74% but models don't ask unless pushed
   ([Ambig-SWE](https://arxiv.org/html/2502.13069v3)); low-quality questions
   "disturb users" (Zou et al.). → Ask only when readings would lead to
   materially different work, after cheap lookups, ≤1 card per turn, 1–4
   questions, multiple choice + "Other".
7. **Haiku/Sonnet 5.5 distrust user words inside tool results.** "Never put user
   text inside a `tool_result` block … append the user's words as a text block
   after the last `tool_result`" (Haiku 5.5 guide). → Ask-card answers arrive as
   a **user message**, not a tool result.
8. **Research only what can change.** Haiku 5.5 guide: a targeted "prices,
   rotation, anything 'latest' may have changed; facts that can't change need no
   search" nudge raised useful searches; a blanket "search everything" rule doubled
   needless searches with no accuracy gain. → Research meta/tournaments/rotation/
   new sets; never card text or legality (DeckPal has those).
9. **Caches are per model; the prefix must be stable.** Switching models re-writes
   the prefix on the new model; changing `tools` mid-turn breaks the cache (and,
   on enforced accounts, replayed thinking). → Choose the model at the **request
   boundary**, keep tools identical across steps, move volatile text out of the
   cached block.
10. **Evals: real-failure scenarios, outcome grading, pass^k, cost per passed
    task** (Anthropic evals post; τ-bench). → Extend `scripts/decke-replay-probe.mjs`
    per pathway and per tier.

Domain inputs (Pokémon TCG): PTCG Live log grammar and what it can/can't reveal,
a game-review rubric (variance / misplay / list / matchup; turning point; prize
map), in-person debrief questions, archetype naming and the Limitless Play API
(no key, ~50 req / 5 min, online events only), deck-building skeleton and
consistency odds, Standard = H/I/J since 2026-04-10. These feed the pathway texts.

## 3. What the code does today (the parts this plan changes)

- One model, chosen statically: `MODELS.chat` = Sonnet 5.5 (`api/chat.mjs:726`).
  No `effort`/`thinking` sent, so Sonnet runs adaptive at `high` with hidden
  thinking eating into `maxOutputTokens: 8000`.
- Cache: one breakpoint on the system message. The cached block ends with the
  date, route and landmarks, so it differs per page and per day. History and
  in-turn step results are never cached.
- `focusedTools` hides 10 writes on step 0 (`focus.ts`), changing the tool set
  between steps — and it means a pasted battle log cannot be logged on step 0.
- `stopWhen` ends the turn once the model has spoken and the last step was only
  `express`/`showScreen` — an interim line followed by an express step ends work.
- No ask/clarify mechanism. No per-operation guidance beyond deck building and
  a 2026-08-29 battle-log paragraph marked UNPROBED.
- Battle logs: `raw_log` is required (in-person games can't be logged at all);
  `opponent_deck` is free text (no archetype frequency); `notes` ≤2000;
  `source` is hard-coded `'deckpal-mcp'` for Deck-E writes too.
- Credit hold is one policy-wide 25 credits per request (migration 081), which
  caps a request at ~$0.25 — too small for an Opus request.

## 4. Design

### 4.1 Request flow

```
reader message
  └─ triage (Haiku 5.5, structured, ~1s)          ← new
       pathway · signals · missing_inputs · write_intent · wants_deep
  └─ tier = max(pathway floor, triage hint, carried escalation)   ← code
  └─ main loop: tier model + effort, core prompt + pathway block   ← changed
       tools stable across steps; progress cadence; ask card; guards
  └─ turn guards (existing) → escalate next request / corrective leg on Sonnet
```

Continuation legs (approval answers, client-tool results) skip triage and keep
the request's tier and pathway (carried in a signed field, §4.9).

### 4.2 Tiers

| Tier | Model | Effort | When |
|---|---|---|---|
| Quick | Haiku 5.5 | `low` chat/navigation, `medium` tool work | default |
| Standard | Sonnet 5.5 | `medium` | pathway floors; triage hint; guard escalation; Haiku refusal |
| **Deep Think** (name: owner's call) | Opus 5.5 | `high` | only with the reader's OK on a consent card that says why and roughly what it costs |

- Thinking stays adaptive on every tier (Haiku with thinking off skips tool calls
  per Anthropic). `maxOutputTokens` rises to cover thinking.
- Gateway fallback per tier: Haiku → Sonnet; Sonnet → existing Gemini fallback;
  Opus → Sonnet. Provider pinned to Anthropic direct where cross-model thinking
  or betas matter (`only: ['anthropic', 'google']`).

### 4.3 Triage (the front door)

A Haiku 5.5 call with thinking off, strict JSON output, its own small cached
prompt. Inputs: the reader's message, the last ~800 chars of Deck-E's reply, the
page, the conversation's current pathway and tier, cheap facts (did they paste a
PTCG Live log? how long is it?). Output (all enums except free-text `brief`):

- `pathway`: one of §4.5.
- `signals[]`: e.g. `new_deck`, `deck_from_results`, `pasted_ptcgl_log`,
  `self_reported_game`, `close_game`, `asks_why`, `asks_for_depth`,
  `dissatisfied`, `continuing`.
- `missing_inputs[]`: what the pathway needs that isn't known yet.
- `write_intent`, `needs_research` (booleans), `wants_deep` (`no` / `offer` /
  `requested`).

Code, not the model, turns those into a tier: pathway floors, `dissatisfied` →
Standard, `requested` deep → consent card, `offer` deep → Standard with the
consent card offered at the end. Haiku's judgment matters; it is never the only
gate. Jev's reflex keeps running (it is ~$0.00004 and 0.3 s) until triage is
proven to cover its `hide` job; then it is retired in a separate change.

### 4.4 Escalation (beyond triage)

- **Guards** already in `turnGuards.ts` (flailing, 24-step circling,
  promised-without-acting, phantom claims, ungrounded ids, `showDeck` with
  `legal:false`) mark the conversation: the corrective leg and the next request
  run on Standard.
- **Refusal** (`stop_reason: refusal`) on Haiku → retry that request on Sonnet
  (Haiku 5.5 has no server-side fallback).
- **Inside a Quick turn, a focused consult**: a `consult` tool that runs Sonnet
  on a brief (Haiku's "think this through in more detail") and returns its answer
  for Haiku to use — the owner's "Haiku prompting into Sonnet internally". Used
  by pathways where the work is one hard sub-question (a battle analysis, a
  matchup read), not a whole loop.
- **Deep Think** is offered, never assumed: a `deep_think` consent tool raises a
  card with the reason and an estimate; on OK the next request runs on Opus with
  a larger hold. The tool's approval is HMAC-signed like other approvals, so the
  server re-derives "Opus approved for this request" from the replay.

### 4.5 Pathways

Each is a short markdown file under `apps/api/src/decke/pathways/` (trigger,
goal, inputs, steps with branches, research policy, tier floor, definition of
done, a worked example). The core prompt carries a one-line index of them.

| Pathway | Floor | Definition of done |
|---|---|---|
| `battle_log` (PTCG Live paste / in-person / quick result) | Quick; review depth decides | logged on the right deck+version, result right, note written at the depth the game deserves |
| `battle_review` (analyse one game or a set) | Standard | turning point + cause category + one matchup lesson + one list lesson, all tied to log facts |
| `deck_build` (new deck, with the reader) | Standard | `check_deck` legal at 60, every id grounded, choices explained, reader invited to react |
| `deck_iterate` (new version from results) | Standard | per-matchup record with sample-size honesty, ≤2 changes proposed, new version saved only on OK |
| `collection_plan` (set/master-set completion, budget) | Quick | goal defined, cost to finish from DeckPal prices, singles-vs-sealed caveat, list/cart offered |
| `lists` (make/edit lists) | Quick | list written via approval, contents summarised |
| `price_value` (what's it worth, movers) | Quick | numbers only from tools, grain rules respected |
| `card_rules` (card text, rulings) | Quick | text from `get_card`/`search_cards`, never memory |
| `research` (meta, archetypes, events) | Quick | dated, sourced, scoped to what can change |
| `navigate`, `small_talk` | Quick | — |

**Delivery.** The pathway block is a second system block after the cached core
prompt, with its own cache breakpoint (`instructions` accepts an array of system
messages in ai@7). It changes only between requests, never between steps, so it
cannot invalidate in-request thinking. If triage picks the wrong pathway the core
prompt still works; the next request re-triages.

**MCP parity.** The same pathway texts are served to MCP clients (server
instructions + prompts), so Claude-over-MCP stops doing "the bare minimum"
battle log too.

### 4.6 Interim progress

- Prompt cadence (all tiers): one line of intent before the first batch; after
  each batch of related lookups, one or two sentences with a concrete finding and
  what's next; batch independent calls in parallel; never narrate tool names;
  recap at the end.
- Fix `stopWhen` so an interim line followed by an `express`/`showScreen` step
  does not end the turn; keep the circuit breakers.
- Keep text/tool order when replaying a message (`messagesToWire` currently puts
  all text first).
- Phase 2, after a Gateway probe: `thinking.display: "updates"` on Sonnet/Opus,
  rendering progress-update blocks as transient progress lines; a capped
  "you haven't spoken in a while" nudge after ~5 silent steps.

### 4.7 Ask card

`ask_user` (server-executed, ends the turn): 1–4 questions, header ≤12 chars,
2–4 options each, optional multi-select, always an "Other" free-text field and a
"Skip". Docks in the approval slot (Deck-E stands on it, like the feedback card).
The answer returns as the reader's next **message** ("Format: Standard · Budget:
under $50 · …"); "Skip" sends "skip — use your best judgment". Pathways say when
to ask: inputs that would change the work materially and can't be looked up.

### 4.8 Battle logs v2

- **Fix** the logging failure (root cause: §6) and drop the step-0 write hiding.
- **Schema** (one migration): `raw_log` nullable when the game is self-reported;
  `origin` (`ptcgl` | `in_person` | `other`) separate from the writer `source`;
  `opponent_archetype` (normalised key) for frequency; `review_md` (≤12k) for the
  analysis, leaving `notes` for the reader's own words.
- **Digest tool** (`battle_digest`): parses the log server-side into what an
  analyst needs — first/second, mulligans, opening, prize timeline, first-attack
  turns, opponent card ledger → archetype guess, close-game flag, end reason —
  so no model reads 50k chars of raw log.
- **Review depth rubric** (in the pathway, with code-computed facts): light
  (lopsided, variance, early concede) → Haiku writes 2–3 lines; standard (close,
  decided by a few decisions, or the reader asks why) → `consult` on Sonnet;
  deep (new archetype for this deck, an archetype met ≥3 times, a losing streak
  vs one deck, or the reader wants depth) → offer Deep Think + research.
- **In-person games**: 3–5 debrief questions via the ask card (opponent's main
  attacker and notable cards, first/second, prize flow, the most frustrating
  play, the turn they'd replay), optional `research` for loosely matching
  archetypes, stored in the same shape as a parsed log so both aggregate.

### 4.9 Cost and cache layout

- Core prompt + tools byte-identical across requests (date/route/landmarks move
  to a trailing uncached block), breakpoint 1.
- Pathway block, breakpoint 2.
- A breakpoint on the newest message each step so in-turn steps read earlier
  steps from cache (today every step re-pays them at full input price).
- Tools never change between steps (step-0 hiding removed; refusals are execute-
  time errors, not missing tools).
- Per-tier credit hold: Quick and Standard keep the policy hold; Deep Think
  requests hold more, by consent (needs a migration on the authorize function).
- Request tier + pathway + trigger are logged on `decke_ai_operation` so
  misroutes are visible.

## 5. Phases (one PR each, in order)

1. **Battle-log fix + harness hygiene** — the logging root cause; stable tools;
   `stopWhen` fix; explicit effort + output budget; cache layout; writer `source`.
2. **Tiers + triage** — triage call, tier mapping and floors, guard/refusal
   escalation, per-tier fallbacks, logging. Deep Think consent card + hold.
3. **Pathways + slim prompt** — pathway files, core prompt rewrite, progress
   cadence, research policy, Haiku/Sonnet-tested prompt blocks. MCP parity.
4. **Ask card** — `ask_user` + docked card + answer-as-message.
5. **Battle logs v2** — migration, digest tool, review rubric, in-person flow,
   archetype frequency, `consult`.
6. **Progress phase 2** — `display: "updates"` + nudge, after the Gateway probe.

Each phase: tests, `decke-replay-probe` scenarios for its pathway on every tier
that will run it (pass^3, cost per passed task), browser verification at desktop
and 390px for UI, a decision file, docs/wiki sync, Opus review before merge.

## 6. Battle logging: root cause (diagnosed 2026-10-10)

Production logs (`vercel logs`, read-only): every `POST /decks/log-preview` in
the last 14 days came from MCP sessions. On 2026-09-30 05:17Z and 2026-10-05
02:46Z the owner pasted a log into Deck-E; Deck-E made no log-preview call and
no write (nothing at all, then only reads), and minutes later the owner logged
the same games through MCP (201). The write path itself works end to end
(verified with the real SDK, tools, paste channel and approval replay).

1. **The tool was out of view when it was needed.** `focus.ts` hides every
   write except `log_cards` on step 0 — including `add_battle_log` — while the
   prompt says "a pasted battle log is a request to log it. Call add_battle_log".
   `stopWhen` then ends the turn once he has spoken and expressed, so the turn
   rarely reached step 1, where the tool appears.
2. **Nothing caught an unlogged paste.** The after-turn audit only fires when
   the reply *claims* a write.
3. **The paste extractor truncates real logs.** One unrecognised line ("is now
   Asleep.", "Pokémon Checkup", "shuffled their deck." without a dash) cuts a
   real 313-line log to 22%, losing the closing "wins" line.
4. **Preview and write disagree.** The dry run never runs the owner check the
   write runs, so a reader can approve and then hit "could not determine which
   player is the deck owner". A card is also raised when `@pasted` has no paste.

Separately (not this cause): the DB pool warnings behind the September
`decks`/`battle_logs` 500s were fixed on 2026-08-29; today (2026-10-10
19:39–19:51Z) `pg-pool` connect timeouts hit `/api/me` and `/mcp` during a burst
of ~40 parallel `/api/dev/scan-queue/*.jpg` requests — a scanner-side issue.

## 7. Owner decisions (2026-10-10)

- Top tier name: **Deep Think**.
- Consent: **always ask, with a cost** — a card each time saying why it would
  help and roughly how many credits; offered only when the rubric says the
  request truly benefits.
- Eval budget for this pass: **$25** of Gateway spend (actuals reported per phase).
- Triage runs on **every new message** (~1 s; his body reacts immediately).
- Still open: applying the battle-log v2 migration to production (owner runs it
  before that PR merges).

## 8. Unverified (probe before relying on it)

- Gateway pass-through of `display: "updates"`, effort-only system messages,
  `anthropic-beta` headers.
- Whether `gateway.cost` applies Haiku's >100K price tier.
- Which Anthropic account the Gateway uses (preserved-thinking enforcement and
  account binding).
- Haiku 5.5 writing visible text between tool calls.
