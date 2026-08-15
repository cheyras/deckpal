# Marketing imagery — credits and provenance

> **Status: shipped.** Generated 2026-08-10 with `bfl/flux-2-pro` through the Vercel AI
> Gateway — 3 candidates per asset, 18 images, $0.83 total. (The earlier
> `403 customer_verification_required` block was a team-level payment precondition on
> the `deck-pal` team, not a credential problem; an account-scoped
> `AI_GATEWAY_API_KEY` cleared it.)
>
> Selected candidates, as recorded in `.marketing-raw/picks.json`:
>
> | Asset | Pick | Why |
> |---|---|---|
> | `hero-bg` | `cand-2` | near-black left third for the headline; layered rounded-rectangle planes catching a gold bloom on the right, so the subject survives the 960px crop |
> | `texture-grid` | `cand-3` | flat, even, near-black with a fine grid and no focal point — the only candidate that actually tiles invisibly |
> | `og-image` | `cand-3` | calm middle-left for the platform's title overlay; rounded planes echo the hero rather than the other candidates' shards/triangles |
> | `accent-collection` | `cand-2` | centred floating stack with amber rim light and breathing room on all sides |
> | `accent-insights` | `cand-2` | amber curve with a restrained cool-blue secondary; no perspective floor to fight the flat set |
> | `accent-discovery` | `cand-2` | warm amber line + ring traces, same key as the other two accents |
>
> The raw candidates (including the rejects) stay in the gitignored `.marketing-raw/`;
> only the optimised derivatives are committed.

Every image in this directory is an **original work generated for DeckPal**. Nothing
here is stock photography, nothing is traced or derived from third-party artwork, and
nothing depicts real trading cards, existing TCG art, game characters, mascots, or
company logos. The imagery is deliberately abstract — light, atmosphere, and geometry
only — both as a design choice and as a trademark-safety guarantee.

- **Generated via:** [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) (`ai` SDK
  `generateImage`). No direct provider SDKs or third-party image APIs are used.
- **Authentication:** `AI_GATEWAY_API_KEY` (account-scoped). The generator also accepts
  Vercel OIDC (`VERCEL_OIDC_TOKEN`, provisioned by `vercel env pull`), but a team without
  a payment method is refused on either credential.
- **Generator:** [`scripts/gen-marketing-images.mjs`](../../../../scripts/gen-marketing-images.mjs)
  — the canonical source for the prompts, sizes, and encoder settings reproduced below.
- **Post-processing:** [`sharp`](https://sharp.pixelplumbing.com/) (libvips) for resizing
  and AVIF/WebP/JPEG encoding. `texture-grid` is additionally mirror-folded into a
  seamless tile, so its edges are continuous by construction rather than by luck.
- **Licence:** these assets are part of the DeckPal repository and covered by its
  `AGPL-3.0-only` licence.

## Reproducing

```bash
vercel env pull .env.local --environment=development
node scripts/gen-marketing-images.mjs generate    # candidates → .marketing-raw/ (gitignored)
# review candidates, record winners in .marketing-raw/picks.json
node scripts/gen-marketing-images.mjs optimize    # → apps/web/public/marketing/
node scripts/gen-marketing-images.mjs manifest    # → MANIFEST.json
```

`MANIFEST.json` is generated, never hand-edited: its dimensions and byte counts are
measured from the files on disk so they cannot drift from what is actually shipped.

## Trademark-safety clause

The following exclusion list is appended to **every** prompt. Keep it on any prompt
added later:

```text
Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures.
No logos, no brand marks, no icons of real companies.
No recognizable characters, creatures, mascots, people, or faces.
No real or imitation trading cards, no card faces, no card artwork, no game pieces.
Purely abstract: light, atmosphere, geometry, and material only.
```

## Assets, models, and prompts

| Asset | Model | Intrinsic | Widths | Formats |
| --- | --- | --- | --- | --- |
| `hero-bg` | `bfl/flux-2-pro` | 2560x1440 | 2560, 1600, 960 | avif, webp |
| `texture-grid` | `bfl/flux-2-pro` | 1600x1600 | 1600, 800 | avif, webp |
| `og-image` | `bfl/flux-2-pro` | 1200x630 | 1200 | jpeg |
| `accent-collection` | `bfl/flux-2-pro` | 800x800 | 800, 400 | avif, webp |
| `accent-insights` | `bfl/flux-2-pro` | 800x800 | 800, 400 | avif, webp |
| `accent-discovery` | `bfl/flux-2-pro` | 800x800 | 800, 400 | avif, webp |

### `hero-bg`

```text
An abstract, atmospheric background for a premium dark software landing page. A vast, deep charcoal-slate void with soft volumetric depth and gentle haze. A warm amber-gold light bloom glows softly from the upper right, falling off into darkness. Faint, blurred rectangular geometric forms with rounded corners are suggested in shadow — implied planes floating at varied depths and slight angles, readable only as soft silhouettes and thin rim-light edges, never as objects. Subtle film grain, smooth cinematic gradients, generous empty space in the left half for overlaid text. Strict palette: deep slate near-black #15181f and #1f232d surfaces, warm amber gold #ffd54a as the single dominant accent, a restrained cool blue #32b5ff used sparingly as a secondary highlight. Dark, premium, understated, high production value. Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures. No logos, no brand marks, no icons of real companies. No recognizable characters, creatures, mascots, people, or faces. No real or imitation trading cards, no card faces, no card artwork, no game pieces. Purely abstract: light, atmosphere, geometry, and material only.
```

### `texture-grid`

```text
An extremely subtle dark texture for use as a tiled section background. Near-black slate surface with a very faint, evenly distributed mesh gradient — soft low-contrast blooms of deep blue-grey and a barely-there warm amber tint, overlaid with a delicate fine grid of thin darker lines at low opacity. Flat and even overall with no focal point, no vignette, no strong highlights, uniform brightness edge to edge so it tiles invisibly behind body text. Very low contrast, quiet, almost imperceptible. Strict palette: deep slate near-black #15181f and #1f232d surfaces, warm amber gold #ffd54a as the single dominant accent, a restrained cool blue #32b5ff used sparingly as a secondary highlight. Dark, premium, understated, high production value. Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures. No logos, no brand marks, no icons of real companies. No recognizable characters, creatures, mascots, people, or faces. No real or imitation trading cards, no card faces, no card artwork, no game pieces. Purely abstract: light, atmosphere, geometry, and material only.
```

### `og-image`

```text
An abstract social share card background, dark and premium. Deep charcoal-slate field with a warm amber-gold light bloom concentrated in the right third, dissolving into soft shadow. Elegant faint geometric planes drift through the right side at shallow angles, catching thin gold rim light. The entire middle-left region is calm, uncluttered negative space — smooth dark gradient only, nothing competing there. Cinematic, balanced, restrained, subtle grain. Strict palette: deep slate near-black #15181f and #1f232d surfaces, warm amber gold #ffd54a as the single dominant accent, a restrained cool blue #32b5ff used sparingly as a secondary highlight. Dark, premium, understated, high production value. Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures. No logos, no brand marks, no icons of real companies. No recognizable characters, creatures, mascots, people, or faces. No real or imitation trading cards, no card faces, no card artwork, no game pieces. Purely abstract: light, atmosphere, geometry, and material only.
```

### `accent-collection`

```text
A small abstract feature illustration evoking collection and organisation, dark and premium. A neat, orderly stack of thin translucent rectangular planes arranged in precise parallel layers, receding into soft shadow, each edge catching a fine amber-gold rim light. A sense of order, structure, and quiet accumulation. Deep slate background, soft depth of field, centred composition with breathing room. Pure geometry and light. Strict palette: deep slate near-black #15181f and #1f232d surfaces, warm amber gold #ffd54a as the single dominant accent, a restrained cool blue #32b5ff used sparingly as a secondary highlight. Dark, premium, understated, high production value. Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures. No logos, no brand marks, no icons of real companies. No recognizable characters, creatures, mascots, people, or faces. No real or imitation trading cards, no card faces, no card artwork, no game pieces. Purely abstract: light, atmosphere, geometry, and material only.
```

### `accent-insights`

```text
A small abstract feature illustration evoking insight and analytics, dark and premium. Luminous amber-gold lines rise and inflect through dark space like an elegant abstract trend curve, accompanied by soft glowing nodes and a faint cool-blue secondary trace. Gentle bloom where the lines brighten, deep slate background, subtle grid implied in shadow far behind. Clean, precise, weightless. Pure geometry and light. Strict palette: deep slate near-black #15181f and #1f232d surfaces, warm amber gold #ffd54a as the single dominant accent, a restrained cool blue #32b5ff used sparingly as a secondary highlight. Dark, premium, understated, high production value. Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures. No logos, no brand marks, no icons of real companies. No recognizable characters, creatures, mascots, people, or faces. No real or imitation trading cards, no card faces, no card artwork, no game pieces. Purely abstract: light, atmosphere, geometry, and material only.
```

### `accent-discovery`

```text
A small abstract feature illustration evoking discovery and scanning, dark and premium. A soft amber-gold beam of light sweeps across a dark slate field, its leading edge glowing, revealing faint geometric contours and fine scan lines as it passes. Concentric ripples of light expand outward from the sweep. A single cool-blue accent glint. Sense of search, reveal, and motion. Deep shadow, volumetric haze, centred composition. Pure geometry and light. Strict palette: deep slate near-black #15181f and #1f232d surfaces, warm amber gold #ffd54a as the single dominant accent, a restrained cool blue #32b5ff used sparingly as a secondary highlight. Dark, premium, understated, high production value. Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures. No logos, no brand marks, no icons of real companies. No recognizable characters, creatures, mascots, people, or faces. No real or imitation trading cards, no card faces, no card artwork, no game pieces. Purely abstract: light, atmosphere, geometry, and material only.
```
