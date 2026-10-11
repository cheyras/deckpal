/**
 * Print a readable play-by-play of simulated games, for a person to skim for
 * wrong rulings (not part of CI).
 *
 *   node --import tsx scripts/transcript.ts "<deck A>" "<deck B>" [seed=1] [games=1] [--out file.md]
 *
 * Deck names: "Hide 'n' Sneak", "Toolbox Slowking", any account gauntlet name
 * (src/__tests__/gauntlet.ts) or meta name (src/__tests__/meta/index.ts);
 * case-insensitive substring match.
 */
import { writeFileSync } from 'node:fs';
import { createContext, type DeckInput } from '../src/context.js';
import { Game } from '../src/game.js';
import { playOut } from '../src/play.js';
import { makePilot } from '../src/pilot/index.js';
import { transcript } from '../src/transcript.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING, fromIds } from '../src/__tests__/decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from '../src/__tests__/gauntlet.js';
import { META_LISTS } from '../src/__tests__/meta/index.js';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [aName = "Hide 'n' Sneak", bName = 'Toolbox Slowking', seedArg = '1', gamesArg = '1'] = args;

const all: DeckInput[] = [
  HIDE_N_SNEAK,
  TOOLBOX_SLOWKING,
  ...Object.keys(GAUNTLET_LISTS).map(gauntletDeck),
  ...Object.entries(META_LISTS).map(([n, l]) => fromIds(n, l)),
];
const find = (q: string) => {
  const hit = all.find((d) => d.name.toLowerCase().includes(q.toLowerCase()));
  if (!hit) throw new Error(`no deck matching "${q}". Decks: ${all.map((d) => d.name).join(' | ')}`);
  return hit;
};
const a = find(aName);
const b = find(bName);
const doc: string[] = [];
for (let k = 0; k < Number(gamesArg); k++) {
  const seed = Number(seedArg) + k;
  const ctx = createContext(a, b, { events: true, first: k % 2 === 0 ? 0 : 1, maxTurns: 60 });
  const g = playOut(new Game(ctx, null, seed), [makePilot('search', seed * 2 + 1), makePilot('search', seed * 2 + 2)]);
  doc.push(`## ${a.name} (P1) vs ${b.name} (P2) — seed ${seed}`, '', '```', ...transcript(ctx, g.events, { names: ['P1', 'P2'] }), '```', '');
}
const text = doc.join('\n');
if (out) {
  writeFileSync(out, `# Simulated games — play-by-play\n\nSearch CPU on both sides. Omniscient: both players' draws are named.\n\n${text}`);
  console.log(`wrote ${out}`);
} else console.log(text);
