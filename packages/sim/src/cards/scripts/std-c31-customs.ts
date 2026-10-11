/**
 * Bespoke effects for the "std-c31" batch (std-c31.ts). Names are prefixed `c31.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c31.test.ts.
 */
import { def } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { emit, findSlot, opp, rand, removeFrom } from '../../state.js';
import type { Decision, GameState, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

function firstId(v: Val | undefined): number | undefined {
  return Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
}

/**
 * Redeemable Ticket: "Count your Prize cards, shuffle them, and put them on the bottom of your deck. Then, take that many
 * cards from the top of your deck and put them face down as your Prize cards."
 * The controller's Prize cards are shuffled and go under the deck (index 0 is the bottom); then as many cards as there were
 * Prize cards are taken off the top of the deck and become the new Prize cards. The owner has not seen them, so what they
 * deduced about their Prize cards no longer holds.
 */
registerCustom('c31.redeemableTicket', (_env, s, f) => {
  const p = f.player;
  const ps = s.p[p];
  const n = ps.prizes.length;
  if (!n) return 'next';
  const prizes = ps.prizes.splice(0);
  for (let i = prizes.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s, p) * (i + 1));
    const t = prizes[i] as number;
    prizes[i] = prizes[j] as number;
    prizes[j] = t;
  }
  ps.deck.unshift(...prizes);
  ps.prizes.push(...ps.deck.splice(ps.deck.length - n, n));
  ps.prizesKnown = false;
  ps.knownTop = Math.max(0, ps.knownTop - n);
  return 'next';
});

/**
 * Rabsca ex, Upside-Down Draw: "Draw `n` cards from the bottom of your deck."
 * args: { n }. Takes up to n cards off the bottom of the controller's deck (index 0) into their hand; a smaller deck gives fewer.
 */
registerCustom('c31.drawFromBottom', (env, s, f, args) => {
  const ps = s.p[f.player];
  for (let i = 0; i < Number(args.n ?? 1) && ps.deck.length; i++) {
    const c = ps.deck.shift() as number;
    ps.hand.push(c);
    removeFrom(ps.revealed, c);
    emit(env, { type: 'draw', player: f.player, card: c });
  }
  ps.knownTop = Math.min(ps.knownTop, ps.deck.length);
  return 'next';
});

/**
 * Spiky Energy: "...put 2 damage counters on the Attacking Pokémon."
 * args: { n }. Places n damage counters on the Pokémon that used the current attack, wherever it is now (it may have moved to
 * the Bench since the damage was done, TPCi 2026-06-04, ruling 2371); nothing if it has left play. They are counters, not damage:
 * no Weakness, Resistance or damage modifier applies, and an Energy card's effect is not stopped by what stops attacks' effects.
 */
registerCustom('c31.countersOnAttacker', (env, s, f, args) => {
  if (s.attackBy === undefined) return 'next';
  const loc = findSlot(s, s.attackBy);
  if (!loc || loc.owner === f.player) return 'next';
  const n = Number(args.n ?? 1);
  loc.slot.damage += n * 10;
  emit(env, { type: 'counters', player: loc.owner, slot: loc.slot.id, n });
  return 'next';
});

/**
 * Team Rocket's Blipbug, Searching Eyes: "Look at 1 of your opponent's face-down Prize cards."
 * The controller is shown one of the opponent's Prize cards (the first of the pile: they are face down and alike) and answers
 * "OK"; the card stays in the same position in the Prize area and the opponent does not see it (TPCi 2025-05-29, ruling 2163).
 * An empty Prize area: nothing to look at. (The sim does not record that the controller now knows that card; the question
 * itself shows it.)
 */
registerCustom('c31.lookAtOppPrize', (env, s, f, _args, answer) => {
  if (answer !== undefined) return 'next';
  const prizes = s.p[opp(f.player)].prizes;
  if (!prizes.length) return 'next';
  const name = def(env.ctx, prizes[0] as number).name;
  return ask(s, { player: f.player, kind: 'option', prompt: `You look at one of your opponent's Prize cards: ${name}`, min: 1, max: 1, labels: ['OK'] }, 'index');
});

/**
 * Arboliva ex, Oil Salvo: "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.)
 * For each time you chose a Pokémon, do 20 damage to it."
 * args: { n (choices, default 6), per (damage each, default 20), from (variable prefix of the choices: `<from>1`..`<from>n`,
 * default 'a'), into (default 't'), amounts (default 'k') }. Totals the choices per Pokémon: `<into>i` is the i-th distinct
 * chosen Pokémon (empty when there are fewer) and `<amounts>i` its damage, `per` for each time it was chosen. The attack then
 * damages each once with its total, since all damage modifiers apply to the total (TPCi 2025-05-29, ruling 2161).
 */
registerCustom('c31.tallyChoices', (_env, s, f, args) => {
  void s;
  const n = Number(args.n ?? 6);
  const per = Number(args.per ?? 20);
  const from = String(args.from ?? 'a');
  const into = String(args.into ?? 't');
  const amounts = String(args.amounts ?? 'k');
  const order: number[] = [];
  const count = new Map<number, number>();
  for (let i = 1; i <= n; i++) {
    const id = firstId(f.vars[`${from}${i}`]);
    if (id === undefined) continue;
    if (!count.has(id)) order.push(id);
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  for (let i = 1; i <= n; i++) {
    const id = order[i - 1];
    f.vars[`${into}${i}`] = id === undefined ? [] : [id];
    f.vars[`${amounts}${i}`] = id === undefined ? 0 : (count.get(id) as number) * per;
  }
  return 'next';
});

/**
 * Ethan's Pinsir, Rallying Horn: "If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your
 * opponent's last turn".
 * args: { nameIncludes }. Reads the controller's `attackKoTurn`/`attackKoCards` (flow.ts records them when a Pokémon is Knocked
 * Out by damage from an opponent's attack): true when that was last turn and one of those Pokémon had the text in its name.
 */
registerCustomCond('c31.koByAttackLastTurn', (env, s, ec, args) => {
  const ps = s.p[ec.player];
  if (ps.attackKoTurn !== s.turn - 1) return false;
  const nameIncludes = String(args.nameIncludes ?? '');
  return (ps.attackKoCards ?? []).some((c) => cardMatches(env, c, { cat: 'pokemon', nameIncludes }));
});
