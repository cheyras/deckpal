/**
 * Deterministic scripts for the cheap tier: a Pokémon (no Ability) whose every attack effect has the
 * same wording as an attack an existing, tested script implements. The example's DSL is copied with the
 * card's own numbers and types substituted by position, and a script is kept only when the text
 * round-trip renders it back to the card's printed text with NO problem. Cards with a ruling filed under
 * their own name, an ambiguous substitution, or any round-trip problem are left for a model to script.
 *   node --import tsx scripts/codegen-cheap.ts <tiersDir> <out.ts> <rejects.json> [exclude.txt] [--name STD_GEN_2]
 * <tiersDir> holds the h01.json.. lanes written by scripts/standard-tiers.ts. Write a NEW <out.ts> for each new set (std-gen-<set>.ts)
 * with its own --name (default STD_GEN, the existing src/cards/scripts/std-gen.ts) and register it in src/cards/scripts/index.ts.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normText } from '../src/cards/frame.js';
import { FRAMES } from '../src/cards/frames-all.js';
import { roundTrip } from '../src/cards/render.js';
import '../src/cards/scripts/index.js';
import type { CardScript } from '../src/dsl.js';
import type { CardFrame } from '../src/types.js';

const nameIdx = process.argv.indexOf('--name');
const EXPORT_NAME = nameIdx > 0 ? process.argv[nameIdx + 1]! : 'STD_GEN';
if (nameIdx > 0) process.argv.splice(nameIdx, 2);
const [tiersDir, outPath, rejectsPath, excludePath] = process.argv.slice(2);
// Cards whose generated effect showed no difference in the standard position (cards-std-gen.test.ts): a
// conditional effect that position can't trigger needs a card-specific test, so a model scripts it.
const EXCLUDE = new Set(excludePath ? readFileSync(excludePath, 'utf8').split(/\s+/).filter(Boolean) : []);
const TYPE: Record<string, string> = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', C: 'Colorless', N: 'Dragon', Y: 'Fairy' };
const nums = (t: string) => [...t.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
const types = (t: string) => [...t.matchAll(/\{([A-Z])\}/g)].map((m) => TYPE[m[1]!] ?? m[1]!);
const base = (d: string | null | undefined) => (d ? Number(/\d+/.exec(d)?.[0] ?? NaN) : NaN);
const norm = (s: string) => normText(s).toLowerCase();

type Entry = { id: string; name: string; attack: string; text: string; dsl: unknown };
type Card = { id: string; name: string; frame: CardFrame; rulings: { categories: string[] }[]; cookbook: Record<string, Entry[]> };

/** old value → new value, from aligned sequences; null when one old value would need two new ones. */
function mapping<T>(from: T[], to: T[], extra: [T, T][] = []): Map<T, T> | null {
  if (from.length !== to.length) return null;
  const m = new Map<T, T>();
  for (const [a, b] of [...extra, ...from.map((x, i) => [x, to[i]!] as [T, T])]) {
    if (m.has(a) && m.get(a) !== b) return null;
    m.set(a, b);
  }
  return m;
}

function substitute(v: unknown, n: Map<number, number>, t: Map<string, string>): unknown {
  if (typeof v === 'number') return n.has(v) ? n.get(v) : v;
  if (typeof v === 'string') return t.has(v) ? t.get(v) : v;
  if (Array.isArray(v)) return v.map((x) => substitute(x, n, t));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, n, t)]));
  return v;
}

const cards: Card[] = readdirSync(tiersDir!)
  .filter((f) => /^hb?\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(tiersDir!, f), 'utf8')).cards);
const accepted: { script: CardScript; frame: CardFrame }[] = [];
const rejects: { id: string; name: string; why: string }[] = [];
for (const c of cards) {
  const f = c.frame;
  if (EXCLUDE.has(c.id)) {
    rejects.push({ id: c.id, name: c.name, why: 'its generated effect changed nothing in the standard position' });
    continue;
  }
  if (c.rulings.some((r) => r.categories.some((x) => norm(x) === norm(c.name)))) {
    rejects.push({ id: c.id, name: c.name, why: 'has rulings filed under its name' });
    continue;
  }
  const attacks: Record<string, unknown> = {};
  let why = '';
  for (const a of f.attacks ?? []) {
    if (!a.effect) continue;
    let done = false;
    for (const ex of c.cookbook[a.name] ?? []) {
      const exDamage = FRAMES[ex.id]?.attacks?.find((x) => x.name === ex.attack)?.damage;
      const extra: [number, number][] = Number.isFinite(base(exDamage)) && Number.isFinite(base(a.damage)) ? [[base(exDamage), base(a.damage)]] : [];
      const n = mapping(nums(ex.text), nums(a.effect), extra);
      const t = mapping(types(ex.text), types(a.effect));
      if (!n || !t) continue;
      attacks[a.name] = substitute(ex.dsl, n, t);
      done = true;
      break;
    }
    if (!done) {
      why = `no unambiguous substitution for "${a.name}"`;
      break;
    }
  }
  if (why) {
    rejects.push({ id: c.id, name: c.name, why });
    continue;
  }
  const script = { id: c.id, name: f.name, attacks } as CardScript;
  const problems = roundTrip(script, f).flatMap((s) => s.problems.map((p) => `${s.key}: ${p}`));
  if (problems.length) {
    rejects.push({ id: c.id, name: c.name, why: `round trip: ${problems.join('; ')}` });
    continue;
  }
  accepted.push({ script, frame: f });
}

const body = accepted
  .map(({ script, frame }) => {
    const lines = [`  {`, `    id: '${script.id}',`, `    name: ${JSON.stringify(script.name)},`, `    attacks: {`];
    for (const [name, dsl] of Object.entries(script.attacks ?? {})) {
      const printed = frame.attacks?.find((x) => x.name === name)?.effect ?? '';
      lines.push(`      // ${JSON.stringify(printed)}`, `      ${JSON.stringify(name)}: ${JSON.stringify(dsl)},`);
    }
    lines.push(`    },`, `  },`);
    return lines.join('\n');
  })
  .join('\n');
writeFileSync(
  outPath!,
  `/**\n * GENERATED by scripts/codegen-cheap.ts: Pokémon whose every attack effect is worded exactly like an attack\n * an existing, tested script implements. Each is that script with this card's numbers and types, kept only\n * because the text round-trip renders it back to the printed text with no problem. Do not edit by hand:\n * move a card to a hand-written lane file to change it.\n */\nimport type { CardScript } from '../../dsl.js';\n\nexport const ${EXPORT_NAME}: CardScript[] = [\n${body}\n];\n`,
);
writeFileSync(rejectsPath!, JSON.stringify(rejects, null, 1));
console.log(`cheap-tier cards ${cards.length}: generated ${accepted.length}, left for a model ${rejects.length}`);
const reasons = new Map<string, number>();
for (const r of rejects) reasons.set(r.why.split(':')[0]!.replace(/"[^"]*"/, '"…"'), (reasons.get(r.why.split(':')[0]!.replace(/"[^"]*"/, '"…"')) ?? 0) + 1);
console.log([...reasons].map(([k, v]) => `${v} ${k}`).join(' | '));
