/**
 * Random-play fuzz for a batch of newly scripted cards (not part of CI): every card goes into decks
 * with its pre-evolutions and Basic Energy, and random and search CPU games must never crash, stall
 * or break the card zones.
 *   node --import tsx scripts/fuzz-cards.ts <lane script module, e.g. src/cards/scripts/std-seed1.ts> [games=60]
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { DeckInput } from '../src/context.js';
import { FRAMES } from '../src/cards/frames-all.js';
import type { CardScript } from '../src/dsl.js';
import { Game } from '../src/game.js';
import { makePilot } from '../src/pilot/index.js';
import { RandomPilot } from '../src/pilot/random.js';
import { allSlots, slotCards } from '../src/state.js';
import type { CardFrame } from '../src/types.js';

const [modPath, gamesArg] = process.argv.slice(2);
const games = Number(gamesArg ?? 60);
const mod = (await import(pathToFileURL(resolve(modPath!)).href)) as Record<string, unknown>;
const scripts = Object.values(mod).find((v) => Array.isArray(v)) as CardScript[];
const frames = scripts.map((s) => FRAMES[s.id]).filter((f): f is CardFrame => !!f);

const ENERGY: Record<string, string> = { Grass: 'mee-001', Fire: 'mee-002', Water: 'mee-003', Lightning: 'mee-004', Psychic: 'mee-005', Fighting: 'mee-006', Darkness: 'mee-007', Metal: 'mee-008' };
const byName = new Map<string, CardFrame>();
for (const f of Object.values(FRAMES)) if (!byName.has(f.name)) byName.set(f.name, f);
const FILLER = Object.values(FRAMES).find((f) => f.category === 'Pokemon' && f.stage === 'Basic' && !f.abilities?.length && (f.attacks ?? []).every((a) => !a.effect))!;

/** A legal-ish deck around some cards: each with its evolution line, 4 of each, Energy of their types, a filler Basic. */
function deckAround(cards: CardFrame[], name: string): DeckInput {
  const entries = new Map<string, { frame: CardFrame; count: number }>();
  const add = (f: CardFrame, n: number) => entries.set(f.cardId, { frame: f, count: Math.min(4, (entries.get(f.cardId)?.count ?? 0) + n) });
  const types = new Set<string>();
  for (const c of cards) {
    add(c, 4);
    for (const t of c.types ?? []) types.add(t);
    for (const a of c.attacks ?? []) for (const t of (a.cost ?? '').split(',')) if (ENERGY[t.trim()]) types.add(t.trim());
    let from = c.evolvesFrom ? byName.get(c.evolvesFrom) : undefined;
    while (from) {
      add(from, 4);
      from = from.evolvesFrom ? byName.get(from.evolvesFrom) : undefined;
    }
  }
  add(FILLER, 4);
  const list = [...entries.values()];
  const energyTypes = [...types].filter((t) => ENERGY[t]);
  if (!energyTypes.length) energyTypes.push('Psychic');
  const total = list.reduce((n, e) => n + e.count, 0);
  const each = Math.max(4, Math.ceil(Math.max(0, 60 - total) / energyTypes.length));
  for (const t of energyTypes) list.push({ frame: FRAMES[ENERGY[t]!]!, count: each });
  return { name, cards: list };
}

function zonesOk(g: Game): string | null {
  const s = g.state;
  for (const p of [0, 1] as const) {
    const ps = s.p[p];
    const all = [...ps.deck, ...ps.hand, ...ps.discard, ...ps.prizes, ...ps.lost, ...allSlots(ps).flatMap(slotCards), ...s.limbo.filter((c) => g.ctx.owner[c] === p)];
    if (s.stadium?.owner === p) all.push(s.stadium.card);
    if (new Set(all).size !== all.length) return `P${p} duplicate card`;
    if (all.length !== g.ctx.iids[p].length) return `P${p} has ${all.length} of ${g.ctx.iids[p].length} cards`;
  }
  return null;
}

// Decks of 4 lane cards each, rotating, so every card meets several opponents.
const groups: CardFrame[][] = [];
for (let i = 0; i < frames.length; i += 4) groups.push(frames.slice(i, i + 4));
const failures: string[] = [];
let played = 0;
for (let k = 0; k < games; k++) {
  const a = groups[k % groups.length]!;
  const b = groups[(k * 7 + 3) % groups.length]!;
  const search = k % 5 === 4; // every fifth game with the search CPU, which explores far more lines
  const g = new Game(deckAround(a, 'A'), deckAround(b, 'B'), 1000 + k, { maxTurns: 60 }).start();
  const pilots = search ? [makePilot('search', k), makePilot('search', k + 1)] : [new RandomPilot(k), new RandomPilot(k + 1)];
  let n = 0;
  try {
    while (!g.over && n < 4000) {
      const d = g.decision!;
      g.submit(pilots[d.player]!.choose(g, d));
      n++;
      if (n % 25 === 0) {
        const z = zonesOk(g);
        if (z) throw new Error(z);
      }
    }
    if (!g.over) throw new Error(`stalled: ${n} decisions, turn ${g.state.turn}`);
    const z = zonesOk(g);
    if (z) throw new Error(z);
    played++;
  } catch (e) {
    failures.push(`game ${k} [${a.map((f) => f.cardId).join(' ')}] vs [${b.map((f) => f.cardId).join(' ')}]${search ? ' (search)' : ''}: ${(e as Error).message.split('\n')[0]}`);
  }
}
console.log(`${frames.length} cards, ${played}/${games} games clean`);
for (const f of failures.slice(0, 30)) console.log('FAIL', f);
process.exitCode = failures.length ? 1 : 0;
