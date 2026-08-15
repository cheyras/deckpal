/**
 * The 32×32 favicon grid — authored at 32×32, never resampled.
 *
 * No diffusion model can emit 32×32. Measured through the Vercel AI Gateway:
 * bfl/flux-2-pro refuses anything under 64px, openai/gpt-image-1 offers only
 * 1024 and up, recraft/recraftv3 rejects it outright. Generating at 1024 and
 * shrinking does not produce pixel art — it produces a photograph of pixel art,
 * and the resample smears the grid it was imitating.
 *
 * So the sprite is drawn a pixel at a time instead. assets/brand/favicon-32.txt
 * is 32 lines of 32 characters, each character an index into LEGEND below, and
 * every LEGEND entry is checked against the canonical Tailwind palette at render
 * time. Two properties fall out by construction: it is a true 32×32 grid, and no
 * colour outside the Tailwind palette can appear in it.
 *
 * To change the artwork, edit the .txt. One character is one pixel.
 */
import { loadTailwindPalette } from './tailwind-palette.mjs';

/**
 * Character → canonical Tailwind colour name. '.' is transparent.
 * Deliberately small: a tight ramp per material is what makes pixel art read.
 */
export const LEGEND = {
  '.': null,            // transparent
  o: 'slate-900',       // outline / pupils
  // The body ramp is CYAN end to end, because cyan IS the brand: theme.css's
  // --color-brand-primary-* is the Tailwind cyan ramp value for value
  // (brand-primary-500 === cyan-500 === #00b8db). Sky is a different, bluer
  // hue — sky-500 is #00a6f4 — so shading a cyan body with sky quietly walks
  // the mark off-brand. Keep every body step in one family.
  l: 'cyan-200',        // body highlight
  c: 'cyan-300',        // body light
  C: 'cyan-400',        // body mid  (the brand cyan)
  s: 'cyan-500',        // body shade
  S: 'cyan-700',        // body deep shade
  w: 'slate-50',        // eye white
  p: 'rose-300',        // mouth light / lip
  P: 'rose-500',        // mouth mid
  R: 'rose-700',        // mouth deep
  // The bolts stay in the blue family on purpose — in the source render they
  // read as a distinctly bluer accent against the cyan box, not as brand cyan.
  b: 'blue-700',        // lightning bolt
  B: 'blue-900',        // lightning bolt shade
  g: 'amber-300',       // gold card light
  G: 'amber-500',       // gold card mid
  r: 'rose-400',        // rose card light
  E: 'rose-600',        // rose card mid
};

/** Resolve LEGEND to rgb, failing loudly if a name is not canonical Tailwind. */
export function resolveLegend() {
  const palette = loadTailwindPalette();
  const byName = new Map(palette.map((c) => [c.name, c]));
  const out = new Map();
  for (const [ch, name] of Object.entries(LEGEND)) {
    if (name === null) { out.set(ch, null); continue; }
    const c = byName.get(name);
    if (!c) throw new Error(`LEGEND uses '${name}', which is not a canonical Tailwind colour`);
    out.set(ch, c);
  }
  return out;
}

export const SIZE = 32;

export function legendDoc() {
  return Object.entries(LEGEND)
    .map(([ch, name]) => `  ${ch}  ${name ?? 'TRANSPARENT (background)'}`)
    .join('\n');
}

/** Strict parse: 32 lines × 32 legal characters, or a thrown error saying why. */
export function parseGrid(text) {
  const lines = text
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0);

  if (lines.length !== SIZE) {
    throw new Error(`expected ${SIZE} lines, got ${lines.length}`);
  }
  const legal = new Set(Object.keys(LEGEND));
  lines.forEach((line, y) => {
    if (line.length !== SIZE) {
      throw new Error(`line ${y + 1} has ${line.length} chars, expected ${SIZE}: ${JSON.stringify(line)}`);
    }
    for (const ch of line) {
      if (!legal.has(ch)) throw new Error(`line ${y + 1} uses illegal character ${JSON.stringify(ch)}`);
    }
  });
  return lines;
}

/** Grid → RGBA buffer, transparent where '.'. */
export function gridToRgba(lines) {
  const legend = resolveLegend();
  const px = Buffer.alloc(SIZE * SIZE * 4);
  lines.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      const c = legend.get(ch);
      const i = (y * SIZE + x) * 4;
      if (!c) return; // stays 0,0,0,0
      px[i] = c.r; px[i + 1] = c.g; px[i + 2] = c.b; px[i + 3] = 255;
    });
  });
  return px;
}

/** Which Tailwind colours a grid actually used, most-used first. */
export function usedColours(lines) {
  const counts = new Map();
  for (const line of lines) for (const ch of line) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([ch]) => LEGEND[ch] !== null)
    .sort((a, b) => b[1] - a[1])
    .map(([ch, n]) => ({ name: LEGEND[ch], px: n }));
}
