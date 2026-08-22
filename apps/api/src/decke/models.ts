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
export type Job = 'chat' | 'write' | 'vision' | 'analysis'

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
}

export const MODELS: Record<Job, ModelChoice> = {
  /**
   * Ordinary conversation and the animation commands that ride along with it.
   * Latency-critical and by far the highest volume — this is the model the user
   * actually experiences as "how fast is he".
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
    id: 'spacexai/grok-4.1-fast-non-reasoning',
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
   * Deck analysis and multi-step planning. Quality-critical, low volume — a few
   * calls a month per user, where being right is the entire value.
   *
   * claude-opus-4.8 at high effort: on a real decklist with a deliberately
   * buried consistency bug it found the severe one — 4x Charizard ex and 3x
   * Rare Candy but ZERO Charmander, making the deck's main attacker
   * structurally uncastable. $0.0356/call, 20.2 s. At this volume that is
   * nothing, and the cheaper fallback found a real but milder issue.
   */
  analysis: {
    id: 'anthropic/claude-opus-4.8',
    fallback: 'openai/gpt-5.1-thinking',
    effort: 'high',
    maxOutputTokens: 3000,
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
