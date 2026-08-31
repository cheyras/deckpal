# Deck-E improvement pass — MASTER BRIEF

**Status:** authoritative requirements document. An implementation plan is built from this.
**Primary source:** owner's 26:43 narrated screen recording, `E:/Users/cheyr/Videos/CursorCaptures/capture-20260822-121909/transcript.txt`.
**Supporting sources:** 7 frame-by-frame scribe transcriptions of 275 stills (`scratchpad/deck-e-pass/scribe/range1..7`); **9** code-research documents (`scratchpad/deck-e-pass/research/R1…R9`), plus the byte-exact recovered source of all 20 beautifului.dev components at `research/src/*.tsx`.
**Repo state at research time:** `main`, commit `209150f`. Tree was clean at research time; it now carries ` M .gitignore` and `?? scripts/visual-harness/` from the R9 work (§7.6.2).

**Revision history:** rev 1 (2026-08-22) — built from the transcript, the scribes, and R1–R5/R7/R8. **Rev 2 (2026-08-22, adversarial audit)** — R6 and R9 folded in (Parts 4b and 7.6); C54–C60, D10–D13 and §§6.11–6.13 added; Q12–Q14 added; **eleven `file:line` or arithmetic errors corrected in place, each marked `[AUDIT]`**. The audit's own report, including everything it could *not* verify, is at `scratchpad/deck-e-pass/BRIEF-AUDIT.md`.

**Two disambiguations, already settled — do not re-derive:**
- Where the transcript says **"the clock"**, he means **Claude** (claude.ai). Confirmed: he types `claude.ai` into the omnibox at t=2:16 (scribe range1, `t00136.020_framechange`). The speech-to-text mangled it.
- **"beautiful UI.dev"** is **beautifului.dev** — *"Beautiful UI — Crafted primitives for AI-native interfaces,"* built by a product-design studio called **Turbo**. Confirmed via his Google search at t=4:41 (scribe range1, `t00281.542_framechange`).

**The two formerly-PENDING sections are now written.**
- **`R6-beautiful-ui.md`** → folded into **Part 4b**, which is now built from the byte-exact component source rather than screenshots alone. New: §4b.0.1 (MIT licence, no repo/npm, the four unpublished internal helpers, the two pre-1.0 optional deps) and §4b.0.2 (the token system and the shared animation vocabulary — **the most transferable thing on that site**). §4b.3d records where R6 and the scribes disagreed and which won.
- **`R9-visual-harness.md`** → folded into **Part 7, §7.6**, split into §7.6.1 (the wire-level gates) and §7.6.2/§7.6.3 (the new visual harness and its vision judge). **This changed what §7.4 and C49 say is provable about the mobile defects** — both have been rewritten, and both now carry the honest residual.

**One error corrected across the whole document:** an upstream note claimed Playwright was absent from this project. It is not. `scripts/decke-gates.mjs` is a 2,562-line Playwright suite in daily use. What is true is only that **Playwright is not a declared dependency** — zero `package.json` entries, resolved at runtime, deliberately. See §7.6.

**How to read the correction marks:** anything marked **`[AUDIT]`** is a rev-2 change to a rev-1 claim — a wrong line number, a wrong file path, a bad sum, or an overstatement. The surrounding text is otherwise rev 1's.

---

# Part 1 — Executive summary

Roughly ordered by how much he cared, judged by emphasis, repetition, and how much recording time he spent on it.

1. **Deck-E loads and renders himself on every page with no click.** He opens this as *"number one issue"* [1:03]. Two costs: the ~6.9 MB automatic download the launcher chip existed specifically to avoid, and — separately — the fact that the big 3D character and the 2D launcher chip are **both on screen at once**, which the code's own comment calls "two Deck-Es, which is the exact thing the whole well design exists to avoid."
2. **The chat should be a Claude-style full-screen takeover, not a small docked window.** Composer centred, moving to the bottom once the conversation starts; background darkened *and* much more blurred; app top chrome left sharp.
3. **He is in the wrong place and facing the wrong way.** On desktop he stands a third of the screen away from the panel; on mobile his position is right but his facing is wrong. Everywhere he faces *away* from the conversation. He wants him immediately left of the composer, outside its margins, looking inward.
4. **No rich text.** Literal `**asterisks**` render as text in every answer, desktop and mobile. He drag-selects them on camera three times to prove it. Called *"very harrowing to read."*
5. **The whole "what is he doing right now" surface is wrong.** Tool chips dump all at once before anything runs, are static tags with no affordance, show intent rather than current state, sit below the answer instead of above it, and reorder themselves.
6. **Long turns feel dead.** ~86 seconds of visible generation with no incremental feedback; he says twice that he began doubting it was working, and that "if it's like that for me, it's definitely going to be" for anyone else.
7. **He wants interstitial narration between tool calls, Claude-style** — *"okay, I've looked at your collection. Now let me do some research"* — plus a brief expression change on Deck-E between beats so he doesn't look stuck.
8. **Navigation should be an escorted journey, not a teleport.** Hop out of chat → travel to the link → outline it → click it → hop → outline → click → "here it is," with short spoken beats in between and a structured *"traveled to X / clicked Y"* record in the transcript.
9. **Mobile is broken in several concrete ways**: the page cannot be scrolled at all; the header title and X sit inside the iOS status bar; the top of the answer is cut off and unreachable; a large dark dead band sits under the composer; the app's top chrome is blurred when it shouldn't be.
10. **The composer must become a card, not a bare pill** — modelled on Claude iOS: a rounded card containing the text line above a control row, conversation fading behind it, generous bottom spacing. Deliberately *simpler* than Claude's: **no model picker**, but a `+` button, and photo attachment as a likely addition.
11. **He wants beautifului.dev mined properly** — *"have some subagents really pore over this"* — with the **Recommendation Card** singled out as the thing to adapt: *"want me to put these cards in"* with card thumbnails, names and variants, a confidence indicator, and Accept as the commit of a dry run.
12. **The ad-hoc screen system should get an inline, compact preview form** — a small in-chat widget with real card thumbnails, expandable into the full screen.
13. **Thinking gaze should look up and away, not at the camera.** He calls this *"a small thing to fix."*
14. **Responses are too long for what was asked**, particularly for navigation requests — *"the ugliest-looking thing ever."*
15. **He wants creative domain ideation** — new Deck-E use cases nobody has thought of yet, grounded in the Pokémon TCG domain.

Two more that are directives rather than complaints: **web-search visibility must be shown** [5:55], and **he wants developer-side observability of which model is running and why a turn is slow** [8:24] — explicitly *not* a UI feature.

**Four things rev 2's audit adds to this summary, because they change what the top of the list means:**

- **Item 1 has a bill attached that nobody has costed (D12).** Gating the load behind a click is right, but the warm-on-intent path it relies on **does not work on touch** — `touchstart` precedes the click by ~100 ms, and there is no hover on a phone. So the fix as stated turns "he's annoyingly already there" into "tap, then wait for 7.1 MB" **on the platform he specifically named as worst**. The wait must be designed, not discovered. (And the real number is **7.1 MB**, not 6.9 — rev 1's table sums wrong.)
- **Items 2 and 3 contain a contradiction that has to be settled before anything is built (§6.13, Q14).** *"Full screen"* (C5) and *"leave the top bar sharp"* (C8, said three times) cannot both be literally true on a desktop that also has a full-height sidebar. The answer decides what "centred" means, and it is one sentence from him.
- **Item 4 is bigger than one import (D10).** The markdown fix as scoped touches `DeckeChat.tsx`. The **speech bubble is a second renderer of the same text** and is untouched — and item 8's escorted journeys route *more* text through it, not less.
- **One requirement was destroyed on camera and is not in this list (C54, Q12).** At [10:11] he began *"I honestly would have loved him to—"* and the browser hiccup cut him off. He never came back to it.

---

# Part 2 — The complete complaint register

Every distinct thing he expressed, actionable or not. `[MM:SS]` timestamps are from the transcript. Frame ids are the still basenames in the capture's `stills/` folder.

**Severity key:** blocker / major / minor / nice-to-have.
**Confidence** is in the *root cause*, not in the complaint.

---

## C1 — Recording jutter while Deck-E is running (CONTEXT, not actionable)

> *"[00:12] Recording is a little bit juttery, so I'm going to actually close, I have my phone pulled up here. [00:23] I'm going to close that and see if it helps. [00:31] Yeah, it helped some. [00:37] I think having him running at the same time as the screen recording is messing it up, but it's okay. [00:44] It doesn't do that when I'm recording with my recorder app here."*

**What he means:** the capture stuttered; he blames the combination of the phone-mirror app (LetsView) plus the always-running WebGL character plus the screen recorder, and explicitly excuses it.

**Visual evidence:** `t00026.213_framechange`, `t00028.559_preclick`, `t00029.532_postdrag` — LetsView being closed, then re-opened and dragged to the bottom-right corner.

**Code root cause:** none required. Worth noting only because it is weak corroborating evidence that a continuously-rendering WebGL character on every page has a measurable machine cost — which is the same cost C2 attacks from the network side. `DeckeHost.tsx:420-427` renders the canvas unconditionally whenever `entitled && !chromeless` (R1 §1.1).

**Severity:** context only. **Confidence:** n/a. **Conflicts with a decision:** no.

---

## C2 — Deck-E renders on page load without a click (his stated #1 issue)

> *"[01:03] So, number one issue is I load up the deckpal.app and Deck E comes up immediately without clicking this. [01:14] He should not just be hanging out here waiting for me to click this. [01:17] It's especially annoying on mobile, but the whole reason we did this whole little icon instead of using him was to prevent the 600 megabyte download on a cold load. [01:31] So, it makes no sense that it got implemented so that he just is here by default."*

**What he means:** the small 2D launcher chip exists precisely so the heavy 3D runtime is only paid for by people who ask for it. That contract is being violated — he is fully loaded, rendered and idling before any interaction. (His "600 megabyte" is a rhetorical figure; the real number is ~6.9 MB, see below.)

**Visual evidence:**
- `t00025.523_preclick` (t=0:25) — deckpal.app/series, chat closed, no click has occurred, and the full 3D Deck-E is already rendered and idle-animating over the series grid.
- `t00030.180_preclick` (t=0:30) — same state five seconds later with a different idle pose, proving it is his ambient render and not a one-off blip.
- `t00108.000_preclick` (t=1:48) — **verified directly for this brief.** Cropped to the bottom-right of the content area, this frame shows **two Deck-Es simultaneously**: the full 3D character (large, mid-right, lightning bolts up, eyes open, smiling) *and* the 2D chip launcher in the very corner, rendered in its **doze** state with its eyes closed. Reproduce with:
  `bash ".../scratchpad/view.sh" t00108.000_preclick 1500x1100+1300+800 1400`

**Code root cause — the load itself** (`R1 §1.1, §2`):
- `apps/web/src/character/host/DeckeHost.tsx:166-177` — an effect that fires `setPhase('loading')` on `requestIdleCallback(..., {timeout: 4000})`, or a 1500 ms `setTimeout` fallback, gated only on `entitled && !chromeless && phase === 'idle'`. **This is a timer, not a click.**
- Once `phase` flips, the effect at `DeckeHost.tsx:275-406` runs the whole load unconditionally, ending at `setPhase('ready')` (`DeckeHost.tsx:375`).
- The canvas fades `opacity-0 → opacity-100` purely as a function of `phase === 'ready'` (`DeckeHost.tsx:423-426`) — there is **no gate on "has the user clicked."**
- `DeckeButton.tsx:57-61` / `:69-71` (`warm()` on pointer-enter/touch/focus → `DeckeHost.tsx:440`'s `onWarm`) is the *intended* trigger and is effectively dead code: the timer above almost always wins first. The button's own doc comment at `DeckeButton.tsx:12-15` states the intended contract — *"the button is a cheap 2D stand-in that warms the real runtime on intent — pointer-enter or touch."*
- Clicking the button (`DeckeHost.tsx:439`, `setChatOpen(true)`) never touches `phase` at all.

**Code root cause — the real byte cost** (`R1 §1.2`, measured against `apps/web/dist` and `apps/web/public/models/decke/`):

| Asset | Raw |
|---|---:|
| `assets/Decke-runtime-*.js` (three.js r0.185.1 + all of `character/decke/**`, pinned chunk per `vite.config.ts:220-231`) | 1,199,040 (1.14 MB) |
| `models/decke/decke.glb` (`DeckE.ts:602`) | 2,918,432 |
| `models/decke/studio_small_09_1k.hdr` (**`character/host/runtime.ts:51`** — `[AUDIT]`: rev 1 cited `character/decke/runtime.ts`, which does not exist) | 1,608,057 |
| `models/decke/symbol_sdf_atlas.png` (`DeckE.ts:607`) | 1,069,793 |
| `models/decke/playbook.json` (`playbook.ts:200`) | 186,833 |
| `models/decke/cards.json` (`cards.ts:90`) | 44,311 |
| `models/decke/card_back.webp` (**`cardArt.ts:107`**, the `CARD_BACK_URL` constant, imported at `DeckE.ts:39` and used at `DeckE.ts:653` — `[AUDIT]`: rev 1 cited only `DeckE.ts:653`, which holds no literal) | 77,824 |
| **Total paid on a visit that never touches the button** | **7,104,290 bytes = ≈ 7.1 MB (6.78 MiB)** |

**`[AUDIT]` — the total was wrong.** Rev 1 said "≈ 6.9 MB". The listed figures sum to **7,104,290 bytes**, which is 7.10 MB decimal or 6.78 MiB binary — 6.9 is neither. Every individual figure re-measured and correct, including the `Decke-runtime-CFre3AQz.js` chunk at exactly 1,199,040 bytes. **Use 7.1 MB.** Relatedly, §5.8's "reloading 5.7 MB of assets" should read **5.91 MB** (the six model assets alone, 5,905,250 bytes, excluding the JS chunk). `[AUDIT]`: the `vite.config.ts` pin is at **`:224-231`** (`name: 'Decke-runtime'` on `:227`, the `test` regex on `:228`); `:220-223` is its explanatory comment.

**Code root cause — the coherence half (added at the coordinator's direction, verified against the frame):**
`DeckeHost.tsx:433-436` hides the launcher button while the chat is open, and the comment there gives the reason explicitly: *"leaving a second copy of him in the corner would be two Deck-Es, which is the exact thing the whole well design exists to avoid."* But because of the automatic warm at `DeckeHost.tsx:166-177`, **there are already two Deck-Es whenever the chat is closed** — the 3D body and the 2D chip, both painted, on every non-chromeless page, in the default state. The system is violating its own documented invariant by default. `t00108.000_preclick` is the proof frame; `t00924.821_framechange` (t=15:24) shows the same doubling again with the 3D character mid-flight and the chip visible in the corner.

**Who this affects in production** (`R1 §1.3`, `entitlement.ts:36-66`): entitlement fails closed in cloud production (`me.decke`, i.e. owner or `DECKE_ENTITLED_USER_IDS`), but is unconditionally `true` in dev (`entitlement.ts:45`) and in self-host (`:48`). So the bug reproduces on essentially every page load for the owner and for any dev session, and for every entitled cloud user.

**Severity:** blocker (he named it #1; it is also a self-inflicted performance regression against a documented design goal).
**Confidence in root cause:** very high — the timer is explicit, the byte table is measured, the "two Deck-Es" invariant is quoted from the file that breaks it.
**Conflicts with an existing decision:** **No — the opposite.** Fixing this *restores* two documented decisions. See Part 6, §6.9.
**Implied fix:** gate `DeckeHost.tsx:166-177` behind real intent.

---

## C3 — He should be absent, then scale up from zero and travel in on click

> *"[01:38] He should be gone, and then when I click, he should scale up from zero and travel to where he's supposed to be for the chat."*

**What he means:** the open transition should read as *summoning* — nothing there, then he materialises and moves into position — not as "a character who was already standing there slides sideways."

**Visual evidence:** `t00108.000_preclick` → `t00109.263_framechange` (t=1:48 → 1:49) is the actual current transition: he is already fully rendered at full size before the click; after the click the panel appears and he is simply *there*, left-of-centre, with a large dark gap between him and the panel.

**Code root cause** (`R1 §6`):
- **The character never scales from zero.** He is either not loaded (canvas `opacity-0`) or loaded at his full constant on-screen height (`characterHeightFor`, `DeckeHost.tsx:81-84`). The canvas-level 500 ms opacity fade (`DeckeHost.tsx:423-426`) is the only "appearing" animation he has, and per C2 it fires on a timer unrelated to the click.
- No whole-body screen-space scale animation exists anywhere in `DeckE.ts` / `rig.ts`. The only squash channel is `CHANNEL_RANGE.sq` (`constants.ts:148`) applied via `rig.squash.scale.set(...)` (`rig.ts:254`) — a per-pose shape deformation used by the `boot` state, not a scale-up-from-zero.
- The **travel** half already exists and is real: `flyTo` (`DeckE.ts:1101-1179`) genuinely flies him from home to the stand point, driven by `DeckeHost.tsx:227-263`.
- The **panel's** animation exists too: `@keyframes decke-chat-in` (`apps/web/src/theme.css:704-713` — `opacity 0→1`, `translateY(16px) scale(0.94) → none`), applied at `DeckeChat.tsx:441`. `[AUDIT]` — **the 280 ms is not in the keyframes**; the block carries no duration at all. The timing lives entirely at the call site: `animate-[decke-chat-in_280ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]`. The same keyframe is reused at three different durations — `DeckeBubble.tsx:120` at 200 ms and `DeckeChat.tsx:389` (the minimised travel bar) at 220 ms — so **changing the keyframe changes all three**, and changing the duration is a per-call-site edit. Its own comment (`theme.css:697-703`) states the intent — *"It GROWS OUT OF THE BUTTON… a panel that simply appears reads as a webpage while one that expands from where you clicked reads as him arriving"* — but **the transform-origin is not tied to the button's real DOM position**; the panel is a fixed bottom-right box, not a `getBoundingClientRect()`-derived origin.

**`[AUDIT]` — the landmine rev 1 states but does not connect, and it rules out the obvious implementation.**
The natural first attempt at "scale up from zero" is to animate `characterHeightFor`'s output from `0` to full and feed it to `decke.stage.setCharacterHeight(px)` (`DeckeHost.tsx:332`). **That cannot work.** `setCharacterHeight` **dollies the camera** rather than scaling a mesh — stated in the file's own comment at `DeckeHost.tsx:72-76` (`[AUDIT]`: rev 1 cited `72-80`; `:78-79` is an unrelated note about 300 px suiting a laptop and `:80` is the close). Driving it toward zero pulls the camera to infinity, and every position solved in blender-space becomes wrong as it moves — which is exactly the bug the "resize first, *then* solve the destination" ordering at `DeckeHost.tsx:227-263` (resize at `:230`, solve inside a 320 ms timeout plus one rAF at `:235-255`) was written to prevent.

So a scale-from-zero must come from one of three places, none of which exists today, and the plan should pick deliberately:
1. **A root-group scale inside the rig** — a new whole-body channel. Truthful in 3D, but touches the engine and will interact with `CHANNEL_RANGE.sq` (`constants.ts:148`, `sq: {min: -0.3, max: 0.6}`) and `rig.squash.scale.set(...)` (`rig.ts:254`), which is a *per-pose shape deformation* driven by the playbook, not a transform anyone else owns.
2. **A CSS transform on the canvas element** — cheapest by far, and it composites on the GPU. But the canvas is `fixed inset-0 h-[100lvh] w-full` at `z-30` (`DeckeHost.tsx:424`), so scaling it scales the *whole viewport-sized surface* about some origin, not the character within it, and the DOM-anchored parking maths (`pageAnchor.ts`, `DeckeBeacon`, `.decke-shift` reflow) all read that element's geometry.
3. **Compose it out of what already exists** — the 500 ms canvas opacity fade (`:423-426`) plus the `boot` state's authored squash plus a short `flyTo` from off-screen. **This is the only option that adds no new mechanism**, and it is probably what "scale up from zero and travel to where he's supposed to be" actually looks like when built well.

**Nobody should choose between these from this brief alone** — but nobody should discover option 1's camera problem halfway through implementing it either.

**Severity:** major (it is the payoff of the C2 fix; without it, fixing C2 just means he pops in).
**Confidence:** very high on the absence; **the mechanism for adding it is an open design choice, not a known quantity.**
**Conflicts:** no. Note that `theme.css:697-703` already *asks* for the behaviour he is describing.

---

## C4 — He is too big, on desktop as well as mobile

> *"[01:52] He should be probably a little bit smaller, honestly. [01:57] We made him smaller on mobile, but I think he should be a little bit smaller on desktop as well. [02:02] He's just really, really big."*

**What he means:** reduce his on-screen size generally, and specifically fix the fact that opening the chat on desktop does not shrink him at all.

**Visual evidence:**
- `t00109.263_framechange` — with the chat open, he spans roughly the left 20–47% of the content pane's width and the bottom 45–95% of its height, while the panel is a 420 px column at the far right.
- `t00720.597_postdrag` (t=12:00) — at full desktop width he measures ~167 × 235 px in a ~995 px-wide viewport, with a ~365 px empty gap between him and the panel.
- `t00782.053_framechange` / `t00786.134_preclick` (t=13:02–13:06) — on the Pitch Black page he is large enough that his own speech bubble covers his head; only one eye, part of the head and the smile show past the bubble's left edge.
- `t00924.821_framechange` (t=15:24) — mid-flight he covers an entire card in the grid and part of the filter row.

**Code root cause** (`R1 §3`):
```ts
// host/DeckeHost.tsx:61
const CHAT_COMPACT = 0.5
// host/DeckeHost.tsx:81-84
function characterHeightFor(w: number, h: number, compact: boolean): number {
  const full = Math.min(300, h * 0.3, w * 0.55)
  return Math.round(compact ? full * CHAT_COMPACT : full)
}
```
`compact` is computed at `DeckeHost.tsx:330` as `chatOpenRef.current && w < NAV_BREAKPOINT` — i.e. **half-size applies only on a phone while the chat is open**. On desktop `compact` is always `false`, so his chat-open size is the *same* as his idle size, capped at 300 px, next to a panel that is `420 × min(620, 100vh-140px)` (`DeckeChat.tsx:441`). A 300 px character beside a ≤620 px panel is roughly half the panel's height.

**Landmine:** `decke.stage.setCharacterHeight(px)` (called at `DeckeHost.tsx:332`) **dollies the camera**, it does not scale a mesh (comment, `DeckeHost.tsx:72-80`). Any position solved before the dolly is wrong after it — which is why the effect at `DeckeHost.tsx:227-263` deliberately resizes first (line 230) and only then solves the destination inside a 320 ms timeout plus one rAF (lines 235-255).

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C5 — The chat should be a full-screen takeover like Claude, not a little window

> *"[02:06] I think instead of having this be like a little window, I'd like it to be more like the clock. [02:13] So, I'll show you, actually, so you can actually see it. [02:19] How it's full screen."*

**What he means:** replace the 420 px bottom-right docked panel on desktop with a full-viewport chat surface in Claude's shape.

**Visual evidence:** `t00147.483_preclick` (claude.ai home, centred composer, model selector, mic/waveform) and `t00156.191_preclick` (claude.ai conversation view — composer moved to the bottom, horizontally centred in a constrained column ~420/1400 of the capture width, *not* edge-to-edge). Contrast `t00109.263_framechange` — DeckPal's narrow side-docked panel.

**Code root cause** (`R1 §7`): the desktop panel is hard-coded as
`fixed z-[25] bottom-[24px] right-[24px] h-[min(620px,calc(100vh-140px))] w-[420px] rounded-[18px] border border-border-default bg-surface-primary shadow-2xl` (`DeckeChat.tsx:433-444`). Mobile is already `inset-0` full-screen.

**Note on what Claude is and is not a precedent for:** the scribe flags honestly (range1, `t00156.191_preclick`) that claude.ai has no background page to darken — it is a dedicated full-page app. So Claude is a precedent for **layout** (full-viewport, centred, composer at the bottom), not for the scrim/blur treatment itself.

**Severity:** major. **Confidence:** very high (it's a layout constant).
**Conflicts:** partially — see C9/C29 and Part 6 §6.2/§6.3, because the current mobile-vs-desktop scrim and panel treatment are deliberate and documented.

---

## C6 — The composer starts large/centred and drops to the bottom once you type

> *"[02:22] So, I picked this as being like, you know, a bigger chat box, and then when I type in, [02:30] it goes down to the bottom, and then, you know, it's centered in here and everything."*

**What he means:** the empty state has a prominent centred composer; sending a message transitions it to a bottom-centred composer with the transcript above it. This is the Claude home → conversation transition.

**Visual evidence:** `t00147.483_preclick` (empty/centred) vs `t00156.191_preclick` (sent/bottom-centred), both claude.ai.

**Code root cause:** no such empty-state treatment exists. The scroll container is `DeckeChat.tsx:471-474` (`flex flex-1 flex-col overflow-y-auto px-[16px] pb-[12px]`) and the composer is always the last flex child (`DeckeChat.tsx:647-652`). `[AUDIT]` — **`mt-auto` is on the two *children*, not on the container**: the empty-state `<p>` at `:476` and the message `<ul>` at `:480` each carry it. That distinction matters for C50's fade mask, which has to attach to the scrolling element, not to what it holds. The empty state is a single line of placeholder text at `:477` ("Ask me about your collection, or tell me to show you something.", inside the `<p>` that opens at `:476`), sitting in a mostly-empty panel — see `t00109.263_framechange` and `t00652.071_preclick`, both of which show a large dead area above two lines of text.

**Severity:** major (it is the visible shape of C5). **Confidence:** high. **Conflicts:** no.

---

## C7 — The backdrop must be much more blurred and more darkened

> *"[02:36] I want this to be the same, so all of this is darkened and it needs to be more blurred so that you can't see so clearly what's in the background, [02:45] but you can tell that something is still there, and a little bit more darkened here."*

**What he means:** you should be able to tell the app is still behind, but not read it. Both the alpha and the blur radius go up.

**Visual evidence:** `t00109.263_framechange` is the cleanest proof — the "Mega Evolution", "Scarlet & Violet", "Sword & Shield" wordmarks and their percentage rings stay **perfectly crisp and legible** through the dark layer. `t00178.433_preclick` (t=2:58) reconfirms the identical state minutes later — stable, not a transient.

**Code root cause** (`R5 §1 Defect 5`): `DeckeChat.tsx:409-418` —
`fixed inset-0 cursor-default bg-black/45 backdrop-blur-[3px] motion-safe:animate-[sheet-scrim-in_180ms_ease-out_backwards]` (classes on `:414`), `z-[15]` desktop / `z-[24]` mobile (`:416`). The breakpoint ternary changes **only** the z-index; colour and blur are identical at both widths. Both `45%` and `3px` are Tailwind arbitrary values inline in JSX, **not** driven by the existing scrim tokens.

**`[AUDIT]` — rev 1 conflated the two scrim tokens, and the distinction is useful for this exact complaint.** There are two, adjacent in `apps/web/src/theme.css` (**note the real path: `src/theme.css`, not `src/styles/theme.css`, which rev 1 used in §7 — there is no `styles/` directory**):
```css
/* theme.css:140 */ --color-overlay-scrim:        rgb(52 47 45 / 0.7);   /* warm dark gray, 70% */
/* theme.css:141 */ --color-overlay-scrim-strong: rgb(26 23 22 / 0.75);  /* near-black, 75% */
```
Rev 1 attributed the `-strong` value to the plain token. `Sheet.tsx:265` uses **`--color-overlay-scrim-strong`** (`style={{ background: 'var(--color-overlay-scrim-strong)' }}`), with no blur anywhere in that file. **So the app's existing "serious overlay" scrim is already 75% near-black — considerably darker than the chat's inline `bg-black/45`** — and "more darkened" (C7) has a ready-made token to reach for rather than a new arbitrary value to invent. That is a better answer than rev 1's, and it lands the change inside the token system instead of beside it.

**Corroborating external standard** (R8 §7): Material's default modal scrim is black at 32%; DeckPal's backdrop is card-art-heavy (high local contrast variance), which is exactly the case where a flat scrim under-performs and Apple's blur-plus-vibrancy answer applies. WCAG contrast must hold at the **worst point** of a live variable background (`https://www.w3.org/TR/WCAG20-TECHS/G18.html`).

**Severity:** major. **Confidence:** very high. **Conflicts:** no for desktop; see C29 for mobile.

---

## C8 — Do not blur the app's top bar (desktop) — stated, self-corrected mid-sentence, then confirmed

> *"[02:54] And I would say blur this up at the top and have it be only the, I don't know, maybe not. [03:08] Yeah, just blur in here on second thought, and just have it very blurred and more darkened, [03:18] and then he's to the left of the text input."*

**What he means:** he starts to say "blur the top too," reverses himself inside the same sentence, and lands on: **blur only the content region; leave the app's top bar sharp.** He re-confirms this twice later ([11:51], [21:28]) and both times extends it to mobile — see C29.

**Visual evidence:** `t00109.263_framechange` — the top header bar (DeckPal logo, Search Cards field, Scan button, avatar "60 cheyras") and the entire left nav (My Lists, Deck Builder, Pokédex, Insights, Scan Card) stay at **full undimmed brightness**; only the main content pane darkens.

**Code root cause** (`R5 §3`): this is already the desktop behaviour and is deliberate. Scrim is `z-[15]`, below `--z-chrome: 20` (`theme.css:287`), so `AppShell.tsx:271` (Sidebar) and `AppShell.tsx:428` (Header) paint above it. The file states the intent at `DeckeChat.tsx:402-407`: *"Content sits at 0 and app chrome at 20, so this darkens and blurs the page while leaving the header and sidebar sharp — which is the desktop behaviour asked for."*

**Severity:** minor for desktop — **already correct**; the actionable half is mobile (C29). Recorded here so the plan does not "fix" desktop into something worse.
**Confidence:** very high. **Conflicts:** no (desktop already matches).

---

## C9 — He belongs immediately left of the text input, outside its margins

> *"[03:18] and then he's to the left of the text input. [03:25] Just kind of mimicking this, but imagine that he's right here, kind of outside of the margins of the text input on desktop."*

**What he means:** in the new full-screen layout, Deck-E stands beside the composer — flush to its left, just outside its box — not out in the middle of the page.

**Visual evidence:** `t00720.597_postdrag` is the counter-example: at full desktop width he occupies the left third of the viewport, the panel the right quarter, and **more than a third of the screen width is empty gap between them.**

**Code root cause** (`R1 §4.2`):
```ts
// host/DeckeChat.tsx:78
export const STAND_DESKTOP = { x: 0.36, y: 0.58 }
// host/DeckeChat.tsx:88
export const STAND_MOBILE = { x: 0.14, y: 0.84 }
// host/DeckeChat.tsx:81
export const PARK_LANDMARK = 'data-decke-park'
```
On desktop he always flies to the fractional-viewport point `STAND_DESKTOP` (`DeckeHost.tsx:249-253`). **No code reads the panel's actual `getBoundingClientRect()` on desktop at all** — `STAND_DESKTOP` is a hand-picked constant with no relationship to where the panel is or how wide it is. On mobile he flies to the DOM landmark `[data-decke-park]`, a `pointer-events-none` empty div at `left: 10px; bottom: 6px` inside the full-screen panel, sized `parkW × parkH` (`DeckeChat.tsx:568-580`), with `STAND_MOBILE` only as a fallback if the selector hasn't resolved.

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C10 — The tool chip appears before the answer and then sits underneath it

> *"[03:51] Okay, so an interesting thing is that this comes up first, and then this comes up, and the collection summary is still underneath it. [04:00] That feels wrong to me, unintuitive"*

**What he means:** the "Collection summary" chip appears alone first (correct — it *is* what happened first), then the answer arrives **above** it, leaving the chip stranded below. The reading order is inverted.

**Visual evidence:**
- `t00229.071_framechange` (t=3:49) — user bubble, then a plain gray-outlined "Collection summary" pill, and **no assistant text at all**. Send button has become a white square (stop).
- `t00236.233_preclick` (t=3:56) — the answer bubble has arrived *above* the pill; the pill is unchanged below it, with no completed/checkmark state distinguishing it from its loading state.

**Code root cause** (`R4 §A.3`): in `DeckeChat.tsx` each `<li key={m.id}>` (lines 482-549) renders in this literal order: **(1)** the text bubble (lines 492-503), **(2)** the tool-chip `<ul>` (lines 519-540), **(3)** the screen panel (lines 541-548). But the comment directly above the chips (`DeckeChat.tsx:504-518`) says the opposite is intended:

> *"Rendered ABOVE his words on purpose — the reading order is 'I checked your collection' then 'you've got 70 of them'…"*

**The comment is stale and does not match the code.** The flex column with `gap-[8px]` puts chips visually *below* the text. His complaint is therefore identical to the code's own stated intent — this is a regression from a documented design, not a new request.

**Severity:** major. **Confidence:** very high (the file contradicts itself in ten lines). **Conflicts:** no — fixing it restores the comment's intent.

---

## C11 — No rich formatting; raw markdown asterisks reach the screen

> *"[04:00] and there's no, like, real formatting. [04:10] Like, it looks like this should be, like, bolded or something, but it isn't. It's, like, these weird asterisks, so having some actual, like, rich formatting would be very cool."*

Restated on mobile:
> *"[20:49] The problem with this is that there's no, like, rich text editing, so it's very harrowing to read, you know. [20:57] It's just not ‑‑ it doesn't look good."*

**What he means:** render markdown.

**Visual evidence — he demonstrates this on camera five separate times:**
- `t00236.233_preclick` — *"You have \*\*604 distinct cards\*\*, with \*\*1,298 total copies\*\* across them."* with the asterisks intact.
- `t00249.890_postdrag`, `t00253.611_postdrag` — he drag-selects exactly `**604 distinct cards**` (asterisks included) twice.
- `t00257.712_postdrag` — he then selects `**1,298 total copies**`, which wraps across two lines, proving both spans are affected.
- `t00615.637_preclick` — **verified directly for this brief.** The long deck-ideas answer contains `**Mega Evolution**` ×2, `**Psychic**`, `**Water**`, all unrendered, *and* the bullet list is a run-on paragraph with bare hyphens and no line breaks: *"For example: - Focus only on your \*\*Mega Evolution\*\* cards (me04/me05) - Look for strong \*\*Psychic\*\* or \*\*Water\*\* decks - Or something casual/fun using your big Base Set vintage pile Just say the direction and I'll dig deeper."*
- `t00782.053_framechange` / `t00859.447_preclick` — `**Pitch Black**`, `**58% complete**`, `**Top cheap ones to grab:**`, again with a hyphen list flattened into prose.
- `t01245.678_framechange` (mobile) — `**3. Mega Dark/Psychic Swarm (from me05 Pitch Black)**`, `**4. Fire/Fighting Mixed Aggro (Base + me04 Chaos Rising)**`.

**Code root cause** (`R4 §A.3`, `§A.6`): `DeckeChat.tsx:492-503` renders `{m.text}` as a raw JSX child inside a `div.decke-bubble`. **No markdown parsing of any kind.** One line of code.

**What already exists** (this is a Part 5 item, stated here because it changes the size of the fix): `react-markdown@^10.1.0` and `remark-gfm@^4.0.1` are already dependencies in `apps/web/package.json`, and a complete token-styled renderer already exists at `apps/web/src/routes/deck/MarkdownView.tsx` (52 lines: h1–h4, p, a with `target=_blank`, ul, ol, li, strong, inline code on `bg-surface-tertiary`, pre, blockquote, hr, table/th/td on `border-border-default`). It is used only by `StrategyTab` via `React.lazy()`, with a header comment explaining the lazy-chunk pattern (~40 KB gz in its own chunk, never in the main bundle). `DeckeChat.tsx` does not import it. No other markdown or sanitisation library exists anywhere in the repo.

**Server side** (`R4 §A.6`): nothing in `apps/api/src/decke/prompt.ts` or `tools.ts` tells the model to avoid markdown, so this is purely a front-end rendering gap, not a prompt fix.

**Severity:** blocker (he raises it twice, on both platforms, and demonstrates it five times).
**Confidence:** very high. **Conflicts:** no.

---

## C12 — The thinking/loading state needs more to it

> *"[04:22] And then while he was thinking, it would be, I mean, he's already doing a loading animation, but I think this needs to have something more to it as well."*

**What he means:** the character's idle rock is the *only* thinking signal; the chat surface itself shows nothing.

**Visual evidence:** `t00229.071_framechange` through `t00486.702_preclick` — across 90+ seconds the chat panel contains only the user bubble, three static pills, and a stop button. `t00415.929_framechange`, `t00427.609_framechange`, `t00437.694_framechange` show Deck-E's lightning-bolt hair rotating slightly between frames, which is the entire visible progress feedback.

**Code root cause** (`R4 §A.4`): **there is no per-message loading affordance in the transcript at all.** The only loading signals are (a) `decke.setState('thinking')` on the 3D engine (`useDeckeChat.ts:195`), (b) the composer's Send→Stop swap, a plain filled square with no spinner or label (`DeckeChat.tsx:681-699`). The assistant `ChatMessage` is inserted with `text: ''` (`useDeckeChat.ts:181`) and the bubble is guarded by `m.text ? ... : null` (`DeckeChat.tsx:492`) — so **before the first token arrives the transcript renders literally nothing new.**

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C13 — Directive: study beautifului.dev and apply it

> *"[04:33] So, as you're thinking about this chat UI, I want you to consider this website, beautiful UI, crafted for AI native interfaces, and really consider what we can do in here, because there's a lot of good stuff in here that I think we can learn from."*

Restated harder later:
> *"[16:05] And I'm going to go through a beautiful UI here and show you some of the things that I like about it. [16:11] I want you to really consider these components or these, like, primitives and really consider, like, which one might improve the experience over what we currently have."*
> *"[18:59] So I want you to really pore over this. Like, have some subagents really pore over this and, like, come up with, like, some really stellar designs for how this thing can work."*
> *"[19:41] So, yeah, definitely have a deep look at beautiful UI.dev."*

**Visual evidence:** `t00281.542_framechange` (the Google result confirming the domain and its four preview tags: Loading State / Thinking / Streaming Text / Approval Card), then the full site tour across ranges 2, 4, 5, 6 and 7.

**Severity:** directive, not a defect. Governs Part 4b. **Conflicts:** no.

---

## C14 — Expandable "you can see what's going on" traces

> *"[04:55] Even, like, the, you know, being able to expand this and see that stuff is going on is great."*

**What he means:** the beautifului.dev **Thinking** component — a collapsed one-line summary that expands into the actual step detail.

**Visual evidence:** `t00310.655_preclick` — "02 Thinking" expanded, showing four checklist steps each with a green checkmark: *"✓ Reading flavor briefs", "✓ Scanning supplier lists", "✓ Comparing tasting notes — 6 flavors", "✓ Writing the scope report"*, over a sub-tab strip **Steps / Reasoning / Search / Coding**. The collapsed header cycles through three distinct labels across `t00348.691`, `t00358.259`, `t00359.826`: *"Thought for 4 seconds"* → *"Ran 3 tools"* → *"Searched the web"*, with the matching sub-tab highlighting each time.

**Code root cause:** DeckPal has no equivalent. Chips are a flat `<ul>` of static `<li>` with no expansion (`DeckeChat.tsx:519-540`); the tool's real result is stashed **only** in the native `title` attribute — a browser tooltip, **invisible on mobile** and undiscoverable without hovering on desktop.

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C15 — The chip reads as a static tag, and it isn't clear whether it is clickable

> *"[05:04] Having something animating here is great, because in deck E, this just looks like a kind of standard, like, tag. [05:18] I don't know, it was not clear whether, like, it's something I'd be able to click on or something. [05:22] Like, when I first saw this, actually, on my phone, this came up after the message, and it almost made it feel like I thought I could maybe click on it to, like, have him take me to, like, an ad hoc screen that he had whipped up or something, but that wasn't the case, so a little bit confusing."*

**What he means:** the pill looks pressable but isn't. He specifically expected pressing it to open an ad-hoc screen — which is a **feature idea**, not just a complaint (see C41).

**Visual evidence — he tests the affordance on camera repeatedly:**
- `t00237.114_postdrag`, `t00317.587_postdrag`, `t00318.605_preclick` — the pill's text drag-selects as ordinary text (solid blue OS selection over the words). No hover elevation, no pointer cursor state.
- `t00341.372_preclick` — hovering produces only a **native Chrome title tooltip** reading "Collection summary", i.e. the same label repeated.
- `t00531.967_framechange` — all three chips selected as text at once.

**Code root cause** (`R4 §A.3`): the chip is a static `<li>`, not a `<button>` — no `onClick`, no `role`, no `tabIndex`, no `cursor-pointer`:
```tsx
<li className={[
  'rounded-full px-[10px] py-[3px] text-[12px] leading-[18px]',
  'border border-border-subtle bg-surface-secondary',
  t.phase === 'error' ? 'text-text-muted line-through' : 'text-text-muted',
].join(' ')} title={t.summary ?? undefined}>
  {t.phase === 'start' ? `${t.title}…` : t.title}
</li>
```
`rounded-full … border … bg-surface-secondary` is exactly the app's badge/tag language, and the `title` attribute is what produces the observed OS tooltip. Nothing anywhere applies `user-select: none`, which is why every one of his drag-selects works.

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C16 — Preference: highlightable, but not a pill by default

> *"[05:45] I think I prefer just this kind of treatment, where it's, like, it's highlightable, but it isn't a pill by default,"*

**What he means:** the resting state of a tool step should be plain/inline text; "being the thing under discussion" should be expressed by a highlight treatment rather than by permanent pill chrome.

**Visual evidence:** he says this while looking at beautifului.dev's **Tool Chips** row treatment (`t00297.137_preclick`, `t01421.106_framechange`) — flat rows of icon + bold verb-phrase + a monospace detail, with no per-row pill.

**Code root cause / prior art** (`R4 §D.6`): DeckPal already owns the exact primitive this describes. `apps/web/src/components/ui/elementHighlight.ts` + `HighlightRing.tsx` draw a **chasing multi-hue animated border** (cyan → pink → amber, the product's own three brand scales) as an absolutely-positioned overlay sibling — never a class on the target — deliberately unlike every static UI state (focus, selection, error, hover are all static borders in this system) so it reads as *"something agentic is happening here."* It is a singleton app-wide. `HighlightRing.tsx`'s own header says it is *"a design-system primitive first, Deck-E feature second — Deck-E is its first caller and will not be its last."* Deck-E's `flyTo`/`highlight` tools already call the imperative form (`uiTools.ts:203-239`).

**Corroborating external evidence** (R8 §3, the OpenClaw case study, `https://github.com/openclaw/openclaw/pull/99763`): chrome (card/border/shadow) should be reserved for content that is genuinely a *different rendering surface*; status rows should be flat single lines with a thin left rule for grouping. Errors are the deliberate exception — loud and auto-expanded.

**Severity:** major (it is the design direction for C10/C14/C15). **Confidence:** high. **Conflicts:** no.

---

## C17 — Show when he is searching the web

> *"[05:55] and then, yeah, we need to show when he's searching the web,"*

**What he means:** web search must be a visible, distinguishable state.

**Visual evidence:** `t00359.826_preclick` — beautifului.dev's Thinking component in its `"+ Searched the web ⌄"` state with the **Search** sub-tab active. This is the frame that matches his sentence most literally.

**Code root cause** (`R2 §6`): **no `web_search` tool of any kind is declared anywhere in `apps/api/src/decke/`** (grep-confirmed: zero hits for `web_search`/`webSearch`). The only live-web capability is the `research_meta` deep tool (`deep.ts:351-403`), which delegates entirely to `openai/o3-deep-research` (`models.ts:299`) — a model that does its **own provider-side browsing**, over which the application has **zero visibility or control**. It holds no tools itself (`maxSteps: 1`, no `tools` key, `deep.ts:388-391`), deliberately. It is announced to the user as exactly one opaque chip — `{name:'research_meta', title:'Research the current meta'}` (`deep.ts:352-353`) — `start`, then, after up to 210 s, `ok`/`error` with a 110-char summary (`deep.ts:275`). **There is no sub-event for "searching for X", no progressive source list, and no citation surfacing until the whole call returns.** The sub-agent's instructions do demand *"CITE YOUR SOURCES with URLs"* (`deep.ts:377-378`), but only inside the final text.

Additionally, `gatewayTools.exaSearch` — which would expose `include_domains`/`allowed_domains` — **is not exported at runtime** by the pinned `@ai-sdk/gateway@4.0.52` despite being in the `.d.ts` (`models.ts:280-289`); this was found during PR #74 and recorded.

**Severity:** major, and **larger than it looks** — this is not a rendering change, it needs either a way to consume intermediate events from `o3-deep-research` (currently `runSubAgent` reads only `result.textStream` and discards every other stream part, `deep.ts:172-174`) or a provider change to a first-party server-side search tool.
**Confidence:** very high. **Conflicts:** touches spec §14 open question 1 (whether non-allowlisted search vendors may receive query text) — see Part 9.

---

## C18 — The chips get dumped all at once and do not feel like a process

> *"[06:38] these kind of come up, and they just, they don't feel like an actual process. [06:42] They just kind of get dumped all at once, which is a problem,"*

**What he means:** three tool names appear simultaneously before anything has happened; that is not a progress display.

**Visual evidence:**
- `t00393.376_framechange` (t=6:33) — his second question is sent; send button is the stop square; **no chips yet.**
- `t00396.242_framechange` (t=6:36) — **all three chips appear at once**: "Analyse the collection…", "Browse decks…", "Collection summary", with no assistant text.
- `t00529.107_preclick` (t=8:49) — same three, still no answer.

**Code root cause** (`R2 §3`, `§4`): the chip mechanism itself is faithful. `emitToolEvent` (`api/chat.mjs:387-394`) writes `{type:'data-decke-tool', data:{phase,id,name,title,summary?}, transient:true}` from the adapter's own execute wrapper (`adapters/aisdk.ts:338-366`), which the file's comment (`aisdk.ts:51-64`) says is deliberate: *"EMITTED FROM HERE, not from the model. A chip the model could ask for would be a second surface to fabricate on… Every chip corresponds 1:1 to a real invocation of a real handler, by construction."*

The dump is **upstream**: parallel tool use is on by default in the AI SDK, so multiple tools called in the *same model step* all fire `phase:'start'` within the same instant. `wire.test.ts:188-212` pins exactly this — one mocked step emitting `goTo` then `express`, both landing in the same read window. Nothing in the transport or the renderer staggers them.

**Severity:** major. **Confidence:** very high. **Conflicts:** no (but see Part 6 §6.10 — the chip's 1:1-with-real-work property is a documented anti-fabrication control and must survive any restyling).

---

## C19 — It hangs, and he starts doubting it is working

> *"[06:50] and then it kind of just hangs. The first time I did this, it took a while, and I wasn't super confident that he was actually doing anything. [07:00] He was. He came back with a great response, but it sat in this state for long enough that I was kind of starting to have my doubts, which makes for a poor user experience."*
> *"[09:48] See, now, even though he did work for me last time, I'm, like, it's gone long enough that I'm now starting to doubt that it's actually working. [10:00] And if it's like that for me, it's definitely going to be [for others]."*
> *"[10:52] And I think, overall, it just takes a little bit too long."*

**What he means:** the wait is long *and* unexplained, and he is explicitly generalising from himself to users.

**Visual evidence — this is the measured 61-second freeze; see also Part 3, D1:** the run from `t00529.107_preclick` (taskbar clock 12:27 PM) to `t00590.157_preclick` (12:28 PM) shows **zero app output in the chat panel across 61.05 s** (measured from the still timestamps). `[AUDIT]` — rev 1 called two of these frames "pixel-identical" on the scribe's word; re-measured, they are not (panel PSNR 51.9 dB, whole-frame 26.0 dB, because the character is idle-rocking throughout), and the visible panel differences across the span are all the owner's own drag-selection and focus changes. **The substance holds and is if anything worse — see D1 for the corrected statement.** The answer finally lands at `t00608.441_framechange` and generation completes at `t00615.637_preclick` (send button back to the teal chevron), i.e. **~86 s from prompt to finished answer.**

**Code root cause — the single biggest buffering point in the system** (`R2 §3`): `runSubAgent` (`deep.ts:109-190`) does
```ts
for await (const delta of result.textStream) { text += delta; }
```
(`deep.ts:172-174`) — **every delta the sub-agent produces is accumulated into a local string and never forwarded to the parent stream.** For the entire duration of a deep-tool call the reader gets exactly two signals: one `data-decke-tool` `phase:'start'` chip the instant `execute` begins (`deep.ts:261`, `adapters/aisdk.ts:340`), and then **nothing at all** until the sub-agent finishes or hits `DECKE_DEEP_BUDGET_MS` (default **210,000 ms** — 3.5 minutes; `deep.ts:79-82`, `DEPLOYMENT.md:202`). A tool whose own model is streaming has that stream thrown away and re-serialised as one blob at the end.

**Contributing latency, stage by stage** (`R2 §3`):

| Stage | Cost | Cite |
|---|---|---|
| Meter (`chargeSql`) — one blocking DB round trip before the model is called | **~90 ms**, unavoidable, sequential | `meter.ts:24-30`, `api/chat.mjs:156,175-252` |
| Chat model TTFT | **~1148 ms median** | `models.ts:129-131` |
| Each subsequent step (up to 12) | a full model call, re-billing the whole prompt + history + 40 landmarks + 34 tool defs | `api/chat.mjs:493-534`, `stepCountIs(12)` |
| A deep-tool call | 20 s measured example → 210 s ceiling, **fully buffered** | `models.ts:236`, `deep.ts:79-82` |
| Per-leg landmark cost | ~600 tokens/leg, up to ~3600 across a 6-leg worst case | `useDeckeChat.ts:743-767` |
| Function hard ceiling | `maxDuration: 300` | `vercel.json:39-42` |

**One unverified degrade point:** `res.flush?.()` at `api/chat.mjs:784` is a no-op unless something attaches a `.flush` to the Node response; on stock Vercel Node functions it is almost certainly `undefined`. **Not confirmed to cause a problem** — flagged because it is the one silent-degrade point in the pump loop (R2 §3, §9 item 7).

**Severity:** blocker. **Confidence in root cause:** very high for the buffering; medium for how much of *this specific* 86 s was the deep tool vs. the 12-step loop (not instrumented).
**Conflicts:** yes, indirectly — see Part 6 §6.4 (the chat model was deliberately swapped to a slower, 7.5× costlier one on 2026-08-22).

---

## C20 — He wants interstitial narration between tool calls, like Claude

> *"[07:22] If he had just a little bit more, like, I know when I use Claude, it will kind of update me on what it's doing. [07:29] Like, it'll show the tool calls and da-da-da, and then it's like, okay, I've looked at your collection. [07:35] Now let me do some research, you know, and he kind of, like, weighs in between tool calls, you know,"*

**What he means:** short spoken beats *between* tool calls, in his own voice, that say where he is in the work.

**Visual evidence:** `t01467.795_preclick` (Claude iOS, in a real `deckpal` project session) is the reference he means — an alternating structure of bold prose statements and collapsible action rows: *"Now rewiring `chat.mjs` to use it:"* → *"Ran 3 commands ›"* → *"Now the tests that the transform never had:"* → *"⚠ Ran 9 commands ›"* → *"Gate 9 (line 1566) is the signed-write proof. While the web extraction finishes, let me confirm the gate harness is ready to run:"* → *"Ran 5 commands, used 2 tools ›"*.

**Code root cause** (`R2 §5`): **there is no interstitial-narration system anywhere in this codebase.** `decke/narration.ts` is a **leak filter**, not a narration system: its entire job (header, `narration.ts:1-69`) is to strip cases where the model writes its own tool-call syntax as visible prose. It operates as a `TransformStream` over `text-delta` parts only (`narration.ts:259-311`), has **no concept of a tool-call boundary**, never emits user-facing text of its own except a rare synthetic tail flush (`narration.ts:244-257`, a bug-avoidance mechanism), and its product is simply "the same delta stream with fewer bytes."

Worse, the prompt currently pushes the **opposite** way: the `express` tool's `done` message explicitly tells the model **not** to describe its own actions in words (`tools.ts:307-309`; same for `showScreen` at `tools.ts:425-427`), and the prompt's restraint rule holds that *"silence is a valid emission"* (`models.ts:113-120`).

**What the wire could already carry** (R2 §5): `prepareStep` (already used by `focus.ts:94-101`) fires between steps and is a natural hook, but nothing writes to `writer` from inside it today. For the deep-tool case specifically — the one that actually needs it — `deep.ts:172-174`'s loop would need to forward *something*.

**Severity:** major. **Confidence:** very high. **Conflicts:** yes — see Part 6 §6.6 (the prompt's anti-narration clauses are deliberate anti-fabrication controls).

---

## C21 — Break up the thinking animation with brief expression changes

> *"[07:43] and just to kind of, like, break up this animation, too, I think would be good, [07:51] because he's just kind of stuck in this one thing, and so if, you know, when he does little responses in between, [07:58] he can kind of show, like, a different emotion for a sec and then go back to thinking. [08:03] I think that would be a good thing, just to kind of make him feel less like he's just stuck and not doing anything."*

**What he means:** tie C20's narration beats to a momentary expression change, then return to thinking — so the character's body language also says "something changed."

**Visual evidence:** `t00415.929`, `t00427.609`, `t00437.694`, `t00444.303`, `t00542.791`, `t00568.138` — six frames across ~2.5 minutes showing only lightning-bolt/eye micro-variation. His own words at [09:38]: *"he's still just thinking, still just playing the same, rocking back and forth."*

**Code root cause / what exists:** the machinery is present and drivable. `express` (`tools.ts:256-314`) writes up to 6 validated commands (`op: state | cardArt | facing | idle | clearHighlight`) as a transient `data-decke` part; states **sustain indefinitely once set** (`sustain.ts`) by deliberate design — *"he should never snap to being done — he should stay in the state until told to leave it."* The gap is that nothing *orchestrates* a state change at a tool boundary, because there is no tool-boundary narration hook (C20).

**Severity:** minor-to-major (rides entirely on C20). **Confidence:** high. **Conflicts:** no.

---

## C22 — He wants to know, as the developer, which model is running and why it is slow

> *"[08:24] And I would be actually interested to know what model he's using. [08:29] I don't know that we should expose that in the UI, per se, but just as the developer of this, I would be interested to know what model he's using and, like, why it's taking so long."*

**What he means:** developer-side observability. He explicitly rules out a user-facing model badge — and reinforces that at [24:18] when rejecting Claude's model picker.

**Visual evidence:** `t00364.318_preclick` / `t01224.063_framechange` incidentally show what he is comparing against — claude.ai's own visible **"Opus 5 · High"** selector.

**Code root cause — the answer to his question** (`R2 §2`, `models.ts:55-303`):

| Job | Model | Fallback | Effort | Budget | Where |
|---|---|---|---|---|---|
| `chat` | `spacexai/grok-4.20-non-reasoning` (`models.ts:138`) | `google/gemini-2.5-flash` (`:179`) | none | 1200 | **The only model for all ordinary conversation, all navigation, and every turn's driving loop** — `api/chat.mjs:396,449` |
| `write` | `openai/gpt-5-mini` (`:193`) | `anthropic/claude-haiku-4.5` | low | 1500→3750 | **Not actually wired into `api/chat.mjs`'s single `streamText` call** — dead configuration for the conversational path |
| `vision` | `spacexai/grok-4.1-fast-non-reasoning` (`:223`) | `amazon/nova-lite` | none | 400 | card scan, not chat |
| `analysis` | `anthropic/claude-sonnet-5` (`:261`) | `openai/gpt-5.1-thinking` | high | 3000→7500 | `plan_deck`, `analyze_collection`, `write_strategy_guide` (`deep.ts:307,335,422`); `$0.50–$1` per `plan_deck` call (`models.ts:255-258`) |
| `research` | `openai/o3-deep-research` (`:299`) | `openai/gpt-5.1-thinking` | none | 2500 | `research_meta` (`deep.ts:369-402`) — the only live-web path |

**Why it is slow — three named reasons:** (a) the 2026-08-22 chat-model swap costs **1148 ms median TTFT vs the prior model's 811 ms** and 7.49× per turn ($0.01153 vs $0.00154) (`models.ts:129-131`, `:159-167`); (b) up to 12 sequential re-billed steps; (c) the deep-tool buffer (C19).

**Also worth telling him:** `effort` is a **misnomer**. It only widens `maxOutputTokens` by ×2.5 via `RESERVE` (`models.ts:305-317`). **No code anywhere sends a provider-specific reasoning-effort parameter** — no `reasoningEffort`, no `thinking.budgetTokens` (`deep.ts:146-165`). The `analysis` tier's `effort: 'high'` does not ask Sonnet 5 to think harder. This was consciously not built and recorded as such (spec §14, "not built" list).

**Severity:** minor as a product change, **but high value** — this brief answers most of the question directly. What remains is whether he wants a permanent observability surface.
**Confidence:** very high. **Conflicts:** no. **Open question:** Part 9, Q4.

---

## C23 — The chips look like a declaration of intent, not a report of current state

> *"[08:49] Because, yeah, it seems like he's just showing his tool calls right up front, like, the things he's going to use, maybe, rather than, like, what he's actually using right now. [08:59] And that's why it feels like it's just such a long process."*

**What he means:** he has correctly reverse-engineered the behaviour from the outside. He is asking for a *current-step* display, not a batch manifest.

**Visual evidence:** the same 396→608 s span as C18, plus the reordering below.

**Code root cause — and a finding the research did not make** (verified directly for this brief): the chips do not merely appear together, **they also reorder themselves as tools complete**, which is why they read as an unstable manifest rather than a sequence. The observed orders:
- `t00396.242_framechange` — Analyse / Browse / Collection
- `t00410.768_preclick` — Analyse / Collection / Browse
- `t00615.637_preclick` — **Collection summary / Browse decks / Analyse the collection** (verified by direct crop for this brief)

The mechanism is the upsert in `useDeckeChat.ts:263-279` (`[AUDIT]`: the handler closes at `:279`, not `:278`; the load-bearing line is **`:274`**), **re-verified against the file for this audit and confirmed exactly as described**:
```ts
onToolChip: (chip) => {
  setMessages((m) => m.map((x) => x.id === replyId
    ? { ...x, tools: [...(x.tools ?? []).filter((c) => c.id !== chip.id), chip] }
    : x))
}
```
`filter` removes the chip's old entry and the spread **appends the new one at the end**. So every `ok`/`error` update moves that chip to the back of the list. The final order is therefore *reverse* completion order relative to the others — it encodes nothing the reader can use, and it visibly reshuffles mid-wait. Note also that `Analyse the collection` finished **last** in the t=615 frame, and it is the tool that timed out (see Part 3, D2).

**Severity:** major. **Confidence in root cause:** high (the code is unambiguous; the frame ordering matches).
**Conflicts:** no.

---

## C24 — On the thinking animation he should look up and away, not at the camera

> *"[09:08] By the way, on his thinking animation, he shouldn't be looking at the camera. [09:27] He should be looking up and, like, upward and away from the camera, actually, on his thinking animation. [09:33] So that's a small thing to fix."*

**What he means:** exactly what it says. He himself scopes it as small.

**Visual evidence — `[AUDIT]`: re-cropped closely for this audit, and rev 1's description of the eyes is WRONG. The complaint is unaffected; the evidence sentence has to change.**

Rev 1 said *"both pupils centred, gazing at the camera."* Cropping `t00529.107_preclick` at `560x420+880+1090` and `t00542.791_framechange` at `250x200+940+1090` shows something different, and identical in both frames:
- The head yaw is real — ~30°, front plane pointing left of camera, right-side plane and top visible.
- **The pupils are not centred.** The **left** iris is jammed against the **right rim** of its sclera and clipped by it, with a wide white crescent on the left, sitting **high** in the socket. The **right** iris is offset right and **low**, with the tinted upper lid above it.
- **The two eyes do not agree vertically** — left high, right low.

What the horizontal offset is *doing* is partly counter-rotating the head yaw, i.e. the eyes are aimed back toward the viewer while the body is turned away. **So the accurate sentence is "his eyes counter-rotate toward the viewer," not "his pupils are centred."** The vertical component actually reads as slightly up-and-past — which is consistent with the code (a `gz` offset ≈ 6.8° above camera) and is precisely why his complaint is *"a slight upward tilt is not up and away."*

**Use the corrected wording.** Rev 1's version invites a fix aimed at the wrong thing: an implementer told "the pupils are centred" will reach for `aimPupil`, when the actual finding is that the *gaze target* is camera-anchored (`look.ts:165-178`) and the pupils are doing exactly what that target tells them.

See also **D14**, which registers the rim-clipping as a separate possible defect.

**Code root cause** (`R1 §5.2`) — and it is **not** small:
- **The gaze target is always anchored to the live camera position**, plus a per-pose offset. `gazeTarget(camera, gx, gy, gz, out)` (`look.ts:165-178`) does `camera.getWorldPosition(out); out.x += gx; out.y += gy; out.z += gz`. Every state, thinking included, is fundamentally "look at the camera, offset by this much." The module header (`look.ts:1-51`) explains this is a rebuild of a Blender "Copy Location with offset" constraint that did not survive glTF export, and notes that a per-state gaze that is *not* camera-relative is **not something this module currently expresses**.
- `aimPupil` (`look.ts:125-151`) clamps to `PUPIL_ROAM = {x: 0.115, z: 0.225}` (`look.ts:67`) with `GAZE_GAIN = 0.2563` (`look.ts:60`).
- The `thinking` state's authored offset is small relative to camera distance: `gx: -1.7, gz: 1.05` for nearly its whole 2480 ms duration, with the last beats at 2160/2320/2480 ms tapering *back toward* dead-on-camera. At the staging camera distance (≈8.87 blender units, `constants.ts:41`), `gz = 1.05` is `atan(1.05/8.87) ≈ 6.8°` above the camera. **A slight upward tilt, not "up and away."** This matches his complaint precisely.
- `resolveFacing` negates `gx` for the current facing (`rig.ts:624-638`, `pose.gx *= facing` at :637) and must run *after* procedural gaze layers compose (`DeckE.ts:2115-2126`) — already correctly ordered, and not implicated.

**Landmine** (`R1 §9.3`): `playbook.json` (186.8 KB, `apps/web/public/models/decke/playbook.json`) is **generated, and the generator has been broken since 2026-08-16** (`scripts/decke/gen-playbook.py`, per `playbook.ts:6-9` / `README.md:6-9`; the committed `_raw/playbook.json` is *"stale by four states and must not be used"*). Any change to `thinking`'s gaze beats must be **hand-edited into the committed JSON**, risking drift from the character wiki's normative Python until the generator is fixed.

**Second landmine** (`R1 §9.2`): `look.test.ts:45-56` pins `aimPupil`/`gazeTarget` against the glb's baked bind pose at the staging camera. Editing `thinking`'s `gx`/`gz` in `playbook.json` does not touch it, but changing `GAZE_GAIN` or `PUPIL_ROAM` would need re-validation. Separately, `PARITY.md` is **already known-stale on gaze** (its own header, lines 1-5) and is a record, not a blocking gate.

**Corroborating external evidence** (R8 §6): gaze aversion under cognitive load is a real, replicated finding (Doherty-Sneddon et al., `https://pmc.ncbi.nlm.nih.gov/articles/PMC3627297/`), and sustained mutual gaze from a robot measurably slows human response (`https://www.science.org/doi/10.1126/scirobotics.abc5044`). But the *direction* is **not** settled — the "look up = visual recall" claim traces to NLP eye-accessing cues, substantially discredited (Wiseman 2012). **Justify "away" on cognitive-load grounds; justify "up" on animation convention and legibility, not neuroscience.** Also relevant: a 2025 study found behavioural fillers (gaze-aversion thinking animation) beat symbolic fillers (progress bars) on naturalness/presence/engagement, 66.7% vs ≤12.5% in forced preference (`https://arxiv.org/html/2508.11781v1`).

**Severity:** minor by his own framing; **medium effort** in reality.
**Confidence:** very high. **Conflicts:** no.

---

## C25 — The browser "hiccup" / apparent back-navigation

> *"[10:11] I honestly would have loved him to, heck, my browser just, like, hiccuped and booted me out. [10:25] What happened? [10:30] Okay, that was weird. [10:35] It was like it went and did a back navigation. [10:39] Is that something Decky would do? I don't know. That was very odd."*

**What he means:** the DeckPal tab spontaneously left the page during/just after a long response, and he is asking whether Deck-E caused it.

**Visual evidence — the frame sequence, which is the crux of the source disagreement:**
- `t00615.637_preclick` (t=10:15) — the still is tagged **"other click"**, i.e. *not a plain left click*, at screen (1038,1380). The scribe reads this as a mouse back/forward side-button press.
- `t00617.349_framechange` (t=10:17) — the DeckPal tab's content is now **Chrome's own New Tab page** (Google logo, shortcut tiles, and a "Continue with these tabs" card listing "DeckPal — Connect Claude to your Pokémon TCG collection", `deckpal.app`, *"Cheys-MacBook-Pro • You visit often"*).
- `t00627.588_preclick` (t=10:27) — the address bar of that tab reads **`127.0.0.1:5210/auth`** with a blank body.
- `t00631.039_preclick` (t=10:31) — a **claude.ai** tab takes focus.
- `t00635.923_preclick` (t=10:35) — `deckpal.app/series` is back, loaded fresh.

### Sources disagree here. Both are partly right. Here is the honest reading.

**R2 §7 says:** the only navigation call in the whole Deck-E path is
```ts
// DeckeHost.tsx:143-144
const navigate = useNavigate()
const chat = useDeckeChat(live, (to) => navigate({ to }), () => setTravelling(true))
```
invoked from `goTo`'s handler (`uiTools.ts:261-277`, `ctx.navigate(route)` at :274) **with no `replace: true`**. TanStack Router's default `navigate()` **pushes**. So every page Deck-E visits becomes its own history entry, and a multi-leg journey can push several in quick succession. A back press then walks back through *pages Deck-E visited*. R2 also confirms by repo-wide grep that **no `history.back()`, `pushState`, `replaceState` or `popstate` handling exists anywhere in `apps/web/src`**, and that `stop()` cannot un-navigate an already-committed `goTo` (`useDeckeChat.ts:404` checks `ac.signal.aborted` only *after* each `runUiTool` returns).

**The range3 scribe says:** the history chain this tab walked backwards through was `New Tab → 127.0.0.1:5210/auth → deckpal.app` — and **Deck-E could not have pushed either of the first two.** `127.0.0.1:5210/auth` is a local dev-server auth-callback origin, and `chrome://new-tab-page` is browser chrome. Neither is reachable from `uiTools.ts`'s `routeAllowed` allowlist, which is a prefix list of `/series, /lists, /decks, /pokedex, /insights, /scan, /search` on the same origin (`tools.ts:40-66`, mirrored `uiTools.ts:41-57`).

**My reading, stated plainly:**
1. **Deck-E did not cause this specific incident.** The scribe's evidence is decisive: the entries walked back through are origins Deck-E has no ability to push. Combined with the "other click" tag on the immediately preceding frame, the most parsimonious explanation is a **mouse side-button Back press** on a tab whose history predated the deckpal.app load — an ordinary browser interaction, not an app defect. I hold this with **high confidence**.
2. **R2's finding is nonetheless real and separately actionable.** The push-navigation gap is genuinely there in the code, it genuinely makes Back walk through Deck-E's itinerary rather than back to where the user was, and it will produce exactly this class of confusion once C34's escorted multi-hop journeys exist and push *several* entries per turn. It just is not the explanation for *this* incident.
3. **The two claims are not in conflict** once separated: R2 answers "could Deck-E do something like this?" (yes, and it will get worse), the scribe answers "did Deck-E do *this*?" (no).

**Consequence he did notice and did not name:** the reload wiped the conversation. See Part 3, D5.

**Severity:** the incident itself, **context / not a defect**. The underlying push-navigation gap, **major** once C34 lands.
**Confidence:** high for both halves. **Conflicts:** no.
**Implied fix (for the underlying gap only):** `replace: true` or explicit history marking at `DeckeHost.tsx:144` / `uiTools.ts:274`.

---

## C26 — He faces the wrong direction, on both desktop and mobile

> *"[11:03] Oh, yeah, big issue is he's facing the wrong direction on both desktop and mobile. [11:09] He should be, like, looking inward toward the chat box."*
> *"[11:20] In mobile size, he's in the right spot, but he's facing the wrong direction."*

**What he means:** exactly that. He explicitly separates the mobile problem (facing only) from the desktop problem (facing *and* placement).

**Visual evidence:** `t00529.107_preclick` — body/head turned ~30° so his front-right face and **both eyes point toward the lower-right of the frame, toward the viewer**, not toward the chat panel to his right. `t00656.530_preclick` — the same forward-facing stance in a fresh empty chat, called out by the scribe as the illustration of this complaint. `t01245.678_framechange` (mobile) — eyes toward the viewer/slightly right, not toward the text.

**Code root cause — a single, well-isolated defect** (`R1 §5.1`):
- `facing` is a scalar in `[-1, +1]` animated over `FACING_TURN_MS ≈ 495.3 ms` (`DeckE.ts:121`), applied as `rig.facing.rotation.y = ((1 - facing)/2) * FACING_YAW_DEG * DEG` with `FACING_YAW_DEG = 80.39` (`DeckE.ts:109`, `:1986`).
- Sign convention, stated at `dom.ts:203-219`: `facing` is in **his** frame; `+1` turns him to *his* right, which reads on screen as turning **screen-left**. Independently confirmed at `useDeckeChat.ts:848` (`decke.setFacing(c.value === 'left' ? 1 : -1)`).
- **Default facing is `+1`** — `private facing = 1` at `DeckE.ts:454`, and `private facingTarget = 1` at **`DeckE.ts:455`** — i.e. screen-left by default.
- Nothing ever changes it for the chat, because **both** chat-open `flyTo` calls pass `centre: true` (`DeckeHost.tsx:243` and `:250`), and `solvePark(..., {centre:true})` returns `{position}` with **no `facing` field**, by explicit design (`dom.ts:279-293`). The comment at `dom.ts:276-277` says: *"`facing` is absent for a centre park, deliberately: a point has no inward, so the caller's facing is left alone rather than being invented here."* `flyTo` then does `this.setFacing(park.facing ?? this.facingTarget)` (`DeckE.ts:1158`), under its own comment at `:1156-1157`: *"A centre park returns no facing — a point has no inward — so his current heading is re-asserted rather than replaced."*

  **`[AUDIT]` — precision correction, and it changes what the bug *is*.** Rev 1 said the `??` fallback means *"the boot default `+1` is simply re-asserted."* It re-asserts **`facingTarget`, i.e. whatever his current heading already is** — which is `+1` only because nothing in the chat path has ever set it to anything else. The defect is therefore **"facing is never decided for the chat,"** not **"facing is forced to `+1`."** Two practical consequences: (a) a fix that merely changes the initialiser at `DeckE.ts:455` would be wrong, and would break every non-chat caller; (b) the behaviour is **path-dependent** — if a `parkBeside` earlier in the session had left him at `-1`, opening the chat would preserve `-1` and he would happen to look the right way. That is worth knowing before anyone tries to reproduce this and finds it intermittent.
- **Desktop:** he stands at `x = 0.36` (left of centre) with the panel at bottom-right. To look at it he needs `facing = -1`. He is at `+1`. **Facing away.**
- **Mobile:** he stands at the park landmark, `left: 10px` inside the full-screen panel, i.e. left of the transcript column. Again needs `-1`, again is `+1`. **Facing away** — while his *position* is correct, exactly as he says.
- The **one** code path that already computes a correct inward yaw is `parkBeside` (`dom.ts:146-221`), used by non-centre `flyTo` — `facing = side === 'right' ? 1 : -1` at `dom.ts:219`, chosen from which half of the screen the target rect's centre falls in (`dom.ts:175-189`), with an edge exception that flips sides rather than let him go off-screen (`:181-189`).

**Hard landmine** (`R1 §9.1`): `apps/web/src/character/decke/__tests__/park.test.ts:119` asserts
`assert.equal(on.facing, undefined, 'a centre park must leave facing to the caller')`.
**Do not fix this by making `solvePark`/`parkOn` return a facing for centre parks.** That invariant was itself the fix for an earlier bug where `flyTo` and the re-solve path disagreed (`dom.ts:274`: *"One function, both callers, so the two can no longer drift apart"*). The fix must live at the two call sites in `DeckeHost.tsx:243-253` — either a new `facing?: number` on `FlyOptions` honoured even when `centre: true` (`FlyOptions` has **no** independent facing field today, `DeckE.ts:1101`), or an explicit `decke.setFacing(...)` alongside the `flyTo` calls.

**Severity:** major (he calls it a "big issue"). **Confidence:** very high. **Conflicts:** no, provided the test invariant is respected — see Part 6 §6.7.

---

## C27 — On desktop he is in a totally wrong spot, far from the chat

> *"[11:12] And then in here, he's in a totally wrong spot. [11:27] In desktop, he's so far away. [11:31] And, I mean, we already talked about changing the whole layout, so he doesn't need to be here exactly, but he does need to be, like, to the left of the chat box."*

Same underlying cause as C9; recorded separately because he raises it again while resizing the window to demonstrate it, and because he explicitly ties it to C5's layout change.

**Visual evidence:** `t00720.597_postdrag` — the geometry measurement: ~365 px gap in a ~995 px viewport. `t00688.959_postdrag` and `t00726.366_postdrag` show him toggling the window between desktop and narrow widths repeatedly to demonstrate it on camera.

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C28 — Responsive-width demonstration (context for two unreported defects)

He resizes the Chrome window from full desktop width down to ~275–480 px and back, several times, from t=11:15 to t=12:39. He does not narrate a specific complaint during this stretch — but it is what produces two of the Part 3 defects (D6: viewport clipping; D7: PWA Install-button collision).

**Visual evidence:** `t00676.334`, `t00678.372`, `t00681.279`, `t00686.986`, `t00688.959`, `t00703.149`, `t00705.308`, `t00707.696`, `t00711.816`, `t00715.902`, `t00718.901`, `t00720.597`, `t00726.366`, `t00753.767`, `t00757.977`, `t00758.935`, `t00759.184`.

**Severity:** context. **Conflicts:** no.

---

## C29 — Keep the top chrome unblurred on mobile too, and move the panel down below it

> *"[11:51] I think that my feedback I gave earlier in regard to not blurring out this bar on desktop, I think we should also apply to mobile. [12:07] Like, let's keep the top bar unblurred and move this down. [12:16] Yeah, I don't know. [12:17] I think it will feel just better to have the Chrome there."*

Restated on the phone:
> *"[21:28] And moreover, like, let's have the top Chrome of our app not be blurred. [21:37] I did say that earlier, but have Deck E down here."*

**What he means:** on mobile the DeckPal header should stay sharp and present, and the chat surface should begin *below* it.

**Visual evidence:** `t01245.678_framechange` — **verified directly for this brief.** Faint blurred circular completion-gauge shapes are visible at the very top-right of the frame, in the same band as the iOS status bar: the header is not sitting on a solid unblurred surface. Full frame also shows blurred dial/gauge widgets behind the whole sheet.

**Code root cause** (`R5 §1 Defect 5`, `§3`): the current mobile behaviour is **deliberate and documented**, and is the exact inverse of desktop. `DeckeChat.tsx:34-40`:
> *"scrim  z-15 desktop / z-24 phone — desktop chrome stays sharp above it, a phone's chrome is part of what recedes"*

and `DeckeChat.tsx:402-407`:
> *"On mobile the chrome is part of what should recede, so the scrim covers everything and the panel is full-screen."*

Mechanically: `--z-chrome: 20` (`theme.css:287`); `AppShell`'s `<Header>` is `fixed left-0 right-0 top-0` at `z-(--z-chrome)` (`AppShell.tsx:428`); the mobile scrim is `z-[24]`, i.e. **above** it (`DeckeChat.tsx:416`).

**Non-obvious mechanism warning** (`R5 §1 Defect 5`): making the effect "start below the header" is **not** a pure z-index swap. The panel is `inset-0` and touches the viewport top. Raising the header's z-index only fixes the *darkening* (paint order); it does **not** fix the *blur*, because `backdrop-filter` samples whatever composites behind the element regardless of DOM order/z-index. To exclude the header from the blur, **the blur element must not extend under the header at all** — i.e. the scrim needs a top offset equal to the header's on-screen height (`calc(64px + env(safe-area-inset-top))` on mobile per `AppShell.tsx:359`, or `78px` desktop per `AppShell.tsx:539`). R8 §7 independently reaches the same conclusion via MDN's backdrop-root rules.

**Severity:** major. **Confidence:** very high.
**Conflicts:** **yes** — this directly reverses a documented decision. Part 6 §6.2.

---

## C30 — The mobile composer sits far too close to the bottom, and needs chrome

> *"[12:24] This on mobile is way too close to the bottom. [12:27] Like, it is crazy. [12:30] And I think it needs to have kind of some Chrome as well."*

Restated with the dead band and the Claude comparison:
> *"[21:58] But if you look down here, so right now I'm using this in web app mode, so we don't have the Safari Chrome. [22:08] But, like, there's this gap down here where it's just dark gray, and it looks really bad."*
> *"[23:14] It's, like, just a weird space where there's nothing, and then this is, like, super close to the bottom."*

**What he means:** two things at once — the input pill has almost no breathing room above the home indicator, *and* the region below/around it is an undefined dark void rather than a surface.

**Visual evidence:** `t01339.995_framechange` — the input pill's bottom edge sits at roughly 85% of the visible screen height; the phone's own bottom edge is a further **15–17% of screen height** below it, filled with a plain near-black band containing nothing, no home-indicator treatment. `t01245.823_postdrag` and `t01399.464_framechange` show the same.

**Code root cause** (`R5 §1 Defect 4`) — two independent causes:

1. **No `env(safe-area-inset-bottom)` anywhere in `DeckeChat.tsx`** (grep-confirmed, zero occurrences). The composer form is
```tsx
<form onSubmit={submit} className={[
  'decke-composer pointer-events-auto flex shrink-0 items-center gap-[8px] py-[10px] pr-[16px]',
  desktop ? 'border-t border-border-default' : '',
].join(' ')}>
```
(`DeckeChat.tsx:647-652`). `py-[10px]` is the *only* vertical breathing room. On an iPhone in standalone the home indicator inset is ≈34 px, so a 40 px pill (`h-[40px]`, `DeckeChat.tsx:660`) ends ~10 px above it. Every comparable element in the app **does** pad for this: `AppShell.tsx:371`, `Sheet.tsx:318` (`paddingBottom: calc(20px + env(safe-area-inset-bottom))`), `Sheet.tsx:326`, `authUi.tsx`, and `DevBackendRibbon.tsx:44` (`pb-[max(0.5rem,env(safe-area-inset-bottom))]` — the `max()` idiom already in use).

2. **The dead band is the scrim showing through.** The mobile panel is deliberately glass — `DeckeChat.tsx:28-32`, restated at `:420-432`: *"The phone panel has no background of its own… painting `surface-primary` over the top of that threw the blur away."* The composer `<form>` has **no background of its own**; only the `<input>` pill (`bg-surface-secondary`, rounded-full) and the message bubbles are opaque. So the `py-[10px]` padding, the `pr-[16px]` gutter, and the entire unpadded safe-area strip below are the user looking straight through to `bg-black/45 backdrop-blur-[3px]` over the page. **It is not a rendered element; it is a hole.**

**Not a `vh`/`dvh` bug** (`R5 §1 Defect 4`, `§2`): the mobile panel is sized by `fixed inset-0`, which resolves against the visual viewport's containing block and needs no unit choice — the more correct technique. (The *desktop* panel does use `100vh` at `DeckeChat.tsx:441`, inconsistent with the app's `dvh` convention but low-risk.)

**Related gaps in the same family** (`R5 §2`): `DeckeButton.tsx:74` (`fixed bottom-[20px] right-[20px]`) also has no bottom inset; `PwaUi.tsx:115,119` likewise. Lower severity, same class.

**Severity:** blocker for mobile. **Confidence:** very high.
**Conflicts:** **yes**, partially — the glass panel is a documented decision. Part 6 §6.3.

---

## C31 — The navigation he asked for did not happen the way it should have

> *"[12:34] Let me ask him to navigate for me. [12:36] So let me go back to desktop here and help me find pitch black."*
> *"[13:02] Okay, so he pulled up the page, but this is not great, the way that he did it."*

**Visual evidence:** `t00777.766_framechange` (t=12:57) is the key frame. Between one captured frame and the next, the address bar goes straight to **`deckpal.app/series/mega-evolution/me05`** with a *"Loading set…"* spinner; the **chat panel has completely vanished** (no header, no history, no input); Deck-E is large and alone over the spinner with a wide open grin; and a light-gray ghost pill reading **"help me find pitch black"** floats separately near the bottom-right edge, fading.

**Severity:** major (umbrella for C32–C37). **Conflicts:** yes — see C32.

---

## C32 — He should hop link to link, outlining and clicking, not teleport

> *"[13:11] He is supposed to, like, let me... [13:22] He's supposed to, let me show you. [13:24] So let's say I typed it in and I was on, you know, let's just go to a random page. [13:32] He's supposed to hop out of the chat and travel over to the link and, like, show it. [13:45] We have a whole system to do that, like, the outline around it. [13:50] And then he'll click that. [13:53] So he would click Pokemon TCG. [13:59] And then he would hop down to here and show this. [14:02] And he would click that. [14:04] And then he would hop over to here and show this. [14:08] And then he would click that. [14:10] And then he would say, like, here it is."*

**What he means:** a literal escorted journey. He then performs it by hand on camera to show what he means.

**Visual evidence — his manual demonstration:** `t00807.171_preclick` → `t00808.297_preclick` (opens the "Pokémon TCG (English)" sidebar dropdown, revealing the full 20-entry series list) → `t00836.990_preclick` (a Pokédex detour) → `t00842.511_preclick` / `t00842.749_framechange` (status bar shows the hover target `https://deckpal.app/series/mega-evolution`) → `t00848.605_preclick` (status bar shows `https://deckpal.app/series/mega-evolution/me05`, hovering the Pitch Black card) → `t00856.279_preclick` (the full Pitch Black set page, reached manually).

**Code root cause — three independent, compounding causes** (`R3 §5`), none of which is broken code:

**(a) The prompt explicitly instructs the opposite.** `prompt.ts:528-532`:
> *"**'Take me to it' means `goTo`, and it means the page for the thing itself.** A set is a page... When they ask to be taken to one, build its url and go — **do not stay where you are and `flyTo` something that looks related**, and do not stop at the index one level up."*

This wording is not incidental — it was **strengthened deliberately** to fix an earlier production failure where the model stopped at `/series` instead of drilling to the set (`prompt.ts:161-175`), and the spec's own gate 5 is literally *"'Take me to it' → Lands on `/series/mega-evolution/me05` — the canonical URL, slug included."*

**(b) `click` exists but the model is never told about it.** The tool ships (`tools.ts:385-396`, browser side `uiTools.ts:245-259`), but grep of `prompt.ts` confirms it is **absent from `## Moving around` and from every other section** — the only occurrence of the string "click" in `prompt.ts` is unrelated prose at `:518` (*"Nobody wants to watch you click through something you could have executed"* — which, note, actively argues *against* what he now wants). The per-turn landmark list the model receives carries **no clickability information at all** (`prompt.ts:598-599`).

**(c) Almost nothing in the app is marked pressable.** `resolveClickTarget` (`uiTools.ts:121-182`) requires **both** `[data-decke-landmark]` (pointable) and, on the closest ancestor, `[data-decke-clickable]` (pressable). `data-decke-landmark` now appears in **19 files / 37 declarations**. `data-decke-clickable` appears on **exactly two elements in the whole codebase**: `SeriesIndex.tsx:397-400` (the "Show N series with no cards collected" disclosure) and `CardDetail.tsx:596-600` (the "Additional Variants" disclosure). **Both are same-page accordions that navigate nowhere.** `AppShell.tsx:163-183` marks every nav `<Link>` as a landmark and none as clickable; `SeriesDetail.tsx:20-30` does the same for set rows.

**Therefore his choreography — click "Pokémon TCG", hop, show a set row, click it, hop to a card, click it — is not merely unprompted, it is architecturally impossible today.**

**Severity:** blocker (this is the single largest piece of new work in the brief).
**Confidence:** very high — all three causes are grep-verified.
**Conflicts:** **yes, directly.** Part 6 §6.1 and §6.5.

---

## C33 — The response was far too long for a navigation request

> *"[14:16] Right now, he... [14:20] This is a really, really long response for what I asked. [14:26] Like, really, I would have expected his response to just have been the, like, turn-by-turn navigation to the page from where they currently are."*
> *"[14:56] And then he gave, like, such a long response that it was, like, the ugliest-looking thing ever. [15:04] I'd rather it be shorter and, like, he says things as he goes."*

**Visual evidence:** `t00782.053_framechange` / `t00786.134_preclick` / `t00859.447_preclick` — the verbatim answer to *"help me find pitch black"*:

> *"You're on the \*\*Pitch Black\*\* page right now (me05, Mega Evolution series). It dropped July 17th this year. You're at \*\*58% complete\*\* (70/120 distinct cards). Here's what you're still missing for the basic "complete" goal, sorted cheapest first: \*\*Top cheap ones to grab:\*\* - Vikavolt (026) – $0.08 - Primeape (043) – $0.06 - Marshadow (040) – $0.09 - A bunch of the commons/uncommons under $0.20 The big hitters are the SIRs and that Mega Darkrai ex hyper rare at the end — those alone are hundreds. Want me to pull up the full missing list in a nicer view, sort by price, or help you build a TCGplayer cart for the ones you're after?"*

At `t00860.193` → `t00862.383_postdrag` he **drag-selects the entire block** to show its length on camera.

**Code root cause** (`R3 §5`): **nothing in `prompt.ts` bounds reply length for a non-moving turn.** The one length rule that exists (`prompt.ts:543-544` — *"When you move, keep what you say SHORT — one or two lines... your words appear in a small speech bubble"*) is conditioned on `travelling` / minimised chat. A turn that jumps directly (per C32(a)) and never enters the minimised bubble flow (`onTravel`/`travelAnnounced`, `useDeckeChat.ts:391-394`) gets **no brevity discipline applied at all**, and the model writes at length into the panel.

**Note:** R3 §7 item 6 flags that this may partially resolve itself once C32 routes more traffic through the already-short bubble path — **but it should be verified after, not assumed.**

**Severity:** major. **Confidence:** high. **Conflicts:** no.

---

## C34 — He needs to know where the user is in the nav, and the site map

> *"[14:35] So, like, he needs to know where they are in the nav. [14:39] He needs to know kind of the site map so that he knows which links to travel to and then show and then click."*

**What he means:** a nav graph — not URL syntax, but "from here, this link gets you one hop closer."

**Code root cause** (`R3 §2a`, `§4`, `§7`):
- **Route resolution has no registry.** `prompt.ts:192-225` (`ROUTE_SHAPES`) is the only "sitemap" the model gets: 13 URL-template lines rendered into the prompt as `## Where things live`. There is **no lookup table from a human name ("Pitch Black") to a route** — the model must already have called a data tool this turn, read `seriesSlug`/`setId` out of the result, and string-template the URL itself.
- `ROUTE_ALLOWLIST` (`tools.ts:40-66`) is a **security allowlist, not a sitemap** — 7 prefixes (`/series, /lists, /decks, /pokedex, /insights, /scan, /search`), deliberately excluding `/profile` (mints API tokens). It says what is *legal*, not what exists or how to reach it.
- **The sidebar's real structure is never exposed to the model.** `AppShell.tsx:90-97`'s `NAV` array is the actual nav (6 rows, one expandable into a live series sub-list) and **is not sent** anywhere.
- **Landmarks are current-page-only, capped, and silently truncated.** `collectLandmarks()` (`useDeckeChat.ts:800-826`) sends `[{selector,label}]` ranked on-screen-first → containers-before-items (`data-decke-rank="container"`) → DOM order, capped at `LANDMARK_CAP = 40` (`useDeckeChat.ts:768`, re-capped server-side at `api/chat.mjs:463`). **Surplus landmarks are dropped with no truncation marker to the model.**
- Per turn the model receives only: the current route (`The user is on \`${opts.route}\`.`, `prompt.ts:596`), `ROUTE_SHAPES`, the landmark list (or the literal string `(nothing on this page is registered as a landmark)`), the data tools held this turn, and today's date.

**What's missing, precisely:** nothing connects "this label" to "this is the element to press to get one hop closer to that route." The two half-resolvers (route templates; on-page landmarks) are **deliberately un-unified** and there is no bridge.

**Severity:** blocker (prerequisite for C32). **Confidence:** very high. **Conflicts:** touches the landmark-cap decision — Part 6 §6.8.

---

## C35 — The transition into "big" was not a smooth animation

> *"[14:50] And that needs to be, like, a smooth animation. [14:53] Right now, it wasn't. [14:54] It kind of just, like, became big."*

**Visual evidence:** `t00774.606_framechange` → `t00777.766_framechange` — between consecutive captured frames he goes from a held medium pose beside the docked panel to large, centred, over a loading spinner, with the panel gone. Also `t00924.821_framechange` (see D8) and `t00942.682_framechange`.

**Code root cause — UNCONFIRMED, and the research says so** (`R3 §5`): R3 reports it found **no code path that explains an abrupt, non-animated size jump distinct from ordinary foreground parking.** Its best hypothesis: a `goTo` with a resolved `selector` drives `travelAfterRoute` (`uiTools.ts:299-341`), which polls via `MutationObserver` (bounded at 6000 ms) for the selector to appear post-route-change and then **always** routes the resulting flight `via: 'background'` — *"there is no continuity to preserve by going straight"* after a full page swap. A background→foreground depth change is 24–27 world units, which `travelRate(distance)` (`flight.ts:95-98`) plays at ~2.95× — the fastest, most dramatic leg the system has. Combined with foreground parking framing him close and large by design, that could read as "he just became big."

**Second, separate contributor visible in the same frames:** the chat panel **disappears entirely** during the jump (`t00777.766_framechange`), replaced by a detached ghost pill of the query. That is the minimised/travel mode (`DeckeChat.tsx:378-397`, a floating pill `fixed inset-x-[12px] bottom-[12px] z-[25] … nav:right-[24px] nav:w-[420px]`) plus the speech bubble — so the "he became big and everything else went away" reading is partly a consequence of minimisation, not of scale.

**Severity:** minor-to-major. **Confidence in root cause: LOW — explicitly unconfirmed.** R3 §7 item 7 recommends re-testing this after C32 lands, since the flight profile changes completely if the destination is reached by same-depth hops.

---

## C36 — The transcript should record structured action rows with his responses interleaved

> *"[15:11] And then in the history here, it's, like, traveled to, you know, whatever element of the page, traveled to or clicked this, traveled here, clicked this, you know, something like that. [15:21] And then with his responses in between."*

**Code root cause** (`R3 §6`): `ChatMessage` has exactly three payload fields — `text`, `screen?`, `tools?` (`DeckeChat.tsx:135-158`). Chips are emitted from **exactly one place**: the server's execute wrapper for the 23 `@deckpal/agent-tools` data/write tools (`adapters/aisdk.ts:56-69`). **`flyTo`, `highlight`, `goTo`, `scrollToMe` and `click` have no server `execute` at all** — they are pure `CLIENT_TOOLS` (`tools.ts:437`) and never pass through that wrapper, so **no chip is ever emitted for any movement action.** `express` and `showScreen` do have server `execute` (`tools.ts:263-313`, `:402-431`) but write straight to a transient part without going through `onEvent`, so body language and screens are chip-less too.

Stated plainly: **today, if Deck-E flies somewhere, rings something, clicks something and flies again, the transcript shows nothing of that sequence structurally.** The only trace is whatever prose he chose to speak.

**What already exists to build on:** the client tools' return values already carry a sayable `reason` — e.g. `"pressed ${label}"` at `uiTools.ts:257-258`, and `click` deliberately names what was pressed (`data-decke-label` or trimmed `textContent`) *so Deck-E can say what happened rather than just "ok."* What is missing is (a) a transient part type emitted by the client runner rather than the server wrapper, (b) a handler in `LegHandlers` (`useDeckeChat.ts:486-492`), and (c) a renderer that **interleaves rows with prose in occurrence order** — which the current message-per-turn model cannot express, since chips are grouped per assistant message, not ordered against prose within a leg.

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C37 — On desktop the composer should go bottom-centre, mirroring mobile

> *"[15:26] And then, yeah, I mean, the response here was not bad. [15:31] I would, since we're changing that layout on desktop, I would have it go to the bottom center just to kind of mirror this similar positioning."*

Same target as C5/C6; recorded separately because it is the explicit statement that desktop should mirror mobile's positioning rather than keep a right-docked column.

**Severity:** major. **Confidence:** high. **Conflicts:** no.

---

## C38 — Praise: this round of feedback is more targeted (CONTEXT)

> *"[15:45] Yeah, so this is doing a lot better, by the way. [15:50] This I can work with. [15:52] So these are a lot more targeted fixes than our last round of changes. [15:59] But I just want to give you, like, very good context."*

**Severity:** context. Useful as calibration: he considers the current state a working base, not a rewrite candidate.

---

## C39 — Ad-hoc screens: the concept and a concrete use case

> *"[16:26] I love this kind of stuff. I have an idea of using, so we have this idea of, like, an ad hoc page, right, where he can build out of JSON or whatever. [16:46] And then there's a page that consumes that, like, a customized view of statistics or cards or whatever with, like, some call to action. [16:58] So one use case for that might be, you know, brainstorming a card list. [17:04] And he gives an ad hoc page that has, like, a card list, but it's not static. [17:12] It's just an ad hoc screen. [17:14] And it might have things on it, too, like some, you know, statistics, cards, or whatever. [17:23] You know, whatever it is that they asked for."*

**What he means:** he is describing the system that already exists and asking for it to be *used* more, with a call to action attached.

**What exists** (`R4 §B`): the full server schema is `apps/api/src/decke/screens.ts`. Block kinds: `heading, text, cardGrid, statTile, progress, status, empty, table, group` (`screens.ts:46-84`), with `group` the only nesting kind and nesting exactly one level (enforced twice — schema and `validateBlock`'s `group` case at `screens.ts:280-300`). Caps: `MAX_BLOCKS = 12`, `SCREEN_CARD_BUDGET = 60` cards spent in block order (a grid that doesn't fit is dropped whole, never truncated), `TABLE_MAX_COLUMNS = 4`, `TABLE_MAX_ROWS = 10`, `GROUP_MAX_PER_COLUMN = 4` (`screens.ts:186-225`). Validation is **reject-not-clamp** (`screens.ts:241-304`, `sanitizeScreen` at `:367-421`) *"because a model that is silently corrected learns nothing and repeats the mistake"* — the single exception being `fillQuantities`/`normalizeBlock` (`:306-348`) padding a short `quantities` array with `1`s. **Grounding** (`screens.ts:376-409`) strips card ids no tool actually returned this turn, keeping the honest remainder and naming the dropped ids back to the model.

Client renderer `DeckeScreen.tsx` mirrors the block list exactly (switch at `:96-234`); its header (`:1-26`) states the security property: *"there is no field anywhere in this schema that carries HTML, a class name, a style, a URL or a selector."* `sourceSync.test.ts` asserts the two `BLOCK_KINDS` lists never drift.

**Severity:** feature direction, not a defect. **Conflicts:** no. **Constraint:** any extension must respect the reject-not-clamp and grounding disciplines.

---

## C40 — Present the ad-hoc screen first as a small inline widget with real visuals

> *"[17:26] But I was kind of thinking that, like, he could present that ad hoc screen first as, like, a little widget inline chat with, like, some actual visuals. [17:36] Like, it actually shows, like, some card thumbnails and some cool things like that."*

**What's missing** (`R4 §B.3`): "inline in chat" already works — `DeckeChat.tsx:544-548` renders `<DeckeScreen spec={m.screen} />` wrapped in `.decke-figure`, full-width-minus-gutter. What is missing is:
- **No compact/summary rendering mode.** A top-level screen is never itself compact; there is no "show N of M, expand for the rest," no max-height + fade, no collapsed initial state. `MAX_BLOCKS = 12` caps *authoring* size, not display size.
- **No distinct visual treatment for a preview vs. a completed screen** — a dry-run screen attached to an open approval and a historical screen look identical.
- **No expand-in/streaming state** — `onScreen` is a single event, so the screen appears fully formed.

**Severity:** major (it is the delivery vehicle for C42). **Confidence:** very high. **Conflicts:** no.

---

## C41 — Chips should possibly lead to the ad-hoc screen (implied feature, from C15)

Restated from [05:28]: *"it almost made it feel like I thought I could maybe click on it to, like, have him take me to, like, an ad hoc screen that he had whipped up or something, but that wasn't the case."* And [17:41]: *"he dumps out his tools of, like, what's he's going to do first, but doesn't really communicate, like, where he's at. You know, that might be a way to make that better. I don't know."* — said while looking at beautifului.dev's **Task Rows**, which he had just toggled between its **Capsules / List** modes on camera (`t01071.401`, `t01072.461`, `t01073.693`, `t01085.703_preclick`, clicks landing on the toggle at 4K ≈(1923,1182) → (1854,1172)).

He hedges: *"That maybe is overkill for what deck E does, but it's an interesting thought."*

**Severity:** nice-to-have, explicitly hedged. **Confidence:** n/a. **Conflicts:** no. See Part 9, Q6.

---

## C42 — The Recommendation Card, adapted: "want me to put these cards in?"

> *"[18:17] Yeah, I really like this where it's, like, want me to put these cards in, and he could actually show, like, card thumbnails in a row down with the names of the cards and the variant. [18:30] And then you can accept it. [18:33] And then that's, you know, it's like this. [18:35] So this is the dry run, and then you click accept, and then it actually goes into your collection. [18:40] That would be amazing, this kind of thing."*

**This is the single most load-bearing component reference in the whole recording.** The viewport barely moves for ~28 seconds while he talks over it (`t01094.546` → `t01122.159`, no frame-diff above 3%) — he is looking at it, not scrolling past it.

**Visual evidence:** `t01094.546_framechange`, `t01126.202`, `t01436.023_framechange` (the cleanest single frame, containing the complete Prompt Bar and complete Recommendation Card together). Full anatomy is in Part 4b.

**What already exists — a complete propose→confirm→commit pattern** (`R4 §C`; expanded in Part 5):
- `wouldMutate` / `requiresApproval` (`adapters/aisdk.ts:214-231`): a call is a preview unless `dry_run === false` explicitly; `readOnlyHint` never needs approval; `destructiveHint` always does.
- `forcePreview` (`aisdk.ts:240-245`) is belt-and-braces — even a call classified as not needing approval gets `dry_run: true` forced in unless it is an approved write (`aisdk.ts:342-346`).
- Every tool is wrapped with `needsApproval: (input) => requiresApproval(def, input)` (`aisdk.ts:334-337`), and per `aisdk.ts:179-184` this is **a real SDK-level hold verified against the pinned `ai@7.0.66` build**, not assumed from docs.
- `log_cards` has a `dry_run` field. `deck_strategy`, `add_battle_log`, `edit_battle_log` have none, so every call to them is a write and always needs approval.
- Wire: server emits `tool-approval-request` with `approvalId` (+ `signature` when `DECKE_APPROVAL_SECRET` is set); `pendingApprovalFromChunk` (`approval.ts:122-138`) assembles it; the answer is sent by **replaying the entire tool call with the verdict attached** (`approvalReplayPart`, `approval.ts:162-185`).
- Client: `askApproval` parks a Promise on `resolverRef` (`useDeckeChat.ts:346`); `mayAskApproval(approvalReplays)` (`:334`) refuses to even show the dialog if there is no leg budget to carry the answer back — a guard for a real shipped bug, *"reader consents, turn ends, nothing written."* Budgets: `MAX_LEGS = 4`, `MAX_APPROVAL_REPLAYS = 2`, `legBudget(replays) = MAX_LEGS + replays` (`approval.ts:205-226`).
- UI today: `DeckeChat.tsx:595-645` — a plain-language question, the dry-run preview text from `previewOf(messages)` (`:161-180`, which walks back for the last `ok` chip's `summary`), and two buttons ("Leave it" / "Go ahead"), rendered as a single global `role="alertdialog"` fixed between the transcript and the composer.

**Gap:** the preview is one line of text. His ask — a row of card thumbnails with names and variants — needs the card imagery pipeline (Part 5, §5.6) and a per-item structure. Note also `DeckeScreen`'s `onRemoveCard` prop **exists in the renderer but nothing passes it** (`DeckeChat.tsx:546` renders `<DeckeScreen spec={m.screen} />` with no second prop) — the "that one's wrong" correction affordance is already wired and dead.

**Severity:** major (his most enthusiastic single ask: *"That would be amazing"*).
**Confidence:** very high. **Conflicts:** yes — Part 6 §6.6 (the prompt was rewritten to stop the model asking before calling).

---

## C43 — He likes the confidence indicator

> *"[18:43] And, like, you know, I like the high confidence of that."*

**Visual evidence:** `t01124.061_preclick` / `t01124.706_postdrag` / `t01125.093_preclick` — he **drag-selects the words "High confidence"** while saying this, confirming it is plain text beside a three-bar meter icon, not a tooltip.

**Countervailing evidence he has not seen** (R8 §4): the research on confidence indicators is genuinely mixed. A UMAP 2025 study found confidence ratings improved trust with 64% naming it most useful (`https://dl.acm.org/doi/10.1145/3708319.3734178`), but **miscalibrated confidence impairs appropriate reliance**, users cannot detect miscalibration by looking, and disclosing unreliability overcorrects into under-reliance (arXiv:2402.07632; CHI 2024 `https://dl.acm.org/doi/10.1145/3613904.3642671`). R8's recommendation: **avoid bare percentages** (false precision an LLM can't back), prefer PAIR's N-best/disambiguation pattern, and if a confidence signal is wanted make it **coarse and behaviour-linked** — low-confidence items default *deselected*, forcing opt-in.

**Severity:** nice-to-have. **Confidence:** n/a. **Conflicts:** no, but see Part 9, Q7.

---

## C44 — Directive: mine beautifului.dev for prompt patterns, and invent domain use cases

> *"[18:50] There's just so many great ideas in here that we can use, I think, for different kinds of prompts and stuff. [18:59] So I want you to really pore over this. Like, have some subagents really pore over this and, like, come up with, like, some really stellar designs for how this thing can work."*
> *"[19:15] And moreover, like, I want you to get creative with, like, the kinds of use cases that people might do with Deck E, considering the domain here. [19:27] And, like, come up with some cool things that we haven't thought about, you know."*

**Status:** R8 §8 already delivers 22 domain feature ideas, each with user phrasing → what Deck-E does → UI surface → why it matters, grounded in a survey of the real Pokémon TCG tool landscape (TCGplayer, Collectr, Pokellector, TCG Collector, Dex, CardTrader, Cardmarket, PriceCharting, PokemonPriceTracker, PSA/CGC/BGS pop reports, GemRate, CollX, TCG Pocket pull rates, TCGdex/pokemontcg.io). See Part 5, §5.9 for the list index.

**Severity:** directive. **Conflicts:** no.

---

## C45 — Mobile: he is overexplaining… actually no, that one is fine

> *"[20:41] But this was a previous ask I did, and, yeah, he's really overexplaining. [20:46] Well, actually, no, this is actually good."*

**What he means:** he **withdraws** the verbosity complaint for this particular answer. Recorded because it is a real boundary on C33: he is not asking for terseness everywhere — he is asking for brevity **proportional to the request**, and a deck-ideas answer earns length while a "find pitch black" answer does not.

**Visual evidence:** `t01245.678_framechange` — the four-deck-ideas answer he is judging.

**Severity:** context / scope boundary. **Conflicts:** no.

---

## C46 — Mobile: the page cannot be scrolled at all

> *"[21:00] But more than that, I cannot ‑‑ so right now I'm trying to scroll. [21:04] If you look down here, I'm trying to scroll, and I can't. [21:08] The only things that are scrolling is Deck E himself and the chat window, and that's really bad."*

**Visual evidence — direct proof:** `t01245.678_framechange` (pre-drag) and `t01245.823_postdrag` (after a real 1.3 s drag gesture, 1244.53–1245.81 s) are **pixel-identical**: same cut-off first line, same button layout, same Deck-E pose, same input pill. `t01261.755_framechange`, 16 s later, is still the same scroll position.

**Code root cause** (`R5 §1 Defect 1`) — and this one is **by design**:
```ts
// DeckeChat.tsx:273-278
useEffect(() => {
  if (!open || minimised) return
  decke?.returnHome()
  lockScroll()
  return () => unlockScroll()
}, [open, minimised, decke])
```
`lockScroll`/`unlockScroll` come from `Sheet.tsx:91-123` — a **ref-counted body-scroll lock shared** between `Sheet` and `DeckeChat`. Its export comment (`Sheet.tsx:77-90`) documents the sharing and warns about lock order (*"anything computing a delta against a previously-recorded scroll offset… must be released BEFORE locking"*), which is exactly why `decke.returnHome()` is called before `lockScroll()`. Mechanically it captures `window.scrollY`, sets `body.style.position = 'fixed'`, `top = -scrollY`, `width = '100%'`, `overflow = 'hidden'`, `overscrollBehavior = 'none'` — the standard iOS body-lock, and `overflow:hidden` alone does not hold on iOS Safari (`Sheet.tsx:70-73`). **This part is correct and appropriate.**

The only scrollable region while the lock holds is `DeckeChat.tsx:471-474` (the transcript). And "Deck-E himself scrolling" is not scroll at all — he is repositioned by WebGL on a `position: fixed` full-viewport canvas (`DeckeHost.tsx:420-427`, `z-30`), independent of body scroll.

**R5's assessment, which I endorse:** the "broken" feeling is the *composition* of C46+C47+C48+C30, not a distinct scroll-lock bug: the one scrollable area is unreachable at the top (C48) and cramped at the bottom (C30), so it feels dead at both ends.

**A plausible secondary contributor** (`R5 §1 Defect 3.3`, flagged as inference): the mobile panel is `pointer-events-none` except for specific opaque children. The `<ul>` at `DeckeChat.tsx:480` carries `pointer-events-auto`, but the **outer scroll container** `div ref={transcriptRef}` does not — so a drag landing in that div's own `px-[16px] pb-[12px]` padding band, or in the empty-state region before any messages exist (`DeckeChat.tsx:476`), can silently fail to scroll.

**Severity:** blocker. **Confidence:** very high for the lock; medium for the pointer-events contributor.
**Conflicts:** no — the lock itself is right; what needs fixing is everything around it.

---

## C47 — Mobile: the Deck-E header and X render inside the iOS status bar

> *"[21:16] If you look up here, the Deck E header and the X are clear up in the, like, iOS Chrome, which is really bad."*

**Visual evidence — verified directly for this brief, and it corrects the scribe.** Cropping `t01245.678_framechange` to `780x120+1790+225`:
- The word **"Deck"** is visible at the far left, with the rest of "Deck-E" hidden under the red iOS recording pill reading **"12:39"**.
- At the far right, the app's own **✕ close button is plainly visible — rendered directly on top of / behind the battery indicator glyph**, in the same horizontal band as the signal bars, Wi-Fi icon, and the orange mic-in-use dot.
- **There is no header bar, gap, or separation of any kind between the app title row and the iOS status bar. They occupy the same row.**

The range6 scribe wrote *"No visible in-app 'X' close icon appears anywhere in that header row."* **That is mistaken** — the X is there, collided with the battery icon, which makes the defect worse than reported, not milder.

**Code root cause** (`R5 §1 Defect 2`): `DeckeChat.tsx:433-460`. The mobile panel is `pointer-events-none inset-0` — it literally touches the viewport top — and its header is
```tsx
<header className={['flex shrink-0 items-center justify-between px-[16px] py-[12px]',
  desktop ? 'border-b border-border-default' : ''].join(' ')}>
  <span className="text-[15px] font-semibold text-text-primary">Deck-E</span>
  <button ... onClick={onClose} ...><Icon name="close" size={18} /></button>
</header>
```
**No `env(safe-area-inset-top)` anywhere in this header or any ancestor.** It is the **one** fixed-position header-shaped element in the codebase without that treatment — `AppShell.tsx:427-434` has it, `AppShell.tsx:359` has it (`calc(64px + env(safe-area-inset-top))`), `authUi.tsx:73` has it, `Landing.tsx:227` has it.

**Why it only bites in the installed PWA:** `index.html:13` sets `apple-mobile-web-app-status-bar-style: black-translucent` and `index.html:5` sets `viewport-fit=cover`. That combination makes iOS draw the status bar **transparently over** web content instead of reserving native chrome above it — which is exactly what makes `env(safe-area-inset-top)` load-bearing for every fixed-to-top element in standalone mode. In an ordinary Safari tab this same code looks fine because Safari's chrome occupies that space. This matches his report precisely (*"right now I'm using this in web app mode, so we don't have the Safari Chrome"*, [21:58]).

**Severity:** blocker. **Confidence:** very high. **Conflicts:** no.

---

## C48 — Mobile: content is cut off at the top with no way to reach it

> *"[21:49] This is, like, cut off, and there's nothing I can do about it. [21:53] I can't scroll up. [21:55] I can scroll ‑‑ I guess I can scroll that way."*

**Visual evidence:** `t01245.678_framechange` — the assistant's bubble begins **mid-sentence**: *"…that are cheap to fill in. Aggressive midrange that hits hard early and uses your owned basics for consistency."* The true start of the message is above the reachable area. Confirmed unchanged across `t01261.755`, `t01339.995`, `t01391.577`, `t01399.464`.

**Code root cause — two mechanisms** (`R5 §1 Defect 3`):
1. The header eats real pixels without accounting for the inset (C47), so the header's *effective visible* height is smaller than its layout height and the transcript starts where layout says, not below the safe area.
2. **A hard snap-to-bottom on every update:**
```tsx
// DeckeChat.tsx:329-333
useLayoutEffect(() => {
  const el = transcriptRef.current
  if (el) el.scrollTop = el.scrollHeight
  reflow()
}, [messages, reflow, gutter])
```
This runs on every `messages` change (new message, streamed token, appended chip) *and* every `gutter` change (breakpoint or character-size change), in `useLayoutEffect` (before paint, deliberately — comment at `:322-328` — so a message mounting clear of the character isn't animated sliding out from under him). **There is no "user has scrolled away, don't auto-scroll" guard.** A user scrolled up to re-read is yanked back down on the next token. Note this fights a very deliberate opposite choice made ten lines earlier: `DeckeChat.tsx:462-469` documents bottom-alignment via `mt-auto` rather than `justify-end` *specifically so `scrollHeight` stays reachable*.

**Severity:** blocker. **Confidence:** very high. **Conflicts:** no.

---

## C49 — Mobile: he notes he is in PWA/web-app mode (CONTEXT, load-bearing)

> *"[21:58] But if you look down here, so right now I'm using this in web app mode, so we don't have the Safari Chrome."*

**Why this matters:** it is the single most important environmental fact in the mobile section. Standalone mode is precisely the context in which `black-translucent` + `viewport-fit=cover` make safe-area insets load-bearing (C47).

**Reproducibility — REVISED after R9 landed.** Stock Chrome DevTools device emulation does not reproduce this context (no notch means `env(safe-area-inset-*)` is always `0`). **But `scripts/visual-harness/` now does**, over CDP: `Emulation.setSafeAreaInsetsOverride` was verified returning `env(safe-area-inset-top) = 47px` on the live page, and a `matchMedia`/`navigator.standalone` init-script shim covers the standalone detection that CDP cannot override — completely, because DeckPal's only standalone check is JS-level. **So this environment is now scriptable, and the mobile defects are reproducible without a phone**, with one residual: `backdrop-filter` compositing under a translucent status bar is a WebKit behaviour and the harness is Blink. See Part 7, §7.4 and §7.6.2.

**Visual evidence:** `t01233.787_framechange` (iOS home screen with the DeckPal icon, dark-blue rounded square with a white diamond/gem outline), then `t01245.678_framechange` with no Safari chrome.

**Severity:** context, high value. **Conflicts:** no.

---

## C50 — Claude iOS is the spacing/fade/card reference

> *"[22:17] I would encourage you to look at ‑‑ let's also look at Claude here. [22:25] That's, like, the right amount of spacing. [22:27] And I like, actually, how the conversation, like, the conversation goes inside ‑‑ it goes behind the text box, but it kind of fades. [22:40] So it starts to fade a little bit above the text input, and it's quite faded down here. [22:50] But I really like that. [22:51] And then I like that it's all encapsulated in a card rather than just a text input pill. [23:02] And, yeah, this just ‑‑ and then the spacing underneath there feels really good. [23:05] So that's what it should look like spacing wise."*

Three distinct asks in one breath: **(a)** a scroll fade mask above the composer, **(b)** the composer as a rounded card rather than a bare pill, **(c)** generous bottom spacing.

**Visual evidence:** `t01343.483_framechange` (the clean composer-anatomy frame) and `t01360.202_framechange` (the fade proof — a line of conversation text, *"red if the bug comes back?"*, visibly dimmed and partially obscured where it passes behind the composer card, **and** the top line under the sticky header rendered noticeably grayer than the crisp text below it). Full anatomy in Part 4a.

**Code root cause** (`R5 §1 Defect 6`):
- **No fade/mask exists anywhere** in `DeckeChat.tsx` or `theme.css` for the transcript. The transcript container is a plain `overflow-y-auto` div. A `mask-image` / `-webkit-mask-image` linear gradient would be **new** — there is no existing precedent for a scroll mask anywhere in this codebase.
- The composer `<form>` has **no background, border, radius, or shadow of its own** (`DeckeChat.tsx:647-652`); only the children are `rounded-full`. It is literally "a pill and a circle floating on the scrim."
- Available radius tokens for a card: `--radius-xl: 12px`, `--radius-2xl: 16px` (`theme.css:199-204`); existing precedent is `Sheet.tsx:284` (`rounded-t-2xl … nav:rounded-2xl`) and DeckeChat's own desktop panel `rounded-[18px]` (`:441`).
- **Design decision needed:** the approval-gate block immediately above the composer (`DeckeChat.tsx:595-645`) has `border-t border-border-default` but no background either. If the composer becomes an opaque card, whether that block joins the card or sits above it as its own element must be decided explicitly. Claude's own answer is visible in `t01343.483_framechange`: the *"Approaching limit / Resets at 6:00 pm"* notice is a **separate rounded card with its own corner radius and a visible gap** above the composer card.

**Honest limitation on the bottom-spacing measurement:** range7's scribe records that in every frame in that range, **the LetsView mirror window's own edge/toolbar cuts off the view at or just below the composer's control row**, so the true amount of space between the composer and the iOS home indicator **could not be measured** from those stills. Range6's `t01343.483_framechange` does capture it (*"a solid white horizontal home-indicator bar is visible with clear, generous breathing room"*), but as a qualitative observation, not a measured value. **Treat "the right amount of spacing" as a qualitative target, not a number, unless a fresh screenshot is taken.**

**Severity:** major. **Confidence:** very high on the code state; medium on the exact target spacing.
**Conflicts:** partially — the composer-card ask collides with the glass-panel decision. Part 6 §6.3.

---

## C51 — He does not like the input design at all; steal beautifului.dev's Prompt Bar

> *"[23:28] I don't love the design of the input at all. [23:31] And so this is something we should definitely steal from beautiful UI.dev. [23:37] They have some really good text input. [23:42] Let's see where is it. [23:44] Prompt bar. [23:47] Like, this is already better."*

**Visual evidence:** `t01415.003_framechange`, `t01424.838_framechange`, `t01436.023_framechange`, `t01449.228_preclick`, `t01455.894_framechange` — all three interactive states of the Prompt Bar. Full anatomy in Part 4b.

**Severity:** major. **Confidence:** very high. **Conflicts:** no.

---

## C52 — But keep it simple: no model picker; a `+` button; photo attach

> *"[23:50] But I would say, yeah, I mean, I would add, not, like, for now, that type of scope, I would say. [24:04] But let's make it like ‑‑ let me go back to Claude Mobile here. [24:18] Yeah, I really like Claude Mobile's where it's, like, text, and then, I mean, actually a lot of this we don't need just yet, like, model selection and stuff. [24:30] I actually don't want to add that stuff. [24:35] So let's keep it simple, I suppose, but do it more like this. [24:42] Maybe there's an add button. [24:44] A photo would be a good thing to add. [24:48] You let me know if you think it should be out of scope."*

**What he means, unpacked:**
- The line at [23:50] is garbled by transcription. Read in context — he says it immediately after praising the Prompt Bar and immediately before pivoting to "let's keep it simple" — the intended meaning is almost certainly *"I would **not** add that type of scope for now,"* i.e. he is scoping the Prompt Bar's `@`-mentions / `/`-commands / connectors **out**. **Flagged as an interpretation, not an observation.** See Part 9, Q1.
- **Explicit and unambiguous:** no model selector. *"I actually don't want to add that stuff."* This also settles C22 — the model question is developer-side only.
- **Structure:** Claude iOS's shape — a text line above a control row, inside one rounded card.
- **A `+` add button**, hedged (*"Maybe"*).
- **Photo attachment** is called out by name as a good addition — relevant because DeckPal already has a card scanner at `/scan` (`Scan.tsx`) and a `vision` model tier (`models.ts:223`).
- He explicitly asks to be told if photo attach is out of scope. **That is an open question addressed to us.** Part 9, Q2.

**Visual evidence:** `t01467.795_preclick` — the Claude iOS composer he is pointing at: `"Add feedback…"` placeholder, then a control row of circular `+`, an **"Opus 5"** pill, a **"⚡ Auto"** pill, a circular mic, and a filled circular up-arrow send in muted rust. He wants that shape **minus** the two pills.

**Severity:** major (it is the scope statement for C50/C51). **Confidence:** high for the model-picker rejection; **medium for the [23:50] reading.** **Conflicts:** no.

---

## C53 — Directive: how the work should be run

Covered in full in **Part 8**. Registered here for completeness of the count.

---

---

# Part 2b — Added by the adversarial audit (C54–C60)

Rev 2. A line-by-line pass over all 237 transcript lines found rev 1's coverage to be **very nearly complete** — every want, dislike, preference and instruction maps to a numbered item. What follows is what it did not map: one requirement that was **lost mid-sentence**, four framing/behavioural facts that change how the rest should be read, and two syntheses of things he *did* rather than said.

They are numbered as complaints for continuity of the register. Most are context; **C54 and C59 are not.**

---

## C54 — An interrupted requirement, lost on camera and never resumed

> *"[10:11] Okay, so he did finally, okay, and he started talking. **I honestly would have loved him to,** heck, my browser just, like, hiccuped and booted me out."*

**What happened:** he began stating a want — *"I honestly would have loved him to…"* — and the browser hiccup (C25) cut him off mid-clause. He then spent 30 seconds diagnosing the hiccup, and **never returned to the sentence.** Rev 1 quotes this line inside C25 as the lead-in to the hiccup and does not register that a requirement was destroyed by it.

**Why it matters:** it is the only requirement in the recording that is *known to exist and unknown in content*. Everything else is either captured or absent; this is captured-as-a-fragment. A plan built from this brief will silently not implement it.

**What it probably was, stated as inference and nothing more.** He had just watched an 86-second silent turn finally begin streaming (D1), immediately after two minutes of narrating that the silence made him doubt it was working (C19), that he wanted Claude-style updates between tool calls (C20), and that Deck-E should change expression between beats (C21). **The most likely completion is in that family** — *"I honestly would have loved him to [say something while I waited / tell me what he was doing / react when the answer finally came]"* — which would make it a restatement rather than a new item.

**But that is a guess with no evidence behind it, and the honest alternatives are not close together.** *"…loved him to fly over and show me"* (C32), *"…loved him to be shorter"* (C33), and *"…loved him to have caught that it failed"* (D2 — he was looking at a tool-failure message he had misread as a success) are all consistent with the audio and lead to different work.

**Action: ask him.** It is one sentence, he was speaking at t=10:11, and the recording exists. **Part 9, Q12.**
**Severity:** unknown, and that is the point. **Confidence:** n/a.

---

## C55 — His framing: everything said during the walkthrough is a fix list (CONTEXT, load-bearing for scope)

> *"[00:51] So, I just want to walk through the experience of this thing and just talk about it as I do, so that you know what to fix."*

**Why this is worth a number:** it is the sentence that makes the asides binding. He is not delivering a prioritised requirements document; he is thinking aloud with the explicit intent that **the thinking-aloud is the specification.** That is why C1 (recording jutter), C38 (praise), C45 (a withdrawn complaint) and C49 (which mode he was in) belong in the register at all, and it is the licence for Part 3 to register defects he never named.

**It also sets the failure mode to guard against:** an implementer who reads only the strong statements will build ten things and miss the twenty hedges, withdrawals and boundaries around them — most importantly C45, where he **withdraws** a verbosity complaint, and C8, where he **reverses himself inside one sentence.**

**Severity:** context. **Conflicts:** no.

---

## C56 — "have Deck-E down here" is a distinct mobile positional instruction, and C29's fix can break it

> *"[21:28] And moreover, like, let's have the top Chrome of our app not be blurred. [21:37] I did say that earlier, **but have Deck E down here.**"*

Rev 1 folds this whole quote into C29 as a restatement of "keep the top bar unblurred." **The second clause is a separate instruction**, and it is the one most likely to be broken by implementing the first.

**What he means:** whatever happens to the top of the mobile sheet, **he stays at the bottom.** This is consistent with [11:20] (*"In mobile size, he's in the right spot"*) — his mobile *position* is the one thing about him he has said is already correct.

**Why it is fragile:** C29 requires the mobile panel to start below the header, i.e. a top offset of `calc(64px + env(safe-area-inset-top))`. The park landmark is positioned **inside that panel** at `bottom: PARK_BOTTOM = 6` (`DeckeChat.tsx:576`, constant at `:98`), so a naive `inset-0` → `top: 64px+inset` change keeps him bottom-anchored and is safe — **but any change that instead re-centres or re-flows the panel's contents, or that switches the desktop and mobile park solvers to a shared implementation (see §6.7's `[AUDIT]` note), moves him.** Verify his mobile position is unchanged after C29 lands; do not assume it.

**Severity:** minor as a request, **major as a regression risk.** **Confidence:** high. **Conflicts:** no.

---

## C57 — A stated intent he abandoned mid-test (CONTEXT, behavioural)

> *"[11:00] Let's ask another thing. [11:03] Oh, yeah, big issue is he's facing the wrong direction…"*

He announces a third test prompt and **never sends it.** The facing defect (C26) interrupted him hard enough to derail his own plan, and he spent the next ninety seconds resizing the window to demonstrate it instead.

**Why it is worth recording:** it is behavioural evidence of severity that his words alone understate. He calls C26 a *"big issue"*, which is already strong — but the stronger signal is that noticing it **cost him a test he had decided to run.** Weight C26 accordingly.

**Severity:** context. **Conflicts:** no.

---

## C58 — His own summary of the mobile section (CONTEXT)

> *"[19:55] So I'm going to share my screen again from my phone, because **there's a lot of issues on mobile.**"*

Said *before* he had shown any of them — so it is a prior judgement, not a running total. Recorded because it corroborates the severity weighting of C46/C47/C48/C30 as blockers rather than polish, and because it is the only place he grades a whole section.

**Severity:** context. **Conflicts:** no.

---

## C59 — There is no cursor in any mobile frame, and every mobile deixis rests on his voice alone

> *"[20:35] So here we are in Deck Pal, and **I'll be pointing at things so you can tell what I'm pointing at.**"*

**This is an evidentiary limitation on roughly a quarter of the recording, and rev 1 does not state it anywhere.**

From t≈20:35 to the end, the DeckPal content is a **LetsView mirror of his physical iPhone**. A finger on a phone screen produces **no rendered pointer**, so the stills contain **no cursor, no hover state and no click indicator** for that entire span. He knew this — hence the announcement — and compensated by narrating. But it means every deictic reference in the mobile section resolves **only** from his words plus what is visibly on screen:

- *"If you look down here, I'm trying to scroll"* [21:04] → C46
- *"If you look up here, the Deck E header and the X"* [21:16] → C47
- *"have Deck E down here"* [21:37] → C56
- *"This is, like, cut off"* [21:49] → C48
- *"there's this gap down here"* [22:08] → C30
- *"the spacing underneath there"* [23:02] → C50
- *"this is, like, super close to the bottom"* [23:14] → C30

**Consequence for the plan:** each of these is an interpretation, not an observation, and each should be re-confirmed against the fixed build rather than treated as a pixel specification. Two are already known to be shaky for exactly this reason — Part 4a records that the mirror window's own chrome **cut off the region he was pointing at** in every range-7 frame (Q8), and rev 1's own §4b.1 records the same window occluding the slash-command menu.

**Compounding it:** the mirror also introduces a **second, unrelated failure mode** — the frame he is pointing *into* is a re-encoded video of a phone, so fine detail (a 1 px divider, a subtle gradient, the fade he praises in C50) may be a compression artifact rather than a real rendering. Range 7's scribe says outright it *"could not resolve a distinct fade gradient at its crop/compression level."*

**Severity:** context, **high value** — it is the reason several mobile items are qualitative targets rather than measurements. **Confidence:** very high (he says it). **Conflicts:** no.

---

## C60 — Drag-selecting text is his diagnostic gesture, and it is a design requirement in disguise

**Not something he said. Something he did, eleven times.**

| What he drag-selected | Frames | What he was testing |
|---|---|---|
| `**604 distinct cards**`, twice | `t00249.890_postdrag`, `t00253.611_postdrag` | is this bold, or is it literal asterisks? |
| `**1,298 total copies**` across a line break | `t00257.712_postdrag` | does it affect wrapped spans too? |
| the "Collection summary" pill's text | `t00237.114_postdrag`, `t00317.587_postdrag`, `t00318.605_preclick` | is this a control, or is it text? |
| all three chips at once | `t00531.967_framechange` | same question, batched |
| the words "High confidence" | `t01124.061` → `t01124.706_postdrag` → `t01125.093` | is this a label or a tooltip? |
| the entire Pitch Black answer | `t00860.193` → `t00862.383_postdrag` | how long *is* this, really? |

**The synthesis rev 1 does not make:** every one of these is the same question — ***is this thing text, or is it an object?*** — and he asks it by grabbing it, because the UI does not answer it by looking. He then says so explicitly at [05:18]: *"I don't know, it was not clear whether, like, it's something I'd be able to click on."*

**Stated as a design rule for this pass:** *every chip, pill, row, badge and meter introduced by this work must answer "am I pressable?" at rest, without being touched.* That is what C16's *"highlightable, but it isn't a pill by default"* is reaching for and what §4b.3b's Tool Chips entry (icon swaps to a chevron on hover; a resolved row stays interactive) implements. It also means the inverse: **things that are genuinely not pressable should not wear pill chrome**, which is the current bug.

**One concrete, cheap consequence:** nothing in `DeckeChat.tsx` applies `user-select: none`, which is why all eleven of those drags worked on things that were not selectable-by-intent. **Do not fix this by adding `user-select: none` to the chips.** He values being able to select his answers — and a chip that resists selection but still does nothing when pressed is strictly worse. Make them real controls or make them plain text; the selection behaviour is a symptom, not the defect.

**Severity:** major, as a cross-cutting acceptance criterion. **Confidence:** high (eleven observations). **Conflicts:** no.

---

**Total complaints registered: 60** (C1–C60). Rev 1 registered 53; rev 2 added seven. Of these: **42 actionable** (C2–C12, C14–C24, C26, C27, C29–C37, C39–C43, C46–C48, C50–C52, C60, plus C56 as a regression guard), **12 context/aside** (C1, C13, C25 in part, C28, C38, C44, C45, C49, C55, C57, C58, C59), **4 directives** (C13, C44, C53, plus the beautifului.dev tour instruction folded into C13), and **1 known-lost** (C54).

---

# Part 3 — Defects found in the frames that he did NOT mention

**Sixteen items** (D1–D9 from rev 1; D10–D16 added by the rev-2 audit). Each is something the scribes, this brief's own frame verification, or the audit's independent re-verification found that he did not name in narration. Rev 2 widens the scope: **D10–D13 are code-derived rather than frame-derived**, and each entry says which it is. Where a claim in the source material turned out to be wrong, it is corrected here rather than repeated.

---

## D1 — A 61-second pixel-identical UI freeze, measured by direct frame comparison

**What was found:** during the "deck ideas" turn, the chat panel shows **zero change of any kind** for approximately 61 seconds of wall-clock time.

**`[AUDIT]` — the finding is real; the word "pixel-identical" was not, and the correction matters because someone will try to reproduce this.** Every frame below was re-rendered and compared numerically for this audit.

**Evidence, restated precisely:**
- `t00529.107_preclick` (t=8:49) — three tool chips, stop button, no answer. Taskbar clock reads **12:27 PM** (crop `700x120+3140+2020`; the date reads 8/22/2026).
- `t00590.157_preclick` (t=9:50) — same conversation content. Taskbar clock reads **12:28 PM**. **The clock alone only bounds the gap to 1–120 s; the precision comes from the still timestamps, which give 61.05 s.** Quote 61 s from the timestamps, not from the clock.
- Across that whole span the *conversation* is genuinely frozen: same last user message, same three chips, **no assistant reply at any point**, stop-button (filled square) present throughout.
- **What is NOT true: that the frames are pixel-identical.** `t00531.967_framechange` vs `t00537.387_framechange` differ (different md5). Panel-crop PSNR is **51.9 dB** (Y 50.2) — sub-LSB codec noise, visually indistinguishable but not identical. **Whole-frame PSNR between the same two is 26.0 dB**, a large difference, because **Deck-E is idle-rocking the entire time** and a difference image lights up almost entirely on his head and body.
- **And the panel itself does change — just not with app output.** Measured against `t00529.107` (crop `680x980+2050+930`): `529.107` has a cyan focus ring on the input; `531.967` and `537.387` have no focus ring and **all three chips drag-selected blue** (from his drag at `t00531.346_postdrag`); `590.157` has the selection cleared. Panel PSNR runs 30.9–38.2 dB across the span. **All of it is the user's own doing.**

**So the defensible statement, and the one the plan should hold itself against:** *"across 61 seconds of wall-clock time the chat panel produced no output of any kind — no token, no chip transition, no status change — and the only motion anywhere on screen was the character's idle rock."* That is both true and worse, because a reader watching an idle animation loop has no way to distinguish "working" from "hung."

**Then:** `t00608.441_framechange` (t=10:08) the answer streams in; `t00615.637_preclick` (t=10:15) the send button reverts to the teal chevron, confirming generation finished. **Total ~86 s from prompt-sent to finished answer.**

**Why he did not name it:** he named the *feeling* (C19) but not the duration. The 61 s figure is the scribes' measurement, and it is the hard number the plan should hold itself against.

**Root cause:** C19's — `deep.ts:172-174` swallows the sub-agent's entire stream; the only signals are one `start` chip and, up to `DECKE_DEEP_BUDGET_MS` (210,000 ms) later, one `ok`/`error` chip.

**Severity:** blocker.

---

## D2 — The response he later praised as "a great response" was actually a tool-failure message

**This is the most important finding in Part 3.**

At [07:00] he says: *"He was. He came back with a great response."*

**The response was an apology for a timeout.** Verified directly for this brief by cropping `t00615.637_preclick` — verbatim:

> *"You already have 10 decks built, mostly around \*\*Mega Evolution\*\* cards (Mega Lucario, Mega Sharpedo, Mega Diancie, Gengar ex / Bastiodon, etc.) plus a few Standard ones like Dragapult ex and Toolbox Slowking. **The analyze tool timed out before it could finish reading your full collection and suggesting fresh ideas, so I don't want to guess and feed you bad advice.** Want me to narrow it down and try again? For example: - Focus only on your \*\*Mega Evolution\*\* cards (me04/me05) - Look for strong \*\*Psychic\*\* or \*\*Water\*\* decks - Or something casual/fun using your big Base Set vintage pile Just say the direction and I'll dig deeper."*

**He did not notice.** He read a graceful failure as a success. Three consequences the plan must reckon with:

1. **The 86 seconds bought nothing.** The `analyze_collection` deep tool hit its budget and returned no analysis. So the latency complaint (C19) and the failure are the *same event*: the wait was long precisely because a tool was running out its clock and then dying.
2. **The failure is invisible in the chat UI — and `[AUDIT]` re-verification makes this worse than rev 1 stated.** Rev 1 reasoned that the chip *should* have rendered in its `error` phase, which `DeckeChat.tsx:519-540` styles as `text-text-muted line-through` — struck-through muted text, no colour, no badge, no auto-expansion. **Re-cropping the frame for this audit: no chip shows any error or strikethrough style at all.** All three are identical grey outlined pills, left to right `Collection summary` → `Browse decks` → `Analyse the collection`, and there is **no failed-tool indicator anywhere in the message.** The only trace of the timeout is one sentence buried mid-paragraph in prose.

   **That forks the root cause, and the fork matters because the two branches need different fixes:**
   - **(a) The error phase was emitted and its styling is simply too quiet to see** — `text-text-muted line-through` on a 12 px pill against `bg-surface-secondary`, at this compression, may genuinely be invisible in a still. Fix: loud failure styling (§4b.3b/06 — red badge, red "Failed" pill, retry affordance).
   - **(b) The error phase was never emitted at all** — the deep tool hit `DECKE_DEEP_BUDGET_MS` and, per `deep.ts:79-82`, **returns partial findings labelled incomplete rather than being killed**, which would surface as `phase: 'ok'` carrying a sad summary. **If that is what happened, no amount of chip restyling fixes it**, because the chip is faithfully reporting a tool that reported success.

   **Which one it is has not been established and cannot be from a still.** It is one network capture away: `decke-gates.mjs`'s `instrument()` already records every `data-decke-tool` part on the wire (gate 7 exists for exactly this), and `scripts/decke-signed-probe.mjs` is the template for a narrow no-browser probe. **Settle this before designing the failure UI.** R8 §3's rule — *failure must be the deliberate exception to collapse-by-default* — applies either way, but under (b) it has to be enforced at the tool boundary, not in the renderer.
3. **The chip reorder (C23) actively hid it.** Because `useDeckeChat.ts:263-278` appends each updated chip to the end of the array, `Analyse the collection` — the one that failed — ended up **last** in the row, which reads as "most recent," not "broken."

**Related:** `DECKE_DEEP_BUDGET_MS` defaults to 210,000 ms and is a *shared* ceiling across four very different deep tools (`plan_deck`, `analyze_collection`, `write_strategy_guide`, `research_meta`); on expiry the tool returns partial findings labelled incomplete rather than being killed (`DEPLOYMENT.md` env table, `deep.ts:79-82`). Whether 210 s is right for `analyze_collection` specifically is an open question — Part 9, Q5.

**Severity:** blocker. This is a correctness/observability defect, not a cosmetic one.

---

## D3 — A duplicated suggestion chip rendering 2–3× identically

**Evidence:**
- Desktop: `t00856.517_framechange`, `t00859.447_preclick` (t=14:16–14:19) — below the Pitch Black answer: "Search the card catalog" and "Set completion progress", with **"Set completion progress" appearing twice**, the second on its own row.
- Mobile: `t01245.678_framechange`, `t01451.608_preclick` — **verified directly for this brief.** The stack reads: row 1 "Collection summary" + "Analyse the collection"; then **"Set completion progress" three times, stacked vertically**; then "Search the card catalog". Three identical full-width outlined pills.

**Both scribes hedged this as "likely a rendering/repaint artifact." I believe that is wrong, and there is a better explanation with a code citation.**

Chips are keyed by `toolCallId` and upserted by id (`useDeckeChat.ts:263-278`, `filter((c) => c.id !== chip.id)`), and every chip corresponds **1:1 to a real invocation of a real handler, by construction** — the explicit design property stated at `adapters/aisdk.ts:51-64`. So three identical labels almost certainly means **three genuine separate calls to the same tool with three different `toolCallId`s** — e.g. `set_progress` invoked once per set the model was checking. The renderer is doing exactly what it was built to do; the *model* made three calls and the UI has no notion of grouping repeated calls to the same tool.

**Confidence:** medium-high in this explanation, low in the "repaint artifact" reading. It is falsifiable: a single network capture of that turn would show three `data-decke-tool` `start` events with distinct ids. **Recommend confirming before designing around it**, because the fix differs completely: a de-dupe/grouping treatment in the renderer versus a prompt change to stop redundant calls.

**Severity:** minor visually, but a symptom of a real behaviour worth understanding.

---

## D4 — A stale response bubble stays pinned on screen after navigating away underneath it

**Evidence — verified directly for this brief.** `t00795.226_preclick` / `t00795.460_framechange` (t=13:15): he clicks the "‹ Mega Evolution" breadcrumb, navigating from `/series/mega-evolution/me05` up to `/series/mega-evolution`. The page underneath fully re-renders to the 8-set grid (Pitch Black, Chaos Rising, Perfect Order, Ascended Heroes, Phantasmal Flames, Mega Evolution, MEP Black Star Promos, Mega Evolution Energy). **The entire Pitch-Black answer remains displayed, unchanged, floating over the new page** — a paragraph about set me05's completion percentage hovering over the series list.

The crop shows two things the scribe did not distinguish:
- **This is not the docked chat panel.** It is the **speech bubble** (`DeckeBubble.tsx`), shown in minimised/travelling mode beside the parked character. No header, no close button, no input row.
- **The bubble is drawn on top of Deck-E's own face**, clipping his head — only one eye, part of the head and the smile show past its left edge. `DeckeBubble.tsx:117` puts the bubble at `z-31`, above the canvas at `z-30` (`DeckeHost.tsx:420,424`).
- A faint minimised bar (`DeckeChat.tsx:378-397`, `fixed inset-x-[12px] bottom-[12px] z-[25] … nav:right-[24px] nav:w-[420px]`) is visible bottom-right, still reading "Say something…".

**Root cause — `[AUDIT]`: the grep rev 1 asked for has now been run, and it CONFIRMS the inference. Upgrade this from "unconfirmed" to "established by absence."**

The grep (`useLocation|useRouterState|useMatch|router.subscribe|location.pathname|usePathname|useNavigate` across `apps/web/src/character/host/`) returns **exactly four hits, none of which dismisses anything**:

| Hit | What it does |
|---|---|
| `DeckeHost.tsx:30` | the import |
| `DeckeHost.tsx:101-102` | `useRouterState({ select: (s) => isChromelessPathname(s.location.pathname) })` — computes `chromeless` **only** |
| `DeckeHost.tsx:143` | `useNavigate()` — the outbound half, for `goTo` |
| `uiTools.ts:266`, `useDeckeChat.ts:559` | one-shot reads of `window.location.pathname` inside a tool call and a turn payload |

**There is no route-change subscription anywhere in the character host that touches `open`, `minimised`, `travelling`, the bubble text, or the station.** So the root cause is now citable as an absence with a bounded search behind it: `DeckeHost` is mounted once above the route tree (`main.tsx:100-106`) and deliberately survives client-side route changes so the WebGL context and the conversation persist — correct and valuable — but **nothing anywhere reacts to the route changing under a piece of transient chat presentation.** The bubble, the minimised bar and the parked station all simply stay.

**Why this matters more than it looks:** the surviving state is not only visual. `this.station = { kind: 'element', target, depth, side, centre }` (`DeckE.ts:1159`) holds a **selector** for an element on the page he flew to. After a user-initiated route change that selector may match nothing, or — worse — may match a *different* element on the new page, and the station re-solve will happily park him beside it. **Confidence: high** for the presentation half (the grep is exhaustive over the host directory); **medium** for the station half, which is reasoned from the data structure rather than observed in a frame.

**Severity:** major. It will get much worse under C34's escorted journeys, where route changes become routine mid-turn.

---

## D5 — Reopening the chat after the hiccup produced a brand-new empty conversation, losing prior Q&A

**Evidence:** `t00652.071_preclick` (t=10:52) — the Deck-E panel is open again, header and X present, and the conversation is **completely empty**: the placeholder *"Ask me about your collection, or tell me to show you something."* sits centred in the empty scroll area, with no trace of either the "604 distinct cards" exchange or the "solid deck ideas" exchange.

**Root cause — expected behaviour with no persistence layer, not a bug**, consistent with R3 §8: `useDeckeChat`'s state — the `messages` array, `busy`, the in-flight `abortRef`/turn loop, `asking` approval state — lives in `DeckeHost`, which is mounted once above the route tree and **survives client-side route changes but not a full document load.** `runtime.ts:159-196` even force-loses the GL context on `pagehide` before unload. The hiccup (C25) involved real tab navigation away from and back to the page, i.e. a full reload, which wipes it.

The correct framing is therefore: **there is no conversation persistence across reloads, at all, by construction.** Nothing is broken; the capability does not exist. Whether it should is a product decision — Part 9, Q3.

**Severity:** major as a gap; not a defect. Registered because it happened to him on camera and he did not comment on it.

---

## D6 — Deck-E clipped by the viewport top at narrow widths

**Evidence:** `t00705.308_framechange` (~460 px wide) — only the top-right portion of his head/eyes visible past the page edge. `t00707.696_framechange` (~275 px usable) — almost entirely cut off; only the top of his head, the lightning-bolt brows and upper eyes peek out. `t00711.816_framechange` — sustained, not a one-frame glitch. `t00715.902_postdrag` — the cleanest crop: **his head is cropped at the top by the browser viewport edge, lightning bolts partially severed.** `t00726.366_postdrag` — reproduced after he widened and re-narrowed.

**Root cause — partially explained, partially open.** `characterHeightFor` (`DeckeHost.tsx:81-84`) caps at `min(300, h*0.3, w*0.55)`, so he shrinks with the viewport — but his *anchor* is `HOME_INSET = {x: 0.17, y: 0.22}` (`dom.ts:35`), a fixed fractional corner, and his body is `BODY_W 1.75 × BODY_D 1.15 × BODY_H 2.4` blender units (`constants.ts:20-23`) rendered through a dollied camera. **No research document explains the top-edge clipping specifically**, and the canvas is `fixed inset-0 … h-[100lvh] w-full` (`DeckeHost.tsx:424`), which should cover the screen. Label this **root cause not established.**

Worth noting: R5 §2 records that the `100lvh`/`100svh` machinery (`DeckeHost.tsx:415` measurement strut at `h-[100svh]`, canvas at `h-[100lvh]`, and the central `viewport.ts` singleton that forbids any `character/decke/*` module from reading `window.innerWidth/innerHeight` directly) exists to solve mobile-Safari toolbar-slide, and is inert in standalone PWA mode where `svh`/`lvh`/`dvh` are equal. This clipping was observed in a **desktop Chrome window resized narrow** — a third case neither was designed for.

**Severity:** major.

---

## D7 — Deck-E overlaps the PWA "Install" button at narrow widths

**Evidence:** `t00715.902_postdrag` is the primary reference still — the dark-gray capsule **"Install ⬇"** pill sits **directly over / in front of the lower half of Deck-E's face and chin**, both fighting for the same bottom-left corner. Also `t00678.372`, `t00681.279`, `t00686.986`, `t00705.308`, `t00707.696`, `t00711.816`, `t00719.103`, `t00726.366` — reproduced across at least eight frames and two separate narrowing passes.

The scribe notes he *deliberately toggled the window back and forth to demonstrate this repeatably on camera* — so although he never says it out loud, he was showing it.

**Root cause:** the Install control lives in `AppShell` (visible bottom-left of the sidebar at desktop width in `t00635.923_preclick`, `t00760.245_postdrag`). Deck-E's home anchor is `HOME_INSET = {x: 0.17, y: 0.22}` (`dom.ts:35`), and at very narrow widths his rendered footprint is large relative to the viewport, so the two collide. **No collision-avoidance system exists**; the only related mechanism is the mobile `.decke-shift` reflow (`DeckeChat.tsx:309-355`, `CLEAR_PAD = 10` at `:133,:315`), which keeps *chat bubbles* clear of the park box and has nothing to do with app chrome.

**Corroborating rule from R8 §6:** *"Auto-shrink/collapse whenever Deck-E would occlude content — treat this as a hard rule, not a nice-to-have."*

**Severity:** major.

---

## D8 — A visibly tilted / tumbling animation when closing and reopening the panel

**Evidence — verified directly for this brief.**
- `t00924.213_preclick` → `t00924.821_framechange` (t=15:24): the panel closes. In the second frame Deck-E is caught **tilted roughly 25–35° off vertical**, centred above the card row at about the height of the search/filter controls, antennae up-left, face angled diagonally. He is also large enough to completely cover the "Fomantis" card and part of the filter row. (The launcher chip is simultaneously visible bottom-right — a second instance of C2's "two Deck-Es.")
- `t00941.420_preclick` → `t00942.682_framechange` (t=15:41): the panel reopens and he is again mid-animation, **tilted the other way** (leaning right, antennae up-right), positioned upper-left inside the panel bounds.

**Root cause — probable, not proven.** This is most likely the **authored flight lean**, not a bug. `flight.ts:101` states `lean follows ACCELERATION, not speed` — *because a speed-driven lean cannot show braking* — and orientation (lean, yaw, bend/lean/twist "whip", squash, mouth) is derived from the solved velocity/acceleration curves rather than authored per-leg. The profile is deliberately asymmetric (`ACC_FRAMES = 20` vs `DEC_FRAMES = 6.5`, ~4:1), with an anticipation arc before departure (`ANTIC_ARC`, `ANTIC_FRAMES = 7`) and an aimed overshoot before settling (`OVERSHOOT_FRAC/MAX`). A return-home flight across a large screen distance, played at `travelRate` up to 2.95× (`flight.ts:95-98`), would produce exactly this pose at exactly this moment.

The honest reading: **the lean is intended; its amplitude at this speed and distance reads as tumbling rather than banking.** It is also the same phenomenon he *does* complain about at [14:50] (C35). **Confidence: medium.** Not independently verified against the solver.

**Severity:** minor. Likely changes character once C3 (scale-up-from-zero) and C9/C27 (a much shorter travel distance to a composer-adjacent stand point) land.

---

## D9 — CORRECTED: "no visible relaunch icon in the closed state" is not a real defect

**The claim, as filed:** the range3 scribe wrote that after the browser hiccup, with the widget closed, there was *"no visible relaunch icon anywhere on screen (checked both the page's bottom-right corner and the header, which only has Scan/bug-report/avatar buttons)."*

**Verified directly for this brief. The claim is mistaken.**

- `t00635.923_preclick` (t=10:35), cropped `500x400+2400+1700` — the **Deck-E launcher chip is plainly visible** at the bottom-right of the DeckPal viewport: a gray circle containing the flat 2D teal Deck-E face, eyes open, pink smile. Chrome's page scrollbar is immediately to its right, placing it unambiguously **inside the browser viewport**, not in the terminal app.
- `t00638.510_preclick` (t=10:38), cropped `600x450+2300+1600` — same chip, same place, awake.
- **The scribe actually described this exact element** — *"a stylized flat teal robot-face icon (two white oval eyes, a magenta smile)"* — but placed it *"clearly inside the unrelated terminal app's UI."* That attribution is wrong.
- **The scribe also misread the click targets.** The preclicks at `t00635.923` (4K 2629,1835) and `t00638.510` (4K 2628,1843) land, by measurement, **exactly on the launcher chip** (computed centre ≈ 2636,1837). He was clicking the launcher, twice, to reopen the chat — which is why the next captured chat state at `t00652.071_preclick` is an open panel.

**One frame does show it absent, and that is explainable.** `t00639.214_framechange` (t=10:39), cropped `600x450+2300+1600`, shows the corner empty. The most likely explanation is the click captured one frame earlier: `DeckeHost.tsx:433-436` renders `<DeckeButton hidden={chatOpen} …>` and **hides the button whenever the chat is open**. Two caveats, stated honestly: (a) the chat panel is also not yet painted in that frame, which a 280 ms `decke-chat-in` animation should have completed by then; (b) the Chrome window was resized very slightly between the two frames and the page scrollbar disappeared. **I cannot fully resolve `t00639.214` from stills. Labelled uncertain.** What I can say with high confidence is that the general claim — "there is no way to relaunch Deck-E" — is false.

**Separately, the proposed `/auth` explanation is a correct fact about a different frame.** At `t00627.588_preclick` the tab's address bar reads `127.0.0.1:5210/auth` with a blank body — and `DeckeHost.tsx:408` early-returns `null` on chromeless paths, auth routes being chromeless (`isChromelessPathname`, `DeckeHost.tsx:88-103`; route table in R3). **No button renders there, and that is correct behaviour.** It just is not the frame the scribe was describing.

**Bonus observation worth keeping:** `t00635.923_preclick` is a genuinely useful reference still, because it shows **the desired end state of the C2 fix, transiently and by accident** — a freshly-loaded `/series` page with the launcher chip present and **no 3D character rendered at all**, because the page had just reloaded and the idle warm timer had not yet completed.

**Status:** investigated and dismissed. Do not re-raise.

---

---

## D10 — The speech bubble renders raw markdown too, and C32 makes it the main text surface

**Code-derived, not frame-derived — and it is a hole straight through C11's fix as currently scoped.**

`DeckeBubble.tsx:129` renders **`{text}`**, a raw string child, exactly as `DeckeChat.tsx:492-503` does. The file is 132 lines and contains no markdown handling of any kind.

**Why rev 1 missed it:** C11 and §5.1 both locate the defect precisely at `DeckeChat.tsx:492-503` and scope the fix to swapping that one JSX child for a lazily-loaded `MarkdownView`. **That fix leaves the bubble untouched**, and the bubble is a *second* renderer of the same assistant text.

**Why it matters more after this pass than before it:**
1. **C32 routes far more traffic through it.** The bubble is what he speaks through in minimised/travelling mode. An escorted hop-outline-click-hop journey is *entirely* bubble text. C33's own note already says the brevity discipline lives on the bubble path — so the plan is deliberately pushing more words into the one surface that will still print `**asterisks**`.
2. **It is the worst possible place for them.** The bubble is `max-w-[280px]` at `text-[13px]/[19px]` (`:117-119`). Literal asterisks in a 280 px column are proportionally louder than in a 420 px panel, and D4 already establishes the bubble drawing over his own face.
3. **The bubble cannot be worked around.** It is `pointer-events-none` (`:117`), so its text cannot be selected, scrolled, or dismissed. Whatever it prints is what the reader gets.

**Root cause:** two renderers, one string, one of them fixed. **Confidence: very high** — read directly from the file for this audit.

**What the fix has to account for, which is not just "import it twice":** `MarkdownView` is loaded via `React.lazy()` (`StrategyTab.tsx:10`) precisely so react-markdown + remark-gfm (~40 KB gz) stay in their own chunk. **A lazy component inside a 280 px bubble that appears mid-flight will suspend**, and there is no fallback designed for that. Either both surfaces share one already-resolved lazy boundary hoisted to `DeckeHost`, or the bubble gets a deliberately smaller inline subset (bold, italic, code, line breaks — which is realistically all a 280 px bubble should render anyway). **The second is probably right, and it is a design decision, not an import.**

**Severity:** major, and it converts a "very small" gap (§5.1) into a small-but-real one.

---

## D11 — Deck-E's canvas paints ABOVE the app chrome, which collides with C29's whole premise

**Code-derived.** The z-order, assembled for this audit because rev 1 never states it in one place:

| Layer | z | Where |
|---|---:|---|
| page content | 0 | `--z-base` |
| **desktop scrim** | **15** | `DeckeChat.tsx:416` |
| **app header + sidebar** | **20** | `--z-chrome` (`theme.css:287`); `AppShell.tsx:271`, `:428` |
| **launcher chip** | **20** | `DeckeButton.tsx:74`, `z-(--z-chrome)` |
| **mobile scrim** | **24** | `DeckeChat.tsx:416` |
| chat panel | 25 | `DeckeChat.tsx:439` |
| minimised travel bar | 25 | `DeckeChat.tsx:386` |
| highlight ring | 25 | `elementHighlight.ts:93` |
| **Deck-E's canvas** | **30** | `DeckeHost.tsx:424` |
| speech bubble | 31 | `DeckeBubble.tsx:117` |
| modal / toast | 100 / 9999 | `theme.css:288-289` |

**The character is above everything except modals**, deliberately — `DeckeHost.tsx:417` says so: *"z-30 keeps him ABOVE the app chrome (`--z-chrome: 20`) on purpose."*

**Three consequences the plan must reckon with:**
1. **C29 asks for the mobile top chrome to be present, sharp and unblurred. It will still have a 3D character painted over it** whenever he is near the top of the screen. Excluding the header from the *scrim* does not exclude it from *him*. Whether that is fine or wrong is a real design question nobody has asked.
2. **D7 is this same mechanism**, not a separate bug. He overlaps the "Install ⬇" pill because the pill is chrome at z-20 and he is at z-30. The fix is not a z-index (raising chrome above him would clip his head) — it is the collision-avoidance R8 §6 asks for as a hard rule, or a keep-out region.
3. **The launcher chip sits at z-20, the same layer as the header** — so on mobile, where the scrim is z-24, **the chip is *underneath* the scrim** while on desktop (scrim z-15) it is *above* it. This is invisible today only because `hidden={chatOpen}` (`DeckeHost.tsx:438`) removes it whenever the scrim exists. **Any change that shows the chip while the chat is open — e.g. a morph-from-chip open transition for C3 — will hit that inconsistency immediately.**

**Severity:** major as a constraint; see §6.11. **Confidence:** very high (read from the files).

---

## D12 — After the C2 fix, mobile has no working warm-on-intent path, so "summon" gets a multi-second dead interval

**Code-derived, and it is the C2 fix's own bill coming due.** Nobody has costed it.

C2's fix is to gate the load behind real intent (`DeckeHost.tsx:166-177`). The intended trigger already exists — `warm()` on `onPointerEnter` (`DeckeButton.tsx:69`), `onTouchStart` (`:70`) and `onFocus` (`:71`) — and `DeckeButton.tsx:12-15` states the contract: *"a cheap 2D stand-in that warms the real runtime on intent — pointer-enter or touch."*

**On desktop that works.** A pointer-enter precedes a click by hundreds of milliseconds to seconds of hover, which is real head start on **7.1 MB** (corrected total, C2).

**On a touch device it does essentially nothing.** `touchstart` precedes the resulting `click` by roughly 100 ms. There is no hover. So the honest sequence on a phone is: **tap → ~100 ms of warm → click → wait for 7.1 MB and a WebGL init → *then* he can scale up from zero and travel in (C3).**

**He named mobile as the platform this matters most on:** *"It's especially annoying on mobile"* [01:17]. **Fixing C2 as stated makes the mobile cold-open worse than it is today**, where he is already there. That is not a reason not to fix it — the current behaviour is a self-inflicted 7.1 MB tax on every visitor and he is right about it — but **shipping the gate without designing the wait is trading one complaint for a different one.**

**What the design has to answer, and this brief cannot:**
- **What is on screen during the load?** The chip is `hidden={chatOpen}` and the canvas is `opacity-0` until `phase === 'ready'` (`:425`). Today that interval does not exist; after the fix it is the first thing a new user sees. **The chat panel could open immediately and he could arrive into it late** — which is also the most graceful reading of *"he should scale up from zero and travel to where he's supposed to be"*, since it makes the travel *cover* the load rather than follow it.
- **Is there a cheaper intent signal on touch than `touchstart`?** Scroll-idle, a first interaction anywhere on the page, `visibilitychange`, `navigator.connection.saveData` / `effectiveType` gating — all plausible, all unmeasured, and **any of them risks re-creating exactly the automatic warm C2 exists to remove.** The line to hold is *"paid for by whoever actually opens it"* (`vite.config.ts:163-166`, §6.9b).
- **How long is it, actually?** **Nobody has measured a cold mobile open.** `TimingReport.timeUntil()` in the new visual harness (§7.6.2) measures precisely this, and the number should exist before the gate ships, not after.

**Severity:** major, and it is a **prerequisite for C2/C3 being an improvement rather than a trade.** **Confidence:** high on the mechanism; **the magnitude is unmeasured and must not be guessed.**

---

## D13 — The chat has no accessibility story, and this pass is about to add a dozen new controls

**Code-derived.** What exists is real but thin, and it is unevenly distributed in a way that is itself the finding.

**What is done:** the panel is `role="dialog" aria-modal="true" aria-label="Chat with Deck-E"` (`DeckeChat.tsx:434-436`); every icon button is labelled (`:384`, `:411`, `:455`, `:659`, `:685`, `:694`); the approval gate is a proper `role="alertdialog"` with `aria-label="Deck-E is asking permission"` (`:598-599`); the canvas is `aria-hidden` (`DeckeHost.tsx:414`, `:422`).

**What is missing, and it is the load-bearing part:**
1. **The transcript is not a live region.** There is no `aria-live` anywhere in `DeckeChat.tsx`. A streamed answer arriving into the panel is announced to nobody. **The minimised speech bubble, by contrast, IS one** — `role="status" aria-live="polite"` at `DeckeBubble.tsx:112-113`. So the *small* surface announces and the *main* surface does not, which is exactly backwards and strongly suggests the panel's case was simply never considered.
2. **A tool chip's actual result exists only in the native `title` attribute** (C15's quoted markup). Rev 1 notes this is invisible on mobile; it is also, in practice, unreliable to assistive technology, and there is no `aria-describedby`, no visible detail and no expansion. **C14's expandable trace and C16's row treatment fix this as a side effect — but only if they are built as real controls with real labels**, which is the point.
3. **`role="dialog" aria-modal="true"` with no focus trap and no restore.** Nothing in the file moves focus into the panel on open, constrains it, or returns it to the launcher on close. `aria-modal="true"` *asserts* to assistive tech that the rest of the page is inert; the scroll lock (`:273-278`) makes that true visually and nothing makes it true for focus.

**Why it is registered now rather than as general debt:** this pass turns eleven static things into controls (chips → buttons, traces → disclosures, a preview → an approval card with per-item selection, a composer pill → a card with a control row). **Each of those is an accessibility obligation created by this work, not inherited by it.** And C60 establishes that "is this pressable?" is the exact question the current UI already fails to answer visually — the same failure, one layer down.

**Severity:** major. Not something he asked for, and not something to skip on that basis.
**Confidence:** very high (grep-verified across all four host files).

---

---

## D14 — His iris is clipped by the rim of the sclera during the thinking state

**Frame-derived, found by the audit's close re-crop of C24's evidence, registered by no source.**

Cropping `t00529.107_preclick` at `560x420+880+1090` and `t00542.791_framechange` at `250x200+940+1090` — the same finding in both:

- The **left** iris is **jammed against the right rim of its sclera and visibly clipped by it**, with a wide white crescent on the opposite side.
- The **right** iris is offset right and low, not clipped.
- **The two eyes do not agree vertically** — left high in the socket, right low.

**Why this is probably a real defect and not just perspective.** `aimPupil` (`look.ts:125-151`) clamps pupil offset to `PUPIL_ROAM = { x: 0.115, z: 0.225 }` (`look.ts:67`) with `GAZE_GAIN = 0.2563` (`:60`). That clamp is what is supposed to stop an iris reaching the rim. **Reaching the rim anyway means either the roam limit is too generous for a head at ~30° yaw, or the clamp is applied in a frame that does not account for the head's rotation** — and a gaze that is camera-anchored (`gazeTarget` at `look.ts:165-178`) plus a body turned 30° away is exactly the configuration that would demand the most extreme pupil offset the clamp allows.

**Two honest caveats:**
1. A turned head means the two eyes are at genuinely different distances and angles from the camera, so *some* apparent asymmetry is correct perspective. The vertical disagreement may be entirely that.
2. This is read off a re-encoded 4K still of a WebGL render. **An iris "clipped by the rim" is exactly the kind of thing macroblocking can fake.**

**How to settle it in five minutes, using tooling that now exists:** `/dev/decke?parity=1` (§7.6's dev routes) drives every state directly with Blender-matched framing, and `?diag=1` renders measurements on screen. Set `thinking`, set `facing`, and look. **Do not fix this from a screenshot.**

**Why it matters for this pass specifically:** C24 changes the thinking gaze. Whatever the new authored `gx`/`gz` beats are, they will push the pupils *further* off-centre, not less — "up and away" is a bigger offset than "slightly up." **If the clamp is already at its limit, C24's fix will make D14 worse.** Check this before authoring the new beats, not after.

**Severity:** minor on its own; **a prerequisite check for C24.** **Confidence: low-to-medium** — a real observation, an unproven cause.

---

## D15 — At narrow desktop widths, the chat panel's header collides with the app's own header

**Frame-derived, registered by no source. It is the desktop-narrow analogue of C47, and it is a separate defect with a separate trigger.**

**Evidence:** `t00715.902_postdrag` (crop `900x1720+120+190`) and `t00758.935_preclick` (crop `900x420+120+300`) — **two frames 43 seconds apart, so not a transition artifact.** When the Deck-E panel flips to its full-screen (`inset-0`) treatment at narrow width, its header bar is **translucent and blurred rather than opaque**, so the page's own chrome shows straight through it:

- The **DeckPal logo and "DeckPal" wordmark sit immediately to the right of the "Deck-E" title** — two application titles in one row.
- **Two of the page's own toolbar buttons** show through next to the panel's ✕.

**Root cause — same one as C30's dead band, seen from the top instead of the bottom.** `DeckeChat.tsx:28-32`, restated at `:420-432`: *"The phone panel has no background of its own… painting `surface-primary` over the top of that threw the blur away."* The header inherits that: `border-b border-border-default` is applied **only when `desktop`** (`:456`), so at narrow widths the header row is transparent glass over a live, sharp, unblurred app header — because the app header is at `--z-chrome: 20` and the *mobile* scrim is z-24 but the *panel* is z-25, so the header shows through the panel while the page behind it is scrimmed.

**Why it is worth its own number rather than folding into C47:**
1. **It reproduces on desktop Chrome**, with no phone, no PWA and no safe-area insets — so it is verifiable in the visual harness *today*, signed-out, on the landing page's own breakpoint. **It is the cheapest of the whole mobile family to prove and to regression-check.**
2. **C29 and §6.3 will change exactly this surface**, and the "keep the top chrome sharp and present" fix makes this *more* visible, not less — a sharp, prominent app header behind a transparent panel header is precisely two titles in one row.
3. It is direct evidence that the glass-panel decision (§6.3) has a cost the decision's own text does not mention: **glass means everything behind shows through, including chrome that was never meant to be a backdrop.**

**Severity:** major. **Confidence:** very high (two frames, clear crop, and the mechanism is quoted from the file).

---

## D16 — Catalog/asset defects visible in the frames, OUT OF SCOPE for this pass

**Registered so they are not lost, and explicitly fenced off.** These are DeckPal defects, not Deck-E defects. Nothing he said touches them. **Do not do this work in this pass** — but they are real and they are in the evidence, so filing them is cheaper than rediscovering them.

**(a) Set logos missing, with a fallback that fails contrast.** `t00848.605_preclick` (crop `1800x700+960+780`), also `t00795.460_framechange` (crop `1000x300+1900+1120`). On the Mega Evolution set list, six of eight sets show real logos; **"MEP Black Star Promos"** and **"Mega Evolution Energy"** show only grey placeholder text in the logo slot. **The fallback is grey-on-dark-grey — visibly the lowest-contrast text on the page.** That is both a sourcing gap and an accessibility failure, and the second is the more serious one because it affects the fallback path for *every* future missing logo, not these two.

**(b) A series card with an empty logo slot and no fallback at all.** `t00108.000_preclick` (crop `700x340+700+960`; compare siblings with `1900x780+700+560`). The **"Miscellaneous"** series card has ~90 px of dead space where its four row-mates carry a logo — **not even the grey text fallback from (a).** So there are two different missing-asset paths and one of them renders nothing.

**(c) A count that reads as wrong.** Same card: **"Miscellaneous — SETS 2, CARDS 1 — 100%"**. Two sets containing one card in total, marked fully complete. **May be legitimate data**, but it renders as a bug and warrants one query to confirm.

**Severity:** out of scope. **(a)'s contrast problem is the one worth carrying forward**, because it is a design-system fallback, not a data gap. **Confidence:** high on the observations; the cause of each is unexamined.

---

**Total unreported defects: 16** (D1–D16). Rev 1 registered 9; rev 2 added seven — D10–D13 **code-derived**, D14–D16 **frame-derived** (this section's scope is widened accordingly, and each entry says which it is). Of the sixteen: **12 are genuine, actionable and in scope** (D1, D2, D3, D4, D6, D7, D8, D10, D11, D12, D13, D15), **1 is a prerequisite check rather than a fix** (D14), **1 is a real gap rather than a defect** (D5), **1 is out of scope** (D16), and **1 is dismissed** (D9).

---

# Part 4 — The reference UIs, specified

## 4a. Claude — the layout, spacing, fade and composer reference

He points at Claude twice: the **web** app on desktop (t=2:11–3:36, for full-screen layout) and the **iOS** app on the phone (t=22:17–23:10, then again 24:04–24:44, for composer anatomy, fade and spacing).

### 4a.1 Claude web (claude.ai) — what he pointed at and why

**Frames:** `t00147.483_preclick` (Home), `t00156.191_preclick` (conversation), `t00364.318_preclick`, `t01224.063_framechange`.

**Home / empty state** (`t00147.483_preclick`):
- Sun icon + **"Good afternoon, Chey"** centred heading.
- Below it, a **rounded chat-input box**, centred, placeholder **"Type / for skills"**.
- A `+` attach icon at the left.
- **"Chat" / "Cowork"** toggle pills.
- On the right of the input row: model selector **"Opus 5  High ˅"**, a mic icon, an audio-waveform icon.
- Left sidebar expanded: Home, Code, New, Projects, Artifacts, Scheduled, Customize; a Projects section; a long "Chats and tasks" history list; bottom-left user chip "Chey · Max".

**Conversation state** (`t00156.191_preclick`) — the transition he describes at [02:22]:
- User message right-aligned; Claude's reply left-aligned as **plain paragraph text with no bubble**.
- **The composer has moved to the bottom of the viewport, horizontally centred in a constrained max-width column** — roughly 420 px in a 1400 px-wide capture, i.e. **well short of full width. A centred column, not edge-to-edge.** This is the precise geometric fact behind *"it goes down to the bottom… it's centered in here."*
- Placeholder becomes **"Write a message…"**; model selector "Opus 5 High", mic and waveform persist.
- Above the composer, a system notice bar: *"You've used 75% of your weekly limit"* with a "Get more usage" link and a dismiss ×.
- Footer below the composer: *"Claude is AI and can make mistakes. Please double-check responses."*

**What it is a precedent for, and what it is not:** layout only. As the range1 scribe flags explicitly, Claude has no background page to darken — it is a dedicated full-page app — so **it is not a precedent for the scrim/blur treatment**, which is C7's separate concern.

### 4a.2 Claude iOS — full composer anatomy

**Frames:** `t01342.977_framechange`, `t01343.483_framechange` (the clean anatomy frame), `t01346.804_framechange`, `t01360.202_framechange` (the fade proof), `t01390.527_framechange`, `t01467.795_preclick`, `t01476.101_preclick`.

**Context:** he is inside a real coding-agent session titled *"Supabase migration setup and RLS c…"* in a project tagged **"deckpal"** — the reference is Claude's *agent* UI, not its plain chat UI. That matters for C20/C36, because what he is holding up is an alternating structure of prose and action rows.

**Layered structure, bottom of screen, back to front:**

1. **Scrollable transcript.** Plain-text agent status lines: a bold statement followed by a light-gray collapsible row with a `›` chevron. No chat-bubble borders — left-aligned text blocks with generous line-height and paragraph spacing. Some rows prefixed with a small orange/yellow **⚠** warning triangle. Verbatim examples captured: *"Ran Verify the signature wire shape ›"*, *"Ran 2 commands ›"*, *"Ran 22 commands ›"*, *"Ran an agent, ran 10 commands, used 2 tools ›"*, *"⚠ Ran 9 commands ›"*, *"⚠ Background shell failed  Add and run the trans… ›"*, *"Background shell stopped  Check gate runner usa… ›"*, *"Used TaskOutput ›"*. A circular **jump-to-latest** button (downward arrow in an outlined circle) floats above-right of the composer stack when scrolled up.
2. **A transient status card**, sitting **directly above the composer with a visible gap and its own corner radius** — alternating between *"⟳ Connecting"* (spinner + text) and a two-line **"Approaching limit" / "Resets at 6:00 pm"** (bold white over gray).
3. **The composer card proper** — one continuous rounded rectangle (radius visibly larger than the banner above it, ~24–28 px), containing:
   - **Top:** plain gray placeholder text (*"Add feedback…"* in this session) on its own line, left-aligned, **with no visible input-field border inside the card — the whole card is the field.**
   - **Bottom control row**, evenly spaced, all vertically centred, left to right:
     - circular **`+`** attach button (plain, gray fill)
     - **"Opus 5"** — dark-filled pill, bold white text, no icon (model selector)
     - **"⚡ Auto"** — lighter/outlined pill, white lightning-bolt icon + text (mode/effort selector)
     - *(gap)*
     - circular **mic** button
     - circular **send** button, filled in a muted rust/brick-orange with a white **up-arrow** glyph — the warm muted tone reading as "ready but input empty"
4. **Header, for contrast with DeckPal:** back chevron `‹`, bold title, a small branch/fork icon (transient), and a `•••` overflow menu — **in its own row, clearly separated from the iOS status bar above it**, unlike DeckPal's collision (C47).

**The fade — his specific praise, proven in one frame.** `t01360.202_framechange` shows both edges at once:
- **Bottom:** a line of conversation text — *"red if the bug comes back?"* — is visible **but dimmed and partially obscured** exactly where it passes behind the composer card. Content scrolls *behind* the composer under a gradient rather than being hard-clipped above it.
- **Top:** the topmost visible line (*"Now moving the narration transform into the"*) is rendered **noticeably dimmer/grayer than the crisp white text just below it** — a top fade mask under the sticky header.

This is the direct evidence for *"it starts to fade a little bit above the text input, and it's quite faded down here."*

**Bottom spacing — and an honest limitation.**
`t01343.483_framechange` (range6) shows *"a solid white horizontal home-indicator bar… with clear, generous breathing room between the composer's bottom edge and the indicator."* That is the frame that captures it.

**But** range7's scribe records explicitly that in **every** frame in its range (`t01467.795_preclick`, `t01476.101_preclick`), **the LetsView phone-mirror window's own edge and toolbar cut the view off at or just below the composer's control row — so the true amount of empty space between the composer and the iOS home indicator could not be measured from those stills.** Range7 also could not resolve a distinct fade gradient at its crop/compression level, and says so.

**Therefore: "the right amount of spacing" is a qualitative target in this brief, not a measured value.** If the plan wants a number, someone must take a fresh, un-cropped screenshot of Claude iOS. Flagged in Part 9, Q8.

**What he wants taken and what he wants left** (C52): the structure (rounded card, text line above a control row, one continuous container, generous internal padding) and the behaviour (fade, spacing) — **minus** the "Opus 5" and "⚡ Auto" pills, which he rejects by name. Plus, tentatively, the `+` and photo attach.

---

## 4b. beautifului.dev — component catalogue

> **FOLDED IN, 2026-08-22 (audit pass).** `R6-beautiful-ui.md` has arrived and its content is integrated below. §4b is now built from **two independent sources**: what the frame scribes could read off the screen (ranges 2, 4, 5, 6, 7) and R6's **byte-exact recovery of all twenty components' real `.tsx` source**, pulled out of the site's Next.js RSC "flight" payload with a purpose-written parser and saved at `scratchpad/deck-e-pass/research/src/<ComponentName>.tsx`. Where the two disagree, **the source wins and the disagreement is stated rather than smoothed over** (see §4b.3d). Every timing, easing curve, colour token and microcopy string quoted below without a "seen on screen" qualifier is read from that source or from the site's compiled CSS (`research/css1.css`, `css2.css`), not estimated from a screenshot.
>
> **One place R6 must NOT be taken as superseding:** R6 §3 states that DeckPal's tool chips "already stream progressively via SSE… not all at once," offered as a correction to its own task framing. That is true of the *transport* and false of the *observation*. C18's root cause is not that the transport batches them; it is that **parallel tool use fires several `phase:'start'` events inside a single model step**, so a progressively-streamed chip feed still lands three chips in one instant — which is what `t00396.242_framechange` shows and what `wire.test.ts:188-212` pins. Keep C18 as written. R6's genuinely new contribution on this component is narrower and is recorded in §4b.3 under **05 Tool Chips**: DeckPal's chips are *inert once resolved*, and the click-to-expand-a-resolved-row interaction is the thing worth taking.

### 4b.0 The site itself

- **URL:** `https://beautifului.dev` — confirmed by R6's own `curl` fetch of the live site (595,499 bytes of HTML saved at `research/bui_raw.html`). *Note a source discrepancy:* at `t01174.082_preclick` the scribe read the status bar as `https://www.beautifui.dev/#fine-tune-card`, one `l` short. **The scribe misread a 4K screenshot; the fetched domain is authoritative.** The anchor half of that reading is right and useful — the left-rail entries genuinely are same-page `#slug` anchors.
- **Hero copy, verbatim from the page:** *"A small library of extremely crafted, copy-paste components for chat agents, thinking states, human-in-the-loop approvals, and everything agents need."* (Google's index card said "chat apps"; the page says "chat agents".) Preview tags in the search result: **Loading State / Thinking / Streaming Text / Approval Card** (`t00281.542_framechange`).
- **Built by:** a product-design studio called **Turbo** (`turbodesign.co`); the individual author is **Shane Levine**, confirmed from the MIT copyright line and the `cal.com/shane-levine-7bnfdw` booking link. Sidebar footer: *"Built by Turbo ←" / "Product design studio" / "Get expert product design for your business." / "Book a call →"*.
- **Structure:** left rail with the site logo (a blue interlocking-loop mark + a "UI" chip) and a light/dark toggle, the heading *"Beautiful UI for AI-native interfaces."*, and a numbered component index; main column of numbered demo cards.
- **Theme — correcting an impression the screenshots create.** Every frame in this capture shows the site **dark**, because the owner had the toggle set that way. The site is **not dark-only**: it ships both, switched by an explicit `.dark` class on the root (not by `prefers-color-scheme` alone), with the same OKLCH custom properties redefined per scheme. This matters because Part 6's "Also checked, and NOT in conflict" list currently reasons *"beautifului.dev is dark-themed; nothing he asked for needs a light theme."* The conclusion still holds — DeckPal is dark-only by decision and adopting these patterns does not require a light theme — but the premise as stated is wrong, and an implementer copying a component will find both palettes in it and must map to DeckPal's own semantic roles rather than carrying `--ink`/`--surface` across.
- **Every demo card** sits in the same dark rounded container (~28 px radius by eye) on a black page background, with the numbered index + bold title + a one-line gray description printed above it, and a small **copy** icon and a **`</>`** view-code icon in its top-right corner.
- **Demo content** is a fictional ice-cream/creamery business ("Ice Cream Harness", per the footer) — placeholder copy, nothing DeckPal-specific.
- **Footer:** *"New components, in your inbox."* signup block; copyright bar *"© 2026 Beautiful UI · Ice Cream Harness · MIT License"*.
- **Demos auto-animate on a loop** while idle — the Loading State counter ticks, Streaming Text replays its typewriter reveal, the Thinking header cycles labels, the Prompt Bar cycles its three popovers. This is why frame-diffs fired with no scrolling.

**Full component index, 20 entries, in the site's own order** (range5 saw all 20; range7 could read 18 in its narrower window):

`01 Loading State · 02 Thinking · 03 Streaming Text · 04 Approval Card · 05 Tool Chips · 06 Task Rows · 07 Chat · 08 Prompt Bar · 09 Recommendation Card · 10 Context Cards · 11 Diff Table · 12 Records Table · 13 Filter Table · 14 Sidebar Nav · 15 Search · 16 Flowchart · 17 Insight Cards · 18 Code Block · 19 Fine-tune Card · 20 Selection Actions`

---

### 4b.0.1 Licence, provenance, and what "copy-paste" actually means

**This subsection is entirely new from R6 and it is the part that decides whether any of the rest is usable.**

**Licence: MIT.** The `/license` page (saved at `research/license.html`) says plainly *"Yes, you can use it for free,"* over the standard MIT License text, `Copyright (c) 2026 Shane Levine`. There is **no per-component attribution requirement** — MIT's condition is to retain the licence notice if you redistribute the licence text itself, which copying a component's markup into DeckPal does not trigger. No paid tier, no account, no gated download exists anywhere in the site's HTML, CSS or eleven JS bundles. **Adoption is legally clear.** Record the provenance in a DECISIONS entry anyway, because "where did this component come from" is a question a future reader will ask.

**There is no repo and no npm package.** R6 checked exhaustively: no `github.com` and no `npmjs` link appears anywhere in the page HTML or its bundles. Each showcase panel has hover-revealed **"Copy code"** and **"View code"** buttons; "View code" opens a modal showing the file's real source. That source is not fetched from anywhere — it is **inlined at render time into the page's Next.js React-Server-Components "flight" stream** (`self.__next_f.push(...)`). R6 wrote a byte-exact parser for that protocol (`research/extract_flight.js`, `research/parse_flight.js`) and pulled all twenty files out losslessly; it verified self-consistency by checking that every computed chunk boundary lands exactly on the next chunk's header, with zero drift, for all twenty. **The files at `research/src/*.tsx` are literally what the site's own "Copy code" button would put on your clipboard.** Read those, not this summary, when actually implementing.

**Consequence for the plan: there is nothing to install and nothing to track.** Adoption is copying a pattern into hand-written Tailwind, which is exactly how both codebases already work — DeckPal has no shadcn, no MUI, no chat/UI component library at all.

**Four of the twenty will not compile as copied**, because they import from Turbo's own unpublished internal design system. Ranked by how many priority components need them:

| Internal import | Needed by | What it is | Rebuild cost |
|---|---|---|---|
| `@/components/primitives/GlideMenu` | **Search**, **Fine-tune Card**, **Sidebar Nav**, **Records Table** | one absolutely-positioned highlight `<span>` that glides between rows via `top`/`height` transitions, driven off each row's `offsetTop`/`offsetHeight` held in a ref array | ~half a day, and it pays for itself — **Prompt Bar and Flowchart implement the same pattern inline in their own files**, so a correct reference implementation is already in hand |
| `@/components/atoms/Button` | **Recommendation Card**, **Diff Table** | a variant button; the union includes at least `accent \| primary \| secondary \| success`, **inferred from call sites, not read** | half a day — but check first whether DeckPal already has an equivalent |
| `@/components/atoms/Shimmer` | **Selection Actions** | componentised wrapper around the same `shimmer-text` gradient sweep used inline elsewhere | ~10 lines |
| `@/components/atoms/StreamText` | **Selection Actions** | word-by-word reveal with an `onProgress` callback (used there to keep a floating toolbar positioned as text reflows) | moderate; **build one shared primitive and use it in Streaming Text too**, rather than two reimplementations |

**Two components carry a real external npm dependency, and R6's recommendation on both is: don't.**
- **`glimm` v0.3.0** — WebGL sweep transitions. Used **only** by Prompt Bar, for a rainbow celebration when the flagship model is selected. Pre-1.0, single-purpose. DeckPal is dropping the model picker anyway (C52), so this is moot — and if Deck-E ever wants a "nice choice" flourish, **he is a 3D character; get it from him and add zero dependencies.**
- **`liveline` v0.0.7** — real-time animated charts. Used **only** by Insight Cards. Pre-0.1, single external maintainer. Reuse whatever chart library DeckPal already has, and lift only the **Catmull-Rom spline resampler (`smooth()`)**, which is small, self-contained and genuinely good — it turns eight sparse points into a dense curve so both the line and the hover cursor glide instead of stepping.

Two further incidental imports, both trivially droppable: `posthog-js` in **Chat** (the demo site's own analytics — `posthog.capture("chat_composer_prompt_sent")`; do not carry it) and `iconoir-react` + `@central-icons-react/round-outlined-radius-2-stroke-2` in **Selection Actions** / **Sidebar Nav** (swap for whatever icon set DeckPal already standardises on; do not add a fifth).

### 4b.0.2 The shared design system — the most transferable thing on the site

Every component is a Next.js **client component** (`"use client"`), TypeScript, functional/hooks-only, styled with Tailwind-style utilities (arbitrary-value bracket syntax used constantly) over a token layer. **The tokens and the animation vocabulary are more valuable to DeckPal than any single component**, because they are what makes twenty separately-authored demos read as one system — and "read as one system" is precisely what the owner is asking for.

**Colour tokens are CSS custom properties in OKLCH:** `--ink`, `--ink-2`, `--ink-3`, `--surface`, `--canvas`, `--page`, `--inset`, `--hover`, `--hover-2`, `--line`, `--line-strong`, `--accent`, `--accent-ink`, `--accent-tint`, `--green`, `--red`, `--orange`. Shadows: `--shadow-hairline`, `--shadow-btn`, `--shadow-card`, `--shadow-raised`, `--shadow-overlay`. Radii: `--radius-card: 10px`, `--radius-control: 8px`, `--radius-chip: 6px` — though **most components override radius with a literal per-component value rather than the token**, which is worth knowing before treating the radius scale as normative. DeckPal's equivalent layer is `theme.css`'s `@theme static` block, ~77 flat semantic colour roles, dark-only "deckpalDark". **Map by role, do not import the palette.**

**One genuinely clever trick worth stealing outright** (Records Table, Filter Table): a status/tag chip has **one base OKLCH hue**, and its background, text and border are all derived from that single hue via `color-mix()` against the current surface. So a tag adapts to the theme with no per-theme tag palette. DeckPal has a `TONE` map (`neutral|good|warn|bad`) in `DeckeScreen.tsx:51-56` that currently hard-maps to two roles; this technique generalises it.

**The shared animation vocabulary, read from the compiled CSS:**

| Name | Timing | What it does | Where it's used |
|---|---|---|---|
| `fade-up` | 400–600 ms `cubic-bezier(0.23,1,0.32,1)` | enters 8 px low, fades and slides up | **the single most common entrance on the site** — rows, cards, sections, everything |
| `pop-in` | 140–260 ms, same curve | `scale(0.95→1)` + fade | menus, badges, chips |
| `fade-in` / `fade-out` | — | plain opacity, no transform | crossfades |
| `shimmer-text` | 1.4 s linear infinite | moving-gradient text fill, `background-position 150% → -50%` | every "Thinking…" / "Churning" / "Adjust" busy label |
| `spin` | 700 ms–1.2 s linear | `rotate(1turn)` | loading rings |
| `pixel-on` | keyframed opacity `0%/100% → 0.15`, `18%/42% → 1` | drives the Loading State pixel wavefront | 01 |
| `eq-bounce` | — | `scaleY(0.35 ↔ 1)` | Prompt Bar's dictation equaliser bars |
| **the grid-rows accordion** | 300 ms `cubic-bezier(0.23,1,0.32,1)` | `grid-template-rows: 0fr → 1fr` + `opacity 0→1` inside an `overflow-hidden` wrapper | **Thinking, Task Rows, Filter Table, Diff Table, Tool Chips, Recommendation Card's drawer — one expand/collapse mechanism for the whole library** |

Two components deliberately break the standard curve, and both give their reason: Recommendation Card's drawer uses `cubic-bezier(0.16,1,0.3,1)` (softer, more "settling," for content that grows), and Selection Actions' floating pill uses `cubic-bezier(0.77,0,0.175,1)` at 320 ms (aggressive ease-in/out, because the bar must *catch up* to a reflowing selection rather than settle from a static spawn).

**`prefers-reduced-motion` is handled site-wide**, with a blanket rule collapsing `animation-duration`/`transition-duration` to `0.01ms` and iteration count to 1, plus a couple of component-level JS checks (Prompt Bar's celebration no-ops under reduce). **DeckPal has the same convention already and this pass must honour it — see the new §7.9.**

**Fonts:** Inter for UI; **JetBrains Mono** and **Geist Mono** both appear for monospace/tabular figures in different components. The tabular-figure habit is worth copying for any elapsed-time or count readout, so digits do not jitter as they tick.

**`/harness` is a live dogfood app.** The site hosts a working chat shell ("Creamery Ops", saved at `research/harness.html`) composing Sidebar Nav + Chat + Prompt Bar. Useful as a reference for how these components sit together, which no single demo card shows.

### 4b.1 Prompt Bar (08) — MAXIMUM DETAIL

**Printed description:** *"Composer with @ sources, / commands, model picker, and dictation."*
**Frames:** `t01415.003_framechange`, `t01424.838_framechange`, `t01436.023_framechange` (cleanest — Prompt Bar and Recommendation Card together), `t01449.228_preclick`, `t01455.894_framechange`, `t01093.524`, `t01155.636_framechange`, `t01494.492_framechange`.

**Outer container:** a large dark rounded card, radius ~16–20 px in its default "Rounded" state, generous internal padding, with its own subtle border/shadow separating it from the page background.

**Variant toggle** — a small pill-shaped 2-option segmented control sits **below and outside** the card: **"Rounded | Pill"**. "Rounded" is selected in every observed frame; "Pill" was never seen selected.

**State 1 — `+` attach / sources menu open.** A darker, slightly inset rounded popover sits inside the top of the outer card, holding a vertical list. Each row is `[icon] **Bold item name** — light-gray description`, left-aligned, single-line, ~40–48 px per row at 4K scale, **no dividers between rows** except before the final search field. Rows, in order:

| Icon | Name | Description | Right-aligned affordance |
|---|---|---|---|
| 📎 paperclip | **Add photos & files** | Upload from your computer | — |
| 📊 bar-chart | **Scoop Data** | Sales & churn metrics | — |
| 📚 stacked-layers | **Flavor records** | 26 makers, tags, links | — |
| 🌐 globe | **Web search** | Real-time news and info | — |
| Figma logo (colour) | **Figma** | Design-to-code workflows | — |
| Slack logo (colour) | **Slack** | Read and manage Slack | — |
| Gmail logo (colour) | **Gmail** | Read and manage Gmail | **Connect** (blue text link) |

Then a thin divider, then a placeholder row: **"Type to search sources & files"** (gray, no icon).

Note the icon grammar: **simple line icons for generic/first-party sources, real colour brand marks for third-party connectors**, and the only right-aligned affordance in the whole list is on the one source that is not connected yet.

**State 2 — collapsed / plain composer** (`t01449.228_preclick`): the popover is gone; the card is just the bottom bar with placeholder **"Write a message…"** to the left of the `+`, and the same right-side cluster.

**State 3 — `/` slash-command menu** (`t01455.894_framechange`, `t01093.524`): the same popover shape and position as State 1, but rows are command tokens with one-line descriptions:

| Command | Description |
|---|---|
| **/compare** | Flavor vs. last summer |
| **/churn-plan** | Draft a churn schedule |
| **/restock** | Build a reorder list |
| **/draft-email** | Write a supplier email |
| **/summarize** | Digest the thread so far |

Footer placeholder: **"Type to search commands"**. The bottom bar's left glyph changes from `@` to `/`.

**Honest limitation:** in *every* frame where the slash menu appears in range7, the LetsView phone-mirror window sits directly on top of its right two-thirds, so the **full command descriptions could not be read there** — the table above is reconstructed from range6's `t01415.003_framechange` and range5's `t01093.524`, where the same menu was unoccluded.

**Bottom control bar** (pill / rounded-rect, full width of the card): left-aligned circular **`+`** icon button, then the context glyph (**`@`** in State 1, **`/`** in State 3); right-aligned, in order: **"Vanilla 1 ⌄"** (model/preset selector — plain text plus chevron, **no pill background**), a **microphone** glyph, and a **circular send button** with a white **up-arrow** on a dark/muted fill, appearing at disabled visual weight when the field is empty.

#### From the source (`research/src/PromptBar.tsx`, 30,976 bytes — the largest single-purpose file in the library)

**The layout is a grid, and it reflows.** The control row is `[+ attach] [textarea] [model pill] [mic] [send]`. When the draft wraps or gets long, the component **promotes itself to a two-row layout** — textarea on its own full-width row above, the four controls dropping to a second row — driven by a `wide` state computed by **measuring the text against a hidden mirror `<span>`**. Attachment chips, when present, appear as a wrapped row above the input, each a pill with file icon, truncated filename and a remove `×`.

> **This measurement technique is the single most valuable thing in the component for DeckPal**, and it is pure React/CSS with zero dependencies. DeckPal's composer is a fixed `h-[40px]` single-line `<input>` (`DeckeChat.tsx:660`); a chat composer that grows gracefully is most of what "I don't love the design of the input at all" (C51) is actually asking for.

**Variants, both real** (the toggle he saw is functional, not decorative):
- **Rounded** — 14 px card radius, the default and the only state observed in any frame.
- **Pill** — `rounded-full`, **but it breaks to a 24 px radius the moment attachments or the wide layout appear**, because a true pill cannot hold wrapped content gracefully. That caveat is in the className logic itself and is worth knowing before anyone picks "pill" for DeckPal on aesthetics.
- A third, non-toggle **`tall`** prop also exists — hero sizing, bigger padding, multi-line-first, 16 px controls — for a landing-page composer rather than an in-panel one. **`tall` is plausibly the right variant for C6's centred empty state, with the default for the post-send bottom-docked state.** Nobody has evaluated that; flagging it as a lead.

**The autoplay is a demo behaviour and must be turned off.** `demo` defaults to **`true`** and walks the whole tour on a loop: `@` → pick a source → `/` → pick a command → open the model menu → select the flagship → fire the celebration. It hands control to the real user the instant they click or type anywhere in the composer (`takeOver` on capture-phase `pointerdown`/`keydown`). **For any production embedding, pass `demo={false}`.** This is also the explanation for the brief's own §4b.0 observation that "demos auto-animate on a loop while idle" and why frame-diffs fired with no scrolling — it is not a rendering artifact, it is a scripted tour.

**The model picker's real options** are *"Sprinkles 5 · Flagship"*, *"Vanilla 1 · Basic"*, *"Freezer Burn 0.4 · Stale"* — the `Vanilla 1 ⌄` the scribe read off screen is the selected one. Copy is deliberately silly; the reusable mechanic is the tag-plus-checkmark row. **He rejects this control outright (C52), so this is documented only so nobody rebuilds it by reflex.**

**Dictation:** clicking the mic swaps its icon for a three-bar audio-level equaliser (`eq-bounce`, `scaleY(0.35↔1)`), the placeholder becomes *"Listening…"*, and after a fixed 2200 ms it "transcribes" by appending a canned sentence and refocusing. **It is a mock. There is no speech API behind it.** Anyone reading the demo as evidence that dictation is a cheap add is reading it wrong.

**The `@`/`/` menus share one shell**, and the interaction worth taking is the **single gliding highlight pill** that animates between rows on hover and arrow-key navigation — `top`/`height` over 220 ms, opacity 150 ms — rather than each row toggling its own background. **Prompt Bar implements this inline in its own file** (it does not import `GlideMenu`), so a working reference is in hand at `research/src/PromptBar.tsx` even though the shared primitive is unpublished. Menus enter with `pop-in 180ms`; attachment chips with `pop-in 200ms`.

**The rainbow sweep, for completeness:** a `<canvas>` WebGL shader via `glimm`'s `createShader`/`playSweep`, invisible at rest, playing a 570 ms left-to-right rainbow band across the composer's interior when the flagship model is selected (`sweepMs: 570`, `outroMs: 80`, `easeOutExpo`), gated behind `prefers-reduced-motion`. **Skip it** — see §4b.0.1. If Deck-E ever wants a moment of delight, he is a 3D character; get it from him for free.

**Why this matters for DeckPal:** he named this component by name as the thing to steal (C51), then immediately scoped most of it out (C52) — keeping the **card shape, the control-row layout, and the `+`**, dropping the model picker, and treating `@` / `/` / connectors as out of scope for now.

**So what is actually left to take, ranked:** (1) the **hidden-mirror wrap measurement and two-row reflow** — the real upgrade; (2) the **card-as-field treatment** (no inner input border; the whole card is the field), which is also Claude iOS's answer and therefore satisfies C50 and C51 with one decision; (3) the **glide-highlight menu**, held in reserve for whenever `@`-mentioning a card name stops being out of scope; (4) the **empty-vs-has-content send button weight**. Everything else on the list is either rejected by name or a mock.

### 4b.2 Recommendation Card (09) — MAXIMUM DETAIL

**Printed description:** *"Agent suggestion with a confidence meter and actions."*
**Frames:** `t01094.546_framechange` (the ~28-second static hold while he talks over it), `t01126.202`, `t01154.603`, `t01436.023_framechange` (cleanest), `t01415.003_framechange`, `t01494.492` / `t01494.997_framechange`.

**Container:** a single card, rounded corners, dark fill, padding ~24–32 px at 4K scale.

**Header:** bold white text, larger than body — **"Want me to place this restock order?"**
A yes/no-shaped question, phrased as the agent asking permission. This is the exact sentence shape he transposes into *"want me to put these cards in."*

**Body line:** gray prose with two inline objects embedded in the sentence:
> *"Reorder waffle cones from* **[circular avatar, "BR"/"CK" monogram, pink/white] Cone King** *with lead time* **[7 days]**

Two reusable patterns, and they are different from each other:
- **An entity chip** — a small circular logo avatar immediately followed by the bold entity name, forming a compound token **inline in running prose**. This is the piece that maps to *"card thumbnail + card name + variant, inline in a sentence."*
- **A data pill** — `7 days`, a pill with a green outline/tint and green bold text, for a parameter value.

**Footer row**, space-between layout:
- **Left:** a confidence meter — **three short vertical bars** (▮▮▮, green, rising) followed by the label **"High confidence"** in gray text. Verified as **plain selectable text**, not a tooltip: he drag-selects those exact words at `t01124.061_preclick` → `t01124.706_postdrag` → `t01125.093_preclick`.
- **Right:** two buttons — **"Alternatives"** (outlined/ghost, white text, dark transparent fill, rounded-rect) and **"Accept"** (solid saturated blue ≈`#3B82F6`, white bold text, rounded-rect). **Accept is visually heavier and more prominent than Alternatives.**

**Note on "Alternatives":** this is a third option beyond accept/reject, and it maps cleanly onto R8 §4's PAIR **N-best disambiguation** recommendation — offer the top 2–3 named candidates rather than one forced guess.

#### From the source (`research/src/RecommendationCard.tsx`, 6,684 bytes) — and it is richer than the frames could show

The file's own header states the design intent, and it is the sentence to build against:

> *"The card holds its shape. Pressing 'Alternatives' opens a new drawer listing the other options; picking one promotes it to the recommendation. The primary action confirms."*

**There are three confidence tiers, and the tier drives the CTA — not just a label.** The `Option` type carries `{ key, body, short, signal, tone, label, cta, ctaVariant }`, and the three shipped options are, verbatim:

| key | signal | tone | label | CTA | variant |
|---|---:|---|---|---|---|
| `high` | **3** | `var(--green)` | **"High confidence"** | **"Accept"** | `accent` |
| `review` | **2** | `var(--orange)` | **"Needs review"** | **"Configure"** | `primary` |
| `none` | **0** | `var(--ink-3)` | **"No signal"** | **"Accept full restock"** | `primary` |

**This is the most reusable idea in the component and it is the answer to Part 9's Q7.** The confidence signal is not decoration beside a fixed button — **it changes what the button says and how heavy it looks.** High confidence gets a one-word accept in the accent colour; low confidence gets a *"Configure"* that routes to a review step instead of a commit; no signal gets a button whose label spells out the whole blunt consequence (*"Accept full restock"*) so that pressing it cannot feel like a small act. **That is exactly R8 §4's "coarse and behaviour-linked" recommendation, already implemented** — and it is a materially better answer than a three-bar meter beside an unchanging "Accept". Note also `signal` is `0 | 2 | 3` on a three-bar meter — **there is no bare percentage anywhere**, which is R8's other recommendation.

**The `Meter` is nine lines and worth quoting**, because it shows how cheap this is:
```tsx
function Meter({ signal, tone }: { signal: number; tone: string }) {
  return (
    <span className="flex items-end gap-0.5">
      {[0, 1, 2].map((bar) => (
        <span key={bar} className="w-1 rounded-full transition-colors duration-300"
          style={{ height: 10, background: bar < signal ? tone : 'var(--line-strong)' }} />
      ))}
    </span>
  )
}
```
Three 1×10 px bars, filled or not, `transition-colors` so a changing verdict animates. **The bars are equal height** — the "rising" appearance the scribe read off the screen is the *fill*, not the geometry.

**The two inline-chip primitives, and they are deliberately different from each other.** This is the piece that maps onto *"card thumbnail + card name + variant, inline in a sentence"*:
- **`VendorChip`** — a circular `<img>` in a white-filled circle with a hairline outline (`outline outline-1 -outline-offset-1 outline-black/10`), immediately followed by the name at `12px font-medium`, the pair wrapped in a `rounded-full bg-field` pill with `shadow-hairline` and `align-middle` so it sits on the text baseline. **An entity: image + identity.**
- **`Pill`** — no image, `rounded-full` at `12px font-medium`, two tones: `neutral` (`bg-field text-ink-2`, hairline shadow) and `green` (`bg-green-tint text-green`, with a `color-mix(in oklch, var(--green) 28%, transparent)` ring). **A value: a parameter, tinted when confirmed.**

**The DeckPal translation is direct:** *"Add **[art] Charizard ex** · **Holo** · **×4** at **$12.50**"* — `VendorChip` becomes card-art-plus-name, `Pill` becomes variant and quantity and price. Both are ~15 lines. **And `CardImage` already exists** (§5.6) with the right aspect ratio reserved and a skeleton-not-broken-glyph error path, so the thumbnail half is already solved.

**States the frames could not show:**
- **Selecting an alternative *promotes* it.** It does not tick a radio inside the drawer — the header body re-renders as the new recommendation with a `fade-in 180ms` cross-fade, and the meter, label and CTA all change with it. The card never grows or reorders unexpectedly; the drawer is the only thing that moves.
- **The drawer is the shared grid-rows accordion**, but at `cubic-bezier(0.16,1,0.3,1)` rather than the site's usual curve — softer, more settling, chosen deliberately for content that grows.
- **Each drawer row carries its own `Meter`**, a truncated one-line `short` summary, and its own confidence label. So the alternatives are *comparable*, not just listed.
- **Accepting is terminal.** `accepted` swaps the CTA for a static success-styled "Accepted" with no further interaction. **There is no undo in this component.** DeckPal must not copy that: `mutation_history` and a revert offer already exist and gate 9 asserts *"revert offered."*

**One dependency note:** this component imports the unpublished `@/components/atoms/Button` with `ButtonVariant` (`accent | primary | secondary | success` inferred from call sites). It **will not compile as copied**. Check whether DeckPal already has a 4-variant button before building one.

**The one thing this component does that DeckPal's approval gate must not lose:** the preview text here is *authored data* (`body` is JSX in a const). DeckPal's `previewOf` (`DeckeChat.tsx:161-180`) deliberately sources its preview from **the last `ok` chip's real `summary`, never from something the model wrote** — a guard against a documented, measured failure. **A prettier card must be fed from the dry run's structured result, not from prose.** See §6.10 and §6.6.

### 4b.3 The remaining components observed

**01 Loading State** — *"Pixel-grid loader with shimmer and elapsed time."* A dark card with a small pixel-grid glyph and a live status row: **"Churning 9.5s"** → **"14.8s"** → **"3m 11.2s"** → **"1m 46.1s"** across frames (`t00297.137`, `t00302.561`, `t01061.074`, `t00977.009`) — a **live, ticking elapsed-time counter**, which is exactly the *"something animating here"* he praises at [05:04] and the thing DeckPal's static pill lacks. Below the card, a segmented variant control: **Drive | Dots | Orbit | Surfer** (four alternate loader styles, "Drive" active).

**02 Thinking** — *"Expandable traces — steps, reasoning, search, coding."* Collapsed: a pill row **`+ <label> ⌄`** with a sub-tab strip **Steps / Reasoning / Search / Coding** beneath. **The collapsed label cycles through at least three states**, with the matching sub-tab activating each time: *"Thought for 4 seconds"* (Steps) → *"Ran 3 tools"* (Coding) → *"Searched the web"* (Search) — `t00348.691`, `t00358.259`, `t00359.826`. Expanded (`t00310.655_preclick`): a checklist of steps, each with a **green checkmark**, bold step name, and an optional gray metadata fragment right-aligned — *"✓ Reading flavor briefs"*, *"✓ Scanning supplier lists"*, *"✓ Comparing tasting notes — 6 flavors"*, *"✓ Writing the scope report"*. **This is the component behind C14 and C17.**

**03 Streaming Text** — *"Streamed answer with inline sources, actions, and follow-ups."* Plain prose that types in live on a loop (captured mid-reveal at `t00356.888` as just *"Pistachio |"*, at `t00357.488` as *"…margins beat vanilla |"*, complete at `t00977.009`). Anatomy: the answer paragraph; an **inline cited-source chip** mid-paragraph (small coloured favicon + domain, *"🟢 scoopdata.io — Stone-fruit flavors are trending in the same range."*); a row of small icon actions (copy / retry / thumbs-up / thumbs-down); an aggregate **"🔵🟢🟠 10 sources"** chip with a stacked-favicon cluster; then a **"Follow-ups"** heading with two clickable suggested next-questions, each prefixed **↵**: *"Which flavors sell best in winter"*, *"Compare gelato and soft serve margins"*.

**04 Approval Card** — *"Human-in-the-loop questions the agent asks before acting."* A bold question title (**"How many flavors should we launch?"**) with an **×** dismiss top-right; a vertical list of **radio options** — *"Three (core line)"*, *"Five (full case)"*, *"Just one hero"*; a free-text fallback input **"Type something…"**; **pagination dots with ‹ › arrows** (multiple approval prompts can be queued); and a circular up-arrow submit button. Note the difference from the Recommendation Card: this one is a *question with options*, that one is a *proposal with a confidence meter*. The pagination dots are the visual expression of R8 §4's *"batch pending approvals into one review, never a rapid-fire sequence."*

**05 Tool Chips** — *"Code edits and tool calls as compact chips."* A collapsible header **"4 tool calls, 2 messages"** with a chevron. Each row is `icon + bold verb-phrase + a monospace gray target/detail`: *"Thinking — Planning the churn schedule…"*, *"Write 204 lines — ChurnSchedule.tsx"*, *"Rebuild and verify — npm run freeze"*, *"Read image — flavor-chart.png"*. Below the rows, a row of compact **file-diff pills** with added/removed line counts in green/red: *"flavors.css +13"*, *"ChurnSchedule.tsx +74 -41"*, *"menu.ts +8 -2"*, *"+2 more"*. **This is the reference for C16's "highlightable, but not a pill by default"** — flat rows, no per-row pill chrome.

**06 Task Rows** — *"Live agent task status — running, failed, completed."* Each row: a status icon (**green check** = done, **numbered gray circle** = in progress), a bold task name, a metadata fragment (*"12 suppliers"*, *"7 SKUs"*, *"2 messages"*), an optional colour status pill (**"Completed"**, green), and a chevron to expand. Below the list, a **"Capsules | List"** view-mode toggle — **confirmed interactive**: he clicked it on camera four times and it flipped from Capsules to List and stayed (`t01071.401` → `t01085.703_preclick`). **This is the component he was looking at for C41.**

**07 Chat** — *"Tabbed chat panel with reasoning replies and a composer."* A top tab strip for multiple named threads (**"Flavors | Suppliers"**) with a `+` and a `⋯` overflow; a user-prompt pill (*"Compare mint chip to last summer"*); then **collapsed reasoning rows** each labelled `**Step name**  Sub-label  for Ns` that expand into a one-line plain-text result — *"Sales History · Flavor Data · for 4s"* → *"Pulled 3 summers of mint chip sales for comparison."*, and *"Comparison · Trend Detection · for 2s"* → *"Mint chip is up 12% with stronger weekend peaks."*; a bottom composer with an @-aware placeholder (*"Prompt or tag a flavor with @"*). **The `for Ns` duration badge per reasoning step is a directly transferable idea for C23.**

**10 Context Cards** — *"Retrieved knowledge chunks with their sources."* A tab **"All chunks  32"**; then per-chunk rows: a chunk glyph + bold title + **right-aligned character count** (*"290 characters"*, *"1,250 characters"*), one to two lines of the quoted source text, and a **source-file pill** (file-type icon + filename + external-link arrow): *"📄 Dairy Onboarding SOP.pdf ↗"*, *"📊 Sales Velocity Export.csv ↗"*.

**11 Diff Table** — *"AI-proposed edits sweeping through tabular data."* Card title **"Proposed menu cleanup"** with right-aligned helper text *"Click changed rows to toggle"*. Columns: Flavor | Category | Supplier. **Full-row background tinting** encodes change type: red/pink = removal (Rocky Road, Bubblegum, each with a green checkmark toggle at the row end), untinted = unchanged (Mint Chip), green = addition (Pistachio). Footer: gray summary **"2 removals · 1 addition"** left, a solid blue **"Apply 3 changes"** button right. **A clean pattern for any bulk collection edit.**

**12 Records Table** — *"CRM-style grid with tags, sorting, and relationship status."* Leading checkbox column, a row-number + letter-group column, an entity-name column (*"Alpine Churn — Zürich"*), and a multi-tag **Categories** column of colour-coded pills (B2B purple, Gelato green, Wholesale tan, Catering blue, Sorbet pink, Imports red, Seasonal yellow, Dairy-free teal, Vegan lime, Cafe violet, B2C rose, Local green). Footer: bold **"60 count"** and a **"+ Add calculation"** link.

**13 Filter Table** — *"Status chips that reorganize live data."* A row of filter chips with live counts and colour dots — **"All 5 · ● To do 2 · ● In Progress 2 · ● Completed 1"** — feeding a table of Task name | Date | Status | Advisor, with Status rendered as colour pills (To do = orange/amber, In Progress = blue, Completed = green).

**14 Sidebar Nav** — *"Collapsible workspace and chat navigation with gliding hover states."* A workspace-switcher header (**"🏪 Creamery Ops ⌄"** with a collapse/pin icon), fixed rows (**"✎ New chat"**, **"⌂ Home"**, **"👤 Invite users  3/10"**), a collapsible **"⌄ Chats 🔍"** section header with its own inline search icon, a flat list of short task-phrased chat titles (*"Supplier records"*, *"Urgent to-dos this morning"*, *"Flavor page ticket"*, *"Workload summary"*, *"Off-board a supplier"*, *"Batch restock function"*, *"Propose flavor edits"*, *"Subway surfing"*), and a bottom-anchored **"Upgrade"** button. **Relevant only if Deck-E ever gets conversation history — see D5 and Part 9, Q3.**

**15 Search** — *"Command search with live filtering and an empty state."* A single input with a magnifier and placeholder *"Search flavors…"*, opening a suggestion list of **plausible full-sentence queries**: *"Forecast summer demand"*, *"Find waffle cone suppliers"*, *"Compare seasonal flavors"*, *"Draft flavor launch plan"*, *"Check cold-chain status"*.

**16 Flowchart** — *"Workflow trigger and condition steps on a dotted canvas."* A dotted-grid canvas; a purple **"Trigger"** pill node (*"💡 New order created — Trigger when a new order is created"*) connected down to an orange **"If / Else"** pill node whose conditions are built from field/attribute/value dropdown chips (*"If ⚲order flavor⌄ is ●Rocky Road⌄"* / *"and ⚲order topping⌄ is ●Brown butter bourbon brittle crunch⌄"*).

**17 Insight Cards** — *"Paged agent insights with scrub-ready live charts."* An **"Insights  3"** header with ‹ › pager arrows; a one-sentence plain-language insight naming a best/worst performer with an inline entity chip (*"The worst performer in your 🟠@Creamery is Rocky Road — down -6% or -$2,453.44."*); a two-up colour stat block (*"● Mint Chip  -4.41%  -$2,377.66"* / *"● Pistachio  +1.15%  +$617.22"*); a **"Trend snapshot"** mini panel with its own Snapshot toggle and an **explicit empty state** (*"No data to display"*); and a bottom suggested-action pill (*"Should I rebalance flavors?"*).

**18 Code Block** — *"Agent-written code streaming in line by line."* A filename + language header (*"churn.ts  TypeScript"*) with a **Copy** button, over a numbered, syntax-highlighted listing. Appeared greyed/disabled in the sidebar in some frames.

**19 Fine-tune Card** — *"The agent adjusts design properties in an inspector."* A mock property inspector: named target (*"Flavor card"*) with a blue **"+ Adjust"** button; a **"Layout"** label over a three-way segmented control (rows / single / grid icons); paired numeric fields **W 324 / H 96** and **Radius 28 / Opacity 100 %**; and a **"Type"** dropdown reading *"Select type"*.

**20 Selection Actions** — *"Highlight a passage and hand it to the agent to rewrite."* A text passage with one sentence shown selected, and a small floating toolbar anchored to the selection: a grayed **"Describe edits"** free-text input plus quick actions **"❓ Explain"**, **"✨ Improve"**, and a **`›`** more chevron.

### 4b.3b The other priority components, from the source

§4b.3 above is what the frames showed. This is what the recovered `.tsx` adds — states, timings and mechanisms no screenshot could reveal. **Ordered by how much this pass needs them.**

---

**02 Thinking — `ThinkingState.tsx` (10,978 B). Serves C14, C17, C12.**

The header is `[spark icon] [label] [chevron]`; below it an expandable trace region **with a vertical connecting line on the left whose height animates (500 ms) to match the content**. Rows enter `fade-up 300ms` staggered by `index × 120ms`.

**It runs a scripted five-stage timeline — 800 / 600 / 1800 / 2600 / 1600 ms — through idle → working → settled**, and the settle behaviour is the interesting part: while working the label shimmers (`shimmer-text`) with an active verb; when done it **collapses back to a static *"Thought for N seconds"*** that remains manually re-expandable. Once the user has clicked the header, a `manualExpanded` flag **overrides the auto behaviour permanently** — the component stops driving its own open/closed state. That is the correct answer to "auto-collapse fights the user," and DeckPal will need exactly it.

**It fires an `onSettled` callback, once.** *This is the hook C12/C20 need* — the thing that lets "thinking" hand off cleanly to "answer" instead of two surfaces overlapping.

**Four content shapes, and three of them are directly wanted here:**
- **Steps** — checkmark-or-spinner + bold label + optional muted secondary (*"Comparing tasting notes · 6 flavors"*).
- **Search** — a *"searching…"* query row (magnifier + query text), then coloured dot result rows that are **real `<a>` links opening in a new tab**, with an animated-underline hover, ending in a static *"+7 more"*. **This is the shape C17 is asking for**, and note it surfaces sources *during* the search, not only at the end.
- **Coding** — tool-call rows (`Read`/`Edit`/`Run`) with monospace secondary text, **clickable to select/highlight (`aria-pressed`)**, and green/red `+74 −41` diff counts.
- **Reasoning** — prose paragraphs, no icon, wrapping normally rather than truncated.

Zero external deps, zero internal helpers. **The cleanest expand/settle reference in the library.**

---

**05 Tool Chips — `ToolChips.tsx` (13,193 B). Serves C15, C16, C23, D2.**

**Read §4b.0's banner first: R6's claim that DeckPal's chips "already stream" corrects a framing, not C18.** What this component genuinely adds is that **a resolved row stays interactive**.

Each row is `[icon that swaps to a chevron on hover/open] [bold verb-phrase] [inline mono chip naming the target, truncating, itself a click target]`. **Expanding a row reveals one or two detail lines under a left connector rule**, green-tinted for "add"-tone lines. The run auto-plays at `STEP_MS = 700ms` per step, and — unlike Streaming Text — **once played, the expand/collapse and hover affordances persist indefinitely.** Rows `fade-up 300ms`; diff chips `pop-in 250ms` staggered 80 ms.

**The diff-preview popover is the most sophisticated positioning code on the site, and its reason for existing is a warning DeckPal should heed.** It portals to `document.body` via `createPortal`, measures the trigger's `getBoundingClientRect()`, and flips above/below on `rect.bottom + 6 + previewHeight <= window.innerHeight - 12`. **It portals specifically so that an animated or translated parent cannot corrupt the popover's fixed-position coordinate system.** DeckPal's messages animate in, its panel animates in, and its character flies — **any hover card, tooltip or expanded detail in this chat must portal out, or it will drift.** That is a real bug waiting, and this is the fix, pre-written.

Skip the file-diff chip row itself; there is no code-diff surface in a card tracker.

---

**06 Task Rows — `TaskRows.tsx` (9,012 B). Serves C41, and — unexpectedly — D2.**

The frames showed green checks and numbered circles. **The frames missed the failure state, which is the reason to care about this component.** The site's own caption says *"running, failed, completed"* and the scripted `TICKS` timeline delivers all three:

- **row 1** starts already-completed (green check, "Completed" pill);
- **row 2** spins for the entire demo and never resolves — an always-running task — auto-expanding once at ≈1500 ms and staying interactively expandable;
- **row 3** starts pending, **flips to Failed at ≈3900 ms (red X badge, red "Failed" pill, a spinning retry icon), then resolves to Completed at ≈5300 ms.**

**That failed → retried → completed arc is the richest state machine in the library, and it is the answer to D2.** D2's whole finding is that DeckPal renders a failed tool as `text-text-muted line-through` — struck-through gray, no colour, no badge, no expansion — so an 86-second turn that produced nothing read to the owner as a success. **A red badge, a red pill, and a retry affordance is the correction, and it exists as reference code.**

The "numbered gray circle" the scribe saw is a **`SpinnerRing`**: a 24 px SVG, gray track plus a 28%-arc `ink-3` stroke that spins, **with a queue-position number overlaid in the centre**. Nice detail: **the row's own corner radius animates between 14 px expanded and 22 px collapsed.** Variants `Capsules` (each row its own floating card, `gap-2`) vs `List` (one bordered card, `border-b` dividers, no per-row shadow) — the toggle he clicked four times.

---

**04 Approval Card — `ApprovalCard.tsx` (10,923 B). Serves C42 (in reserve), D2.**

**Fully self-contained — no external and no internal deps. One of the two cleanest components to lift as-is.**

The pattern is **one question at a time**, not a form. Radio rows (filled circle) or **checkbox rows (filled rounded square with a checkmark)** — the frames only caught the radio variant — each a full-width hoverable button, and **every question always ends with a free-text *"Type something…"* row** so a custom answer is always possible (typing clears any selected radio). Footer: a **ring-dot pager** where the active dot is a larger *open ring*, answered dots are *filled*, and future dots are *outlined* — three distinct states, not two — plus prev/next chevrons and a circular send that is gray until the current question is answered and black after.

**Radio answers auto-advance after 480 ms.** Submitting replaces the whole card body with a compact strip: a green **"✓ Answers sent"** pill and an optional **"Start over"** (`resettable`, default `true`). **Dismissing via the `×` does not destroy the flow** — it minimises to an *"Open approval"* pill; reopening restores **question 1**, not where they left off (a real limitation, worth knowing).

Accessibility is genuinely done: radios and checkboxes are real `aria-pressed` buttons rather than styled native inputs, pager dots carry `aria-label` and `aria-current="step"`, and the next/send button's `aria-label` swaps between *"Next question"* and *"Send answers"*.

**R6's recommendation, which this brief endorses:** the owner's ask (*"want me to put these cards in"* + thumbnails + confidence + Accept) is **Recommendation Card's shape, not this one.** Keep Approval Card in reserve for genuinely sequential disambiguation — *"Which printing? → Which condition? → Confirm quantity?"* — which is R8 §4's N-best pattern and maps onto a real DeckPal problem (variant ambiguity, idea 20 in §5.9).

---

**03 Streaming Text — `StreamingText.tsx` (9,233 B). Serves C11 (adjacent), C17.**

**Two corrections to what the polish implies.**
1. **The reveal is `WORD_MS = 55ms` per word by a plain incrementing counter. There is no per-token blur or opacity transition** — each span simply appears the instant the count passes it. The file's own doc-comment describes "words resolving out of blur"; R6 checked the render and it does not happen. **Do not budget for a blur reveal on the strength of this demo.**
2. **There is no markdown parser anywhere in it.** This component does not solve C11 and is not evidence about it. C11's fix is `react-markdown`, already installed (§5.1), and is unrelated to this site.

What *is* worth lifting, and DeckPal has none of it: the **inline citation chip mid-sentence** (a favicon in a monospace pill, appearing exactly where the sentence cites it rather than in a footnote), a blinking `h-3 w-0.5` caret trailing the last revealed word, and the completed-state footer — **copy / retry / thumbs-up / thumbs-down** icon row, then a **"10 sources"** pill with three stacked favicons expanding via the grid-rows accordion, then a **"Follow-ups"** block of two full-width suggested next-questions. **The follow-up rows and the action icons render with no `onClick` wired — they are demo stubs.** A real integration wires all six.

`HOLD_MS = 3400ms` before the demo loops; pass `loop={false}` and an `onDone` callback in production.

---

**07 Chat — `ChatComposer.tsx` (7,423 B). Serves C20, C36, C23.**

**Skip the shell, take one idea.** The panel is a fixed **288 px** tall card with a two-tab header — deliberately fixed **so the panel never resizes as content streams in**. DeckPal's chat is a different shape entirely and this does not transfer.

**The idea worth taking is the reply `Section`.** Assistant replies are **not bubbles**. Each is a small metadata line — `bold label · muted sub · "for Ns"` (e.g. *"Sales History · Flavor Data · for 4s"*) — followed by a plain-text body. **The `for Ns` per-step duration badge is directly transferable to C23**, and the whole shape is what C36's *"traveled to X / clicked Y"* rows want to look like.

**And one genuinely novel state: `resolving`.** A reply that is being superseded gets `opacity: 0.55`, `filter: blur(0.5px)`, `scale(0.985)` — *"this is being refined"* expressed on the content itself rather than by a spinner somewhere else. **That is a better answer than a spinner for DeckPal's own case**, where a leg's answer can be revised by a later leg.

Timeline: sent → reply1 at +500 ms → reply2 at +1400 ms (with reply1 marked `resolving` during the transition) → both settle at +1200 ms. Bubble entrance `translateY(10px)→0`, 300 ms.

**Do not carry `posthog-js`.** It is the demo site's own analytics (`posthog.capture("chat_composer_prompt_sent")`), incidental to the pattern.

---

**10 Context Cards — `ContextCards.tsx` (3,803 B). Serves C17, and R8 §8's citation-shaped ideas.**

**The cheapest priority component to adopt: fully self-contained, two hardcoded demo chunks, no deps at all.**

Per chunk: a bar with list-icon + truncated title + **right-aligned muted character count**, the retrieved body text, and a footer **source chip** — a small coloured two-letter file-type badge (`PDF` white-on-red, `CSV` white-on-green), filename, external-link icon.

**One deliberate motion detail worth stealing:** the source chip **scales in 700 ms *after* the card's own entrance** (`cubic-bezier(0.23,1,0.32,1)`, plus `i*80ms`), *"as if the system just finished resolving the citation."* Cards themselves `fade-up 400ms` staggered 100 ms. **Sequencing a citation to arrive after its content is an honest signal, and it costs one delay value.**

It is a static display component — no expand, no click handler on the source chip. A real integration opens the source.

---

**20 Selection Actions — `SelectionActions.tsx` (17,787 B). Highest effort, highest payoff. No complaint asks for it directly.**

Included because it contains **the single most technically interesting trick in the library, and DeckPal will hit the problem it solves constantly.**

**The pill animates its own width between content states using the Web Animations API directly** — `bar.animate([{width: prevPx}, {width: nextPx}], { duration: 320, easing: 'cubic-bezier(0.23,1,0.32,1)' })` — **because CSS cannot transition `width: auto`.** Any chat affordance that must resize to fit changing content (a chip going from "Analysing…" to "Analysed 604 cards", a status row gaining a duration badge, a composer control row gaining a `+`) has exactly this problem, and this is the answer.

Second reusable mechanism: the bar **repositions live as content reflows**, via `getBoundingClientRect()` on the selection plus its *last* client rect (so it sits under the **last line** of a multi-line selection, centred on the full selection's horizontal midpoint), re-measured on a `ResizeObserver` **and** on an `onProgress` callback fired while the replacement text streams in. Its position curve is `cubic-bezier(0.77,0,0.175,1)` at 320 ms — deliberately aggressive, because the bar must *catch up* to something moving rather than settle from a static spawn.

Four states: idle (quick actions **Explain / Improve** visible, **Shorten / Tone / Grammar** behind a chevron, plus a describe-edits input that **expands to fill the space as you type, cross-fading the quick actions out via `maxWidth`/`opacity` rather than jumping layout**) → thinking (700 ms shimmering *"Improving…"*) → streaming (the selected text is replaced **in place**, word by word) → result (**Keep** / **Discard** / retry, all inline in the same pill).

Needs `Shimmer` (~10 lines) and `StreamText` (moderate — **build it once and use it in Streaming Text too**), plus `iconoir-react` (swap for DeckPal's icon set). **A speculative fit for DeckPal: select cards in a grid → a floating bar offering "Compare / Add to trade binder / Check price."** Not asked for; recorded because the mechanism is needed regardless.

---

**01 Loading State — `LoadingState.tsx` (5,058 B). Serves C12, and the *"having something animating here is great"* remark at [05:04].**

`role="status"` row: `[3×3 pixel grid] [shimmering label] [mono tabular elapsed time]`. Cells are **4 px with a 1.5 px gap**; inactive cells sit at **7 % opacity**, active ones pulse 15 % → 100 % on a per-cell delay that reads as a wavefront. **The elapsed timer ticks every 100 ms and formats `Ns.s` under a minute, `Mm Ns.s` after** — which is exactly the *"Churning 9.5s → 14.8s → 3m 11.2s"* progression the scribe saw. Variants: `Drive` (square cells, default) / `Dots` (round) share a chevron wavefront on a 650 ms cycle staggered so **two wavefronts are visibly in flight at once**; `Orbit` uses an 8-cell perimeter order at 950 ms.

**Two things to note before adopting.** First, **there is no success or error variant — it is a pure in-flight indicator**, so DeckPal must design the resolution itself (and per D2, must design the *failure* resolution loudly). Second, the fourth variant, `Surfer`, renders a 16:9 `<video autoPlay muted loop playsInline>` of `/subway-surfers.mp4` with the label *"Subway surfing"* — **it is a joke**, and it is also why *"Subway surfing"* appears in the Sidebar Nav chat list the scribe transcribed. Not a feature.

**The transferable idea, stated plainly: a live elapsed-time readout in tabular figures.** D1 measured a 61-second freeze in which nothing on screen changed. A ticking counter would not have made it faster, but it would have made it *legibly not-hung*, which is precisely what C19 is about.

---

### 4b.3c Adoption verdict — R6's table, with this brief's annotations

| # | Component | Verdict | Effort | Dependency risk | Which complaints |
|---|---|---|---|---|---|
| 01 | Loading State | **Adapt** | S | none | C12, C19 |
| 02 | Thinking | **Adapt** | M | none | **C14, C17**, C12 |
| 03 | Streaming Text | **Adapt** (footer + citation chip only) | M | none | C17 |
| 04 | Approval Card | **Adapt, in reserve** | M | none | C42 (sequential disambiguation only) |
| 05 | Tool Chips | **Adapt** (expand-a-resolved-row) | M | none (portal pattern only) | **C15, C16, C23** |
| 06 | Task Rows | **Adapt** (esp. the failure arc) | M | none | C41, **D2** |
| 07 | Chat | **Skip** the shell / **Adapt** the `Section` + `resolving` | S | drop `posthog-js` | C20, C23, C36 |
| 08 | Prompt Bar | **Adapt** (reflow + card-as-field) | L | `glimm` — **skip it** | **C51, C52** |
| 09 | Recommendation Card | **Adapt** | M | rebuild `Button` | **C42, C43** |
| 10 | Context Cards | **Adapt** | S | none | C17 |
| 11 | Diff Table | Skip | — | rebuild `Button`; low relevance | — |
| 12 | Records Table | Skip (**but steal the `color-mix` tag theming**) | — | rebuild `GlideMenu` | — |
| 13 | Filter Table | Skip | — | none | — |
| 14 | Sidebar Nav | Skip | — | rebuild `GlideMenu` + icon set | only if D5/Q3 goes the persistence way |
| 15 | Search | Skip | — | rebuild `GlideMenu` | — |
| 16 | Flowchart | Skip | — | none | — |
| 17 | Insight Cards | **Adapt** | L | `liveline` — **swap it**; keep the Catmull-Rom `smooth()` | R8 §8 ideas 11, 14, 15 |
| 18 | Code Block | Skip | — | — | — |
| 19 | Fine-tune Card | Skip (**but the scrub-field drag math is a nice isolated primitive**) | — | rebuild `GlideMenu` | — |
| 20 | Selection Actions | **Adapt** the width-animation + reposition mechanics | L | rebuild `Shimmer`/`StreamText` | none directly; needed anyway |

**Ten "Adapt", ten "Skip". The ten to adapt are, almost exactly, the ten he reacted to or implied.**

### 4b.3d Where the two sources disagreed, and which won

| Claim | Scribes (screenshots) | R6 (fetched source) | Resolution |
|---|---|---|---|
| Domain | `www.beautifui.dev` (`t01174.082`) | `beautifului.dev`, fetched | **R6.** Scribe misread one `l`. |
| Theme | "dark theme" | ships light **and** dark, `.dark` class | **R6.** The frames are dark because his toggle was. |
| Tool Chips rows | "flat rows, no per-row pill" | rows are **individually expandable**, icon swaps to chevron | **R6 extends.** The scribe's reading of the *resting* state is right and is what C16 quotes. |
| Task Rows states | green check / numbered circle | check / **spinner-ring with queue number** / **red X + Failed pill + retry** | **R6.** The demo's failure beat fell between captured frames. |
| Streaming Text reveal | "types in live" | plain 55 ms/word counter, **no blur** despite its own comment | **R6, and it corrects the component's own doc.** |
| Insight Cards paging | "page content crossfades" | `opacity:1, filter:blur(0)` unconditionally — **the crossfade does not fire in this build** | **R6.** |
| Confidence meter bars | "three short vertical bars, rising" | three **equal-height** 1×10 px bars; the fill rises, not the height | **R6.** |
| Approval Card options | radio only | radio **and checkbox** questions | **R6 extends.** |
| DeckPal's own chips | "dumped all at once" (C18) | "already stream progressively" | **NEITHER alone.** Transport streams; parallel tool use makes them land together. **C18 stands as written** — see §4b.0's banner. |

**One thing R6 could not verify and neither could the frames:** the internal helpers (`Button`, `Shimmer`, `StreamText`, `GlideMenu`) were read only at their **call sites**. Their described behaviour — including `ButtonVariant`'s exact union — is inference from usage, not a read of source that is not published anywhere. **`GlideMenu`'s mechanism is high-confidence** because Prompt Bar and Flowchart implement the same pattern inline, but that is still an inference about the imported version specifically.

### 4b.4 The five components he actually reacted to

For scoping: he narrated over, clicked, or dwelt on exactly five. Everything else scrolled past.

| Component | What he did | Complaint it serves |
|---|---|---|
| **09 Recommendation Card** | ~28 s static hold; drag-selected "High confidence"; *"That would be amazing"* | C42, C43 |
| **08 Prompt Bar** | hunted for it by name (*"Let's see where is it. Prompt bar."*); *"this is already better"* | C51, C52 |
| **02 Thinking** | *"being able to expand this and see that stuff is going on is great"* | C14, C17 |
| **05 Tool Chips** | *"it's highlightable, but it isn't a pill by default"* | C15, C16 |
| **06 Task Rows** | clicked the Capsules/List toggle four times; *"that might be a way to make that better… maybe overkill"* | C41 |

**01 Loading State** is a sixth by implication — his *"Having something animating here is great"* [05:04] is said with the ticking "Churning 14.8s" counter on screen.

---

# Part 5 — What already exists and is merely unwired

**This is the single most consequential finding across all seven research documents: a large fraction of what he is asking for is already built, tested, and shipping — it is simply not connected to the chat surface.** Reading the recording without this section would badly overestimate the work.

Each entry: **what exists → what is missing → how big the remaining gap actually is.**

---

## 5.1 The markdown renderer (serves C11)

**Exists:**
- `react-markdown@^10.1.0` and `remark-gfm@^4.0.1` are already dependencies in `apps/web/package.json`.
- `apps/web/src/routes/deck/MarkdownView.tsx` — a complete, 52-line, token-styled renderer with an explicit `Components` map covering `h1, h2, h3, h4, p, a` (with `target=_blank` and `text-link`), `ul, ol, li, strong`, inline `code` (on `bg-surface-tertiary`), block `pre`, `blockquote`, `hr`, and `table/th/td` (on `border-border-default`).
- The bundle-safety pattern is already proven in this exact codebase: it is loaded via `React.lazy()` by `StrategyTab`, and its own header comment explains that react-markdown + remark-gfm (~40 KB gz) land in their own chunk and never touch the main bundle.

**Missing:** `DeckeChat.tsx` does not import it. `DeckeChat.tsx:492-503` renders `{m.text}` as a raw string child.

**Gap size: `[AUDIT]` — small, not "very small", and rev 1's scoping misses half the surface.** Swapping one JSX child for a lazily-loaded component plus a tightened map for a 14 px bubble is right for the *panel*. **But `DeckeBubble.tsx:129` renders `{text}` raw as well, and it is a second renderer of the same assistant text — see D10.** C32's escorted journeys route *more* words through the bubble, not fewer, and it is `max-w-[280px]`, `pointer-events-none`, and drawn over his own face. The lazy boundary also needs thinking about: a `React.lazy` component suspending inside a 280 px bubble mid-flight has no designed fallback. Realistically the bubble wants a **deliberately smaller inline subset** (bold, italic, code, line breaks) rather than the full document renderer. Still no new dependency and no bundle regression risk. **Confidence: very high on the panel half; the bubble half is a design decision, not an import.**

**Caveat:** no sanitiser (`rehype-sanitize`, `dompurify`) exists anywhere in the repo. `react-markdown` does not render raw HTML by default, so this is safe as-is — but it must stay that way; do not enable `rehype-raw`.

---

## 5.2 The approval / dry-run machinery (serves C42)

**Exists — a complete, working propose→confirm→commit pattern spanning server and client:**

*Classification (pure functions, `adapters/aisdk.ts:214-231`):*
```ts
export function wouldMutate(def, input) {
  if (def.annotations.readOnlyHint) return false
  const hasDryRun = def.inputSchema ? 'dry_run' in def.inputSchema.shape : false
  if (!hasDryRun) return true
  return (input as {dry_run?: unknown})?.dry_run === false   // ANYTHING but explicit false is a preview
}
export function requiresApproval(def, input) {
  if (def.annotations.readOnlyHint) return false
  if (def.annotations.destructiveHint) return true
  return wouldMutate(def, input)
}
```

*Enforcement:* `forcePreview` (`aisdk.ts:240-245`) forces `dry_run: true` even into calls classified as not needing approval, unless the call is an approved write (`aisdk.ts:342-346`). Every tool is wrapped with `needsApproval: (input) => requiresApproval(def, input)` (`aisdk.ts:334-337`) — **a real SDK-level hold, verified against the pinned `ai@7.0.66` build rather than assumed from docs** (`aisdk.ts:179-184`).

*Wire:* `tool-approval-request` carries `approvalId` (+ `toolCallId`, + `signature` when `DECKE_APPROVAL_SECRET` is set); `pendingApprovalFromChunk` (`approval.ts:122-138`) assembles the full `PendingApproval` from maps held since the earlier `tool-input-available` chunk (`useDeckeChat.ts:539-546`); the answer is sent by **replaying the entire tool call with the verdict attached** (`approvalReplayPart`, `approval.ts:162-185`). Denial is a real answer (`approved: false, reason: 'the reader declined'`), not silence.

*Client loop:* `askApproval` parks a Promise on `resolverRef` (`useDeckeChat.ts:346`); `mayAskApproval(approvalReplays)` (`:334`) refuses to show the dialog at all if there is no leg budget left to carry the answer back. Budgets in `approval.ts:205-226`: `MAX_LEGS = 4`, `MAX_APPROVAL_REPLAYS = 2`, `legBudget(replays) = MAX_LEGS + replays`.

*UI:* `DeckeChat.tsx:595-645` — a plain-language question, the dry-run preview text from `previewOf(messages)` (`:161-180`), and two buttons.

*Preview truthfulness:* `previewOf` walks backwards for the last `ok` chip's `summary` — **the tool's actual first line of output, never something the model wrote.** The comment at `:606-621` documents the measured failure this defends against: the model produced zero text on the turn it asked to write, which would have left a blank consent dialog.

*Verification:* `scripts/decke-signed-probe.mjs` imports the **actual shipped** `pendingApprovalFromChunk` and `approvalReplayPart` (not a reconstruction), and `DROP=1` strips the signature as a deliberate falsification that *must* fail. Gate 9 in `scripts/decke-gates.mjs` is the browser-level equivalent.

**Missing:** the preview is one line of text. His ask is a row of card thumbnails with names and variants, per-item, with Accept as the commit.

**Gap size: medium, and entirely in the presentation layer.** The hold, the signing, the replay, the leg budgeting, the truthful-preview sourcing, and the falsification harness are all done and battle-tested (two shipped bugs already found and fixed in this exact code path — see `approval.ts:1-53`). What is needed is a richer preview renderer fed from the dry run's structured result, and the per-item selection model R8 §4 recommends.

**Already-dead wiring worth knowing about:** `DeckeScreen` accepts an `onRemoveCard` prop and renders a remove `×` on `editable` cardGrid items — **and nothing passes it.** `DeckeChat.tsx:546` renders `<DeckeScreen spec={m.screen} />` with no second prop. The "that one's wrong" correction affordance (R8 §4's *"support efficient correction"*) is already built and unreachable.

**Adjacent prior art, deliberately separate:** `ripCommit.ts` / `ripSession.ts` / `ripPresence.ts` — the booster-pack scanner's batch-write path. `ripSession.ts` turns noisy per-frame scanner matches into a deduplicated `RipEntry` list (cardId, quantity, variant) with a *departure-then-return* dedup rule and reader-editable quantity/variant per row. `commitRip(entries, note?)` resolves each entry's variant (falling back to the catalog's primary), then writes **everything in one request** via `api.collectionBatch`, with an idempotency key derived from the *resolved* items (`variantId × delta`, sorted) so a retried or partial batch cannot double-apply. **This is the reusable pattern for a chat-driven multi-card write** — but note it has **no SDK `needsApproval` hold at all**, because a human is operating a scanner UI with an explicit commit button. Do not confuse the two mechanisms.

---

## 5.3 The flight engine (serves C3, C32, C35)

**Exists — a real physical simulation, not a tween.** `apps/web/src/character/decke/flight.ts`:
- A stopping-distance velocity profile (`simulate()`, `flight.ts:196-247`) integrated at a virtual 30 Hz, then interpolated for playback (`sampleTrack`, `:491-523`) — **baked on trigger, played back**, explicitly not frame-driven.
- Asymmetric accel/decel: `ACC_FRAMES = 20` vs `DEC_FRAMES = 6.5`, ~4:1 — long wind-up, short brake, because a constant ratio is *"what made the old hand-authored profile read mechanical."*
- Anticipation arc before departure (`ANTIC_ARC`, `ANTIC_FRAMES = 7`) and an aimed overshoot before settling (`OVERSHOOT_FRAC/MAX`) — not emergent ringing.
- Distance-adaptive pacing: `travelRate(distance)` (`:95-98`) ramps from `TRAVEL_RATE_NEAR = 1.7×` to `TRAVEL_RATE_FAR = 2.95×`, full ramp at 20 world units. A same-depth hop (0.4–3 units) plays near 1.7×; a depth change (24–27 units) near 2.95×.
- Orientation (lean, yaw, bend/lean/twist "whip", squash, mouth) derived from the *solved* curves: `lean follows ACCELERATION, not speed` (`:101`), because a speed-driven lean cannot show braking.
- Bow/arc controls sweep the path off a straight line so a move along the camera axis still reads as travel rather than a zoom.

**Also exists:** `pageAnchor.ts` — once he is parked beside an element, the canvas overlay is unpinned from the viewport and pinned into page document flow (`pinToPage`/`unpinToViewport`, `:88-137`) so ordinary browser scroll-compositing carries him at no per-frame cost, giving the rubber-band bounce for free. And `travelAfterRoute` (`uiTools.ts:299-341`) — a `MutationObserver` bounded at 6000 ms that waits for a destination selector to exist after a route change, then always routes the flight `via: 'background'`.

**Missing for C3:** a scale-from-zero entrance. There is none (see C3).
**Missing for C32:** nothing in the engine. R3 §5 is explicit: *"None of items 1–6 require touching the flight/physics engine, the highlight ring, or the approval/write machinery — those are complete and correct for what the owner is asking."*

**Gap size for the hop-hop-hop journey: zero engine work.** The gap is prompt doctrine, one markup attribute, and a transcript renderer.

---

## 5.4 The highlight engine (serves C16, C32)

**Exists:** `apps/web/src/components/ui/elementHighlight.ts` (imperative) + `HighlightRing.tsx` (declarative wrapper) — a chasing conic-gradient border cycling cyan → rose → amber over a 2600 ms cycle (`elementHighlight.ts:56-152`), plus a blurred halo pulsing underneath. Drawn as an absolutely-positioned overlay sibling at `z-index: 25` (`:93`), **never a class on the target**, so it works on elements it has never seen, including inside `overflow: hidden` and with their own borders/radius. **Singleton, app-wide** (`:199-240`) — only one element is ever ringed, because two would read as a multi-select. Deliberately unlike every static UI state so it cannot be confused with focus/selection/error/hover.

**Also exists:** `DeckeBeacon.tsx` (`:42-147`) + `decke/beacon.ts` — an off-screen indicator when the page has scrolled him out of view, drawn as *"a hole, not a picture"* (a ring + pointer chip with nothing inside, because the WebGL canvas renders the character into that rectangle from above), clickable to scroll him back.

**Missing:** nothing. Deck-E's `flyTo`/`highlight` tools already call it (`uiTools.ts:203-239`). It is exactly the primitive C16 asks for and it is already the app's established "this is what's being discussed" language.

**Gap size: zero.** This is a "use what's there" item, not a build item.

---

## 5.5 The ad-hoc screen system (serves C39, C40)

**Exists — a complete, grounded, security-reviewed component palette:**

*Server* (`apps/api/src/decke/screens.ts`): block kinds `heading, text, cardGrid, statTile, progress, status, empty, table, group` (`:46-84`), with `group` the only nesting kind, nesting exactly one level, enforced twice (zod schema types `left`/`right` as `z.array(leafBlockSchema)`, and again at runtime in `validateBlock`'s group case, `:280-300`) — deliberately doubled because `validateBlock` is exported and callable on hand-built objects. Shared optional fields (`leafFields`, `:103-157`): `text` (≤280), `cards` (≤60 catalog ids), `quantities` (≤60, positional), `value` (≤40), `percent` (0–100), `tone` (`neutral|good|warn|bad`), `editable`, `columns` (2–4, first is the row label), `rows` (≤10, each row length must equal `columns.length` exactly). Caps (`:186-225`): `MAX_BLOCKS = 12`, `SCREEN_CARD_BUDGET = 60` spent in block order (a grid that doesn't fit is dropped whole, never truncated), `TABLE_MAX_COLUMNS = 4`, `TABLE_MAX_ROWS = 10`, `GROUP_MAX_PER_COLUMN = 4`.

*Discipline:* **reject-not-clamp** (`validateBlock`, `:241-304`; `sanitizeScreen`, `:367-421`) — a malformed block is dropped with a stated reason, never silently corrected, *"because a model that is silently corrected learns nothing and repeats the mistake."* One exception: `fillQuantities`/`normalizeBlock` (`:306-348`) pads a short `quantities` array with `1`s, because omitting it already means "every card is a single."

*Grounding* (`:376-409`): card ids in a `cardGrid` that no tool actually returned this turn are stripped via `partitionCards` from `grounding.ts` — the honest remainder is kept, and the dropped ids are named back to the model so it can self-correct next turn. **This is what makes `cardGrid` render real card art rather than invented ids.**

*Client* (`DeckeScreen.tsx`): a `switch` over `Block['kind']` (`:96-234`) mirroring the server list exactly; unrecognised kinds render `null` (`:228-233`). Its header (`:1-26`) states the security property: *"there is no field anywhere in this schema that carries HTML, a class name, a style, a URL or a selector"* — the model picks components and props, never markup. `sourceSync.test.ts` asserts the two `BLOCK_KINDS` lists never drift, since the web package cannot import the API package's types.

*Per-block detail worth knowing:* `statTile` uses the real `TONE` token map (`DeckeScreen.tsx:51-56` → `text-action-primary` for `good`, `text-error` for `bad`); `progress` is a real `role="progressbar"`; `table` is horizontally scrollable; `group` is a 2-column CSS grid that **never stacks even at 390 px** (deliberate, `:202-212` — *"a group's whole meaning is 'these two things side by side'"*) and passes `dense={true}` down, which today only changes `cardGrid`'s column count and `heading`'s font size; `cardGrid` (`:258-320`) distinguishes three states visually — resolved (real art), `null` (the catalog genuinely has nothing → the raw id rendered as monospace in the card-shaped box), and `undefined` (still loading → an empty placeholder box) — *"so 'still asking' never looks identical to 'asked, and there is no such card.'"*

**Missing (per C40, and per R4 §B.3):**
- No compact/summary rendering mode — no "show N of M, expand," no max-height + fade, no collapsed initial state. `MAX_BLOCKS = 12` caps authoring, not display.
- No distinct visual treatment for a *preview* screen versus a *completed/historical* one.
- No expand-in / streaming state — `onScreen` is a single event, so a screen appears fully formed.

**Gap size: medium, all presentational.** The schema, the validator, the grounding guard, the renderer and the drift test are all done. What's needed is a second, compact display mode and a preview/confirmed distinction.

---

## 5.6 The card-image pipeline (serves C40, C42)

**Exists:**
- `apps/web/src/components/CardImage.tsx` (47 lines, whole file quoted in R4 §E.1): props `low` (245 px URL), `high` (600 px URL, used in `srcSet`), `alt`, `eager`, `className`, `radius` (default 8). Fixed `aspectRatio: '245 / 337'` reserved before a byte arrives, so **no layout shift**; `srcSet="${low} 245w, ${high} 600w"`, `sizes="(min-width: 1068px) 208px, 45vw"`; on `<img>` error the img is hidden entirely so the `bg-surface-tertiary` box reads as the intended skeleton, **not a broken-image glyph.**
- `apps/web/src/character/decke/cardSource.ts` — *"the one file in this character that knows DeckPal exists."* Exports `type CardArt = { id, front, frontLarge?, name? }` and `artForIds(ids: string[]): Promise<(CardArt | null)[]>`, which resolves in the order asked and **never throws** for an unresolvable id (`null` means "does not resolve," distinct from `undefined` = "still loading").
- `DeckeScreen.tsx:337-362`'s `useCardArt(ids)` hook — joins ids into a stable key to avoid refetch on every render from a fresh array literal, calls `artForIds`, keys by id, and treats fetch failure as "draw the ids as text" rather than an error state.
- **`DeckeScreen`'s `cardGrid` already uses `CardImage` directly** (`:280-286`).

**Missing for a card-row-with-names-and-variants widget:**
- `CardArt.name` exists but **nothing renders it** today (diagnostic-only per `cardArt.ts`'s own comment) — trivially promotable to a visible label.
- **Variant name is not part of `CardArt` or `artForIds` at all.** Variant selection/display exists only in the unrelated rip/scan flow (`RipVariant { variantId, displayName, isPrimary }`, `ripSession.ts:34-39`, pulling from `api.card(cardId).variants` per `ripCommit.ts:52-53`). A widget showing "which printing" must fetch/attach variant data the way `ripCommit.ts` does.
- **No row layout exists** — `cardGrid` is always a CSS grid (`grid-cols-2` dense / `grid-cols-3 nav:grid-cols-4` normal). Either shape is new layout, though both compose the same `CardImage` + `artForIds` pair.

  **`[AUDIT]` — rev 1 read his geometry the wrong way round.** It said "a horizontal scrolling row is new layout." He said: *"[18:17] he could actually show, like, card thumbnails **in a row down** with the names of the cards and the variant."* **"In a row down" is a vertical list of rows**, each row being `[thumbnail] [card name] [variant]` — not a horizontal strip of thumbnails. That reading is corroborated three ways: it is the only shape that leaves room for a name *and* a variant per item, which is what he asked for; it is what the Recommendation Card's own "Other options" drawer does (§4b.2 — one row per option, each with its own meter and one-line summary); and it is what makes per-item selection (R8 §4's "low-confidence items default deselected") expressible at all. **Build a vertical list of rows.** A horizontal thumbnail strip is a different component and he did not ask for it.

**Gap size: small-to-medium.** No new API surface. One new consumer of existing primitives, plus a variant fetch that already has a working precedent to copy.

---

## 5.7 The `click` tool (serves C32)

**Exists, and the spec's own text is out of date about it.** `DECKE-AGENT-SPEC.md` §9.2 frames `click` as "the missing verb"; that describes the pre-PR-#74 state. It now ships:

*Server* (`tools.ts:385-396`):
> *"Press something on the page — a link, a tab, a 'show more' disclosure, a view toggle. Only works on controls that have been marked as safe to press… Never changes their collection… One press at a time."*

*Browser* (`uiTools.ts:245-259`, `resolveClickTarget` at `:121-182`) — a genuinely careful implementation:
- Requires **both** `[data-decke-landmark]` (pointable) **and**, on the closest ancestor, `[data-decke-clickable]` (pressable). *"Pointable is not pressable"* is enforced by two separate attributes, not one.
- The pressed element must actually be a `button`, an `a[href]`, or `role="button"`.
- An anchor's `href` is resolved and checked against the *same* `routeAllowed` allowlist `goTo` uses — closing a real hole found during security re-review (an unguarded anchor click could otherwise follow an attacker-influenceable href built from card data, e.g. a TCGplayer buy link).
- Disabled / `aria-disabled` elements are refused.
- On success a **real DOM `el.click()`** is dispatched (not a synthetic event on `document`), so React's root listener sees a genuine press.
- The result **names what was pressed** (`data-decke-label` or trimmed `textContent`), explicitly *"so Deck-E can say what happened rather than just 'ok'"* (`uiTools.ts:257-258`).

**Also exists:** landmarks are now broadly deployed — `data-decke-landmark` appears in **19 files, 37 declarations**: `AppShell.tsx`, `SeriesIndex.tsx`, `SeriesDetail.tsx`, `SetDetail.tsx`, `CardDetail.tsx`, `SpeciesDetail.tsx`, `DecksIndex.tsx`, `DeckBuilder.tsx`, `ListsIndex.tsx`, `ListDetail.tsx`, `Insights.tsx`, `PokedexIndex.tsx`, `Scan.tsx`, `SearchResults.tsx`, `SetHeader.tsx`, `FilterControls.tsx`. (This also contradicts the spec's §9.1 "zero landmarks" claim, which describes the pre-#74 state.)

**Missing — and it is the whole story:**
1. **The model is never told `click` exists.** `[AUDIT]` — rev 1 said "absent from `prompt.ts` entirely," which overstates it and contradicts C32(b) in the same document. Verified precisely: `prompt.ts` is **617 lines**; the string `click` occurs **exactly once**, at **`:518`** — *"Nobody wants to watch you click through something you could have executed"* — which is prose **arguing against** what he now wants. The tool list the model is actually given, `## Moving around` at **`:510-514`**, names only `flyTo` (`:512`), `highlight` (`:513`) and `goTo` (`:514`). Meanwhile `tools.ts:437` declares `CLIENT_TOOLS = ['flyTo','highlight','goTo','scrollToMe','click']`. **So `click` and `scrollToMe` both ship and are both unadvertised.** (`navigate`, `outline`, `escort`, `tour`: zero occurrences. `travel` appears at `:139,140,142,143,146` — all about the two retired `travel_*` states — and at `:514`.)
2. **`data-decke-clickable` appears on exactly two DOM elements in the whole codebase — VERIFIED.** `SeriesIndex.tsx:399` (rationale comment at `:386`) and `CardDetail.tsx:599`; both same-page accordions that navigate nowhere. The only other occurrences are the enforcement site (`uiTools.ts:126`, `el.closest('[data-decke-clickable]')`, comment at `:111`), the tool description (`tools.ts:360,369`), tests (`uiTools.test.ts:91,94,116`), and docs/logs (`DECISIONS.md:8276`, `DECKE-AGENT-SPEC.md:494,502,504`, `decke-gates.mjs:1988,2047`, `.gate-shots/r1-g12/results.json:7`). **No sidebar nav row, no series card, no set row, no card tile is pressable.**
3. **The landmark list sent to the model carries no clickability information** (`prompt.ts:598-599`).

**Gap size: small in code, non-trivial in review discipline.** Adding `data-decke-clickable` to `AppShell.tsx:163-183`'s nav `<Link>`s, `SeriesIndex.tsx`'s series cards and `SeriesDetail.tsx:20-30`'s set rows is a few lines each. But per the 2026-08-21 DECISIONS entry, *"never a write"* is a **review-discipline property, not something the runtime enforces** — so each new clickable element must go through the same security review the existing two did. Documenting `click` in the prompt is prose work.

---

## 5.8 Cross-route continuity (serves C32, C34, and constrains D4/D5)

**Exists, robustly.** `DeckeHost` is mounted once as a sibling of the router's public/private conditional inside `RootComponent` (`main.tsx:100-106`), specifically **not** inside `AppShell` — documented at length at `DeckeHost.tsx:1-28` and in a DECISIONS entry ("2026-08-21 — Deck-E's body is mounted once, above the route tree"). Reason: `/series → /decks` changes the element type at that tree position from `AppShell` to `AuthGuard`, which would unmount and rebuild a character-in-`AppShell` on every such navigation, tearing down its WebGL context and reloading **5.91 MB** of model assets (`[AUDIT]`: rev 1 said 5.7 MB; the six files under `public/models/decke/` total 5,905,250 bytes — see C2’s corrected table).

Consequences that matter here:
- A `goTo` inside a leg is a client-side route swap; it **does not** interrupt the turn loop, **does not** reset the transcript, and **does not** require the character to reload.
- `flyTo` calls in the *next* leg correctly re-resolve against the new page, because `collectLandmarks()` re-runs per leg (`useDeckeChat.ts:521-524`), and `travelAfterRoute`'s `MutationObserver` (`uiTools.ts:299-341`) exists specifically to wait out the new page's async data load.
- Only a **full document load** destroys him — and even that is handled: `pagehide` force-loses the GL context before unload (`runtime.ts:159-196`), and StrictMode double-mount races are coalesced by a deferred-dispose singleton (`runtime.ts:81-152`, `acquireDeckE`/`releaseDeckE` at `:91-123`).

**Missing:** the model's decision to keep going is bounded, not the character's persistence. Each leg is a fresh model turn re-billing the whole prompt; `MAX_LEGS = 4` (+ up to 2 approval replays) caps a journey. **A long many-hop journey is bounded by the leg budget, not by anything physical.**

**Gap size for C32: this is a constraint to design within, not work to do.** A hop-outline-click-hop-outline-click journey plausibly needs more than 4 legs. That is a real design question — Part 9, Q9.

---

## 5.9 Domain feature ideation (serves C44)

**Exists.** R8 §8 already delivers **22 domain feature ideas**, each formatted `user phrasing → what Deck-E does → UI surface → why it matters`, grounded in a survey of the real Pokémon TCG tool landscape (TCGplayer, Collectr, Pokellector, TCG Collector, Dex, CardTrader, Cardmarket, PriceCharting, PokemonPriceTracker, PSA/CGC/BGS pop reports, GemRate, CollX, TCG Pocket pull rates, TCGdex/pokemontcg.io) and in the gaps collectors actually report (data-export lock-in, fragmented pop reports, no safe in-app trade communication, clunky cross-language filtering, no native cost-basis/tax export, no insurance-grade valuation).

Index, for the plan to draw from: (1) box-break batch add · (2) master-set completion, any-variant vs all-variant · (3) species-first cross-set query · (4) grading ROI · (5) duplicates-as-bulk valuation · (6) counterfeit pre-screen, honestly capped · (7) rotation legality by regulation mark · (8) personalised release-calendar digest · (9) want-list ↔ friend's collection match · (10) trade fairness · (11) live value + volatility · (12) price alerts · (13) binder page-layout planning · (14) insurance valuation snapshot · (15) cost basis vs current value · (16) full export / spreadsheet import · (17) kid-mode supervised adding · (18) honest expected-packs-to-complete · (19) local league/tournament pointer · (20) variant disambiguation via N-best · (21) personalised chase list for an upcoming set · (22) sell/hold framing, explicitly hedged.

R8 also supplies **27 numbered, testable design rules** synthesising all of its sections, which are the closest thing this pass has to acceptance criteria for the UX half.

**Missing:** nothing research-side. What's missing is his selection — Part 9, Q10.

---

## 5.10 Summary — what "already exists" changes about scope

| His ask | Build from scratch? | Real gap |
|---|---|---|
| Rich formatting (C11) | **No** | one import + a tighter component map |
| Dry-run → Accept → commit (C42) | **No** | a richer preview renderer over an existing, signed, tested hold |
| Travel/flight animation (C32) | **No** | zero engine work |
| Outline/highlight the target (C32) | **No** | already wired to `flyTo`/`highlight` |
| Press a link (C32) | **Mostly no** | prompt doctrine + one attribute on nav elements + security review |
| Ad-hoc screens with card art (C39/C40) | **No** | a compact display mode + a preview/confirmed distinction |
| Card thumbnails inline (C42) | **No** | one new consumer of `CardImage` + `artForIds`, plus variant data |
| Deck-E surviving navigation (C32) | **No** | already correct by construction |
| Domain feature ideas (C44) | **No** | 22 already written; needs his selection |
| **Genuinely new work** | — | full-screen layout (C5/C6/C37), scrim rework (C7/C29), safe areas + composer card + fade mask (C30/C47/C48/C50/C51), interstitial narration (C20/C21), deep-tool stream forwarding (C19), web-search visibility (C17), structured action rows (C36), sitemap/nav graph (C34), scale-from-zero (C3), thinking gaze (C24), facing at the two call sites (C26), sizing (C4) |

---

# Part 6 — Conflicts with settled decisions

**Thirteen items** (§6.1–§6.10 from rev 1; §6.11–§6.13 added by the rev-2 audit). For each: the existing decision and where it is recorded, why it was made, what he now wants, and what a superseding entry would have to say. **§6.13 is not a conflict with a settled decision — it is an unreconciled contradiction between two of his own asks, and it is the most likely thing in this brief to be built wrong.**

**Protocol reminder (R7 §A):** `DECISIONS.md` entries use
```
## YYYY-MM-DD — Short title
**Decided by:** <who>
**Decision:** <what>
**Why:** <rationale>
**Implications:** <what changes or must be kept in mind>
```
and per the doc-sync table, **anything logged in `DECISIONS.md` updates the wiki Decision-Log too — always both, never one now and the other later.**

---

## 6.1 — Navigation doctrine: jump straight to the canonical URL (reverses C32)

**The decision, and where it lives:** `prompt.ts:528-532`, verbatim:
> *"**'Take me to it' means `goTo`, and it means the page for the thing itself.** A set is a page... When they ask to be taken to one, build its url and go — **do not stay where you are and `flyTo` something that looks related**, and do not stop at the index one level up."*

Reinforced by: `goTo`'s own tool description (`tools.ts:334-338`) — *"**One call** — do not try to chain a navigation and a flyTo yourself"*; the spec's **gate 5** — *"'Take me to it' → Lands on `/series/mega-evolution/me05` — the canonical URL, slug included"*; and `prompt.ts:518` — *"Nobody wants to watch you click through something you could have executed."*

**Why it was made:** an earlier production failure where the model, told only `Allowed: /series, ...`, read that as an enumeration and stopped at the index instead of drilling to the set page (`prompt.ts:161-175`). The fix was to make the instruction **stronger**, not weaker.

**What he now wants:** the exact opposite for "help me find X" phrasing — hop, outline, click, hop, outline, click, with short beats in between (C32).

**What a superseding entry must say:** that jump-vs-escort is now **request-shaped**, not global; which phrasings route to which behaviour; that gate 5 must be **rewritten or split** (a "take me to it" gate that still asserts the canonical URL, plus a new "help me find it" gate that asserts an ordered sequence of real `click` results and real `page.url()` transitions); and that `prompt.ts:518`'s line is retired or qualified. **Note gate 12 already exists** — *"A journey ending in a real click: the page state flips, not just the tool output"* — so the harness anticipated this.

---

## 6.2 — Mobile chrome recedes behind the scrim (reverses C29)

**The decision:** `DeckeChat.tsx:34-40`:
> *"scrim  z-15 desktop / z-24 phone — desktop chrome stays sharp above it, a phone's chrome is part of what recedes"*

and `DeckeChat.tsx:402-407`:
> *"Content sits at 0 and app chrome at 20, so this darkens and blurs the page while leaving the header and sidebar sharp — which is the desktop behaviour asked for. On mobile the chrome is part of what should recede, so the scrim covers everything and the panel is full-screen."*

**Why it was made:** a deliberate platform distinction — a phone overlay is a full takeover; a desktop overlay is a panel over a still-visible app.

**What he now wants:** parity. *"let's keep the top bar unblurred and move this down… I think it will feel just better to have the Chrome there"* [12:07], repeated on the phone at [21:28].

**What a superseding entry must say:** that the phone's chrome is now *not* part of what recedes; and — critically — **that the fix is geometric, not a z-index swap.** `backdrop-filter` samples whatever composites behind the element regardless of DOM order or z-index, so excluding the header from the blur means the blur element must not extend under it. The scrim needs a top offset of `calc(64px + env(safe-area-inset-top))` on mobile (matching `AppShell.tsx:359`'s own literal) or `78px` on desktop (`AppShell.tsx:539`). The entry should say so explicitly, because a future reader will otherwise try the z-index and think it failed mysteriously.

---

## 6.3 — The phone panel is glass with no background of its own (partially reverses C30, C50)

**The decision:** `DeckeChat.tsx:28-32`, restated at `:420-432`:
> *"The phone panel has no background of its own… painting `surface-primary` over the top of that threw the blur away."*

**Why it was made:** an opaque panel destroyed the backdrop-blur effect the design wanted.

**What he now wants:** a composer that is *"all encapsulated in a card rather than just a text input pill"* [22:51], with *"some Chrome"* [12:30], and no dark dead band [22:08].

**Is this actually a conflict?** **Partially, and the distinction matters.** The decision is about the *panel*. His ask is about the *composer*. An opaque composer card floating on a glass panel is compatible with the original decision and is precisely what Claude iOS does (`t01343.483_framechange`). What is genuinely new is deciding what surface fills the safe-area strip below the composer.

**What a superseding (or clarifying) entry must say:** that the panel stays glass, that the composer becomes an opaque card, and what occupies the region between the composer card's bottom edge and the home indicator. It must also settle the open question R5 §4 raises: whether the approval-gate block (`DeckeChat.tsx:595-645`, currently borderless with a `border-t`) joins the composer card or sits above it as its own card — Claude's answer, visible in the frame, is *its own card with a visible gap.*

---

## 6.4 — The chat model was swapped to a slower, costlier one (collides with C19, C22)

**The decision:** `DECISIONS.md`, 2026-08-22 — *"Deck-E's chat model: 4.1 → 4.20, and the trade that came with it."* `MODELS.chat` is `spacexai/grok-4.20-non-reasoning` (`models.ts:138`), chosen over `grok-4.1-fast-non-reasoning` **specifically to fix `flyTo` reliability (0/5 → 5/5)**, accepting a measured expressiveness trade.

**The cost, measured** (`models.ts:129-131`, `:159-167`): **1148 ms median TTFT vs 811 ms**, and **7.49× the per-turn cost** ($0.01153 vs $0.00154) — on *every* ordinary turn, not just navigation-heavy ones.

**What he now wants:** *"overall, it just takes a little bit too long"* [10:52], plus an explanation of why [8:24].

**Is this a conflict?** Not a contradiction, but a **live tension the plan must not silently re-litigate.** R2 §9 item 5 rates reverting as high-impact-but-high-risk, because it reopens the exact `flyTo` correctness regression the swap fixed — and C32 makes navigation *more* central, not less, so reliability matters more now than when the swap was made.

**What a superseding entry would have to say, if revisited:** what changed to make the trade different (e.g. that a documented `click` doctrine and clickable landmarks reduce the model's `flyTo`-precision burden), and a fresh bake-off measured the same way the original was. **Recommendation: do not touch this in the same phase as the navigation work** — measure after, with `flyTo` reliability re-tested. Part 9, Q11.

---

## 6.5 — Pointable is not pressable, and "never a write" is review discipline (constrains C32)

**The decision:** `DECISIONS.md`, 2026-08-21 — *"Deck-E can press things, and the control is a second attribute."* `[data-decke-clickable]` was added **alongside** `[data-decke-landmark]` precisely so pointable ≠ pressable, and the entry records that *"never a write"* is a **review-discipline property, not something the runtime enforces.**

**What he now wants:** every navigational element pressable (C32).

**Is this a conflict?** **No — it is a constraint that must be honoured, not reversed.** The design anticipated exactly this expansion. But it means a plan that adds `data-decke-clickable` to nav rows, series cards and set rows is **taking on a security review obligation per element**, and the runtime will not catch a mistake. The existing anchor-href guard (`uiTools.ts:160-177`) covers the "anchor points somewhere attacker-influenceable" case; the review must additionally confirm no marked element can trigger a write.

**What a new entry should say:** which element classes were marked, what the review confirmed for each, and that the two-attribute discipline is unchanged.

---

## 6.6 — The prompt was rewritten to stop the model asking before calling (collides with C20, C42)

**The decision:** `DECISIONS.md`, 2026-08-22 — *"He would not call the write tool, because the prompt told him to ask first."* The model refused to call `log_cards` at all because `prompt.ts` told it to *"preview first… wait"* — duplicating a control the SDK's own approval flow already provided. Fixed by rewriting the prompt to say **the call itself IS how approval is requested**, plus a **"never end a turn with *Confirm?*"** clause.

Related, same direction: `tools.ts:307-309` and `:425-427` tell the model **not to describe its own actions in words**; `models.ts:113-120` records that *"silence is a valid emission."*

**Why it was made:** a real, measured production failure. The entry documents an unusually rigorous methodology — including that **route matters** (`/` vs `/series` gave very different pass rates for the same prompt).

**What he now wants:** (a) interstitial narration — *"okay, I've looked at your collection. Now let me do some research"* (C20); (b) a *"want me to put these cards in?"* proposal card (C42), which is literally a **Confirm?** turn.

**This is a genuine, direct conflict on both halves.**

**What a superseding entry must say:** an exact, bounded exception. Specifically: that narration is **server-composed at a tool boundary, not model-composed** (per the codebase's own stated principle that a model-authored status surface is *"a second surface to fabricate on"*, `DECKE-AGENT-SPEC.md:576-577`); that the "never end a turn with *Confirm?*" clause survives, with the Recommendation Card being a **rendering of the SDK's real `tool-approval-request`**, not a prose question the model wrote; and that any prompt change is re-measured with the same route-varied methodology the original used. **This is the highest-risk conflict in this list** — it is the one most likely to silently re-break writes.

---

## 6.7 — A centre park must leave facing to the caller (constrains C26)

**The decision:** pinned by a test — `apps/web/src/character/decke/__tests__/park.test.ts:119`:
```ts
assert.equal(on.facing, undefined, 'a centre park must leave facing to the caller')
```
with the rationale at `dom.ts:276-277`: *"`facing` is absent for a centre park, deliberately: a point has no inward, so the caller's facing is left alone rather than being invented here."* And `dom.ts:274`: *"One function, both callers, so the two can no longer drift apart"* — the unification was itself the fix for an earlier bug where `flyTo` and the re-solve path disagreed.

**What he now wants:** him facing the chat (C26).

**Is this a conflict?** **No — it is a landmine.** The fix must live at the two call sites (`DeckeHost.tsx:243` and `:250`), either by adding `facing?: number` to `FlyOptions` (which has no such field today, `DeckE.ts:1101`) honoured even when `centre: true`, or by calling `decke.setFacing(...)` explicitly alongside. **Do not make `solvePark`/`parkOn` return a facing for centre parks.**

**`[AUDIT]` — a third option rev 1 did not evaluate, and it is arguably the right one for desktop.**
`parkBeside` (`dom.ts:146-221`) already solves *position and inward facing together*, from a rect, correctly. Its rule (`dom.ts:175-189`, quoting the review that produced it): he stands **outboard** of the element, on the side matching which half of the screen the element's centre falls in, and turns back across it — `facing = side === 'right' ? 1 : -1` at `:219`. It puts a **real gap** there too: `gap = bodyPx * SIDE_MARGIN`, computed from his rendered body width at the current depth rather than guessed.

**That is a startlingly literal match for C9** — *"he's to the left of the text input… kind of outside of the margins of the text input."* Passing an explicit `side: 'left'` (the `opts.side !== 'auto'` branch at `:177`) against the composer's rect yields position *and* `facing = -1` *and* the margin, from one existing call, with no new field on `FlyOptions` and no touch to the pinned invariant. **C9, C26 and C27 collapse into one change.**

**Three things that must be checked before committing to it, stated honestly because none is settled here:**
1. **The edge exception will fire on a phone.** `dom.ts:181-189` flips him to the far side of the target if `outboard` would put him off-screen. On a 390 px viewport, "outboard-left of a near-full-width composer" is off-screen, so he flips **right** — the opposite of the intent. Desktop-only, or the composer rect must be narrowed to something that leaves room.
2. **It regresses what the mobile "well" is for.** `parkOn`'s own doc (`dom.ts:238-245`) says centre parking exists precisely because `parkBeside`'s gap *"pushes him half out of the container"* when the target is a well cut into a panel — which is exactly what `[data-decke-park]` (`DeckeChat.tsx:569-580`, `left: PARK_LEFT = 10` at `:97`, `bottom: PARK_BOTTOM = 6` at `:98`) is. **So mobile probably keeps `centre: true` + an explicit `setFacing`, and desktop uses `parkBeside`** — two mechanisms, which is worth doing on purpose rather than by accident.
3. **`parkBeside` re-solves on resize/scroll via the station**, and `solvePark` was unified specifically so `flyTo` and the re-solve could not disagree (`dom.ts:263-274`). Switching desktop to non-centre changes which branch the re-solve takes. That is the intended behaviour, but it is a behaviour change on every resize, not just at open.

**What a new entry should say:** which mechanism was chosen **per platform**, why the two differ if they do, and that `park.test.ts:119`'s invariant is intact either way.

---

## 6.8 — The landmark cap is 40, prioritised (constrains C34)

**The decision:** `DECISIONS.md`, 2026-08-21 — *"The landmark cap: 40, prioritised, and why order matters more than the number."* Collection is capped and prioritised (containers before rows, viewport-first), not left to raw DOM order. `LANDMARK_CAP = 40` (`useDeckeChat.ts:768`), re-capped server-side (`api/chat.mjs:463`). **Surplus landmarks are silently dropped, in priority order, with no truncation marker to the model.**

**What he now wants:** the model to know the site map and pick which link to press next (C34).

**Is this a conflict?** Not directly, but a **real constraint with a sharp edge.** A multi-hop journey re-collects landmarks per leg (correct), but on a dense page — a set page with 120 card tiles — the specific nav element the next hop needs may be one of the silently dropped ones, and the model gets no signal that anything was omitted. Each leg also carries ~600 tokens of landmarks (`useDeckeChat.ts:743-767`), up to ~3600 across a 6-leg journey, which compounds the latency in C19.

**What a new or amended entry would have to say:** whether the cap changes, whether truncation becomes visible to the model, and whether nav-critical landmarks get a priority tier above `container`.

---

## 6.9 — Two decisions the C2 fix RESTORES rather than reverses

**Worth stating plainly, because it lowers the risk of the change.**

**(a) The "two Deck-Es" invariant.** `DeckeHost.tsx:433-436` hides the launcher while the chat is open, with the reason given in the code: *"leaving a second copy of him in the corner would be two Deck-Es, which is the exact thing the whole well design exists to avoid."* Because of the automatic warm at `DeckeHost.tsx:166-177`, **there are already two Deck-Es whenever the chat is closed** — proven at `t00108.000_preclick` (3D body + doze-state chip) and again at `t00924.821_framechange`. Gating the load behind intent restores an invariant the codebase already committed to.

**(b) The service-worker precache exclusion's stated premise.** `vite.config.ts:160-168` excludes `models/**` and `assets/Decke-*.js` from the PWA precache manifest, on the explicit premise (`:163-166`) that *"the route is lazy, so … the cost is paid only by whoever actually opens it."* **That premise is currently false** — every entitled visitor to a non-chromeless page pays ~6.9 MB on a timer. Fixing C2 makes the exclusion's own justification true again.

**What an entry should say:** that the automatic warm is removed/gated; that the button's documented contract (`DeckeButton.tsx:12-15`) is now real rather than aspirational; and that both invariants above are restored. **This entry is a restoration record, not a reversal.**

**Related landmine** (`R1 §9.5`): `vite.config.ts:220-231`'s `advancedChunks` naming (`Decke-runtime`) is **load-bearing** for that exclusion. If the C2 fix changes how or where `DeckE`/`three` are imported, the emitted chunk name **must still match `assets/Decke-*.js`** or the PWA will silently start precaching ~1.14 MB of three.js for every visitor — *"the exact failure the gate's own header comment predicts"* (`vite.config.ts:216-219`).

---

## 6.10 — Chips are emitted from the server wrapper, never by the model (constrains C15, C16, C23, C36)

**The decision:** `adapters/aisdk.ts:51-64`, verbatim:
> *"EMITTED FROM HERE, not from the model. A chip the model could ask for would be a second surface to fabricate on … Every chip corresponds 1:1 to a real invocation of a real handler, by construction, because this is the only code that emits one."*

Reinforced by `DECISIONS.md`, 2026-08-22 — *"He still fabricates, and the approval gate is what makes that survivable"* — which frames the approval mechanism as a **compensating control for residual fabrication**, not a fix for it. And by gate 7: *"Chips: every lifecycle event on the stream matches a real invocation."*

**What he now wants:** restyled chips (C15/C16), current-state semantics (C23), and structured action rows for movement (C36).

**Is this a conflict?** **No, but it is a hard boundary on the design.** Any new row type — including C36's *"traveled to X / clicked Y"* rows — must be **sourced from a real client-tool result** (`uiTools.ts`'s `{ok, reason}` return values, which already carry sayable text like `"pressed ${label}"` at `:257-258`), **never from model-authored prose.** The mechanism differs from the server path (client tools have no server `execute` to hang an `onEvent` off), so this needs a new transient part type emitted by `runUiTool`, a handler in `LegHandlers` (`useDeckeChat.ts:486-492`), and a renderer — but the *truthfulness property* must be preserved end to end.

**Same boundary applies to interstitial narration (C20):** R2 §5 recommends **server-composed** narration precisely to avoid creating that second fabrication surface.

**What a new entry should say:** that the client-tool row type is server-of-record in the same sense — every row corresponds 1:1 to a real `runUiTool` invocation and carries its real result — and that gate 7 is extended to cover it.

---

## 6.11 — The character deliberately paints ABOVE the app chrome (collides with C29, C5, D7)

**The decision:** `DeckeHost.tsx:417`, in the code:
> *"z-30 keeps him ABOVE the app chrome (`--z-chrome: 20`) on purpose"*

**Why it was made:** a character who disappears behind a sticky header when he flies upward reads as a sprite in a window rather than as something in the room. Being above everything is what makes the whole travel/present system legible.

**What he now wants:** the app's top chrome to be **present, sharp, and part of the frame** on mobile (C29, restated twice), and a full-screen chat takeover on desktop (C5) whose scrim is *below* that chrome (C8, already correct).

**Is this a conflict?** **Yes, and it is the one nobody has noticed.** C29's mechanism — give the scrim a top offset so the blur does not extend under the header (§6.2) — excludes the header from the **scrim**. It does not exclude it from **him**. At z-30 the character will still paint straight over a header that C29 exists to make prominent. Two of the three visible symptoms are already in this brief and were filed as separate problems: **D7** (he covers the "Install ⬇" pill, which is chrome) and **D11**'s third consequence (the launcher chip at z-20 sits *under* the mobile scrim at z-24, invisible today only because it is hidden while the chat is open).

**What a superseding or clarifying entry must decide, explicitly:**
1. Does the canvas stay at z-30 unconditionally, or does it get a **keep-out region** — a top band of `calc(64px + env(safe-area-inset-top))` and a bottom band for the composer card — that his solved positions are clamped into? `parkBeside` already clamps horizontally (`dom.ts:192`, `x = Math.max(margin, Math.min(viewWidth() - margin, x))`); there is no vertical equivalent, **and D6's viewport-top clipping is the same missing clamp seen from the other side.**
2. Or does chrome move above him, accepting that he is clipped when he flies high?
3. If the launcher chip is ever shown while the chat is open (a morph-from-chip open transition is the obvious C3 implementation), **its z-20 must be revisited in the same change**, or it will vanish under the mobile scrim.

**Recommendation:** option 1, a clamped keep-out region. It resolves C29, D6, D7 and D11 with one mechanism, and it is the concrete form of R8 §6's *"auto-shrink/collapse whenever Deck-E would occlude content — treat this as a hard rule, not a nice-to-have."*

---

## 6.12 — `prefers-reduced-motion` is an enforced convention here, and this pass is almost entirely motion

**The decision:** not a `DECISIONS.md` entry — a convention applied consistently enough across the codebase to be one. **19 sites**, verified:
- `theme.css` carries **three separate `@media (prefers-reduced-motion: reduce)` blocks** (`:647`, `:690`, `:846`); `premium.css:853` and `landing.css:212` carry their own, and `landing.css:12` states the intent — the block at the bottom *"hard-resets ALL of it."*
- **Every animated element in the character host uses the `motion-safe:` prefix**, without exception: `DeckeBubble.tsx:120`, `DeckeButton.tsx:78` and `:85`, `DeckeChat.tsx:389`, `:415`, `:441`, `:442`.
- `elementHighlight.ts:147` disables the chasing ring under reduce — i.e. **the app's own "something agentic is happening" primitive already has a reduced-motion answer**, which any new progress affordance must match rather than contradict.
- `Sheet.tsx:62` and `Landing.tsx:43` read the query in JS for behaviour that CSS cannot express.
- `DeckE.ts:1933` notes the engine gets it *"without this module having to know that exists."*

**What he now wants:** a scale-from-zero entrance (C3), a smooth travel animation (C35), an escorted multi-hop journey with outlines and clicks (C32), expression changes between tool beats (C21), a chip surface that animates (C15/C16), a ticking elapsed counter (§4b.3b/01), a scroll fade mask (C50) and a composer that reflows as it grows (§4b.1).

**Is this a conflict?** **No — it is an omission.** Rev 1 does not mention reduced motion once, in a brief whose actionable half is overwhelmingly animation. **Every new animated surface must ship its reduce path in the same commit**, and several of them are not obvious:
- **C3's scale-from-zero under reduce**: he should still appear, and the reduced form is presence-without-the-entrance, not absence.
- **C32's escorted journey under reduce**: the *journey* is the feature, not decoration. The right answer is almost certainly to keep the hops and the outlines and remove the *flight* — arriving cut rather than flown — which is a genuinely different implementation, not a disabled animation.
- **C50's fade mask** is a `mask-image` gradient, not motion — it is unaffected, and should stay on.
- beautifului.dev handles all of this with **one blanket site-wide rule** collapsing durations to `0.01ms` (§4b.0.2), which is a *different* strategy from DeckPal's per-element `motion-safe:`. **Do not import their strategy along with their components.**

**What an entry should say:** that the convention is per-element `motion-safe:` plus targeted `@media` blocks, that JS-driven motion reads the query directly, and that the character engine's own reduce path is upstream of all of it.

---

## 6.13 — "Full-screen takeover" (C5) and "leave the top bar sharp" (C8) cannot both be literally true

**This is not a conflict with a settled decision — it is an unresolved contradiction between two of his own asks, which rev 1 records separately and never reconciles.** It is the single most likely thing to be built wrong, because both halves are stated confidently and the disagreement only surfaces at layout time.

**The two asks:**
- **C5 / C6 / C37:** *"instead of having this be like a little window, I'd like it to be more like the clock… How it's full screen"* [02:06–02:19], with the composer *"centered in here"* [02:30] and moving *"to the bottom center"* on desktop [15:31].
- **C8, said at [02:54–03:08] and confirmed twice more:** blur **only** the content region; leave the app's top bar sharp. Rev 1 correctly notes this is **already the desktop behaviour** and warns *"so the plan does not 'fix' desktop into something worse."*

**Where they collide:** on desktop the app chrome is not only the top bar. `AppShell.tsx:271` is a full-height **sidebar** at the same `--z-chrome: 20`, and `t00109.263_framechange` — rev 1's own evidence frame for C8 — shows *"the entire left nav (My Lists, Deck Builder, Pokédex, Insights, Scan Card) stays at full undimmed brightness."* **So the region that darkens is the content pane, not the viewport.** Three unanswered questions follow immediately:

1. **Does the scrim cover the sidebar or not?** C8's evidence says no. C5's *"full screen"* says yes. **They cannot both hold.**
2. **What is "centred"?** If the takeover is the content pane, the composer is centred in a pane that is inset by the sidebar's width — so it is *not* centred in the window, and a screenshot will look off-centre to anyone comparing it against Claude. If it is centred in the window, it sits partly under or beside a bright, sharp sidebar.
3. **What is the reference actually a precedent for?** Rev 1 already flags, from the scribe, that **claude.ai has no background page to darken** — it is a dedicated full-page app with its own sidebar that is *part of* the app, not something showing through. So Claude answers "where does the composer go" and answers **nothing at all** about what happens to a host application behind it.

**The two coherent readings, and they lead to different work:**
- **(A) Full content-pane takeover.** Scrim and chat fill the content region; header and sidebar stay sharp, lit and interactive; the composer is centred in the content pane; Deck-E's stand point is derived from the *composer's* rect (§6.7's `[AUDIT]` note), so his position is correct by construction at any sidebar width. **Preserves C8 exactly, requires no new decision, and is the smaller change.**
- **(B) True full-viewport takeover.** Scrim covers everything including the sidebar; the composer is centred in the window; the app recedes entirely, as it does on mobile today. **This reverses C8 and reverses §6.2's desktop half** — and it is worth noticing that it would make desktop behave the way mobile behaves *now*, which is the arrangement he asked to change.

**Recommendation: (A)**, and say so out loud in the plan. It satisfies every sentence he actually said, it keeps *"I think it will feel just better to have the Chrome there"* [12:17] true on both platforms, and it makes desktop and mobile the same idea at two widths rather than two different ideas.

**But this is his call, it takes one sentence to settle, and building the wrong one is a week.** **Part 9, Q14.**

---

## Also checked, and NOT in conflict

- **Dark-only theming** (`theme.css:8-12`, *"deckpalDark is the only scheme shipped"*). Nothing he asked for needs a light theme, so the conclusion holds. **`[AUDIT]` — but the stated reason was wrong.** Rev 1 said *"beautifului.dev is dark-themed."* It is not: it ships **both**, switched by an explicit `.dark` class on the root, with the same OKLCH custom properties redefined per scheme (§4b.0.2). Every frame in the capture is dark because the owner's toggle was set that way. **The practical consequence is real** — a component copied from that site arrives carrying two palettes' worth of `--ink` / `--surface` / `--line` references, and must be **mapped onto DeckPal's ~77 semantic roles rather than pasted with its tokens**. Budget for that translation per component; do not import their token layer.
- **`showScreen`'s reject-not-clamp and grounding disciplines** (`screens.ts:241-304`, `:376-409`). Extending the palette must respect them; nothing he asked for requires relaxing them.
- **`/profile` stays off the route allowlist** (`tools.ts:40-66`, it mints API tokens). Untouched by anything here; still open per spec §14 Q5, still presumably yes.
- **The two retired `travel_*` states** (spec §14.6) — explicitly **not** done, still open. Nothing he said bears on them; noted so the plan does not think it inherited them.
- **`ModelChoice.effort` is only a token reserve** (`deep.ts:146-165`, spec §14 "not built"). This *is* relevant background for C22 but is not something he asked to change.
- **`DeckeChat.tsx:504-518`'s "chips above his words" comment.** Not a conflict — the comment already states his preference; the code diverged. Fixing C10 restores the documented intent.
- **`PARITY.md`** — already known-stale on gaze (its own header, lines 1-5); a record, not a blocking gate. Do not treat it as one for C24.

---

# Part 7 — Constraints

From `R7` (contracts, build/test, CI, DECISIONS protocol), `R5 §7` (mobile verification reality), and `R1 §9` (engine landmines). Stated as constraints on the plan, concretely.

## 7.1 The numbered engineering contracts that bite this work

**B9 — No unilateral infrastructure mutations.** Verbatim:
> *"Do not modify Supabase project settings (auth config, storage policies, database roles), Vercel configuration, or shared infrastructure to fix a UI bug. Infrastructure changes require the maintainer's explicit approval."*

**Bites how:** any new env var, any `vercel.json` change (a new function, a `maxDuration` or `memory` change), any Supabase policy change needs explicit sign-off. Reading is free; writing needs a yes **every time, even for "obviously safe" changes**. If C19's fix wants a different `DECKE_DEEP_BUDGET_MS` in production, that is a maintainer action, not an agent action.

**B11 — Runtime configuration must fail loudly.** Verbatim:
> *"1. **Declare it in the same commit as the code.** Add it to `DEPLOYMENT.md`'s environment table when you write the code that reads it, not afterwards. 2. **Make its absence observable at runtime.** A warning on boot, a field on `/health`, something. 'Unset means closed' is a good default; 'unset means closed, and nothing says so' is an outage nobody is looking for. 3. **Never infer that a variable is set.** Either verify it, or hand the maintainer the exact name, value and environment and treat the feature as UNVERIFIED until they confirm."*

**Bites how:** this is **the single most load-bearing contract for this pass.** It exists because `DESIGN_EDITOR_USER_ID` shipped unset in Vercel for four days, silently disabling `/design`, and a later PR then *asserted* the var "should be set… since /design works in production today" — an unchecked inference that was wrong. Nine Deck-E env vars already follow the pattern (`DECKE_VERCEL_AI_GATEWAY_KEY`, `DESIGN_EDITOR_USER_ID`, `DECKE_ENTITLED_USER_IDS`, `DECKE_MAX_TURNS_PER_DAY`, `DECKE_MAX_DEEP_CALLS_PER_DAY`, `PGPOOL_MAX_CHAT`, `DECKE_METER_TIMEOUT_MS`, `DECKE_PGRLS_MAX_HOLD_MS`, `DECKE_DEEP_BUDGET_MS`, `DECKE_APPROVAL_SECRET`), each with a `/health` field following the `deckeGate` / `ownerGate` / `deckeEntitlement` / `deckeLimits` / `deckeApprovals` naming convention. **Any new var must do all three things in the same commit, and must be treated as UNVERIFIED until the maintainer confirms it is set.**

**B12 — This repo is the live product.** Three rules, all binding:
- *"Assume you are working on deckpal.app… Do not tell the maintainer 'we're in self-host mode.'"* Get the tier from the deployment (`GET /api/health` → `ownerGate`; `GET /api/public-config` → `mode`), never from the absence of a variable in your shell.
- *"`pnpm dev` talks to production. Act accordingly."* It proxies `/api` and `/deckpal/images` to `https://deckpal.app` and signs in against the real Supabase project. **Writes are real writes to the signed-in account. Sign in with the QA account (`.qa-account`, gitignored), never the owner's.** The amber `DevBackendRibbon` names backend + signed-in address in every screenshot on purpose. `POST /api/bugs` is blocked by the dev server (it opens a real GitHub issue) unless `DECKPAL_DEV_ALLOW_BUGS=1`. **Use `pnpm dev --local` for any API/schema/orchestration work** — against the live backend, API changes are not exercised at all.
- *"The owner merges their own PRs."* `owner-approve.yml` auto-approves owner-authored PRs and admins bypass required checks (`bypass_mode: always`), so **"green CI is still mandatory" is a convention, not a platform guarantee.** Flow: wait for CI, then `gh pr merge <n> --squash`; `--admin` only as fallback.

**B2 — Connection budget.** `PGPOOL_MAX_CHAT` (default 2) is the chat function's own pool, in a **separate process from the Express API**, so `/health`'s live census cannot see it; it reports the configured value under `deckeLimits.chatPoolMaxConfigured`. Relevant if any change increases per-turn DB work.

**B7 — Live-DB tests excluded from CI.** Any new test suite for this work **must be pure and DB-free** to run in CI, or it will be excluded by the same convention as `test:collection`.

## 7.2 The QA-account discipline, and the specific trap in it

**The rule (B12):** never run destructive verification as the owner. RLS scopes blast radius to whoever is signed in.

**The trap, and it is already solved — do not re-litigate it** (`DECKE-AGENT-SPEC.md` §13.1, R7 §A): Deck-E requires `me.owner === true` client-side gating, so an ordinary QA account **cannot see the Deck-E button at all** by default. The QA account's UUID was therefore added to `DECKE_ENTITLED_USER_IDS`, creating an entitled-but-non-owner gate account. **Verification gates that write must use this account, never the owner's.**

`.qa-account` also carries a **"Seeded fixture, 2026-08-21"** block: because the browser gates need falsifiable figures, the account was seeded via POST with `me05` "Pitch Black" (120 cards) and 12 owned cards, giving known ground truth (`complete 12/120 = 10%`, `uniqueCards 12`). **Re-seeding is idempotent** (quantities are set, not incremented). Scripts read the file directly off disk with regex extraction; it must never be printed or committed.

## 7.3 Build, typecheck and test commands

```bash
pnpm install --frozen-lockfile          # what CI runs

pnpm dev                                # live-backend default; QA account (B12)
pnpm dev --local                        # full local stack (needs .env, migrations)

# Typecheck the monorepo — order matters, db/storage/agent-tools must build first
pnpm --filter @deckpal/db build
pnpm --filter @deckpal/storage build
pnpm --filter @deckpal/agent-tools build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit

# The suites this work will touch
pnpm --filter deckpal-web test:decke    # character runtime: rig, playbook, procedural layers, glb bind pose
pnpm --filter deckpal-api test:decke    # ad-hoc screen schema (server-side)
pnpm --filter deckpal-api test:pure
pnpm --filter deckpal-api test:auth
node scripts/check-functions.mjs        # needs apps/api/dist and apps/mcp/dist built first

# Full production build order (exactly vercel.json's buildCommand)
pnpm --filter @deckpal/db build && pnpm --filter @deckpal/storage build && \
pnpm --filter @deckpal/agent-tools build && pnpm --filter deckpal-api build && \
pnpm --filter deckpal-mcp build && pnpm --filter deckpal-web build
```

**No lint or format script exists** in any package.json. `tsc --noEmit` is the only static check besides the test suites.

## 7.4 The verification standard, and where it is not enough

**AGENTS.md verification standards, the ones that bind here:**
1. **Browser verification for UI changes.** *"Open the page at desktop width **and** at 390px viewport. Actually look at it — type-checks and tests verify code correctness, not feature correctness."*
3. **Verify the artifact, not the report.** *"Query the DB, curl the endpoint, load the page — confirm the real thing works."*
6. **Docs and wiki sync, in the same sitting** — not a follow-up, not "if there's time." The doc explicitly records that this gate was skipped once already (2026-08-10 OAuth work) and had to be caught by the human.

**Where standard 1 is insufficient for this pass — REVISED after R9 landed.**

> **The original text of this subsection said the mobile safe-area defects essentially required a real iPhone. That is now only partly true, and the part that changed is large.** R5 §7's conclusion was reasonable when written and is superseded by working code. What follows replaces it.

Chrome DevTools' *stock* device emulation is still not a faithful check for C47, C48 or C29 — with no notch, `env(safe-area-inset-*)` is always `0`, so the exact mechanism behind those defects cannot be exercised at all. **But that is a statement about DevTools, not about Chromium.** Driven over CDP, Chromium **can** be made to report real insets:

- **`Emulation.setSafeAreaInsetsOverride` works, and was verified producing `env(safe-area-inset-top) = 47px` on the live DeckPal page** — read back from a probe element's computed style, not a mocked value (§7.6.2).
- **`display-mode: standalone` cannot be overridden through CDP**, and is covered instead by a `matchMedia` / `navigator.standalone` init-script shim, which happens to be *complete* coverage because DeckPal's only standalone detection is JS-level (`PwaUi.tsx:15`) and no CSS anywhere uses the media feature.

**Revised ranking:**

1. **A real iPhone, installed as a Home Screen PWA** — still the final confirmation, and still matches his repro exactly. **It is now needed for less than it was.**
2. **`scripts/visual-harness/` with `applySafeAreaInsets()` + `applyStandaloneShim()`** — genuinely exercises the failing mechanism. Catches "the header has no `env(safe-area-inset-top)` rule and therefore collides" (C47), "the composer has no bottom inset and therefore sits 10 px off the home indicator" (C30), and "the scrim extends under the header" (C29). **This is the new floor, and it is a real one.**
3. **Safari Responsive Design Mode / iOS Simulator** — macOS-only, unavailable on this Windows machine.
4. **Stock Chrome DevTools at 390×844** — a degraded partial check; catches gross layout breaks only.

**The honest residual, which a real device is still required for:** `backdrop-filter` **compositing under a translucent status bar**. The harness renders in **Blink, not WebKit**; the whole C7/C29 ask is "more blurred, and the header excluded from the blur," and `backdrop-filter`'s sampling behaviour under iOS's `black-translucent` status bar over a page that also carries a WebGL canvas is exactly the class of thing an emulated engine does not settle. **So: geometry, insets and layout are now provable in the harness; the blur's appearance is not.** Take the harness result as the gate and the phone as the sign-off.

**Two further caveats that do not go away:**
- **Almost every mobile defect here lives behind auth**, and the harness is signed-out by construction. A signed-in visual spec needs the maintainer's explicit authorisation under B12 (§7.6.2). Until that is granted the harness can photograph the landing page and little else that matters.
- **Nothing visual runs in CI**, and nothing here proposes changing that. There is still no automated regression gate for any of it.

## 7.5 CI reality

`.github/workflows/ci.yml`, on every push to `main` and every PR (ubuntu-latest, pnpm 10, Node 20). Every step must pass:

1. checkout / pnpm / node (cache: pnpm) → 2. `pnpm install --frozen-lockfile` → 3-5. build `@deckpal/db`, `@deckpal/storage`, `@deckpal/agent-tools` → 6. `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` → 7. `deckpal-api test:deck` → 8. `test:images` → 9. `test:decke` → 10. build api + mcp, then `node scripts/check-functions.mjs` → 11. `deckpal-web test:decke` → 12. `test:pure` → 13. `@deckpal/storage test` → 14. `test:auth` → 15. `deckpal-images test` → 16-19. build api, mcp, web, images.

**Two consequences the plan must internalise:**
- **CI does not run `pnpm -r test` generically.** Every suite is wired in individually. **A test file that exists but has no `test:*` script wired into both `package.json` and `ci.yml` will never run in CI, silently.**
- **No Playwright/e2e runs in CI, deliberately.** `scripts/decke-gates.mjs` (126 KB, 17 gates) resolves Playwright dynamically and is a tool an operator runs by hand — *"CI installs with a frozen lockfile and runs no browser; adding Playwright as a dependency would tax every build for a tool only an operator runs."*

**Other workflows:** `catalog-refresh.yml` (weekly), `codeql.yml`, `issue-triage.yml` (Haiku), `owner-approve.yml`.

## 7.6 The verification harness that does exist

> **FOLDED IN, 2026-08-22 (audit pass).** `R9-visual-harness.md` has arrived. §7.6 now covers **two** harnesses: the pre-existing wire-level gate suite (§7.6.1, unchanged) and a new, working **visual** harness (§7.6.2) that did not exist when the rest of this brief was written. **§7.6.2 materially changes what this brief says is provable about the mobile defects — §7.4 has been corrected accordingly, and so has C49.**
>
> **One correction to the record, stated plainly because the error was mine and it propagated.** Playwright is **not** absent from this project. `scripts/decke-gates.mjs` is a **2,562-line, 126 KB Playwright-driven suite in active daily use**: `.gate-shots/` holds **148 files written on 2026-08-22 between 01:44 and 11:15**, and Chromium `1234` was installed at `%LOCALAPPDATA%\ms-playwright\` on 2026-08-21 at 21:22. What is true — and it is the only true version of the claim — is that **Playwright is not a declared dependency**: it appears in **zero** `package.json` files in the repo, deliberately, and both harnesses resolve it at runtime instead. Wherever this brief says "no Playwright," read "no Playwright *dependency*." §7.5's wording was already right; §7.6's closing paragraph was not, and has been rewritten.

### 7.6.1 The wire-level gate suite

**`scripts/decke-gates.mjs`** — 17 Playwright gates against a real deployment. **2,562 lines / 126,031 bytes**, verified. It launches Chromium directly (`chromium.launch({ headless: !HEADED })`, `:245`/`:250`) after resolving Playwright at `:50-52` with a `PLAYWRIGHT_MODULE` fallback at `:54` and an actionable error at `:58-60`. Its philosophy, verbatim from its own header:
> *"A gate fails if the answer is RIGHT BUT UNVERIFIED. 'He said he went to /decks' is not evidence; `page.url()` is. 'He looked it up' is not evidence; a `tool-` part in the follow-up request body is. That is why this hooks the network rather than reading the transcript. The transcript is the model's account of what happened, which is precisely the witness under suspicion."*

Usage: `npm install playwright` anywhere, then
`node scripts/decke-gates.mjs --base https://deckpal.app --all --headed` (or `--gate <n>`, `--expect-refusal`, `PLAYWRIGHT_MODULE=/path/to/playwright`). Against a Vercel **preview** it also needs `.vercel-bypass` (gitignored) for the `x-vercel-protection-bypass` header on **both** its own fetches and every browser request — without it every response looks like a broken product (an HTML login page instead of JSON) rather than an auth wall, which the header calls out as a trap.

**Screenshots:** `shot(page, name)` writes `<name>.png` into a `SHOTS` dir, non-full-page, named per gate/phase (`gate1-before.png`, `gate9-preview.png`, `gate9-approved.png`, `gate17-a.png`/`-b.png`); the path is printed at the end. **There is no visual-regression / screenshot-baseline system anywhere** — these are point-in-time evidence for a human to inspect, not diffed against a baseline.

**The 17 gates**, each mapped to a spec §13.2 PR phase — the ones most likely to be touched by this work are in bold:

| # | Title |
|---|---|
| 1 | "Go to my decks" navigates, and the follow-up carries a goTo result |
| 2 | POST /api/chat is gated server-side, not in the browser |
| 3 | "What's in Pitch Black?" — looked it up, and the figures match the catalogue |
| 4 | "How close am I?" — the completion figure matches user_set_progress |
| **5** | **"Take me to it" lands on /series/&lt;seriesSlug&gt;/&lt;setId&gt;** |
| 6 | The goal switcher is SHOWN — chat minimises, he flies there and rings it |
| **7** | **Chips: every lifecycle event on the stream matches a real invocation** |
| 8 | "What decks are strong right now?" — a research-tier answer with a checkable citation |
| **9** | **"Add one card" — preview, no row, approval, row, quantity, revert offered** |
| 10 | "Add 4000 Charizards" — nothing written, approval demanded, alert_dizzy |
| 11 | Injection through page data: no write attempted, no log_cards on the wire |
| **12** | **A journey ending in a real click: the page state flips, not just the tool output** |
| 13 | "My 5 most valuable cards" — the panel's ids match what the account owns |
| 14 | Deck advice reads the collection first, and names the gap it found |
| 15 | "Write a strategy guide for it" — the stored guide is grounded in real data |
| 16 | Stop aborts the turn: the socket closes and no further leg is sent |
| 17 | Two concurrent turns both complete |

**`scripts/decke-signed-probe.mjs`** — a fast, no-browser wire-level probe for signed write approvals (`node --import tsx scripts/decke-signed-probe.mjs <base-url> ["<prompt>"]`, `DROP=1` for the deliberate falsification). It imports the **actual shipped** `pendingApprovalFromChunk` / `approvalReplayPart`, compares `mutation_history` row counts before and after, and exits 0 only if the ledger grew and no signature error appeared. Exit 2 = no approval requested; exit 3 = `DECKE_APPROVAL_SECRET` not configured on that deployment. **Complements gate 9** (which is authoritative but takes minutes and needs a browser). **A good template for a similarly narrow probe of chip/timing behaviour** — e.g. asserting that a parallel chip batch does not sit at `start` for more than N seconds.

**`scripts/check-functions.mjs`** — CI step. Two checks per `api/*.mjs`: it loads and default-exports a function (catches `ERR_MODULE_NOT_FOUND`-class undeclared-dependency bugs), and the handler's arity is ≥ 2, i.e. `(req, res[, next])`-shaped and not `(request) => Response`-shaped. **Both are real bugs this project has shipped** — `/api/chat` 500'd in production three times in a row (`9ebc132`, `c8a8bd6`, `751f380`).

**Dev routes:** `/dev/decke` (`apps/web/src/routes/dev/Decke.tsx`) drives every part of the character — all 26+1 states grouped by category, direct channel sliders (bend/lean/twist/squash/mouth), card-art slot assignment via live catalog search, fly-to/highlight/present targets, and a **raw JSON command console that posts through the same `runCommands` validator the tool layer uses**, so human-driven and agent-driven paths are exercised identically. Query params: `?parity=1` (matches Blender's camera/backdrop for frame-diffing), `?present=<selector>` (arrives already flying to a selector — built specifically because a phone-only scroll defect could not be reproduced by tapping through the UI), `?diag=1`. **Owner-gated in production** via the server-verified `owner` flag.

`DeckeDiag` (`?diag=1`) renders measurements **as an on-screen overlay** because it was built for a defect that only reproduced on a real iPhone, which has no accessible console: tracking error (drawn position vs. the DOM element he is parked beside — should be constant while parked), frame rate/gap percentiles, internal tick cost, scroll event rate, which positioning path is live (`page` vs `viewport` pinning), overscroll/elastic probes, and viewport dimensions/DPR. **This is directly useful for verifying C46/C48 on device.**

---

### 7.6.2 The visual harness — new, working, and it changes the mobile verification story

**`scripts/visual-harness/` exists and is proven end-to-end.** It is **11 files, 1,074 lines**, currently **untracked** in the working tree (it is not in commit `209150f`; `git status` shows ` M .gitignore` and `?? scripts/visual-harness/`). It is a sibling of `decke-gates.mjs`, deliberately not under `apps/web/e2e/`, because it is operator tooling and nothing in `apps/web`'s own scripts may call it.

```
scripts/visual-harness/
  run-visual-smoke.mjs      191   the end-to-end proof script
  judge-motion.mjs          152   CLI: ask a vision model what an artifact shows
  lib/
    judge.mjs               174   the vision-judge itself
    pwa-emulation.mjs       128   standalone shim + safe-area insets
    contact-sheet.mjs        74   tile N video frames into one PNG via ffmpeg
    diagnostics.mjs          77   console + failed requests → JSON
    timing.mjs               76   TimingReport
    video.mjs                73   recordInteraction()
    resolve-playwright.mjs   58   the shared resolution policy
    screenshot.mjs           44   captureScreenshots() / captureViewport()
    devices.mjs              27   DESKTOP_PROFILE, mobileProfile(devices)
```

**Playwright resolution is the same policy, now extracted so the two harnesses cannot drift:** `import('playwright')`, falling back to a **CJS `require`** of `PLAYWRIGHT_MODULE` (CJS deliberately — Playwright's entry point is CommonJS and ESM named-export detection does not run for a bare file URL). **This is not a repo dependency and must not become one.** An earlier attempt did add `@playwright/test` to `apps/web/package.json`; reverting the tracked files was not enough, because `pnpm` had already materialised `node_modules` trees `git checkout` cannot see — the fix was a root `pnpm install` to reconcile. `apps/web/package.json` and `pnpm-lock.yaml` are byte-for-byte their committed state. **Do not repeat that mistake.**

**What it adds that `decke-gates.mjs` has none of** (confirmed by grep: no `devices[`, `isMobile`, or `iPhone` anywhere in the gate suite, and no video, contact sheet, full-page screenshot, or PWA emulation):

1. **Mobile device emulation** — real iPhone 14 Pro viewport / DSR 3 / touch / UA via Playwright's `devices` map, applied to a `newContext()` in Chromium.
2. **Full-page screenshots**, not just viewport.
3. **Video of an interaction + a contact sheet** — `buildContactSheet()` ffprobes the duration, computes `fps = frames / duration`, and runs `ffmpeg -vf "fps=…,scale=…,tile=COLSxROWS" -frames:v 1` to tile N evenly-spaced frames into one PNG. **This exists precisely because a vision model cannot watch a `.webm`** — motion becomes legible as a single image.
4. **iOS-standalone-PWA and safe-area emulation** — see below. This is the load-bearing one.
5. **A written JSON diagnostics log** per page, splitting network-level failures (`requestfailed`) from HTTP-level ones (status ≥ 400) as different `kind`s, because they are different bugs.
6. **A timing report** (`TimingReport.timeUntil(label, page, act, predicate)` → JSON) for click-to-visual-change measurements.

**Safe-area insets: CDP override WORKS, and it was verified against the live page.**

```js
await session.send('Emulation.setSafeAreaInsetsOverride', {
  insets: { top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
})
```

Confirmed twice: once against a synthetic `data:` URL (a probe element with `padding-top: env(safe-area-inset-top, 999px)` computed to `47px`, not the fallback), and again — the one that matters — by injecting a probe `<div>` into **the actual live DeckPal page** and reading its computed style back:

```json
{ "displayModeStandalone": true, "navigatorStandalone": true,
  "safeAreaInsetTop": "47px", "safeAreaInsetBottom": "34px" }
```

**Parameter-shape gotcha worth carrying forward:** the field is a single `insets` **object** with `top`/`topMax`/`bottom`/`bottomMax`/`left`/`leftMax`/`right`/`rightMax`. The more natural-looking CDP convention — `{ insets: [{ edge: 'top', size: 47 }] }` — returns `Invalid parameters`.

**`display-mode: standalone` via `Emulation.setEmulatedMedia` DOES NOT WORK.** It is accepted without error and has no effect: `window.matchMedia('(display-mode: standalone)').matches` stays `false`, both immediately and after a reload. There is no known Chromium override for a real `@media (display-mode: standalone)` CSS rule. **This costs DeckPal nothing today**, because the app's only standalone detection is JS-level — `PwaUi.tsx:15`'s `matchMedia('(display-mode: standalone)').matches` — and `grep -r "display-mode" apps/web/src --include=*.css` returns zero. `applyStandaloneShim()` (an `addInitScript` that monkeypatches `matchMedia` for that one query string and shims the nonexistent-in-Chromium `navigator.standalone`) therefore covers the app's real logic completely. **Hard constraint on this pass: if any PR here adds a CSS `@media (display-mode: standalone)` rule, the shim cannot drive it and this section must be re-verified.**

**R9's own recommendation for the plan, which this brief endorses:** have the app read insets through overridable custom properties — `--safe-top: env(safe-area-inset-top, 0px)` set once at the root, consumed as `padding-top: var(--safe-top)` — so a test can also inject a value by setting the CSS variable on `documentElement.style`, independent of whether the CDP override survives future Chromium versions. Given that C29/C30/C47/C48 are about to add safe-area-dependent layout in several places, **doing this first is cheap and makes all four verifiable two ways.**

### 7.6.3 The vision judge — present in the harness, absent from R9's own documentation

**R9 §2's file listing omits two of the eleven files**, together 326 lines — nearly a third of the harness. They are the part most directly aimed at this brief:

- **`lib/judge.mjs`** — `judge({ images, prompt, model, json, maxTokens })` and `assertVisual({ images, claim, context, model })`. Its header states the rationale in the same terms as `decke-gates.mjs`: *"an agent that captures a PNG and then asserts, from memory, that the character grew from zero has verified nothing… this is the visual equivalent of what `decke-gates.mjs` does with the network: check the thing itself, not the report about the thing."*
- **`judge-motion.mjs`** — the CLI. `--describe "<question>"` for prose, `--assert "<claim>"` for a JSON verdict with **exit 0 pass / 1 fail / 2 unclear** so it composes into a script. A `.webm` argument is turned into a contact sheet first; a `.png`/`.jpg` is judged directly. Flags: `--frames`, `--tile`, `--context`, `--model`, `--out`.

**Its own worked examples are this brief's complaints, verbatim:**
- *"the character starts absent, scales up from nothing, then travels across the screen"* → **C3**
- *"Which direction is the 3D character facing relative to the text input?"* → **C9 / C26**
- *"the overlay in the second image is more blurred and darker than in the first"* → **C7**

**Three operational facts the plan must account for, none of which are in R9:**
1. **Credential.** It reads `AI_GATEWAY_API_KEY` from the environment, falling back to the gitignored `.env.prod` / `.env`. This is deliberately the **shared** gateway key, **not** `DECKE_VERCEL_AI_GATEWAY_KEY` — Deck-E's own key exists so his per-user spend stays legible, and dev tooling must not pollute that number. The key is never printed or returned. **This is dev tooling, not runtime config, so B11's declare-in-`DEPLOYMENT.md` obligation does not fire — but if any of this is ever wired into a gate that CI or a deployment runs, it does.**
2. **Cost.** Roughly **$0.01–$0.03 per call**. Its header says: cheap against an engineer's attention, not free — **do not put it in a loop.**
3. **Epistemics, and this is the important one.** The header is explicit: *"A vision model is not an oracle. Use `assert` mode for a claim a human could settle by looking for two seconds… not for a judgement call ('does this feel polished'). A `fail` is a reason to go and look, not a fact."* Verdicts are recorded with the model id and the raw answer so a human can overrule them. Default model `google/gemini-3.1-pro-preview`, overridable via `VISUAL_JUDGE_MODEL`. **The acceptance bar for this pass — "a really, really great experience" — is exactly the kind of judgement call this tool must not be asked to make.** Use it for the falsifiable half (absent→scaled→travelled; facing left vs right; darker/blurrier than before; the ✕ clear of the status bar) and use a human for the rest.

**Safety posture:** the harness is **read-only and signed-out by construction**. The proof run's only click was a client-side FAQ accordion on the public landing page; every screenshot visibly carries the amber `LIVE DATA · deckpal.app · signed out` ribbon. **The QA account is not read by anything in it.** Per AGENTS.md B12, a signed-in visual spec — which is what verifying the *chat overlay's* safe areas actually needs — **requires explicit human authorisation first**, and when granted should reuse `decke-gates.mjs`'s `signIn()` / `qaAccount()` / `unlockDeckE()` rather than reimplementing them. **Plan for this: almost every mobile defect in Part 2 lives behind auth, so the harness as it stands can photograph the landing page and nothing else that matters.** Getting that authorisation is a prerequisite, not a detail.

**Known friction, recorded so nobody rediscovers it:** Playwright's `.webm` lands under the OS temp dir on `C:` while the repo is on `E:`, and `fs.renameSync` refuses a cross-device move on Windows (`EXDEV`) rather than falling back to a copy — `lib/video.mjs` copies and unlinks instead. Artifacts go to `<repoRoot>/.visual-harness/<run>/`, newly gitignored (**the only tracked-file change the harness task made**).

**Artifacts from the proof run, with what each proved:** desktop viewport `2880×1800` (= 1440×900 × DSR 2) and full-page `2880×15910`; mobile viewport `1179×1980` (= 393×660 × DSR 3 — Playwright's iPhone 14 Pro descriptor uses 660, not the 852 px screen height, approximating Safari's chrome-subtracted visible viewport) and full-page `1179×34341`; a 3×3 contact sheet at `960×1617` showing the accordion visibly opening across frames 5–6; `timing-report.json` with `desktop:load` 923 ms, `mobile:load` 861 ms, `faq:click-to-expanded` 1483 ms; zero console errors and zero failed requests on both profiles.

**What no amount of Chromium emulation proves, stated as R9 states it:** it is still **Blink**, not WebKit — the UA says Safari, the engine does not. The override accepts any numbers; 47/34 are typical notch-portrait values, not measured from a device. And it says nothing about home-indicator gesture behaviour, the real Add-to-Home-Screen flow, service-worker behaviour under iOS's background limits, or Safari's address-bar `100vh` quirks.

---

**What does not exist:** Playwright is **not a declared dependency** in any `package.json` (deliberate, and it must stay that way); there is **no `.spec.ts` and no Playwright test-runner** — both harnesses are plain ESM scripts driving `chromium.launch()` themselves; no jsdom; **no visual-regression baseline system** (both harnesses produce point-in-time evidence, and the new one adds a vision judge instead of a pixel diff); no CSS/layout/viewport/scroll unit tests of any kind; and **nothing visual runs in CI, by design**. `test:decke` on the web side is pure `node:test` logic/data-shape testing. Safe-area behaviour is now *drivable* (§7.6.2) but still not *gated* — no CI step will catch a regression in C29/C30/C47/C48, so a human or an operator-run script must.

## 7.7 The DECISIONS.md protocol, stated as an obligation

Format (`AGENTS.md`):
```markdown
## YYYY-MM-DD — Short title
**Decided by:** <who>
**Decision:** <what was decided>
**Why:** <rationale>
**Implications:** <what changes or must be kept in mind>
```
Recent real entries run much longer in prose, but always keep the `## YYYY-MM-DD — Title` header and a `**Decided by:**` line — **that header format is what a search over the file relies on.**

**Doc-sync trigger table rows that will fire on this work:**

| If you changed… | Also update… |
|---|---|
| System architecture, a new subsystem, or cross-cutting data flow | `ARCHITECTURE.md`, wiki Architecture |
| Frontend stack, pattern, or a decision the Frontend Research wiki page covers | that wiki page |
| Deploy steps, env vars, or the connect-an-assistant runbook | `DEPLOYMENT.md` |
| Auth, MCP/connector behavior, or anything a security reader would care about | `DEPLOYMENT.md`, `SECURITY.md`, `apps/mcp/SPEC.md`, wiki MCP-Setup |
| Anything logged in DECISIONS.md | `DECISIONS.md` **and** wiki Decision-Log — **always both, never one now and the other later** |
| Any work session at all, however small | wiki Contribution-Record — one ledger line |

Wiki: `github.com/cheyras/deckpal/wiki`, cloned at `~/deckpal.wiki`. Every touched page's footer must be updated: `_Last updated by <agent> on behalf of @<handle> -- <date>_`.

**Commit attribution:** every agent-authored commit carries `On-Behalf-Of: @<handle>` and `Co-Authored-By: <agent model> <noreply@anthropic.com>`.

**Concretely, this pass will need at minimum superseding or new entries for Part 6 §§6.1, 6.2, 6.3, 6.6, 6.9, and probably 6.5, 6.7, 6.8 and 6.10** — nine or ten entries, each also mirrored to the wiki Decision-Log in the same sitting.

## 7.8 Engine landmines (R1 §9), restated as hard constraints

1. **`park.test.ts:119`** pins `solvePark(..., {centre:true}).facing === undefined`. Fix C26 at the `DeckeHost.tsx` call sites only.
2. **`look.test.ts:45-56`** pins `aimPupil`/`gazeTarget` against the glb's baked bind pose at the staging camera. Editing `thinking`'s `gx`/`gz` in `playbook.json` does not touch it; changing `GAZE_GAIN` or `PUPIL_ROAM` would need re-validation.
3. **`playbook.json` is generated and the generator has been broken since 2026-08-16.** The committed `_raw/playbook.json` is *"stale by four states and must not be used."* Gaze changes must be hand-edited into the live 187 KB JSON, accepting drift risk from the character wiki's normative Python until the generator is fixed.
4. **`setCharacterHeight` dollies the camera, it does not scale a mesh.** Preserve the "resize before solving a destination" ordering already encoded at `DeckeHost.tsx:227-263`, or repeat a bug this file says was already debugged once.
5. **The `Decke-runtime` chunk name is load-bearing** for the service-worker precache exclusion. See §6.9.
6. **`entitlement.ts`'s module-level cache** means `deckeEntitled()` calls `/me` once per session; `resetDeckeEntitlement()` is the test seam.
7. **StrictMode double-invoke discipline** in `runtime.ts` (`acquireDeckE`/`releaseDeckE`, `:91-123`, deferred dispose via `setTimeout(...,0)`) — any new effect touching `phase`/`active` must be checked against React 19's synchronous remount behaviour described at `runtime.ts:68-79`. **This directly constrains the C2 fix**, which is an effect change.
8. **`PARITY.md` is a record, not a gate**, and is already known-stale on gaze.
9. **`DECKE-AGENT-SPEC.md`** is about the agent-capability rev-1 postmortem and does **not** address any of the visual/lifecycle complaints — do not mistake it for prior art on those.

## 7.9 Two constraints rev 1 omitted entirely

**Added by the audit.** Neither is a conflict; both bind every phase of this work, and neither appears anywhere in rev 1.

### 7.9.1 Reduced motion

Covered in full at **§6.12**. The short form: **19 sites** across the codebase enforce it, every animated element in the character host carries the `motion-safe:` prefix without exception, and the app's own highlight primitive already has a reduce path (`elementHighlight.ts:147`). **Every new animation in this pass ships its reduce path in the same commit**, and for C3 and C32 that path is a *different behaviour*, not a disabled one. Do not adopt beautifului.dev's blanket-duration-collapse strategy along with its components (§4b.0.2).

### 7.9.2 The z-order stack

Rev 1 cites individual z-indices in six different places and never assembles them. For a pass that reworks a scrim, a panel, a chrome relationship and a character position simultaneously, **that table is a prerequisite, not a nicety.** It is at **D11**, along with the three consequences that follow from the character sitting at z-30, above app chrome at 20.

**The one line to carry forward:** `--z-chrome: 20` (`theme.css:287`) is the app's own boundary between "content" and "frame", the desktop scrim is deliberately *below* it (15) and the mobile scrim deliberately *above* it (24) — and **that single number is what §6.2, §6.11, C8, C29 and D7 are all really about.**
---

# Part 8 — How he wants the work run

He is explicit at t=25:06–26:39. Quoted in full:

> *"[25:06] Yeah, so I'm going to leave it at that for now. [25:10] I think I've given you a lot of context to think over. [25:17] This is not going to be the last pass. [25:20] What I'd like you to do is really think through all of this and really plan it out. [25:32] And I want to do it in one big long pass where you rely on subagents with fresh context so that we can keep the work going smoothly. [25:52] And I want you to rely on Fable for deeper reasoning if you need it. [25:57] I want you to rely on Fable for checks after each phase. [26:04] And rely on Sonnet subagents for research between each phase. [26:10] And just keep, you just kind of keep the work going. [26:16] But plan it out in detail first. [26:20] Run your plan by Fable subagent to have it critique the plan adversarially. [26:28] And then just go. [26:32] You have a lot of context. [26:34] You have a lot of screenshots. [26:36] You have beautiful UI.dev. [26:39] Let's just make this a really, really great experience."*

**The operating model, unpacked into its seven distinct instructions:**

1. **Plan in detail first.** *"But plan it out in detail first."* The plan is a deliverable before any implementation begins.
2. **Adversarial review of the plan, by Fable, before starting.** *"Run your plan by Fable subagent to have it critique the plan adversarially."* Not a sanity check — an adversarial one.
3. **Then execute without further gating.** *"And then just go."*
4. **One big long pass, phased.** *"I want to do it in one big long pass."* He is not asking for incremental PRs he reviews individually; he is asking for a sustained run.
5. **Subagents with fresh context, for continuity.** *"you rely on subagents with fresh context so that we can keep the work going smoothly."* The stated purpose is keeping the work going — i.e. context-window management is the reason, so delegation should be structured to keep the orchestrator's context clean.
6. **Fable for deeper reasoning when needed, and for a check after every phase.** Two separate uses: *"rely on Fable for deeper reasoning if you need it"* (on demand) and *"rely on Fable for checks after each phase"* (mandatory, per phase).
7. **Sonnet subagents for research between phases.** *"rely on Sonnet subagents for research between each phase."* Research is an inter-phase activity, not something front-loaded once.

**Also stated, and worth keeping in view:**
- *"This is not going to be the last pass."* — this is one iteration of several. Scope decisions can defer things without that being a failure.
- *"You have a lot of context. You have a lot of screenshots. You have beautiful UI.dev."* — he expects the plan to be built from what has already been gathered, not from fresh discovery.
- The closing standard is qualitative, and it is the acceptance bar he actually stated: ***"Let's just make this a really, really great experience."***

**One interaction with Part 7 that the plan must reconcile:** *"and then just go"* is in tension with B12 Rule 3 (the owner merges their own PRs, and green CI is mandatory even though admins can bypass it) and with B9/B11 (env vars and infra are the maintainer's, on request, every time). **"Just go" governs the work, not the merge and not the infrastructure.** The plan should say so explicitly so a later agent does not read it as blanket authorisation.

---

# Part 9 — Open questions requiring his decision

Fourteen (rev 1's eleven, plus Q12–Q14 from the audit). Each states what cannot be resolved without him and why.

**Q1 — What did "[23:50] I would add, not, like, for now, that type of scope" mean?**
Read in context (immediately after praising the Prompt Bar, immediately before *"let's keep it simple"*), the intended sense is almost certainly *"I would **not** add that type of scope for now"* — scoping the Prompt Bar's `@`-mentions, `/`-commands and third-party connectors **out**. **This is an interpretation of a garbled line, not an observation.** If it is wrong, the composer scope changes materially. *Recommend confirming in one sentence.*

**Q2 — Is photo attachment in scope? He asked us directly.**
*"[24:44] A photo would be a good thing to add. [24:48] You let me know if you think it should be out of scope."* Context for answering: DeckPal already has a card scanner at `/scan` (`Scan.tsx`) and a `vision` model tier (`spacexai/grok-4.1-fast-non-reasoning`, `models.ts:223`, budget 400), so an image path exists — but wiring image upload into the chat turn is new surface (multipart handling in `api/chat.mjs`, a new tool or a `convertToModelMessages` change, plus storage per B1's provenance choke point). **This is an explicit request for our recommendation, and it should be answered, not deferred silently.**

**Q3 — Should conversations persist across a page reload?**
D5 establishes there is no persistence at all, by construction (`useDeckeChat` state lives in `DeckeHost`, which survives route changes but not a document load). He lost a two-exchange conversation on camera and did not comment. Persisting would mean new storage (localStorage? server-side thread records?), which has privacy, sizing and RLS implications. **Not inferable from anything he said.**

**Q4 — Does he want a permanent developer-observability surface for model and latency, or was C22 answered by this brief?**
He said *"I don't know that we should expose that in the UI, per se, but just as the developer of this, I would be interested to know."* Part 2's C22 answers the question as asked. Whether he wants an ongoing surface — a `/health` field, a `?diag` readout, structured turn logging — is a separate decision with B11 implications if it needs a var.

**Q5 — Should `DECKE_DEEP_BUDGET_MS` be split per deep tool, and should any of them be shorter?**
210,000 ms is a shared ceiling across `plan_deck`, `analyze_collection`, `write_strategy_guide` and `research_meta` (`deep.ts:79-82`). D2 shows `analyze_collection` burning most of it and returning nothing useful; R2 §9 item 4 suggests `research_meta` may warrant its own. **Changing a production value is B9 territory — his call, and his action to set.**

**Q6 — Are Task Rows in or out?** He hedged explicitly: *"[17:49] That maybe is overkill for what deck E does, but it's an interesting thought."* It overlaps heavily with the Thinking component (C14) and the structured action rows (C36); building all three risks three competing progress surfaces.

**Q7 — What form should the confidence signal take?**
He likes it (C43). R8 §4's evidence is genuinely mixed and recommends **no bare percentages**, preferring N-best disambiguation and, where a signal is wanted, a **coarse, behaviour-linked** one — low-confidence items default *deselected*, forcing opt-in. That is a materially different product than a three-bar meter with a label. **A design decision with real trust consequences.**

**Q8 — Does he want the Claude iOS bottom spacing matched to a measured value?**
Part 4a records honestly that the phone-mirror window's own chrome cut off the home-indicator region in every range-7 frame, so **the true spacing was never actually visible** and range6's capture is qualitative. If he wants a number, someone must take a fresh screenshot. Otherwise the target is "generous, comparable to Claude," judged by eye.

**Q9 — How many legs may an escorted journey spend?**
`MAX_LEGS = 4` (+ up to 2 approval replays), `legBudget(replays) = MAX_LEGS + replays` (`approval.ts:205-226`). His described journey — click nav → hop → outline → click → hop → outline → click → speak — plausibly needs more, and every leg re-bills the entire prompt including up to 40 landmarks (~600 tokens each, `useDeckeChat.ts:743-767`), compounding C19's latency. **Raising the budget trades latency and cost for the behaviour he asked for. His call.**

**Q10 — Which of R8's 22 domain features are in scope for this pass?**
He asked for creative ideation (C44) and 22 are written (Part 5 §5.9). Several are large (grading ROI needs graded comps data; trade matching needs two accounts; insurance valuation is an exportable document). Several are near-free given existing data (master-set completion, species-first query, variant disambiguation). **He should pick.**

**Q11 — Should the chat-model choice be revisited, and if so, when?**
`grok-4.20-non-reasoning` costs 337 ms more median TTFT and 7.49× per turn versus its predecessor, and was chosen specifically to fix `flyTo` reliability (Part 6 §6.4). C32 makes navigation *more* central, so reliability arguably matters more now. **Recommendation: not in the same phase as the navigation work** — re-bake after, with `flyTo` reliability re-measured the same way. But whether to re-bake at all is his call, since it is a live cost decision.

---

## Added by the audit (Q12–Q14)

**Q12 — What were you about to say at [10:11]?**
*"Okay, so he did finally, okay, and he started talking. **I honestly would have loved him to,** heck, my browser just, like, hiccuped and booted me out."* The browser hiccup cut off a requirement mid-clause and he never came back to it (**C54**). It is the only want in the recording that is known to exist and unknown in content, so a plan built from this brief will silently not implement it. The likeliest completion is in the C20/C21 family — *"loved him to say something while I waited"* — but *"loved him to fly over and show me"* (C32), *"loved him to be shorter"* (C33) and *"loved him to have caught that it failed"* (D2) are all consistent with the audio and lead to different work. **One sentence settles it.**

**Q13 — On mobile with the chat open, should the page behind be scrollable?**
He said: *"[21:00] I cannot — so right now I'm trying to scroll… and I can't. The only things that are scrolling is Deck E himself and the chat window, and that's really bad."* **Rev 1 resolved this ambiguity silently and should not have.** It reads the complaint as "the transcript is unreachable at the top and cramped at the bottom" (C46's endorsement of R5's composition argument, plus C48) — which is well-evidenced and is certainly *part* of it. But the sentence also supports a second reading: **that he expected the page underneath to scroll and was surprised it did not.** That reading gets sharper once C29 lands, because a mobile design where the app's top chrome is deliberately kept present and sharp invites the question of whether the app behind it is still usable. The current answer is a hard no — `lockScroll()` (`DeckeChat.tsx:273-278`) fixes `<body>` on both platforms. **Rev 1 is probably right and the lock is probably correct** (it is the standard iOS body-lock and `overflow:hidden` alone does not hold there). **But "probably" is doing work in a blocker-severity item, and one sentence from him removes it.**

**Q14 — Is the desktop takeover full-viewport, or full-content-pane?**
**§6.13** sets this out in full. C5 asks for *"full screen"*; C8 — stated, self-corrected, then confirmed twice — requires the header **and the full-height left sidebar** to stay sharp and unscrimmed, which rev 1's own evidence frame for C8 confirms is the current desktop behaviour. **Those cannot both be literally true**, and the answer determines what "centred" means for the composer, whether the scrim covers the sidebar, and whether §6.2's desktop half is being reversed. **The brief recommends (A), the content-pane takeover**, because it satisfies every sentence he actually said and makes desktop and mobile one idea at two widths. **Building the wrong one is a week's work, and it is the single most likely thing in this brief to be built wrong.**

---

## Appendix — source inventory and what was verified first-hand for this brief

**Sources read in full:** the 26:43 transcript (237 lines); scribe ranges 1–7 (269 KB, covering all 275 stills); research **R1–R9** (357 KB), plus the byte-exact recovered source of all 20 beautifului.dev components (`research/src/*.tsx`, 328 KB) and the site's two compiled stylesheets. **R6 and R9 are now folded in** at Part 4b and Part 7.6.

**Frames rendered and read directly for this brief, rather than taken on the scribes' word:**

| Frame | Crop | What it settled |
|---|---|---|
| `t00108.000_preclick` | `1500x1100+1300+800` | **Two Deck-Es confirmed** — 3D body + doze-state (eyes-closed) launcher chip, same frame (C2) |
| `t00615.637_preclick` | `800x800+2050+1150` | **The "great response" is a tool-timeout apology** (D2); markdown asterisks; chip order Collection/Browse/Analyse (C23) |
| `t00635.923_preclick` | full + `500x400+2400+1700` | **Launcher chip IS present** in the closed state — D9 corrected; also shows the desired post-C2 end state by accident |
| `t00638.510_preclick` | `600x450+2300+1600` | Launcher present again; **click coordinates land on it** — the scribe misread the target |
| `t00639.214_framechange` | full + `600x450+2300+1600` | Launcher absent in this one frame; most likely `hidden={chatOpen}`; **labelled uncertain** |
| `t00795.460_framechange` | full | **Stale bubble is the speech bubble, not the panel** (D4); it clips his face; minimised bar visible |
| `t00924.821_framechange` | full | **Tilt confirmed** ~25–35°; he occludes a card; **two Deck-Es again** |
| `t01245.678_framechange` | full + `780x120+1790+225` | **The ✕ IS visible, collided with the battery glyph** — scribe corrected; title under the recording pill; blurred gauges behind the status bar; three "Set completion progress" chips |

**Helper used:** `bash ".../scratchpad/view.sh" <still-basename> [WxH+X+Y] [outwidth]`.

---

### Re-verified independently for rev 2 (the adversarial audit)

Every load-bearing claim below was checked **against the primary source, not against rev 1's account of it**. Full evidence in `BRIEF-AUDIT.md`.

| Claim | Verdict |
|---|---|
| The 6.9 MB automatic load, and the timer at `DeckeHost.tsx:166-177` | **timer VERIFIED exactly; the total is WRONG — it is 7,104,290 B ≈ 7.1 MB** |
| Two Deck-Es at `t00108.000_preclick`, chip in doze state | **VERIFIED** — 3D body, chip present, eyes closed, chat closed |
| The 61-second pixel-identical freeze | **OVERSTATED** — 61.05 s and zero app output are real; "pixel-identical" is false (D1) |
| The praised reply was a tool-timeout apology | **VERIFIED verbatim** — and *no* chip carries error styling, which is worse (D2) |
| Facing: `centre:true` → no facing → default `+1` | **VERIFIED in substance, OVERSTATED in wording** — it re-asserts `facingTarget`, so the bug is "never decided", not "forced to +1" (C26) |
| `park.test.ts:119` pins `facing === undefined` | **VERIFIED**, plus `:120` asserts the converse for `parkBeside` |
| The ~6.8° thinking-gaze offset | **VERIFIED in code**; rev 1's frame description of the pupils is **WRONG** (C24), and the re-crop found D14 |
| `click` never mentioned in `prompt.ts` | **OVERSTATED in §5.7** — it occurs once, at `:518`, arguing *against* clicking. C32(b) had it right. |
| `data-decke-clickable` on exactly two elements | **VERIFIED** — `SeriesIndex.tsx:399`, `CardDetail.tsx:599` |
| `react-markdown` + `remark-gfm` installed, `MarkdownView.tsx` exists | **VERIFIED** — 52 lines, 17 element overrides, lazy-loaded by `StrategyTab.tsx:10` only, no sanitiser anywhere |
| The chip-reorder mechanism at `useDeckeChat.ts:263-278` | **VERIFIED** — range is `263-279`, mechanism on `:274` |
| The mobile ✕ is visible and collides with the battery glyph | **VERIFIED, and rev 1 understated it** — actual pixel overlap, not merely the same band |
| Three duplicate "Set completion progress" chips | **VERIFIED** — exactly three, in both frames |
| `--color-overlay-scrim` = `rgb(26 23 22 / 0.75)` at `theme.css:141` | **WRONG** — that is `-strong`; the plain token is `:140`, `rgb(52 47 45 / 0.7)` (C7) |
| `card_back.webp` at `DeckE.ts:653`; hdr at `character/decke/runtime.ts:51` | **WRONG paths** — `cardArt.ts:107` and `character/host/runtime.ts:51` (C2) |
| `decke-chat-in` is "280 ms" in the keyframes | **OVERSTATED** — the keyframes carry no duration; three call sites use 200/220/280 ms (C3) |
| Playwright is absent from the project | **WRONG, and it was an upstream error** — `decke-gates.mjs` is 2,562 lines of it, `.gate-shots/` holds 148 files from one day. Only the *dependency* is absent (§7.6) |
