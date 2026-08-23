# R8 — Agent UX Patterns for Deck-E

Deep design research feeding an implementation plan for DeckPal's mascot assistant, Deck-E. Every claim is tagged **[VERIFIED — url]** when traced to a primary or clearly-cited source, **[SECONDARY]** when it rests on a well-corroborated but non-primary source (blog synthesis, aggregated reporting), or **[SYNTHESIS]** when it is this document's own inference connecting verified facts. No repo changes were made in the course of this research.

---

## 1. Progressive disclosure of long-running agent work

### Claude Code (CLI)
Claude Code's task tool moves each todo through `pending → in_progress → completed` (plus `deleted`), and each todo carries both a `subject` ("Fix auth bug") and an `activeForm` ("Fixing auth bug") — the UI swaps to the present-continuous `activeForm` while a todo is active, producing a live "currently doing X" line. **[VERIFIED — https://code.claude.com/docs/en/agent-sdk/todo-tracking]** Todos are created only for genuinely multi-step work (3+ distinct actions, explicit user lists, long operations) and are explicitly skipped for short/single-step requests — the mechanism is granularity-gated, not always-on. **[VERIFIED — same]** On newest-generation models these task tools are now off by default in the Agent SDK, because the models "track multi-step work without a written todo list" — the visible artifact is optional plumbing, not a hard requirement. **[VERIFIED — same]**

Per multiple independent reverse-engineering write-ups (unofficial, but convergent), each tool call is prefixed with a `⏺`/`●` bullet, its result trails beneath an `⎿` connector, and a spinner cycles frames while running. **[SECONDARY — https://claude-code-from-source.com/ch13-terminal-ui/, https://kotrotsos.medium.com/claude-code-internals-part-11-terminal-ui-542fe17db016]** Anthropic's own system-prompt text instructs the model to write a short **past-tense summary label** for completed tool calls in mobile UI rows — present tense while pending, past tense once done. **[SECONDARY — https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f]** An open feature request confirms tool output is expanded by default today; collapsing-by-default is still just a request. **[VERIFIED — https://github.com/anthropics/claude-code/issues/40428]**

### Claude.ai (extended thinking)
Extended thinking is a distinct `thinking` content block that streams ahead of the final answer; in-product it renders as a single collapsible "Thinking" section the user can expand to watch stream live. **[VERIFIED — https://docs.claude.com/en/docs/build-with-claude/extended-thinking]** Unlike Claude Code's itemized checklist, this is one big collapsed block — the anti-dead-air mechanism is *streaming the reasoning tokens themselves* into a de-emphasized region, not summarizing into discrete status lines. **[SYNTHESIS]**

### ChatGPT o-series
OpenAI's o-series models "think before they answer" but OpenAI deliberately does **not** show raw chain-of-thought, showing only model-generated summaries instead (stated safety/competitive rationale). **[VERIFIED — https://openai.com/index/introducing-openai-o1-preview/, https://openai.com/index/o3-o4-mini-system-card/]** The widely-screenshotted rotating italic status lines ("Analyzing data…") that update every few seconds are real, well-known product behavior, but no OpenAI primary doc specifying their exact cadence/copy convention was found — flagged explicitly as **observed behavior, not verified**. Design bet: rotating short gerund phrases as a pure liveness signal, cheaper to build than a full collapsed trace, while deliberately withholding actual reasoning content. **[SYNTHESIS]**

### Perplexity — the strongest empirical case study found
Perplexity's own engineering team found, empirically, that **users were more willing to wait for results when shown intermediate progress** — this finding is what justified the step-by-step UI investment. **[VERIFIED — https://www.langchain.com/breakoutagents/perplexity]** Mechanically: the system plans first (a step-by-step breakdown), then executes searches per step, streaming results into the UI with expandable per-step sections. **[VERIFIED — same; https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search]** Lead engineer William Zhang's stated philosophy: **"You don't want to overload the user with too much information until they are actually curious. Then, you feed their curiosity."** **[VERIFIED — same LangChain source]** The default view is a compact step list; expansion is a deliberate user click, never automatic — a clean two-tier progressive-disclosure structure.

### Cursor / Windsurf (now "Devin Desktop")
Cursor's Agent mode chains dozens of tool calls, streams diffs live into a reviewable/rejectable view, and (2026) adds Background Agents, Subagents, and Plan Mode for pre-execution review. **[VERIFIED — https://cursor.com/help/ai-features/agent]** Pixel-level chip/row treatment is **not documented** in Cursor's own docs — flagged as unverifiable at that granularity.

Windsurf has been folded into Cognition as "Devin Desktop"; its Cascade agent creates an in-conversation **Todo list** (same pattern family as Claude Code), up to 20 tool calls per prompt, per-turn revert/checkpoint, and a Write vs. Chat mode split (apply directly vs. propose-for-review). **[VERIFIED — https://docs.devin.ai/desktop/cascade/cascade]**

### Devin (Cognition Labs)
Devin's UI shows plan, editor, shell, and browser panels live and simultaneously; the planner emits an initial milestone plan and **updates it dynamically** as work reveals new information (re-planning, not a static checklist), with an accordion work-log the user can open per completed step. **[VERIFIED direction — https://cognition.com/blog/devin-2; SECONDARY mechanism detail — https://medium.com/@nitinmatani22/how-devin-ai-actually-thinks-autonomous-planning-dag-execution-and-dynamic-re-planning-explained-997be175a475]** Devin 2.0 responds within seconds with a preliminary, user-editable plan before committing to execution — a plan-approval gate distinct from live-execution transparency. **[VERIFIED — https://cognition.com/blog/devin-2]**

### Vercel v0
v0's API streams an ordered list of typed `parts` — text, thinking, file reads/edits, searches, bash, tool calls, agent actions. Vercel's own framing: **"the same object can drive a one-line status, a changed-files view, or the full trace"** — disclosure granularity is a client rendering decision, not baked into model output. **[VERIFIED — https://vercel.com/blog/introducing-the-new-v0-api]** v0 also spins up a live dev server per generation and hands back a real preview URL, resolving "dead air" by giving the user something concrete to look at rather than only text status. **[VERIFIED — same]**

### Linear (Agent Sessions) — the most rigorously specified model found
A Linear Agent Session moves through six explicit, auto-inferred states: `pending`, `active`, `awaitingInput`, `error`, `complete`, `stale`. **[VERIFIED — https://linear.app/developers/agent-interaction]** Agents communicate via five typed **Activity** kinds: **Thought** (internal reasoning, markable ephemeral), **Action** (tool call with a start-form/complete-form verb pair, e.g. "Searching" → "Searched"), **Elicitation** (a clarification request that flips state to `awaitingInput`), **Response** (final Markdown output), **Error** (failure + optional remediation link). **[VERIFIED — same]** Critically, Thought/Action activities can be marked **ephemeral** — shown temporarily, vanishing once superseded — a clean mechanism for transient "currently doing X" state without permanently bloating the log. **[VERIFIED — same]** Liveness is enforced at the *protocol* level: agents must ack within 5s and emit activity within 10s or the session flips to `stale`. **[VERIFIED — same]** A technology-preview "Agent Plans" feature adds a session-level checklist the agent freely mutates as it discovers more work. **[VERIFIED — same]**

### Transferable rules — Topic 1
- Separate **ambient liveness** (spinner/status line: "is it still alive?") from **structured progress** (todo/plan list: "what will it do, how far along?"). Ship both.
- Model status as **ephemeral vs. durable**, not just expanded/collapsed — most "currently doing X" narration doesn't need to survive past the next update (Linear's ephemeral Activities).
- Design the event stream as **one typed, ordered log** that can render at multiple densities (v0's `parts` model) rather than separate compact/verbose code paths.
- Default collapsed, but the label must be **specific and honest** ("Searching your collection for Charizard cards"), never vague filler ("Working on it…").
- Users tolerate latency measurably better when shown real intermediate progress — this is Perplexity's own empirical justification, not aesthetics.
- Gate progressive disclosure to genuinely multi-step work; a checklist for a single tool call reads as noise.
- Give an **escalation path** (click to expand a step, approve a plan) rather than one fixed verbosity for everyone.
- If work spans processes (webhooks, subagents), enforce liveness **at the protocol level** (ack/heartbeat timers, an explicit "stale" state) — don't leave dead air to be purely a rendering problem.

---

## 2. Latency perception

### Classic response-time thresholds
Nielsen/NN Group's three tiers remain foundational: **0.1s** = feels instantaneous, no special feedback needed; **1.0s** = the ceiling for uninterrupted flow of thought (delay noticed, causality intact, still no special feedback required below this); **10s** = the ceiling for keeping attention on the task at all — beyond this, users mentally context-switch away, and Nielsen's guidance is explicit: show **percent-done, a way to cancel, and continuous feedback naming what's happening**. **[VERIFIED — https://www.nngroup.com/articles/response-times-3-important-limits/]**

NN Group's progress-indicator research found users given a progress bar **tolerated roughly 3x longer waits and reported higher satisfaction** than users given nothing — stronger still when the indicator carries explanatory text ("Loading comments…") rather than a bare bar. **[VERIFIED — https://www.nngroup.com/articles/progress-indicators/]** Their four-part acceptability test for any wait: does the user understand **what's happening, why it's taking time, roughly how long it will last, and whether they need to do anything**.

### Time-to-first-feedback for AI chat
No single canonical academic source exists for TTFT specifically (it's an LLM-serving industry term), but the applied guidance maps cleanly onto Nielsen's bands: TTFT is functionally the AI-chat analogue of "feels instantaneous" — once the first token appears, attention shifts from "is it alive?" to "what is it saying?" **[SYNTHESIS, consistent with Nielsen's framework]** Cited industry figures: a 300ms streamed TTFT reads as fine even in a 4-second total response; a 4-second TTFT with an instant flush at the end reads as **broken** despite identical total latency. **[SECONDARY]** Practical target: **≤1.0s** to any visible state change after send; first streamed token/status well under the **10s** attention-loss ceiling, ideally 0.3–1.5s. **[SYNTHESIS]**

### Skeleton vs. spinner vs. streaming
NN Group's "Skeleton Screens 101": both skeletons and spinners are appropriate in the **2–10 second** load band; below ~1s, show neither (a skeleton that resolves almost instantly flickers and disrupts more than it helps); beyond 10s, neither suffices — that needs a real progress bar per Nielsen's 10-second rule. **[VERIFIED — https://www.nngroup.com/articles/skeleton-screens/]** NN Group explicitly warns against "frame-display" skeletons that leave content area empty — a proper skeleton must approximate real content shape. **[VERIFIED — same]** Spinners suit isolated components; skeletons suit whole-screen loads, because the wireframe shape lets the brain pre-map incoming layout. **[VERIFIED — same]** Streaming text is not really competing in this space at all — it converts the entire wait into continuous real content plus the labor-illusion mechanism (below), which better satisfies the four-part acceptability test than either static placeholder. **[SYNTHESIS]**

### Optimistic UI
Canonical pattern: render the action as already succeeded, reconcile or roll back on failure (messaging apps show a sent message instantly; Kanban boards move a dragged card instantly). **[SECONDARY, well-established]** Linear's version is architecturally stronger than typical fire-then-rollback: writes land in a local store immediately (no network round trip in the critical path) via a local-first sync engine, with background reconciliation over WebSocket — the "optimistic" state effectively *is* the primary state. **[SECONDARY — multiple corroborating technical write-ups of Linear's public engineering talks/blog]**

### Keeping a 30–90s operation alive
1. **Progress indicators empirically extend tolerance ~3x** (NN Group, above) — the strongest justification for investing in a visible "what Deck-E is doing" panel at all.
2. **The Labor Illusion**: making real work visible increases perceived value and wait tolerance (Kayak's "checking 264 websites" is the canonical example) — but this **only works when the shown work is real**; fabricated progress erodes trust the moment it's caught. **[SECONDARY, widely attested, sometimes traced to Buell & Norton's operational-transparency research]**
3. **Occupied vs. unoccupied time**: engaged/informed waiting is judged as up to ~30% shorter than idle waiting. **[SECONDARY]**
4. **ChatGPT Deep Research**'s implementation is directly relevant prior art: on-screen step-by-step narration of exactly what the agent is doing, real-time trackable progress, and mid-task interrupt-to-redirect — implemented by streaming the entire agent trace to the client, not just the final answer. **[VERIFIED — https://openai.com/index/introducing-deep-research/, https://openai.com/index/introducing-chatgpt-agent/]**
5. **Incremental/partial results** are the strongest single technique because they satisfy the labor-illusion and progress-indicator mechanisms *simultaneously with actual utility* — the user consumes real intermediate output, not a progress proxy.

### Transferable rules — Topic 2
- Target **≤1.0s** from send to any visible state change (composer disables, thinking indicator appears).
- Target first streamed token/status **well under 10s**; treat 10s of total silence as an automatic UX failure.
- Never show a skeleton/spinner for anything resolving in **<1s** — it flickers and feels worse than nothing.
- Use a **skeleton** (not spinner) when a whole message/view is being constructed and its shape is approximable; use a spinner only for small isolated widgets (an embedded card preview).
- Once tokens stream, retire loading chrome entirely — streaming text *is* the progress indicator.
- For any tool-call sequence **>10s**, show present-tense narration of the current step, an elapsed-time or step counter, and an explicit cancel/interrupt control.
- Never fabricate step narration that doesn't correspond to real work.
- Apply low-risk, easily-reversible user actions **optimistically** (instant UI + quiet server confirm + undo toast); require explicit confirmation for destructive/hard-to-reverse actions — do not go optimistic there.

---

## 3. Tool-call chip design

### What actually renders, by product
**Claude Code**: `⏺`/`●` bullet per call, `⎿` result connector, cycling spinner while running, tense-flip label (present → past) on completion. **[SECONDARY, convergent reverse-engineering]** Tool output is expanded by default; collapsing is a pending feature request. **[VERIFIED — https://github.com/anthropics/claude-code/issues/40428]**

**Claude.ai**: thinking is one collapsible block *before* the answer — not one row per sub-thought, so there's no chip/row question for thinking itself. **[VERIFIED — https://docs.claude.com/en/docs/build-with-claude/extended-thinking]**

**ChatGPT**: no primary OpenAI source specifies the visual chip/row treatment for tool invocations in the consumer product; the well-known inline "Searched the web" label is public/observed behavior, not independently verified. When ChatGPT hosts an MCP-based widget it renders as an iframe over postMessage/JSON-RPC — a different, heavier mechanism than a lightweight status chip. **[VERIFIED — https://developers.openai.com/apps-sdk/build/chatgpt-ui/]**

**GitHub Copilot Workspace**: the one product researched with primary docs specifying structure at the plan level — a Plan panel lists every file to be touched, each with a bullet list of specific actions, fully editable pre-execution, with the ability to select files and request targeted re-implementation. **Grouped by file**, not by tool call. **[VERIFIED — https://github.com/githubnext/copilot-workspace-user-manual/blob/main/changes.md]**

### The one detailed design case study found
A merged pull request against **OpenClaw** (open-source, third-party — not one of the flagship products, but the only primary source that articulates *why* certain visual treatments read as "status" vs "button") documents fixing "triple-nested cards": an outer card, a per-message card, and gradient/shadow chrome on the summary pill, such that "a single 8-tool activity group fills an entire viewport." **[VERIFIED — https://github.com/openclaw/openclaw/pull/99763]** The fix and resulting vocabulary:
- Collapsed rows become **flat single lines**: chevron + tool icon + label + monospace detail, ellipsized.
- Sequential calls **group under one clickable header**, body indicated by a **thin left rule**, not a card border.
- Expanded detail stays **soft-tinted, chrome-free** inline text.
- Chrome (card/border/shadow) is reserved for content that is genuinely a **different rendering surface** (a diff, a canvas preview) — never for status text.
- **Errors stay visually loud on purpose**: red icon/badge, auto-expanded rather than collapsed like a success.
- Net measured effect: an 8-tool group went from a full screen of stacked cards to a few compact rows. **[VERIFIED — same PR]**

### Synthesis across all products
- **Ordering**: everywhere structure could be confirmed (Claude Code, Claude.ai, Linear, v0, Copilot Workspace), tool activity precedes the prose it informs — never interleaved mid-sentence, never appended after. **[SYNTHESIS]**
- **"Status not button" visual cues that recur**: no drop shadow/elevation, no saturated fill, monospace/muted type for detail, an icon naming the tool *type* not an action verb, and the only interactive affordance being a single expand chevron. **[SYNTHESIS from Linear + OpenClaw + Claude Code conventions]**
- **Grouping key** varies by product but is always present once there's more than one step: Copilot Workspace groups by file, Linear by plan item, Claude Code by todo, OpenClaw by activity group.
- **Three-state model, asymmetric by severity**: pending (spinner, present tense) → completed (past tense, collapses to one line) → failed (color change, explicit badge, forced-expanded — never collapsed the same way a success is). Claude Code's tense-flip instruction, Linear's Action verb pair, and OpenClaw's error-auto-expand all converge here independently. **[SYNTHESIS across VERIFIED sources]**

### Transferable rules — Topic 3
- Reserve full card chrome (border/shadow/elevation/fill) for content that is a genuinely different surface (a diff, a card-scan preview); never for a one-line "ran a tool" status.
- Make in-progress→done a **tense change** (present → past verb), not just a spinner vanishing.
- Collapse sequential successful tool calls into **one grouped header** with a lightweight visual link (hairline/left rule); reserve the single interactive control for expand/collapse.
- Make **failure the deliberate exception** to collapse-by-default — louder color/badge, auto-expanded.
- The only click target on a tool row should be the expand chevron — nothing about it should read as a button to press for an effect.
- Group by the logical step the user cares about (a todo, a plan item, a file), not the raw sequence of API calls.
- Default collapsed with an honest, specific label; never fully hidden, never fully expanded prose by default.
- Silently folding a call into prose (no chip at all) is right only for a single, cheap, obviously-implied call — the moment there's more than one meaningful step, show a row.

---

## 4. Human-in-the-loop approval UX

### Dry-run → review → confirm in real products
**Claude Code Plan Mode**: reads/explores without editing; when ready, offers three choices, not binary yes/no — "Yes, and use auto mode," "Yes, manually approve edits," or "No, keep planning" (redirect in natural language). A power affordance opens the plan in a real editor (`Ctrl+G`) for hand-editing before acceptance. Protected paths (`.git`, shell rc files) are never auto-approvable regardless of mode. **[VERIFIED — https://code.claude.com/docs/en/permission-modes]**

Anthropic's containment engineering writeup is the single most directly transferable source for approval-fatigue economics: telemetry showed **users approved ~93% of permission prompts**, and "the more approvals a user sees, the less attention they pay to each." Their response is a **three-tier model**: auto-approve safe/reversible reads; **soft gates** for impactful-but-recoverable actions (proceed, make undo easy); **hard gates** for irreversible/high-stakes actions (block on explicit approval). Stated display requirement at a gate: **what action, why, what will change, and how to undo it** — and batch multiple pending approvals into one prompt rather than a rapid sequence. **[VERIFIED — https://www.anthropic.com/engineering/how-we-contain-claude]**

**GitHub Copilot coding agent**: architecturally barred from self-approval — it can only comment on a PR, never approve it or satisfy required-reviewer rules; CI doesn't auto-run on its pushes, a maintainer must click "Approve and run workflows." **[VERIFIED — https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/reviewing-a-pull-request-created-by-copilot]**

**Cursor**: inline diff review, file-by-file/chunk-by-chunk, with aggregate final accept. Two real regressions worth noting as warnings: users filed complaints when a version started applying edits *before* the diff/approval UI appeared (treated as a serious trust violation, not a minor bug); there's a live, contested design question (open Claude Code feature request) about batch-review-everything-at-once vs. serial per-edit approval. **[SECONDARY — Cursor community forum threads]**

**Zapier "Require approval before running"**: off by default, recommended specifically for tools that create/update/delete data. The review screen shows the **specific field values the AI filled in**, not a generic notice. Options: Approve, Decline (configurable to stop-all or skip-and-continue), and **inline editing** — corrected values flow to the downstream step as new fields. Timeout policy for no-response. **[VERIFIED — https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop]**

**Fintech transfer confirmation**: the most mature, most-tested confirm-before-commit pattern in consumer software, because a wrong "yes" has concrete cost — one screen shows source/destination amounts, fees, timing, recipient name *and* number together (so the user can cross-check), editable before final confirm. Design principle: "logically related information should appear together." **[SECONDARY, well-established UX-teardown consensus]**

**Superhuman Auto Drafts**: routes the AI's proposed action through the *same edit surface* a human would use manually (the Gmail drafts folder) rather than a bespoke review modal — every send still requires explicit confirmation. **[VERIFIED — https://help.superhuman.com/hc/en-us/articles/46183279736461-Superhuman-Mail-for-Gmail]**

### What makes "Accept" trustworthy
NN Group: a confirmation must **restate the request and explain effects with specific information** — contrasting vague ("delete these 2 items?") vs. specific (naming the actual filenames); generic dialogs train click-through-without-reading. Button labels should name the action ("Delete file"), not generic Yes/No. Effectiveness is **inversely proportional to frequency**. **[VERIFIED — https://www.nngroup.com/articles/confirmation-dialog/]**

Microsoft's Guidelines for Human-AI Interaction (Amershi et al., CHI 2019) — three directly applicable guidelines: **G08 Support efficient dismissal** (Reject must be as frictionless as Accept); **G09 Support efficient correction** (edit/refine, not just accept-or-redo-everything — the direct argument for per-item deselect/edit); **G10 Scope services when in doubt** (disambiguate rather than silently guessing). **[VERIFIED — https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/]**

Google PAIR's People+AI Guidebook frames the goal as **trust calibration, not maximization**: two concrete templates — an uncertainty display ("Prediction: X, 80%") and an **N-best display** ("Most likely X, Y, or Z") for disambiguation instead of a single forced guess. **[VERIFIED — https://pair.withgoogle.com/chapter/explainability-trust/]**

### Undo vs. confirm
NN Group frames undo as the *primary* safeguard, confirmation as the exception: **"If the user can easily undo an operation, additional confirmation is redundant... Confirmation dialogs are justified for irreversible actions."** Canonical irreversible examples are deliberately narrow (permanent deletion, account closure). **[VERIFIED — https://www.nngroup.com/articles/confirmation-dialog/]** Anthropic's soft-gate/hard-gate split operationalizes the same idea for agents: undo-first for recoverable actions, block-on-approval reserved for genuinely hard-to-reverse ones, explicitly because "human approval alone proved insufficient as a primary defense mechanism" once fatigue sets in. **[VERIFIED — same containment source as above]**

### Confidence indicators — genuinely mixed evidence
Some evidence favors them: a UMAP 2025 study found confidence ratings improved effectiveness/trust, with 64% of participants naming it the most useful feature. **[VERIFIED — https://dl.acm.org/doi/10.1145/3708319.3734178]** But the more targeted finding cuts the other way: **miscalibrated confidence impairs appropriate reliance**, users can't detect miscalibration by looking, and *disclosing* that confidence is unreliable overcorrects users into **under-reliance** (rejecting even correct advice) — disclosure is a trade-off, not a fix. **[VERIFIED — arXiv:2402.07632]** A companion CHI 2024 study shows the problem is two-sided: overconfident users dismiss correct AI advice, underconfident users over-rely on wrong advice, and people are bad at calibrating their *own* confidence too. **[VERIFIED — https://dl.acm.org/doi/10.1145/3613904.3642671]** Recommendation: avoid bare percentages (false precision an LLM can't back up); prefer PAIR's **N-best/disambiguation pattern**, and where a confidence signal is still wanted, use a coarse, **behavior-linked** version (low-confidence items default deselected, forcing opt-in) rather than a number the user has no way to evaluate. **[SYNTHESIS]**

### Transferable rules — Topic 4
- **Itemize, never aggregate** — every card its own row (name, set, variant, quantity), never "12 cards added."
- **Show a before/after delta** at the top ("Collection: 143 → 155 (+12)"), plus value delta if tracked.
- **Per-item checkboxes, defaulted by confidence** — high-confidence pre-checked, low-confidence/ambiguous pre-*unchecked* (opt-in, not opt-out).
- **No bare percentages** — show top 2–3 named candidates instead of "87% confident."
- **Label buttons with the action**: "Add 12 cards" / "Add none" / "Add selected (9)" — never generic Accept/Reject.
- **Partial accept is first-class**: button label updates live with the selected count; excluded items stay visible (dimmed/struck), not removed from view.
- **Editable, not just binary** — let the user correct a guessed field (variant, quantity, condition) inline rather than reject-and-redo.
- **Reserve hard pre-commit gates for genuinely hard-to-reverse actions** (bulk deletion, overwriting existing data); default reversible actions (adding cards) to a lighter review-and-undo pattern once trust is established.
- **State the source/reasoning per item** when non-obvious ("matched from photo," "no foil visible — assumed non-holo") as a one-line tag, not a wall of text.
- **Batch pending approvals into one review**, never a rapid-fire sequence of separate prompts.

---

## 5. Assistant-driven navigation / guided tours

### Product-tour libraries — converged conventions
Every major library spotlights via a darkened overlay with a **live cutout** around the real, still-interactive target — never a frozen screenshot. Shepherd.js's `useModalOverlay` explicitly creates "an opening around the target element so it can remain interactive." **[VERIFIED — https://docs.shepherdjs.dev/guides/usage/]** Driver.js frames the primitive generically as an overlay for "highlighting a page component" or "bringing user attention," independent of a tour flow. **[VERIFIED — https://driverjs.com/]** Intro.js exposes explicit positioning (`top/left/right/bottom` + aligned variants, `auto` collision-avoidance fallback). **[VERIFIED — https://introjs.com/docs/tour/examples/tooltip-positions]**

**Advancing steps** converges on two patterns: explicit Next/Back, and — the more important one for Deck-E — **`advanceOn`**, binding progression to a real interaction with the target itself (Shepherd: `{selector, event}`), so the tour advances because the user did the real thing. Userpilot independently reinvents the same idea as "action-based tours." **[VERIFIED — https://docs.shepherdjs.dev/guides/usage/, https://userpilot.com/blog/pendo-product-tours/]** Userpilot's own comparison piece explicitly warns that **passive click-Next tooltip sequences "teach almost nothing," with dropouts reflecting boredom rather than confusion** — direct evidence against a purely narrated walkthrough. **[VERIFIED — same]**

**Skip/exit**: Shepherd ships a persistent `✕` cancel icon, honors Escape by default, supports arrow-key nav, and a confirm-before-abandon option for complex tours. **[VERIFIED — same]** Appcues: **"Forcing users through a tour creates resentment... always give users control over the experience."** **[VERIFIED — https://www.appcues.com/blog/product-tours-walkthroughs-ultimate-guide]**

### Agentic browser automation — watch, don't hide; ask before irreversible; hand back control
**Claude in Chrome** defaults to auto-approve with pauses only for high-risk actions (publishing, purchasing, sharing personal data); a stricter manual-approve mode reviews every action; whole risk categories are blocked outright; a safety-classifier pass runs before each action specifically against prompt injection, reportedly cutting injection success from 23.6% to 11.2%. **[VERIFIED — https://claude.com/blog/claude-for-chrome, https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely]**

**OpenAI Operator** hands control back to the user for sensitive input (credentials, payment) and does not screenshot/collect what the user enters during that takeover — a genuine privacy carve-out, not just UX theater; it asks for approval before finalizing significant actions (submitting an order, sending an email); sensitive-site sessions (email, finance) run in a stricter watch mode. **[SECONDARY — reported via search synthesis of OpenAI's own materials; direct fetch 403'd]**

**Google DeepMind's Project Mariner** deliberately confines the agent to the browser's active, *visible* tab rather than a hidden background session — CTO Koray Kavukcuoglu: **"a very intentional decision so that users know what Google's AI agent is doing... it's important to take this step-by-step."** Users can pause/stop at any time with permanent visibility into the agent's current instruction. **[VERIFIED — https://techcrunch.com/2024/12/11/google-unveils-project-mariner-ai-agents-to-use-the-web-for-you/]**

None of the three vendors document the exact micro-interaction for "about to click" vs. "already clicked" at a granular level — that lives in demo video, not text docs. What's consistent is the **governance pattern**: an explicit approval gate scaled to risk, pausing as the default reaction to ambiguity. **[SYNTHESIS]** For Deck-E, the fly-outline-then-click sequence *is* the "about to" signal, and outline dwell time should scale with the destructiveness of the coming action.

### What makes guided motion helpful vs. hijacking
NN Group's scrolljacking research is the most directly transferable body of evidence: **"the majority of our study participants were at least mildly disoriented by scrolljacking,"** goal-oriented users got "severely agitated" (business cost, not just annoyance), and the worst combination was **motion + required reading simultaneously**. Guidance: never change scroll *direction* against the user's own gesture; always preserve normal-scroll escape sections. **[VERIFIED — https://www.nngroup.com/articles/scrolljacking-101/]** Parallax research found the trend "faded away" because early adopters saw real UX harm — users called it "distracting" and something "slowing me down." **[VERIFIED — https://www.nngroup.com/articles/parallax-usability/]** Auto-forwarding carousel research generalizes further: **"it's just plain annoying for users to lose control of the user interface when things move around of their own accord,"** and a skip/dismiss control was independently valued *regardless of the content itself*. **[VERIFIED — https://www.nngroup.com/articles/auto-forwarding/]**

**[SYNTHESIS]** The through-line: the sin is hijacking the input channel the user is *actively operating* — scrolljacking overrides the literal scroll gesture in progress. Deck-E flying to an element does not hijack an input channel by default, provided it (a) never resists/overrides a scroll or click made mid-flight, (b) is cancellable by any real user action, and (c) never silently repositions content or steals scroll/focus the user didn't ask for — any page-scroll Deck-E performs should be an explicit, announced, interruptible step, not a stealth reposition under the cursor.

### Transferable rules — Topic 5
- Spotlight with a **live, interactive cutout**, never a frozen screenshot standing in for the real element.
- **Advance on the user's real click**, not a synthetic "Next," wherever the step is "click this real thing" — reserve manual advance for narration-only beats.
- Always provide a **persistent, one-step exit** (close button + Escape), discoverable without hunting.
- **Never fight the user's current input channel** — if the user is actively scrolling/clicking elsewhere, defer or cancel Deck-E's flight.
- Any Deck-E-initiated page scroll must be **explicit, announced, and interruptible** — never a silent reposition under the cursor.
- **Resolve position before revealing text** — never require reading while the reference point is still moving (the scrolljacking "worst combination" finding).
- On ambiguity or a missing target, **pause and ask, don't guess louder** — mirrors all three agentic browsers' default-to-pause governance.
- **Scale the outline-then-click dwell time to consequence**: near-instant for navigation, a deliberate pause or explicit confirm before anything that submits/deletes/spends.
- **Any user click, keypress, or scroll during a flight is an implicit "stop guiding me"** — treat it as cancellation, never queue it behind Deck-E's current step.
- Prefer **short beats tied to a real micro-action** over passive narrated walkthroughs — passive tooltip sequences are a documented failure mode (boredom-driven dropout).

---

## 6. Character/mascot assistants

### Clippy — the canonical failure, itemized
- **Interruption without invitation**: "Interrupting people with help they did not request is worse than offering no help." **[VERIFIED — https://www.seattlemet.com/news-and-city-life/2022/08/origin-story-of-clippy-the-microsoft-office-assistant]**
- **False confidence / low-value help**: tips were "irrelevant or too simple for most users" — no ability to gauge context. **[VERIFIED — same]**
- **Personality without competence backfires**: "personality without usefulness can quickly become annoying." **[VERIFIED — same]**
- The organization knew and shipped anyway: 2001 internal focus groups rated Clippy "patronizing," "annoying," "not helpful"; disabled by default in Office XP, retired by 2007. **[VERIFIED — same]**
- Designer Kevan Atteberry: **"I would never, never include Clippy in my portfolio because I was so embarrassed of him."** **[VERIFIED — same]**
- The retrospective explicitly draws the throughline: **modern assistants (Siri, Alexa, Copilot, ChatGPT) all wait to be invoked and never pop up unprompted — a design choice tracing directly to the Clippy backlash.** **[VERIFIED — same]** This is the single most important fact for Deck-E's invoke model.

### XiaoIce — engagement without a task frame
Microsoft's own paper optimizes not for single-turn correctness but for expected **Conversation-turns Per Session (CPS)**, modeling the interaction as a Markov Decision Process; XiaoIce reportedly reached an average CPS of 23. **[VERIFIED — https://arxiv.org/abs/1812.08989]** The system models "IQ" and "EQ" as co-equal design axes via a dedicated **empathetic computing module** that dynamically reads user feelings/intent across long conversations. **[VERIFIED — same]** The transferable structural idea for a task assistant (not the engagement-maximization goal itself, which would be Clippy's sin in new clothes): treat **"is this the right moment to speak"** as a first-class, separately-modeled signal alongside "is this instruction correct." **[SYNTHESIS]**

### Duolingo's Duo — charm and guilt are separable
Duo's official positioning leans into "diva personality... extra." **[SECONDARY, reported]** But independent analysis characterizes the streak-notification strategy as "accountability marketing... playful but edged with guilt," using deliberate "pattern interrupts" (a sick/distressed owl state) to drive completion. **[SECONDARY, convergent critic consensus, not a Duolingo admission — https://medium.com/@Smyekh/how-duolingo-uses-ai-and-guilt-to-keep-you-learning-a-language-6ac3e11b3e44]** Lesson: **the charm and the guilt mechanic are separable design axes** — DeckPal can take the appeal without importing manufactured urgency, since nothing about a helpful mascot requires a guilt loop.

### Finch — not demanding attention
"There is no penalty for an off day, only a small companion glad to see you back... it just exists, alongside you." **[VERIFIED characterization — https://ixd.prattsi.org/2026/02/design-critique-finch-self-care-pet-ios-app/]** Idle animations (preening, looking around) exist to signal "alive," not to request interaction — the cleanest positive counterpoint to Duolingo's guilt loop for idle-state design.

### Character.ai vs. task assistants
Persona-chat sessions run far longer than task-assistant sessions (reported ~34 min vs. ~4 min, treat the exact figures as secondary/unverified pending a primary source), reflecting a fundamentally different job — companionship vs. task completion. **[SECONDARY]** Consequence: a persona character can be verbose because *being with it* is the product; a task mascot like Deck-E is judged on speed/unobtrusiveness — its personality budget belongs in idle animation and voice, not extended conversation.

### Game companions — ally vs. nag
**Navi (Zelda)** is the negative case even inside a beloved game: "criticized... for repetitive interruptions... particularly 'Hey! Listen!'" — the failure mechanism is **repetition without new information**. **[VERIFIED — https://en.wikipedia.org/wiki/Navi_(The_Legend_of_Zelda)]** **Cortana (Halo)** is the positive counter-example: her speech was load-bearing plot/gameplay information relayed *because* the protagonist didn't talk, not a tutorial layer bolted onto a game that worked without her. **[SECONDARY]** General principle: "Supporting characters should generate positive emotions in the player, not negative ones." **[VERIFIED — https://www.gamedeveloper.com/design/a-good-companion---balancing-emotions-and-practicality-when-designing-companion-characters]**

### Gaze and attention — directly load-bearing for the "look up and away" request
Real, replicated finding: **gaze aversion increases with question difficulty and improves response accuracy**; aversion is lowest while listening, highest while thinking — averting gaze from a distractor (a face) frees the attentional resources internal cognition needs. **[VERIFIED — https://pmc.ncbi.nlm.nih.gov/articles/PMC3627297/, Doherty-Sneddon et al.]** Honesty check: the *direction* of aversion is **not** robustly settled — the same literature shows inconsistent directional patterns across age groups. The popular claim that a specific gaze direction reveals a specific cognitive mode traces to NLP "eye-accessing cues," substantially discredited after Wiseman's 2012 study. **Recommendation: justify "look away" on solid gaze-aversion/cognitive-load grounds; justify the specific "up" angle on animation-convention/legibility grounds (matches audience expectation from decades of cartoon "thinking" poses), not on a neuroscience claim about visuospatial encoding.** **[VERIFIED sourcing for both halves — https://nlp-now.co.uk/eyes-dont-have-it-nlp-disproved-or-not/]**

Directly on point: a 2025 study on masking LLM response delay in embodied conversational agents found **behavioral fillers (gaze-aversion-style thinking animation + verbal fillers) significantly outperformed symbolic fillers (progress bars) on naturalness, presence, engagement, and humanlikeness** — in forced preference, 66.7% chose behavioral fillers vs. ≤12.5% for symbolic ones. **[VERIFIED — https://arxiv.org/html/2508.11781v1]** This is close to a direct proof that Deck-E's idle/thinking gaze-aversion animation is the empirically preferred way to cover latency, not just a stylistic choice.

Robot-gaze HRI research adds a caution the other direction: **sustained mutual gaze from a robot measurably slows human response and raises decision threshold** — an argument against a mascot holding eye contact by default. **[VERIFIED — https://www.science.org/doi/10.1126/scirobotics.abc5044]** Separately, gaze reliably pulls human attention wherever it points — meaning Deck-E's idle-drift gaze and its guiding/pointing gaze must be **visually distinguishable**, or idle glances will be mistaken for cues. **[VERIFIED — https://pmc.ncbi.nlm.nih.gov/articles/PMC3842160/]**

Disney's 12 Principles applied to UI: **anticipation** (a brief lean/wind-up before flight/click gives the user a beat to intervene — doubling as a safety valve); **secondary action** (idle "alive" motion must stay subordinate to whatever Deck-E is actively doing, never competing for attention); **appeal** (a "mascot character that guides you through a tutorial" is explicitly named as an established UI pattern, not a novel risk). **[VERIFIED — https://ixdf.org/literature/article/ui-animation-how-to-apply-disney-s-12-principles-of-animation-to-ui-design]**

### Accessibility
`prefers-reduced-motion` targets users for whom motion can trigger vestibular disorders, epilepsy, migraine (dizziness, nausea, headache). **[VERIFIED — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion]** Correct scope is explicitly **not** "remove all animation" — the intent is removing non-essential motion while retaining state-communicating motion in reduced form. **[VERIFIED — https://web.dev/articles/prefers-reduced-motion]** For Deck-E: under reduced motion, flight should become instant/fade repositioning while the *functional* signal (which element is now targeted) still lands via the static outline, without the travel animation itself.

### Transferable rules — Topic 6
- **Never surface unsolicited** — wait to be invoked; this is the single most corroborated lesson in this entire research pass.
- **Idle/thinking gaze points up and away, never holds eye contact by default** — supported by gaze-aversion-under-cognitive-load research and by robot-gaze research showing sustained mutual gaze burdens the user.
- Justify the **direction** ("up") on animation-convention/legibility grounds, not neuroscience — don't overclaim.
- Use a **thinking/gaze-aversion animation, not a spinner or progress bar**, to cover any "Deck-E is working" latency — directly evidenced as the preferred pattern (66.7% vs. ≤12.5%).
- **Idle-drift gaze and directional/guiding gaze must look visually distinct** — otherwise idle glances get mistaken for cues.
- **Charm and guilt are separable** — take mascot appeal, never import streak-style manufactured urgency.
- Model **"is now an appropriate moment to speak/act"** as its own gate, separate from "is this instruction correct."
- **Never repeat the same guidance line/animation for something the user has already demonstrated they understand** — the named Navi failure mode.
- **Auto-shrink/collapse whenever Deck-E would occlude content** — treat this as a hard rule, not a nice-to-have.
- **Respect `prefers-reduced-motion` by cutting travel animation while preserving the functional cue** (instant reposition + static outline), never by disabling Deck-E outright.

---

## 7. Full-screen overlay chat over a live app

### Backdrop blur/scrim
Material Design's numeric default: **black at 32% opacity** behind modal dialogs/bottom sheets; non-modal sheets get no scrim, because they don't block interaction. Stated purpose: "express that the rest of the app is inaccessible, and focus attention on the dialog." **[VERIFIED — https://m2.material.io/design/components/dialogs.html]**

Apple's HIG answer is qualitative: translucency + blur create "visual separation between foreground and background layers" while explicitly preserving legibility via **vibrancy** — foreground content samples the blurred background's color and adjusts saturation/value so contrast holds regardless of what's behind it; **thicker materials give better contrast for fine-detail content**, i.e. a stronger blur is a legibility tool, not just aesthetic, when there's a lot of foreground text. **[VERIFIED — https://developer.apple.com/design/human-interface-guidelines/foundations/materials/]**

WCAG is background-agnostic and unambiguous: **4.5:1 for normal text, 3:1 for large text**, evaluated at the *worst point* of a variable background — exactly what a blurred photo/card-art background is. WCAG's own technique (G18) explicitly sanctions adding a solid/semi-opaque panel behind text specifically to guarantee the ratio holds despite local variance. **[VERIFIED — https://www.w3.org/TR/WCAG20-TECHS/G18.html]**

**[SYNTHESIS]** Reconciling all three: Material's 32% black scrim is a fine default for a flat-color background, but DeckPal's backdrop is card-art-heavy (high local contrast variance) — this needs either a stronger scrim, added blur, or both, following Apple's own answer of combining blur (suppresses high-frequency variance) with vibrant-adaptive foreground color rather than relying on a flat scrim alone.

### Keeping specific chrome unblurred
Mechanism: `backdrop-filter` blurs everything behind an element up to the nearest **backdrop root** — created by the root, or any ancestor with `filter`, `opacity<1`, a mask/clip-path, its own `backdrop-filter`, `mix-blend-mode`, or `will-change` naming one of those. **[VERIFIED — MDN backdrop-filter docs]** Two workable techniques: (1) make the header its own backdrop root (`will-change: opacity` or similar) with a higher z-index and opaque background, so the overlay's blur can't reach through it; (2) the more robust real-world pattern — **render the header as a separate layer stacked above the blur/scrim in z-order** with its own opaque background, rather than carving an exemption out of one blur pass (this is how iOS's own system sheets keep the status bar crisp above a blurred sheet). **[VERIFIED mechanism + SYNTHESIS on preferred approach]**

### Focus trapping and scroll locking
WAI-ARIA APG's modal dialog pattern, verified directly against the spec: **Tab/Shift+Tab cycle and wrap within the dialog only; Escape closes.** Initial focus is **content-dependent**: a static `tabindex="-1"` element at the top for content-heavy dialogs, a frequently-used action for simple confirmations, and **the least-destructive option by default for high-risk actions** (deletion, financial transactions). Focus returns to the invoking element on close. A true modal requires both blocking interaction with outside content *and* visually obscuring it — `aria-modal="true"` plus, in modern practice, the HTML **`inert`** attribute on everything outside the dialog root (replacing the older manual `aria-hidden`-on-siblings approach). **[VERIFIED — https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/]**

Plain `overflow: hidden` on `<body>` does **not** reliably prevent background scroll-through on iOS Safari (rubber-banding/scroll-chaining happens below the CSS-overflow layer). **[SECONDARY, well-corroborated across independent write-ups]** The modern, standards-track fix is **`overscroll-behavior: none`/`contain`**, preferred over the older `position: fixed` + manual `scrollY` bookkeeping hack. A specific regression to test for: `position: fixed` elements reported to silently break after prolonged use in iOS 17 PWA standalone mode (Apple Developer Forums thread). **[VERIFIED report exists — https://developer.apple.com/forums/thread/744327]**

### iOS PWA viewport and keyboard specifics
Viewport units are now a real, Baseline-safe CSS spec (Chrome 108+, Firefox 101+, **Safari 15.4+**): `svh` = smallest case (chrome fully expanded), `lvh` = largest case (chrome retracted), **`dvh`** = dynamically tracks the actual current state, animating as the address bar shows/hides. **[VERIFIED — https://web.dev/blog/viewport-units]** Use **`dvh` not `vh`** for a full-screen mobile chat surface — plain `vh` is computed against the large viewport, causing the classic "bottom cut off behind Safari's chrome" bug.

**Critical caveat**: the on-screen keyboard is explicitly **not** treated as chrome by the viewport-unit spec — `dvh` does **not** shrink for the keyboard. **[VERIFIED — same source's explicit caveat]** The correct mechanism for keyboard avoidance is the **VisualViewport API**: `window.visualViewport` exposes `height`/`offsetTop`/`offsetLeft` and fires `resize` and `scroll` independently of the layout viewport. MDN's own documented pattern for repositioning a fixed composer listens to **both** events (scrolling while the keyboard is open moves the visual viewport without firing resize) and re-anchors using `offsetTop`/`height`. **[VERIFIED — https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport]**

Safe-area insets (`env(safe-area-inset-*)`) resolve to **zero unless the viewport meta tag includes `viewport-fit=cover`** — a very common, very easy bug. **[VERIFIED]** Known standalone-mode-only bugs worth explicit device QA: the visible viewport getting "stuck" shrunk after keyboard dismissal in installed PWAs; safe-area insets applying inconsistently in standalone mode vs. the same page in a Safari tab; an iOS 26 beta report of keyboard-toolbar safe-area drift after interaction (device-only, not simulator). **[VERIFIED reports exist — https://dev.to/cederhook/fixing-the-ios-standalone-pwa-keyboard-bug-that-shrinks-your-viewport-for-good-63d, https://developer.apple.com/forums/thread/798598]**

### Transferable rules — Topic 7
- Use a scrim **≥ Material's 32% black baseline** over flat UI; increase opacity and/or add blur when the backdrop is photographic/card-art-heavy, since flat-scrim math assumes low background variance DeckPal doesn't have.
- Verify contrast against the **worst-case point** of the live backdrop (WCAG 4.5:1 / 3:1), adding a solid/semi-opaque panel or vibrant-style adaptive foreground where blur+scrim alone can't guarantee it.
- Keep the nav bar unblurred by **stacking it as its own opaque layer above the scrim in z-order**, not by trying to carve an exemption out of one blur pass.
- Implement the overlay to the **WAI-ARIA APG modal pattern exactly**: Tab/Shift+Tab wrap inside, Escape closes, focus returns to invoker on close, everything outside is genuinely `inert` + `aria-modal="true"`, and initial focus defaults to the least-destructive control for any risk-bearing dialog.
- Don't rely on `overflow: hidden` for iOS scroll lock — use `overscroll-behavior: contain`/`none`, and test specifically in **standalone PWA mode**, not just Safari tabs.
- Size the overlay with **`100dvh`** and always set **`viewport-fit=cover`** or every safe-area inset silently becomes `0px`.
- Do not expect `dvh` to solve keyboard avoidance — reposition the composer via **`window.visualViewport`**, listening to both `resize` and `scroll`.
- Budget explicit QA time for standalone-PWA-only keyboard/safe-area regressions — these are real, currently-reported bugs, not hypothetical edge cases.

---

## 8. Domain ideation — 22 things Deck-E could do

Grounded in a survey of the real Pokémon TCG tool landscape: TCGplayer, Collectr, Pokellector, TCG Collector, Dex, CardTrader, Cardmarket, PriceCharting, PokemonPriceTracker, PSA/CGC/BGS grading + pop reports, GemRate, CollX, TCG Pocket pull-rate mechanics, TCGdex/pokemontcg.io open data (variants, legality, rarity), binder-planning tools, and the explicit gaps collectors report (data export lock-in, fragmented pop reports, no safe in-app trade communication, clunky cross-language filtering, no native cost-basis/tax export, no native insurance-grade valuation). Each item: user phrasing → what Deck-E does → UI surface → why it matters.

1. **"I just opened this box, add everything"** → Deck-E batch-identifies a stack from photos/video, groups by set/variant/quantity → **approval card** (itemized, before/after collection count) → **why**: the single highest-frequency real workflow (a box break) and the direct home for the dry-run pattern from §4.

2. **"How close am I to finishing Obsidian Flames?"** → computes master-set completion (any-variant vs. all-variant modes, matching TCG Collector's split) → **inline rich widget**: a progress ring + missing-card thumbnail grid → **why**: master-set completion tracking is a named, first-class workflow every serious tracker builds, and DeckPal's own data already has the fields (rarity, variants) to compute it live rather than making the user check a spreadsheet.

3. **"Show me every Umbreon I own or need"** → species-first cross-set query → **ad-hoc screen**: a Pokédex-style grid grouped by species, owned vs. missing → **why**: Dex and TCG Collector both surfaced this as a distinct mental model from set-browsing; DeckPal doesn't need a separate screen built manually if Deck-E can generate the view on demand.

4. **"Should I grade this Charizard?"** → pulls raw value, predicted-grade population/price delta from graded comps, grading-service turnaround/cost tiers → **inline widget**: a small ROI table (raw value / est. PSA 9 value / est. PSA 10 value / submission cost / breakeven) → **why**: this exact ROI calculation is important enough that standalone tools exist purely for it (PokemonPriceTracker's Grading ROI Calculator); folding it into the assistant means the user never leaves their own collection view to get an answer.

5. **"What are these duplicates worth as bulk?"** → flags cards owned 2+ copies beyond a "keeper" threshold, estimates bulk-sale value vs. singles value → **approval card**: "move these 40 duplicates to a Bulk box?" with accept/adjust → **why**: duplicate/bulk management is a named, explicitly unsolved pain point (even TCG Pocket's own community complains there's no good sink) — Deck-E turning clutter into a concrete, actionable list is a genuine cheap win.

6. **"Is this a fake?"** → runs available visual checks (print-line/border comparison against reference art) and returns an **honest, capped** verdict → **ad-hoc screen**: a checklist card explicitly stating "AI pre-screen only — not a certification" plus the physical tests the user should still do (light test, bend test) → **why**: every real authentication tool surveyed is explicit that photo analysis alone can't certify; Deck-E should mirror that honesty rather than overclaiming confidence, directly applying the confidence-indicator research from §4.

7. **"Does this deck stay legal after rotation?"** → checks each card's regulation-mark letter against the announced rotation date → **inline widget**: a legality summary with the specific cards that will drop, and when → **why**: legality is governed by an obscure printed letter, not the set name — collectors get this wrong; DeckPal's card data already has the fields needed (per §8's TCGdex/pokemontcg.io survey).

8. **"What's coming out that I should know about?"** → cross-references the user's want-list/collecting focus against the release calendar → **inline digest** (weekly/monthly card in chat, opt-in) → **why**: release-calendar awareness and preorder timing is a named, actively-tracked collector behavior; DeckPal can push this proactively instead of the user hunting external spoiler sites.

9. **"Match my want-list against my friend's collection"** → cross-references two DeckPal accounts' want-lists/have-lists → **ad-hoc screen**: a two-column match table with a proposed trade → **approval card** to formalize → **why**: want-list↔trade-list matching is a repeatedly-rebuilt feature across the ecosystem (PokeTrade's "Best Match," Dex's friend-matching, Vaultset) precisely because generic marketplaces don't serve it well; DeckPal already has both users' real collection data, which third-party matchers don't.

10. **"Is this trade fair?"** → values both sides of a proposed trade using live market comps → **inline widget**: a balance-scale-style value comparison with a plain-language verdict → **why**: mirrors Collectr's "trade meter," a validated feature; keeping the reasoning transparent (line-item comps, not just a score) avoids the confidence-indicator pitfalls from §4.

11. **"What's this actually worth right now?"** → pulls current market price + short volatility trend for a specific card/variant → **inline widget**: price + sparkline + "up/down X% this month" → **why**: price-history-from-actual-sales (not asking price) is the trust signal collectors specifically seek out (PriceCharting, PokemonPriceTracker); a sparkline inline in chat saves a context-switch to an external site.

12. **"Alert me if this card drops below $X"** → sets a standing watch, notifies when triggered → **ad-hoc screen** for managing active alerts, notification when fired → **why**: proactive price-watching is a natural extension of the price-tracking data DeckPal already surfaces, and no reviewed tracker does it conversationally ("just tell Deck-E what to watch for" vs. configuring a rule in a settings screen).

13. **"Help me plan a binder for my top 50"** → suggests a page-by-page layout (rainbow/color-sort, rarity-sort, or Pokédex-number-sort) from the user's actual owned cards → **ad-hoc screen**: a virtual 9-pocket binder preview, draggable to adjust → **why**: an entire cottage industry (PocketRune, Binder Builders) exists purely for this; DeckPal doing it from real owned-card data (rather than a separate app requiring re-entry) removes the single biggest friction those tools have.

14. **"Is my collection insured for enough?"** → generates a dated valuation snapshot (condition assumptions + market comps) formatted for an insurer, explicitly noting replacement-cost vs. market-price framing → **ad-hoc screen/exportable document** → **why**: named, real gap — appraisal-grade documentation currently requires leaving every mainstream tracker for a separate service; this is a case where the "ad-hoc screen" output has value even outside the app (a PDF/print view).

15. **"What did I spend vs. what's it worth now?"** → cost-basis and unrealized gain/loss across the whole collection or a date range → **inline widget**: a simple P/L summary, exportable as CSV → **why**: explicitly flagged as a gap in mainstream trackers (only narrow apps like PokeInvesting treat this as core); DeckPal already has purchase-price fields if the user logs them, so this may be a near-zero-net-new-data feature.

16. **"Export everything, I'm trying another app"** / **"Import my old spreadsheet"** → generates or ingests a portable CSV/JSON of the full collection → **ad-hoc screen** (export) or **approval card** (import, itemized preview before commit) → **why**: data portability lock-in is an explicit, named, emotionally-charged community complaint (a Pokémon community forum thread directly envies MTG Arena's export); building this well is a trust signal independent of Deck-E's cleverness, and framing it as something Deck-E does *conversationally* removes the need for a dedicated settings sub-page.

17. **"My kid wants to add cards from packs he opened"** → a **kid-mode conversational flow**: simpler language, always-approval-gated (never auto-commits), optionally requires a parent PIN/confirmation step before any addition finalizes → **approval card variant** with larger touch targets and reassuring copy → **why**: named, real, currently-unaddressed gap — official TCG Pocket coverage flags the *lack* of real parental-oversight tooling around gacha/collecting mechanics; Deck-E as a "supervised assistant" is a genuinely differentiated, low-controversy way to serve that need (contrast with Duolingo's guilt mechanic — this should reassure, not pressure).

18. **"What packs should I buy to finish my set?"** → given remaining missing cards and their rarity tier, gives an honest expected-value/expected-packs-needed estimate (using published pull-rate data where available, e.g. TCG Pocket's disclosed rates, or set-level rarity distribution for physical product) → **inline widget**: "~X packs expected to complete remaining commons; the last 2 secret rares are unlikely from packs — consider buying singles instead" → **why**: pull-rate literacy is real and community-discussed; giving an honest EV-based recommendation (including "packs are a bad way to get this, buy the single") builds trust exactly the way N-best/honest-uncertainty framing does in §4, rather than encouraging over-purchasing.

19. **"Find me a local place to play/trade"** → surfaces league/tournament info (if DeckPal has or can source this data) near the user → **ad-hoc screen**: a small map/list card → **why**: local league play is a named recurring workflow in the community research; even a lightweight, non-authoritative pointer (link out to official league locator) is more than most trackers offer today, since none of the surveyed apps handle this at all.

20. **"Which of these is the reverse holo?"** → when the user's own photo or description is ambiguous between visually-similar variants → uses the **N-best disambiguation pattern** directly (§4): "This looks like it could be the Reverse Holo or the standard Non-Holo — the foil pattern isn't clear in your photo, which is it?" rather than silently guessing → **inline widget** with both variant thumbnails side by side → **why**: variant confusion is the single most common real data-entry error in every reviewed tool (TCGplayer's own users report want-list items "randomly saved under the wrong variant"); this is the domain-specific instance of the approval-UX confidence research paying off directly.

21. **"Give me a chase list for the next set"** → once spoilers are available, generates a personalized "cards from the upcoming set most likely to matter to you" list based on the user's existing collecting pattern (species affinity, rarity tier preference, deck archetype) → **inline widget**: a ranked preview list with pre-order links → **why**: this is the ambitious end of the range — nothing in the surveyed landscape personalizes release-calendar awareness to an individual's actual collection, it's all generic spoiler aggregation; this is a genuinely novel, DeckPal-data-dependent capability.

22. **"Is this a good time to sell my [card]?"** → combines price trend, upcoming reprints/rotations that could affect value, and grading-population trends into a plain-language sell/hold framing (never a hard directive — explicitly hedged, consistent with the confidence-indicator research in §4) → **inline widget**: trend chart + 2–3 bullet factors, phrased as considerations not advice → **why**: this is the most ambitious/highest-trust-risk item on the list precisely because it looks like financial advice; it only belongs here *if* scoped carefully as "here's what's true" rather than "you should sell," directly applying the N-best/hedge-don't-assert lesson from the approval-UX research rather than the false-precision failure mode documented there.

---

## Rules for Deck-E

Distilled, numbered, testable design rules synthesizing all eight sections above.

1. Deck-E must never appear or speak unsolicited — invoke-on-demand only. *(Clippy retrospective — every mainstream assistant since has adopted this.)*
2. On invoke, scale up from zero and travel to the chat position as one continuous, interruptible animation — any user click/scroll/keypress mid-travel cancels or defers it.
3. Target ≤1.0s from invoke/send to any visible state change; target first streamed token or status line well under the 10s attention-loss ceiling.
4. Below 1s expected latency, show nothing (no skeleton/spinner — it will flicker). Between 1–10s, use a skeleton (whole-view loads) or spinner (isolated widgets) with explanatory text, never a bare indicator. Beyond 10s, show present-tense step narration, an elapsed-time or step counter, and an explicit cancel control.
5. Once tokens stream, retire all loading chrome — streaming text is the progress indicator, not a decoration alongside it.
6. Separate ambient liveness (a persistent "Deck-E is thinking" signal) from structured progress (a mutating step list) — build both, they answer different user questions.
7. Represent each tool-call step as ephemeral by default (vanishes once superseded), narrated in present tense while running and flipped to past tense on completion — never leave a stale "Searching…" label after the result lands.
8. Never render a tool-call as full card chrome (border/shadow/elevation/fill) — flat single-line rows only, chevron + icon + label, grouped under one header with a hairline/left-rule for sequential calls. Reserve card chrome for content that is a genuinely different surface (a diff, a card-scan preview).
9. Make failure the deliberate exception to collapse-by-default: a distinct color/badge, auto-expanded, never folded into the same one-liner a success gets.
10. Never fabricate step narration that doesn't correspond to real work — the labor-illusion payoff inverts into a trust violation the moment it's caught.
11. Any mutating action must produce an itemized approval card — never an aggregate ("12 cards added"): one row per card (name, set, variant, quantity), a before/after delta at the top, and action-labeled buttons ("Add 12 cards" / "Add selected (9)"), never generic Accept/Reject.
12. Default per-item selection state to confidence: high-confidence matches pre-checked, low-confidence or ambiguous matches pre-unchecked (opt-in, not opt-out).
13. Never show a bare confidence percentage. When uncertain between candidates, present the top 2–3 named options and ask — never silently guess and hope the review step catches it.
14. Let the user edit a guessed field inline in the review row (variant, quantity, condition) rather than forcing reject-and-redo-the-whole-request.
15. Reserve hard pre-commit approval gates for genuinely hard-to-reverse actions (bulk deletion, overwriting existing data); default easily-reversible actions (adding cards) to a lighter apply-plus-undo-toast pattern once trust is established, and never let approval-prompt frequency creep up unchecked.
16. Batch multiple pending approvals into one review screen, never a rapid-fire sequence of separate prompts.
17. The full-screen chat scrim must be ≥ Material's 32% black baseline over flat UI, increased and/or paired with blur over DeckPal's card-art-heavy backdrops, with contrast verified at the worst-case point of the live background (WCAG 4.5:1 body / 3:1 large text) — never assumed from an average.
18. Keep the app's top chrome legible by stacking it as its own opaque layer above the blur/scrim in z-order, not by trying to carve a hole out of one blur pass.
19. Implement the overlay to the WAI-ARIA APG modal pattern exactly: Tab/Shift+Tab wrap inside, Escape closes, focus returns to the invoking element on close, everything outside is genuinely `inert` plus `aria-modal="true"`.
20. Size the overlay with `100dvh` and set `viewport-fit=cover`; reposition the composer via `window.visualViewport` (listening to both `resize` and `scroll`) since `dvh` does not account for the on-screen keyboard. Use `overscroll-behavior: contain`, not bare `overflow: hidden`, for scroll lock, and test specifically in standalone PWA mode.
21. Deck-E's idle/thinking gaze looks up and away, never holds eye contact by default — justified by gaze-aversion/cognitive-load research and by robot-gaze research showing sustained mutual gaze burdens the user; justify the "up" angle by animation convention/legibility, not neuroscience.
22. Keep idle-drift gaze visually distinct from guiding/pointing gaze — since gaze reliably pulls user attention wherever it points, an idle glance must never be mistakable for a navigation cue.
23. During turn-by-turn wayfinding: spotlight each target with a live, interactive cutout (never a screenshot); advance on the user's real click on that target, not a synthetic "Next"; scale the outline-then-click dwell time to the action's consequence (near-instant for navigation, a deliberate pause or explicit confirm before anything that submits or deletes); treat any user click/scroll/keypress during a flight as an implicit "stop guiding me."
24. Auto-shrink or get out of the way whenever Deck-E would occlude content the user is looking at, and never repeat the same guidance line or animation for something the user has already demonstrated they understand.
25. Under `prefers-reduced-motion`, cut Deck-E's travel/flight animation to an instant or fade reposition while preserving the functional signal (the static outline still lands on the right element) — never disable Deck-E outright.
26. For any market-value, sell/hold, or grading-ROI feature (§8 items 4, 18, 22), phrase output as hedged considerations with named factors, never as a confident directive — apply the same N-best/no-bare-percentage discipline used for card-identification uncertainty to financial-adjacent uncertainty.
27. Every domain feature that mutates data (adding cards, moving cards to bulk, formalizing a trade) must route through the itemized approval card in rule 11 — no domain feature gets a bespoke, less-rigorous confirmation pattern of its own.
