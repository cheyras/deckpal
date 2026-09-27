---
date: "2026-08-24"
title: "The rest of the chat-open payload: 4.3 MB -> 0.8 MB, and free on every visit after the first"
decided_by: "Claude, on the owner's instruction — \"make it a really smooth"
areas: ["agents"]
supersedes: []
---
## 2026-08-24 — The rest of the chat-open payload: 4.3 MB -> 0.8 MB, and free on every visit after the first
**Decided by:** Claude, on the owner's instruction — "make it a really smooth
process that isn't costing people a bunch of data... let's nip anything in the
bud that we can."

**Decision:**

1. **The environment map is 256x128, not 1024x512** — `studio_small_09_256.hdr`,
   103 KB against 1570 KB, produced by the new
   `scripts/decke/optimize-hdri.mjs`. **Clamp first, then downsample**, and that
   order is the whole script: the runtime caps every texel at
   `ENV_INDIRECT_CLAMP / ENV_INTENSITY` (16.667) before PMREM, and this HDRI runs
   to radiance 526 — downsampling first would average a 526 into its neighbours
   and smear energy the clamp was about to discard, producing a map too bright in
   a way no later clamp can undo. Clamping first is exactly idempotent with what
   `clampEnvironmentTexels` still does at load, so no code changed.
2. **The SDF glyph atlas is 8-bit RGB, not 16-bit** — 288 KB against 1045 KB.
3. **The character assets are cached by the service worker**, Tier 2,
   StaleWhileRevalidate, `deckpal-decke-v1`.
4. **The HDRI was RENAMED** rather than replaced in place, `_1k` -> `_256`,
   because the old name would now be a lie. Three call sites reference it,
   including `character/host/runtime.ts:51`, which is the real chat path — the
   two `/dev` routes are the other two.

**Why:** After the glb went to 592 KB it was no longer the biggest thing the chat
opens with; the HDRI (1570 KB) and the atlas (1045 KB) were. Both turned out to
be carrying data that nothing could use.

The atlas is the more interesting of the two, because the rule against changing
it was written down and confidently wrong. `decke/README.md` said it "must stay
16-BIT", reasoning that the eye shader resolves the glyph edge over a band
0.0035 wide, narrower than one 8-bit step of 0.0039. The arithmetic is correct.
The conclusion was not, because **`TextureLoader` decodes a PNG through the
browser's image decoder, which truncates to 8 bits per channel before the GPU
ever sees it** — read the decoded texels back and there are 176 distinct values
per channel, not 65536, and zero texels land inside that band. The antialiased
edge has never been resolved at any point in this project's history. What DID
break the earlier attempt was that it was 8-bit *greyscale*: `.r` is the glyph
and `.g` is a second layer and they differ on 28% of texels, so collapsing to one
channel destroys half the data. The failure was real and the diagnosis was wrong.
Measured after the change: worst mean 0.0076/255 across all six alert states,
zero pixels off by more than 8.

The HDRI is a straighter trade and was measured the same way — 11 poses, worst
mean 4.8/255. That is larger than the entire glb quantisation (1.76) and it is
still not visible, because what changed is a low-frequency shading gradient
across flat faces rather than an edge: the per-pixel metric overstates lighting
changes badly. It is also safe by construction — the map is never assigned as
`scene.background` (he composites over the DOM), so it exists only to be
prefiltered into a roughness mip chain, and silhouette IoU, which is what
`PARITY.md` actually measures, cannot move.

**Implications:**

- **Repeat opens are now free and instant.** Vercel serves static files as
  `max-age=0, must-revalidate`, so every asset was refetched on every visit.
  StaleWhileRevalidate serves the cached copy immediately and refreshes behind
  it; because Vercel sends an `Etag`, that refresh is a conditional GET that
  returns `304` with a **zero-byte body** (measured against production).
- **CacheFirst would have been wrong.** These filenames are not content-hashed —
  the runtime asks for them by name as literals so `check-precache.mjs` can prove
  they exist — so CacheFirst would pin a stale character until the expiry ran
  out and a deploy would not reach anyone who had already opened the chat.
  SWR lands a deploy on the very next open.
- **They are still NOT precached.** Precaching would put the character in
  `__WB_MANIFEST` and every visitor would download it whether or not they ever
  open the chat, which is exactly what `check-precache.mjs`'s first gate exists
  to prevent.
- Quote transfer sizes at **brotli q=3** — see the entry below.

