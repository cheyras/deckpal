/**
 * Route the Standard pool's unscripted cards: a card goes to the cheap tier when it is a Pokémon
 * without Abilities and every attack effect matches a template some existing script already
 * implements (the cookbook entry shows how). Everything else goes to the strong tier.
 *   node --import tsx scripts/standard-tiers.ts <lanesDir> <outDir>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMES } from '../src/cards/frames-all.js';
import { SCRIPTS } from '../src/cards/scripts/index.js';
import type { CardFrame } from '../src/types.js';

export const template = (t: string) =>
  t.replace(/\{[A-Z]\}/g, '{T}').replace(/\b\d+\b/g, 'N').replace(/Pokemon/g, 'Pokémon').replace(/\s+/g, ' ').trim();

const [lanesDir, outDir] = process.argv.slice(2);
// Every test block in the suite, by title, so a cookbook entry can carry the test of its example card.
const TEST_DIR = new URL('../src/__tests__/', import.meta.url);
const testBlocks: { title: string; src: string }[] = [];
for (const f of readdirSync(TEST_DIR).filter((x) => x.endsWith('.test.ts'))) {
  const lines = readFileSync(new URL(f, TEST_DIR), 'utf8').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^test\((['"`])(.*?)\1/.exec(lines[i]!);
    if (!m) continue;
    let j = i;
    while (j < lines.length && lines[j] !== '});') j++;
    if (j - i <= 60) testBlocks.push({ title: m[2]!, src: lines.slice(i, j + 1).join('\n') });
  }
}
const testFor = (name: string, attack: string) =>
  (testBlocks.find((t) => t.title.includes(name) && t.title.includes(attack)) ?? testBlocks.find((t) => t.title.startsWith(name)))?.src;
// Cookbook: template → up to 2 existing implementations (card id, attack, its DSL).
const cookbook = new Map<string, { id: string; name: string; attack: string; text: string; dsl: unknown; test?: string }[]>();
for (const s of SCRIPTS) {
  const f = FRAMES[s.id];
  if (!f) continue;
  for (const a of f.attacks ?? []) {
    if (!a.effect || !s.attacks?.[a.name]) continue;
    const k = template(a.effect);
    const list = cookbook.get(k) ?? [];
    if (list.length < 2) list.push({ id: s.id, name: s.name, attack: a.name, text: a.effect, dsl: s.attacks[a.name], test: testFor(s.name, a.name) });
    cookbook.set(k, list);
  }
}
type Card = { id: string; name: string; printings: string[]; frame: CardFrame; rulings: unknown[] };
const cards: Card[] = readdirSync(lanesDir!).filter((x) => /^std\d+\.json$/.test(x)).flatMap((f) => JSON.parse(readFileSync(join(lanesDir!, f), 'utf8')).cards);
const cheap: Card[] = [];
const strong: Card[] = [];
for (const c of cards) {
  const f = c.frame;
  const ok =
    f.category === 'Pokemon' &&
    !(f.abilities ?? []).length &&
    !f.effect &&
    (f.attacks ?? []).every((a) => !a.effect || cookbook.has(template(a.effect)));
  (ok ? cheap : strong).push(c);
}
mkdirSync(outDir!, { recursive: true });
const write = (tier: string, list: Card[], size: number) => {
  const lanes: string[] = [];
  for (let i = 0; i < list.length; i += size) {
    const lane = `${tier}${String(lanes.length + 1).padStart(2, '0')}`;
    const batch = list.slice(i, i + size).map((c) => ({
      ...c,
      cookbook: Object.fromEntries((c.frame.attacks ?? []).filter((a) => a.effect).map((a) => [a.name, cookbook.get(template(a.effect!)) ?? []])),
    }));
    writeFileSync(join(outDir!, `${lane}.json`), JSON.stringify({ lane, tier, cards: batch }, null, 1));
    lanes.push(lane);
  }
  return lanes;
};
const h = write('h', cheap, 40);
const s = write('s', strong, 25);
console.log(`cookbook templates ${cookbook.size}; cheap ${cheap.length} cards in ${h.length} lanes; strong ${strong.length} cards in ${s.length} lanes`);
