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
 * amazon, meta, mistral). The owner's call, and it is the defensible answer for
 * a paid product streaming a user's camera and collection to a third party. The
 * Gateway offers cheaper non-US options; they are not eligible, and a future
 * cost squeeze must not quietly reach for them.
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
  /**
   * The better, dearer model, used ONLY when the person explicitly asks for it.
   *
   * The owner's standing decision, and it is a spend decision rather than a
   * quality one: `analysis` measured at $0.0356 a call against $0.000143 for
   * the chat tier — roughly 250x — and a realistic `plan_deck` (a large
   * collection context, plus research, plus thinking) runs $0.50–$1. At that
   * price one to three calls is an entire month's budget for a user, so the
   * best model cannot be the default and cannot be chosen by a model either.
   *
   * "Explicitly asks" means the PERSON asked, in words, for the best/deepest
   * work. It is not a flag the conversational model may set on a whim, because
   * a model that can spend 250x by picking a boolean will pick it.
   */
  readonly escalate?: string
}

export const MODELS: Record<Job, ModelChoice> = {
  /**
   * Ordinary conversation and the animation commands that ride along with it.
   * Latency-critical and by far the highest volume — this is the model the user
   * actually experiences as "how fast is he".
   *
   * HISTORY — superseded by the 4.1 → 4.20 switch recorded below, 2026-08-22.
   * The rationale that follows picked grok-4.1-fast-non-reasoning, which is no
   * longer the shipped id; it stays because the measurements are why the 4.20
   * comparison was run at all.
   *
   * grok-4.1-fast-non-reasoning: 593 ms median TTFT over 3 trials (fastest
   * measured), 3/3 on the exact animation-command tool schema, honours
   * json_schema, streams tool-call arguments incrementally, and is
   * non-reasoning BY DESIGN — so the reasoning-tax failure above cannot happen
   * here at all. It also showed heavy provider-side implicit caching, which
   * matters because our system prompt carries the whole 27-state vocabulary on
   * every turn.
   *
   * NOT openai/gpt-4.1-nano, despite a statistically tied TTFT (580 ms) and
   * being 4x cheaper: it failed tool-calling 0/3 on this exact schema,
   * mistaking the enum VALUE `nod_yes` for an op name. It is a fine classifier
   * and a broken driver. Same model, different job, opposite verdict.
   */
  /**
   * ONE KEYWORD KEPT THIS MODEL OUT OF THE BUILD FOR AN AFTERNOON, and the
   * scar is worth recording here because it is invisible from the model id.
   *
   * grok-4.1-fast accepts `minLength` only at the TOP level of a tool's
   * parameter object. Nested any deeper — a string inside an array inside an
   * array item, which is what `z.string().min(1)` produced in the `cards`
   * field — xAI rejects the entire request with an `error` part on an HTTP 200
   * and never calls the tool. `maxLength`, `pattern` and numeric bounds are
   * fine at any depth; only `minLength` does this. See `decke/tools.ts`.
   *
   * Scope, measured: `grok-4.1-fast-non-reasoning` and `-reasoning` both fail;
   * `grok-4.20-non-reasoning` passes. A grok-4.1-fast family defect, not an
   * xAI-wide one, so a future model bump likely retires this whole note.
   */
  chat: {
    /**
     * ── 4.1 → 4.20, 2026-08-22, FOR THE ONE DEFECT PROMPTING COULD NOT MOVE ──
     *
     * Asked "where do I change my completion goal?" with a real landmark and a
     * set route, `grok-4.1-fast-non-reasoning` called `flyTo` **0/5**. It wrote
     * the call out as bare prose instead — `flyTo [data-decke-goal-switcher]
     * with point: true` — 5/5. So the flight never happened, on every page with
     * a landmark, which is half of what makes him a character rather than a
     * text box.
     *
     * Five separate prompt rewrites moved it 0/5 each: making "movement is a
     * TOOL CALL, never text" explicit, quoting the failure back at him, moving
     * the section for recency, hardening `flyTo`'s description, and typing the
     * landmarks as an enum. The schema was not implicated either — he never
     * called `express` on those turns, and 4.20 produced 0/10 malformed
     * commands against the identical flat schema.
     *
     * Same prompt, same 34 tools, only the model changed: 4.20 calls it **5/5**,
     * clean, with zero narration in 32 turns.
     *
     * NOT A FREE SWITCH, and both costs are recorded because a table of
     * measurements is worth nothing if the inconvenient half is left out.
     *
     * **Restraint changed.** 4.1 was silent 6/6 on plain "hey"/"thanks"; 4.20
     * fires a small `express` 6/6 — a `curious` or `happy` nod alongside the
     * words. Measured as a regression against the prompt's governing rule
     * ("silence is a valid emission"), and accepted as a DIRECTION by the owner:
     * more expressive is the character being aimed at, and a nod on "hey" is a
     * different thing from an emotion fired at random. The rule stays in the
     * prompt because it still governs the states that MEAN something; if the
     * nods become noise, this is the entry that says where they came from.
     *
     * **It costs 7.49x, not the 6.25x on the pricing page.** Measured $/turn:
     * $0.01153 against $0.00154. The gap is caching — verified directly on an
     * identical 2k-token prompt, second call: 4.1 read 663 tokens from cache,
     * 4.20 read 128. Across the bake-off, 4.1 ran at 98.4% cache-hit and 365
     * no-cache input tokens per turn; 4.20 at 67.1% and 10,078. The heavy
     * provider-side caching that helped pick 4.1 largely does not apply here.
     *
     * Also slower: 1148 ms median TTFT against 811, and slower in all six
     * scenarios rather than on average. Still about a penny a turn in absolute
     * terms, and the meter caps the blast radius at 120 turns a day.
     *
     * Held, and worth saying because a switch can quietly cost them: lookup 5/5,
     * correction 5/5, navigation 5/5 with the canonical route. Schema validity
     * IMPROVED — 0/16 malformed against 4.1's 3/30, the same `cardArt` taking
     * `value` instead of `card` that this file already records.
     */
    id: 'spacexai/grok-4.20-non-reasoning',
    // NOT `claude-haiku-4.5`, which was the obvious pick and is measurably
    // wrong for THIS tool. In both trials it emitted `{"op":"nod_yes"}` —
    // `nod_yes` is a `value`, not an `op`, and it is not in the `op` enum. That
    // is systematic rather than a fluke, and `validateCommand` would drop the
    // first half of every reaction it sent. A fallback that silently degrades
    // is worse than a slower one that works.
    //
    // gemini-2.5-flash was one of only two models measured to produce CLEAN
    // arguments (the other, gemini-3-flash, is ~340 ms slower). It costs 1784 ms
    // TTFT against grok's 593, which is a real regression — but a fallback runs
    // when the primary is down, where correct-and-slower beats fast-and-wrong.
    // ── RE-BAKED 2026-08-21, AGAINST THE NEW JOB ────────────────────────────
    //
    // The choice above was made on 593 ms TTFT for a SIX-TOOL COSMETIC LOOP.
    // The job then changed: converse, LOOK THINGS UP, and know when to escalate.
    // A model chosen for how fast it can nod is not automatically the right one
    // for that, so it was re-run rather than assumed — 5 trials per scenario,
    // 150 calls, against the real prompt and a tool set including the data
    // tools:
    //
    //   model                     lookup  correction  nav   malformed  restraint  TTFT
    //   grok-4.1-fast-non-reas.   100%    100%        100%  2/19       100%       663 ms
    //   gemini-2.5-flash          100%    100%        100%  0/5         80%      1251 ms
    //   gpt-5-mini                  0%    100%         40%  6/6         10%       618 ms
    //   claude-haiku-4.5          100%    100%         40%  never fired 20%       999 ms
    //   gpt-4.1-mini              100%    100%          0%  never fired 70%       505 ms
    //
    // The incumbent kept the job: the only model clean on all five, and also the
    // fastest. Nothing was changed on vibes and nothing was left unmeasured.
    //
    // THE FINDING THAT MATTERS MOST is not in the table. Lookup rate went from
    // NEVER — a 20-sample probe of the shipped system saw not one attempt — to
    // 100%. The model was never the problem. There was nothing to look with.
    //
    // Two failures worth keeping, because both look like model quality and are
    // not: `gpt-5-mini` answered "which one should I look up?" and then never
    // looked, and stuffed every optional field onto every `express` command
    // (6/6 malformed) — the pattern `tools.ts` already records for it.
    // `gpt-4.1-mini` treated "take me to my decks" as an in-page gesture,
    // calling `flyTo` 5/5 times and never `goTo`; it never leaves the page.
    fallback: 'google/gemini-2.5-flash',
    maxOutputTokens: 1200,
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
