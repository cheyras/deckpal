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
