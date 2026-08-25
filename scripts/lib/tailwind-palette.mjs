/**
 * The canonical Tailwind palette, read from the installed tailwindcss package
 * rather than transcribed — so it cannot drift from what the app actually uses.
 *
 * Tailwind v4 ships its colours as oklch(), which nothing in the image pipeline
 * understands, so they are converted here: oklch → Oklab → linear sRGB → sRGB,
 * per the CSS Color 4 definition. When cross-checking output against a crib
 * sheet, use v4 hexes: v4 rebased the blues in oklch (sky-500 is #00a6f4, NOT
 * v3's #0ea5e9), so a v3 sheet makes a correct conversion look like a bug.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * tailwindcss is a dependency of apps/web, not the root, and its package
 * exports map does not expose theme.css — so resolve it by path instead of
 * `require.resolve`.
 */
function themeCssPath() {
  const candidates = [
    join(repoRoot, 'apps/web/node_modules/tailwindcss/theme.css'),
    join(repoRoot, 'node_modules/tailwindcss/theme.css'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`tailwindcss/theme.css not found. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

/** oklch(L% C H) → { r, g, b } in 0–255, gamut-clipped. */
export function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // Oklab → LMS (cube roots)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  // LMS → linear sRGB
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const enc = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return { r: enc(lr), g: enc(lg), b: enc(lb) };
}

export const hex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Parse every `--color-<family>-<step>: oklch(...)` out of tailwind's theme.css.
 * Greys and the pure black/white keywords are included; `oklab()`/`color()`
 * forms and non-colour tokens are skipped.
 */
export function loadTailwindPalette() {
  const themePath = themeCssPath();
  const css = readFileSync(themePath, 'utf8');
  const out = [];
  const re = /--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g;
  for (const m of css.matchAll(re)) {
    const [, family, step, L, C, H] = m;
    const rgb = oklchToRgb(Number(L) / 100, Number(C), Number(H));
    out.push({ name: `${family}-${step}`, family, step: Number(step), ...rgb, hex: hex(rgb) });
  }
  return out;
}
