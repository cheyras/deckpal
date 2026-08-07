---
name: add-image-slot
description: Use AUTOMATICALLY whenever the user asks to add a new kind or type of image / visual asset to a page that the app doesn't already source — e.g. a banner, an artist headshot, a rarity icon, a booster-pack image, an illustrator signature, a card-back, a set box render, a type badge. Also use when a page has a missing/placeholder image of a type not yet in the catalog. The skill researches where that image can come from, sources real candidates, gets the user's explicit approval, wires the slot in end-to-end (cache path → warmer → image service route → frontend), then codifies the new slot into the Image-Slot Catalog so future agents and future TCGs know how to fill it. TCG-agnostic.
---

# add-image-slot — add a new kind of image, and teach the app how to source it forever

Whenever a new *kind* of image is wanted on a page (a new "image slot"), this skill both
**implements it** and **captures the how-to** so the app's image intelligence compounds over
time. It is the maintenance arm of the Image-Slot Catalog at
`.claude/skills/add-tcg/image-slots.md` (read that first — it's the shared source of truth and
the format you'll append to). The deep sourcing methodology lives in the `add-tcg` skill (Step 4);
reuse it, don't restate it.

**Two hard gates:** (1) **source samples and get the user's explicit approval before wiring
anything in or codifying** — never invent or assume the right image. (2) **verify the slot
renders in a real browser** before marking it done.

## Workflow

### 1. Pin down the slot
Clarify with the user (only what you can't infer): what image, on **which page/component**, what
it **represents** and its **cardinality** (per-card? per-set? per-artist? per-rarity? per-species?
global?), the **shape/aspect**, and whether it's one image or a set. Write it as a one-line slot
spec.

### 2. Check the catalog
Read `.claude/skills/add-tcg/image-slots.md`. If this slot already exists → follow its entry and
you're done (it's a warm/wire task, not a new slot). If it's genuinely new → continue.

### 3. Research where it can come from
Apply the `add-tcg` Step-1 source rubric to THIS slot specifically. Candidates, in rough order:
- **The existing catalog/image source** already wired for the game (does it expose this asset?).
- **A field already in our DB** (e.g. an artist name, a rarity, a TCGplayer id) that keys into a
  source or lets us derive/compose the image.
- **A new open source / CDN** for this asset type — vet coverage, licensing, format, per-item vs
  bulk, signed URLs (same rubric as add-tcg).
- **Derived/generated** (e.g. a type badge or rarity icon that's a small fixed set of SVGs/CC0
  assets, or generated) — fine when no photographic source exists; prefer authored/CC0 over scraped.
Prefer sources keyed to ids we already store. Note licensing; surface concerns to the user.

### 4. Source real candidates → GET APPROVAL (gate)
Fetch a handful of **real** samples for representative items (not mockups). Show them to the user
(`SendUserFile` the images, or a small rendered artifact) with where each came from and the
coverage/licensing note. **Ask the user to approve the source + look before proceeding.** Do not
wire anything broadly or codify until they approve. If they reject, iterate on sources.

### 5. Implement the slot (only after approval)
Follow the `add-tcg` Step-4 contract exactly:
- **Cache path**: extend `apps/images/src/layout.ts` with the new slot's `…RelativePath` /
  `…AbsolutePath` following the on-disk convention; add a **service route** in
  `apps/images/src/index.ts` (validate inputs, bar traversal, 404→client placeholder).
- **Warmer**: enumerate the work-list **from the DB** (not a source manifest); primary source →
  fallback; validate downloads (content-type + magic bytes, reject tiny bodies), polite rate
  limit, resumable. Model on `apps/images/src/warmer.ts` / `apps/images/src/warmFromPkmn.ts`.
- **Write through the choke point** — `putAsset` from `apps/images/src/store.ts`, never a bare
  `writeFile` into the cache. It does the atomic write *and* records the `image_asset` row, and
  it **requires** provenance: `fromUrl(sourceUrl)` for anything fetched, or
  `unknownProvenance('<why>')` when the source genuinely can't be established. Never invent a
  plausible URL. If the new slot needs a `kind` that isn't in the `image_asset` CHECK (migration
  006 allows `card`, `set-logo`, `set-symbol`, `set-background`, `sprite`, `avatar`, `banner`),
  that is the one case where a slot needs an additive migration — flag it before you build.
- **Frontend**: render it on the requested page/component with a graceful fallback on miss
  (no broken image, no layout shift); match the app's Tailwind conventions.
- If this slot feeds the scanner (rare), reindex + restart per add-tcg Step 5.
- **Prove no drift** before calling it done: `rtk pnpm --filter pokedex-images manifest:check`
  must exit 0. Bytes in the cache with no manifest row are a defect, not a detail.

### 6. Verify (gate)
`curl` a few served URLs → HTTP 200, real bytes (not the ~1 KB placeholder). Then open the page in
a real browser at desktop **and** 390px and confirm it renders (Playwright at
`~/amazon-mcp/node_modules`; one chromium, `--no-sandbox`, close in `finally`). Report `N of M`
items with a real image and the honest residue.

### 7. Codify into the catalog (the point of this skill)
Append a new entry to `.claude/skills/add-tcg/image-slots.md` using its **entry template** —
purpose/renders, cardinality, cache path + route, format/tiers, **sourcing (primary + fallback +
which DB table to enumerate from)**, optimization, verify, game-specific?, and the Added line
(date, that the user approved the samples, any residue). This is what makes the app's image
intelligence grow: the next agent — or the next TCG onboarded via `add-tcg` — now knows how to
fill this slot without rediscovering it. Mark it `status: active`.

### 8. Report & offer to commit
Summarize: the slot, the approved source, coverage/residue, the files touched, and that it's
codified. Offer to commit (repo convention: commit to `main`, never commit the image cache).

## Rules
- Prefix every shell command (and every `&&` segment) with `rtk` (see `CLAUDE.md`).
- Respect the image-cache contract and gitignore — **never commit card art or bulk assets**.
- Secrets/session tokens are read at runtime only, never committed or logged.
- Approval gate (step 4) and browser verification (step 6) are non-negotiable; don't skip either.
- Stay within the Postgres connection budget; don't touch nginx or other pm2 apps.
