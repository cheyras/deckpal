/**
 * Bespoke effects for the "std-c15" batch (std-c15.ts). Names are prefixed `c15.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c15.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { evolveOnto } from '../../evolve.js';
import { def, type Env } from '../../context.js';
import type { Filter } from '../../dsl.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { countersFixed, countersPrevented, effectsPrevented, maxHp, statics } from '../../query.js';
import { allSlots, emit, findSlot, healSlot, opp, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState, Slot } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Cinccino, Special Roll: "...for each Special Energy card attached to this Pokémon."
 * args: { filter, as }. Counts the Energy CARDS attached to this Pokémon that match the filter (cards, not units
 * provided), into variable `as`.
 */
registerCustom('c15.countAttached', (env, s, f, args) => {
  const sl = findSlot(s, f.slot)?.slot;
  const filter = args.filter as Filter | undefined;
  f.vars[String(args.as ?? 'n')] = sl ? sl.energy.filter((c) => cardMatches(env, c, filter)).length : 0;
  return 'next';
});

/**
 * Sableye, Damage Collection: "You may move any number of damage counters from your opponent's Benched Pokémon to their
 * Active Pokémon." (Compendium #1955: any number of Benched Pokémon may be chosen; every counter ends on the Active Pokémon.)
 * The controller is asked, for each damaged Benched Pokémon in turn, how many of its counters to move (0 to all). Nothing
 * moves when an effect stops counters from being moved, or when the Active Pokémon is protected from the effects of attacks
 * (or from damage counters being placed); a Benched Pokémon protected from the effects of attacks is not asked about.
 */
registerCustom('c15.collectCounters', (env, s, f, _args, answer) => {
  const os = s.p[opp(f.player)];
  const target = os.active;
  if (!target) return 'next';
  const done = (): 'next' => {
    delete f.vars.__c15ids;
    delete f.vars.__c15i;
    delete f.vars.__c15n;
    return 'next';
  };
  const all = statics(env, s);
  if (countersFixed(env, s, 0, all) || countersFixed(env, s, 1, all)) return 'next';
  if (effectsPrevented(env, s, target, f.player, 'attack', all) || countersPrevented(env, s, target, f.player, 'attack', all)) return 'next';
  let ids = f.vars.__c15ids as number[] | undefined;
  if (!ids) {
    ids = os.bench.filter((b) => b.damage > 0 && !effectsPrevented(env, s, b, f.player, 'attack', all)).map((b) => b.id);
    f.vars.__c15ids = ids;
    f.vars.__c15i = 0;
    f.vars.__c15n = 0;
  }
  let i = f.vars.__c15i as number;
  let moved = f.vars.__c15n as number;
  if (answer !== undefined) {
    const src = findSlot(s, ids[i] as number)?.slot;
    const k = Math.min((answer as number[])[0] ?? 0, src ? Math.floor(src.damage / 10) : 0);
    if (src && k > 0) {
      src.damage -= k * 10;
      moved += k;
    }
    i++;
  }
  while (i < ids.length) {
    const src = findSlot(s, ids[i] as number)?.slot;
    const n = src ? Math.floor(src.damage / 10) : 0;
    if (!src || n <= 0) {
      i++;
      continue;
    }
    f.vars.__c15i = i;
    f.vars.__c15n = moved;
    const labels = Array.from({ length: n + 1 }, (_, j) => (j === 0 ? 'Move none' : `Move ${j} damage counter${j > 1 ? 's' : ''}`));
    return ask(s, { player: f.player, kind: 'option', prompt: `Move how many damage counters from ${def(env.ctx, topCard(src)).name}?`, min: 1, max: 1, labels }, 'index');
  }
  if (moved > 0) {
    target.damage += moved * 10;
    emit(env, { type: 'counters', player: opp(f.player), slot: target.id, n: moved });
  }
  return done();
});

/**
 * Delcatty, Energy Blender: "You may move any amount of Energy from your Pokémon to your other Pokémon in any way you like."
 * The controller repeatedly picks one Energy card attached to their Pokémon (or none, to stop) and then a different Pokémon
 * of theirs to move it to. Each card moves at most once (every end position is still reachable). The choice names the
 * Pokémon each Energy is on. Nothing is asked with a single Pokémon in play or no Energy.
 */
registerCustom('c15.moveEnergyAny', (env, s, f, _args, answer) => {
  const ps = s.p[f.player];
  const slots = allSlots(ps);
  const moved = (f.vars.__c15moved as number[] | undefined) ?? [];
  const finish = (): 'next' => {
    delete f.vars.__c15moved;
    delete f.vars.__c15card;
    return 'next';
  };
  if (slots.length < 2) return finish();
  for (;;) {
    let card = f.vars.__c15card as number | undefined;
    if (card === undefined) {
      if (answer !== undefined) {
        card = (answer as number[])[0];
        answer = undefined;
        if (card === undefined) return finish();
        f.vars.__c15card = card;
      } else {
        const pool: number[] = [];
        const labels: string[] = [];
        for (const sl of slots) {
          for (const c of sl.energy) {
            if (moved.includes(c)) continue;
            pool.push(c);
            labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
          }
        }
        if (!pool.length) return finish();
        return ask(s, { player: f.player, kind: 'cards', prompt: 'Move an Energy (or none to stop)', min: 0, max: 1, values: pool, labels }, 'cards');
      }
    }
    const src = slots.find((sl) => sl.energy.includes(card as number));
    const dests = slots.filter((sl) => sl !== src);
    let to: Slot | undefined;
    if (!src || !dests.length) {
      delete f.vars.__c15card;
      continue;
    }
    if (answer !== undefined) {
      to = dests.find((sl) => sl.id === (answer as number[])[0]);
      answer = undefined;
    } else if (dests.length === 1) to = dests[0];
    else {
      return ask(s, { player: f.player, kind: 'slots', prompt: 'Move it to which Pokémon?', min: 1, max: 1, values: dests.map((d) => d.id) }, 'slots');
    }
    delete f.vars.__c15card;
    if (to) {
      src.energy = src.energy.filter((c) => c !== card);
      to.energy.push(card as number);
      emit(env, { type: 'attach', player: f.player, card: card as number, slot: to.id });
      moved.push(card as number);
      f.vars.__c15moved = moved;
    }
  }
});

/**
 * Minccino, Cleaning Up: "Discard up to 2 Pokémon Tools from your opponent's Pokémon."
 * args: { max }. The controller picks 0 to `max` of the Tools attached to their opponent's Pokémon (the choice names
 * the Pokémon each is on); each goes to its owner's discard pile. A Pokémon protected from the effects of attacks
 * (Hide 'n' Sneak) loses nothing and its Tool is not offered.
 */
registerCustom('c15.discardOppTools', (env, s, f, args, answer) => {
  const os = s.p[opp(f.player)];
  const all = statics(env, s);
  const tools: number[] = [];
  const where: string[] = [];
  for (const sl of allSlots(os)) {
    if (effectsPrevented(env, s, sl, f.player, 'attack', all)) continue;
    for (const t of sl.tools) {
      tools.push(t);
      where.push(`${def(env.ctx, t).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (!tools.length) return 'next';
  if (answer === undefined) {
    const max = Math.min(Number(args.max ?? 2), tools.length);
    return ask(s, { player: f.player, kind: 'cards', prompt: `Discard up to ${max} Pokémon Tools`, min: 0, max, values: tools, labels: where }, 'cards');
  }
  for (const c of answer as number[]) {
    const holder = allSlots(os).find((sl) => sl.tools.includes(c));
    if (!holder || !removeFrom(holder.tools, c)) continue;
    s.p[env.ctx.owner[c] as 0 | 1].discard.push(c);
    emit(env, { type: 'discard', player: env.ctx.owner[c] as 0 | 1, cards: [c] });
  }
  return 'next';
});

/** Own Pokémon with damage on them and 30 HP or less remaining (Bianca's Devotion). */
function lowHpDamaged(env: Env, s: GameState, p: 0 | 1): Slot[] {
  return allSlots(s.p[p]).filter((sl) => sl.damage > 0 && maxHp(env, s, sl) - sl.damage <= 30);
}

/**
 * Bianca's Devotion (the gate): "Heal all damage from 1 of your Pokémon that has 30 HP or less remaining."
 * True when one of the controller's Pokémon has damage on it and 30 or less HP remaining (HP counting any HP changes).
 */
registerCustomCond('c15.lowHpDamaged', (env, s, ec) => lowHpDamaged(env, s, ec.player).length > 0);

/**
 * Bianca's Devotion: heal all the damage from 1 of the controller's Pokémon that has 30 HP or less remaining.
 * The controller picks among the damaged ones that qualify (no question when only one does).
 */
registerCustom('c15.healLowHp', (env, s, f, _args, answer) => {
  const pool = lowHpDamaged(env, s, f.player);
  if (!pool.length) return 'next';
  let target: Slot | undefined;
  if (answer !== undefined) target = pool.find((sl) => sl.id === (answer as number[])[0]);
  else if (pool.length === 1) target = pool[0];
  else {
    return ask(s, { player: f.player, kind: 'slots', prompt: 'Heal which Pokémon?', min: 1, max: 1, values: pool.map((sl) => sl.id) }, 'slots');
  }
  if (target) healSlot(s, target, target.damage, env);
  return 'next';
});

/**
 * Pidove, Emergency Evolution: "...you may search your deck for an Unfezant or Unfezant ex and put it onto this Pidove to
 * evolve it." (the program shuffles next). args: { names }. Unlike an ordinary evolution, the card need not "evolve from"
 * Pidove, and it works on the turn Pidove was played and on the controller's first turn (Compendium #1949). The controller
 * may pick one card with one of the names, or none. It goes on top of the stack, which clears Special Conditions and
 * attack effects on the Pokémon, as evolving does.
 */
registerCustom('c15.evolveSelfFromDeck', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const sl = findSlot(s, f.slot)?.slot;
  if (!sl) return 'next';
  const names = (args.names as string[]) ?? [];
  if (answer === undefined) {
    const opts = ps.deck.filter((c) => def(env.ctx, c).kind === 'pokemon' && names.includes(def(env.ctx, c).name));
    if (!opts.length) return 'next';
    return ask(s, { player: f.player, kind: 'cards', prompt: `Evolve ${def(env.ctx, topCard(sl)).name} with a card from your deck (or none)`, min: 0, max: 1, values: opts }, 'cards');
  }
  const pick = (answer as number[])[0];
  if (pick === undefined || !removeFrom(ps.deck, pick)) return 'next';
  ps.prizesKnown = true; // the player looked through their deck
  emit(env, { type: 'search', player: f.player, found: [pick] });
  evolveOnto(env, s, sl, pick);
  emit(env, { type: 'evolve', player: f.player, card: pick, slot: sl.id });
  return 'next';
});
