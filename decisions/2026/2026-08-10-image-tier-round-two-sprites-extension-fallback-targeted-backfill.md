---
date: "2026-08-10"
title: "Image tier, round two: sprites, extension fallback, targeted backfill"
decided_by: "user (\"sprites need to be solved… lots of instances where card art is"
areas: ["images"]
supersedes: []
---
## 2026-08-10 — Image tier, round two: sprites, extension fallback, targeted backfill
**Decided by:** user ("sprites need to be solved… lots of instances where card art is
still missing (for example, we're missing the pitch black set logo)").
**Decision:** three fixes, each aimed at a *measured* cause, plus an honest
accounting of what is left.

**1. Sprites are served.** `/deckpal/images/sprites/{pixel|art}[/shiny]/{id}.png`
now fills from `PokeAPI/sprites` at the commit SHA pinned in
`scripts/fetch-sprites.sh`, into `sprites/…` in the bucket, mirroring the on-disk
`SPRITE_ROOT` layout exactly.

Sprites are the one asset class with **no per-file manifest row**, and that is
deliberate, not a shortcut: `.claude/skills/add-tcg/image-slots.md` already
records that the tree is bulk-cloned from one pinned commit, so its provenance is
that SHA rather than ~4,100 rows repeating it. Adding rows would also break the
self-host tripwire — `manifest:check` scans only `images/` and `sets/` on disk but
compares against *every* row, so sprite rows would show up as thousands of
phantom missing files and turn a clean check permanently red. The exception is
made explicit in code: `putUnmanifestedObject()` still demands provenance AND a
written `tierProvenanceReason` saying where the class-level record lives, so it
cannot be used casually. `SPRITES_SHA` is duplicated between the shell script and
`paths.ts`, so a **test fails if the two ever drift** — silent drift there would
mean serving bytes we cannot attribute.

**2. A 404 on `.webp` is not proof the asset is gone.** TCGdex URLs are a base
plus an extension you choose (the SPA says so in `assetUrl()`), and the origin
re-encodes: the "Pitch Black" (me05) set logo 404s as `.webp` today and returns
131 KB of PNG at the same base as `.png`. Verified 2026-08-10. The cold fill now
walks `.webp → .png → .jpg` on a 404 and records **the URL that actually served
the bytes**, with the content type sniffed from the bytes — so a PNG under a
`.webp` name is stored and served as `image/png` rather than as a lie. Only
404-class misses are retried; a 5xx or a network error says nothing about the
extension.

**3. Set imagery is now upstream-independent.** `scripts/storage-backfill.mjs`
mirrors a local cache subtree into the bucket (the object key *is*
`relative_path`, so it is a plain copy). Ran `--prefix sets`: **326 objects,
3.70 MB** — every logo and symbol we hold, including the ones TCGdex no longer
serves as WebP. Also ran `--prefix images --missing-source`, which uploads only
the rows with `source_url IS NULL`: **1,854 cards, ~121 MB**. Those are precisely
the images the lazy path can *never* recover, because there is no URL to recover
them from; the bytes on the Pi are the only copy. Total bucket use stays far
inside Supabase Free's 1 GB. The script refuses to upload any file lacking a
manifest row, and it backs off on 429 — Supabase Storage throttles at six
parallel uploads (measured), and a mirror that dies on the first 429 leaves a
half-filled bucket.

**What is still missing, and why it cannot be fixed here:** 1,346 of the 46,888
expected (card, quality) pairs have no manifest row *and* no upstream asset —
they are concentrated in `tcgp/B2a` (262), `sv/mfb` (68) and the twelve Trainer
Kit sets (60 each). Probed directly: `assets.tcgdex.net/en/tcgp/B2a/001/low.webp`
404s while `…/B2/001/low.webp` serves 16,878 bytes, so upstream simply has not
published art for those sets. They render the placeholder, which is the correct
answer. Re-run the catalog sync and the warmer when TCGdex publishes them.

**Not done:** the sprite tree is ~260 MB and is left to lazy fill (GitHub raw at a
pinned SHA is reliable and free); a full `--prefix images` mirror is still the
Pro-tier ($25/mo, 100 GB) path and remains one command.

