# foil-glyphs — drop your real glyph artwork here

This directory is the **drop-in glyph slot** for the foil renderer (R3-GLYPH,
2026-08-03). You promised real glyph/pattern SVGs in four canon-lab comments —
drop each file at the path below and the workbench picks it up **automatically
within ~2.5 seconds** while the pattern is on screen (the viewer polls the
branch api's `/foil-lab/glyphs` index and re-rasterizes on file mtime change).
No rebuild, no server restart, no code change. Deleting a file falls straight
back to the current procedural glyph.

## The four expected drops

| Your comment | Pattern | Drop the file(s) at |
|---|---|---|
| q1ay7h — "I will provide the actual glyph or a pattern as an SVG" | reverse-sheet | `research/foil-glyphs/reverse-sheet/glyph.svg` (one emblem, stamped per grid cell; several files `glyph-1.svg`, `glyph-2.svg`… become a random per-cell mix) |
| y853aj — "I would like to provide the pattern and the glyph" | energy-symbols | `research/foil-glyphs/energy-symbols/glyph-1.svg` … `glyph-9.svg` (the 9 energy icons — any count 1–16 works) |
| pta96a — "I will provide the [glyphs] for this" | energy-symbols-ii | `research/foil-glyphs/energy-symbols-ii/glyph-1.svg`… — **optional**: if you leave this dir empty it automatically shares the `energy-symbols/` atlas |
| hjwcss — "I'll provide a better glyph, the hand rolled one isn't great" | prismatic-pokeball | `research/foil-glyphs/prismatic-pokeball/glyph.svg` (the Poké Ball watermark) |

## File contract

- **Names:** `glyph.svg` (single) or `glyph-1.svg` … `glyph-16.svg` (a set).
  `.png` is accepted too, same names. Anything else is ignored.
- **Shape:** square-ish viewBox, glyph centered, filled — the **alpha channel
  is the stamp coverage** (opaque = foil glyph, transparent = background). No
  background rect.
- **Color:** doesn't matter for most slots (the shader colors the glyph with
  the pattern's hue ramp — draw it white/any solid). One exception:
  **prismatic-pokeball** also reads the glyph's *interior luminance* as
  light-response detail — brighter interior areas (belt, button) catch the
  flash at a further phase offset, which is what makes the ball's structure
  read. Shading the belt/button lighter or darker than the body is useful
  there; pure-flat works too, it just reads as one plane.
- Files are committed to the repo (they're small vector art, not card scans —
  the image-cache rule doesn't apply). Commit them whenever — the pickup is
  from the working tree.

## What happens mechanically

1. The branch api (`POKEDEX_FOIL_LAB=1`, port 3712) serves this dir read-only:
   `GET /pokedex/api/foil-lab/glyphs` (index with mtimes) and
   `GET /pokedex/api/foil-lab/glyphs/<slug>/<file>`.
2. `apps/web/src/foil/glyphs.ts` polls the index while a glyph-capable pattern
   is displayed, rasterizes the SVGs into a texture atlas (256 px per glyph),
   and `CardViewer` binds it to the shader (`uGlyphTex`/`uGlyphOn`/…).
3. Each recipe's GLSL branches on `uGlyphOn`: atlas present → sample your
   artwork (`glyphTex()` helper in `shader.ts`); absent → the procedural glyph
   you see today. Everything else (checkerboard swap, banks, noise grain,
   light-response ball) is behavior and runs identically with either glyph.

**Prod note:** the glyph routes are dev-instance only (the `POKEDEX_FOIL_LAB`
gate, same as masks/canon). Prod renders procedural fallbacks until a bundling
step copies `research/foil-glyphs/` into the SPA build and the loader learns a
static path — deliberately not built until real assets exist to bundle.
