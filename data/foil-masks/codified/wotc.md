# Codified mask rules — era `wotc` (WOTC 1999–2003, Base–Skyridge)

Codification log per the ritual in `.claude/skills/mask-pipeline/SKILL.md` ("Codify").
Corpus lives beside this file; nothing here is fabricated — every claim traces to a
hand-drawn mask or a Chey comment.

## Pass 1 — 2026-08-01 · n=1 (codified observation, NOT law)

**Corpus**
| entry | prior (rule) | agreement | evidence |
|---|---|---|---|
| `base1-8/32` (Machamp, 1st Ed. Holofoil Shadowless) | layout `window`, resolver v1 | **0.6409** | `base1-8/32.diff.png` |

Linked comment: `issues/foil/2026-08-01_22-40-03-629_ftoz71` — "I saved a hand drawn
mask … it should be the same one for all the ones of this Machamp because they have the
same picture."

**The rule this corpus teaches**

> **WOTC holo `window` scope = art-window rect MINUS the subject silhouette.**
> The Starlight foil sheet sits behind the illustration's background only; the subject
> (and anything printed over the foil, like the small evolution icon overlap) is
> ink-on-foil that Chey masks OUT entirely.

Evidence, read off `32.diff.png`: removed (red) = 39,643 px, essentially all of it the
Machamp silhouette plus thin edge trims just inside the window border; added (green) =
13 px (stroke noise, ignorable). Every human correction was a *subtraction* from the
rect — the rect itself is not too small anywhere.

**Expressibility**
- The rect (`era-layouts.json` → `wotc.artWindow`) is confirmed by this sample —
  unchanged. The thin edge trims read as freehand imprecision at n=1, not as evidence
  the rect is oversized; revisit if the trend repeats at n≥3.
- "Minus subject silhouette" is NOT expressible as layout data — recorded as prose in
  `era-layouts.json` `wotc.notes` and here. It is the tier-2 (art-driven) work item:
  segment the subject inside the art window; the score to beat on this card is the
  rect-only ceiling of **0.64**, target agreement ≥ 0.95 vs `32.png`.
- `uArtGate` (luminance gate) is the current cheap approximation of the same idea —
  Chey ran it at 0.75 on this card, which hides much of the residual foil-on-subject.

**Validation** (step 4): rule unchanged at rect level → regenerating the prior
reproduces agreement 0.6409 by construction (`backfill.ts` output). That number is the
recorded rect-only ceiling for this card. No resolver bump (rule text only) —
`RESOLVER_VERSION` stays 1.

**n=1 caveat**: one card, one artist-era, holo-rare only. Before treating "window minus
subject" as WOTC law, corroborate on ≥3 more WOTC holo hand masks (different subjects,
ideally one Gym/Neo/eCard frame each — frame proportions differ). Non-holo scopes
(sheet/full) have zero WOTC corpus so far (no reverse holos before Legendary Collection
anyway).

---

## Pass 2 — 2026-08-08 · scope `window` · n=4 · THE RULE IS CONFIRMED, THE GENERATOR IS NOT

The n=1 caveat above asked for ≥3 more hand masks. It got three: `base1-5/19` Clefairy
(`hand-refined`), `base1-6/23` Gyarados (`ai-corrected`), `base1-7/27` Hitmonchan (`hand`),
alongside a refined `base1-8/32` Machamp (`hand-refined`).

### 1. The rule holds at n=4 — and gains one clause

> **WOTC holo `window` scope = art-window rect MINUS the subject silhouette MINUS the
> stage/evolution box where it overlaps the window.**

Measured with `region-learn@1`'s five-class partition, the share of each class's pixels he
made foil:

| class | base1-5 | base1-6 | base1-7 | base1-8 | verdict |
|---|---|---|---|---|---|
| `windowBackground` (the illustration's own field) | 94.7% | 89.0%* | 96.6% | 89.3% | **FOIL** |
| `windowSubject` (the Pokémon) | 8.0% | 8.4% | 8.2% | 7.2% | excluded |
| `frameBody` (card stock + yellow border) | 0.4% | 0.2% | 0.2% | 0.9% | excluded |
| `furniture` (name-bar furniture, stage box) | 0.0% | 2.3% | 0.0% | 0.0% | excluded |

\* base1-6 read 0.2% under the first (strongest-peak) window detector, which had locked
onto a text-line edge at y=72 instead of the illustration box at y=80. Taking the bevel
line on the FOIL side of the box fixed it — see §3.

The new clause is visible on both evolved cards: Gyarados and Machamp each have the
"Evolves from …" box overlapping the window's top-left corner, and on both he cuts the
foil around it by hand (ragged, deliberate). Clefairy and Hitmonchan are Basics and have
no such box. **4/4 agree; the two that could disagree, don't.**

### 2. THE ERA RECT IS WRONG, on every WOTC card

His four masks put the illustration box here (median of each edge, 490×674 mask space):

| edge | his masks | `era-layouts.json` `wotc.artWindow` | error |
|---|---|---|---|
| top | 79 / 80 / 80 / 81 | 68.7 | **rule is 11px too high** |
| right | 436 / 437 / 438 / 439 | 443.5 | **rule is 6px too wide** |
| left | 50 / 51 / 52 / 53 | 50.5 | ok |
| bottom | 347 / 349 / 349 / 350 | 350.5 | ok (1.5px) |

Independently, the printed edge detected on each card's own scan agrees with his masks to
within 1–2px on 3 of 4 cards. `base1-8` (Machamp) is the card the era was "measured on"
and it is mis-measured — exactly the pattern found for `modern-sv` on 2026-08-08
(`me04-007`, 41px out at the top).

Implied correction, **not applied here**: `{ x: 0.1051, y: 0.1187, w: 0.7878, h: 0.3991 }`
(from `{ x: 0.103, y: 0.102, w: 0.802, h: 0.418 }`). That is a one-line data change with
era-wide blast radius across every Base/Jungle/Fossil/Gym/Neo/e-Card holo, so it belongs
to `foil/main` with Chey's eyes on it, not to a mask lane. `region-learn@1` does not need
it — it detects the box per card and uses the era rect only to start the search.

### 3. The bevel side (a general finding, recorded here because WOTC is where it bites)

A WOTC illustration box is framed by a gold bevel, so its edge is **two** parallel printed
lines ~8px apart, both strong. Which one the foil boundary sits on is not a detection
question — it is which side the foil is on. `window` scope (foil inside) stops at the
bevel's INNER line; `sheet` scope (foil outside) stops at its OUTER line. Taking "the
strongest peak" chooses between them card by card at random, which is what put base1-6's
window top 8px wrong and collapsed its background segmentation to nothing.

### 4. Validation — and the honest failure

Leave-one-out, each card's own mask withheld (`generate-masks.ts eval --generator
region-learn --era wotc --scope window --serie base`):

| card | era rect | region-learn@1 | Δ | over-claimed | missed |
|---|---|---|---|---|---|
| base1-7 Hitmonchan | 0.7318 | 0.9502 | +0.2184 | 3,116px | 1,060px |
| base1-5 Clefairy | 0.5342 | 0.8995 | +0.3653 | 3,236px | 3,019px |
| base1-6 Gyarados | 0.5503 | 0.8789 | +0.3286 | 5,785px | 2,278px |
| base1-8 Machamp | 0.6422 | **0.8599** | +0.2177 | **8,343px** | 2,764px |
| **mean** | **0.6146** | **0.8971** | **+0.2825** | | |

Bar stated before the numbers existed: mean ≥ 0.90, no card below 0.85.
**FAIL — by 0.0029 on the mean.** No batch was generated for this class.

**What it gets wrong is one thing only: the subject silhouette.** Every frame-level
decision is right on all four cards — the box is found, the stage box is cut out, the card
stock is excluded. The error is entirely inside the window, and it is worst on Machamp,
whose blue-grey body sits inside the colour distance of the dark teal holo field, so 8,343
px of Machamp reads as background and gets foiled.

For scale, `window-artgate@1` — the generator whose five unreviewed proposals
(`base1-1/2/4/10/15`, run `wotc-window-trial-1`) are still in the corpus — scores mean
**0.7694**, worst **0.7330** on this same test. Those five are below anything this lane
would ship and no human has ever looked at them. Recommended:
`generate-masks.ts revert --run-id wotc-window-trial-1`.

**Ceiling honesty**: the scalar parameters of `region-learn@1` (chroma threshold, morph
radius, background sigma) were chosen while looking at these four cards. Only the region
POLICY is properly held out. The true generalisation number is therefore ≤ 0.8971, not ≥.

### 5. What would actually move it

The next WOTC hand mask should be a **holo whose subject is close in colour to its own
background** — the failure mode, not another easy card. Two cards where the subject is
*lighter* than the field (Clefairy, Hitmonchan) already score 0.90 and 0.95; a third of
those teaches nothing. Rank order: a blue/grey subject on the blue-teal Base holo field
(`base1-2` Blastoise is the cleanest example), then a Gym/Neo holo to test a different
frame's bevel.
