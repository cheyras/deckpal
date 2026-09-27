---
date: "2026-08-10"
title: "Dark-inked set logos: measuring which ones vanish, and plating only those (#16)"
decided_by: "Not recorded"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-10 — Dark-inked set logos: measuring which ones vanish, and plating only those (#16)

**Context.** A report from /series on a 428px iPhone: the Pokémon Organized Play logo is
hard to read on the dark background. The visible symptom is that the POP mark renders as a
bare Poké Ball — the "POKÉMON / ORGANIZED PLAY" wordmark that curls around it is pure
black, and on `--color-surface-tertiary` (#282d38) black ink is within a few percent of the
backdrop. It does not read as low contrast; it reads as absent.

**The framing that mattered.** This is a rendering problem, not an asset problem, and it is
not POP's problem. A large fraction of TCG set logos are inked for white cardboard: black
wordmarks, black outlines, no light stroke. Every one of them loses part of itself on a
dark UI, and the catalog grows every few months, so the fix had to be a rule rather than a
patch. Swapping the POP asset for a white-text variant would have fixed one card on one
page and left the class untouched (and would have collided with the set-logo asset lane).

**Detection: "orphaned dark ink".** Three metrics were tried against all 157 cached set
logos and the first two were rejected on the evidence:

- *Alpha-weighted mean luminance* — rejected. It ranks Mega Evolution Pitch Black and
  Destined Rivals as darker than POP, and both read perfectly. Mean luminance is dragged
  down by drop shadows and outlines that are not carrying any information.
- *Structure on light vs structure on dark* (ratio of composited std-dev) — rejected. Also
  false-positives on Destined Rivals and Pitch Black; global variance is dominated by ink
  area, not by whether the ink is legible.
- *Orphaned dark ink* — kept. Trim and normalise each logo to a fixed 64px height,
  composite onto the surface colour, and mark every pixel whose **max-channel colour
  distance** from that surface clears 27%. Dilate that legible mask by 2px. The score is
  the fraction of the logo's ink that falls outside the dilated mask.

Two details do the real work. **Colour distance, not luminance:** pure red is dark but reads
perfectly against a desaturated near-black, and a luminance test wrongly condemns every
red/magenta wordmark — Team Rocket, Lost Origin, EX Hidden Legends all came back as false
positives until the test became chromatic. **The dilation:** dark ink hugging bright ink is
an outline, and the mark still reads; only dark ink that is far from anything visible
actually disappears. Without the dilation the metric cannot tell an outlined logo from a
black one.

Flagged at `>= 0.25`, measured against #282d38 (the lighter of the two surfaces logos sit
on, so the count errs low). That is **20 of 157** measured logos: all 9 POP sets, the 8
black-star promo sets (`basep bwp dpp hgssp np smp swshp xyp`), `base4`, `gym2`, `ex8`.
Closest miss is `dv1` (Dragon Vault) at 0.250 — genuinely borderline, left out to keep the
threshold a round number rather than one fitted to a single asset.

**Where the computation lives.** `scripts/set-logo-contrast.sh`, run offline, regenerating
`apps/web/src/lib/setLogoContrast.ts` — a static id list. The render path is a `Set.has`
lookup. Nothing analyses an image per request, and the 20-card /series index costs nothing
it did not cost before. Re-run the script after new sets land.

**The treatment.** A new `<SetLogo>` wraps flagged logos in an off-white plate built from
the `--color-surface-on-light` tokens that already existed for exactly this situation, with
a hairline `--color-surface-on-light-border` and a rounded corner; unflagged logos render
bare and untouched. A universal plate behind *every* logo was considered and rejected: the
e-Card/Neo-era logos are the lightest in the catalog and Silver Tempest's wordmark is
near-white, so a white plate would have moved the problem rather than solved it — and 20
white boxes would have redefined the page for the sake of one bad asset family. A CSS
`drop-shadow` halo was also considered; it needs the same detection, and a glow on a dense
mark looks like a rendering artefact where a plate looks like packaging. The deciding
argument for the plate is that the set *symbol* already renders on a white tile immediately
beside the logo, so the plate reads as the established design language.

**Verification.** Local self-host build, Chromium, 1440 and 428, zero console errors. At
both widths the POP card goes from a bare Poké Ball to a fully legible mark. The diff map
of the /series index shows changed pixels *only* inside the POP card — all 19 other series
cards are byte-identical. The light-logo control (Expedition, `ecard1`) set page is
**pixel-identical** before and after, which is the strongest available evidence that the
good case was not touched. **Not verified on deployed deckpal.app**: /series is behind
Supabase auth and this agent had no account and no permission to mint one, so the live-site
screenshots remain outstanding rather than claimed.

**Implications.** The threshold and the metric are the contract — a future agent adding a
TCG re-runs `scripts/set-logo-contrast.sh` and gets the new flags for free, with no per-set
judgement calls. Separately worth raising as product: /series requiring a login at all is
what made this bug expensive to verify, and a public catalog would let both visitors and
verification agents see the app before signing up.

