/**
 * Catalog card text without markup.
 *
 * Some catalog printings (30th Celebration) carry HTML in their effect text, e.g.
 * `<span class="energy-symbol Lightning" title="Lightning">Lightning</span>` where every other set writes `{L}`.
 * withCleanText() turns the Energy-symbol spans into the symbol, strips any other tag and decodes entities, so such a
 * printing has the same text (and the same textKey) as the same card written with `{L}`.
 * Applied wherever a frame enters the engine, next to withPrintedWR(). Never mutates its input.
 */
import type { CardFrame } from '../types.js';

const SYMBOL: Readonly<Record<string, string>> = {
  Grass: '{G}', Fire: '{R}', Water: '{W}', Lightning: '{L}', Psychic: '{P}', Fighting: '{F}', Darkness: '{D}',
  Metal: '{M}', Colorless: '{C}', Dragon: '{N}', Fairy: '{Y}',
};

const ENTITY: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Text with energy-symbol spans as `{X}`, other tags dropped and entities decoded. Text with no markup is returned as is. */
export function cleanText(s: string): string;
export function cleanText(s: string | null | undefined): string | null | undefined;
export function cleanText(s: string | null | undefined): string | null | undefined {
  if (s == null || (!s.includes('<') && !s.includes('&'))) return s;
  return s
    .replace(/<span\b[^>]*\bclass\s*=\s*"[^"]*\benergy-symbol\s+([A-Za-z]+)[^"]*"[^>]*>[^<]*<\/span>/gi, (m, t: string) => SYMBOL[t] ?? m)
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITY[e.toLowerCase()] ?? m;
    });
}

/** The frame with the markup cleaned out of every text field; the same object when there is none. */
export function withCleanText<F extends CardFrame>(f: F): F {
  const dirty = (s: string | null | undefined): boolean => cleanText(s) !== s;
  if (!(dirty(f.effect) || f.attacks?.some((a) => dirty(a.effect)) || f.abilities?.some((a) => dirty(a.effect)))) return f;
  const out: CardFrame = { ...f };
  if (f.effect != null) out.effect = cleanText(f.effect);
  if (f.attacks) out.attacks = f.attacks.map((a) => ({ ...a, effect: a.effect == null ? a.effect : cleanText(a.effect) }));
  if (f.abilities) out.abilities = f.abilities.map((a) => ({ ...a, effect: cleanText(a.effect) }));
  return out as F;
}
