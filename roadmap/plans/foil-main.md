> **Predates the cloud pivot -- re-scope before executing.**

# E1 · foil/main (long-lived branch)

**Parallel track — quarantined by design.** Worktree: `~/pokedex-worktrees/foil` ·
Depends: nothing · **Web dev port: 5182** (register in dev hub as "Foil workbench").
Spec: §2 (locked UX), §3 Wave 1, §7 sources.

## Mission
Variant-accurate 3D holofoil rendering of **real scans** on a quarantined workbench page.
Chey wants unhurried craft time here: `foil/main` merges to main only on his explicit call,
possibly much later. Nothing under this track imports into (or is imported by) collection
views until then.

## Quarantine rules
- All foil work lives on `foil/main` + sub-branches (`foil/patterns`, `foil/masks`,
  `foil/resolver`, `foil/workbench`) that merge back into `foil/main` only.
- The workbench is its own route (suggest `/deckpal/foil-lab`) — reachable by URL, linked from
  nowhere in the app shell.
- Rebase `foil/main` onto main after every root-touching main merge (orchestrator will ping).

## Scope (sub-branchable; pattern library is where the craft time goes)
- [ ] **Workbench page v1** (route + three.js viewer): pick any owned card/variant, real scan
      as the face texture, tilt-driven shader (gyro on phone w/ iOS motion permission, pointer
      on desktop, reduced-motion respected). Dev controls: shader-uniform sliders, pattern
      override dropdown, mask overlay toggle. Phone-first at 390px — Chey reviews from his phone
      via the dev hub.
- [ ] **Pattern library**: one ShaderMaterial recipe per physical foil process. Taxonomy +
      era boundaries per Bulbapedia "Holofoil" (canonical): Starlight, Cosmos/Galaxy, Tinsel,
      Sheen, Water Web, Line, Cracked Ice, Crosshatch, Pixel/Confetti, mirror/reverse-sheet
      patterns, SV-era default; texture-embossed illustration-rare relief is the hardest —
      punt it to last. Expect 15–20 recipes; tune against reference photos/video. Start with
      eras Chey actually owns (check the collection via the API/DB, vintage WOTC = Starlight).
- [ ] **Era layout spec**: art-window/frame/holo-zone rects per frame generation — data, not code.
- [ ] **Mask derivation pipeline**, tiers cheapest-first: layout-driven (era layout + variant
      tier → coarse mask, zero image analysis) → art-driven (segmentation/luminance on the scan;
      pick CV approach that runs sanely on the Pi) → hand-corrected (masks are stored, reviewable
      artifacts, cached against `(card_id, variant_id)` with `derivation_method`).
- [ ] **Resolver**: `(set, rarity, variant_tier) → (layout, pattern, mask_ref)` data table +
      `foil_recipe(card_id, variant_id)` MCP tool. Seed from per-era conventions (Collexy
      series as secondary source), hand-verify against Chey's binder.
- [ ] **SKILL.md × 2**: `foil-effects` (shader conventions, uniform contract, how to add a
      pattern) and the mask-pipeline doc. An agent adds "Crosshatch" from the doc alone.

## Done gate (workbench v1 — the first Chey review)
Any owned card/variant renders its real scan with a selectable pattern + layout-driven mask,
tunable live on the workbench from his phone. Later gates (art-driven masks, full pattern
coverage, resolver accuracy) are set with Chey as the track matures.
