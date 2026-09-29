# Deck-E chat overhaul — cross-lane contracts

Every lane codes to these shapes exactly. Changing one is an orchestrator
decision, not a lane decision.

## C1 — Tool chip event (`data-decke-tool`, server → browser)

Existing fields: `{ id, name, title, phase, summary?, note?, step?, args? }`
(`phase`: `start | progress | ok | partial | error | declined`).

Added, both optional:

- `label?: string` — a human status line for THIS call, present tense, ≤ 70
  chars ("Searching: Dragapult ex tournament results"). The server sets it for
  `web_research` (from `purpose`); the browser derives one for every other tool.
- `sources?: Array<{ url: string; title: string; host: string }>` — on
  `web_research`'s `progress`/`ok`/`partial` events: the pages read so far
  (full https URLs, for display only). At most 12, deduped by URL.

## C2 — Web research tool

- Name `web_research` (was `research_meta`; the old name stays recognised in
  UI maps and history rendering only).
- Input `{ query: string, topic: 'competitive' | 'general', purpose: string }`
  — `purpose` is ≤ 60 chars, what the reader sees ("Dragapult ex tournament
  results").
- **No approval card.** Still charged as the `analysis` credit operation.
- The chip `summary` is the first sentence of the FINDINGS (never the
  untrusted-content frame).
- The model still receives source HOSTS only (numbered list) — full URLs go to
  the browser via C1 `sources`, never into the model's context.

## C3 — Removed from Deck-E

`plan_deck`, `analyze_collection`, `write_strategy_guide` are no longer offered
to the Deck-E chat model. Planning/analysis/guide-writing is the main agent's
own work with its own tools. (Saving a guide is still `deck_strategy` with
`markdown`, a write that asks for approval.)

## C4 — `check_deck` (shared agent tool, `packages/agent-tools`)

Read-only. Input (exactly one of `cards` / `ptcgl_text`):

```ts
{ format?: string /* default 'standard' */,
  cards?: Array<{ name?: string; card_id?: string; quantity: number /* 1..60 */ }>,
  ptcgl_text?: string }
```

Exported structured function, used by Deck-E's `showDeck`:

```ts
export interface DeckCheckLine {
  card_id: string | null      // null when the name could not be resolved
  name: string
  supertype: 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown'
  quantity: number
  owned: number               // copies of THIS card the user owns (any printing counted only if the tool's existing owned-count logic does so; say which in a comment)
  unit_price_usd: number | null
  resolved: boolean
  note?: string               // e.g. "resolved 'Rare Candy' to sv01-191 (you own this printing)"
}
export interface DeckCheckResult {
  format: string
  total: number
  legal: boolean | null       // null when it could not be judged
  issues: string[]            // human sentences, most important first
  evolution_gaps: string[]    // e.g. "Delphox (Stage 2) has no Braixen and no Rare Candy"
  lines: DeckCheckLine[]
  owned: number               // Σ min(owned, quantity)
  missing_cost_usd: number | null
  ptcgl: string               // PTCGL-format export of the resolved list
}
export function checkDeck(ctx: ToolContext, input: CheckDeckInput): Promise<DeckCheckResult>
```

The tool's text output renders this for the model: a header line
(`Checked 60 cards (standard): LEGAL` / `NOT LEGAL — 3 issues`), the lines
grouped by supertype with `card_id` and owned counts, issues, evolution gaps,
and the missing summary.

## C5 — `showDeck` (Deck-E server tool, `apps/api/src/decke/tools.ts`)

Input: `{ name: string; format?: string; cards: Array<{ card_id: string; quantity: number }>; note?: string }`.

`buildTools(writer, grounding, repairs, emit, opts?)` gains
`opts.checkDeck?: (input: { format?: string; cards: { card_id: string; quantity: number }[] }) => Promise<DeckCheckResult>`.

`showDeck` calls `opts.checkDeck` (when present) and writes the usual
`data-decke-screen` part with `{ title: name, blocks: [DeckBlock] }`:

```ts
interface DeckBlock {
  kind: 'deck'
  name: string
  format: string
  total: number
  legal: boolean | null
  issues: string[]            // ≤ 6
  owned: number
  missingCostUsd: number | null
  sections: Array<{
    title: 'Pokémon' | 'Trainer' | 'Energy' | 'Other'
    count: number
    cards: Array<{ id: string; name: string; quantity: number; owned: number }>
  }>
  ptcgl: string
}
```

Without `checkDeck`, the block is built from the input alone (`legal: null`,
`owned: 0`, names = ids). Chip: name `showDeck`, title `Show a deck`, summary
`Showed "<name>" · <total> cards`. Returned to the model: one line with total,
legality, owned/total, missing cost, and "The deck is on screen with a Save
button. Do not list its cards again in words."

## C6 — What the browser replays (the wire)

- For the **6 most recent assistant messages** before the new user message,
  every finished tool call replays as a real AI-SDK tool part:
  `{ type: 'tool-<name>', toolCallId, input: args ?? {}, state: 'output-available', output: string }`
  — `output` is the tool's own output text as received in
  `tool-output-available` (JSON-stringified if not a string), trimmed to
  **12,000 chars** with a trailing `\n[… trimmed for length …]`.
- A **declined** call replays as
  `{ type: 'tool-<name>', toolCallId, input, state: 'output-denied', approval: { id, approved: false, reason } }`.
- Failures replay as today's `output-error` parts. `express` is never replayed.
- Older assistant messages keep today's one-line lookup record.
- A deck the reader saved from the widget adds a text part to the next wire:
  `[the reader saved the deck "<name>" from the deck widget — <N> cards, deck id <id>]`.
- Window numbers, mirrored server (`wireBounds.ts`) ↔ browser (`wireWindow.ts`):
  `WINDOW_MESSAGES = 40`, `WINDOW_PRIOR_CHARS = 160_000`,
  `PART_MAX_CHARS = 60_000` (unchanged). The request body hard cap rises to fit
  a full window plus the current turn.

## C7 — Browser `ToolChip`

Gains `label?: string`, `sources?: C1 source[]`, `output?: string` (captured
from `tool-output-available`, capped at 12,000 chars).

## C8 — Tool kinds (browser, for icons, labels and animation)

`toolKinds.ts` exports `kindOf(name: string): ToolKind` with
`ToolKind = 'research' | 'catalog' | 'collection' | 'decks' | 'check' | 'lists' | 'logs' | 'prices' | 'write' | 'show' | 'move' | 'other'`
and `labelFor(chip): string` (present tense while running, past tense when
done), and `iconFor(kind)` naming an `Icon` glyph.
