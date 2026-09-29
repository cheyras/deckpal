/**
 * Which model does which job, and why that one.
 *
 * Every number here was MEASURED against the live Vercel AI Gateway on
 * 2026-08-21, not read off a pricing page. Where a cheaper or more obvious model
 * was rejected, the rejection is recorded with its evidence — the whole point of
 * a table like this is that the next person to look at it can see the cost of
 * changing their mind rather than rediscovering it.
 *
 * HARD CONSTRAINT: US frontier labs only (openai, google, anthropic, xai,
 * amazon, meta, mistral, typesafe-ai). The owner's call, and it is the
 * defensible answer for a paid product streaming a user's camera and
 * collection to a third party. The Gateway offers cheaper non-US options; they
 * are not eligible, and a future cost squeeze must not quietly reach for them.
 *
 * `typesafe-ai` joined on 2026-09-26, by the owner's decision: TypeSafe AI is a
 * US (San Francisco) lab, so Jev fits the rule rather than being an exception
 * to it. Its data retention is NOT confirmed — see `EVALUATION` below and
 * SECURITY.md — which is why every Jev request asks the Gateway for zero data
 * retention and pins the provider.
 */

/** A job Deck-E needs a model for. */
export type Job = 'chat' | 'write' | 'vision' | 'analysis' | 'research'

export type ModelChoice = {
  /** Gateway model id. */
  readonly id: string
  /** Used when the primary errors. A DIFFERENT LAB, so a provider outage that
   *  takes the primary down does not take the fallback with it. */
  readonly fallback: string
  /**
   * Reasoning effort, when the model supports it.
   *
   * NEVER omit this on a reasoning-tagged model. Measured, four separate times:
   * a reasoning model with a tight token budget spends 100% of `max_tokens` on
   * hidden reasoning and returns EMPTY content with `finish_reason: "length"` —
   * a silent, billed non-answer. `reasoning: {budget_tokens: 0}` does not work
   * on Gemini; `reasoning_effort` is the shape the Gateway honours.
   */
  readonly effort?: 'minimal' | 'low' | 'medium' | 'high'
  /** Ceiling on visible output. See `RESERVE` — reasoning models need headroom. */
  readonly maxOutputTokens: number
  /** A dearer model used only when the person explicitly asks for deeper work. */
  readonly escalate?: string
}

export const MODELS: Record<Job, ModelChoice> = {
  /**
   * Sonnet owns conversation, planning and tool orchestration in one context.
   * Grok 4.20 non-reasoning held this job until 2026-09-28; it was reliable at
   * tool syntax but could not do the planning and recovery the chat now owns.
   */
  chat: {
    id: 'anthropic/claude-sonnet-5',
    // Cross-lab fallback retained: Gemini's tool arguments were clean in the
    // shipped bake-off, so a provider outage still leaves a working tool caller.
    fallback: 'google/gemini-2.5-flash',
    maxOutputTokens: 8000,
  },

  /**
   * Tool calls that MUTATE the user's collection. Correctness-critical,
   * moderate volume — "log the 3 charizards I pulled, 2 are holo" has to get
   * quantities and targets right, and a wrong write is worse than a slow one.
   *
   * gpt-5-mini at low effort: 3/3 tool reliability, honours json_schema, and
   * cheap enough at this volume ($0.00018/call measured) that buying real
   * reasoning for a destructive operation is obviously correct.
   */
  write: {
    id: 'openai/gpt-5-mini',
    fallback: 'anthropic/claude-haiku-4.5',
    effort: 'low',
    maxOutputTokens: 1500,
  },

  /**
   * Vision during card scanning. Cost-critical: a scan session can fire many
   * calls, so a per-image tokenisation quirk compounds into real money.
   *
   * grok-4.1-fast-non-reasoning again — 1143 tokens for a 640x880 frame,
   * $0.000143/call, schema honoured on every frame tested. Reusing the chat
   * model is deliberate: one fewer model to operate and one prompt style to
   * maintain.
   *
   * NOT openai/gpt-4o-mini. It tokenises the SAME 640x880 image as 25,665
   * tokens — 11-30x every other model measured, including OpenAI's own
   * gpt-4.1-nano (1543) and gpt-5-nano (1003). Same "mini" price tier on the
   * sticker table, 27x the real cost, and invisible until you read `usage`.
   *
   * NOT meta/llama-4-scout at any price: it never once honoured
   * `response_format: json_schema` across 5 frames, despite advertising
   * tool-use, improvising a different JSON shape every time.
   *
   * KNOWN WEAKNESS, and the reason vision does not own identity here: 12 of 13
   * cheap vision models could not tell that a card was 40% occluded. The
   * perceptual-hash matcher answers "is a card fully revealed" for free and
   * better — a partly-revealed card simply fails to match under distance 9.
   */
  vision: {
    id: 'spacexai/grok-4.1-fast-non-reasoning',
    fallback: 'amazon/nova-lite',
    maxOutputTokens: 400,
  },

  /**
   * HISTORY — superseded by the Sonnet-by-default decision recorded below,
   * 2026-08-21. The Opus measurement here is no longer the default's rationale;
   * it survives as the reason `escalate` exists.
   *
   * Deck analysis and multi-step planning. Quality-critical, low volume — a few
   * calls a month per user, where being right is the entire value.
   *
   * claude-opus-4.8 at high effort: on a real decklist with a deliberately
   * buried consistency bug it found the severe one — 4x Charizard ex and 3x
   * Rare Candy but ZERO Charmander, making the deck's main attacker
   * structurally uncastable. $0.0356/call, 20.2 s. At this volume that is
   * nothing, and the cheaper fallback found a real but milder issue.
   */
  /**
   * Deck planning, strategy guides, synthesis — the work the tool layer cannot
   * do for us.
   *
   * WORTH SAYING PLAINLY, because porting 23 tools makes it easy to believe
   * otherwise: the MCP server is a data layer and a filing cabinet. There is no
   * intelligence in it. `deck_strategy`'s entire contract is "pass markdown to
   * REPLACE the whole guide" — it STORES a strategy guide, it does not write
   * one. Same for `save_deck`. The tools move the data; this line moves the
   * thinking, and shipping the first without the second produces a
   * well-informed version of the same disappointment: he reads 604 cards
   * correctly and then has a fast model write the deck plan.
   *
   * SONNET, NOT OPUS, as the default — changed 2026-08-21 on the owner's call.
   * The previous value here was `claude-opus-4.8`, chosen because it found a
   * deliberately buried consistency bug (4x Charizard ex + 3x Rare Candy and 0
   * Charmander) that a cheaper fallback missed. That measurement still stands
   * and is why `escalate` exists rather than the tier simply being cheapened.
   * What changed is the price context: with a sub-agent loop and a collection
   * in context, a realistic call is $0.50–$1, so Opus-by-default made one to
   * three questions a user's entire monthly budget.
   */
  analysis: {
    id: 'anthropic/claude-sonnet-5',
    fallback: 'openai/gpt-5.1-thinking',
    escalate: 'anthropic/claude-opus-5',
    effort: 'high',
    maxOutputTokens: 3000,
  },

  /**
   * "What is strong right now", "what are people saying about X" — the
   * questions no amount of catalog reading can answer, because the answer is
   * about a metagame rather than about data DeckPal holds.
   *
   * `openai/o3-deep-research`, and the choice is a DATA-PROCESSOR decision
   * rather than a quality one. Live research means sending query text to a
   * third party. `perplexity/sonar`, `sonar-pro`, `sonar-reasoning-pro` and
   * Exa are all present on the Gateway key and are all cheaper and faster —
   * and none of them is on the US-frontier-labs list above. Adding a vendor to
   * that list is the owner's call and it was made the other way: stay in-list.
   *
   * WHAT THIS COSTS US, stated rather than glossed. `@ai-sdk/gateway`'s
   * `gatewayTools.exaSearch` exposes `include_domains`, which is the real
   * injection control for live research — an allowlist of known TCG sources
   * plus a recency window, enforced rather than requested. `o3-deep-research`
   * searches provider-side, so that control is not available to us here.
   *
   * (For the record, `gatewayTools` is also not exported at runtime by the
   * pinned `@ai-sdk/gateway@4.0.52` — `'gatewayTools' in require(…)` is
   * `false` while the `.d.ts` declares it, so a typecheck would NOT have caught
   * a usage. That is a second reason not to have built on it today.)
   *
   * The compensating controls are structural, not prompted:
   *   - the research sub-agent holds NO TOOLS AT ALL, so nothing it reads can
   *     become an action;
   *   - its output is inserted as DATA, under a heading that says so, into a
   *     model already instructed never to act on instructions inside data;
   *   - queries carry card and archetype names and NEVER collection context.
   */
  /**
   * ── 2026-08-25: THIS MODEL DID NOT EXIST, AND NOTHING NOTICED ─────────────
   *
   * `id` was `openai/o3-deep-research`. It is **not on the Gateway key** —
   * measured directly: 351 models are available and that is not one of them,
   * and a call answers HTTP 404 `model_not_found`.
   *
   * So every `research_meta` call ever made failed, and the failure was
   * invisible: `runSubAgent` put the error into `text`, `finishOutcome` framed
   * it as "The following was fetched from the open web…", and the chip said
   * `ok`. Deck-E has been reading a fluent sentence that claims to be web
   * research and contains a 404, for the whole life of the feature — which is
   * why the owner reported research "seems to be missing" while other agents
   * reported it built. Both halves are fixed: `deep.ts` can no longer dress a
   * failure as an answer, and `modelCheck.ts` refuses to let a phantom id ship.
   *
   * ── WHY PERPLEXITY, AND WHAT THE OLD RULING ACTUALLY COST ────────────────
   *
   * The US-frontier-labs constraint at the top of this file rules Perplexity
   * out. Measured through both raw Gateway HTTP and the AI SDK, no in-list lab
   * can search on this key: `spacexai/grok-*` ignores `search_parameters` and
   * `providerOptions.xai.searchParameters` alike, `anthropic/claude-sonnet-5`
   * with a `web_search_20250305` tool is HTTP 400, and `gatewayTools` (Exa) is
   * still not exported at runtime by `@ai-sdk/gateway@4.0.52`. The constraint
   * did not make research expensive. It made research impossible.
   *
   * The owner relaxed it **for this call only**, on a distinction worth
   * recording: the ruling was written to protect *collection and camera data*,
   * and this call structurally carries neither — see `researchQuery.ts`, which
   * turns that from a promise into a control. DECISIONS.md 2026-08-25.
   *
   * ── sonar-pro, ON MEASUREMENT ────────────────────────────────────────────
   *
   *   sonar                3–5 s   20 sources   thin: one card on a list question
   *   sonar-pro            4–11 s  20 sources   real findings, real numbers
   *   sonar-reasoning-pro  47–48 s 15 sources   **0 visible characters**
   *
   * That last one is `RESERVE`'s failure mode again, from a fourth vendor: the
   * whole budget goes inside `<think>` and nothing comes out. Unusable at both
   * budgets tried (900 and 3,000 tokens).
   *
   * What sonar-pro actually returns, from the probe: Dragapult ex as the top
   * Standard deck with "439 decks, 9.54% share, 51.76% win rate across 77
   * tournaments", cited to limitlesstcg — and the disagreement alongside it, a
   * tier-list video still calling Gardevoir the best deck. Findings with
   * numbers and sources, which is exactly what the catalogue cannot hold.
   *
   * ── THE FALLBACK STAYS WITHIN PERPLEXITY, DELIBERATELY ───────────────────
   *
   * Every other row falls back to a DIFFERENT LAB, so one provider's outage
   * does not take the feature with it. That rule is precisely wrong here.
   * `gpt-5.1-thinking` — the old fallback — cannot search, so falling back to
   * it would answer a research question from training data, under the "fetched
   * from the open web" frame, in fluent prose, with no error anywhere. That is
   * strictly worse than the 404 this entry has just stopped telling.
   *
   * So research degrades within the only vendor that can search, and if that
   * vendor is down it FAILS LOUDLY. A research tool that cannot research has
   * to say so.
   */
  research: {
    id: 'perplexity/sonar-pro',
    fallback: 'perplexity/sonar',
    maxOutputTokens: 2500,
  },
}

/**
 * The judgment model: typed answers about a small state, never prose.
 *
 * Not a `Job` and not a `ModelChoice`, because it has none of their shape — no
 * output tokens to budget, no reasoning to provision, and no fallback lab,
 * since it is the only `evaluation` model on the Gateway. Its fallback is the
 * harness Deck-E had before it: every caller treats "no answer" as "do what
 * you did before" (`jev.ts`).
 *
 * UNPINNED because the Gateway lists only the moving `typesafe-ai/jev` id; the
 * thresholds in `reflex.ts` were chosen on the labelled set in
 * `decke/eval/` against the version it served on 2026-09-26, and should be
 * re-measured with `scripts/decke-jev-eval.mjs` when TypeSafe ships a new one.
 *
 * DATA: the reader's latest message and the few lines around it go to TypeSafe
 * AI through the Gateway, with `zeroDataRetention` requested per call. The
 * Gateway's model list reports `zdr: "none"` for this model while honouring the
 * per-request flag, and TypeSafe's own documentation offers ZDR to enterprise
 * customers only — so retention is unconfirmed, and SECURITY.md says so.
 */
export const EVALUATION = {
  id: 'typesafe-ai/jev',
  /** $ per million input tokens, from the Gateway's model list. Output is free. */
  inputPerMillionUsd: 0.042,
} as const

/**
 * Multiplier applied to `maxOutputTokens` when a model reasons.
 *
 * Learned the hard way twice: a deck-analysis call provisioned at exactly the
 * expected answer length returned ZERO visible content, having spent all 1200
 * tokens on reasoning. Re-run at 3000 it answered normally. Provision 2-3x the
 * visible answer you want, never 1x.
 */
export const RESERVE = 2.5

export function budgetFor(choice: ModelChoice): number {
  return choice.effort ? Math.round(choice.maxOutputTokens * RESERVE) : choice.maxOutputTokens
}
