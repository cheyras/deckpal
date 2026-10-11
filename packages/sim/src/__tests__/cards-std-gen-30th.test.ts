/**
 * The generated cheap-tier scripts for 30th Celebration and the Mega promos (std-gen-30th.ts) are copies of tested scripts with this card's numbers
 * and types, kept only because they round-trip to the printed text. This checks the other half: every
 * generated attack effect actually changes the game. Each attack is played from one standard position
 * twice — with the script, and with the card played vanilla (a script with no attacks) — under all-heads
 * and all-tails coins, and the outcomes must differ in at least one of those. It also must never throw.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAMES } from '../cards/frames-all.js';
import type { CardScript } from '../dsl.js';
import { STD_GEN_30TH } from '../cards/scripts/std-gen-30th.js';
import { scenario } from '../scenario.js';
import { allSlots } from '../state.js';
import type { Game } from '../game.js';
import type { CardFrame } from '../types.js';
import { fromIds } from './decks.js';

const ENERGY: Record<string, string> = { Grass: 'mee-001', Fire: 'mee-002', Water: 'mee-003', Lightning: 'mee-004', Psychic: 'mee-005', Fighting: 'mee-006', Darkness: 'mee-007', Metal: 'mee-008' };
const NAME: Record<string, string> = { Grass: 'Grass Energy', Fire: 'Fire Energy', Water: 'Water Energy', Lightning: 'Lightning Energy', Psychic: 'Psychic Energy', Fighting: 'Fighting Energy', Darkness: 'Darkness Energy', Metal: 'Metal Energy' };
// A sturdy vanilla defender with no Weakness or Resistance to anything, and a small vanilla Basic for the Benches.
const vanilla = (f: CardFrame) => f.category === 'Pokemon' && !f.abilities?.length && (f.attacks ?? []).every((a) => !a.effect) && !f.effect;
const WALL = Object.values(FRAMES).filter((f) => vanilla(f) && f.stage === 'Basic' && !f.weaknesses?.length && !f.resistances?.length).sort((a, b) => (b.hp ?? 0) - (a.hp ?? 0))[0]!;
const SMALL = Object.values(FRAMES).find((f) => vanilla(f) && f.stage === 'Basic' && (f.hp ?? 0) >= 60 && f.cardId !== WALL.cardId)!;

function energyFor(f: CardFrame, attack: string): string[] {
  const a = f.attacks!.find((x) => x.name === attack)!;
  const own = (f.types ?? []).find((t) => ENERGY[t]) ?? 'Psychic';
  const cost = (a.cost ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return [...cost.map((t) => NAME[ENERGY[t] ? t : own]!), NAME[own]!, NAME[own]!];
}

function signature(g: Game): string {
  const s = g.state;
  const side = (p: 0 | 1) => {
    const ps = s.p[p];
    return [ps.hand.length, ps.deck.length, ps.discard.length, ps.prizes.length, allSlots(ps).map((sl) => `${sl.cards.length}/${sl.energy.length}/${sl.tools.length}/${sl.damage}/${sl.cond}`).join(',')].join('|');
  };
  return [side(0), side(1), JSON.stringify(s.effects.map((e) => e.static)), s.phase, s.turn].join(' # ');
}

function play(script: CardScript, f: CardFrame, attack: string, heads: boolean, asVanilla: boolean): string {
  const own = (f.types ?? []).find((t) => ENERGY[t]) ?? 'Psychic';
  const deckA = fromIds('gen A', [[f.cardId, 4], [SMALL.cardId, 8], [ENERGY[own]!, 20], ...Object.values(ENERGY).filter((e: string) => e !== ENERGY[own]).map((e: string) => [e, 3] as [string, number])]);
  const deckB = fromIds('gen B', [[WALL.cardId, 4], [SMALL.cardId, 8], [ENERGY[own]!, 20]]);
  const g = scenario(
    deckA,
    deckB,
    [
      { active: f.name, bench: [SMALL.name, SMALL.name], energy: { active: energyFor(f, attack) }, damage: { active: 30 }, hand: [SMALL.name, NAME[own]!] },
      { active: WALL.name, bench: [SMALL.name], energy: { active: [NAME[own]!] }, hand: [SMALL.name, NAME[own]!] },
    ],
    asVanilla ? { scripts: [{ id: script.id, name: script.name }] } : {},
  );
  g.state.forcedCoins = Array(20).fill(heads);
  const d = g.decision!;
  const i = d.actions?.findIndex((a) => a.t === 'attack' && f.attacks![(a as { idx: number }).idx]?.name === attack) ?? -1;
  if (i < 0) return 'no attack';
  g.submit([i]);
  for (let n = 0; n < 50 && !g.over && g.decision && g.decision.kind !== 'main'; n++) g.submit(g.decision.min > 0 ? Array.from({ length: g.decision.min }, (_, k) => k) : [0].slice(0, g.decision.max));
  return signature(g);
}

test('every generated attack effect changes the game, and never throws', () => {
  const dead: string[] = [];
  for (const script of STD_GEN_30TH) {
    const f = FRAMES[script.id]!;
    for (const attack of Object.keys(script.attacks ?? {})) {
      let differs = false;
      for (const heads of [true, false]) {
        if (play(script, f, attack, heads, false) !== play(script, f, attack, heads, true)) differs = true;
      }
      if (!differs) dead.push(`${script.id} ${script.name} / ${attack}`);
    }
  }
  assert.deepEqual(dead, [], `these generated effects changed nothing:\n${dead.join('\n')}`);
});
