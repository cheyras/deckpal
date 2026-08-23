# Owner rulings — 2026-08-22

Decisions taken directly from the owner during the planning pass, resolving
ambiguities the brief and its audit surfaced. These are AUTHORITATIVE and
override any contrary reading of the transcript.

---

## OR1 — Desktop scrim: chrome stays sharp, content dims (resolves §6.13 / Q14)

**Ruling:** the scrim covers **only the content pane**. The header **and the
full-height sidebar** stay fully sharp, unblurred, and usable. Deck-E stands
left of the composer, inside the dimmed content region.

**Therefore "full screen" (C5) means:** the chat experience occupies the full
content pane with a centred composer — *not* a literal viewport-covering
takeover. C5 and C8 are reconciled: C8 wins on the letter, C5 wins on the feel.

**Consequences:**
- Desktop keeps its current stacking (scrim `z-15`, below `--z-chrome: 20`).
  **No decision is reversed on desktop.** Only the dim/blur *strength* changes
  (C7) and the layout becomes composer-centred (C5, C37).
- §6.2's mobile change is now precisely "make mobile match desktop": the scrim
  starts **below the app header**. Mobile has no sidebar, so the rule is
  uniform — header sharp, everything beneath it dimmed.
- The mobile fix stays **geometric, not a z-index swap** — `backdrop-filter`
  samples whatever composites behind it regardless of paint order, so the blur
  element must not extend under the header. Top offset
  `calc(64px + env(safe-area-inset-top))` (matching `AppShell.tsx:359`).
- This is the lowest-risk of the three options and the one that reverses least.

---

## OR2 — Mobile warm: tap and wait, with the arrival animation covering it (resolves D12)

**Ruling:** the 3D runtime loads on `touchstart`. The 2D chip stays in place and
animates as a loading state; Deck-E then scales up from zero once ready. The
entry animation he asked for (C3) doubles as the load-time cover.

**Accepted cost, stated plainly:** a beat of delay on first open, and on a slow
connection possibly several seconds. **Nobody who never taps pays anything** —
which was the point of C2.

**Consequences:**
- No timer, no pre-warm on scroll. `DeckeHost.tsx:166-177` is deleted outright.
- The chip's loading state is now load-bearing UI, not decoration: it is the
  only thing standing between tap and arrival. It must read as "coming", not as
  "broken", and must handle a genuinely slow connection without looking stalled.
- Desktop keeps `pointer-enter` warming, which usually hides the load entirely.
- **Payload reduction was explicitly NOT chosen for this pass.** The 1.57 MB HDR
  is the softest target and stays on the table for a later pass; the glb and the
  16-bit atlas both have documented reasons they cannot shrink
  (`DeckeButton.tsx:1-21`).

**Corrected figure:** the real total is **7,104,290 bytes** (6.78 MiB / 7.10 MB),
not the "6.9 MB" that R1 and the brief carried. Measured:
glb 2,918,432 + HDR 1,608,057 + atlas 1,069,793 + playbook 186,833 +
cards 44,311 + card-back 77,824 + JS chunk 1,199,040.
(`markers.json` and `CREDITS.md` are in the directory but are not loaded by the
host.)

---

## OR3 — The lost request at [10:11] (resolves C54 / Q12)

He was cut off mid-sentence by the browser hiccup: *"I honestly would have loved
him to—"*. Asked to recall it, his answer:

> *"I think i was about to say I would have liked him to do a different emotion
> state or something, but I'm not 100% sure."*

**Reading, with the uncertainty preserved:** the sentence came at the exact
moment Deck-E **stopped thinking and started talking** [10:05–10:11]. So the
most likely want is an **emotion beat at the thinking → answering transition** —
he should visibly change state when the answer arrives, rather than sliding out
of the same rocking loop he has been in for a minute.

**Status:** treat as a **probable requirement, not a certain one.** It is a
close relative of C21 (*"he can kind of show a different emotion for a sec and
then go back to thinking"*, [7:58]) and should be implemented as part of the
same expression work. Recorded here rather than inflated into its own phase.

---

## OR4 — The approval card signals certainty by PROVENANCE, not a confidence score
(resolves C43)

> **Cross-reference corrected.** An earlier revision of this heading also claimed
> to resolve **Q13** ("on mobile with the chat open, should the page behind be
> scrollable?"). It does not — nothing in this ruling touches scrolling, and the
> effect of the bad reference was to make an unresolved owner question *look*
> resolved. Q13 is ruled separately in `PLAN.md` §11c (the scroll lock stays,
> because the complaint is caused by the damaged ends of the scrollable region,
> not by the lock), and that ruling is mine, not the owner's. If he disagrees it
> is a one-sentence change; B6's fixes are correct under either answer, so no
> work is blocked on it.

**Ruling — the owner's own design, and it is better than either option offered.**
The card is **segmented into two sections**:

1. **Cards where the variant is known** — rendered plainly, needing no
   interaction, with a per-row "that's wrong" affordance.
2. **"What was the variant on these?"** — rows where Deck-E genuinely does not
   know or is not confident, each with an inline picker.

His rationale, verbatim:

> *"if it's truly high confidence I don't want the user to feel like they have to
> pick a variant again especially if they were already pretty clear about what
> variant it is. When using claude via MCP and dictating cards and variants to
> claude, there have been times when i neglected to tell it which variant and it
> flagged that as something it didn't know, and I liked that."*

**No numeric confidence meter ships.** This satisfies the research constraint
(miscalibrated AI confidence measurably degrades decisions; ~93% of permission
prompts are approved regardless of content) without losing what he liked about
the reference card.

### The mechanism already mostly exists

`pickVariant` (`packages/agent-tools/src/resolve.ts:330-361`) already
distinguishes the three cases:
- explicit `variant_id` → resolved, **stated**
- explicit `variant_kind` → resolved, **stated**
- omitted → **silently** `all.find(x => x.isPrimary) ?? all[0]`
- and an `ambiguous` status already exists that returns `variants: [...all]`
  plus a candidate-listing message — currently only raised for absolute-quantity
  writes on a card with >1 owned variant.

### The change

Add a **provenance field** to the dry-run rows —
`variantSource: 'stated' | 'defaulted' | 'ambiguous'` — and let the card
segment on it. `ambiguous` rows carry the existing `variants` list, which is
already exactly the data an inline picker needs.

**HARD CONSTRAINT:** this must be a **new field**, NOT a change to
`pickVariant`'s existing status semantics. Other flows depend on the silent
primary-variant default; turning those into errors would be a regression well
outside this pass.

### Design details settled

- A **defaulted-but-unambiguous** row (the card has only one variant) belongs in
  section 1. There is nothing to ask.
- **`Accept` commits section 1 even if a printing in section 2 is left
  unpicked.** One unknown must not block the whole batch.
- The "that's wrong" affordance wires into `onRemoveCard` — a prop
  `DeckeScreen.tsx` already accepts and which **nothing currently passes**
  (a dead branch, per R4 §B.2).

---

## OR6 — Rip-watching presence may be gutted (resolves Fable M-4)

**The finding:** Fable's review caught that A1 (deleting the idle-warm timer)
**silently kills the rip-watching feature** — `ripPresence` is a no-op when
Deck-E is not loaded, and the deleted timer was the only thing that loaded him
before a pack rip. This appeared in **no** document: not the plan, brief, audit,
or research.

**Ruling:**

> *"the rip-watching feature completely doesn't work, and very clearly needs an
> overhaul, so I'm ok with gutting the implementation as is because it really,
> really sucks."*

**Consequences:**
- A1's effect on rip presence changes from a **silent regression** to a
  **deliberate removal**, which is a materially different risk. Record it that
  way in the DECISIONS entry — an accidental feature death discovered later is
  expensive; a sanctioned one is free.
- Do **not** leave `ripPresence` as dead code that silently no-ops. Either
  remove it, or leave it behind an explicit disabled flag with a comment saying
  it awaits an overhaul. A no-op that looks live is how this defect hid in the
  first place.
- A rip-presence overhaul is **out of scope for this pass** and wants its own
  design — it is a second surface where the character reacts to live events, and
  it should be designed alongside, not bolted onto, the journey sequencer from
  E8.
- Verification: no gate should assert rip presence after this pass. If one does
  today, retire it in the same commit rather than leaving a gate pinned to a
  feature that has been deliberately removed.

---

## OR5 — Carried forward, still open

- **Add-photo in the composer (C52).** He explicitly deferred to me
  (*"You let me know if you think it should be out of scope"*). **My call:
  out of scope for this pass** — the app has a whole `/scan` route and pipeline;
  a second image-input path in chat is a real feature, not a composer restyle.
  The card will be built so the slot exists. To be confirmed, not assumed.
- **Chat model latency (§6.4).** Not to be re-litigated in the same phase as the
  navigation work. Measure after, with `flyTo` reliability re-tested.
- **Web search visibility (C17)** may require a research-provider change against
  the "US frontier labs only" constraint in `models.ts`. Spec §14.1 already
  poses this to him.
