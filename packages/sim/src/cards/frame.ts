/**
 * Printed frame (catalog data) → compiled CardDef, plus the text key that lets
 * one script serve every printing whose game text is identical.
 */
import type { CardScript, PType, Step } from '../dsl.js';
import type { AbilityDef, AttackDef, CardDef, CardFrame, Coverage } from '../types.js';
import { CARD_TAGS } from './tags.js';
import { TERA_PRINTINGS } from './tera.js';

const TYPES: Record<string, PType> = {
  Grass: 'Grass',
  Fire: 'Fire',
  Water: 'Water',
  Lightning: 'Lightning',
  Psychic: 'Psychic',
  Fighting: 'Fighting',
  Darkness: 'Darkness',
  Metal: 'Metal',
  Dragon: 'Dragon',
  Colorless: 'Colorless',
  Fairy: 'Fairy',
};

export function parseType(s: string): PType {
  const t = TYPES[s.trim()];
  if (!t) throw new Error(`unknown type "${s}"`);
  return t;
}

export function parseCost(cost: string | null | undefined): PType[] {
  if (!cost) return [];
  return cost
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseType);
}

/** "30+" → [30, '+'], "30×" → [30, '×'], "120" → [120, ''], null → [0, '']. */
export function parseDamage(d: string | null | undefined): [number, string] {
  if (d == null || d === '') return [0, ''];
  const m = /^(\d+)\s*([+×x\-]?)$/.exec(String(d).trim());
  if (!m) return [0, ''];
  const suffix = m[2] === 'x' ? '×' : (m[2] ?? '');
  return [Number(m[1]), suffix];
}

/** Normalise printed text for keying and comparison: whitespace, apostrophes, dashes. */
export function normText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Two printings share a key exactly when their game text is identical: name,
 * HP, stage, types, attacks (name/cost/damage/text), Abilities, Trainer/Energy
 * text, Weakness/Resistance, Retreat. Reprints resolve to one script; a
 * reworded printing gets its own key and is never silently treated as the same.
 */
function normModifier(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/^[x×]/i, '×').replace(/[−–—]/g, '-');
}

export function textKey(f: CardFrame): string {
  const parts = [
    normText(f.name),
    f.category,
    f.hp ?? '',
    f.stage ?? '',
    f.suffix ?? '',
    normText(f.evolvesFrom),
    f.trainerType ?? '',
    (f.types ?? []).join('/'),
    f.retreat ?? '',
    normText(f.effect),
    ...(f.attacks ?? []).map(
      (a) => `A:${normText(a.name)}|${a.cost ?? ''}|${a.damage ?? ''}|${normText(a.effect)}`,
    ),
    ...(f.abilities ?? []).map((a) => `B:${normText(a.name)}|${normText(a.effect)}`),
    // Catalog noise in the modifier: "x2" and "×2" are the same Weakness (mep-012 Mega Lucario ex).
    ...(f.weaknesses ?? []).map((w) => `W:${w.type}${normModifier(w.value)}`),
    ...(f.resistances ?? []).map((r) => `R:${r.type}${normModifier(r.value)}`),
  ];
  return parts.join('\u0001');
}

/** The tag a printing carries ("Ancient" / "Future"), or null. Per printing, not per text: see CARD_TAGS. */
export function tagOf(f: CardFrame): 'Ancient' | 'Future' | null {
  return CARD_TAGS[f.cardId] ?? null;
}

/**
 * What makes two copies the same card DEFINITION in a game: the same game text (`textKey`), the same tag and the same Tera
 * status. A script still serves every printing of a text, but a tagged (or Tera) printing and a plain reprint of it are
 * different definitions.
 */
export function defKey(f: CardFrame): string {
  const t = tagOf(f);
  const k = t ? `${textKey(f)}\u0002${t}` : textKey(f);
  return TERA_PRINTINGS.has(f.cardId) ? `${k}\u0002Tera` : k;
}

const BASIC_ENERGY = /^Basic (\w+) Energy$|^(\w+) Energy$/;

/** True when a frame needs no script: no effect, Ability or Trainer text anywhere. */
export function isVanilla(f: CardFrame): boolean {
  if (f.category === 'Trainer') return false;
  if (f.category === 'Energy') return isBasicEnergyFrame(f);
  if ((f.abilities ?? []).length) return false;
  return (f.attacks ?? []).every((a) => !a.effect);
}

export function isBasicEnergyFrame(f: CardFrame): boolean {
  if (f.category !== 'Energy') return false;
  if (f.effect) return false;
  const m = BASIC_ENERGY.exec(f.name.trim());
  return !!m && !!TYPES[(m[1] ?? m[2]) as string];
}

function basicEnergyType(f: CardFrame): PType | null {
  const m = BASIC_ENERGY.exec(f.name.trim());
  if (!m) return null;
  return TYPES[(m[1] ?? m[2]) as string] ?? null;
}

const RULE_BOX_SUFFIXES = new Set(['ex', 'EX', 'V', 'VMAX', 'VSTAR', 'GX', 'TAG TEAM-GX', 'BREAK', 'Prism Star', 'Radiant']);

/** Build the immutable definition. `script` may be null (vanilla or uncovered). */
export function buildDef(idx: number, f: CardFrame, script: CardScript | null, codePrefix: string): CardDef {
  const kind = f.category === 'Pokemon' ? 'pokemon' : f.category === 'Trainer' ? 'trainer' : 'energy';
  const suffix = f.suffix ?? null;
  const name = f.name.trim();
  const ex = suffix === 'ex' || suffix === 'EX' || / ex$/.test(name);
  const mega = ex && /^Mega /.test(name);
  const ruleBox =
    (suffix != null && RULE_BOX_SUFFIXES.has(suffix)) ||
    / (ex|EX|V|VMAX|VSTAR|GX)$/.test(name) ||
    /^Radiant /.test(name);
  const stage = f.stage === 'Stage2' ? 2 : f.stage === 'Stage1' ? 1 : 0;
  const vmax = suffix === 'VMAX' || / VMAX$/.test(name);
  const asBasic = kind === 'trainer' ? script?.fix?.playAsBasic : undefined; // lane:ghost (Antique fossils)
  const prizeValue = kind !== 'pokemon' ? (asBasic ? 1 : 0) : mega || vmax ? 3 : ruleBox && !/^Radiant /.test(name) ? 2 : 1;

  const attacks: AttackDef[] = (f.attacks ?? []).map((a, i) => {
    const [baseDamage, damageSuffix] = parseDamage(a.damage);
    return {
      name: normText(a.name),
      cost: parseCost(a.cost),
      baseDamage,
      damageSuffix,
      text: normText(a.effect),
      code: `${codePrefix}#a${i}`,
    };
  });
  const abilities: AbilityDef[] = (f.abilities ?? []).map((a, i) => {
    const s = script?.abilities?.find((x) => normText(x.name) === normText(a.name));
    return {
      name: normText(a.name),
      text: normText(a.effect),
      script: s,
      code: s?.activated ? `${codePrefix}#b${i}` : undefined,
    };
  });
  if (asBasic?.discardable) {
    // lane:ghost — "At any time during your turn, you may discard this card from play." offered as an
    // activated, unlimited action of the card in play (customs: discardSelfFromPlay, ghost-customs.ts).
    const n = 'Discard from play';
    abilities.push({
      name: n,
      text: 'At any time during your turn, you may discard this card from play.',
      script: { name: n, activated: { program: [{ op: 'custom', fn: 'discardSelfFromPlay' }], oncePerTurn: false } },
      code: `${codePrefix}#b${abilities.length}`,
    });
  }

  const weak = (f.weaknesses ?? [])[0];
  const res = (f.resistances ?? [])[0];
  const basicEnergy =
    kind === 'energy' && !script?.fix?.specialEnergy && isBasicEnergyFrame(f);
  const eType = basicEnergy ? basicEnergyType(f) : null;

  let coverage: Coverage;
  if (script) coverage = 'full';
  else if (isVanilla(f)) coverage = 'vanilla';
  else coverage = kind === 'pokemon' ? 'approx' : 'none';

  const ttype =
    kind === 'trainer'
      ? (({ Item: 'item', Supporter: 'supporter', Stadium: 'stadium', Tool: 'tool' } as const)[
          (f.trainerType ?? '') as 'Item' | 'Supporter' | 'Stadium' | 'Tool'
        ] ?? null)
      : null;

  const text = [
    normText(f.effect),
    ...abilities.map((a) => `${a.name}: ${a.text}`),
    ...attacks.map((a) => `${a.name}: ${a.text}`),
  ]
    .filter((s) => s && s !== ':')
    .join(' / ');

  return {
    idx,
    id: f.cardId,
    name,
    kind,
    coverage,
    hp: asBasic ? asBasic.hp : (f.hp ?? 0),
    stage,
    // lane:misc — fix.evolvesFrom fills a catalog gap (30th-123 Hisuian Zoroark).
    evolvesFrom: script?.fix?.evolvesFrom ?? (f.evolvesFrom ? normText(f.evolvesFrom) : null),
    types: asBasic ? [asBasic.type] : (f.types ?? []).filter((t) => TYPES[t]).map(parseType),
    // fix.weakness / fix.resistance fill a catalog gap (sv10.5b-067 Genesect ex; DATA-DIFF.md).
    weakness: script?.fix?.weakness ?? (weak && TYPES[weak.type] ? parseType(weak.type) : null),
    resistance:
      script?.fix?.resistance ??
      (res && TYPES[res.type]
        ? { type: parseType(res.type), amount: Math.abs(parseInt(res.value, 10)) || 30 }
        : null),
    retreat: f.retreat ?? 0,
    ruleBox,
    ex,
    mega,
    tera: !!script?.fix?.tera || TERA_PRINTINGS.has(f.cardId), // a Tera printing (cards/tera.ts), or a script that says so
    prizeValue,
    tag: tagOf(f),
    attacks,
    abilities,
    ttype,
    aceSpec: !!script?.fix?.aceSpec,
    playCode: null,
    playable: script?.playable ?? null,
    needsDeck: kind === 'trainer' && !!script?.play && needsOnlyDeck(script.play, /only if you discard/i.test(f.effect ?? '')),
    stadiumCode: null,
    stadiumWhen: script?.stadiumAbility?.when ?? null,
    basicEnergy,
    provides: script?.provides ?? (eType ? [eType] : kind === 'energy' ? ['Colorless'] : []),
    statics: [],
    triggers: [],
    text,
    script,
  };
}

/**
 * True when a play program does something only through its player's deck: it draws, searches the
 * deck or takes cards off its top, and does nothing else that counts as an effect. A discard from the
 * hand is a COST only when the card says so ("You can use this card only if you discard ..." — Ultra
 * Ball, TPCi 2017-04-27); otherwise it is an effect and the card stays playable with an empty deck
 * (Gwynn, TPCi 2026-07-16: "Yes. You can do as much as you can."). Anything the analysis doesn't
 * recognise counts as an effect, so a card is never wrongly made unplayable.
 */
export function needsOnlyDeck(program: Step[], handDiscardIsCost = false): boolean {
  let deck = false;
  const walk = (steps: Step[]): boolean => {
    for (const st of steps) {
      switch (st.op) {
        case 'draw':
          if (st.who === 'opp') return false;
          deck = true;
          break;
        case 'chooseCards':
          if (st.from === 'deck' && st.who !== 'opp') deck = true;
          else if (st.from !== 'hand' || !handDiscardIsCost) return false;
          break;
        case 'move':
          if (typeof st.cards === 'object' && 'top' in st.cards && st.cards.who !== 'opp') deck = true;
          else if (typeof st.cards === 'object') return false;
          break;
        case 'shuffle':
        case 'set':
        case 'end':
          break;
        case 'may':
        case 'repeat':
          if (!walk(st.body)) return false;
          break;
        case 'if':
          if (!walk(st.then) || !walk(st.else ?? [])) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  };
  return walk(program) && deck;
}
