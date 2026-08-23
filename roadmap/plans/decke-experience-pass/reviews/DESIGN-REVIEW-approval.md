# DESIGN-approval-protocol.md — adversarial review

**Reviewed:** the design note at `scratchpad/deck-e-pass/DESIGN-approval-protocol.md`, against the repo at `decke-experience-pass` and the **installed** `ai@7.0.66` (`node_modules/ai/package.json` says 7.0.66; pinned at `package.json:32` and `apps/api/package.json:28` — re-derived, not taken from the note).
**Method:** every load-bearing citation re-read at source. The SDK's signing block (`dist/index.js:5031-5141`), verification (`5149-5223`), collect (`2857-2931`), the streaming pipeline (`8063-8277`, `9481-9595`, `9805-9840`), the UI→model conversion (`10895-11004`), and the repo's `approval.ts`, `useDeckeChat.ts`, `DeckeChat.tsx`, `DeckeHost.tsx`, `aisdk.ts`, `chat.mjs`, `ctx.ts`, `collection.ts`, `mutations.ts`, `logging.ts`, `resolve.ts`, `prompt.ts`, `ripCommit.ts`, gate 9, and the signed probe — all read in full or in the cited region.

**Counts: 1 BLOCKER, 5 MAJOR, 5 MINOR, 3 NIT.**

The design's architecture — `(c′)+(d)+(a)` — is right, and nothing below argues with the shape. Every finding is a repair inside it.

---

## BLOCKER

### B-1. The idempotency key copies the wrong prior art, and the server honours it forever

§3.5 specifies: *"idempotencyKey: derived from the RESOLVED items, as ripCommit.ts:76-82 does."* Verified — `ripCommit.ts:82` is a pure-content key:

```ts
idempotencyKey: `rip-${items.map((i) => `${i.variantId}x${i.delta}`).sort().join(',')}`.slice(0, 200),
```

And the server's contract for a caller-supplied key, `mutations.ts:121-122`, verbatim:

> `/** Caller-supplied key — honoured indefinitely, never bucketed. */`

Confirmed in `collection.ts:367`: `const keys = callerKey ? [callerKey] : candidateKeys(fingerprint)` — only the *server-derived* fingerprint gets the 15-minute bucketing; a caller key is looked up bare, against every committed batch this user has ever made (`findCommittedBatch`, `mutations.ts:180-195`).

So: the reader asks Deck-E to add one Pikachu, corrects it to the reverse holo on the card, Accepts. Path B commits `[{variantId: 37184, delta: 1}]` under a content-only key. Next week they do exactly the same thing. The second POST collides, the server returns the **original response** with `replayed: true` (`collection.ts:372-377`), `correctionReason` is built "from the real response" — which says 1 applied, with last week's before/after numbers — and the model reports a write that did not happen. The transcript record (§3.6) then repeats that false report **on every subsequent turn**. This is the design's own worst-case class ("a confident statement about a write that did not land"), manufactured by its own §3.5, and **no proposed gate or unit test repeats an identical corrected batch, so nothing in §6 catches it.**

The bitter part: the repo already learned this lesson, in the other file the design quotes. `logging.ts:331-343` (`chunkKey`):

> *"Without it the key is pure content and lives forever, so '+1 Pikachu' logged today would make the identical call next month a silent no-op that still reported the old quantities as current. That is the same dishonesty this tool exists to remove, pointing the other way — and small identical batches are its normal usage, not an edge case."*

**What I would do instead.** Scope the key to the held call: `decke-approval-${toolCallId}#${contentHash}`. `toolCallId` is unique per approval, so:
- a double-tap or a network retry of *this* Accept collides correctly (same call, same content → `replayed: true` is the truth);
- two different approvals with identical content never collide;
- no time bucket is needed, because the scope does the work the bucket does for `log_cards`.

Additionally, `correctionReason` must read `replayed` off the response and, if it is unexpectedly true on a first submission, say something honest rather than reciting the replayed numbers as new. And add one unit test: two distinct `toolCallId`s with identical accepted items produce distinct keys; the same `toolCallId` twice produces the same key.

One line of derivation plus one guard. But it must be in the design, because §3.5 as written ships the bug.

---

## MAJOR

### M-1. The `onInputAvailable` mechanism claim is verified against the wrong function — the real guarantee exists, but it lives somewhere else and the design does not pin it

§3.3 claims: *"The SDK awaits this before `resolveToolApproval` and before it signs (`ai/dist/index.js:5740-5766`), so the preview always reaches the browser ahead of, or with, the approval request."*

Lines 5740-5766 are inside **`generateText`**. The chat route uses **`streamText`** (`api/chat.mjs:449`), and the streaming path is different in exactly the way that matters:

- `invokeToolCallbacksFromStream` (`dist/index.js:8217-8277`) handles the `tool-call` chunk by calling `controller.enqueue(chunk)` **first** (8230) and *then* awaiting `onInputAvailable` (8263-8271).
- The enqueued chunk flows immediately into the next transform, `executeToolsFromStream` (`8083-8168`, wired at `9805-9840`), which runs `resolveToolApproval` (8097), signs (`maybeSignApproval`, 8112), and enqueues the `tool-approval-request` (8121-8127) — **concurrently with the still-running dry run**. An HMAC loses no race to a 100-400 ms database round trip: the signed approval request will essentially always hit the wire *before* the preview part.

So the stated ordering — sign-after-preview — is false on the path the product runs. **The design's conclusion survives anyway**, for two reasons it does not state:

1. The awaited callback blocks the transform from processing the step's *subsequent* chunks, so the stream cannot reach its finish parts — and cannot close — until the dry run resolves and the preview part has been written.
2. The client only opens the dialog **after the leg's stream completes**: `askApproval` runs at `useDeckeChat.ts:346`, after `streamLeg` returns at `:240-295`. By the time a card can render, everything on that leg's wire — preview included — has arrived.

That is the true invariant: *"the preview part is on the wire before the stream closes, and the card is not shown until the stream closes."* It is a property of `useDeckeChat`'s collect-then-ask shape, not of the SDK — and it dies silently the day someone renders approval cards mid-stream, which is a plausible move in the very transcript-liveness direction the rest of this pass pushes (Phase C/H). **Write the invariant down in §3.3 with the correct citations (`8230`, `8263`, `8097-8127`, `useDeckeChat.ts:240-346`), and pin it**: gate 18 should assert the preview part appears in the leg's SSE *before* the stream's finish part, not merely that it appeared at all. Also correct §3.3's resume-leg citation: for `streamText`, approved calls execute at `9528-9558` and denials materialise at `9575-9585` — `5405-5492` is again `generateText`.

The latency claim also inverts: the dry run does not run "while the model is still streaming" so much as it *stalls the tail of the stream* behind the await — the turn's completion (and therefore the card) is delayed by the dry-run duration. 100-400 ms spent before a consent dialog is a fine trade; say it plainly rather than claiming it free.

### M-2. `prompt.ts` actively contradicts the new semantics, and the design's "no prompt change at all" claim is not available

§2(c′) and §7.7 sell the design partly on needing no prompt change. But `prompt.ts:476-481`, verified verbatim:

> *"**Pick the obvious variant and go.** … If they did not name a printing, use the primary and say which you used. Asking 'normal or reverse holo?' before every single add turns a one-second job into a negotiation…"*

Under this design, the unstated-variant row on a multi-variant card is precisely the row that goes to section 2 and is **not written unless picked**. So the model — following its own instructions — narrates "I used the primary Normal printing" in the same turn in which the card asks the reader to pick and, if they don't, the denial reason says the row was not applied. The model's prose and the platform's behaviour now assert opposite things about the same row, in front of the reader, on the write path.

This is not one of the protected sentences: the DECISIONS test asserts the absence of "Preview first" and "in numbers, and wait" (`DECISIONS.md:8818`), and §7.7 protects those. The variant-default paragraph is separate, and it must be amended in the same commit — something like *"If they did not name a printing, call the tool anyway; if the card has more than one printing, the dialog will ask them which — that question is the dialog's, not yours."* That is consistent with the 2026-08-22 fix's spirit (never stop him calling) and touches none of the tested sentences. The design should own this as its one prompt change rather than claiming zero.

### M-3. The commit-failure reason can lie: a timed-out POST that actually committed says "NOTHING was written"

§3.6's failure row: *"Their corrected version was attempted and FAILED (`<safe error>`). NOTHING was written. Say so."* But a `fetch` that throws on timeout or network drop is not evidence the write failed — it is evidence the *response was lost*. This codebase has already met the case, twice: `logging.ts:550-554` (`landedAfterTimeout` — "chunk(s) timed out waiting for a reply, but the mutation log confirms the write COMMITTED") and `ripCommit.ts:74-77` ("a request that half-succeeded and was retried"). `/collection/batch` commits before responding; the socket can die after COMMIT.

**Specify the three outcomes**, not two:
- **Response received, applied** → success reason.
- **Response received, HTTP error** → "attempted and FAILED (<safe error>). NOTHING was written." True, because the transaction rolled back or never started.
- **No response (timeout / network throw)** → retry once with the **same** idempotency key (safe only once B-1's toolCallId-scoped key exists — a retry either applies or returns `replayed: true` with the real numbers). If the retry also gets no response: the reason must say *"I could not confirm whether it landed — check the ledger"* and must **not** say nothing was written.

This costs one branch and one string, and it removes the only path on which the new machinery makes a confident false claim in the *unwritten* direction.

### M-4. Gate 9's "Path A survives" claim rests on an unverified assumption about what the model puts in the held input

§6.1: *"a single explicitly-named card with a stated printing is Path A: `certainty: 'stated'` … its assertions all survive."* But gate 9's prompt names the **card**, not the printing: `Add one ${target.cardId} (${target.name}) to my collection` (`decke-gates.mjs:1582-1588`, default target `me05-014`, `:1029`). And the prompt *instructs* the model not to state one — "use the primary" (`prompt.ts:476-481`) describes an outcome `pickVariant` produces server-side; nothing makes the model put `variant_id`/`variant_kind` into `items`. If the target card has more than one catalog printing and the model omits the variant — the likely shape — the row classifies `unstated`, lands in section 2, and Accept-with-nothing-picked writes **nothing**: `afterApproval === before + 1` (`:1756`) fails, on the gate the design names "the authority."

Fix inside the design, either way: (a) make gate 9's prompt name the printing, exactly as the probe already does (`decke-signed-probe.mjs:37` — "Normal variant"); or (b) constrain `cardToAdd()` to a single-variant card so the row is `only-one`. Then gate 18 remains the home of the unstated case, which is where the design already puts it. Without this, the first full gate run after Phase F lands reports the authority red for a reason that is neither a bug nor a regression.

### M-5. Path selection should key on the choices, not on a reconstruction — the predicate as specified fails in the dangerous direction

§3.5 routes on `isUnedited(acceptedItems(held, choices), held)`. Both the routing predicate and the committed batch are derived through the same function, `acceptedItems`. A bug there — a dropped `removed` flag, an index misalignment (the exact class §6.4's own test list worries about) — makes the reconstruction equal `held`, `isUnedited` returns true, and Path A **auto-approves the original batch**, including a row the reader visibly struck out. That is the false-positive direction: writing what the user explicitly excluded, on a consent dialog. The false-negative direction (needless Path B) still writes exactly what the user accepted — strictly survivable.

The design asks (in §d) which failure is worse and does not answer for its own predicate. Answer it structurally: **route on the choices themselves** — `edited = choices.some(c => c.removed || c.variantId != null) || anyUnpickedSection2Row` — which is one step from the user's actual gestures and has no reconstruction to get wrong. Keep the canonical-JSON comparison, but as a **cross-check assertion**: if the choices say unedited and `canonicalJSON(accepted) !== canonicalJSON(held)` (or vice versa), throw before sending anything, per the design's own "an edit that fails this check is a bug in the UI, and it must throw" rule. Two independent derivations that must agree is the shape this file's history (`approval.ts:1-56`) argues for.

(Also note for §d's "compare what against what": the SDK's signature binds the canonical JSON of the **whole input** — `hashCanonical(input)` over `{items, note, dry_run, …}`, `dist/index.js:5031-5056` — while `isUnedited` compares `items` only. That is fine, because the predicate is routing, not security: Path A replays the original input verbatim regardless. Worth one sentence in §3.4 so nobody "fixes" the asymmetry either way.)

---

## MINOR

### m-1. `ambiguous` and `unresolvable` rows are not rows the planner builds — §3.1's wiring sentence doesn't hold for them

§3.1: *"`log_cards`' planner … calls it right after `pickVariant` and hangs the result on the row it already builds."* Verified against `logging.ts:281-303`: `planned.push` happens **only** for `status: 'ok'`. An `ambiguous` result is a `skip(…)` carrying `{cardId, variants}` (`:287-292`); `not_found` likewise (`:283-285`). So the two certainty kinds that define section 2's hardest cases never reach a planned row, and the preview's `rows` must be assembled from `planned` **plus** the candidate-bearing skips — or the planner must change, which the design's own constraint forbids (every non-Deck-E caller shares it). The safe mapping (rows from `planned`, section-2 entries also from candidate-bearing `skipped`, unpicked ones excluded exactly as a skip already is) is implementable without touching apply semantics — note that an unedited Path A approval of such a batch has `log_cards` skip those rows server-side, which is *consistent* with "unpicked is not written." One paragraph in §3.1/§3.2 saying this; otherwise the implementer discovers it mid-phase.

### m-2. "The new machinery is confined to the path where the user actually corrected something" overstates — and one reason string misdescribes

Any batch containing ≥1 `unstated` row takes Path B even if the reader touches nothing: unpicked section-2 rows are excluded (§4), so `accepted ≠ held` by construction. Given `prompt.ts` steers the model away from stating variants (M-2), the mixed batch is plausibly the *majority* add, not the exception — Path B is a mainstream path and should be tested and framed as one. Relatedly, §3.6's "everything removed" reason (*"The reader removed every row"*) also fires when every row was merely left unpicked, which is a different fact; give it its own sentence.

### m-3. Accept must disarm the abort-settles-deny listener before the commit starts

`askApproval` wires the turn's abort to `settle(false)` (`useDeckeChat.ts:217-223`). Under Path B, Accept starts a commit *before* settling — if the reader presses stop mid-commit, the abort listener settles the promise as a denial ("did not answer") while the batch lands. The turn then returns at `:347` without POSTing, so the model is never told either way; §3.6's transcript record is the only survivor, which mostly saves it. Still: once Accept is pressed, the verdict is taken — the design should say the abort listener is disarmed (or made a no-op for an already-answered approval) at that moment, and pin it with a unit test on the pure state machine.

### m-4. The denial reason and the transcript record are unbounded in batch size

§3.6's success reason enumerates `<card | printing | before → after>` per row, and the transcript record replays on every later turn. `/collection/batch` accepts 250 items. A large corrected batch turns the reason into a multi-kilobyte tool result and the record into a permanent per-turn tax — the same bill `LANDMARK_CAP` (`useDeckeChat.ts:740-758`) exists to cap. Cap the enumeration (first N rows + "and K more — batch `<id>` has the full list") in both the reason and the record.

### m-5. The abandon row in §3.6's table implies a message that never reaches the model

On stop/abort, `settle(false)` resolves the promise but the turn returns before the replay leg is built or POSTed (`useDeckeChat.ts:347`). No reason string — "the reader did not answer" or otherwise — is ever delivered on that path, under the current code or this design. The table row should say the reason is *recorded client-side* (so a later turn's history is honest) rather than implying delivery.

---

## NIT

- **n-1.** `api.collectionBatch`'s options type (`api.ts:899-902`) has no `requestFingerprint` field; §3.5 sends one. Extend the helper's type in the same change.
- **n-2.** `needsApproval` on the tool object is marked **@deprecated** in the installed `@ai-sdk/provider-utils` (5.0.27 d.ts: *"Tool approval is handled on a `generateText` / `streamText` level now"*). It works today and is pre-existing usage, but this design deepens reliance on the tool-level form; the `EDIT=1`/`DROP=1` probes are the regression tripwire for the next `ai` bump — one sentence in §7.1 noting the deprecation would make that explicit.
- **n-3.** Two more §0/§2 citations are `generateText` ranges used for streaming behaviour (`5405-5492` execution-from-history; `5469-5486` denial emission). Both conclusions hold on the streaming path (`9528-9558`, `9575-9585`) — and the *strongest* citation for reason-survival is one the design missed: `convertToModelMessages` itself converts an `approval-responded` part with `approved: false` **directly** into `tool-result {type:'execution-denied', reason}` in the tool message (`dist/index.js:10970-10981`), with the caller's reason at `10977`, deduplicated against the collect path by `2908`/`9503-9504`. Cite it; it is the fact that makes (a) truthful.

---

## Answers to the brief's attack list, where not covered above

**1. The ordering rule.** Acceptable, and the design undersells its own strength. "Commit then settle" is not pure discipline: `correctionReason(res, …)` takes the batch **response** as its argument, so the success message is *unconstructible* before the commit returns — a data dependency, which is a primitive of sorts. The four scenarios: a lost denial leg leaves DB-right/model-ignorant, and the §3.6 transcript record repairs it on the next turn (verified this works: `messagesToWire` rebuilds the wire from text + chip records only, `useDeckeChat.ts:718-738`, so no dangling approval part ever confuses `collectToolApprovals`, which reads only the last message anyway, `2860`); a browser crash between commit and settle leaves the database correct and the ledger as witness — the right way round; "network failure after the model believes it was denied" cannot occur under this ordering, because the model learns nothing until the settle leg, which follows the commit — the residual is M-3's ambiguous-outcome case; tab closed mid-sequence is the crash case. A server-side primitive that *enforced* the coupling would mean the server minting or validating the corrected write inside the approval channel — that is option (b) by another door, and the design is right to refuse it. Ship the ordering with its unit test and the data-dependency argument written down.

**2. Double-write / silent non-write.** Traced. Path A vs B mutually exclusive by one branch taken once; a denied call is never executed by the SDK (`collectToolApprovals` files it denied, `2924-2927`; only `localApprovedToolApprovals` execute, `9528-9558` — primitive, not discipline); a model retry after the denial is itself a write, itself held, itself shown (verified: every new `log_cards` call re-enters `needsApproval`); double-tap is covered by the `committing` ref plus — once B-1 is fixed — an idempotency key that is *correct* rather than merely present. The one uncovered path was B-1's cross-approval collision, which is why it is the blocker. The design's honest note that `log_cards`' own fingerprint would not collide with the client's key is verified (`logging.ts:322-328` derives differently) and correctly demoted to "bonus."

**5. Denial-as-truth.** Verified end to end at the layer this repo can see: reason survives the UI→model conversion (`10970-10981`), the collect path (`2908`), the streamText materialisation (`9575-9585`), and `mapToolResultOutput` passes non-`content` outputs through untouched (`1772-1774`); `execution-denied` with optional `reason` is a first-class member of the LanguageModelV4 tool-output union (`2382-2385`). One honest limit: the provider is the Vercel AI Gateway (`chat.mjs:47,407`), so the final serialisation of an `execution-denied` result into the underlying model's native format happens inside Vercel's service and is not verifiable from this repo — which is exactly why gate 19's behavioural assertion ("he reports two applied and one dropped") must stay, as the end-to-end check on what the model actually does with it. The "I didn't add anything" risk is real but bounded: the reason's own text asserts both facts in the model's context, `prompt.ts:486-494` forbids the inverse claim, and gates 18(iii)/19 falsify the narration.

**6. Variant classification.** The design implements the second review's blocker correctly. `variantCertainty`'s five rules were checked against `pickVariant` (`resolve.ts:329-363`): omitted on multi-variant genuinely returns `ok` + primary (`:362`); `ambiguous` genuinely fires only for absolute-quantity with >1 *owned* (`:353-361`); the rules key on `all.length` and carry `candidates` on both asking kinds. The rule order (stated before only-one before ambiguous) is right and stated as the specification. Residual: m-1's planner mapping.

**7. The two latent bugs.** Both confirmed: `previewOf` (`DeckeChat.tsx:173-180`) scans backwards for *any* last ok chip — used in the live dialog at `:623-625` — and the design **fixes** it (keyed `data-decke-approval-preview` lookup, `previewOf` deleted, §3.2), not merely obsoletes it. Chat-close (`DeckeHost.tsx:447` flips `chatOpen` only; the only settle path is the abort listener at `useDeckeChat.ts:217-223`) is confirmed, correctly declared out of scope here, and owned by the plan's H3b(ii) — with the hook-owned choice state (§3.4) as the free improvement claimed.

**8. Gates and probe.** Gate 9's three changes are right (subject to M-4). The `EDIT=1` probe **can fail**: verification hashes the *replayed* input (`validateApprovedToolApprovals` takes `toolCall.input` from the reconstructed history, `5172-5179`), so a mutated `variant_id` changes the digest and must raise `InvalidToolApprovalSignatureError` — and the probe's existing failure detection (`decke-signed-probe.mjs:134-137`) already matches that error's name. `DROP=1` exists as described. Gate 18(iv) (non-primary quantity moved, not primary's) and gate 19's "no server-side `log_cards` output on the post-approval leg" are the two assertions that can each catch a real bug class; keep them verbatim. Add M-1's ordering assertion and a B-1 repeat-batch check to gate 18 or the `PATH_B=1` probe mode.

---

## What is GOOD and must not change

- **The recommendation itself, `(c′)+(d)+(a)`, and the precedence.** Path A byte-for-byte down the signed path is the correct answer to "the common case must stay boring," and it is the only option that keeps the primitive doing the enforcement.
- **The refusal of (b), and its grounds.** All verified: no signing export in `18280-18410` (only the three error classes); the legacy newline payload is real and tried on verify (`5084-5090`, `5120-5128`), so re-signing means owning two unversioned formats; `experimental_refineToolInput` runs only in `parseToolCall` (`3848-3897`), never on history. §2(b)'s verdict should survive any future re-litigation, and the note's own instruction — reconsider only if `ai` exports the helpers — is the right standing rule.
- **`variantCertainty` as an additive field keyed on candidate count**, with the `pickVariant`-pinning test. Exactly resolves the second blocker without the forbidden semantics change.
- **The preview's provenance rule** — emitted from the adapter, 1:1 with a real handler invocation, `forcePreview`-coerced, `withToolCtx`-scoped (all verified: `aisdk.ts:240-245`, `ctx.ts:99-151`), transient, keyed by `toolCallId`, and no chip. The "no chip for the dialog's own work" reasoning is correct and subtle; keep the sentence.
- **`approvalEdit.ts` as a pure module.** `approval.ts:1-56`'s two-shipped-bugs history is real and verbatim as cited; the untestable-hook trap is the single most likely way this feature regresses, and §3.4 is the counter.
- **Commit-then-settle with the reason built from the real response** — strengthened, per attack-1 above, by naming the data dependency.
- **The §3.6 transcript record.** It is the one mechanism that survives a lost leg, and it works *because* `messagesToWire` rebuilds history from text + records — verified, and worth keeping stated.
- **§7 in its entirety**, especially 2 (the replay shape's two known landmines), 3 (vercel/ai#17033 — the Path B POST touches nothing on `wire`, and must stay that way), and 7 as amended by M-2 (protect the tested sentences; the variant paragraph is a different sentence).
- **The `EDIT=1` probe.** The single highest-value test in the pass, exactly as the design says: it is simultaneously the falsification of the shortcut, the statement of why the design is shaped this way, and the cheapest `ai`-upgrade tripwire.
- **§8's push-back discipline** — partial Accept nearly free given removal; `certainty` kept out of the DOM as a score. Both right.

---

## Verdict

**Implement with changes.** The architecture is sound, the security posture is genuinely conservative (no new authority: the Path B write is the user's own existing endpoint under their own JWT and RLS — verified), the falsification story is the best in the pass, and the two review blockers that prompted this note are both actually resolved by it. The changes required are: B-1 (key derivation + `replayed` handling), M-1 (state and pin the real ordering invariant; fix the citations), M-2 (the one prompt paragraph), M-3 (the three-outcome commit result), M-4 (gate 9's printing), M-5 (route on choices, assert on canonical JSON). All are small; none touches the architecture.

**The single thing most likely to cause a production write bug:** the idempotency key as specified in §3.5. Implemented verbatim, the second identical correction a user ever makes is silently swallowed by a server that honours caller keys forever, while the model — reading a replayed response as fresh — tells the reader it landed, and the transcript record repeats it every turn thereafter. The failure the whole design exists to prevent, from one borrowed line, and no test in §6 would ever see it.
