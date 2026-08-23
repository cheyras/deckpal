# The segmented approval card: a commit protocol

**Status:** design note, for an implementer and a security reviewer.
**Branch:** `decke-experience-pass` (read-only for this note; nothing in the repo was modified).
**Verified against:** working tree at `34d3914`, `ai@7.0.66` as installed in `node_modules/ai`.

---

## 0. Corrections to the brief, before anything is built on it

Every one of these was read in the source rather than assumed, and three of them
change what the options are worth.

| Claim in the brief | What is actually there |
|---|---|
| pinned `ai@7.0.58` | **`ai@7.0.66`.** `package.json:32`, `apps/api/package.json:28`, `pnpm-lock.yaml:1954`. Every comment in this repo already says 7.0.66. The signing substance is unchanged. |
| signing at `dist/index.js:5085-5097` | Payload builder at `dist/index.js:5073-5083`; `signToolApproval` at `5091-5104`; `verifyToolApprovalSignature` at `5106-5130`. |
| `HMAC(approvalId, toolCallId, toolName, hashCanonical(input))` | Correct, and the payload is `JSON.stringify(["ai-sdk-tool-approval-v1", approvalId, toolCallId, toolName, inputDigest])` (`5073-5083`). A **legacy newline-joined payload is still accepted on verify** (`5084-5090`, tried at `5120-5128`). Anyone re-signing owns *two* formats. |
| — | **No signing helper is exported.** `signToolApproval` / `maybeSignApproval` / `hashCanonical` are module-internal; the public export list (`dist/index.js:18280-18410`) carries only `InvalidToolApprovalError`, `InvalidToolApprovalSignatureError`, `ToolCallNotFoundForApprovalError`. This is the fact that prices option (b). |
| — | **`experimental_refineToolInput` exists** (`dist/index.js:3919-3928`, wired at `3844-3898`) and rewrites a tool call's input *before* the approval is signed. It looks like approve-with-modification and is not: it runs inside `parseToolCall`, i.e. only on a call the model just emitted, never on a call resumed from message history. It cannot carry a choice the user has not made yet. |
| — | **`toolApproval` is a server-side veto on the return leg** (`dist/index.js:4062-4113`, consumed by `validateApprovedToolApprovals` at `5201-5219`). It can turn an approved call into a denied one. It **cannot** modify input. Useful as defence in depth; not a modification channel. |
| — | **A denial carries a `reason` into the model's context as a real tool result.** `dist/index.js:5469-5486` emits `{type:'tool-result', output:{type:'execution-denied', reason}}`; `reason` survives `convertToModelMessages` at `1625-1632`. This is the load-bearing fact the brief omits, and it is what makes option (a) capable of being *truthful* rather than merely convenient. |
| plan option (c): "the segmented card renders from the dry run, which runs unheld" | **There is no guaranteed dry run any more.** `apps/api/src/decke/prompt.ts:462-469` now says *"Call the tool. The asking is automatic"*, and the 2026-08-22 decision records a test that asserts the **absence** of "Preview first" and "in numbers, and wait". Option (c) as written depends on a behaviour the previous fix deliberately removed. Its salvageable half is below. |
| — | `previewOf()` (`apps/web/src/character/host/DeckeChat.tsx:173-180`) returns the last `ok` chip summary from the last message that has any chip. It is **not keyed to the held call**, so on a turn where a read tool ran after the write was held it shows the wrong preview. Latent bug; the design below removes it. |
| — | **Closing the chat neither settles nor aborts an open approval.** `DeckeHost.tsx:447` only flips `chatOpen`; the abort listener at `useDeckeChat.ts:217-223` fires only from `stop()`. The turn parks for the life of the page, `busy` stays true and `thinking` stays sustained. Pre-existing; named again in §5. |

---

## 1. The problem, precisely

The owner wants one card, two sections, one **Accept**:

1. rows whose printing is known — plain, each with a "that's wrong" removal;
2. rows whose printing is genuinely unknown — each with an inline picker;

and **Accept commits section 1 even if a section-2 row is left unpicked**.

All three of per-row removal, per-row variant choice, and partial commit change
*what gets written*. The current protocol cannot express any of them.

**The verdict is one boolean, for the whole batch.**
`apps/web/src/character/host/useDeckeChat.ts:159-166`:

```ts
resolve?.(new Map(list.map((a) => [a.approvalId, approved])))
```

Every pending approval in the turn is resolved to the same value. There is no
per-row anything, because a row is not a unit the protocol knows about — the
unit is a tool call.

**The replay is the original input, verbatim.**
`apps/web/src/character/host/approval.ts:162-185` replays `input: a.input`, plus
the signature.

**And the input is cryptographically bound.** The SDK signs
`["ai-sdk-tool-approval-v1", approvalId, toolCallId, toolName, hashCanonical(input)]`
at hold time (`ai/dist/index.js:5073-5104`) and verifies over the input taken
from the replayed history (`5161-5185`). Editing `input` client-side does not
"probably" fail; it fails by construction, with
`InvalidToolApprovalSignatureError`, and the turn dies. That binding is the fix
for a shipped bug (DECISIONS 2026-08-22, "The approval signature") and it stays.

So: **a single held tool call cannot carry a user-edited batch.** Any design
either does not edit, or disposes of the held call and commits elsewhere. The
plan's hand-wave — "reuse `ripCommit.ts`'s batch path" — chose the second half
and skipped the disposal, which leaves the held write undisposed: approve it and
you double-write, deny it and the model is told nothing happened while a write
occurred.

### 1b. The classification blocker

The plan's `variantSource: 'stated' | 'defaulted' | 'ambiguous'` keys on
resolution status. `pickVariant` (`packages/agent-tools/src/resolve.ts:329-361`)
returns `status: 'ok'` for an omitted variant on a multi-variant card — it
silently takes `isPrimary ?? all[0]`. So the row the owner most wants asked about
would be labelled `defaulted` and filed under "known". `status: 'ambiguous'` is
raised only for absolute-quantity writes on a card with more than one *owned*
variant, which is a different and much narrower condition.

Classification must key on **candidate count**, not on status. And per the plan's
own constraint, `pickVariant`'s semantics must not change: `add_cards`
(`packages/agent-tools/src/tools/lists.ts`) and every non-Deck-E caller depend on
the silent primary default, and turning those into errors is a regression outside
this pass.

---

## 2. Options, costed

Shared assumptions: a turn already reserves a leg for the answer
(`mayAskApproval` / `legBudget`, `approval.ts:205-250`); the collection write
endpoint `POST /collection/batch` is already reachable from the browser with the
user's own JWT under RLS (`apps/web/src/lib/api.ts:899-902`, used by
`ripCommit.ts`).

### (a) Deny the held call with a structured reason; commit the corrected batch client-side

The client performs the corrected write itself, then settles the held call
`approved:false` with a `reason` describing what really landed.

- **Latency:** one browser→API round trip (~a few hundred ms; `/collection/batch`
  is one transaction for the whole batch — that is why it exists,
  `apps/api/src/routes/collection.ts:207-238`), then the ordinary replay leg.
- **Legs:** unchanged. One approval-replay leg, already reserved.
- **UX:** exactly the owner's ask. One card, one Accept, no second dialog.
- **Security:** the signature is untouched and the held call is **not executed** —
  that is enforced by the SDK, not by our care. The corrected write is a
  different write, originated by the user's direct UI action, through an endpoint
  the browser is already entitled to, under the same RLS. No new authority is
  granted to the model or to the page.
- **Truthfulness:** this is where it is won or lost, and the SDK makes it
  winnable: `reason` becomes a real `tool-result {type:'execution-denied',
  reason}` in the model's context (`ai/dist/index.js:5469-5486`). "This call did
  not run; here is what did, with the numbers" is a *true* account of both facts.
  Getting the ordering wrong (deny before commit) turns it into a claim about a
  write that may not have happened, which this codebase ranks as the worst
  available failure.
- **Risk:** medium. The failure modes are real (§5) and every one of them has a
  named, testable defence. The client gains a second write path into the
  collection, which must be constrained (the narrowing rule, §3.5).

### (b) Server-side approve-with-modification: re-validate and re-sign

**Can pinned `ai@7.0.66` express this? Not through its public API.** Read, not
assumed:

- `signToolApproval` and `maybeSignApproval` are internal (`dist/index.js:5091`,
  `5131`); the export list at `18280-18410` contains no signing helper.
- `experimental_refineToolInput` rewrites input *before* signing but only inside
  `parseToolCall` (`3844-3898`), i.e. only for a call the model just emitted. A
  call resumed from history goes straight to `collectToolApprovals` →
  `validateApprovedToolApprovals` → execute (`2856-2929`, `5143-5225`). Refinement
  never runs on it.
- `toolApproval` (`4062-4113`, `5201-5219`) can *deny* an approved call on the
  return leg. It cannot change its input.

So (b) means: `/api/chat` intercepts the replayed UI message, re-validates the
edit against a server-side policy, rewrites the tool-call part's `input`, and
recomputes the signature **with our own reimplementation of an unexported,
unversioned SDK payload format** — including the legacy variant, because verify
tries both.

- **Latency / legs / UX:** best of all options — one held call, one Accept, one
  leg, the write executes server-side through `log_cards` with all its
  bookkeeping intact (idempotency, batch id, progress recompute, revert offer).
- **Security:** the signature stops being a binding and becomes a *server
  attestation of its own decision*. That is not automatically worse — if the
  re-validation is a genuine monotone-narrowing check, the property "the client
  cannot escalate the write" still holds. But the property changes from "checked
  by a primitive" to "checked by code we wrote", and the difference is the whole
  reason the primitive was turned on.
- **Risk: high, and the risk is the exact class this repo has already been
  burned by.** An `ai` upgrade that changes the payload (it has already changed
  once — hence the legacy branch) silently invalidates every signature we mint.
  The failure mode is *every approved write fails*, which is verbatim the
  2026-08-22 incident. And there is no exported verifier to pin our copy against,
  so the only honest test is an end-to-end probe against a live deployment.
- **Verdict:** do not ship this to buy a UI affordance. Reconsider only if a
  future `ai` exports the signing helpers or a first-class
  "approve-with-modified-input" response.

### (c) Resolve ambiguity before the real call exists

As written in the plan — card renders from the model's own unheld dry run, picks
go back as a normal user turn, model re-calls fully resolved — this is **not
viable on this branch**:

- There is no guaranteed dry run. `prompt.ts:462-469` tells him to call the tool;
  the "Preview first" sentence was deleted on 2026-08-22 *because it stopped him
  calling at all* (0/15 → 21/30), and a test asserts its absence.
- Sending the picks back as a turn is a prose confirmation round trip in
  everything but name, and re-creates the "never end a turn with *Confirm?*"
  hazard from the other side.
- Cost: +2 legs per write, +2 model latencies, and the model may not re-call.

**But half of it is the right answer, and it is available without the model.**
`tool.onInputAvailable` is a public tool option
(`@ai-sdk/provider-utils/dist/index.d.ts:1871-1873`) and the SDK **awaits it
immediately before it decides on approval and signs**
(`ai/dist/index.js:5740-5766`). So the *server* can run the preview, deterministically,
for every held write, with no prompt change, no extra leg, and no model
involvement — and the rows it produces come from the real handler, which is the
same provenance rule the chips already satisfy. That is `(c′)` and it is part of
the recommendation.

- **Latency:** one `planBatch` (2 queries — 59 ms for 99 cards, per
  `logging.ts:40-46`) plus one `dryRun` POST to `/collection/batch` (returns
  before COMMIT, `apps/api/src/routes/collection.ts:472-480`). Call it 100–400 ms,
  spent while the model is still streaming, before the user has anything to answer.
- **Legs:** zero extra.
- **UX:** the card is populated the moment it appears. No spinner, no "he forgot
  to narrate it" hole (which `previewOf` exists to patch and patches badly).
- **Security:** neutral. It runs the same handler with `dry_run` forced by
  `forcePreview` (`aisdk.ts:240-246`), through `withToolCtx`, so the RLS session
  is opened and released inside the call and no connection is held across the
  stream (`api/chat.mjs:25-38`, contract B2).

### (d) Consent-binds-args: auto-settle only on exact match

The client compares the item list the user accepted with the held call's input
and settles `approved:true` **only on an exact match**.

On its own this is not a feature — it grants no editing at all. It is a
*correctness property*, and it is the one that keeps (a) honest: it makes
"approve the held call" and "the user accepted exactly this" the same statement,
which is precisely what the HMAC binds. Use the same notion of equality the
signature uses (canonical JSON, keys sorted — `ai/dist/index.js:5031-5046`) so
the predicate and the primitive cannot drift.

- **Cost:** a few dozen lines of pure, testable code.
- **Verdict:** not an alternative. A component, and a mandatory one.

### Recommendation

**(c′) + (d) + (a), in that order of precedence.** Concretely:

- the card is populated by a **server-run preview at hold time** (c′);
- **Accept with no edits settles the held call `approved:true`** — today's path,
  today's signature, today's `log_cards`, byte for byte — guarded by an exact
  canonical match (d);
- **Accept with edits** never touches the held call's arguments: it commits the
  corrected batch from the browser and then disposes of the held call as a denial
  whose `reason` carries the real result (a).

Why this and not (b): the common case — the owner's own stated case, "if it's
truly high confidence I don't want the user to feel like they have to pick a
variant again" — is the *unedited* case, and under this design it runs down the
existing, proven, signed path with nothing new in it. The new machinery is
confined to the path where the user actually corrected something, which is where
a second write path is defensible because the user is the author of it. (b) would
buy a marginally tidier edited path by putting a hand-rolled copy of an internal
crypto format in front of *every* write, including the common one.

---

## 3. The recommended design, end to end

### 3.1 The new dry-run row fields, and where they come from

A new **pure** function in `packages/agent-tools/src/resolve.ts`, beside
`pickVariant` and calling nothing:

```ts
/**
 * How sure are we which printing this row means?
 *
 * KEYED ON CANDIDATE COUNT, NOT ON RESOLUTION STATUS. `pickVariant` returns
 * `ok` for an omitted variant on a multi-variant card — it silently takes the
 * primary — and that row is exactly the one a person should be asked about.
 * A NEW field beside `pickVariant`'s answer, never a change to it: `add_cards`
 * and every non-Deck-E caller depend on that silent default.
 */
export type VariantCertainty =
  | { kind: 'stated' }                                    // variant_id or variant_kind given
  | { kind: 'only-one' }                                  // omitted, and the card has one printing
  | { kind: 'unstated';  candidates: ResolvedVariant[]; wouldUse: number }
  | { kind: 'ambiguous'; candidates: ResolvedVariant[] }  // pickVariant said so
  | { kind: 'unresolvable' }                              // card or variant did not resolve

export function variantCertainty(
  all: readonly ResolvedVariant[],
  ref: VariantRef,
  res: VariantResolution,
): VariantCertainty
```

Rules, in order — the order is the specification, because `stated` and
`all.length > 1` both hold for an explicitly-named printing:

1. `res.status === 'not_found'` (or the card never resolved) → `unresolvable`.
2. `ref.variant_id != null || ref.variant_kind != null` → `stated`. **Section 1.**
3. `all.length === 1` → `only-one`. **Section 1.**
4. `res.status === 'ambiguous'` → `ambiguous`, `candidates = res.variants`. **Section 2.**
5. otherwise (omitted, `all.length > 1`, silently resolved to primary) →
   `unstated`, `candidates = all`, `wouldUse = res.variant.id`. **Section 2.**

`log_cards`' planner (`packages/agent-tools/src/tools/logging.ts:282-303`) calls
it right after `pickVariant` and hangs the result on the row it already builds.
`pickVariant`'s return value is untouched, and a test asserts that (§6).

### 3.2 The wire shape

A new **transient** UI-stream part, written by the same layer that writes the
chips — `emitToolEvent`'s sibling in `api/chat.mjs:386-393`, fed from the adapter
in `apps/api/src/decke/adapters/aisdk.ts`:

```jsonc
{
  "type": "data-decke-approval-preview",
  "transient": true,
  "data": {
    "toolCallId": "call_a7f3",     // the join key to the approval
    "tool": "log_cards",
    "editable": true,              // false ⇒ render the plain dialog (see 3.5)
    "rows": [
      {
        "index": 0,                        // index into the HELD call's input.items
        "cardId": "me05-84", "cardName": "Pitch Black", "setId": "me05", "number": "84",
        "certainty": "unstated",
        "candidates": [
          { "variantId": 37183, "kindCode": "normal",  "label": "Normal",       "isPrimary": true,  "ownedQty": 0 },
          { "variantId": 37184, "kindCode": "reverse", "label": "Reverse Holo", "isPrimary": false, "ownedQty": 2 }
        ],
        "wouldUseVariantId": 37183,
        "mode": "delta", "value": 1,
        "before": 0, "after": 1, "clamped": false
      }
    ],
    "skipped": [ { "index": 3, "reason": "…" } ]
  }
}
```

Three things about this shape are load-bearing:

- **`index` is the join key back to `input.items`.** Without it the client cannot
  reconstruct an edited item list that is comparable to the held one, and (d) is
  unimplementable.
- **It is emitted from the adapter, never by the model** — the same rule and the
  same words as `aisdk.ts:51-64`. Every preview corresponds 1:1 to a real
  invocation of the real handler with `dry_run` forced. There is no path by which
  a model can ask for a row to appear on this card.
- **Transient**, like the chips: it is a question being asked now, not a fact the
  transcript should re-bill on every subsequent turn.

Client side, `PendingApproval` already carries `toolCallId`
(`approval.ts:60-100`), so the match is direct. `previewOf()` in `DeckeChat.tsx`
is deleted and replaced by this keyed lookup.

### 3.3 Where the preview runs

In `buildDataTools`, on the tool object:

```ts
onInputAvailable: async ({ input, toolCallId }) => {
  if (!requiresApproval(def, input)) return          // previews are not held; nothing to ask
  if (!opts.onApprovalPreview) return
  try {
    const result = await withToolCtx(opts, (ctx) => def.handler(forcePreview(def, input), ctx))
    opts.onApprovalPreview({ toolCallId, tool: def.name, ...rowsFrom(result.structured) })
  } catch {
    // A preview that fails must never take the held call down with it: the card
    // falls back to the plain dialog and the write is still approvable.
  }
}
```

- The SDK **awaits** this before `resolveToolApproval` and before it signs
  (`ai/dist/index.js:5740-5766`), so the preview always reaches the browser
  ahead of, or with, the approval request. The client must still key by
  `toolCallId` rather than assume ordering.
- It uses `forcePreview` (`aisdk.ts:240-246`), so "this is a preview" and "it
  cannot write" agree by construction, exactly as they do in `execute`.
- It uses `withToolCtx`, so one RLS session is opened and released inside the
  call. Nothing is held across the stream (`api/chat.mjs:25-38`).
- It does **not** run on the resume leg. An approved call is executed from
  `initialResponseMessages` at the top of the turn (`ai/dist/index.js:5405-5492`)
  and never re-enters the streaming parse path, so there is no duplicate preview
  and no wasted query.
- `rowsFrom` reads `result.structured` — `log_cards` already returns one
  (`ok(text, {items: […]})`, `logging.ts:527-545`), which the AI-SDK adapter
  currently discards because only `text` goes to the model. The structured echo
  finally earns its keep.

**No chip is emitted for the preview.** A chip says work happened for the reader;
this work happened *for the dialog*, and a chip for it would put "Log collection
changes — would apply 3" in the transcript beside a change that has not been
agreed to.

### 3.4 The client state, and where it must live

A new pure module, `apps/web/src/character/host/approvalEdit.ts`. This is the
single most important structural instruction in this note, and the reason is
written in `approval.ts:1-56`: the last two shipped-class bugs on this path were
invisible because the logic lived inside a React hook that does its own `fetch`
and its own `supabase.auth.getSession()`, which `node --import tsx --test` cannot
import at all. Put this in the dialog component and it will be exactly as
untestable.

```ts
export type RowChoice = { index: number; removed: boolean; variantId: number | null }

/** The item list the reader has actually accepted, in the held call's own shape. */
export function acceptedItems(held: Item[], choices: RowChoice[]): Item[]

/** The predicate (d) turns on. Canonical JSON, keys sorted — the same notion of
 *  "the same input" the SDK's own signature uses (ai/dist/index.js:5031-5046). */
export function isUnedited(accepted: Item[], held: Item[]): boolean

/** Is this edit a legal NARROWING of what was previewed? (3.5) */
export function narrowingIsLegal(accepted: Item[], held: Item[], preview: PreviewRow[]): boolean

/** The one sentence the model is told, built from the REAL batch response. */
export function correctionReason(res: CollectionBatchResponse | null, dropped: number, err?: string): string
```

The choices themselves live in the **hook**, not in `DeckeChat`, keyed by
`approvalId`. `DeckeChat` stays mounted when the panel closes
(`DeckeHost.tsx:443-457`) so component state would survive today — but that is an
accident of the current tree, and an approval half-answered is not a thing to
leave sitting on an accident.

`settle` (`useDeckeChat.ts:159-166`) gains a second parameter and stops being a
bare boolean:

```ts
type Verdict =
  | { approved: true }
  | { approved: false; reason: string }
const settle = (verdicts: Map<string, Verdict>) => …
```

Per-approval rather than per-turn. Nothing today produces more than one approval
in a turn, but the map already existed and pretending its keys were
interchangeable is what made this a one-boolean protocol in the first place.

### 3.5 What Accept does

Let `held = a.input.items` and `accepted = acceptedItems(held, choices)`.

**Path A — unedited (`isUnedited(accepted, held)`):**
settle `{approved: true}`. `approvalReplayPart` is unchanged, the signature is
carried verbatim, `log_cards` executes on the server with everything it already
does — batch id, progress recompute, the revert line, the `duplicateOf` warning.
Nothing about this path is new. It is the owner's high-confidence case and it
must stay boring.

**Path B — edited.** Two rules, both enforced in `approvalEdit.ts` and both
asserted before a byte is sent:

1. **Monotone narrowing only.** `accepted` must be a subsequence of `held` by
   `index`; for each surviving row, `mode` and `value` are **identical** to the
   held item's, and the only permitted change is setting `variant_id` to a
   `variantId` drawn from *that row's own* `candidates` list in the preview.
   Nothing may be added, no quantity may move, no card may change. An edit that
   fails this check is a bug in the UI, and it must throw rather than send.
2. **Commit first, settle second.** In that order, without exception. If the
   settle leg is lost, the worst outcome is that the model was not told about a
   real write — recoverable, and mitigated by the transcript record below. If the
   settle went first and the commit then failed, the model would have been told a
   corrected write landed when it did not, which is the unfalsifiable-in-the-
   moment failure `prompt.ts:486-494` exists to prevent.

Then:

```
POST /collection/batch
  items:            accepted rows resolved to {variantId, delta|quantity}
  source:           'deckpal-web'
  note:             'Deck-E — corrected before applying'
  idempotencyKey:   derived from the RESOLVED items, as ripCommit.ts:76-82 does
  requestFingerprint: the unbucketed content hash, so the server's duplicateOf
                      warning can still fire (routes/collection.ts:363-366)
```

then settle `{approved: false, reason: correctionReason(res, dropped)}`.

**`editable: false`.** If any row is `unresolvable`, or the tool is not
`log_cards`, or the preview did not arrive, the card renders as today's plain
dialog: title, one-line preview, Leave it / Go ahead. Path B is not offered when
the client cannot construct a batch it is confident in. This is the fallback that
keeps a preview failure from becoming a write failure.

### 3.6 What the model is told, in each case

The `reason` becomes a real `tool-result {type:'execution-denied', reason}` in his
context (`ai/dist/index.js:5469-5486`). It must be short, factual, and give him
nothing to embellish.

| Case | Verdict | What he is told |
|---|---|---|
| Accept, unedited | `approved:true` | Nothing extra. `log_cards` runs and returns its own text; he reports the tool's numbers, as today. |
| Accept, edited, commit OK | `approved:false` | *"The reader corrected this before it ran, so THIS call did NOT execute. They applied their own corrected version and it has already landed: batch `<id>`, `<n>` applied — `<card | printing | before → after>` … `<m>` row(s) they left unpicked were NOT applied. Report these numbers. Do not call log_cards for this again; offer revert(batch_id: "<id>") if they want it back."* |
| Accept, edited, commit FAILED | `approved:false` | *"The reader corrected this before it ran, so THIS call did NOT execute. Their corrected version was attempted and FAILED (`<safe error>`). NOTHING was written. Say so."* |
| Accept, edited, everything removed | `approved:false` | *"The reader removed every row before this ran. Nothing was written and nothing was attempted."* No HTTP call is made. |
| Deny ("Leave it") | `approved:false` | `'the reader declined'` — unchanged (`approval.ts:180`). |
| Abandon (stop / abort) | `approved:false` | `'the reader did not answer'`. Distinct from a decline, because it is a different fact and the distinction costs one string. |
| Chat closed, card still open | *nothing settles* | See §5. Existing behaviour; not made worse, not fixed here. |

Error text goes through `safeToolError` (`aisdk.ts:271-297`) or an equivalent on
the client. A `pg` message must not reach the model by this new route any more
than by the old one.

**And, independently of the leg:** on a successful Path-B commit the client
appends the real result to the assistant message as a tool record, using the
existing `TOOL_RECORD_PREFIX` machinery (`useDeckeChat.ts:716-738`), so the fact
is replayed on *every* subsequent turn and not only in the one `execution-denied`
that a lost leg could swallow. It is a browser-authored record of a real API
response — the same provenance class as a chip, and the model still cannot ask
for one.

---

## 4. What the reader sees

Not the subject of this note, but the protocol constrains it and the constraints
should be written down:

- Section 1 has no interaction except removal. The owner's sentence — *"if it's
  truly high confidence I don't want the user to feel like they have to pick a
  variant again"* — is the requirement that `stated` and `only-one` rows carry no
  control that looks like a question.
- Section 2 rows are **excluded from the commit until picked**, and must look
  excluded. The Accept button counts what will actually be written ("Add 2
  cards"), and a picked row moves that number. A person who presses Accept with
  section 2 untouched must not be able to be surprised by what happened.
- **This is a behaviour change and it should be stated as one.** Today an omitted
  variant on a multi-variant card silently becomes the primary and *is written*.
  Under this design it is asked about, and if not answered it is *not* written.
  That is what the owner asked for. It is still a change in what a given
  conversation does, and it belongs in the DECISIONS entry.
- No numeric confidence meter, per the settled details. `certainty` is a
  four-valued sorting key, not a score, and must not be rendered as one.

---

## 5. Failure modes, and what stops each

| Failure | What stops it |
|---|---|
| **Double write** — the held call executes *and* the client's batch lands | Path B settles `approved:false`. The SDK then does not execute; that is `collectToolApprovals` (`ai/dist/index.js:2924-2927`) and `validateApprovedToolApprovals`, not our discipline. Path A never issues a client batch. The two paths are mutually exclusive by construction — one `if`, taken once, before either side effect. |
| **Double write** — the model retries `log_cards` after reading the denial | Three layers. (i) The `reason` says the work is done and names the batch id. (ii) The transcript record (§3.6) repeats it on every later turn. (iii) **Decisive: a retry is itself a write, so it is itself held and shown to the reader.** There is no path by which a model retry writes without a second human Accept. Note honestly that `log_cards`' content fingerprint (`logging.ts:305-326`) would *not* collide with the client's key — different derivations — so the idempotency layer is a bonus, not the defence. |
| **Double write** — the user presses Accept twice | A `committing` ref keyed by `approvalId`, set synchronously before the `fetch`; the button disables on the same tick. Plus the batch's own idempotency key, derived from the resolved items exactly as `ripCommit.ts:76-82` derives it, so the second POST returns the original result (`replayed: true`) and writes nothing. |
| **Silent non-write** — a write happened and the transcript never says so | Commit strictly before settle; the `reason` is built from the real response; and the transcript record survives a lost leg. The one irreducible hole — commit succeeds, the browser is closed before either lands — leaves the *database* correct and the *conversation* ignorant, which is the right way round and is what the mutation ledger is for. |
| **Silent non-write** — the model says it wrote when nothing did | The commit-failed reason says NOTHING was written in those words, and `prompt.ts:486-494` already forbids claiming a change without a tool saying so. Gate 9's `claimsAWrite` assertion generalises to the new cases (§6). |
| **Stale approval — collection changed between hold and Accept** | The narrowing rule forbids changing `mode` or `value`, so the client never re-derives a number. A `delta` item is correct under concurrent change by definition. An absolute `quantity` item is exposed to a lost update — but *equally so today*, because the model computed it from a read earlier in the same turn and `log_cards` would apply it at approval time either way. No new exposure; state it rather than invent a constraint. The `before → after` numbers on the card are a preview and are labelled as one. |
| **Stale approval — the page changed under it** | The approval lives in `useDeckeChat`, above the route tree (`DeckeHost` is mounted once, DECISIONS 2026-08-21), so navigating does not lose it. `collectLandmarks()` re-runs per leg, so the replay carries the new route. The preview's `before/after` may be stale if the user changed the same card in another tab; the batch is `delta`-based, so the *write* is still right and only the preview text was wrong. |
| **Abandoned — user closes the chat panel** | **Unfixed and pre-existing.** `DeckeHost.tsx:447` flips `chatOpen` and nothing else; the promise stays parked, `busy` stays true, `thinking` stays sustained for the life of the page. Reopening restores the card because the state lives in the hook (§3.4) — which is the one improvement this design makes here for free. A real fix (treat a close with an open approval as either "keep it and show a badge on the button" or "abandon it as a decline") is a separate decision and should be its own line in the plan, not smuggled in here. |
| **Abandoned — user presses stop** | Existing behaviour, unchanged: the abort listener settles `false` (`useDeckeChat.ts:212-224`). Under the new signature it settles `{approved:false, reason:'the reader did not answer'}` and **must not** run a client commit. |
| **Preview never arrives / preview throws** | `editable:false`. The plain dialog renders and the ordinary signed path still works. A broken preview degrades the UI, never the write. |
| **Preview arrives for a call that is never held** | Impossible by the guard (`requiresApproval` inside `onInputAvailable`), and harmless anyway: an unmatched `toolCallId` is dropped by the client. |
| **A forged / edited replay** | Unchanged and untouched: `experimental_toolApprovalSecret` binds the input. This design *relies* on that being true and §6 adds a falsification probe that proves it still is. |

---

## 6. Verification

### 6.1 Existing gates that must change

**Gate 9** (`scripts/decke-gates.mjs:1565-1793`) — *"Add one card — preview, no
row, approval, row, quantity, revert offered"*. It stays the authority and its
assertions all survive, because a single explicitly-named card with a stated
printing is **Path A**: `certainty: 'stated'`, section 1, no edits, `approved:true`,
`log_cards` executes server-side, ledger +1, quantity 0→1, revert offered.

It needs three changes:

1. The control it clicks is now inside the segmented card. The role/label lookup
   (`getByRole('alertdialog', {name:/asking permission/i})`, button `/^go ahead/i`)
   must be updated in step with the component, or the gate will report "the
   client half of the approval round-trip is missing" while it is on screen —
   which is exactly the failure its own comment at line 1697 records.
2. Add an assertion that `data-decke-approval-preview` appeared on the wire for
   the held `toolCallId`, with one row classified `stated` or `only-one`. Without
   it the gate cannot distinguish "the card rendered from a real preview" from
   "the card rendered from nothing".
3. Add an assertion that the post-approval leg carries a **server-side
   `log_cards` output** — i.e. Path A really did take the signed path and not the
   client one. Today the ledger check cannot tell the two apart.

**Gate 10** (*"Add 4000 Charizards"*) — no protocol change, but its safety halves
now also have to hold for the new card: nothing written, nothing narrated as
written. It is already red for an unrelated reason (`alert_dizzy`); do not let
that mask a regression here.

**Gate 11** (injection through page data) — unchanged and must stay green. The
new stream part is a fresh surface that renders untrusted card names into a
consent dialog; the gate's existing assertion (no `log_cards`, ledger unchanged)
is necessary but not sufficient, so see 6.2.

### 6.2 New gates

- **Gate 18 — "the printing you did not name."** Pick a QA card the account owns
  zero of, with ≥2 catalog variants. Ask "add one `<name>`" without naming a
  printing. Assert: (i) the preview part classifies that row `unstated` with ≥2
  candidates; (ii) the ledger does **not** move; (iii) Accept with nothing picked
  leaves the ledger unmoved and produces no `claimsAWrite`; (iv) then pick the
  **non-primary** printing, Accept, and assert the ledger moved by exactly 1 **and
  the non-primary variant's quantity moved, not the primary's.** (iv) is the whole
  gate — it is the only assertion that proves the user's pick reached the
  database rather than being cosmetic.
- **Gate 19 — "that's wrong" and partial commit.** A three-card add; remove one
  row; Accept. Assert: exactly one new ledger row; the two kept cards +1 each; the
  removed card unchanged; **no server-side `log_cards` output on the post-approval
  leg** (the held call was denied, so it must not have executed); and he reports
  two applied and one dropped, with no claim about the third.
- **Gate 20 — the card renders untrusted text safely.** Extends gate 11's
  posture to the new surface: a card whose name contains markup/prompt-injection
  text appears in a preview row; assert it renders as text and that no tool call
  results from its content.

### 6.3 The wire probe — `scripts/decke-signed-probe.mjs`

**Yes, it must be extended, and this is the highest-value single test in the
plan.** It already has the right shape: it imports the *shipped* functions and it
falsifies (`DROP=1`). Add one mode:

- **`EDIT=1`** — replay the approval with `approved:true` and a **mutated
  `input`** (change one `variant_id`, or drop one item). **The run must FAIL with
  `InvalidToolApprovalSignatureError` and the ledger must not move.**

That probe is the executable statement of *why this design is shaped the way it
is*. If it ever passes, the input binding is off, the "just edit the replay"
shortcut is available, and every reviewer who reads this note will reasonably ask
why we did not take it. It is also the cheapest possible regression detector for
an `ai` upgrade that changes the signature payload.

Optionally also `PATH_B=1`, driving the client's corrected-batch path headlessly
(commit, then denial with a reason) and asserting the ledger moved by exactly one
and the leg carried an `execution-denied` — seconds instead of gate 19's minutes,
for iteration.

Both new modes write real data to the QA account (`.qa-account`), per B12. Never
the owner's.

### 6.4 Unit tests, on the pure logic

Everything below runs under `node --import tsx --test` with no DB and no browser.
That is the point: `approval.ts:1-56` records that the two shipped approval bugs
were invisible precisely because the logic was unreachable from a test.

- **`packages/agent-tools/src/__tests__/resolve.test.ts` (new file; this package
  has no tests today — add a `test:variants` script and wire it into CI).**
  `variantCertainty` over the five rules of §3.1, including the two that carry the
  whole blocker: *stated on a multi-variant card → section 1*, and *omitted on a
  multi-variant card that resolved `ok` → section 2*. Plus a **pinning test that
  `pickVariant`'s output is unchanged** for the same fixtures — the executable
  form of "this must be a new field, not a change to existing semantics".
- **`apps/web/src/character/host/__tests__/approvalEdit.test.ts` (new).**
  `isUnedited` — equal under key reordering, unequal under a narrowed
  `variant_id`, unequal under a dropped row; `narrowingIsLegal` — rejects an added
  item, a changed `delta`, a `variant_id` not in that row's candidates, and a
  reordered list; `acceptedItems` — index alignment when rows are dropped from the
  middle; `correctionReason` — contains the batch id, the applied count and the
  dropped count, and says NOTHING was written on the failure shape.
- **`apps/web/src/character/host/__tests__/approval.test.ts` (extend).**
  `approvalReplayPart(a, false, reason)` carries a caller-supplied `reason`
  through the **real** `convertToModelMessages` from the pinned `ai@7.0.66` and
  the `reason` survives on the emitted `tool-approval-response` — matching the
  existing pattern in that file of driving real SDK code rather than a
  reconstruction. And re-assert that `approved:true` still emits the signature
  from `approval.signature` and nowhere else.
- **`apps/api/src/decke/__tests__/`** — that `onInputAvailable` is a no-op for a
  call `requiresApproval` returns false for (a preview must not itself trigger a
  preview), and that the preview path calls the handler with `dry_run:true`
  forced, not merely defaulted.

---

## 7. What must NOT change

1. **`experimental_toolApprovalSecret` and the replayed `signature`.** Path A is
   the common path and it goes through them untouched. `EDIT=1` proves it.
2. **`approvalReplayPart`'s shape** — `type: 'tool-' + name`, `state:
   'approval-responded'`, the signature under `approval.signature` and nowhere
   else, the signature **omitted** rather than sent as `undefined`. Only the
   denial `reason` becomes caller-supplied. Both bugs in that file's header are
   still one careless edit away.
3. **The "nothing may be appended after the approval message" rule**
   (`useDeckeChat.ts:354-368`, vercel/ai#17033). The client's corrected-batch POST
   happens *before* the wire message is built and adds nothing to `wire`. Keep it
   that way.
4. **`mayAskApproval` / `legBudget`.** Path B needs no extra leg. If a future
   version does, the reserve must be raised at the same time and
   `approvalAlwaysDeliverable` must still hold.
5. **`requiresApproval` / `wouldMutate` / `forcePreview`** and the rule that
   classification comes from annotations and schema, never from the verb in the
   name.
6. **`pickVariant`'s status semantics.** `add_cards` and every non-Deck-E caller
   keep the silent primary default. `variantCertainty` is additive.
7. **The write protocol in `prompt.ts:457-494`.** No "Preview first", no "in
   numbers, and wait", no "Confirm?". The 2026-08-22 decision measured what those
   sentences cost (0/15 → 21/30) and a test asserts their absence. This design
   needs **no prompt change at all**, which is a feature of it.
8. **Chips are emitted from the adapter, 1:1 with a real invocation.** The new
   preview part obeys the same rule and adds no surface the model can ask for.
9. **`include` defaults to read-only, and `approvals: 'upstream'` is never
   reachable from the conversational path** (`aisdk.ts:110-160`). Nothing here
   touches sub-agents.
10. **B12.** Every verification run above signs in as the QA account. The writes
    are real.

---

## 8. On the settled details

**Partial Accept is worth its cost — and, given per-row removal, it is nearly
free.** Once "that's wrong" exists, an unpicked section-2 row *is* a removed row;
partial commit needs no additional protocol at all. Arguing against it would mean
arguing against per-row removal, which is the owner's clearest ask and the thing
the current protocol most obviously cannot do. So: keep it.

The cost that is real, and that the plan should own explicitly, is **not**
protocol complexity — it is the behaviour change in §4: a row that today silently
becomes the primary printing and gets written will, after this, be asked about and
*not* written if the question is ignored. The owner asked for exactly that
(*"I neglected to tell it which variant and it flagged that as something it
didn't know, and I liked that"*), so it is intended. It should still be written
down as a change, because the first person to notice a card that "didn't get
added" will otherwise file it as a bug.

The one settled detail I would push back on, mildly: **"no numeric confidence
meter"** is right, and the implementation should be defended against reintroducing
one by accident. `certainty` has four values and one of them is `unstated`; the
temptation to render "high / medium / low" on top of it will arrive within a
sprint. It is a sorting key. Keep it out of the DOM.
