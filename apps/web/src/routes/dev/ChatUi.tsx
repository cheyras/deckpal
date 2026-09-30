/**
 * Every chat surface Deck-E has, on one page, without talking to him.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The Deck-E pass shipped a lot of chat UI and almost none of it was ever LOOKED
 * AT. Verification was unit tests and code review; the visual harness could not
 * run for most of the work, and when it could, it photographed composition —
 * "is the sidebar sharp, is he beside the composer" — and never craft. The owner
 * used the result and called it *"phoned in… laughably bad"*, which was fair.
 *
 * The reason it was hard to see is that these surfaces only appear mid-turn: a
 * failure row needs a tool to fail, an approval card needs a real write to be
 * held, a partial needs a deep call to time out. Reviewing them meant driving a
 * conversation into each state one at a time, and nobody does that.
 *
 * So they are all here, at once, with fixtures that are honest about being
 * fixtures. A designer can open this at 1440 and at 390 and see the whole
 * surface area in one scroll.
 *
 * ── THE STANDARD THIS PAGE IS REVIEWED AGAINST ───────────────────────────────
 *
 * **Form and structure from beautiful-ui.dev** (`research/R6-beautiful-ui.md`
 * has per-component specs — the composer's anatomy, its 14px card, its states).
 * **Tone and feel from this app's own design system** — the tokens in
 * `theme.css` and `premium.css`, the same surfaces and radii the rest of DeckPal
 * uses. Neither alone: beautiful-ui's palette is not ours, and our existing
 * components were not designed for a conversation.
 *
 * ── RULES FOR EDITING THIS FILE ──────────────────────────────────────────────
 *
 * 1. **Import the real components.** Nothing here may reimplement a chat
 *    surface for display. If a state cannot be reached with real props, that is
 *    a finding about the component, not a reason to fake it here.
 * 2. **Fixtures are labelled and obviously fake.** No invented collection
 *    numbers that could be mistaken for the reader's own — X2 applies to a demo
 *    page too, because a screenshot of it will end up in a review.
 * 3. **Every state that exists in the product appears here.** A state that is
 *    missing from this page is a state nobody will look at again.
 *
 * 4. **This route is chromeless, and that is load-bearing now.** The empty-state
 *    specimens render real `DeckeComposer`s, and every composer carries
 *    `COMPOSER_LANDMARK` — the attribute `DeckeHost` queries to decide how tall
 *    Deck-E is. `landingRoute.ts` already lists `/dev/chat-ui` as chromeless so
 *    the host never mounts here and there is nothing to confuse; if it ever
 *    comes off that list, he will size himself against whichever specimen the
 *    document happens to reach first.
 */
import { useEffect, useRef, useState } from 'react'
import { ChatMarkdown } from '../../character/host/chat/ChatMarkdown'
import { ActivityLine, type ActivityStep } from '../../character/host/chat/ActivityLine'
import { SourcesList } from '../../character/host/chat/SourcesList'
import type { Source } from '../../character/host/chat/sourcesState'
import { ApprovalCard } from '../../character/host/chat/ApprovalCard'
import type {
  ApprovalPreview,
  Choices,
  PreviewRow,
  RowChoice,
} from '../../character/host/chat/approvalCardState'
import { DeckeScreen } from '../../character/host/DeckeScreen'
import {
  DeckeComposer,
  DeckeEmptyIntro,
  DeckeOpeners,
} from '../../character/host/DeckeChat'
import { chooseOpeners } from '../../character/host/deckeChatState'
import { composeGreeting, FAREWELLS, pickFarewell } from '../../character/host/deckeVoice'
import { DeckeFarewell } from '../../character/host/DeckeFarewell'
import { CreditChip, DeckeNotice } from '../../character/host/chat/DeckeNotice'
import {
  creditHeaderLabel,
  creditState,
  outOfCreditsDetail,
  outOfCreditsLine,
  TOP_UP_LABEL,
} from '../../character/host/chat/creditState'
import type { ScreenSpec } from '../../character/host/DeckeScreen'
import { HistoryMenu, HistorySheet, type HistoryLoad } from '../../character/host/chat/HistoryMenu'
import {
  TranscriptBody,
  TranscriptExit,
  TranscriptHead,
  type TranscriptLoad,
} from '../../character/host/chat/TranscriptView'
import type { DeckeConversation, DeckeConversationSummary } from '../../lib/api'

/* ── Fixtures ──────────────────────────────────────────────────────────────
 *
 * Real catalogue ids, so `cardGrid` fetches real art and the thumbnails on this
 * page are the thumbnails the product draws. Quantities are invented and the
 * page says so where a number could be mistaken for the reader's own.
 */
/*
 * REAL IDS AND THEIR REAL NAMES, which stopped being optional the moment the
 * approval card started drawing art. The first fixture set paired `me05-013`
 * with the name "Heat Rotom ex"; `me05-013` is a Goldeen, and `sv01-25` is
 * not a card at all. With no thumbnail those were harmless placeholders; with
 * one, the page appears to resolve the wrong card and a reviewer files the art
 * lookup as broken.
 *
 * Every id below was checked against the live catalogue and every name is the
 * name that comes back for it. Quantities and before/after counts are still
 * invented, and the page says so wherever one appears.
 */
const CARD_IDS = ['me05-013', 'swsh4-44', 'swsh4-25', 'me05-001', 'swsh4-1', 'me05-020']

/** One id that deliberately does NOT resolve, so the panel's honest fallback for
 *  a card the catalogue does not have appears on this page too. */
const MISSING_ID = 'me05-99999'

const ACTIVITY_STARTED = Date.now() - 12_000

const RESEARCH_SOURCES: Source[] = [
  { url: 'https://limitlesstcg.com/tournaments', title: 'Fixture: tournament results', host: 'limitlesstcg.com' },
  { url: 'https://www.pokemon.com/us/pokemon-tcg', title: 'Fixture: Pokémon TCG news', host: 'pokemon.com' },
  { url: 'https://bulbapedia.bulbagarden.net/wiki/Dragapult_(TCG)', title: 'Fixture: Dragapult card history', host: 'bulbapedia.bulbagarden.net' },
  { url: 'https://www.reddit.com/r/pkmntcg/', title: 'Fixture: player discussion', host: 'reddit.com' },
  { url: 'https://pkmncards.com/', title: 'Fixture: card database', host: 'pkmncards.com' },
  { url: 'https://www.justinbasil.com/', title: 'Fixture: deck-building guide', host: 'justinbasil.com' },
]

const ACTIVITY_STEPS: Record<string, ActivityStep[]> = {
  collection: [{ id: 'collection', name: 'collection_summary', phase: 'progress' }],
  research: [{
    id: 'research',
    name: 'web_research',
    phase: 'progress',
    label: 'Searching: Dragapult ex tournament results',
    sources: RESEARCH_SOURCES.slice(0, 5),
  }],
  finished: [
    { id: 'collection', name: 'collection_summary', phase: 'ok' },
    { id: 'catalog', name: 'search_cards', phase: 'ok' },
    { id: 'prices', name: 'card_price_history', phase: 'ok' },
    { id: 'check', name: 'check_deck', phase: 'ok' },
  ],
  failed: [
    { id: 'collection', name: 'collection_summary', phase: 'ok' },
    { id: 'research', name: 'web_research', phase: 'error', label: 'Searching: Dragapult ex tournament results', summary: 'The search service did not answer.' },
  ],
  declined: [{ id: 'save', name: 'save_deck', phase: 'declined' }],
  expanded: [
    { id: 'collection', name: 'collection_summary', phase: 'ok' },
    { id: 'catalog', name: 'search_cards', phase: 'ok' },
    { id: 'research', name: 'web_research', phase: 'ok', label: 'Searching: Dragapult ex tournament results', sources: RESEARCH_SOURCES.slice(0, 5) },
    { id: 'prices', name: 'card_price_history', phase: 'ok' },
    { id: 'deck', name: 'check_deck', phase: 'ok' },
  ],
}

const MARKDOWN = `Here's what I found in **Pitch Black**.

You're missing three of the chase cards, and one of them is the reason the set
is expensive right now:

- **Heat Rotom ex** — the \`me05-013\` print, about $42
- **Gardevoir ex** — reverse holo only
- **Charizard ex** — the alt art

| Card | Owned | Needed |
| --- | --- | --- |
| Heat Rotom ex | 0 | 1 |
| Gardevoir ex | 1 | 2 |

A quick note on pricing: \`tcgcsv\` updates nightly, so a card that spiked today
still shows yesterday's number.

> Sealed product for this set is drying up at retail, which is annoying and not
> your fault.`

const SCREEN: ScreenSpec = {
  title: 'Your five most valuable cards',
  blocks: [
    { kind: 'text', text: 'Fixture data — these quantities are invented for this page.' },
    { kind: 'cardGrid', cards: CARD_IDS.slice(0, 5), quantities: [1, 2, 1, 3, 1] },
    { kind: 'statTile', text: 'Estimated total', value: '$412.90', tone: 'good' },
    { kind: 'progress', text: 'Pitch Black completion', percent: 12 },
  ],
}

const SCREEN_LONG: ScreenSpec = {
  title: 'Everything you own from Pitch Black',
  blocks: [
    { kind: 'heading', text: 'Chase cards' },
    { kind: 'cardGrid', cards: CARD_IDS, quantities: [1, 1, 2, 1, 4, 1] },
    { kind: 'heading', text: 'Trainers' },
    // The last slot is an id the catalogue has no card for — the state the
    // panel draws as the bare id rather than dropping the slot, which would
    // shift every later card into the wrong place.
    {
      kind: 'cardGrid',
      cards: [...CARD_IDS.slice(0, 5), MISSING_ID],
      quantities: [2, 1, 1, 1, 1, 3],
    },
    { kind: 'heading', text: 'Energy' },
    { kind: 'cardGrid', cards: CARD_IDS.slice(0, 3), quantities: [9, 4, 2] },
    { kind: 'statTile', text: 'Set total', value: '26 of 214', tone: 'neutral' },
  ],
}

const DECK_SCREENS: readonly [ScreenSpec, ScreenSpec, ScreenSpec] = [
  {
    title: 'Fixture: mostly-owned 60-card deck',
    blocks: [{
      kind: 'deck',
      name: 'Fixture: Charizard ex',
      format: 'standard',
      total: 60,
      legal: true,
      owned: 41,
      missingCostUsd: 12.4,
      ptcgl: 'Pokémon: 15\nTrainer: 30\nEnergy: 15',
      sections: [
        { title: 'Pokémon', count: 15, cards: [
          { id: 'sv03-125', name: 'Charizard ex', quantity: 3, owned: 3 },
          { id: 'sv01-040', name: 'Pikachu', quantity: 2, owned: 2 },
          { id: 'sv01-150', name: 'Pokémon fixture', quantity: 2, owned: 2 },
          { id: 'sv01-170', name: 'Pokémon fixture', quantity: 2, owned: 1 },
          { id: 'sv03-009', name: 'Pokémon fixture', quantity: 1, owned: 1 },
          { id: 'sv04-055', name: 'Dondozo', quantity: 1, owned: 1 },
          { id: 'sv06-003', name: 'Pokémon fixture', quantity: 2, owned: 2 },
          { id: 'sv10-004', name: 'Pokémon fixture', quantity: 2, owned: 1 },
        ] },
        { title: 'Trainer', count: 30, cards: [
          { id: 'sv01-191', name: 'Rare Candy', quantity: 4, owned: 4 },
          { id: 'sv01-196', name: 'Ultra Ball', quantity: 4, owned: 4 },
          { id: 'sv02-185', name: 'Iono', quantity: 4, owned: 3 },
          { id: 'sv10-010', name: 'Trainer fixture', quantity: 4, owned: 3 },
          { id: 'sv10-043', name: 'Trainer fixture', quantity: 4, owned: 3 },
          { id: 'sv10-047', name: 'Trainer fixture', quantity: 4, owned: 3 },
          { id: 'sv10-050', name: 'Trainer fixture', quantity: 3, owned: 2 },
          { id: 'sv10-057', name: 'Trainer fixture', quantity: 3, owned: 1 },
        ] },
        { title: 'Energy', count: 15, cards: [
          { id: 'sv01-190', name: 'Basic Fire Energy', quantity: 8, owned: 8 },
          { id: 'sv10-070', name: 'Basic Energy fixture', quantity: 7, owned: 0 },
        ] },
      ],
    }],
  },
  {
    title: 'Fixture: list with problems',
    blocks: [{
      kind: 'deck',
      name: 'Fixture: incomplete evolution line',
      format: 'standard',
      total: 65,
      legal: false,
      owned: 21,
      missingCostUsd: 29.75,
      issues: [
        'This list has 65 cards; Standard decks need exactly 60.',
        'Rare Candy appears 5 times; the normal copy limit is 4.',
        'Charizard ex has no Charmeleon or Rare Candy path in this list.',
        'One card is not legal in Standard.',
      ],
      ptcgl: 'Pokémon: 20\nTrainer: 30\nEnergy: 15',
      sections: [
        { title: 'Pokémon', count: 20, cards: [
          { id: 'sv03-125', name: 'Charizard ex', quantity: 4, owned: 2 },
          { id: 'sv01-040', name: 'Pikachu', quantity: 4, owned: 4 },
          { id: 'sv04-055', name: 'Dondozo', quantity: 4, owned: 2 },
        ] },
        { title: 'Trainer', count: 30, cards: [
          { id: 'sv01-191', name: 'Rare Candy', quantity: 5, owned: 4 },
          { id: 'sv01-196', name: 'Ultra Ball', quantity: 4, owned: 3 },
        ] },
        { title: 'Energy', count: 15, cards: [{ id: 'sv01-190', name: 'Basic Fire Energy', quantity: 15, owned: 6 }] },
      ],
    }],
  },
  {
    title: 'Fixture: unchecked deck',
    blocks: [{
      kind: 'deck',
      name: 'Fixture: first draft',
      format: 'expanded',
      total: 12,
      legal: null,
      owned: 0,
      missingCostUsd: null,
      ptcgl: 'Pokémon: 12',
      sections: [{ title: 'Pokémon', count: 12, cards: [
        { id: 'swsh1-1', name: 'Celebi V', quantity: 4, owned: 0 },
        { id: 'swsh4-44', name: 'Pikachu VMAX', quantity: 4, owned: 0 },
        { id: 'swsh4-25', name: 'Charizard', quantity: 4, owned: 0 },
      ] }],
    }],
  },
]

/*
 * THE THREE PRINTINGS STATES, AS THE WIRE NOW PRODUCES THEM.
 *
 * `resolve.ts` carries `candidates` on every resolvable kind since 2026-08-23,
 * and `reopenIfProxyStated` in the API adapter demotes a `stated` row back to
 * `unstated` whenever the READER's own sentence named no printing. So the states
 * a reviewer has to be able to tell apart are:
 *
 *   stated    — they typed "reverse holo". Settled. One chip.
 *   only-one  — the card has exactly one printing. Settled, and the lone chip is
 *               the reason he was sure.
 *   unstated  — Deck-E picked one. A picker, with his pick marked as a PROPOSAL
 *               and the row excluded until it is confirmed.
 *   ambiguous — nobody picked, including him. A picker with nothing proposed.
 *
 * All four appear below, with real candidate lists, because a fixture that still
 * carries `candidates: []` on a confident row would be a picture of the product
 * as it was two commits ago.
 */
const PRINTINGS = [
  { variantId: 11, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 },
  { variantId: 12, kindCode: 'reverse', label: 'Reverse holo', isPrimary: false, ownedQty: 1 },
  { variantId: 13, kindCode: 'holo', label: 'Holo', isPrimary: false, ownedQty: 0 },
]

function previewRow(over: Partial<PreviewRow> & Pick<PreviewRow, 'index' | 'cardId' | 'cardName'>): PreviewRow {
  return {
    setId: 'me05',
    number: '013',
    certainty: 'stated',
    candidates: PRINTINGS,
    wouldUseVariantId: 11,
    variantId: 11,
    variantLabel: 'Normal',
    mode: 'delta',
    value: 1,
    before: 0,
    after: 1,
    clamped: false,
    ...over,
  }
}

const PREVIEW: ApprovalPreview = {
  toolCallId: 'demo',
  tool: 'log_cards',
  title: 'Add 3 cards to your collection',
  summary: 'Would add 3 cards',
  ok: true,
  editable: true,
  rows: [
    // SETTLED BECAUSE THEY SAID SO.
    previewRow({ index: 0, cardId: 'me05-013', cardName: 'Goldeen' }),
    // SETTLED BECAUSE THERE IS ONLY ONE.
    previewRow({
      index: 1,
      cardId: 'swsh4-44',
      cardName: 'Pikachu VMAX',
      setId: 'swsh4',
      number: '44',
      certainty: 'only-one',
      candidates: [PRINTINGS[1]],
      variantId: 12,
      variantLabel: 'Reverse holo',
      before: 1,
      after: 2,
    }),
    // PROPOSED, AWAITING CONFIRMATION — the commonest row in the product now.
    previewRow({
      index: 2,
      cardId: 'swsh4-25',
      cardName: 'Charizard',
      setId: 'swsh4',
      number: '25',
      certainty: 'unstated',
      variantId: null,
      variantLabel: null,
      wouldUseVariantId: 12,
    }),
  ],
  skipped: [],
}

/** Nobody picked, including him: a picker with nothing proposed. */
const PREVIEW_AMBIGUOUS: ApprovalPreview = {
  ...PREVIEW,
  title: 'Add 1 card to your collection',
  summary: 'Would add 1 card',
  rows: [
    previewRow({
      index: 0,
      cardId: 'swsh4-25',
      cardName: 'Charizard',
      setId: 'swsh4',
      number: '25',
      certainty: 'ambiguous',
      variantId: null,
      variantLabel: null,
      wouldUseVariantId: null,
    }),
  ],
}

/** A batch that TAKES CARDS AWAY. The operation chip is tinted by direction and
 *  the accept button changes its verb, and neither was visible on this page. */
const PREVIEW_REMOVE: ApprovalPreview = {
  ...PREVIEW,
  title: 'Remove 2 cards from your collection',
  summary: 'Would remove 2 cards',
  rows: [
    previewRow({
      index: 0,
      cardId: 'me05-020',
      cardName: 'Primarina',
      setId: 'me05',
      number: '020',
      value: -1,
      before: 3,
      after: 2,
    }),
    previewRow({
      index: 1,
      cardId: 'swsh4-1',
      cardName: 'Weedle',
      setId: 'swsh4',
      number: '1',
      value: -2,
      before: 4,
      after: 2,
    }),
  ],
}

const PREVIEW_ONE: ApprovalPreview = {
  ...PREVIEW,
  title: 'Add 1 card to your collection',
  summary: 'Would add 1 card',
  rows: [PREVIEW.rows[0]],
}

function cardChangeFixture(tool: 'edit_list' | 'save_deck', title: string, header: string, count: number): ApprovalPreview {
  const lines = Array.from({ length: count }, (_, i) => `add x1 ${CARD_IDS[i % CARD_IDS.length]}`)
  return { toolCallId: `demo-${tool}-${count}`, tool, title, summary: [header, ...lines].join('\n'), ok: true, editable: false, rows: [], skipped: [] }
}

const LIST_CREATE_PREVIEW = cardChangeFixture('edit_list', 'create a list called “Coin flips”', "CREATE a new static list called 'Coin flips'", 16)
const DECK_CREATE_PREVIEW = cardChangeFixture('save_deck', 'save “Hide & Seek” as a new deck', "CREATE a new deck called 'Hide & Seek' (standard)", 60)
const DECK_EDIT_PREVIEW: ApprovalPreview = {
  toolCallId: 'demo-deck-edit', tool: 'save_deck', title: 'change your deck “Hide & Seek”', ok: true, editable: false, rows: [], skipped: [],
  summary: ["EDIT your existing deck 'Hide & Seek' (deck-demo), 18 distinct card(s) in it:", `add x2 ${CARD_IDS[0]}`, `set ${CARD_IDS[1]} x2 → x4`, `remove x3 ${CARD_IDS[2]}`].join('\n'),
}
const STRATEGY_PREVIEW: ApprovalPreview = {
  toolCallId: 'demo-strategy', tool: 'deck_strategy', title: 'save a strategy guide for “Hide & Seek”', ok: true, editable: false, rows: [], skipped: [],
  summary: '# Opening plan\n\nLead with Dragapult and use the bench to set up your next attacker.\n\n## Matchups\n\nProtect the support Pokémon against spread damage and save recovery for the late game.',
}

/* ── Page furniture ────────────────────────────────────────────────────────── */

/* THE REAL OPENERS AND THE REAL GREETING, from the product's own pools, run
 * with the product's own rotation — not copies of the strings, which would drift
 * the day somebody edits a pool and leave this page showing lines nobody is
 * offered.
 *
 * ── A PINNED SEED IS WHAT MAKES THIS PAGE PHOTOGRAPHABLE ────────────────────
 *
 * The second pass made all three pools vary per opening, which is the point of
 * them and is fatal to a gallery: every capture would differ from the last and a
 * screenshot diff would be the dice rather than the design. `chooseOpeners` and
 * `composeGreeting` both take a seed for exactly this, so the page pins one and
 * a change here means somebody changed the product.
 */
const GALLERY_SEED = 20260823
const OPENERS = chooseOpeners(undefined, {}, { seed: GALLERY_SEED })

/*
 * AND THE GREETING, PINNED THE SAME WAY — INCLUDING THE CLOCK.
 *
 * `composeGreeting` is a function of the hour, so a gallery that let it read the
 * system clock would photograph a different sentence in the morning than in the
 * evening and every screenshot diff would be a diff. The three below are three
 * REAL states of the same component: the ordinary case, the late-night case the
 * owner asked for by name, and the case where `/me` has not answered so there is
 * no name to use.
 *
 * FIXTURE NAME. "Ash" is obviously not the reader's, which matters on a page
 * whose whole rule is that a screenshot of it will end up in a review.
 */
const FIXTURE_NAME = 'Ash'
const AFTERNOON = new Date(2026, 7, 23, 14, 20, 0)
const LATE = new Date(2026, 7, 23, 1, 15, 0)

const GREET_DAY = composeGreeting({ name: FIXTURE_NAME, now: AFTERNOON, seed: GALLERY_SEED })
const GREET_LATE = composeGreeting({ name: FIXTURE_NAME, now: LATE, seed: GALLERY_SEED })
const GREET_ANON = composeGreeting({ now: AFTERNOON, seed: GALLERY_SEED + 1 })

/* ── THE CHAT HISTORY ───────────────────────────────────────────────────────
 *
 * PINNED CLOCK, PINNED DATES. Every row in this section is a function of "now" —
 * the day heading, the time, the "Yesterday" — so a gallery reading the system
 * clock would photograph a different list every morning and every screenshot
 * diff would be the calendar rather than the design. `HISTORY_NOW` is the same
 * afternoon the greeting fixtures use.
 *
 * The four conversations are chosen to cover the four things a build stamp can
 * be, because that column is the feature and it is the part a screenshot has to
 * be able to answer for:
 *
 *   `#78`      one build
 *   `#77→78`   SPANNED A DEPLOY — the row worth opening in a regression hunt
 *   `—`        no build recorded: a preview or a local run. Never `#0`.
 *   `#61`      old enough to fall into another day group
 */
const HISTORY_NOW = new Date(2026, 7, 23, 14, 20, 0)
const hAt = (d: number, h: number, m = 0) => new Date(2026, 7, d, h, m, 0).toISOString()

const CONVERSATIONS: DeckeConversationSummary[] = [
  {
    id: 'h1',
    title: 'how many pitch black cards am I missing?',
    turns: 4,
    startedAt: hAt(23, 13, 40),
    updatedAt: hAt(23, 14, 2),
    buildPrMin: 77,
    buildPrMax: 78,
    buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c',
  },
  {
    id: 'h2',
    title: 'build me a Gardevoir deck for standard',
    turns: 2,
    startedAt: hAt(23, 9, 12),
    updatedAt: hAt(23, 9, 30),
    buildPrMin: 78,
    buildPrMax: 78,
    buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c',
  },
  {
    id: 'h3',
    // The honest null case. It ran on a preview deployment, so there is no
    // squash-merge subject to parse a PR out of, and the row says so with a
    // dash rather than inventing a number.
    title: 'take me to the shrouded fable set',
    turns: 1,
    startedAt: hAt(22, 21, 5),
    updatedAt: hAt(22, 21, 6),
    buildPrMin: null,
    buildPrMax: null,
    buildSha: null,
  },
  {
    id: 'h4',
    title: 'what did I spend on singles last month?',
    turns: 6,
    startedAt: hAt(11, 16, 0),
    updatedAt: hAt(11, 16, 40),
    buildPrMin: 61,
    buildPrMax: 61,
    buildSha: 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00',
  },
]

/**
 * One record, and it is built to be the interesting one: a deploy landed
 * between turn 2 and turn 3.
 *
 * Every tool row here is a phase the product can genuinely produce, including
 * the two that only exist in a record — a call that never finished, and a phase
 * this app does not recognise.
 */
const RECORD: DeckeConversation = {
  id: 'h1',
  title: 'how many pitch black cards am I missing?',
  startedAt: hAt(23, 13, 40),
  turns: [
    {
      seq: 0,
      asked: 'how many pitch black cards am I missing?',
      answered:
        "You're at **12 of 214** in Pitch Black, so 202 to go.\n\nThe three that move the needle most are the chase cards — one of them is why the set is expensive right now.",
      tools: [
        { name: 'set_progress', phase: 'ok', title: 'Checked set completion', summary: 'Pitch Black — 12 of 214' },
      ],
      buildPr: 77,
      buildSha: 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00',
      at: hAt(23, 13, 40),
    },
    {
      seq: 1,
      asked: 'which ones are worth the most?',
      answered: 'The alt-art Charizard ex leads it, then Gardevoir ex, then Heat Rotom ex.',
      tools: [
        { name: 'search_cards', phase: 'ok', title: 'Searched the catalogue', summary: 'Found 214 cards in Pitch Black' },
        { name: 'collection_value', phase: 'partial', title: 'Priced your collection', summary: 'Timed out after 180 of 604 cards' },
      ],
      buildPr: 77,
      buildSha: 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00',
      at: hAt(23, 13, 52),
    },
    {
      seq: 2,
      asked: 'add the Heat Rotom to my collection',
      answered: 'Left it — nothing was written.',
      tools: [
        { name: 'log_cards', phase: 'declined', title: 'Nothing was written', summary: 'You left it, so nothing changed.' },
      ],
      // THE DEPLOY. Same conversation, different code from here down, which is
      // the whole reason this feature exists.
      buildPr: 78,
      buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c',
      at: hAt(23, 14, 0),
    },
    {
      seq: 3,
      asked: 'actually plan me a deck around it',
      answered: '',
      tools: [
        { name: 'check_deck', phase: 'start', title: 'Checking a deck list', summary: '' },
        { name: 'deck_strategy', phase: 'weird-phase-from-an-older-build', title: 'Writing a strategy guide', summary: '' },
      ],
      buildPr: 78,
      buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c',
      at: hAt(23, 14, 2),
    },
  ],
}

/** A balance that is nearly gone, and one that is. Both invented, and labelled. */
const LOW_CREDITS = { remaining: 3, allowance: 100 }
const NO_CREDITS = { remaining: 0, allowance: 100 }

const WIDTHS = { desktop: 760, mobile: 390 } as const
type WidthKey = keyof typeof WIDTHS

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-[80px]">
      <div className="mb-[10px] flex items-baseline gap-[10px]">
        <h2 className="text-[15px] font-bold text-text-primary">{title}</h2>
        <span className="text-[11px] uppercase tracking-wide text-text-muted">{id}</span>
      </div>
      {note ? <p className="mb-[12px] max-w-[70ch] text-[13px] leading-[19px] text-text-muted">{note}</p> : null}
      <div className="flex flex-col gap-[16px]">{children}</div>
    </section>
  )
}

/**
 * The farewell, kept on screen so it can be looked at.
 *
 * `DeckeFarewell` retires itself after `FAREWELL_MS` — which is correct in the
 * product and useless in a gallery, where a specimen that vanishes two seconds
 * after the page loads is a specimen nobody will ever photograph. So this
 * re-mounts it on a cycle with a fresh line each time, which also demonstrates
 * the rotation. `key` forces a real remount rather than a prop change, because
 * the component's own timer is armed on mount.
 *
 * THE RECT IS A FIXTURE and the caption says so: Deck-E is not on this route
 * (`/dev/chat-ui` is chromeless on purpose), so there is no real `himRect` to
 * position against.
 */
function FarewellSpecimen() {
  const [n, setN] = useState(0)
  const [line, setLine] = useState(() => pickFarewell({ seed: GALLERY_SEED }))
  useEffect(() => {
    const t = window.setInterval(() => {
      setLine((prev) => pickFarewell({ avoid: prev.id }))
      setN((x) => x + 1)
    }, 3200)
    return () => window.clearInterval(t)
  }, [])
  return (
    <DeckeFarewell
      key={n}
      text={line.text}
      himRect={{ left: 120, top: 96, width: 80, height: 100 }}
      onDone={() => {}}
    />
  )
}

/**
 * The dropdown's own popover chrome, without the popover.
 *
 * `HistoryMenu` positions the real one absolutely against a measured trigger
 * rect, which is exactly the behaviour a gallery cannot photograph — it would
 * hang off the side of a specimen card. The BORDER, RADIUS, WIDTH and SHADOW are
 * copied from the real popover so the sheet is judged at the size it is used at;
 * only the positioning is dropped, and that is the one thing here that is not
 * the product.
 */
function SheetFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[344px] overflow-hidden rounded-[14px] border border-border-default bg-surface-primary shadow-lg">
      {children}
    </div>
  )
}

/**
 * The transcript viewer, in a box.
 *
 * ── `height` IS A GALLERY DECISION AND IT COST ONE CAPTURE ───────────────────
 *
 * The first version was a fixed 520px for every specimen, faithfully reproducing
 * the product's pinned head over a scrolling body — and the photograph of it cut
 * the record off after two turns, so the DEPLOY RULE, which is the single most
 * important element on this surface, was inside the scroller and not in the
 * image. A gallery exists to be looked at; a specimen whose point is below its
 * own fold is a specimen that will be reviewed as if it did not have one.
 *
 * So the record runs to its full height and every turn is in the shot. The
 * short-lived states keep a box, because "vertically centred in a panel" is
 * their whole layout and it needs a panel to be centred in — a small one, so the
 * sentence is not marooned in the middle of 500px of nothing.
 */
function RecordFrame({ load, height }: { load: TranscriptLoad; height?: number }) {
  return (
    <div
      style={height ? { height } : undefined}
      className="flex flex-col overflow-hidden rounded-[12px] border border-surface-tertiary bg-surface-primary"
    >
      <TranscriptHead load={load} onBack={() => {}} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-[16px]">
          <TranscriptBody load={load} onRetry={() => {}} />
        </div>
      </div>
    </div>
  )
}

/**
 * The panel's header row, rebuilt around the REAL `HistoryMenu`.
 *
 * The instruction was *"to the right of the chat page title"*, and that is an
 * arrangement rather than a component — it cannot be judged from the control on
 * its own. The name, the badge and the ✕ here are copies of `DeckeChat`'s own
 * markup and are labelled as such on the specimen; the control between them is
 * the product's, live, and pressing it really reads your history.
 *
 * ── A COPY THAT DRIFTED, WITHIN THE HOUR ────────────────────────────────────
 *
 * The first version of this omitted the `shrink-0 whitespace-nowrap` the real
 * header carries, and photographed at 390px it broke the name across two lines
 * as **Deck-** / **E** — while the product, measured in the same session, was a
 * clean 56px single row. A gallery that renders a surface WORSE than the
 * product is the most expensive kind of wrong: somebody reviews the picture and
 * files a bug against code that is fine.
 *
 * Both class strings are now identical to `DeckeChat`'s, character for
 * character. This is the exact hazard the page's own rule #1 exists for, and
 * this component is the one place on the page that cannot obey it — so the
 * specimen also breaks out of the card's padding, because at 390px the product
 * gives this row 358px and a padded specimen gives it 318, and a row judged
 * 40px narrower than it is ever drawn is a row judged wrongly.
 */
function MockChatHeader() {
  return (
    <header className="flex w-full shrink-0 items-center gap-[10px] px-[16px] py-[9px]">
      <span className="shrink-0 whitespace-nowrap font-display text-[17px] font-normal leading-[24px] text-text-primary">
        Deck-E
      </span>
      <span className="shrink-0 whitespace-nowrap rounded-full border border-border-subtle px-[7px] py-[1px] text-[10.5px] font-medium uppercase leading-[15px] tracking-[0.04em] text-text-muted">
        Experimental
      </span>
      <HistoryMenu
        viewingId={null}
        liveId={null}
        onNewChat={() => {}}
        onOpenConversation={() => {}}
        onDeleted={() => {}}
      />
      <button
        type="button"
        aria-label="Close chat"
        className="ml-auto flex h-[38px] w-[38px] items-center justify-center rounded-full text-icon-default hover:bg-surface-secondary hover:text-icon-hover"
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>
  )
}

/** One specimen, captioned. The caption says what state this is and why it exists. */
function Specimen({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-surface-tertiary bg-surface-primary">
      <div className="flex items-baseline gap-[8px] border-b border-surface-tertiary px-[12px] py-[7px]">
        <span className="font-mono text-[11px] text-action-primary">{label}</span>
        {note ? <span className="text-[11px] leading-[16px] text-text-muted">{note}</span> : null}
      </div>
      <div className="p-[14px]">{children}</div>
    </div>
  )
}

/** The expanded specimen opens the real disclosure once after mount. */
function ExpandedSourcesFixture() {
  const host = useRef<HTMLDivElement>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    host.current?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
  }, [])

  return <div ref={host}><SourcesList sources={RESEARCH_SOURCES} /></div>
}

export default function ChatUi() {
  const [width, setWidth] = useState<WidthKey>('desktop')
  const [choices, setChoices] = useState<Choices>(new Map())
  // The empty-screen specimens hold a real draft, so the composer on this page
  // grows the way it grows in the product rather than being a picture of one.
  const [draft, setDraft] = useState('')
  const onChoice = (index: number, choice: RowChoice) =>
    setChoices((prev) => {
      const next = new Map(prev)
      next.set(index, choice)
      return next
    })

  const frame = `mx-auto w-full`
  const frameStyle = { maxWidth: `${WIDTHS[width]}px` }

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 border-b border-surface-tertiary bg-surface-primary/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-[12px] px-[20px] py-[10px]">
          <span className="text-[13px] font-bold">Deck-E chat UI</span>
          <span className="text-[11px] text-text-muted">
            Every chat surface, without a conversation. Fixtures are labelled.
          </span>
          <div className="ml-auto flex items-center gap-[6px]">
            {(Object.keys(WIDTHS) as WidthKey[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={width === k}
                onClick={() => setWidth(k)}
                className={[
                  'rounded-full px-[12px] py-[5px] text-[12px] font-semibold',
                  width === k
                    ? 'bg-action-primary text-action-on-primary'
                    : 'bg-surface-tertiary text-text-body hover:bg-action-default-hover',
                ].join(' ')}
              >
                {k} · {WIDTHS[k]}px
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1100px] px-[20px] py-[24px]">
        <div className={frame} style={frameStyle}>
          <div className="flex flex-col gap-[36px]">
            <Section
              id="activity"
              title="Activity line"
              note="The one live line a reply uses while Deck-E works. Every specimen is fixture data with a pinned start time, so the finished summaries remain photographable."
            >
              <Specimen label="thinking" note="before a tool has started">
                <ActivityLine steps={[]} busy startedAt={ACTIVITY_STARTED} />
              </Specimen>
              <Specimen label="reading a collection" note="a running read gets its collection icon and live elapsed time">
                <ActivityLine steps={ACTIVITY_STEPS.collection} busy startedAt={ACTIVITY_STARTED} />
              </Specimen>
              <Specimen label="research with sources" note="the server's purpose drives the line; five arriving sources show three favicons and +2">
                <ActivityLine steps={ACTIVITY_STEPS.research} busy startedAt={ACTIVITY_STARTED} />
              </Specimen>
              <Specimen label="waiting for approval" note="work pauses for a write confirmation">
                <ActivityLine steps={ACTIVITY_STEPS.collection} busy waiting startedAt={ACTIVITY_STARTED} />
              </Specimen>
              <Specimen label="finished" note="a completed reply keeps one compact, expandable summary">
                <ActivityLine steps={ACTIVITY_STEPS.finished} busy={false} startedAt={ACTIVITY_STARTED} />
              </Specimen>
              <Specimen label="one step failed" note="the finished line is tinted; expanding exposes the failed boundary and its retry">
                <ActivityLine steps={ACTIVITY_STEPS.failed} busy={false} startedAt={ACTIVITY_STARTED} defaultOpen onRetryStep={() => {}} />
              </Specimen>
              <Specimen label="declined write" note="a declined approval is a truthful completed state, not a successful write">
                <ActivityLine steps={ACTIVITY_STEPS.declined} busy={false} startedAt={ACTIVITY_STARTED} />
              </Specimen>
              <Specimen label="expanded steps" note="five mixed calls in the exact disclosure used by a finished reply">
                <ActivityLine steps={ACTIVITY_STEPS.expanded} busy={false} startedAt={ACTIVITY_STARTED} defaultOpen />
              </Specimen>
            </Section>

            <Section
              id="sources"
              title="Sources"
              note="A finished reply keeps the pages Deck-E read available to the reader. Titles and hosts here are deliberately obvious fixtures on real public hosts."
            >
              <Specimen label="collapsed" note="the quiet default after a researched reply">
                <SourcesList sources={RESEARCH_SOURCES} />
              </Specimen>
              <Specimen label="expanded" note="the same six sources, opened through the real disclosure">
                <ExpandedSourcesFixture />
              </Specimen>
            </Section>

            <Section
              id="deck-widget"
              title="Deck widget"
              note="Checked deck ideas remain interactive blocks in chat. Counts, ownership, cost and card art are fixtures; Save is the product button and this gallery only logs its callback."
            >
              <Specimen label="legal, mostly owned" note="60 cards, 41 owned, about $12.40 remaining; the compact first look limits the Pokémon grid">
                <DeckeScreen spec={DECK_SCREENS[0]} onDeckSaved={(deck) => console.info('fixture deck saved', deck)} onOpenDeck={(id) => console.info('fixture deck opened', id)} />
              </Specimen>
              <Specimen label="not legal" note="65 cards, four issues, a five-copy card and a broken evolution line">
                <DeckeScreen spec={DECK_SCREENS[1]} onDeckSaved={(deck) => console.info('fixture deck saved', deck)} onOpenDeck={(id) => console.info('fixture deck opened', id)} />
              </Specimen>
              <Specimen label="unchecked" note="a first draft before a deck check can judge legality">
                <DeckeScreen spec={DECK_SCREENS[2]} onDeckSaved={(deck) => console.info('fixture deck saved', deck)} onOpenDeck={(id) => console.info('fixture deck opened', id)} />
              </Specimen>
            </Section>

            <Section
              id="markdown"
              title="Answer text"
              note="His replies render as markdown on both surfaces. Remote images are refused by an allowlist — a model-written <img> is a tracking beacon."
            >
              <Specimen label="transcript tone" note="headings, lists, a table, inline code, a quote">
                <ChatMarkdown text={MARKDOWN} tone="transcript" />
              </Specimen>
              <Specimen label="bubble tone" note="the speech bubble beside his body — tighter, smaller">
                <div className="max-w-[280px]">
                  <ChatMarkdown text={'**Found it.** Pitch Black, `me05` — you have 12 of 214.'} tone="bubble" />
                </div>
              </Specimen>
            </Section>

            <Section
              id="screens"
              title="Panels"
              note="When the answer is a SHAPE rather than a sentence. Real card art, drawn from catalogue ids — he never writes markup."
            >
              <Specimen label="short panel" note="under the compact threshold, so it renders whole">
                <DeckeScreen spec={SCREEN} />
              </Specimen>
              <Specimen label="long panel" note="over the threshold: opens compact with a truthful 'N of M'">
                <DeckeScreen spec={SCREEN_LONG} />
              </Specimen>
            </Section>

            <Section
              id="approval"
              title="The approval card"
              note="The call IS the request — there is never a prose 'Confirm?' turn. Segmented by PROVENANCE, not by a confidence number: what he knows, then what he genuinely does not."
            >
              <Specimen label="one row, known" note="the ordinary case: one card, one printing, nothing to answer">
                <ApprovalCard
                  title="Log cards"
                  heldCalls={1}
                  preview={PREVIEW_ONE}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                />
              </Specimen>
              <Specimen label="mixed" note="two known rows and one where the printing is genuinely ambiguous">
                <ApprovalCard
                  title="Log cards"
                  heldCalls={1}
                  preview={PREVIEW}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                />
              </Specimen>
              <Specimen label="busy" note="after Accept, while the write is in flight">
                <ApprovalCard
                  title="Log cards"
                  heldCalls={1}
                  preview={PREVIEW}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                  busy
                />
              </Specimen>
              <Specimen
                label="a removal"
                note="the other direction. The operation chip is tinted by direction and the button changes its verb — press the wrong one of these and cards leave a collection."
              >
                <ApprovalCard
                  title="Log cards"
                  heldCalls={1}
                  preview={PREVIEW_REMOVE}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                />
              </Specimen>
              <Specimen
                label="2 calls held"
                note="he asked for two writes in one step and this card shows the first. The second is NOT queued behind it — it was dropped, and the line says so."
              >
                <ApprovalCard
                  title="Log cards"
                  heldCalls={2}
                  preview={PREVIEW_ONE}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                />
              </Specimen>
              <Specimen
                label="nothing proposed"
                note="`ambiguous` — pickVariant itself declined, so there is no guess to offer. The picker opens with nothing marked and the row says so."
              >
                <ApprovalCard
                  title="Log cards"
                  heldCalls={1}
                  preview={PREVIEW_AMBIGUOUS}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                />
              </Specimen>
              <Specimen label="no preview" note="the fallback when the dry run is missing — a broken preview must not become a broken write">
                <ApprovalCard
                  title="Save deck"
                  heldCalls={1}
                  preview={null}
                  choices={choices}
                  onChoice={onChoice}
                  onAccept={() => {}}
                  onDeny={() => {}}
                />
              </Specimen>
              <Specimen label="list create · 16 cards" note="six-card strip, then the full list inline">
                <ApprovalCard title="change this list" heldCalls={1} preview={LIST_CREATE_PREVIEW} choices={choices} onChoice={onChoice} onAccept={() => {}} onDeny={() => {}} />
              </Specimen>
              <Specimen label="deck create · 60 cards" note="a full deck stays compact until the reader opens it">
                <ApprovalCard title="save this deck" heldCalls={1} preview={DECK_CREATE_PREVIEW} choices={choices} onChoice={onChoice} onAccept={() => {}} onDeny={() => {}} />
              </Specimen>
              <Specimen label="deck edit diff" note="unchanged cards are omitted; additions and removals separate inline">
                <ApprovalCard title="save this deck" heldCalls={1} preview={DECK_EDIT_PREVIEW} choices={choices} onChoice={onChoice} onAccept={() => {}} onDeny={() => {}} />
              </Specimen>
              <Specimen label="strategy guide" note="the guide itself is visible before permission, with a bounded disclosure">
                <ApprovalCard title="write a strategy guide" heldCalls={1} preview={STRATEGY_PREVIEW} choices={choices} onChoice={onChoice} onAccept={() => {}} onDeny={() => {}} />
              </Specimen>
            </Section>

            {/*
              THE MOST-SEEN SCREEN IN THE FEATURE, and until this pass it was
              the one surface nobody could review without starting a
              conversation — the composer was welded into a 1,400-line panel
              that needs a live `useDeckeChat`. It is three real exported
              components now (`DeckeEmptyIntro`, `DeckeComposer`,
              `DeckeOpeners`) and this is them, in the order and at the widths
              the panel arranges them in.

              THE COMPOSER HERE IS LIVE. Typing in it does nothing but grow it,
              which is the behaviour worth checking: it is a textarea that
              measures itself, not a 40px input.
            */}
            <Section
              id="empty"
              title="The new-chat screen"
              note="Before anything has been said, the composer has no transcript to be the foot of, so it sits in the middle of the pane with the heading above it and the openers under it — the way a new-chat screen does."
            >
              <Specimen
                label="desktop"
                note="centred, 30px display text. The pane is dimmed glass over the live page, so this is drawn on the app's own canvas colour rather than a card."
              >
                <div className="flex min-h-[380px] flex-col justify-center gap-[0px] rounded-[10px] bg-canvas p-[16px]">
                  <div className="pb-[26px]">
                    <DeckeEmptyIntro centred greeting={GREET_DAY.greeting} subhead={GREET_DAY.subhead} />
                  </div>
                  <DeckeComposer
                    draft={draft}
                    onDraftChange={setDraft}
                    onSubmit={(e) => e.preventDefault()}
                    busy={false}
                    onStop={() => {}}
                    bottomPad={false}
                  />
                  <div className="px-[16px] pt-[12px]">
                    <DeckeOpeners openers={OPENERS} onPick={setDraft} centred />
                  </div>
                </div>
              </Specimen>
              <Specimen
                label="phone"
                note="left-aligned, 22px. He physically stands in the bottom-left corner of the panel at this size, so centring text into the column he is indenting reads as misalignment."
              >
                <div className="mx-auto flex min-h-[380px] max-w-[390px] flex-col justify-end rounded-[10px] bg-canvas p-[16px]">
                  <div className="pb-[26px]">
                    <DeckeEmptyIntro centred={false} greeting={GREET_LATE.greeting} subhead={GREET_LATE.subhead} />
                  </div>
                  <DeckeComposer
                    draft={draft}
                    onDraftChange={setDraft}
                    onSubmit={(e) => e.preventDefault()}
                    busy={false}
                    onStop={() => {}}
                    bottomPad={false}
                  />
                  <div className="px-[16px] pt-[12px]">
                    <DeckeOpeners openers={OPENERS} onPick={setDraft} centred={false} />
                  </div>
                </div>
              </Specimen>
              <Specimen
                label="a long draft"
                note="it is a textarea, not a 40px input — he gets dictated card lists, and one that scrolls out of sight while you are still typing it is one you cannot read back before sending."
              >
                <DeckeComposer
                  draft={"add a Charizard, two Pikachu VMAX and the reverse holo Gardevoir from Vivid Voltage, plus whatever Goldeen I am still missing out of Pitch Black"}
                  onDraftChange={() => {}}
                  onSubmit={(e) => e.preventDefault()}
                  busy={false}
                  onStop={() => {}}
                  bottomPad={false}
                />
              </Specimen>
              <Specimen label="busy" note="the send button is the stop button. There is never a moment where both are available.">
                <DeckeComposer
                  draft="add a Charizard and two Pikachu"
                  onDraftChange={() => {}}
                  onSubmit={(e) => e.preventDefault()}
                  busy
                  onStop={() => {}}
                  bottomPad={false}
                />
              </Specimen>
              {/*
                THE GREETING IS THE PART THAT MOVES, AND ONE SCREENSHOT CANNOT
                SHOW THAT. The two specimens above pin one seed each so the page
                is photographable; this shows what varies underneath — the hour,
                and whether `/me` has answered with a name yet.
              */}
              <Specimen
                label="no name yet"
                note="`/me` has not answered, or there is nothing to answer with. Every greeting is written twice so this is a sentence somebody wrote, never `Hey , what's next?`."
              >
                <DeckeEmptyIntro centred greeting={GREET_ANON.greeting} subhead={GREET_ANON.subhead} />
              </Specimen>
              <Specimen
                label="through the day"
                note="FIXTURE NAME and FIXTURE CLOCK. The pool knows the hour — the late-night line is the owner's own, and it can only ever appear late at night."
              >
                <ul className="flex flex-col gap-[10px]">
                  {[1, 6, 9, 14, 19, 23].map((h) => {
                    const g = composeGreeting({
                      name: FIXTURE_NAME,
                      now: new Date(2026, 7, 23, h, 20, 0),
                      // A DISTINCT DRAW PER ROW, still pinned. A single seed across
                      // six hours rolls the same group-and-index every time, which is
                      // exactly how the flat-pool defect stayed invisible.
                      seed: GALLERY_SEED + h,
                    })
                    return (
                      <li key={h} className="flex items-baseline gap-[10px]">
                        <span className="w-[52px] shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
                          {String(h).padStart(2, '0')}:20
                        </span>
                        <span className="text-[14px] leading-[21px] text-text-primary">{g.greeting}</span>
                      </li>
                    )
                  })}
                </ul>
              </Specimen>
            </Section>

            {/*
              THE STATES THAT SAY NO.

              Two of them existed before this pass and had no design at all:
              a refusal reached the transcript through `sayInstead`, which writes
              an ORDINARY ASSISTANT BUBBLE — so "I'm not switched on for this
              deployment yet" looked exactly like an answer to a question. The
              rest are the credit system's, built here presentationally and
              wired by the lane that owns the balance.
            */}
            <Section
              id="notices"
              title="When he says no"
              note="A boundary is not a failure and neither is a spent balance — but both used to arrive as an ordinary speech bubble, indistinguishable from an answer. They are cards in the app's own geometry now, and he speaks them himself."
            >
              <Specimen
                label="a boundary"
                note="`onHttpError` 503 — nothing is wrong, this deployment simply does not have him switched on."
              >
                <DeckeNotice
                  tone="neutral"
                  title="I'm not switched on for this deployment yet."
                  detail="Nothing is broken — there is just nobody home on this server."
                />
              </Specimen>
              <Specimen label="something broke" note="the generic reach-my-brain failure. The only tone that borrows the error colour.">
                <DeckeNotice
                  tone="error"
                  title="My brain glitched on that one."
                  detail="Ask me again and I will have another go."
                />
              </Specimen>
              <Specimen
                label="out of credits"
                note="FIXTURE BALANCE. He says it himself, in the first person — the owner chose that over a system banner — and the single action is the whole footer."
              >
                <DeckeNotice
                  tone="limit"
                  title={outOfCreditsLine()}
                  detail={outOfCreditsDetail()}
                  action={TOP_UP_LABEL}
                  onAction={() => {}}
                />
              </Specimen>
              <Specimen
                label="the header chip"
                note="FIXTURE BALANCES — 3 of 100, and 0 of 100. Nothing is shown at all above the threshold, which is most of the time; that absence is the design and cannot be photographed."
              >
                <div className="flex flex-wrap items-center gap-[12px]">
                  <CreditChip label={creditHeaderLabel(LOW_CREDITS)} onTopUp={() => {}} />
                  <CreditChip
                    label={creditHeaderLabel(NO_CREDITS)}
                    spent={creditState(NO_CREDITS) === 'empty'}
                    onTopUp={() => {}}
                  />
                  <span className="text-[11px] text-text-muted">
                    (a healthy balance renders nothing here)
                  </span>
                </div>
              </Specimen>
              <Specimen
                label="the composer, replaced"
                note="NOT DISABLED — replaced. Both boxes are the same 14px card in the same slot: an input that takes a question it cannot answer and shows a modal afterwards is the pretending this whole pass exists to remove, and a greyed one says the same thing more quietly."
              >
                <div className="flex flex-col gap-[10px] rounded-[10px] bg-canvas p-[16px]">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">with credits</p>
                  <DeckeComposer
                    draft=""
                    onDraftChange={() => {}}
                    onSubmit={(e) => e.preventDefault()}
                    busy={false}
                    onStop={() => {}}
                    bottomPad={false}
                  />
                  <p className="mt-[6px] text-[11px] uppercase tracking-wide text-text-muted">without</p>
                  <DeckeNotice
                    tone="limit"
                    title={outOfCreditsLine()}
                    detail={outOfCreditsDetail()}
                    action={TOP_UP_LABEL}
                    onAction={() => {}}
                  />
                </div>
              </Specimen>
            </Section>

            {/*
              HIS EXIT LINE. The pool and the component are real; the FLIGHT that
              triggers it lives in `DeckeHost.tsx`, which is outside this pass's
              edit surface — so nothing mounts this in the product yet, and
              `DeckeFarewell`'s own header says so and gives the exact wiring.
            */}
            <Section
              id="farewell"
              title="On his way out"
              note="Dismissing him is a departure, not a close-box. He flies back to his corner and leaves a line behind — a different one each time, never needy, and never a claim about a session he did not watch."
            >
              <Specimen
                label="the label"
                note="Positioned against a FIXTURE rect rather than his real one, since he is not on this page. It clamps into the viewport, takes no pointer events, and retires itself."
              >
                {/*
                  `translateZ(0)` IS LOAD-BEARING, not a compositing hint. The
                  label is `position: fixed` because in the product it floats
                  over the page he is returning to. A transformed ancestor
                  becomes the containing block for a fixed descendant, which is
                  the only way to trap it inside a specimen box — without it the
                  gallery would draw it over its own sticky toolbar.
                */}
                <div
                  className="relative h-[110px] overflow-hidden rounded-[10px] bg-canvas"
                  style={{ transform: 'translateZ(0)' }}
                >
                  <FarewellSpecimen />
                </div>
              </Specimen>
              <Specimen label="the whole pool" note={`${FAREWELLS.length} lines. The rotation never repeats twice running.`}>
                <ul className="flex flex-wrap gap-[6px]">
                  {FAREWELLS.map((f) => (
                    <li
                      key={f.id}
                      className="rounded-full border border-surface-tertiary px-[11px] py-[4px] text-[12px] leading-[17px] text-text-secondary"
                    >
                      {f.text}
                    </li>
                  ))}
                </ul>
              </Specimen>
            </Section>

            <Section
              id="history"
              title="Chat history"
              note="The dropdown beside the title, and the read-only record it opens. The build stamp is the point: #78 is the PR the build was immediately after, #77→78 means the conversation outlived a deploy, and a dash means the turn ran on a preview or a local build — which is honest, and is never drawn as #0. Every conversation below is a fixture; the clock is pinned to 23 Aug, 2:20 pm so the day headings and times do not move between captures."
            >
              <Specimen
                label="the trigger, in the real header"
                note="LIVE — this one is the actual component and clicking it really reads your history. The row around it is the panel's own header, rebuilt here so the arrangement can be judged: name, badge, control, then the ✕ hard against the trailing edge."
              >
                <div className="-mx-[14px] border-y border-surface-tertiary bg-surface-primary">
                  <MockChatHeader />
                </div>
              </Specimen>

              <Specimen
                label="the sheet — one of them is the chat you are in"
                note="FIXTURE. The live conversation is genuinely in this list — turns are filed as they happen — so the row you are sitting in would otherwise look like any other. It is marked `· now` and it does NOT open: a read-only record of the chat already on screen behind this menu is a strange trip to make somebody take. `viewing` still wins if both are somehow true, because that one describes THIS screen."
              >
                <SheetFrame>
                  <HistorySheet
                    load={{ state: 'ready', items: CONVERSATIONS }}
                    now={HISTORY_NOW}
                    viewingId={null}
                    liveId="h1"
                    confirming={null}
                    deleting={null}
                    rowError={null}
                    onOpen={() => {}}
                    onRetryList={() => {}}
                    onAskDelete={() => {}}
                    onCancelDelete={() => {}}
                    onConfirmDelete={() => {}}
                  />
                </SheetFrame>
              </Specimen>

              <Specimen
                label="the sheet — four conversations"
                note="Grouped by day, newest first, in the server's own order. The second row is the one a regression hunt wants: it spanned a deploy."
              >
                <SheetFrame>
                  <HistorySheet
                    load={{ state: 'ready', items: CONVERSATIONS }}
                    now={HISTORY_NOW}
                    viewingId={null}
                    liveId={null}
                    confirming={null}
                    deleting={null}
                    rowError={null}
                    onOpen={() => {}}
                    onRetryList={() => {}}
                    onAskDelete={() => {}}
                    onCancelDelete={() => {}}
                    onConfirmDelete={() => {}}
                  />
                </SheetFrame>
              </Specimen>

              <Specimen
                label="one row is being read"
                note="`aria-current` and a filled row, so the transcript on screen and the row it came from are visibly the same thing."
              >
                <SheetFrame>
                  <HistorySheet
                    load={{ state: 'ready', items: CONVERSATIONS.slice(0, 2) }}
                    now={HISTORY_NOW}
                    viewingId="h1"
                    liveId={null}
                    confirming={null}
                    deleting={null}
                    rowError={null}
                    onOpen={() => {}}
                    onRetryList={() => {}}
                    onAskDelete={() => {}}
                    onCancelDelete={() => {}}
                    onConfirmDelete={() => {}}
                  />
                </SheetFrame>
              </Specimen>

              <Specimen
                label="deleting takes two presses"
                note="The ✕ only ASKS. The destructive press is a different press, in a different place, with the word on it — and there is no undo offered, because the RLS grants delete and withholds update: you may withdraw your own words, not revise them."
              >
                <SheetFrame>
                  <HistorySheet
                    load={{ state: 'ready', items: CONVERSATIONS.slice(0, 2) }}
                    now={HISTORY_NOW}
                    viewingId={null}
                    liveId={null}
                    confirming="h1"
                    deleting={null}
                    rowError={null}
                    onOpen={() => {}}
                    onRetryList={() => {}}
                    onAskDelete={() => {}}
                    onCancelDelete={() => {}}
                    onConfirmDelete={() => {}}
                  />
                </SheetFrame>
              </Specimen>

              <Specimen
                label="a delete that failed"
                note="The row stays. Nothing is removed from the list until the server has said it is gone — an optimistic removal is a claim that a write succeeded before it has."
              >
                <SheetFrame>
                  <HistorySheet
                    load={{ state: 'ready', items: CONVERSATIONS.slice(0, 2) }}
                    now={HISTORY_NOW}
                    viewingId={null}
                    liveId={null}
                    confirming="h1"
                    deleting={null}
                    rowError={{ id: 'h1', message: 'HTTP 503' }}
                    onOpen={() => {}}
                    onRetryList={() => {}}
                    onAskDelete={() => {}}
                    onCancelDelete={() => {}}
                    onConfirmDelete={() => {}}
                  />
                </SheetFrame>
              </Specimen>

              <div className="grid gap-[16px] md:grid-cols-3">
                <Specimen label="loading" note="one honest line">
                  <SheetFrame>
                    <HistorySheet
                      load={{ state: 'loading' }}
                      now={HISTORY_NOW}
                      viewingId={null}
                      liveId={null}
                      confirming={null}
                      deleting={null}
                      rowError={null}
                      onOpen={() => {}}
                      onRetryList={() => {}}
                      onAskDelete={() => {}}
                      onCancelDelete={() => {}}
                      onConfirmDelete={() => {}}
                    />
                  </SheetFrame>
                </Specimen>
                <Specimen label="nothing recorded yet" note="not an error, and it says what will be here">
                  <SheetFrame>
                    <HistorySheet
                      load={{ state: 'ready', items: [] }}
                      now={HISTORY_NOW}
                      viewingId={null}
                      liveId={null}
                      confirming={null}
                      deleting={null}
                      rowError={null}
                      onOpen={() => {}}
                      onRetryList={() => {}}
                      onAskDelete={() => {}}
                      onCancelDelete={() => {}}
                      onConfirmDelete={() => {}}
                    />
                  </SheetFrame>
                </Specimen>
                <Specimen label="the list failed" note="says what went wrong, and offers the one thing that might work">
                  <SheetFrame>
                    <HistorySheet
                      load={{ state: 'failed', message: 'Failed to fetch' }}
                      now={HISTORY_NOW}
                      viewingId={null}
                      liveId={null}
                      confirming={null}
                      deleting={null}
                      rowError={null}
                      onOpen={() => {}}
                      onRetryList={() => {}}
                      onAskDelete={() => {}}
                      onCancelDelete={() => {}}
                      onConfirmDelete={() => {}}
                    />
                  </SheetFrame>
                </Specimen>
              </div>

              <Specimen
                label="the record"
                note="Four turns, and a deploy landed between the third and the fourth — that ruled line is the whole feature. The last turn shows the two states that only exist in a record: a call that never finished, and a phase this app does not recognise. Neither draws a tick."
              >
                <RecordFrame load={{ state: 'ready', conversation: RECORD }} />
              </Specimen>

              <div className="grid gap-[16px] md:grid-cols-2">
                <Specimen
                  label="deleted in another tab"
                  note="An ordinary thing to do. It must not look like a fault, and it must not offer a restore that does not exist."
                >
                  <RecordFrame load={{ state: 'gone' }} height={260} />
                </Specimen>
                <Specimen label="the record failed to open" note="a real retry, which re-runs the same request">
                  <RecordFrame load={{ state: 'failed', message: 'HTTP 500' }} height={260} />
                </Specimen>
              </div>

              <Specimen
                label="where the composer was"
                note="The strongest guard against the one failure this surface can have. The box is not greyed and not disabled — it is GONE, and a control that is gone cannot take a question it will never answer."
              >
                <TranscriptExit onBack={() => {}} />
              </Specimen>
            </Section>

            <Section
              id="flow"
              title="A whole turn"
              note="The composed thing, in order: his answer, the calls it took, and a panel — which is how any of this is actually read."
            >
              <Specimen label="lookup → answer → panel" note="the ordinary shape of a good turn">
                <div className="flex flex-col gap-[10px]">
                  <ActivityLine steps={ACTIVITY_STEPS.finished.slice(0, 1)} busy={false} startedAt={ACTIVITY_STARTED} />
                  <ChatMarkdown
                    text={'You have **12 of 214** in Pitch Black. Here are the five worth the most.'}
                    tone="transcript"
                  />
                  <DeckeScreen spec={SCREEN} />
                </div>
              </Specimen>
              <Specimen label="a turn that failed" note="the failure is the loudest thing on screen, and it says what to do next">
                <div className="flex flex-col gap-[10px]">
                  <ActivityLine steps={ACTIVITY_STEPS.failed} busy={false} startedAt={ACTIVITY_STARTED} defaultOpen onRetryStep={() => {}} />
                  <ChatMarkdown text={'That did not go through — the set id was wrong. Want me to look it up?'} tone="transcript" />
                </div>
              </Specimen>
              <Specimen label="a write, held" note="the calls, then the card that holds the write until you answer it">
                <div className="flex flex-col gap-[10px]">
                  <ActivityLine steps={ACTIVITY_STEPS.collection} busy waiting startedAt={ACTIVITY_STARTED} />
                  <ApprovalCard
                    title="Log cards"
                    heldCalls={1}
                    preview={PREVIEW}
                    choices={choices}
                    onChoice={onChoice}
                    onAccept={() => {}}
                    onDeny={() => {}}
                  />
                </div>
              </Specimen>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
