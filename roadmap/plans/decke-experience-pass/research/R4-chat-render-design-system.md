# R4 — Chat rendering, rich text, and the design system

Research reference for planning Deck-E chat rendering improvements. All paths
absolute-relative to `E:/Users/cheyr/deckpal`. Line numbers as of 2026-08-22.

---

## A. Current chat rendering

### A.1 Files and roles

- `apps/web/src/character/host/DeckeChat.tsx` — the chat panel component: header,
  scrollable transcript, approval gate, composer. Owns scroll/park/gutter layout
  around the 3D character.
- `apps/web/src/character/host/DeckeBubble.tsx` — the *speech bubble* shown near
  the character when the chat is minimised (not the transcript bubbles).
- `apps/web/src/character/host/DeckeScreen.tsx` — renders a `ScreenSpec` ("ad hoc
  page"/inline panel) the model composed.
- `apps/web/src/character/host/useDeckeChat.ts` — the hand-rolled SSE reader /
  turn state machine (browser half of the conversation).
- `apps/web/src/character/host/uiTools.ts` — browser-executed tool set
  (`flyTo`, `highlight`, `goTo`, `scrollToMe`, `click`).
- `apps/web/src/character/host/approval.ts` — pure functions for the
  approval-request/response wire shapes.

### A.2 The message model

`ChatMessage` (`DeckeChat.tsx:135-158`):

```ts
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  screen?: ScreenSpec   // a panel he composed, attached to the turn
  tools?: ToolChip[]    // what he actually did this turn, as chips
}
```

`ToolChip` (`useDeckeChat.ts:92-99`):

```ts
export type ToolChip = {
  id: string
  name: string
  title: string
  phase: 'start' | 'ok' | 'error'
  summary?: string
}
```

There is **no "part" list / block union** the way `@ai-sdk/react`'s `useChat`
models messages — this is a hand-rolled reader (see the file's header comment,
`useDeckeChat.ts:1-41`, explaining why: this is a Vite SPA, not Next.js, and the
`data-decke` animation-command parts must reach the 3D engine directly and never
touch the transcript). One `ChatMessage` per turn accumulates: streamed text
(`appendText`, `useDeckeChat.ts:225-228`), a `screen` (`onScreen`, line 255-262),
and `tools` chips (`onToolChip`, line 263-279, replacing a `start` phase entry
with its `ok`/`error` result by id, never accumulating duplicates).

### A.3 Rendering and DOM order (the actual bug the owner is describing)

In `DeckeChat.tsx`, each list item (`<li key={m.id}>`, lines 482-549) renders,
**in this literal order**:

1. **Text bubble** (lines 492-503) — only if `m.text` is non-empty:
   ```tsx
   {m.text ? (
     <div className="decke-bubble rounded-[14px] px-[12px] py-[8px] text-[14px] leading-[21px] ...">
       {m.text}
     </div>
   ) : null}
   ```
   **`{m.text}` is raw text in a JSX child — no markdown parsing whatsoever.**
   Any `**bold**`, `- list item`, `` `code` ``, etc. the model emits renders
   completely literally, asterisks and all. This is the entire owner complaint
   #1 in one line of code.

2. **Tool chips** (lines 504-540) — rendered **after** the text bubble in JSX
   source order, but the comment directly above them (lines 504-518) explicitly
   says the intent is the opposite:
   > "Rendered ABOVE his words on purpose — the reading order is 'I checked
   > your collection' then 'you've got 70 of them'..."

   This comment is **stale/aspirational and does not match the code**: the
   text bubble block is physically first in the JSX (line 492), the tool-chip
   `<ul>` is physically second (line 519). Visually (flex-column, `gap-[8px]`,
   `items-start`/`items-end`) chips render **below** the answer, not above it —
   which is exactly owner complaint #2's "the chip appears first, the answer
   appears above/after it, and the chip stays underneath... unintuitive" as
   observed from the user's point of view (chip visually trails the answer,
   contradicting the intended "I checked, then here's the answer" reading
   order). Any rendering-order fix should reconcile the code with this comment's
   stated intent (chips before/above text) or update the comment to match a
   deliberately chosen new order.

3. **Screen panel** (lines 541-548) — full width (`decke-figure`), rendered last.

   The chip markup itself (lines 519-539):
   ```tsx
   <li className={[
     'rounded-full px-[10px] py-[3px] text-[12px] leading-[18px]',
     'border border-border-subtle bg-surface-secondary',
     t.phase === 'error' ? 'text-text-muted line-through' : 'text-text-muted',
   ].join(' ')}
     title={t.summary ?? undefined}
   >
     {t.phase === 'start' ? `${t.title}…` : t.title}
   </li>
   ```
   This is a **static `<li>`, not a `<button>`** — no `onClick`, `role`,
   `tabIndex`, `cursor-pointer`, or any interactive affordance. The chip's
   `summary` (the real tool result's first line) is stashed only in the native
   `title` attribute, i.e. a browser tooltip on hover — **invisible on mobile
   (no hover), and not discoverable without hovering on desktop**, which is
   exactly owner complaint #2 ("not clear whether it's something I'd be able
   to click on"). It is visually a rounded-full pill (`rounded-full ... border
   ... bg-surface-secondary`), which reads as a static tag/badge, not an
   affordance — matching the "it looks like a standard tag" complaint verbatim.
   The owner's stated preference — "highlightable, but not a pill by default" —
   maps directly onto the `HighlightRing` primitive (§D.6 below), which exists
   precisely to mark "this is the thing being talked about" without the static
   pill treatment.

### A.4 The "thinking"/loading state today

There is **no per-message loading affordance in the transcript at all**. The
only loading signal is:
- The 3D character's own body state (`decke.setState('thinking')`,
  `useDeckeChat.ts:195`) — an engine-level animation, not a chat UI element.
- The composer swaps its Send button for a Stop button while `busy`
  (`DeckeChat.tsx:681-699`) — a plain filled square icon, no spinner, no label.
- The assistant `ChatMessage` is inserted with `text: ''` at turn start
  (`useDeckeChat.ts:181`) and no bubble renders for empty text (the `m.text ?
  ... : null` guard, `DeckeChat.tsx:492`), so **during the gap before the first
  token arrives, the transcript shows literally nothing new** — no skeleton, no
  "thinking" bubble, no indication a turn is in flight from the transcript's own
  point of view. Tool chips *do* appear incrementally as `start`/`ok`/`error`
  phases stream in (`onToolChip`, `useDeckeChat.ts:263-279`), which is the only
  existing "here's what's going on" signal — but it is bare pill text
  (`Checking…` → `Read 604 cards`), no animation on the pill itself, no expand/
  collapse, no timeline. This is the gap owner complaint #3 names directly.

### A.5 Approval UI (relevant to complaint #4)

`DeckeChat.tsx:595-645` — rendered above the composer when `asking?.length`:
a plain-language question ("Let him log cards?"), the dry-run preview text
(`previewOf(messages)`, sourced from the last `ok` chip's `summary` — see
`DeckeChat.tsx:161-180`), and two buttons ("Leave it" / "Go ahead"). This is a
single global dialog area, not a chat-transcript widget — it sits fixed below
the scrollable list and above the composer, `role="alertdialog"`. See §C for
the full round trip this is the front end of.

### A.6 Markdown renderer: already in the repo, NOT wired into chat

**Direct answer: yes, `react-markdown` + `remark-gfm` are already dependencies**
(`apps/web/package.json`: `"react-markdown": "^10.1.0"`, `"remark-gfm":
"^4.0.1"`), and there is already a fully-built, token-styled renderer:
`apps/web/src/routes/deck/MarkdownView.tsx` (52 lines, full file):

```tsx
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  h1: (...) => <h1 className="... text-[24px] font-bold ... text-text-primary ...">
  h2, h3, h4, p, a (target=_blank, text-link), ul, ol, li, strong, code
  (inline, bg-surface-tertiary), pre (block, bg-surface-tertiary), blockquote,
  hr, table/th/td (border-border-default)
}

export default function MarkdownView({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
}
```

It is used **only** by `StrategyTab` (deck strategy guides) via
`React.lazy()` — the file's own header comment says why: "react-markdown +
remark-gfm (~40 KB gz) land in their own chunk and never touch the main
bundle." `DeckeChat.tsx` does not import it, does not lazy-load it, and does
not run `m.text` through any markdown/sanitization pipeline — it is rendered as
a plain string child. **Wiring `MarkdownView` (or a variant with a tighter
component map for a 14px chat bubble) into the assistant bubble is a
substantially pre-solved problem**: the dependency is installed, the token-styled
component map already exists, and the lazy-chunk pattern to avoid bundle bloat
is already proven in this exact codebase.

No other markdown/sanitization libraries exist anywhere else in the repo
(`marked`, `micromark`, `dompurify`, `sanitize-html`, `rehype` — no hits outside
`react-markdown`'s own dependency tree and this one call site).

Server-side note: `apps/api/src/decke/prompt.ts` and `tools.ts` never instruct
the model to avoid markdown syntax (nothing in the excerpts read constrains
output to plain text) — so the raw `**bold**` literally reaching the DOM is a
front-end rendering gap, not a prompt-engineering fix.

### A.7 Scroll container, autoscroll, no fade/mask

- The transcript is a single scrollable flex column:
  `DeckeChat.tsx:471-474`, `overflow-y-auto`, bottom-aligned via `mt-auto` on the
  `<ul>` (deliberately, not `justify-end` — see the comment at lines 462-470
  citing a prior unusable-panel bug where `justify-end` made early messages
  unreachable).
- Autoscroll: `useLayoutEffect` at `DeckeChat.tsx:329-333` sets
  `el.scrollTop = el.scrollHeight` on every `messages` change, **before paint**
  (not `useEffect`) specifically so a message that mounts already clear of the
  character isn't animated sliding out from under him (comment at 322-328).
  This is a hard snap-to-bottom on every update, not a "stick to bottom only if
  already at bottom" pattern — there is no scroll-position check before forcing
  `scrollTop`, so a user who has scrolled up to re-read an earlier message would
  be yanked back down on the next streamed token. Worth flagging for the
  rendering plan even though it's not one of the 5 named complaints.
- **No CSS fade/mask (`mask-image` gradient) over the message list** — none of
  the excerpted CSS in `theme.css` or `DeckeChat.tsx` defines one, and no
  `overflow` clipping trick beyond the plain scroll container.
- Bubble-vs-character horizontal layout (`decke-shift`, `decke-gutter`,
  `decke-bubble`, `decke-figure` in `theme.css:792-848`) is the *only*
  motion/geometry system layered onto the transcript: it exists solely to keep
  bubbles clear of the 3D character's silhouette on mobile, not for readability
  of long text.

---

## B. The ad-hoc screen system ("ad hoc page")

### B.1 Server schema — `apps/api/src/decke/screens.ts` (quoted in full structure)

Block kinds, two lists (`screens.ts:46-84`):

```ts
export const LEAF_BLOCK_KINDS = [
  'heading', 'text', 'cardGrid', 'statTile', 'progress', 'status', 'empty', 'table',
] as const

export const BLOCK_KINDS = [
  'heading', 'text', 'cardGrid', 'statTile', 'progress', 'status', 'empty', 'table', 'group',
] as const
```

`group` is the only kind that nests, and it nests leaf blocks only — one level
deep, enforced both in the zod schema (`left`/`right` typed as
`z.array(leafBlockSchema)`, not `blockSchema`) and again at runtime in
`validateBlock`'s `group` case (`screens.ts:280-300`) — "a group cannot contain
another group," stated twice deliberately (schema + runtime) because
`validateBlock` is exported and callable on hand-built objects that never went
through the schema.

Per-block fields (`leafFields`, `screens.ts:103-157`), all optional, shared
across kinds by name (`text` doubles as "the label" for every kind):

| Field | Type | Used by |
|---|---|---|
| `text` | `string.max(280)` | heading/text/status/empty (the words); statTile/progress/cardGrid/table (the caption) |
| `cards` | `string[].max(60)` | cardGrid — catalog ids, **must** come from a tool result this turn (grounding, see below) |
| `quantities` | `number[].max(60)` | cardGrid — positional to `cards` |
| `value` | `string.max(40)` | statTile |
| `percent` | `number.min(0).max(100)` | progress |
| `tone` | `'neutral'\|'good'\|'warn'\|'bad'` | statTile/status |
| `editable` | `boolean` | cardGrid — lets the reader remove a mis-scanned row |
| `columns` | `string[].min(2).max(4)` | table — first column is the row label, rest are right-aligned figures |
| `rows` | `string[][].max(10)`, each row length must equal `columns.length` exactly | table |

Caps (`screens.ts:186-225`): `MAX_BLOCKS = 12` per screen; `SCREEN_CARD_BUDGET
= 60` cards across every grid in a screen (spent in block order; a grid that
doesn't fit is dropped whole, never truncated); `TABLE_MAX_COLUMNS = 4`,
`TABLE_MAX_ROWS = 10`; `GROUP_MAX_PER_COLUMN = 4`.

**Validation is reject-not-clamp** (`validateBlock`, `screens.ts:241-304`) —
a malformed block is dropped with a stated reason (`sanitizeScreen`,
`screens.ts:367-421`), never silently corrected, "because a model that is
silently corrected learns nothing and repeats the mistake." The one exception
(`fillQuantities`/`normalizeBlock`, lines 306-348): a short `quantities` array
is padded with `1`s rather than rejected, because omitting the field entirely
already means "every card is a single" — a genuinely unambiguous case.

**Grounding** (`sanitizeScreen`'s `grounding` param, `screens.ts:376-409`):
card ids in a `cardGrid` that no tool actually returned this turn are stripped
(not the whole block — the honest remainder is kept) via `partitionCards` from
`grounding.ts`, and the dropped ids are reported back to the model by name so
it can self-correct next turn. This is the mechanism that makes `cardGrid`
render *real* card art rather than model-invented ids (see §E).

Schema shape is intentionally **flat with a `kind` enum**, not a `z.union` —
the file's header comments (`screens.ts:15-19`) explain this was chosen for
JSON-Schema compatibility with the target model (xAI/grok tool-calling), not
for renderer convenience.

### B.2 Client renderer — `apps/web/src/character/host/DeckeScreen.tsx`

Mirrors the server's block list exactly (a `switch` over `Block['kind']`,
lines 96-234); `DeckeScreen.tsx:1-26`'s header states the security property
directly: **"there is no field anywhere in this schema that carries HTML, a
class name, a style, a URL or a selector"** — the model picks components and
props, never markup. Unrecognized kinds render `null` (default case,
`DeckeScreen.tsx:228-233`) — this is the second half of the same
never-render-unvalidated-content guarantee `screens.ts` establishes server-side;
a dedicated test, `apps/web/src/character/host/__tests__/sourceSync.test.ts`,
asserts the two `BLOCK_KINDS` lists (server `screens.ts` and this switch) never
drift apart, because the web package cannot import the API package's types
directly.

Per-block rendering, briefly:
- `heading`/`text`/`status`/`empty` → plain styled text (font-weight/tone
  differences only).
- `statTile` → label + big tabular-nums value, tone-colored
  (`TONE` map, `DeckeScreen.tsx:51-56`, mapping to real tokens:
  `text-action-primary` for `good`, `text-error` for `bad`, etc.).
- `progress` → `role="progressbar"` + a `bg-action-primary` fill bar over
  `bg-surface-primary` track.
- `table` → first column left-aligned prose, rest right-aligned tabular
  figures, horizontally scrollable (`overflow-x-auto`).
- `group` → CSS grid, 2 columns, **never stacks even on a 390px phone**
  (comment at `DeckeScreen.tsx:202-212` explains this is deliberate: a group's
  whole meaning is "these two things side by side," and stacking would make it
  indistinguishable from two separate blocks). Passes `dense={true}` down to
  its children, which currently only changes `cardGrid`'s column count
  (2 instead of 3/4) and `heading`'s font size.
- `cardGrid` (`CardGrid`, lines 258-320) — the one block that resolves real
  card art (see §E for the full pipeline): renders `<CardImage>` per resolved
  id, a quantity badge (`×N`) bottom-right if `quantities[i] > 1`, and (if
  `editable` and an `onRemoveCard` callback was passed) a remove `×` button
  top-right. An id that fails to resolve (`found === null`, i.e. the catalog
  genuinely has nothing for it) renders the raw id as monospace text in the
  card-shaped box rather than a broken image or a silently dropped slot.
  `undefined` (still loading) renders an empty placeholder box with nothing in
  it — the two states are visually distinguished on purpose so "still asking"
  never looks identical to "asked, and there is no such card."

`onRemoveCard` is a **prop DeckeScreen accepts but nothing in DeckeChat.tsx
currently passes** — confirmed by DeckeChat.tsx's usage: `<DeckeScreen
spec={m.screen} />` (line 546) with no second prop. So the `editable`
cardGrid affordance exists in the renderer but is currently a dead branch in
the live chat surface — worth flagging since owner complaint #4's approval
flow ("that one's wrong" correction) would plug directly into this existing,
unused wiring.

### B.3 What's missing to render a screen as a compact **inline chat widget**

Today `DeckeScreen` already renders inline in chat (`DeckeChat.tsx:544-548`,
wrapped in `.decke-figure`, full-width-minus-gutter) — so "inline in chat" is
not itself missing. What's missing relative to the owner's stated want
("previewable as an inline chat widget first," implying something *more
compact* than the full panel, likely for a card-approval preview):

- **No compact/summary rendering mode.** `DeckeScreen` always renders its full
  `title` + all blocks at "chat" density (already denser via `dense` inside
  `group`, but a top-level screen is never itself compact) — there's no
  "show N of M, expand for the rest" affordance, no max-height + fade/scroll
  treatment for a screen with many blocks, and no minimized/collapsed initial
  state. `MAX_BLOCKS = 12` (§B.1) caps *authoring* size but the renderer does
  not additionally throttle *display* size.
- **No distinct visual treatment for a "preview" screen vs. a "confirmed/
  historical" screen** — a screen attached to a still-open approval question
  (the dry-run result) and a screen attached to a completed turn look
  identical today; nothing marks "this is what I'm about to do" differently
  from "here's what happened."
- **No animation/expand-in state** for a screen that streams in — it just
  appears fully formed once `onScreen` fires (a single event, not
  incremental — `screens.ts`'s `showScreen` tool has no streaming variant
  visible in this research), aligning with owner complaint #3's want for
  something more than a static appearance.

---

## C. Approval / dry-run flows — the propose → confirm → commit template

**Yes — a complete, working propose→confirm→commit pattern already exists**,
spanning server and client. This is very likely the template for "want me to
put these cards in?" → dry run → Accept → actually writes.

### C.1 Server: classification and enforcement — `apps/api/src/decke/adapters/aisdk.ts`

Two pure predicates (`aisdk.ts:214-231`):

```ts
export function wouldMutate(def: ToolDefinition, input: unknown): boolean {
  if (def.annotations.readOnlyHint) return false
  const hasDryRun = def.inputSchema ? 'dry_run' in def.inputSchema.shape : false
  if (!hasDryRun) return true
  const dry = (input as { dry_run?: unknown } | null | undefined)?.dry_run
  return dry === false   // ANYTHING but explicit false is a preview
}

export function requiresApproval(def: ToolDefinition, input: unknown): boolean {
  if (def.annotations.readOnlyHint) return false
  if (def.annotations.destructiveHint) return true
  return wouldMutate(def, input)
}
```

`forcePreview` (`aisdk.ts:240-245`) is belt-and-braces: even if a call was
independently classified as "not needing approval," the server **forces**
`dry_run: true` into the arguments unless the call is actually being executed
as an approved write (`aisdk.ts:342-346`):

```ts
const effective = requiresApproval(def, args) ? args : forcePreview(def, args)
const result = await withToolCtx(opts, (ctx) => def.handler(effective, ctx))
```

Every tool is wrapped with `needsApproval: (input) => requiresApproval(def,
input)` when calling the AI SDK's `tool()` (`aisdk.ts:334-337`). Per the file's
own comment (`aisdk.ts:179-184`), this is a **real SDK-level hold**: with
`needsApproval: true` the tool's `execute` genuinely never runs until an
approval message arrives — verified against the pinned `ai@7.0.66` build, not
assumed from docs.

`log_cards` (the collection-write tool referenced throughout, e.g.
`__tests__/approval.test.ts:59-61,70-75`) has a `dry_run` field: `dry_run:
true` (or omitted) → preview, runs unheld; `dry_run: false` → a real write,
held for approval. Three tools have **no** `dry_run` at all —
`deck_strategy`, `add_battle_log`, `edit_battle_log` — so every call to them
is a write and always needs approval (falls out of the same rule, not a
special case).

### C.2 Wire protocol — approval request/response, `apps/web/src/character/host/approval.ts`

- Server emits `tool-approval-request` with `approvalId` (+ `toolCallId`, and
  `signature` when `DECKE_APPROVAL_SECRET` is set) — the arguments and tool
  name are **not** repeated on this chunk; they were already seen on that
  call's earlier `tool-input-available` chunk and are held in maps
  (`approvalNames`/`approvalTitles`/`approvalInputs`,
  `useDeckeChat.ts:539-546`) until the request chunk arrives.
- `pendingApprovalFromChunk` (`approval.ts:122-138`) assembles the full
  `PendingApproval` (approvalId, toolCallId, name, title, input, signature).
- The answer is sent back by **replaying the entire tool call** with the
  verdict attached (`approvalReplayPart`, `approval.ts:162-185`) — not a bare
  `{approvalId, approved}` message. The file's header (`approval.ts:1-53`)
  documents two previously-shipped bugs from getting this replay shape wrong:
  (1) a bare response object was misread by the SDK as a call to a
  nonexistent tool named `"approval-response"`; (2) dropping `signature` broke
  every approved write once `DECKE_APPROVAL_SECRET` was set in production.
  Both are exactly the class of subtle failure — "consent given, nothing
  happened" — worth re-checking if a new approval UI touches this wire code.
- Denial is sent as a real answer (`approved: false, reason: 'the reader
  declined'`), not silence, so the model can say "alright, left it alone."

### C.3 Client turn loop — `useDeckeChat.ts`

The `send()` function's per-leg loop (`useDeckeChat.ts:239-444`):
1. Streams a leg; if it produced approval requests, calls `askApproval(list)`
   (line 346) which parks a Promise on `resolverRef` and sets `asking` state
   (rendered by `DeckeChat.tsx`'s alertdialog, §A.5).
2. Before asking, checks `mayAskApproval(approvalReplays)` (line 334) — **the
   dialog is never shown if there's no leg budget left to carry the answer
   back**, specifically to avoid "reader consents, turn ends, nothing
   written" (documented as a real bug this guard fixes,
   `useDeckeChat.ts:326-345`).
3. On answer, pushes an `approvalReplayPart` for each decision and `continue`s
   to POST the next leg immediately — comment at lines 354-367 flags a live
   upstream AI SDK bug (`vercel/ai#17033`) requiring the approval-response
   message to be the *last* message sent, so nothing may be appended after
   this push.
4. Leg/replay budgets are centralized in `approval.ts`: `MAX_LEGS = 4`,
   `MAX_APPROVAL_REPLAYS = 2`, `legBudget(replays) = MAX_LEGS + replays`
   (`approval.ts:205-226`) — tested independently of the (untestable, due to
   `import.meta.env` at module scope) hook itself.

### C.4 What the dialog shows — `previewOf`, `DeckeChat.tsx:161-180`

```ts
function previewOf(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const done = (messages[i].tools ?? []).filter((t) => t.phase === 'ok' && t.summary)
    const last = done[done.length - 1]
    if (last?.summary) return last.summary
  }
  return null
}
```

The dry-run **already ran** (unheld, per §C.1) before the real write was even
attempted, and its chip's `summary` — the tool's actual first line of output,
never something the model wrote — is what the approval dialog shows under the
question (`DeckeChat.tsx:623-627`). This is explicitly NOT relying on the model
narrating the preview in words (the comment at 606-621 documents a measured
failure where the model produced zero text on the turn it asked to write,
leaving a blank consent dialog if this hadn't existed).

### C.5 Applicability to "add these cards to my collection"

The full shape an owner-requested card-approval flow would reuse, end to end:
1. Model calls `log_cards` (or a new tool) with `dry_run: true` (or omitted) →
   runs immediately, unheld, returns a real preview summary + (optionally) a
   `showScreen` cardGrid panel showing exactly which cards/quantities.
2. Model calls the same tool with `dry_run: false` → SDK holds it,
   `tool-approval-request` fires.
3. Client shows the existing alertdialog with the real dry-run's `summary`
   already visible (or, if extended, the `cardGrid` screen from step 1 shown
   inline as the "here's what I'll add" preview — see §B.3's note that no
   distinct "preview" visual treatment exists yet for a screen).
4. Accept → `approvalReplayPart(a, true)` → real write executes → server's own
   execute wrapper emits the `ok` chip with the real (post-write) summary.
5. Deny → `approvalReplayPart(a, false)` → nothing written, model told why.

### C.6 The rip/scan commit flow — a related but distinct pattern, not the same mechanism

`ripCommit.ts`, `ripPresence.ts`, `ripSession.ts` are the **booster-pack
scanner**'s state machine and commit path — genuinely useful prior art for
"batch write UX" but **not** wired to Deck-E's chat approval gate:
- `ripSession.ts` — pure state machine turning noisy per-frame scanner matches
  into a deduplicated list of `RipEntry` (cardId, quantity, variant), with a
  "departure-then-return" dedup rule (a card must leave the frame before being
  re-counted) and reader-editable quantity/variant per row.
- `ripCommit.ts` — `commitRip(entries, note?)` resolves each entry's variant
  (falls back to the catalog's primary variant), then writes **everything in
  one request** to `api.collectionBatch`, with an idempotency key derived from
  the *resolved* items (`variantId × delta`, sorted) so a retried/partial
  batch can't double-apply. This "resolve everything, then one atomic batch
  write" idea and the idempotency-key derivation are the reusable pattern for
  a chat-driven multi-card write; the actual gating (dry-run/approval) is
  absent here because this flow has a human directly operating a scanner UI
  with an explicit "commit" button, not a conversational agent asking
  permission — there is no SDK `needsApproval` hold in this path at all.
- `ripPresence.ts` — has the character fly over to watch the scan and react
  per-card-landed (`reactToPull`); not relevant to chat rendering.

---

## D. The design system

### D.1 Token source of truth

**One file:** `apps/web/src/theme.css`. Tailwind v4, CSS-first — no
`tailwind.config.*` anywhere in the repo. An `@theme static { ... }` block
declares color/radius/shadow/typography/breakpoint tokens as CSS custom
properties (`static` forces every token to emit a utility class even if
unused). Z-index is a **separate**, plain `:root { }` block outside `@theme`
(Tailwind has no z-index token concept), consumed via arbitrary-value
utilities (`z-[20]`, or the newer `z-(--z-modal)` var-syntax — both forms
appear, e.g. `Sheet.tsx:264` uses `z-(--z-modal)`).

> Note: `DESIGN-SYSTEM-AUDIT.md`/`DESIGN-SYSTEM-PLAN.md` (root, read in full
> per the task) describe an **earlier color skin** (blue/gold, Inter font,
> `#15181f` surfaces) that has since been replaced by the current stone/cyan
> skin quoted below (confirmed live in `theme.css` today: stone surfaces,
> Figtree + Fraunces fonts, cyan/pink/amber brand scales). The audit's
> *structural* findings (no spacing scale, no light theme, primitive/gap
> inventory, tooling) are still accurate as descriptions of the mechanism;
> its literal color/font values are stale. The plan additionally describes a
> **proposed, not-yet-built** `/design` route + change-request editor —
> confirmed not present in the current route tree; only the **`design-requests/`
> queue directory and its skill exist and are live** (§D.7).

### D.2 Full current token inventory (quoted from `theme.css`)

**Brand scales** (raw Tailwind hue ramps, 50–950 each; not consumed directly,
only through semantic tokens below): `--color-brand-primary-*` (cyan, e.g.
`400: #00d3f3`), `--color-brand-secondary-*` (pink, `400: #fb64b6`),
`--color-brand-tertiary-*` (amber, `400: #ffb900`).

**Surfaces** (Tailwind stone scale — warm grey), `theme.css:64-76`:
```
--color-surface-primary: #1c1917       --color-surface-quaternary: #57534d
--color-surface-secondary: #292524     --color-surface-raised: #79716b
--color-surface-tertiary: #44403b      --color-surface-control-active: #a6a09b
--color-surface-tertiary-subtle: rgb(68 64 59 / 0.2)
--color-surface-tertiary-transparent: rgb(68 64 59 / 0.5)
--color-surface-profile-card: #44403b  --color-surface-on-light: #f5f5f4
--color-surface-on-light-border: #d6d3d1   --color-surface-on-light-text: #292524
--color-surface-footer: #292524
```

**Text/links**, `theme.css:84-90`:
```
--color-text-primary: #ffffff      --color-text-muted: #8b847e
--color-text-body: #cac6c4         --color-text-primary-on-dark: rgb(255 255 255 / 0.85)
--color-text-secondary: #a49e98    --color-link: var(--color-brand-secondary-400)
                                    --color-link-hover: var(--color-brand-secondary-300)
```
(Text greys were re-derived in OKLCh to match stone's hue at the exact same
lightness as an earlier blue-cool palette — see the file's comment,
`theme.css:78-83`, for why "nothing got lighter or darker, only the hue
moved.")

**Actions**, `theme.css:97-124`:
```
--color-action-primary: var(--color-brand-primary-400)
--color-action-primary-hover: var(--color-brand-primary-500)
--color-action-primary-text: var(--color-brand-primary-950)
--color-action-primary-strong: var(--color-brand-primary-300)
--color-action-primary-strong-hover: var(--color-brand-primary-400)
--color-action-primary-strong-text: var(--color-brand-primary-950)
--color-action-default: #292524          --color-action-default-hover: #44403b
--color-action-default-text: #ffffff
--color-action-ghost-border: #44403b     --color-action-ghost-hover: #292524
--color-action-ghost-text: #a6a09b
--color-action-danger: #fb2c36           --color-action-danger-hover: #e7000b
--color-action-danger-text: #ffffff
--color-action-brand: var(--color-brand-primary-400)   /* external/commerce actions */
--color-action-brand-text: var(--color-brand-primary-950)
```

**Status/feedback**, `theme.css:127-145`:
```
--color-success: #00d492            --color-error: #ff6467
--color-change-positive: #00bc7d    --color-change-negative: #fb2c36
--color-change-positive-label: #a4f4cf   --color-change-negative-label: #ffc9c9
--color-halo-success: rgb(0 212 146 / 0.1)   --color-halo-error: rgb(255 100 103 / 0.1)
--color-halo-neutral: rgb(0 211 243 / 0.1)
--color-overlay-scrim: rgb(52 47 45 / 0.7)   --color-overlay-scrim-strong: rgb(26 23 22 / 0.75)
--color-overlay-ring: rgb(0 211 243 / 0.2)   --color-overlay-ring-error: rgb(255 100 103 / 0.2)
--color-banner-gradient-top: rgb(38 34 33 / 0.8)
--color-track-subtle: #201c1b
```

**Borders/icons**, `theme.css:148-157`:
```
--color-border-default: #57534d     --color-icon-default: #8b847e
--color-border-focus: #a6a09b       --color-icon-hover: #ffffff
--color-divider-subtle: #44403b     --color-icon-muted: #756e68
--color-avatar-ring: #57534d        --color-icon-muted-strong: #534f49
                                     --color-icon-disabled: #534f49
                                     --color-icon-disabled-strong: #322d2b
```

**Brand/pro/promo**, `theme.css:160-165`: `--color-pro-pink` (brand-secondary
-600), `--color-pro-pink-text: #ffffff`, `--color-completion-grandmaster`
(brand-tertiary-400), `--color-glow-active` (brand-primary-400).

**Energy-type colors** (11, `theme.css:168-178` — NOT promoted from
`EnergyIcon.tsx`'s in-JS palette, per audit §1.5, still true today):
`grass #5fb85f, fire #e8703a, water #4a97d6, lightning #f2c518, psychic
#a45cb0, fighting #c06a3a, darkness #4b5566, metal #8b95a6, fairy #e58bb8,
dragon #c6a23e, colorless #d6d2c6`.

**Warning**: `--color-warning: #ff8904` (`theme.css:181`) — note this
contradicts the audit's claim that no warning token exists; it has since been
added.

**Variant accents** (owned-badge/legend), `theme.css:193-197`:
```
--color-variant-normal: #e7e5e4 (stone-200)
--color-variant-reverse-holo: var(--color-brand-primary-400)
--color-variant-holofoil: var(--color-brand-secondary-400)
--color-variant-other: #b2ada9
```
Plus matching **gradients** (outside `@theme`, on a bare `:root`, because a
gradient is invalid as a Tailwind color-utility value): `--gradient-variant-
normal/reverse-holo/holofoil/other` (`theme.css:264-277`).

**Radii**, `theme.css:199-204`: `sm 4px, md 6px, lg 8px (DEFAULT), xl 12px,
2xl 16px, full 9999px`.

**Elevation (shadows)**, `theme.css:207-209` — exactly 3, still the entire
system:
```
--shadow-elevated: 0 16px 24px rgb(0 0 0 / 0.25)
--shadow-panel: 0 8px 12px rgb(0 0 0 / 0.25)
--shadow-sticker: 4px 4px 4px 4px rgb(0 0 0 / 0.25)
```
(Buttons additionally use hand-authored multi-layer `box-shadow` stacks for
convex/concave "physical button" treatment — `.btn-fill-*` classes,
`theme.css:378-462` — not tokenized, see D.5.)

**Typography**, `theme.css:220-246`:
- Families: `--font-sans: 'Figtree Variable', ui-sans-serif, system-ui,
  sans-serif` (body/UI); `--font-display: 'Fraunces Variable', Georgia, 'Times
  New Roman', serif` (proper nouns / headings — applied automatically to
  `h1,h2,h3` and via `.font-display` opt-in elsewhere, `theme.css:479-486`).
- 12 size steps, each paired with its own line-height (Tailwind v4's native
  size+leading pairing mechanism):
  ```
  3xs 9px/15px   2xs 10px/15px   xs 11px/16.5px   sm 12px/18px
  md 13px/16.25px   base 14px/21px   lg 15px/22.5px   xl 16px/24px
  2xl 18px/27px   3xl 24px/36px   4xl 32px/40px   5xl 48px/58px
  ```

**Motion**: `--ease-standard: ease` — literally the only easing token; the
file's comment (`theme.css:248-249`) says this is deliberate ("only these
exist"). No `--duration-*` tokens exist at all — all durations are inline
magic numbers in `@keyframes`/`transition` declarations (e.g. `150ms`,
`180ms`, `200ms`, `220ms`, `280ms`, `320ms` scattered through `theme.css`'s
sheet/chat animation rules, none tokenized).

**Breakpoints**: `--breakpoint-gap: 567px`, `--breakpoint-nav: 1068px`
(`theme.css:252-253`) — "1068 is the ONE real one" per the file's own comment;
consumed as the `nav:` Tailwind variant prefix throughout (e.g.
`DeckeChat.tsx`'s `nav:inset-x-auto`).

**Z-index layers** (plain `:root`, `theme.css:280-290`):
```
--z-art: -1        --z-popover: 13
--z-base: 0        --z-chrome: 20
--z-raised: 5      --z-modal: 100
--z-sticky: 8      --z-toast: 9999
--z-overlay: 10
```
DeckeChat's own stacking is *not* drawn from this scale — it hardcodes
`z-[15]`/`z-[24]`/`z-[25]` for its scrim/panel (documented rationale in the
file's header, `DeckeChat.tsx:34-39`, as sitting deliberately between chrome
(20) and modals (100)); the 3D canvas is `z-30`, speech bubble `z-31` — none
of these numbers exist in the `--z-*` scale, i.e. Deck-E's own stacking
context is an undocumented fifth layer interleaved with the app's 9-layer
scale, worth flagging for anyone touching chat z-index.

**No spacing scale** — confirmed still true: no `--spacing-*` token anywhere
in `theme.css`; every gap/padding/height in the codebase (including all of
`DeckeChat.tsx`) is an arbitrary-pixel Tailwind utility (`px-[16px]`,
`gap-[8px]`, etc.).

### D.3 Light/dark theming mechanism

**Dark-only, by design, no light theme exists.** `theme.css`'s own header
(lines 8-12) states it: `"Dark-only theming (UI-SPEC §2): pkmnDark is the only
scheme shipped; the data-theme="dark" attribute on <html> is the
machine-readable switch."` No `@media (prefers-color-scheme)` branching exists
for color tokens. The only "light" tokens are the `--color-surface-on-light-*`
trio, used for real-world white objects rendered on the dark theme (a sign-in
card, a white set-symbol tile) — not a theme-switching mechanism.

### D.4 UI primitives inventory (`apps/web/src/components/ui/`)

One line each, current actual prop surfaces read from source (supersedes the
stale audit inventory, which pre-dates several of these):

| File | What it is |
|---|---|
| `Button.tsx` | The one shared button. `variant: primary\|secondary\|danger\|ghost\|dashed`, `size: sm\|md\|lg`, `loading` (renders inline `Spinner`, disables). Also exports `buttonClass()` for non-`<button>` elements (Links) needing the same look. Filled variants use `.btn-fill-*` convex/concave shadow classes from `theme.css`. |
| `Sheet.tsx` | The one modal/overlay primitive — bottom sheet on phone, centered dialog `nav:` up. Portal to `document.body`, focus trap, Escape-to-close with exit animation, scroll-lock (ref-counted, **shared** with `DeckeChat.tsx` via exported `lockScroll`/`unlockScroll` — see the file's comment on why a second independent lock would race). `size: sm\|md\|lg\|full`. `headerSlot` override, `footer` slot pinned below scroll. |
| `CounterBox.tsx` | Tap=+1 / long-press or right-click=-1 count box for a card variant. Dedupe of a former byte-identical duplicate in `CardTile.tsx`/`TableView.tsx`. |
| `StatTile.tsx` | Stat display, `variant: bare\|boxed\|card`; `money` flag colors the value green; `card` variant accepts `children` for rich bodies. |
| `Progress.tsx` | `ProgressBar` (linear, `pct`, `height`, `fill`, `milestones[]`, `milestonePassed`) and `ProgressRing` (circular) — both use `--color-track-subtle` for the track. |
| `EmptyState.tsx` | Icon + title + optional body + optional CTA slot, `variant: dashed\|plain`. |
| `SelectableCard.tsx` | Option-picker card, boolean `active` → gold border + opaque bg vs. translucent/hover. |
| `Tabs.tsx` | `variant: underline\|pill`, `pill` also takes `size: sm\|md`. Items render as router `Link`s (`to` prop), buttons (`onChange`), or inert spans. |
| `Field.tsx` | Labeled `<input>` with error/hint text, full aria wiring (`aria-invalid`/`aria-describedby`) — closest thing to a generic `TextInput`. |
| `FormAlert.tsx` | `role="alert"` banner, `kind: error\|info\|success`, uses the `--color-halo-*` tokens. |
| `StatusPanel.tsx` | Terminal-state card: haloed icon + title + body + actions, `tone: success\|neutral`. |
| `HighlightRing.tsx` + `elementHighlight.ts` | **The "this is the thing being talked about" primitive** — see D.6, directly relevant to the tool-chip complaint. |
| `DeckeBeacon.tsx` | Off-screen indicator chip for the 3D character (a ring+pointer with nothing drawn inside — the WebGL canvas renders the character into the hole). Character-specific, deliberately has no gallery entry. |
| `useDismiss.ts` | Outside-click + Escape dismissal hook, returns a ref. |
| `*.gallery.tsx` files | Co-located catalog/demo files for the (not-yet-built, per D.7) `/design` route's component gallery — present today even though the route that would consume them isn't. |

### D.5 The "physical button" shadow system (relevant if chips get button-like treatment)

`theme.css:378-462` documents a deliberate convex/concave shading system for
filled buttons: primary/danger are domed (light-to-dark fill, inner top
highlight, bottom occlusion), secondary is dished/concave (inverted: dark rim
shadow at top, light pooling at bottom). Both share the same *outer* elevation
shadow pair (`inset 0 1px 0 rgba(255,255,255,.4), inset 0 -2px 3px
rgba(0,0,0,.18), 0 1px 2px rgba(0,0,0,.35), 0 5px 10px -4px rgba(0,0,0,.45)`)
— only the inner shadows and gradient direction differ. Worth knowing if a
tool chip is redesigned as an actual pressable control rather than a static
pill: this is the system's established "raised, pressable thing" visual
language, distinct from `HighlightRing`'s "this is what's being discussed"
language.

### D.6 `HighlightRing` / `elementHighlight.ts` — the "highlightable, not a pill" primitive

`apps/web/src/components/ui/elementHighlight.ts` (imperative) +
`HighlightRing.tsx` (declarative wrapper) is an existing, general-purpose
design-system primitive built specifically to say **"this is the thing being
talked about"** without a static badge/pill treatment:

- Draws a **chasing, multi-hue animated border** (cyan → pink → amber, the
  product's own three brand scales, not a literal rainbow) as an absolutely
  positioned overlay sibling — never a class on the target element — so it
  works on elements the module has never seen, including ones inside
  `overflow: hidden` or with their own borders/border-radius.
- Deliberately unlike every static UI state (focus/selection/error/hover are
  all static borders in this system) specifically so a chasing edge reads as
  *"something agentic is happening here"* and can't be confused with a normal
  interactive state.
- **Singleton, app-wide** — only one element is ever ringed at a time
  (enforced in the imperative layer), because two rings would read as a
  multi-select, a different idea.
- Imperative form (`highlightElement(selector, opts)`) is the *primary* API,
  used exactly this way already by Deck-E's own `flyTo`/`highlight` tools
  (`uiTools.ts:203-239`) to ring page elements he points at.
- `HighlightRing.tsx`'s own header states it is a **design-system primitive
  first, Deck-E feature second**: "Deck-E is its first caller and will not be
  its last."

This is a direct, already-built match for the owner's stated preference —
"highlightable, but not a pill by default" — for the tool-chip redesign: the
chip's resting state could be plain text/inline (not a pill), and
`highlightElement`/`HighlightRing`'s existing chasing-border treatment is the
established system-wide way to mark "this is active/being referenced" without
introducing a new visual language.

### D.7 `design-requests/` — the change-request queue and its protocol

**Directory exists and is live** (currently empty in all four subdirectories):
`design-requests/queue/`, `working/`, `done/`, `failed/` — gitignored per
`DESIGN-SYSTEM-PLAN.md`. The consumer skill,
`.claude/skills/design-requests/SKILL.md`, documents the full protocol:

1. **Safety checks first**: confirm running in the `design-system` worktree
   (not the main checkout) and that `curl localhost:5199/__design/health`
   reports the matching worktree path — **this implies a `/design` route and
   a `/__design/*` Vite dev-server-plugin endpoint set that the plan
   describes but this research did not find registered in the current route
   tree** (not found under `apps/web/src/routes/` or `main.tsx` in the files
   read for this task) — i.e. `DESIGN-SYSTEM-PLAN.md` is a **proposal**, and
   the skill + empty queue directories are the only parts actually built so
   far.
2. **Claim**: move the oldest `queue/<id>.json` to `working/<id>.json`.
3. **Request shape**: `{ id, kind, target, intent, context: { component,
   source, section, currentKnobState?, activeTokenOverrides? }, createdAt,
   status }`.
4. **Apply with judgment** — explicitly framed as "genuine reasoning work, not
   template substitution" (default-prop edit, new variant, token promotion,
   or multi-file change, per the intent). Restricted to editing under
   `apps/web/src/` (theme.css included, since it lives there too); never
   `git commit` — the owner reviews via `git diff`.
5. **Result**: write `done/<id>.json` (or `failed/<id>.json`) — original
   request fields plus a nested `result: { summary, filesChanged[],
   startedAt, finishedAt, agent }` — then delete the `working/` copy.

This queue+skill protocol is a plausible transport for anything a design
implementation plan wants to hand off as "agent, please extract/restyle this
component" work, separate from whatever gets implemented directly.

---

## E. Card imagery — sourcing pipeline for an inline card-row widget

### E.1 The rendering primitive: `apps/web/src/components/CardImage.tsx` (full file, 47 lines)

```tsx
export function CardImage({
  low, high, alt, eager = false, className = '', radius = 8,
}: { low: string; high: string; alt: string; eager?: boolean; className?: string; radius?: number }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative w-full overflow-hidden bg-surface-tertiary ${className}`}
         style={{ aspectRatio: '245 / 337', borderRadius: radius }}>
      {!failed && (
        <img src={low} srcSet={`${low} 245w, ${high} 600w`}
             sizes="(min-width: 1068px) 208px, 45vw"
             alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async"
             onError={() => setFailed(true)}
             {...(eager ? { fetchPriority: 'high' as const } : {})}
             className="absolute inset-0 h-full w-full object-cover"
             style={{ borderRadius: radius }} />
      )}
    </div>
  )
}
```

Props: `low` (required, 245px-wide URL), `high` (required, 600px-wide URL,
used in `srcSet` for high-DPI/large layouts), `alt`, `eager` (controls
`loading`/`fetchPriority`), `className`, `radius` (px, default 8). Fixed
aspect ratio `245/337` reserved before any byte arrives (no layout shift); on
`<img>` error the `<img>` is hidden entirely so the `bg-surface-tertiary` box
reads as the intended skeleton rather than a broken-image glyph — this is
already exactly the placeholder-safe behavior an inline chat card row would
want.

**This is already the component `DeckeScreen.tsx`'s `cardGrid` block uses**
(`DeckeScreen.tsx:280-286`, `<CardImage low={found.front} high={found.frontLarge
?? found.front} alt={found.name ?? id} radius={6} />`) — so an inline
card-row widget in chat can reuse `CardImage` directly with zero new
plumbing; the pattern is proven in exactly the surface being extended.

### E.2 Resolving catalog ids to art: `apps/web/src/character/decke/cardSource.ts` + `cardArt.ts`

`cardSource.ts` is, per its own header, "the one file in this character that
knows DeckPal exists" — it turns catalog ids into `CardArt` objects by calling
the real API, and deliberately never throws for an unresolvable id (`toArt`
returns `null`, callers keep the id-as-text fallback). Relevant exports:

```ts
export type CardArt = { id: string; front: string; frontLarge?: string; name?: string }

// Resolve catalog card ids to art, in the order asked for. A `null` entry
// means "this id does not resolve" (as opposed to still-loading, `undefined`).
export async function artForIds(ids: string[]): Promise<(CardArt | null)[]>
```
(`cardArt.ts:1-45` is the doc header explaining the 3D-specific texture
concerns — not relevant to a 2D chat widget beyond confirming `front`/
`frontLarge` map to the catalog's `images.low`/`images.high` fields.)

`DeckeScreen.tsx`'s `useCardArt(ids)` hook (`DeckeScreen.tsx:337-362`) is the
existing consumption pattern: joins `ids` into a stable key (avoids re-fetch
on every re-render from a fresh array literal), calls `artForIds`, keys the
result by id, treats fetch failure as "draw the ids as text" rather than an
error state. **This hook is the direct template for an inline card-row/
approval-preview widget's own data-fetching** — no new API surface is needed,
only a new consumer of `artForIds`/`CardImage` with different layout (a
horizontal row with names/variants, per the owner's ask, vs. the existing
grid).

### E.3 What a card-row-with-names-and-variants widget would need beyond what exists today

- `CardArt` carries `name` already (diagnostic-only today, "nothing renders
  it" per `cardArt.ts`'s own comment) — trivially promotable to a visible
  label under/beside each thumbnail.
- **Variant name is not part of `CardArt` or `artForIds`'s resolution at
  all** — variant selection/display exists only in the unrelated rip/scan
  flow (`RipVariant { variantId, displayName, isPrimary }`,
  `ripSession.ts:34-39`), which pulls from `api.card(cardId).variants`
  (`ripCommit.ts:52-53`). A card-row widget wanting to show "which printing"
  would need to fetch/attach variant data the way `ripCommit.ts` does
  (`card.variants.find(v => v.isPrimary)`), since `cardSource.ts`'s
  `toArt()`/`artForIds()` path does not currently surface it.
- No existing "row" layout variant exists anywhere in the character/chat code
  — `DeckeScreen`'s `cardGrid` is always a CSS grid (`grid-cols-2` dense /
  `grid-cols-3 nav:grid-cols-4` normal); a horizontal scrolling row would be
  new layout, though it would compose the same `CardImage` + `artForIds` pair.

---
