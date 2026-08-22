codex
## 1. Verdict — green-light with changes

The plan has unusually strong diagnosis, traceability, and visual intent. I would not green-light implementation as written, however. Phase F contains a protocol-level contradiction with the verified approval implementation, and Phase E lacks a sufficiently precise execution/security contract for autonomous journeys.

Those areas need redesign before code starts. The visual, lifecycle, rendering, and most liveness work can proceed after the smaller issues below are resolved.

I had no filesystem access and therefore could not independently verify any unlisted file, behavior, line reference, harness, or research claim. Findings relying only on the supplied plan are marked unverified where appropriate.

---

## 2. Ranked correctness findings

### BLOCKER — F1 cannot work through the existing approval protocol

The proposed approval card allows:

- Removing individual rows.
- Selecting or changing variants.
- Accepting only section 1.
- Leaving ambiguous rows uncommitted.

But the verified implementation has two incompatible properties:

1. `settle(approved)` resolves every pending approval to the same boolean.
2. Replay sends the original, unmodified input.
3. The SDK signature binds that exact input cryptographically.

Consequently, the proposed UI cannot alter a variant, remove a row, or approve a subset and then replay the existing approval. Doing so either commits the original batch or invalidates the signature.

This is not “~80% built.” The visual portion may be mostly built, but the interaction described by OR4 requires a new approval transaction design.

What I would do instead:

- Keep the original approval request immutable.
- Treat row edits and picker choices as preparation of a new proposed write.
- Reject/cancel the original held request.
- Construct a new exact commit input containing only selected rows and resolved variants.
- Run a new dry-run and obtain a newly signed approval request for that exact input.
- Show a final approval action whose label explicitly states what will be committed, such as “Add 7 confirmed cards.”
- Alternatively, issue independently signed approval requests per row, but that risks prompt fatigue and likely produces a worse experience.

Do not hide the second authorization step or reuse the old signature. The commit payload visible to the user must be exactly the payload covered by the approval being accepted.

### BLOCKER — F1’s provenance model does not actually identify all rows needing a picker

The plan says not to change `pickVariant` status semantics. That is reasonable. But the proposed field:

```ts
variantSource: 'stated' | 'defaulted' | 'ambiguous'
```

does not by itself implement the owner’s design.

An omitted variant may currently be silently defaulted to the primary variant even when several variants exist. That is precisely the case where the owner expects “What was the variant on these?” Yet:

- Its status remains resolved.
- Its source becomes `defaulted`, not `ambiguous`.
- The plan only promises candidate arrays for existing `ambiguous` results.

Thus a defaulted multi-variant row may have no candidate data for the picker and may still be treated as known.

What I would do instead:

- Preserve existing resolution status semantics.
- Add independent provenance and candidate metadata to dry-run rows:
  - `variantSource`
  - `variantCandidates`
  - `variantSelectionRequired`
  - possibly `selectedVariantId`
- Define classification explicitly:
  - Explicit variant: known.
  - Omitted, exactly one candidate: known.
  - Omitted, multiple plausible candidates: selection required, even if legacy resolution internally chose the primary.
  - Existing semantic ambiguity: selection required.
- Ensure the dry-run summary never presents a silently defaulted multi-variant row as confidently known.

### MAJOR — E8 needs a concrete client-tool lifecycle contract

The journey description says execution will stop on failure and “hand back to the model for a fresh turn.” It does not specify how that happens through the AI SDK lifecycle:

- Is `journey` a client tool whose result is submitted as a tool-result part?
- Does submission automatically continue the same response?
- Is failure a new user-visible turn or another model step?
- How are cancellation and route unmount distinguished from tool failure?
- What prevents two journeys from executing concurrently?
- What happens if the chat is closed during a journey?
- What happens if the stream disconnects after the plan arrives but before its result is submitted?

These are correctness issues, not implementation details. The transcript ordering work in E5 also depends on this contract.

What I would do instead:

Define a journey state machine before implementation:

```text
planned → running(step n) → completed
                         ↘ failed
                         ↘ cancelled-by-user
                         ↘ cancelled-by-close
                         ↘ superseded
```

Every terminal state should produce exactly one tool result. Only `failed` should invite model recovery automatically; a user cancellation should not cause the agent to resume moving without a new request.

### MAJOR — The journey tool should not accept arbitrary CSS selectors

Predictable landmark selectors make planning possible, but accepting model-produced selector strings expands the control surface unnecessarily. CSS escaping, selector injection, selector collisions, and future markup changes become part of the security boundary.

What I would do instead:

Use typed semantic targets, for example:

```ts
{ kind: 'nav', route: '/series' }
{ kind: 'series', slug: 'mega-evolution' }
{ kind: 'set', setId: 'me05' }
```

The trusted client converts those into selectors. Validate route, slug, and ID formats, and retain the existing click allowlist. Raw selectors should not cross the model/tool boundary.

The static clickable audit is helpful, but it does not replace a runtime authorization policy.

### MAJOR — “Any user click or scroll cancels” needs trusted-event semantics

Journey steps themselves invoke `el.click()` and may cause scrolling. A naïve global click/scroll listener could cancel the journey because of its own actions.

What I would do instead:

- Cancel only on trusted user input (`event.isTrusted`) where available.
- Separate programmatic scrolling from user scroll intent.
- Include pointer, wheel, touch, keyboard navigation, and scroll-container interactions.
- Abort through one shared `AbortController`.
- Remove listeners reliably across route changes and unmounts.
- Verify that clicking chat controls—close, stop, composer, approval—also cancels appropriately.

This finding is unverified against the existing event code because I could not inspect it.

### MAJOR — D5’s blanket `replace: true` is not necessarily correct history behavior

Replacing every Deck-E navigation prevents history spam, but it can also destroy the user’s expected ability to return to the page where the request began.

For a multi-hop escort, intermediate pages should not become five Back-button entries. But the journey’s starting location is meaningful.

What I would do instead:

- Preserve the journey origin.
- Replace intermediate hops.
- Make the final destination one coherent history transition.
- For a direct “take me to X,” ordinarily push once, unless there is an established product rule to replace.
- Add Back-button tests for direct jumps, successful journeys, failed journeys, and cancelled journeys.

“Deck-E navigation always replaces” should not be recorded as a decision until this UX is settled.

### MAJOR — A7 should be lifecycle-driven, not dependent on an `express` model call

The thinking-to-answering transition is deterministic application state. If the model must remember to call `express`, the emotion beat will be inconsistent and will consume tool capacity for a basic UI response.

What I would do instead:

Trigger a short host-side expression when the first answer token arrives after thinking. Allow an explicit model expression to override it where appropriate, but make the baseline transition automatic, reduced-motion-aware, and interruptible.

### MAJOR — D1 risks exposing sub-agent prose as internal process

Forwarding `textStream` deltas into an expandable “thinking” row may surface prose that was not designed for users, may repeat the final answer, or may imply access to hidden reasoning. The plan correctly says it is not Deck-E’s voice, but placement alone does not make raw output suitable.

What I would do instead:

- Prefer structured provider events: search started, source received, analysis still running, completed.
- If only text is available, do not label it as “thoughts.”
- Treat it as research output or a live draft only after checking its semantics.
- Never expose hidden chain-of-thought or provider-internal traces.
- Use an honest elapsed-time heartbeat when no structured progress exists: “Analysis still running · 42s.”
- Give the user a Stop action during long operations.

The claim that provider parts are available is explicitly a probe and remains unverified.

### MAJOR — E8’s route wait can succeed against stale DOM

Waiting for a selector after a click is insufficient if that selector already existed before navigation, remains in a persistent shell, or belongs to an outgoing route during transition.

What I would do instead:

Each navigation step should wait for both:

- An expected route/location or route generation change.
- A target landmark attached to the current route and visibly actionable.

The bounded wait should distinguish timeout, route mismatch, target absent, target hidden, and target disabled. Six seconds may be too short on the slow connections explicitly anticipated elsewhere; use a measured budget and visible progress.

### MAJOR — Markdown needs an explicit safety and interaction policy

`react-markdown` is a good base, but “wire it into both surfaces” is incomplete for agent-generated content.

Specify:

- No raw HTML.
- Link protocol allowlist.
- External-link behavior.
- Whether images are prohibited.
- Code-block overflow on mobile.
- Long unbroken content handling.
- Table overflow and accessibility.
- Selection/copy behavior inside the floating bubble.
- Lazy-load fallback so streamed text does not disappear while the renderer loads.

This is unverified against the existing `MarkdownView` configuration.

### MINOR — The sequence contradicts itself about E8 readiness

Section 7 says the one-plan design is established and “not speculative.” Section 10 says “Measure E8 first.” It is unclear what measurement could reject the architecture and what acceptance thresholds apply.

Define the spike explicitly before dependent message-model work:

- Reliable completion rate.
- Median and worst-case journey duration.
- Cancellation behavior.
- Route/selector wait success.
- Recovery-turn behavior.
- Transcript event ordering.
- Accessibility and reduced-motion behavior.

### MINOR — X1’s list of 19 enforcement sites is brittle

A fixed list of known animation sites can immediately become incomplete as this pass adds new animations.

Add an enduring reduced-motion review/test strategy rather than relying only on the enumerated sites. Test motion libraries, CSS animation, canvas/three.js motion, smooth scrolling, highlight chasing, loading animation, and newly introduced thinking indicators.

### MINOR — C2’s “small presentation stagger” must not imply false chronology

If parallel tools start together, visually staggering them can suggest they happened sequentially. Preserve accurate timestamps/order and stagger only entrance animation, not semantic placement or status timing.

---

## 3. World-class gap analysis

This is a strong experience-remediation plan, but it is not yet a complete plan for a world-class agent chat.

It invests heavily in mascot choreography, visual polish, and complaint closure. The larger gaps are control, recovery, trust, and evaluation:

- There is no clear Stop generating / Stop research / Stop journey design.
- No retry or recovery experience is specified for stream loss, tool timeout, tool failure, offline state, or client-tool desynchronization.
- User interruption while the assistant is streaming is discussed only for journeys, not ordinary answers or deep research.
- The plan lacks response-quality evaluation: correctness, relevance, brevity, tool-choice quality, and whether the assistant actually solves collector tasks.
- There is no end-to-end latency budget for first acknowledgment, first meaningful status, first token, and completion.
- There is no transcript usability policy for copying, selecting, reopening details, or distinguishing completed versus still-running work.
- There is no explicit session concurrency policy: double-send, two tabs, reopening chat during a pending approval, or a new request while a deep tool runs.
- The approval interaction remains framed primarily as a card redesign when it is fundamentally a trust transaction.
- Phase G is an idea menu, but the pass lacks structured usability testing with representative collectors performing real tasks.
- Conversation persistence is owner-approved out of scope and must remain so, but its absence means this pass alone cannot reasonably claim the entire chat product is world-class. It can claim a world-class active-session experience if the other control/recovery gaps are addressed.

I would define top-level experience targets before implementation:

- Immediate acknowledgment after send.
- No unexplained silence longer than a small fixed threshold.
- Every autonomous action visible, cancellable, and attributable.
- Every failure produces an actionable recovery path.
- Approval shows the exact immutable commit payload.
- Direct navigation succeeds reliably without needless choreography.
- Guided navigation never fights user input.
- The agent’s answer is evaluated separately from whether its animation looked good.

---

## 4. Missing error, empty, and edge states

The plan should explicitly cover:

- 3D runtime load failure, timeout, offline state, and retry.
- User closes chat while runtime is loading or entry animation is running.
- User opens, closes, and reopens rapidly.
- WebGL unavailable, context lost, low-memory termination, or asset decode failure.
- Reduced-motion toggled while the app is already open.
- Deep research cancelled, timed out, disconnected, or returns no text.
- Tool progress events arriving after the associated message has completed.
- Duplicate, missing, or out-of-order streaming events.
- Multiple parallel tools completing in a different order from their start order.
- Empty assistant response after tools complete.
- Markdown renderer chunk failing to load.
- Enormous tables/code blocks or malformed links in both chat surfaces.
- Journey target absent because of permissions, entitlement, responsive layout, virtualization, renamed data, or an empty collection.
- Journey destination already current.
- Journey click opens an external URL, new tab, dialog, or disabled element.
- User input during journey cancellation, including keyboard and touch.
- Journey interrupted by chat close, logout, route guard, or deployment refresh.
- Pending approval survives—or intentionally does not survive—chat close and reopen.
- Multiple simultaneous approvals.
- Partial approval with zero known rows.
- All rows removed.
- Picker candidate list empty or stale.
- Variant disappears or inventory changes between dry-run and commit.
- New approval payload differs from the edited preview.
- Commit succeeds for some rows and fails for others, if atomicity is not guaranteed.
- User presses Accept twice or reconnects after an uncertain commit result.
- Composer keyboard behavior, mobile viewport resizing, and IME composition.
- Transcript scrolled away while tokens, progress events, approval cards, or action rows arrive.
- Screen-reader announcement rate during streaming and cycling status text.
- Character keep-out constraints leave no legal position on a very small viewport.

---

## 5. Verification gaps

The verification doctrine is excellent for visible behavior, but the plan needs additional gates.

### Required before Phase F

- Signature-bound input remains immutable.
- Edited selections produce a new signed approval for the exact new payload.
- Partial acceptance cannot commit excluded rows.
- Every pending approval can be independently resolved or the UI prevents simultaneous independent choices.
- Double-submit and replay remain idempotent.
- Inventory changes between dry-run and commit are detected.
- The accepted UI summary exactly matches committed rows and variants.

### Required before Phase E

- Typed journey schema rejects arbitrary selectors and disallowed routes.
- No marked clickable element can initiate a write.
- Programmatic clicks do not trigger user-cancellation logic.
- Real user input always cancels within a bounded time.
- Only one journey can own movement at once.
- Closing chat and submitting a new request terminate the old journey.
- Stale DOM cannot satisfy post-navigation waits.
- Failure emits exactly the steps actually executed.
- Cancelled and unreached steps emit no success rows.
- Reduced motion still performs navigation and truthful highlighting.
- Direct “take me” remains direct.
- “Help me find” uses escort behavior.
- Back returns to a sensible journey origin.

### Required for liveness

- Time to first acknowledgment.
- Maximum interval without a visible status change.
- Long-running tool cancellation.
- Timeout and reconnect behavior.
- Structured provider parts versus raw text-stream semantics.
- No internal reasoning or unsafe provider trace is exposed.
- Status claims are derived from actual events.

### Required for shell/rendering

- Keyboard-only and screen-reader testing, not merely roles added in code.
- Focus trap/return behavior.
- Live-region policy that does not announce every token.
- Safari/iOS, Chromium Android, desktop Chromium, and preferably Firefox.
- Slow network, offline transition, failed lazy chunk, and WebGL-disabled modes.
- Mobile keyboard open/close and orientation changes.
- High zoom, large text, narrow desktop, and very short viewport.
- Contrast testing over variable blurred page content.
- Markdown URL-policy tests.

### Product-level verification

The 17 gates prove mechanics, not whether the assistant is excellent. Add a scenario set scored independently for:

- Task success.
- Factual accuracy.
- Appropriate tool choice.
- Unnecessary movement/tool calls.
- Brevity.
- Recovery quality.
- Approval comprehension.
- Perceived responsiveness.

Use representative collector tasks and blind review where practical. Visual judgment cannot substitute for answer-quality evaluation.

I could not verify whether the existing gates, visual harness, CI wiring, accessibility setup, or SDK continuation behavior already cover any of these.

---

## 6. What must not change

- Do not weaken or bypass the SDK’s signed approval boundary.
- Do not replay modified input with an old signature.
- Do not silently turn a partial selection into approval of the original batch.
- Do not change `pickVariant`’s existing status semantics globally to implement the card.
- Do not let model prose create status or action rows.
- Do not expose raw internal reasoning as “thinking.”
- Do not make arbitrary CSS selectors a model-controlled click capability.
- Do not mark write controls as Deck-E-clickable.
- Do not regress the existing direct “take me to it” behavior while adding escort intent.
- Do not make reduced motion mean reduced functionality.
- Do not restore automatic 3D loading.
- Do not precache the Deck-E runtime accidentally.
- Do not blur the header or sidebar contrary to OR1.
- Do not add a confidence number contrary to OR4.
- Do not add photo input, conversation persistence, payload reduction, or a model reversal against the owner’s scope rulings.
- Do not interpret navigation cancellation as permission for the model to resume automatically.
- Do not claim “world-class” solely from green visual and network gates; task quality, control, recovery, and trust must also pass.

The central recommendation is simple: proceed with A–D after tightening their contracts, but redesign F before implementation and specify E as a secure, cancellable state machine rather than merely a batched command array.
tokens used
22,028
## 1. Verdict — green-light with changes

The plan has unusually strong diagnosis, traceability, and visual intent. I would not green-light implementation as written, however. Phase F contains a protocol-level contradiction with the verified approval implementation, and Phase E lacks a sufficiently precise execution/security contract for autonomous journeys.

Those areas need redesign before code starts. The visual, lifecycle, rendering, and most liveness work can proceed after the smaller issues below are resolved.

I had no filesystem access and therefore could not independently verify any unlisted file, behavior, line reference, harness, or research claim. Findings relying only on the supplied plan are marked unverified where appropriate.

---

## 2. Ranked correctness findings

### BLOCKER — F1 cannot work through the existing approval protocol

The proposed approval card allows:

- Removing individual rows.
- Selecting or changing variants.
- Accepting only section 1.
- Leaving ambiguous rows uncommitted.

But the verified implementation has two incompatible properties:

1. `settle(approved)` resolves every pending approval to the same boolean.
2. Replay sends the original, unmodified input.
3. The SDK signature binds that exact input cryptographically.

Consequently, the proposed UI cannot alter a variant, remove a row, or approve a subset and then replay the existing approval. Doing so either commits the original batch or invalidates the signature.

This is not “~80% built.” The visual portion may be mostly built, but the interaction described by OR4 requires a new approval transaction design.

What I would do instead:

- Keep the original approval request immutable.
- Treat row edits and picker choices as preparation of a new proposed write.
- Reject/cancel the original held request.
- Construct a new exact commit input containing only selected rows and resolved variants.
- Run a new dry-run and obtain a newly signed approval request for that exact input.
- Show a final approval action whose label explicitly states what will be committed, such as “Add 7 confirmed cards.”
- Alternatively, issue independently signed approval requests per row, but that risks prompt fatigue and likely produces a worse experience.

Do not hide the second authorization step or reuse the old signature. The commit payload visible to the user must be exactly the payload covered by the approval being accepted.

### BLOCKER — F1’s provenance model does not actually identify all rows needing a picker

The plan says not to change `pickVariant` status semantics. That is reasonable. But the proposed field:

```ts
variantSource: 'stated' | 'defaulted' | 'ambiguous'
```

does not by itself implement the owner’s design.

An omitted variant may currently be silently defaulted to the primary variant even when several variants exist. That is precisely the case where the owner expects “What was the variant on these?” Yet:

- Its status remains resolved.
- Its source becomes `defaulted`, not `ambiguous`.
- The plan only promises candidate arrays for existing `ambiguous` results.

Thus a defaulted multi-variant row may have no candidate data for the picker and may still be treated as known.

What I would do instead:

- Preserve existing resolution status semantics.
- Add independent provenance and candidate metadata to dry-run rows:
  - `variantSource`
  - `variantCandidates`
  - `variantSelectionRequired`
  - possibly `selectedVariantId`
- Define classification explicitly:
  - Explicit variant: known.
  - Omitted, exactly one candidate: known.
  - Omitted, multiple plausible candidates: selection required, even if legacy resolution internally chose the primary.
  - Existing semantic ambiguity: selection required.
- Ensure the dry-run summary never presents a silently defaulted multi-variant row as confidently known.

### MAJOR — E8 needs a concrete client-tool lifecycle contract

The journey description says execution will stop on failure and “hand back to the model for a fresh turn.” It does not specify how that happens through the AI SDK lifecycle:

- Is `journey` a client tool whose result is submitted as a tool-result part?
- Does submission automatically continue the same response?
- Is failure a new user-visible turn or another model step?
- How are cancellation and route unmount distinguished from tool failure?
- What prevents two journeys from executing concurrently?
- What happens if the chat is closed during a journey?
- What happens if the stream disconnects after the plan arrives but before its result is submitted?

These are correctness issues, not implementation details. The transcript ordering work in E5 also depends on this contract.

What I would do instead:

Define a journey state machine before implementation:

```text
planned → running(step n) → completed
                         ↘ failed
                         ↘ cancelled-by-user
                         ↘ cancelled-by-close
                         ↘ superseded
```

Every terminal state should produce exactly one tool result. Only `failed` should invite model recovery automatically; a user cancellation should not cause the agent to resume moving without a new request.

### MAJOR — The journey tool should not accept arbitrary CSS selectors

Predictable landmark selectors make planning possible, but accepting model-produced selector strings expands the control surface unnecessarily. CSS escaping, selector injection, selector collisions, and future markup changes become part of the security boundary.

What I would do instead:

Use typed semantic targets, for example:

```ts
{ kind: 'nav', route: '/series' }
{ kind: 'series', slug: 'mega-evolution' }
{ kind: 'set', setId: 'me05' }
```

The trusted client converts those into selectors. Validate route, slug, and ID formats, and retain the existing click allowlist. Raw selectors should not cross the model/tool boundary.

The static clickable audit is helpful, but it does not replace a runtime authorization policy.

### MAJOR — “Any user click or scroll cancels” needs trusted-event semantics

Journey steps themselves invoke `el.click()` and may cause scrolling. A naïve global click/scroll listener could cancel the journey because of its own actions.

What I would do instead:

- Cancel only on trusted user input (`event.isTrusted`) where available.
- Separate programmatic scrolling from user scroll intent.
- Include pointer, wheel, touch, keyboard navigation, and scroll-container interactions.
- Abort through one shared `AbortController`.
- Remove listeners reliably across route changes and unmounts.
- Verify that clicking chat controls—close, stop, composer, approval—also cancels appropriately.

This finding is unverified against the existing event code because I could not inspect it.

### MAJOR — D5’s blanket `replace: true` is not necessarily correct history behavior

Replacing every Deck-E navigation prevents history spam, but it can also destroy the user’s expected ability to return to the page where the request began.

For a multi-hop escort, intermediate pages should not become five Back-button entries. But the journey’s starting location is meaningful.

What I would do instead:

- Preserve the journey origin.
- Replace intermediate hops.
- Make the final destination one coherent history transition.
- For a direct “take me to X,” ordinarily push once, unless there is an established product rule to replace.
- Add Back-button tests for direct jumps, successful journeys, failed journeys, and cancelled journeys.

“Deck-E navigation always replaces” should not be recorded as a decision until this UX is settled.

### MAJOR — A7 should be lifecycle-driven, not dependent on an `express` model call

The thinking-to-answering transition is deterministic application state. If the model must remember to call `express`, the emotion beat will be inconsistent and will consume tool capacity for a basic UI response.

What I would do instead:

Trigger a short host-side expression when the first answer token arrives after thinking. Allow an explicit model expression to override it where appropriate, but make the baseline transition automatic, reduced-motion-aware, and interruptible.

### MAJOR — D1 risks exposing sub-agent prose as internal process

Forwarding `textStream` deltas into an expandable “thinking” row may surface prose that was not designed for users, may repeat the final answer, or may imply access to hidden reasoning. The plan correctly says it is not Deck-E’s voice, but placement alone does not make raw output suitable.

What I would do instead:

- Prefer structured provider events: search started, source received, analysis still running, completed.
- If only text is available, do not label it as “thoughts.”
- Treat it as research output or a live draft only after checking its semantics.
- Never expose hidden chain-of-thought or provider-internal traces.
- Use an honest elapsed-time heartbeat when no structured progress exists: “Analysis still running · 42s.”
- Give the user a Stop action during long operations.

The claim that provider parts are available is explicitly a probe and remains unverified.

### MAJOR — E8’s route wait can succeed against stale DOM

Waiting for a selector after a click is insufficient if that selector already existed before navigation, remains in a persistent shell, or belongs to an outgoing route during transition.

What I would do instead:

Each navigation step should wait for both:

- An expected route/location or route generation change.
- A target landmark attached to the current route and visibly actionable.

The bounded wait should distinguish timeout, route mismatch, target absent, target hidden, and target disabled. Six seconds may be too short on the slow connections explicitly anticipated elsewhere; use a measured budget and visible progress.

### MAJOR — Markdown needs an explicit safety and interaction policy

`react-markdown` is a good base, but “wire it into both surfaces” is incomplete for agent-generated content.

Specify:

- No raw HTML.
- Link protocol allowlist.
- External-link behavior.
- Whether images are prohibited.
- Code-block overflow on mobile.
- Long unbroken content handling.
- Table overflow and accessibility.
- Selection/copy behavior inside the floating bubble.
- Lazy-load fallback so streamed text does not disappear while the renderer loads.

This is unverified against the existing `MarkdownView` configuration.

### MINOR — The sequence contradicts itself about E8 readiness

Section 7 says the one-plan design is established and “not speculative.” Section 10 says “Measure E8 first.” It is unclear what measurement could reject the architecture and what acceptance thresholds apply.

Define the spike explicitly before dependent message-model work:

- Reliable completion rate.
- Median and worst-case journey duration.
- Cancellation behavior.
- Route/selector wait success.
- Recovery-turn behavior.
- Transcript event ordering.
- Accessibility and reduced-motion behavior.

### MINOR — X1’s list of 19 enforcement sites is brittle

A fixed list of known animation sites can immediately become incomplete as this pass adds new animations.

Add an enduring reduced-motion review/test strategy rather than relying only on the enumerated sites. Test motion libraries, CSS animation, canvas/three.js motion, smooth scrolling, highlight chasing, loading animation, and newly introduced thinking indicators.

### MINOR — C2’s “small presentation stagger” must not imply false chronology

If parallel tools start together, visually staggering them can suggest they happened sequentially. Preserve accurate timestamps/order and stagger only entrance animation, not semantic placement or status timing.

---

## 3. World-class gap analysis

This is a strong experience-remediation plan, but it is not yet a complete plan for a world-class agent chat.

It invests heavily in mascot choreography, visual polish, and complaint closure. The larger gaps are control, recovery, trust, and evaluation:

- There is no clear Stop generating / Stop research / Stop journey design.
- No retry or recovery experience is specified for stream loss, tool timeout, tool failure, offline state, or client-tool desynchronization.
- User interruption while the assistant is streaming is discussed only for journeys, not ordinary answers or deep research.
- The plan lacks response-quality evaluation: correctness, relevance, brevity, tool-choice quality, and whether the assistant actually solves collector tasks.
- There is no end-to-end latency budget for first acknowledgment, first meaningful status, first token, and completion.
- There is no transcript usability policy for copying, selecting, reopening details, or distinguishing completed versus still-running work.
- There is no explicit session concurrency policy: double-send, two tabs, reopening chat during a pending approval, or a new request while a deep tool runs.
- The approval interaction remains framed primarily as a card redesign when it is fundamentally a trust transaction.
- Phase G is an idea menu, but the pass lacks structured usability testing with representative collectors performing real tasks.
- Conversation persistence is owner-approved out of scope and must remain so, but its absence means this pass alone cannot reasonably claim the entire chat product is world-class. It can claim a world-class active-session experience if the other control/recovery gaps are addressed.

I would define top-level experience targets before implementation:

- Immediate acknowledgment after send.
- No unexplained silence longer than a small fixed threshold.
- Every autonomous action visible, cancellable, and attributable.
- Every failure produces an actionable recovery path.
- Approval shows the exact immutable commit payload.
- Direct navigation succeeds reliably without needless choreography.
- Guided navigation never fights user input.
- The agent’s answer is evaluated separately from whether its animation looked good.

---

## 4. Missing error, empty, and edge states

The plan should explicitly cover:

- 3D runtime load failure, timeout, offline state, and retry.
- User closes chat while runtime is loading or entry animation is running.
- User opens, closes, and reopens rapidly.
- WebGL unavailable, context lost, low-memory termination, or asset decode failure.
- Reduced-motion toggled while the app is already open.
- Deep research cancelled, timed out, disconnected, or returns no text.
- Tool progress events arriving after the associated message has completed.
- Duplicate, missing, or out-of-order streaming events.
- Multiple parallel tools completing in a different order from their start order.
- Empty assistant response after tools complete.
- Markdown renderer chunk failing to load.
- Enormous tables/code blocks or malformed links in both chat surfaces.
- Journey target absent because of permissions, entitlement, responsive layout, virtualization, renamed data, or an empty collection.
- Journey destination already current.
- Journey click opens an external URL, new tab, dialog, or disabled element.
- User input during journey cancellation, including keyboard and touch.
- Journey interrupted by chat close, logout, route guard, or deployment refresh.
- Pending approval survives—or intentionally does not survive—chat close and reopen.
- Multiple simultaneous approvals.
- Partial approval with zero known rows.
- All rows removed.
- Picker candidate list empty or stale.
- Variant disappears or inventory changes between dry-run and commit.
- New approval payload differs from the edited preview.
- Commit succeeds for some rows and fails for others, if atomicity is not guaranteed.
- User presses Accept twice or reconnects after an uncertain commit result.
- Composer keyboard behavior, mobile viewport resizing, and IME composition.
- Transcript scrolled away while tokens, progress events, approval cards, or action rows arrive.
- Screen-reader announcement rate during streaming and cycling status text.
- Character keep-out constraints leave no legal position on a very small viewport.

---

## 5. Verification gaps

The verification doctrine is excellent for visible behavior, but the plan needs additional gates.

### Required before Phase F

- Signature-bound input remains immutable.
- Edited selections produce a new signed approval for the exact new payload.
- Partial acceptance cannot commit excluded rows.
- Every pending approval can be independently resolved or the UI prevents simultaneous independent choices.
- Double-submit and replay remain idempotent.
- Inventory changes between dry-run and commit are detected.
- The accepted UI summary exactly matches committed rows and variants.

### Required before Phase E

- Typed journey schema rejects arbitrary selectors and disallowed routes.
- No marked clickable element can initiate a write.
- Programmatic clicks do not trigger user-cancellation logic.
- Real user input always cancels within a bounded time.
- Only one journey can own movement at once.
- Closing chat and submitting a new request terminate the old journey.
- Stale DOM cannot satisfy post-navigation waits.
- Failure emits exactly the steps actually executed.
- Cancelled and unreached steps emit no success rows.
- Reduced motion still performs navigation and truthful highlighting.
- Direct “take me” remains direct.
- “Help me find” uses escort behavior.
- Back returns to a sensible journey origin.

### Required for liveness

- Time to first acknowledgment.
- Maximum interval without a visible status change.
- Long-running tool cancellation.
- Timeout and reconnect behavior.
- Structured provider parts versus raw text-stream semantics.
- No internal reasoning or unsafe provider trace is exposed.
- Status claims are derived from actual events.

### Required for shell/rendering

- Keyboard-only and screen-reader testing, not merely roles added in code.
- Focus trap/return behavior.
- Live-region policy that does not announce every token.
- Safari/iOS, Chromium Android, desktop Chromium, and preferably Firefox.
- Slow network, offline transition, failed lazy chunk, and WebGL-disabled modes.
- Mobile keyboard open/close and orientation changes.
- High zoom, large text, narrow desktop, and very short viewport.
- Contrast testing over variable blurred page content.
- Markdown URL-policy tests.

### Product-level verification

The 17 gates prove mechanics, not whether the assistant is excellent. Add a scenario set scored independently for:

- Task success.
- Factual accuracy.
- Appropriate tool choice.
- Unnecessary movement/tool calls.
- Brevity.
- Recovery quality.
- Approval comprehension.
- Perceived responsiveness.

Use representative collector tasks and blind review where practical. Visual judgment cannot substitute for answer-quality evaluation.

I could not verify whether the existing gates, visual harness, CI wiring, accessibility setup, or SDK continuation behavior already cover any of these.

---

## 6. What must not change

- Do not weaken or bypass the SDK’s signed approval boundary.
- Do not replay modified input with an old signature.
- Do not silently turn a partial selection into approval of the original batch.
- Do not change `pickVariant`’s existing status semantics globally to implement the card.
- Do not let model prose create status or action rows.
- Do not expose raw internal reasoning as “thinking.”
- Do not make arbitrary CSS selectors a model-controlled click capability.
- Do not mark write controls as Deck-E-clickable.
- Do not regress the existing direct “take me to it” behavior while adding escort intent.
- Do not make reduced motion mean reduced functionality.
- Do not restore automatic 3D loading.
- Do not precache the Deck-E runtime accidentally.
- Do not blur the header or sidebar contrary to OR1.
- Do not add a confidence number contrary to OR4.
- Do not add photo input, conversation persistence, payload reduction, or a model reversal against the owner’s scope rulings.
- Do not interpret navigation cancellation as permission for the model to resume automatically.
- Do not claim “world-class” solely from green visual and network gates; task quality, control, recovery, and trust must also pass.

The central recommendation is simple: proceed with A–D after tightening their contracts, but redesign F before implementation and specify E as a secure, cancellable state machine rather than merely a batched command array.
