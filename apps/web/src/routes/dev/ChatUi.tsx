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
import { useEffect, useState } from 'react'
import { ChatMarkdown } from '../../character/host/chat/ChatMarkdown'
import { ThinkingRow } from '../../character/host/chat/ThinkingRow'
import { ToolRow } from '../../character/host/chat/ToolRow'
import type { ToolRowData } from '../../character/host/chat/toolRowState'
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
import type { ScreenSpec } from '../../character/host/DeckeScreen'

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

const row = (over: Partial<ToolRowData> & Pick<ToolRowData, 'id' | 'name' | 'title' | 'phase'>): ToolRowData => over

const TOOL_ROWS: { label: string; note: string; data: ToolRowData }[] = [
  {
    label: 'start',
    note: 'A call that has just been made. Quiet by default (C16) — no chrome.',
    data: row({ id: '1', name: 'search_cards', title: 'Searched the catalogue', phase: 'start' }),
  },
  {
    label: 'progress',
    note: 'A long call, carrying a server-composed note from a real tool boundary.',
    data: row({
      id: '2',
      name: 'deck_strategy',
      title: 'Writing a strategy guide',
      phase: 'progress',
      note: 'Reading 60 cards…',
    }),
  },
  {
    label: 'ok',
    note: 'Finished. The summary is the first line of the REAL result, never prose.',
    data: row({
      id: '3',
      name: 'set_progress',
      title: 'Checked set completion',
      phase: 'ok',
      summary: 'Pitch Black — 12 of 214',
    }),
  },
  {
    label: 'partial (timeout)',
    note: 'Neither success nor failure. Some of it happened; saying otherwise is the lie this pass removed.',
    data: row({
      id: '4',
      name: 'deck_strategy',
      title: 'Writing a strategy guide',
      phase: 'partial',
      reason: 'timeout',
      summary: 'Timed out after 3 sections',
    }),
  },
  {
    label: 'partial (truncated)',
    note: 'A journey that stopped part way. The steps after it did not run and are not claimed.',
    data: row({
      id: '5',
      name: 'journey',
      title: 'Walked you there',
      phase: 'partial',
      reason: 'truncated',
      summary: 'Stopped at step 3 — that row never appeared',
    }),
  },
  {
    label: 'error',
    note: 'The surface the owner once read as a success. Loud, ruled, worded, and it offers a way back.',
    data: row({
      id: '6',
      name: 'log_cards',
      title: 'Adding to your collection',
      phase: 'error',
      summary: 'That set id does not exist',
    }),
  },
]

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

function previewRow(over: Partial<PreviewRow> & Pick<PreviewRow, 'index' | 'cardId' | 'cardName'>): PreviewRow {
  return {
    setId: 'me05',
    number: '013',
    certainty: 'stated',
    candidates: [],
    wouldUseVariantId: 1,
    variantId: 1,
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
    previewRow({ index: 0, cardId: 'me05-013', cardName: 'Goldeen' }),
    previewRow({
      index: 1,
      cardId: 'swsh4-44',
      cardName: 'Pikachu VMAX',
      setId: 'swsh4',
      number: '44',
      variantLabel: 'Reverse holo',
      before: 1,
      after: 2,
    }),
    previewRow({
      index: 2,
      cardId: 'swsh4-25',
      cardName: 'Charizard',
      setId: 'swsh4',
      number: '25',
      certainty: 'ambiguous',
      variantId: null,
      variantLabel: null,
      wouldUseVariantId: 12,
      candidates: [
        { variantId: 11, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 },
        { variantId: 12, kindCode: 'reverse', label: 'Reverse holo', isPrimary: false, ownedQty: 1 },
        { variantId: 13, kindCode: 'holo', label: 'Holo', isPrimary: false, ownedQty: 0 },
      ],
    }),
  ],
  skipped: [],
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

/* ── Page furniture ────────────────────────────────────────────────────────── */

/* THE REAL OPENERS, from the product's own pool with the product's own
 * rotation run against a clean slate — which is exactly what a first visit and a
 * private window both see, and is the reason the empty state is screenshot-able
 * at all. Not a copy of the strings: a copy would drift the day somebody edits
 * the pool, and this page would go on showing openers nobody is offered.
 */
const OPENERS = chooseOpeners()

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

export default function ChatUi() {
  const [width, setWidth] = useState<WidthKey>('desktop')
  const [choices, setChoices] = useState<Choices>(new Map())
  // The empty-screen specimens hold a real draft, so the composer on this page
  // grows the way it grows in the product rather than being a picture of one.
  const [draft, setDraft] = useState('')
  const [started] = useState(() => Date.now() - 8_400)
  const [, tick] = useState(0)

  // The thinking row counts, and a still page would show it frozen at whatever
  // it was when this mounted — which is precisely the "caught looking stopped"
  // failure the row exists to avoid. So the page keeps it alive.
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(t)
  }, [])

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
              id="thinking"
              title="Thinking"
              note="Appears the moment a turn starts. It counts, because a counter cannot be caught looking stopped — the owner once sat through 210 seconds of a transcript that showed nothing at all."
            >
              <Specimen label="no labels yet" note="the first instant of a turn">
                <ThinkingRow startedAt={started} labels={[]} />
              </Specimen>
              <Specimen label="with status lines" note="truthful lines from real tool boundaries, newest last">
                <ThinkingRow
                  startedAt={started}
                  labels={['Reading your collection', 'Matching 3 printings', 'Checking prices']}
                />
              </Specimen>
            </Section>

            <Section
              id="tool-rows"
              title="Tool rows"
              note="One row per real invocation, in the order the calls actually happened. Quiet by default; loud only when something went wrong."
            >
              {TOOL_ROWS.map((t) => (
                <Specimen key={t.data.id} label={t.label} note={t.note}>
                  <ToolRow data={t.data} onRetry={() => {}} />
                </Specimen>
              ))}
              <Specimen label="a run of rows" note="how a real turn reads: several calls, one after another">
                <div className="flex flex-col gap-[2px]">
                  {TOOL_ROWS.slice(0, 3).map((t) => (
                    <ToolRow key={t.data.id} data={t.data} />
                  ))}
                </div>
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
                    <DeckeEmptyIntro centred />
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
                    <DeckeEmptyIntro centred={false} />
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
            </Section>

            <Section
              id="flow"
              title="A whole turn"
              note="The composed thing, in order: his answer, the calls it took, and a panel — which is how any of this is actually read."
            >
              <Specimen label="lookup → answer → panel" note="the ordinary shape of a good turn">
                <div className="flex flex-col gap-[10px]">
                  <ToolRow data={TOOL_ROWS[2].data} />
                  <ChatMarkdown
                    text={'You have **12 of 214** in Pitch Black. Here are the five worth the most.'}
                    tone="transcript"
                  />
                  <DeckeScreen spec={SCREEN} />
                </div>
              </Specimen>
              <Specimen label="a turn that failed" note="the failure is the loudest thing on screen, and it says what to do next">
                <div className="flex flex-col gap-[10px]">
                  <ToolRow data={TOOL_ROWS[0].data} />
                  <ToolRow data={TOOL_ROWS[5].data} onRetry={() => {}} />
                  <ChatMarkdown text={'That did not go through — the set id was wrong. Want me to look it up?'} tone="transcript" />
                </div>
              </Specimen>
              <Specimen label="a write, held" note="the calls, then the card that holds the write until you answer it">
                <div className="flex flex-col gap-[10px]">
                  <ToolRow data={TOOL_ROWS[2].data} />
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
