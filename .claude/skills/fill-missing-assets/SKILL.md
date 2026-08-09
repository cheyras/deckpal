---
name: fill-missing-assets
description: Use AUTOMATICALLY whenever the user points out that assets are missing/blank/showing a placeholder in a specific spot for an image type the app ALREADY supports — e.g. "these cards have no art", "the set logos are missing on this page", "these promos are blank", "no symbol here". (For a brand-new KIND of image not yet in the app, use add-image-slot instead.) The skill diagnoses why the assets are missing, sources + fills them (primary + fallback), verifies they look good in the browser, then contributes any GENERALIZABLE asset-sourcing-thoroughness lesson it learned back into the image-sourcing skill so every other TCG and future gap benefits. TCG-agnostic.
---

# fill-missing-assets — fill a gap, then bank what you learned

When the user points at blank/placeholder assets in a spot, fix the gap **and** harvest any
lesson that would make sourcing more thorough for *other* games/gaps. The sourcing methodology
lives in the `add-tcg` skill (Step 4) and the per-slot how-to lives in
`.claude/skills/add-tcg/image-slots.md` — read the matching slot entry first; reuse, don't restate.

**This is a fill-a-gap-in-an-existing-slot skill.** If the missing image is a *new kind* the app
doesn't render yet, stop and use `add-image-slot` (it has the approval-gate + new-slot flow).

## Workflow

### 1. Locate & scope the gap
Which page/spot, which **slot type** (match it to an entry in `image-slots.md`), and **how many**
items are blank (this card? this set? every promo/energy set? site-wide?). Query the DB / cache to
quantify — don't eyeball. State the scope before fixing.

### 2. Diagnose why they're missing
Real causes seen before (see `DECISIONS.md`): the card exists but was
never warmed; the primary source **404s or its manifest omits that set**; the source→our id
**crosswalk missed** (case/slug/JP-EN collision); wrong local-id padding; the file warmed to the
wrong path; or a genuine upstream gap. Confirm the cause against the artifact (the source URL, the
cache dir) — not a guess.

### 3. Source + fill (thoroughly, and through the choke point)
Follow the slot's catalog entry + `add-tcg` Step 4: enumerate the work-list **from the DB, not the
source manifest**; primary source → fallback(s); validate every download (content-type + magic
bytes, reject tiny/placeholder bodies), WebP where sensible, polite rate limit, resumable,
idempotent. Crosswalk on multiple keys. If it feeds the scanner, `scan:index` + **restart the
service**. **Never invent an asset** — leave genuine gaps and report them.

**Every byte you add to the image store must record where it came from.** Never
`writeFile`/`curl -o`/`cp`/direct Storage upload outside the choke point.
**Cloud:** use `packages/storage/src/put-asset.ts` (Supabase Storage + `image_asset` upsert).
*(May not exist until Wave 2 code lands — mark the step clearly.)*
**Self-host:** use `putAsset` in `apps/images/src/store.ts` (atomic file write + manifest row).
Both require provenance: `fromUrl(sourceUrl)` for anything fetched,
`unknownProvenance('<why>')` only when the source genuinely can't be established. **Never pass
a plausible-but-unverified URL** — an invented source is worse than an honest blank because it
hides the gap.

Existing fillers to reuse rather than reinvent — both already write through the choke point:
- `pnpm --filter deckscout-images warm:gaps` — probes the catalog CDN for cards its manifest omits.
- `pnpm --filter deckscout-images warm:pkmn` — pkmn.gg fallback for art the CDN 404s.

If you need something they don't do, add a command in `apps/images/src/` — **not** a loose script
in `scripts/`. Loose scripts are exactly how 1,970 files ended up in the cache with no record of
their origin (DECISIONS.md 2026-08-07); most of that provenance is unrecoverable.

### 4. Confirm it looks good (gate)
Verify the **filesystem truth** (count real files `-size +2k`; `curl` served URLs → 200, real
bytes not the ~1 KB placeholder) AND open the spot in a real browser at desktop + 390px and look.
Report `N of M` filled and the honest residue (broken down by set/reason).

**Then prove you left no drift** — this gate is not optional:

```bash
rtk pnpm --filter deckscout-images manifest:check     # must exit 0
```

Orphans (bytes with no row) and missing-file rows are both defects. The check also reports how
many rows have honestly-unknown provenance (`source_url IS NULL`) — that count may legitimately
be non-zero from the historical backfill, but it must not grow because of your fill.

### 5. Bank the learning (the point of this skill)
Ask: **"what did I learn here that would apply to other TCGs or other gaps?"** If anything
generalizes — a source quirk, an enumeration/crosswalk trap, a validation gotcha, a
fallback-source pattern, a verification method — append it as a concise bullet to the
**"Accumulated sourcing-thoroughness learnings"** list in `.claude/skills/add-tcg/SKILL.md`
(under "Distilled principles & gotchas"). Rules for a good contribution:
- **Generalizable only** — "TCGdex's manifest omits promo sets → enumerate from the DB" generalizes;
  "mep needed override MEP" does not (that belongs in the slot/runbook, not the thoroughness list).
- **One tight, imperative bullet.** Don't duplicate a lesson that's already there.
- If a slot's **source or fallback** changed, also update that entry in `image-slots.md`.
- If the fix has a per-release/per-game procedure, note it in the game-specific runbook
  rather than the generic list.

This is what compounds: every gap you fill makes the next agent — and every other TCG onboarded
via `add-tcg` — source more thoroughly the first time.

### 6. Report & offer to commit
Summarize: the gap + scope, root cause, what you filled (`N of M` + residue), files touched, and
the thoroughness lesson you banked (if any). Offer to commit (repo convention: commit to `main`;
**never commit the image cache or bulk assets**).

## Rules
- Respect the image-storage contract + gitignore; secrets read at runtime only, never committed/logged.
- **Bytes in the store with no `image_asset` row are a defect.** Write through the choke point
  (cloud: `packages/storage/src/put-asset.ts`; self-host: `apps/images/src/store.ts`); finish
  with `manifest:check` exiting 0 (self-host).
- Verify the artifact, never a warmer's own "warmed/gap" counter (it conflates already-cached with failed).
- Stay within the Postgres connection budget; do not modify shared infrastructure.
- Only bank **generalizable** learnings; keep game-specific specifics in the runbook / slot entry.
