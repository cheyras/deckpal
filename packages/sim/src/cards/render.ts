/**
 * Card script → English, in the printed card-text register, and the
 * round-trip comparison against the card's own text.
 *
 * The plan's control: "Round-trip the text. The definition is rendered back to
 * English and compared with the card's text. A mismatch means the definition or
 * the vocabulary is wrong." Every clause of dsl.ts has a rendering below; a
 * `custom` step renders as `[custom: name]` (with a gloss of what the function's
 * CODE does, when one is registered in CUSTOM_GLOSS — written from the code, not
 * the card, or the check proves nothing).
 *
 * The comparison (see `compare`) is two things:
 *  - a similarity score in [0, 1]: the mean of a multiset Dice coefficient and
 *    an LCS ratio over normalised, lightly stemmed tokens. Reported, not trusted:
 *    paraphrase scores low and a wrong number scores high.
 *  - STRUCTURAL checks, which are what catch real bugs: every number, key noun
 *    and Energy type of the printed text appears in the rendering; "up to",
 *    "may", "reveal" and "any number of" agree both ways; whose zone ("your
 *    opponent's Bench" vs "your Bench") agrees; and the timing words ("your next
 *    turn", "your opponent's next turn") survive.
 *
 * Pure: no I/O. Used by src/__tests__/roundtrip.test.ts and scripts/roundtrip.ts.
 */
import { CUSTOM_CONDS, CUSTOMS } from '../customs.js';
import type {
  AbilityScript,
  AttackScript,
  CardScript,
  CardZone,
  DamageIgnore,
  Cond,
  Dest,
  Duration,
  Expr,
  Filter,
  Program,
  PType,
  Scope,
  SlotRef,
  SlotZone,
  StaticDef,
  StaticEffect,
  Step,
  TriggerScript,
  Who,
} from '../dsl.js';
import type { CardFrame } from '../types.js';
import { normText, parseDamage } from './frame.js';

// ------------------------------------------------------------------ words

export const TYPE_SYMBOL: Record<PType, string> = {
  Grass: 'G',
  Fire: 'R',
  Water: 'W',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'F',
  Darkness: 'D',
  Metal: 'M',
  Dragon: 'N',
  Colorless: 'C',
  Fairy: 'Y',
};
const sym = (t: PType): string => `{${TYPE_SYMBOL[t]}}`;
const colorless = (n: number): string => '{C}'.repeat(Math.max(1, Math.abs(n)));

/**
 * What a `custom` function does, written from its code in customs.ts (NOT from
 * any card's text). A custom without a gloss renders as a bare `[custom: name]`
 * and its section is "opaque": structural problems are reported, not asserted.
 */
export const CUSTOM_GLOSS: Record<string, (args: Record<string, unknown>) => string> = {
  oncePerTurnByName: (a) => `You can't use more than 1 Ability that has "${String(a.name)}" in its name each turn`,
  returnSelfToHand: () => 'Put this Pokémon and all attached cards into your hand',
  runAwayDraw: (a) =>
    `Draw ${Number(a.n ?? 3)} cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck`,
  shuffleHandToBottom: (a) =>
    `${a.who === 'opp' ? 'Your opponent shuffles their' : 'Shuffle your'} hand and ${a.who === 'opp' ? 'puts' : 'put'} it on the bottom of ${a.who === 'opp' ? 'their' : 'your'} deck (the count lands in "moved")`,
  shuffleThenPutOnTop: () => 'Shuffle your deck, then put those cards on top of it in any order',
  // fighting-customs.ts
  devolveDefender: () =>
    "If your opponent's Active Pokémon is an evolved Pokémon, put the highest Stage Evolution card on it into your opponent's hand",
  sumCounters: (a) =>
    `Count the damage counters on ${slotZoneNoun(String(a.zone) as SlotZone, a.filter as Filter | undefined)} (into "${String(a.as ?? 'n')}")`,
  lookAtTopTake: (a) => {
    const max = Number(a.max ?? 1);
    const nn = noun(a.filter as Filter | undefined);
    return `Look at the top ${Number(a.n ?? 7)} cards of your deck. You may reveal ${max === 1 ? art(nn.sg) : `up to ${max} ${nn.pl}`} you find there and put ${max === 1 ? 'it' : 'them'} into your hand. Shuffle the other cards back into your deck`;
  },
  // ghost-customs.ts
  moveCounters: (a) => `Move up to ${Number(a.max ?? 3)} damage counters from the Pokémon chosen as "${String(a.from)}" to the Pokémon chosen as "${String(a.to)}"`,
  lookTopPick: (a) => `Look at the top ${Number(a.n ?? 2)} cards of your deck. Put 1 of them into your hand and the rest on the bottom of your deck`,
  chooseEnergyOfOtherType: (a) => `Choose up to 1 more Basic Energy card from your deck of a different type from the cards in "${String(a.first)}"`,
  pickFromVar: (a) => `Choose ${Number(a.n ?? 1)} of the cards in "${String(a.from)}" (the others are "${String(a.rest)}")`,
  moveOppActiveEnergy: (a) => `Move an Energy from your opponent's Active Pokémon to the Pokémon chosen as "${String(a.to)}"`,
  rareCandy: () =>
    "Choose 1 of your Basic Pokémon in play that wasn't put into play this turn and that a Stage 2 card in your hand evolves from (through its Stage 1), and put that card onto it to evolve it, skipping the Stage 1",
  discardSelfFromPlay: () => 'Discard this card from play',
  // metal-customs.ts
  'metal.energyToDeck': () => 'Put all Energy attached to this Pokémon into your deck',
  'metal.moveEnergy': (a) => `Move ${art(energyNoun(a.filter as Filter | undefined))} from the Pokémon chosen as "${String(a.from)}" to another of your Pokémon`,
  'metal.attachFromDeckToEach': (a) => `For each of the Pokémon chosen as "${String(a.slots)}", search your deck for ${art(noun(a.filter as Filter | undefined).sg)} and attach it to that Pokémon`,
  'metal.discardTools': (a) => `Choose up to ${Number(a.max ?? 2)} Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them`,
  // misc-customs.ts
  freezingShroud: () => "Put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass",
  countersUntilHp: (a) => `Count the damage counters that would leave your opponent's Active Pokémon with ${Number(a.hp ?? 50)} HP remaining (into "${String(a.as ?? 'n')}")`,
  discardThisCard: () => 'Discard this card',
  'trevenant.discardToolFrom': () => "Discard the Pokémon Tool attached to that Pokémon (if any) to its owner's discard pile", // lane:trevenant
};

/** What a custom CONDITION (`{ custom: name }` in a Cond) checks, written from its code. */
export const CUSTOM_COND_GLOSS: Record<string, (args: Record<string, unknown>) => string> = {
  countersMovable: () => 'damage counters can be moved (no effect on either side stops it)',
  'trevenant.hopsKoByAttackLastTurn': () => "one of your Pokémon with \"Hop's\" in its name was Knocked Out by damage from an attack during your opponent's last turn", // lane:trevenant
  rareCandyPlayable: () => "it isn't your first turn and you have a Basic Pokémon in play, not put into play this turn, that a Stage 2 card in your hand evolves from",
};

/** An attached-Energy filter as a noun: "Special Energy", "Basic {M} Energy". */
function energyNoun(f: Filter | undefined): string {
  if (!f) return 'Energy';
  if (f.basicEnergy === false) return 'Special Energy';
  if (f.energyType) return `Basic ${sym(f.energyType)} Energy`;
  if (f.basicEnergy) return 'Basic Energy';
  if (f.name) return (Array.isArray(f.name) ? f.name : [f.name]).map((x) => `"${x}"`).join(' or ');
  return noun(f).sg;
}

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const lc = (s: string): string => (s && !/^\[/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const art = (s: string): string => `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}`;
const end = (s: string): string => (/(\.|\.\)|\])$/.test(s) ? s : `${s}.`);
const GLUE = '\u0000';

/** Join sentences; a sentence starting with GLUE continues the previous one ("… and have this attack do 150 more damage."). */
function join(ss: string[]): string {
  const out: string[] = [];
  for (const s of ss) {
    if (!s) continue;
    if (s.startsWith(GLUE)) {
      const body = s.slice(1);
      if (out.length) out[out.length - 1] = `${out[out.length - 1]!.replace(/\.$/, '')} ${body}.`;
      else out.push(end(cap(body.replace(/^and /, ''))));
    } else out.push(end(s));
  }
  return out.join(' ');
}

interface Noun {
  sg: string;
  pl: string;
}

const STAGE: Record<NonNullable<Filter['stage']>, string> = { basic: 'Basic', stage1: 'Stage 1', stage2: 'Stage 2', evolution: 'Evolution' };
const TTYPE: Record<NonNullable<Filter['ttype']>, Noun> = {
  item: { sg: 'Item card', pl: 'Item cards' },
  supporter: { sg: 'Supporter card', pl: 'Supporter cards' },
  stadium: { sg: 'Stadium card', pl: 'Stadium cards' },
  tool: { sg: 'Pokémon Tool card', pl: 'Pokémon Tool cards' },
};

/** A Filter as a noun phrase. `inPlay`: the filter is over Pokémon in play (head noun defaults to "Pokémon"). */
export function noun(f: Filter = {}, inPlay = false): Noun {
  if (f.any?.length) {
    const ps = f.any.map((x) => noun(x, inPlay));
    return { sg: ps.map((p, i) => (i ? art(p.sg) : p.sg)).join(' or '), pl: ps.map((p) => p.pl).join(' or ') };
  }
  const pre: string[] = [];
  const types = f.type ? (Array.isArray(f.type) ? f.type : [f.type]).map(sym).join(' or ') : '';
  let head: Noun;
  const pokemonish =
    f.cat === 'pokemon' ||
    !!f.stage ||
    f.ruleBox !== undefined ||
    !!f.ex ||
    !!f.mega ||
    !!f.tera ||
    f.hpMax !== undefined ||
    !!f.hasAbility ||
    !!f.damaged ||
    f.energy !== undefined ||
    f.tool !== undefined ||
    !!f.condition ||
    f.energized !== undefined ||
    (!!f.type && f.cat !== 'energy');
  if (f.cat === 'trainer' || f.ttype) {
    head = f.ttype ? TTYPE[f.ttype] : { sg: 'Trainer card', pl: 'Trainer cards' };
  } else if (f.cat === 'energy' || f.basicEnergy !== undefined || f.energyType) {
    const b = f.basicEnergy === false ? 'Special ' : f.basicEnergy || f.energyType ? 'Basic ' : '';
    const t = f.energyType ? `${sym(f.energyType)} ` : types ? `${types} ` : '';
    head = { sg: `${b}${t}Energy card`, pl: `${b}${t}Energy cards` };
  } else if (pokemonish || inPlay) {
    if (f.stage) pre.push(STAGE[f.stage]);
    if (types) pre.push(types);
    const h = f.mega ? 'Mega Evolution Pokémon ex' : f.ex ? 'Pokémon ex' : f.tera ? 'Tera Pokémon' : 'Pokémon';
    head = { sg: h, pl: h };
  } else {
    head = { sg: 'card', pl: 'cards' };
  }
  const post: [string, string][] = [];
  if (f.hpMax !== undefined) post.push([`with ${f.hpMax} HP or less`, `with ${f.hpMax} HP or less`]);
  if (f.ruleBox === false) post.push(["that doesn't have a Rule Box", "that don't have a Rule Box"]);
  if (f.ruleBox === true) post.push(['that has a Rule Box', 'that have a Rule Box']);
  if (f.hasAbility) post.push([`that has the ${f.hasAbility} Ability`, `that have the ${f.hasAbility} Ability`]);
  if (f.nameIncludes) post.push([`that has "${f.nameIncludes}" in its name`, `that have "${f.nameIncludes}" in their names`]);
  if (f.name) {
    const ns = (Array.isArray(f.name) ? f.name : [f.name]).map((x) => `"${x}"`).join(' or ');
    post.push([`named ${ns}`, `named ${ns}`]);
  }
  if (f.damaged) post.push(['that has damage counters on it', 'that have damage counters on them']);
  if (f.energy) post.push([`that has ${energyNoun(f.energy)} attached`, `that have ${energyNoun(f.energy)} attached`]);
  if (f.energized === true) post.push(['that has any Energy attached', 'that have any Energy attached']);
  if (f.energized === false) post.push(['that has no Energy attached', 'that have no Energy attached']);
  if (f.tool === true) post.push(['that has a Pokémon Tool attached', 'that have a Pokémon Tool attached']);
  if (f.tool === false) post.push(['that has no Pokémon Tool attached', 'that have no Pokémon Tool attached']);
  if (f.condition) post.push([`that is ${CONDITION[f.condition]}`, `that are ${CONDITION[f.condition]}`]);
  if (f.not) {
    const x = noun(f.not, inPlay);
    post.push([`that isn't ${art(x.sg)}`, `that aren't ${x.pl}`]);
  }
  const build = (h: string, i: 0 | 1): string => [...pre, h, ...post.map((p) => p[i])].join(' ');
  return { sg: build(head.sg, 0), pl: build(head.pl, 1) };
}

/** A plain number when the expression is one (a `min` of a number and an expression counts as that number: "up to 2" clamped by Bench space). */
function numOf(e: Expr): number | null {
  if (typeof e === 'number') return e;
  if (typeof e === 'object' && 'min' in e) {
    const ns = e.min.map(numOf).filter((x): x is number => x !== null);
    return ns.length ? Math.min(...ns) : null;
  }
  return null;
}

function counted(min: Expr, max: Expr, nn: Noun): { text: string; plural: boolean } {
  const lo = numOf(min);
  const hi = numOf(max);
  if (hi === null) return { text: lo ? `${lo} or more ${nn.pl}` : `any number of ${nn.pl}`, plural: true };
  if (hi === 1) return { text: art(nn.sg), plural: false };
  if (lo === hi) return { text: `${hi} ${nn.pl}`, plural: true };
  if (!lo) return { text: `up to ${hi} ${nn.pl}`, plural: true };
  return { text: `${lo} to ${hi} ${nn.pl}`, plural: true };
}

function owner(who: Who | undefined, pronoun = false): string {
  return who === 'opp' ? (pronoun ? 'their' : "your opponent's") : 'your';
}

function zoneOf(z: CardZone, who?: Who, pronoun = false): string {
  const y = owner(who, pronoun);
  switch (z) {
    case 'hand':
      return `${y} hand`;
    case 'deck':
      return `${y} deck`;
    case 'discard':
      return `${y} discard pile`;
    case 'prizes':
      return `${y} Prize cards`;
    case 'lost':
      return 'the Lost Zone';
  }
}

function destOf(d: Dest, who?: Who): string {
  const y = owner(who);
  switch (d) {
    case 'hand':
      return `into ${y} hand`;
    case 'discard':
      return `in ${y} discard pile`;
    case 'deckTop':
      return `on top of ${y} deck`;
    case 'deckBottom':
      return `on the bottom of ${y} deck`;
    case 'deck':
      return `into ${y} deck`;
    case 'bench':
      return `onto ${y} Bench`;
    case 'lost':
      return 'in the Lost Zone';
  }
}

const DONE: Record<Dest, string> = {
  hand: 'put into your hand',
  discard: 'discarded',
  deckTop: 'put on top of your deck',
  deckBottom: 'put on the bottom of your deck',
  deck: 'shuffled into your deck',
  bench: 'put onto your Bench',
  lost: 'put in the Lost Zone',
};

/** Pokémon in a slot zone, plural, with the owner: "your Benched {P} Pokémon". */
function slotZoneNoun(z: SlotZone, f?: Filter, withOwner = true): string {
  const nn = noun(f ?? {}, true).pl;
  const me = withOwner ? 'your ' : '';
  const op = withOwner ? "your opponent's " : '';
  switch (z) {
    case 'myActive':
      return `${me}Active ${nn}`;
    case 'myBench':
      return `${me}Benched ${nn}`;
    case 'myPokemon':
      return `${me}${nn}`;
    case 'oppActive':
      return `${op}Active ${nn}`;
    case 'oppBench':
      return `${op}Benched ${nn}`;
    case 'oppPokemon':
      return `${op}${nn}`;
    case 'allPokemon':
      return `${nn} in play (both yours and your opponent's)`;
  }
}

const CONDITION: Record<string, string> = { asleep: 'Asleep', confused: 'Confused', paralyzed: 'Paralyzed', poisoned: 'Poisoned', burned: 'Burned' };
const DURATION: Record<Duration, string> = {
  thisTurn: 'During this turn,',
  oppNextTurn: "During your opponent's next turn,",
  myNextTurn: 'During your next turn,',
};

// ------------------------------------------------------------------ the renderer

type VarInfo =
  | { k: 'cards'; text: string; plural: boolean; zone: CardZone | 'top'; who?: Who; reveal: boolean; mentioned: boolean; done?: string }
  | { k: 'slots'; text: string; plural: boolean; mentioned: boolean }
  | { k: 'heads'; n: Expr | 'untilTails' }
  | { k: 'option'; options: string[] }
  | { k: 'num'; bonus: boolean };

type Source = 'pokemon' | 'tool' | 'energy' | 'trainer';

class Renderer {
  vars = new Map<string, VarInfo>();
  /** Variables used only as an addend of the attack's damage ("have this attack do 150 more damage"). */
  bonus = new Set<string>();
  selfName: string;

  constructor(
    readonly src: Source,
    readonly problems: string[],
  ) {
    this.selfName = src === 'tool' || src === 'energy' ? 'the Pokémon this card is attached to' : 'this Pokémon';
  }

  // ---------------------------------------------------------------- expressions

  num(e: Expr): string {
    if (typeof e === 'number') return String(e);
    if ('v' in e || 'len' in e) {
      const name = 'v' in e ? e.v : e.len;
      const v = this.vars.get(name);
      if (v?.k === 'heads') return 'the number of heads';
      if (v?.k === 'cards') return `the number of cards you ${v.done ?? 'chose'} in this way`;
      if (v?.k === 'slots') return 'the number of Pokémon you chose';
      return name;
    }
    if ('count' in e) return `the number of ${noun(e.count.filter).pl} in ${zoneOf(e.count.zone, e.count.who)}`;
    if ('pokemon' in e) return `the number of ${slotZoneNoun(e.pokemon.zone, e.pokemon.filter)}`;
    if ('prizesLeft' in e) return `the number of Prize cards ${e.prizesLeft === 'opp' ? 'your opponent has' : 'you have'} remaining`;
    if ('prizesTaken' in e) return `the number of Prize cards ${e.prizesTaken === 'opp' ? 'your opponent has' : 'you have'} taken`;
    if ('energyOn' in e) return `the amount of ${e.type ? `${sym(e.type)} ` : ''}Energy attached to ${this.ref(e.energyOn)}`;
    if ('countersOn' in e) return `the number of damage counters on ${this.ref(e.countersOn)}`;
    if ('handSize' in e) return `the number of cards in ${owner(e.handSize)} hand`;
    if ('deckSize' in e) return `the number of cards in ${owner(e.deckSize)} deck`;
    if ('add' in e) return e.add.map((x) => this.num(x)).join(' plus ');
    if ('sub' in e) return `${this.num(e.sub[0])} minus ${this.num(e.sub[1])}`;
    if ('mul' in e) return `${this.num(e.mul[0])} times ${this.num(e.mul[1])}`;
    if ('min' in e) return `the lower of ${e.min.map((x) => this.num(x)).join(' and ')}`;
    if ('max' in e) return `the higher of ${e.max.map((x) => this.num(x)).join(' and ')}`;
    if ('cond' in e) return `${this.num(e.then)} if ${this.cond(e.cond)}, otherwise ${this.num(e.else)}`;
    return '(?)';
  }

  /** The unit of a "for each" ("for each heads", "for each Energy attached to …"). */
  each(e: Expr): string {
    if (typeof e === 'number') return `of ${e}`;
    if ('v' in e || 'len' in e) {
      const name = 'v' in e ? e.v : e.len;
      const v = this.vars.get(name);
      if (v?.k === 'heads') return 'heads';
      if (v?.k === 'cards') return `card you ${v.done ?? 'chose'} in this way`;
      if (v?.k === 'slots') return 'Pokémon you chose';
      return `unit of ${name}`;
    }
    if ('pokemon' in e) return `of ${slotZoneNoun(e.pokemon.zone, e.pokemon.filter)}`;
    if ('energyOn' in e) return `${e.type ? `${sym(e.type)} ` : ''}Energy attached to ${this.ref(e.energyOn)}`;
    if ('countersOn' in e) return `damage counter on ${this.ref(e.countersOn)}`;
    if ('count' in e) return `${noun(e.count.filter).sg} in ${zoneOf(e.count.zone, e.count.who)}`;
    if ('prizesTaken' in e) return `Prize card ${e.prizesTaken === 'opp' ? 'your opponent has' : 'you have'} taken`;
    if ('prizesLeft' in e) return `Prize card ${e.prizesLeft === 'opp' ? 'your opponent has' : 'you have'} remaining`;
    if ('handSize' in e) return `card in ${owner(e.handSize)} hand`;
    if ('deckSize' in e) return `card in ${owner(e.deckSize)} deck`;
    if ('add' in e) {
      // "for each Benched Pokémon (both yours and your opponent's)"
      const [a, b] = e.add;
      if (e.add.length === 2 && a && b && typeof a === 'object' && typeof b === 'object' && 'pokemon' in a && 'pokemon' in b) {
        const pair = [a.pokemon.zone, b.pokemon.zone].sort().join('+');
        const same = JSON.stringify(a.pokemon.filter ?? {}) === JSON.stringify(b.pokemon.filter ?? {});
        const where = { 'myBench+oppBench': 'Benched', 'myActive+oppActive': 'Active', 'myPokemon+oppPokemon': '' }[pair];
        if (same && where !== undefined) {
          return `${where ? `${where} ` : ''}${noun(a.pokemon.filter ?? {}, true).sg} (both yours and your opponent's)`;
        }
      }
      return e.add.map((x) => this.each(x)).join(' and each ');
    }
    return `unit of ${this.num(e)}`;
  }

  cmp(op: 'gte' | 'gt' | 'lte' | 'lt' | 'eq', n: string): string {
    return { gte: `${n} or more`, gt: `more than ${n}`, lte: `${n} or fewer`, lt: `fewer than ${n}`, eq: `exactly ${n}` }[op];
  }

  cond(c: Cond): string {
    for (const op of ['gte', 'gt', 'lte', 'lt', 'eq'] as const) {
      if (op in c) {
        const [a, b] = (c as Record<typeof op, [Expr, Expr]>)[op];
        return this.compare(op, a, b);
      }
    }
    if ('and' in c) return c.and.map((x) => this.cond(x)).join(' and ');
    if ('or' in c) return c.or.map((x) => this.cond(x)).join(' or ');
    if ('not' in c) {
      const x = c.not;
      if ('benchFull' in x) return `${x.benchFull === 'opp' ? "your opponent's" : 'your'} Bench isn't full`;
      if ('stadium' in x) return x.stadium === true ? 'there is no Stadium in play' : `${art(noun(x.stadium).sg)} isn't in play`;
      if ('firstTurn' in x) return "it isn't your first turn";
      return `it is not the case that ${this.cond(x)}`;
    }
    if ('cardIs' in c) {
      const v = this.vars.get(c.cardIs.v);
      const pl = v?.k === 'cards' && v.plural;
      return pl ? `each of those cards is ${art(noun(c.cardIs.filter).sg)}` : `that card is ${art(noun(c.cardIs.filter).sg)}`;
    }
    if ('slotIs' in c) return `${this.ref(c.slotIs.ref)} is ${art(noun(c.slotIs.filter, true).sg)}`;
    if ('inActive' in c) return `${this.ref(c.inActive)} is in the Active Spot`;
    if ('onBench' in c) return `${this.ref(c.onBench)} is on ${c.onBench === 'self' || c.onBench === 'myActive' ? 'your' : 'the'} Bench`;
    if ('koLastTurn' in c) {
      return c.koLastTurn === 'opp'
        ? "any of your opponent's Pokémon were Knocked Out during your last turn"
        : "any of your Pokémon were Knocked Out during your opponent's last turn";
    }
    if ('stadium' in c) return c.stadium === true ? 'a Stadium is in play' : `${art(noun(c.stadium).sg)} is in play`;
    if ('benchFull' in c) return `${c.benchFull === 'opp' ? "your opponent's" : 'your'} Bench is full`;
    if ('firstTurn' in c) return 'it is your first turn';
    if ('custom' in c) {
      if (!CUSTOM_CONDS[c.custom]) this.problems.push(`custom condition "${c.custom}" is not registered (registerCustomCond)`);
      const g = CUSTOM_COND_GLOSS[c.custom];
      return `[custom: ${c.custom}${g ? ` — ${g(c.args ?? {})}` : ''}]`;
    }
    return '(?)';
  }

  private compare(op: 'gte' | 'gt' | 'lte' | 'lt' | 'eq', a: Expr, b: Expr): string {
    const n = this.num(b);
    const q = this.cmp(op, n);
    const any = op === 'gte' && b === 1;
    if (typeof a === 'object') {
      const subj = (w: Who | undefined): string => (w === 'opp' ? 'your opponent has' : 'you have');
      if ('count' in a) {
        const w = a.count.who;
        return `${subj(w)} ${any ? 'any' : q} ${noun(a.count.filter).pl} in ${zoneOf(a.count.zone, w, w === 'opp')}`;
      }
      if ('pokemon' in a) {
        const z = a.pokemon.zone;
        const w: Who = z.startsWith('opp') ? 'opp' : 'self';
        const qq = any ? 'any' : op === 'eq' && b === 0 ? 'no' : q;
        if (z === 'myBench' || z === 'oppBench') return `${subj(w)} ${qq} ${noun(a.pokemon.filter ?? {}, true).pl} on ${w === 'opp' ? 'their' : 'your'} Bench`;
        const where = z === 'myPokemon' || z === 'oppPokemon' ? ' in play' : '';
        return `${subj(w)} ${qq} ${slotZoneNoun(z, a.pokemon.filter, false)}${where}`;
      }
      if ('handSize' in a) return `${subj(a.handSize)} ${any ? 'any' : op === 'eq' && b === 0 ? 'no' : q} cards in ${owner(a.handSize, true)} hand`;
      if ('deckSize' in a) return `${subj(a.deckSize)} ${q} cards in ${owner(a.deckSize, true)} deck`;
      if ('prizesLeft' in a) return `${subj(a.prizesLeft)} ${q} Prize cards remaining`;
      if ('prizesTaken' in a) return `${subj(a.prizesTaken)} taken ${q} Prize cards`;
      if ('energyOn' in a) return `${this.ref(a.energyOn)} has ${q} ${a.type ? `${sym(a.type)} ` : ''}Energy attached`;
      if ('countersOn' in a) return `${this.ref(a.countersOn)} has ${q} damage counters on it`;
      if ('v' in a || 'len' in a) {
        const v = this.vars.get('v' in a ? a.v : a.len);
        if (v?.k === 'heads') {
          if (v.n === 1 && ((op === 'gte' && b === 1) || (op === 'eq' && b === 1) || (op === 'gt' && b === 0))) return 'heads';
          if (v.n === 1 && ((op === 'eq' && b === 0) || (op === 'lt' && b === 1))) return 'tails';
          return `you get ${q} heads`;
        }
        if (v?.k === 'cards') return `you ${v.done ?? 'chose'} ${q} cards in this way`;
        if (v?.k === 'option' && op === 'eq' && typeof b === 'number') return `you chose "${v.options[b] ?? b}"`;
      }
    }
    return `${this.num(a)} is ${q}`;
  }

  /** A Pokémon reference; a deferred chooseSlots variable is described in full on first use. */
  ref(r: SlotRef): string {
    if (r === 'self') return this.selfName;
    if (r === 'defender') return "your opponent's Active Pokémon"; // (as it was when the attack was declared)
    if (r === 'myActive') return 'your Active Pokémon';
    if (r === 'oppActive') return "your opponent's Active Pokémon";
    const v = this.vars.get(r.v);
    if (v?.k === 'slots') {
      if (!v.mentioned) {
        v.mentioned = true;
        return v.text;
      }
      return v.plural ? 'those Pokémon' : 'that Pokémon';
    }
    if (r.v === '__target') return 'that Pokémon'; // the Pokémon a trigger fired for (oppAttachFromHand)
    return `the Pokémon in "${r.v}"`;
  }

  target(t: AttackScript['target']): string {
    if (!t) return '';
    if (typeof t === 'object' && 'each' in t) return `each of ${slotZoneNoun(t.each, t.filter)}`;
    return this.ref(t as SlotRef);
  }

  // ---------------------------------------------------------------- damage

  /** The damage sentence(s) of an attack, relative to the printed number. */
  damage(amount: Expr, base: number, to?: AttackScript['target']): string[] {
    const t = to ? ` to ${this.target(to)}` : '';
    if (typeof amount === 'number') return amount === base && !t ? [] : [`This attack does ${amount} damage${t}`];
    if ('add' in amount) {
      const [first, ...rest] = amount.add;
      const out: string[] = [];
      if (typeof first === 'number') {
        if (first !== base || t) out.push(`This attack does ${first} damage${t}`);
        for (const x of rest) out.push(...this.more(x));
      } else for (const x of amount.add) out.push(...this.more(x));
      return out;
    }
    if ('sub' in amount && typeof amount.sub[0] === 'number') {
      const [n, x] = amount.sub;
      const out = n !== base || t ? [`This attack does ${n} damage${t}`] : [];
      if (typeof x === 'object' && 'mul' in x && typeof x.mul[0] === 'number') out.push(`This attack does ${x.mul[0]} less damage for each ${this.each(x.mul[1])}`);
      else out.push(`This attack does ${this.num(x)} less damage`);
      return out;
    }
    if ('mul' in amount && typeof amount.mul[0] === 'number') return [`This attack does ${amount.mul[0]} damage${t} for each ${this.each(amount.mul[1])}`];
    if ('cond' in amount) {
      const c = this.cond(amount.cond);
      const th = amount.then;
      const el = amount.else;
      if (th === 0) return [...(el === base ? [] : [`This attack does ${this.num(el)} damage${t}`]), `If ${c}, this attack does nothing`];
      if (el === base) return [`If ${c}, this attack does ${this.num(th)} damage${t} instead`];
      return [`This attack does ${this.num(el)} damage${t}`, `If ${c}, it does ${this.num(th)} damage instead`];
    }
    if ('v' in amount && this.bonus.has(amount.v)) return [];
    return [`This attack does ${this.num(amount)} damage${t}`];
  }

  private more(x: Expr): string[] {
    if (typeof x === 'number') return [`This attack does ${x} more damage`];
    if ('v' in x && this.bonus.has(x.v)) return [];
    if ('cond' in x && x.else === 0) return [`If ${this.cond(x.cond)}, this attack does ${this.num(x.then)} more damage`];
    if ('mul' in x && typeof x.mul[0] === 'number') return [`This attack does ${x.mul[0]} more damage for each ${this.each(x.mul[1])}`];
    if ('mul' in x && typeof x.mul[1] === 'number') return [`This attack does ${x.mul[1]} more damage for each ${this.each(x.mul[0])}`];
    return [`This attack does ${this.num(x)} more damage`];
  }

  // ---------------------------------------------------------------- steps

  program(p: Program, base = 0): string {
    return join(this.steps(p, base));
  }

  /** Is the variable chosen at `i` used as the operand of a later step, with only other choices between? */
  private deferred(p: Program, i: number, v: string, kind: 'cards' | 'slots'): boolean {
    for (let j = i + 1; j < p.length; j++) {
      const s = p[j]!;
      if (kind === 'cards') {
        if ((s.op === 'move' || s.op === 'attach' || s.op === 'putOnTop') && s.cards === v) return true;
      } else {
        const isV = (r: unknown): boolean => typeof r === 'object' && r !== null && (r as { v?: string }).v === v;
        if ((s.op === 'damage' || s.op === 'counters' || s.op === 'attach' || s.op === 'heal' || s.op === 'condition') && isV(s.to)) return true;
        if (s.op === 'effect' && isV(s.on)) return true;
        if (s.op === 'knockOut' && isV(s.target)) return true;
        if (s.op === 'switch' && isV(s.with)) return true;
      }
      if (s.op !== 'chooseCards' && s.op !== 'chooseSlots') return false;
    }
    return false;
  }

  steps(p: Program, base = 0): string[] {
    const out: string[] = [];
    let touchedDeck = false;
    for (let i = 0; i < p.length; i++) {
      const st = p[i]!;
      const next = p[i + 1];
      switch (st.op) {
        case 'chooseCards': {
          const nn = st.oneEach
            ? {
                text: st.oneEach
                  .map((f, k, all) => `${k && k === all.length - 1 ? 'and ' : ''}${art(noun(f).sg)}`)
                  .join(st.oneEach.length > 2 ? ', ' : ' '),
                plural: true,
              }
            : counted(st.min, st.max, st.others ? { sg: `other ${noun(st.filter).sg}`, pl: `other ${noun(st.filter).pl}` } : noun(st.filter));
          const info: VarInfo = { k: 'cards', text: nn.text, plural: nn.plural, zone: st.from, who: st.who, reveal: !!st.reveal, mentioned: false };
          this.vars.set(st.as, info);
          if (st.chooser === 'opp' || !this.deferred(p, i, st.as, 'cards')) {
            info.mentioned = true;
            const zone = zoneOf(st.from, st.who);
            const reveal = st.reveal ? `, and reveal ${nn.plural ? 'them' : 'it'}` : '';
            if (st.chooser === 'opp') out.push(`Your opponent chooses ${nn.text} from ${zone}${reveal}`);
            else if (st.from === 'deck') out.push(`Search ${zone} for ${nn.text}${reveal}`);
            else out.push(`Choose ${nn.text} from ${zone}${reveal}`);
          }
          if (st.from === 'deck') touchedDeck = true;
          break;
        }
        case 'chooseSlots': {
          const lo = numOf(st.min);
          const hi = numOf(st.max);
          const zone = slotZoneNoun(st.from, st.filter);
          const q = hi === null ? `any number of ${zone}` : lo === hi || hi === 1 ? `${hi} of ${zone}` : `up to ${hi} of ${zone}`;
          const info: VarInfo = { k: 'slots', text: q, plural: hi !== 1, mentioned: false };
          this.vars.set(st.as, info);
          if (st.chooser === 'opp' || !this.deferred(p, i, st.as, 'slots')) {
            info.mentioned = true;
            out.push(`${st.chooser === 'opp' ? 'Your opponent chooses' : 'Choose'} ${q}`);
          }
          break;
        }
        case 'chooseOption':
          this.vars.set(st.as, { k: 'option', options: st.options });
          out.push(`${st.chooser === 'opp' ? 'Your opponent chooses' : 'Choose'} 1: ${st.options.map((o) => `"${o}"`).join(' or ')}`);
          break;
        case 'move': {
          const r = this.move(st, next);
          out.push(r.text);
          if (r.ateShuffle) i++;
          if (st.to === 'deck' || st.to === 'deckTop' || st.to === 'deckBottom' || (typeof st.cards === 'string' && this.vars.get(st.cards)?.k === 'cards' && (this.vars.get(st.cards) as { zone: string }).zone === 'deck')) touchedDeck = true;
          break;
        }
        case 'putOnTop': {
          const v = this.vars.get(st.cards);
          if (v?.k === 'cards' && !v.mentioned) {
            v.mentioned = true;
            out.push(`Put ${v.text} from ${v.zone === 'top' ? 'the top of your deck' : zoneOf(v.zone, v.who)} on top of your deck in any order`);
          } else out.push(`Put ${v?.k === 'cards' && !v.plural ? 'that card' : 'those cards'} on top of your deck in any order`);
          break;
        }
        case 'draw':
          out.push(this.draw(st.n, st.who));
          break;
        case 'shuffle':
          out.push(
            st.who === 'opp'
              ? 'Your opponent shuffles their deck'
              : touchedDeck && out.length
                ? 'Then, shuffle your deck'
                : 'Shuffle your deck',
          );
          break;
        case 'attach': {
          const v = this.vars.get(st.cards);
          let what: string;
          if (v?.k === 'cards' && !v.mentioned) {
            v.mentioned = true;
            if (v.zone === 'deck') {
              const to = this.ref(st.to);
              out.push(`Search ${zoneOf('deck', v.who)} for ${v.text} and attach ${v.plural ? 'them' : 'it'} to ${to}`);
              touchedDeck = true;
              break;
            }
            what = `${v.text} from ${v.zone === 'top' ? 'the top of your deck' : zoneOf(v.zone, v.who)}`;
          } else what = v?.k === 'cards' && !v.plural ? 'that card' : 'those cards';
          out.push(`Attach ${what} to ${this.ref(st.to)}`);
          break;
        }
        case 'discardEnergy': {
          const what = energyNoun(st.filter);
          const from = this.ref(st.from);
          if (st.count === 'all') out.push(`Discard all ${what} from ${from}`);
          else if (st.count === 1) out.push(`Discard ${art(what)} from ${from}`);
          else out.push(`Discard ${this.num(st.count)} ${what} from ${from}`);
          if (st.as) this.vars.set(st.as, { k: 'cards', text: 'the discarded Energy', plural: true, zone: 'discard', reveal: false, mentioned: true, done: 'discarded' });
          break;
        }
        case 'damage':
          out.push(...this.damage(st.amount, base, st.to), ...ignoreSentence(st.ignore));
          break;
        case 'counters': {
          const where = typeof st.to === 'object' && 'each' in st.to ? `each of ${slotZoneNoun(st.to.each, st.to.filter)}` : this.ref(st.to as SlotRef);
          const k = st.n;
          if (typeof k === 'object' && 'mul' in k && typeof k.mul[0] === 'number') {
            out.push(`Place ${k.mul[0]} damage counter${k.mul[0] === 1 ? '' : 's'} on ${where} for each ${this.each(k.mul[1])}`);
          } else out.push(`Place ${this.num(k)} damage counter${k === 1 ? '' : 's'} on ${where}`);
          break;
        }
        case 'heal':
          out.push(`Heal ${this.num(st.amount)} damage from ${this.ref(st.to)}`);
          break;
        case 'condition':
          out.push(`${cap(this.ref(st.to))} is now ${CONDITION[st.cond]}`);
          break;
        case 'switch':
          out.push(this.switch(st));
          break;
        case 'flip':
          this.vars.set(st.as, { k: 'heads', n: st.n });
          out.push(st.n === 'untilTails' ? 'Flip a coin until you get tails' : st.n === 1 ? 'Flip a coin' : `Flip ${this.num(st.n)} coins`);
          break;
        case 'set': {
          const prev = this.vars.get(st.v);
          if (this.bonus.has(st.v)) {
            if (!prev) this.vars.set(st.v, { k: 'num', bonus: true });
            if (st.value !== 0) out.push(`${GLUE}and have this attack do ${this.num(st.value)} more damage`);
          } else {
            this.vars.set(st.v, { k: 'num', bonus: false });
            out.push(`Let ${st.v} be ${this.num(st.value)}`);
          }
          break;
        }
        case 'if': {
          const c = this.cond(st.cond);
          let s = `If ${c}, ${lc(this.program(st.then, base))}`;
          if (st.else?.length) s = `${end(s)} Otherwise, ${lc(this.program(st.else, base))}`;
          out.push(s);
          break;
        }
        case 'repeat':
          out.push(`Do this ${this.num(st.n)} times: ${lc(this.program(st.body, base))}`);
          break;
        case 'may':
          out.push(`You may ${lc(this.program(st.body, base))}`);
          break;
        case 'effect': {
          if (st.scope && !st.on) {
            // Player-level effect over that player's Pokémon, matched live ("all of your {M} Pokémon").
            const flip = (sc: Scope): Scope => (sc.startsWith('my') ? (sc.replace('my', 'opp') as Scope) : sc.startsWith('opp') ? (sc.replace('opp', 'my') as Scope) : sc);
            const { x, plural } = this.scope(st.onPlayer === 'opp' ? flip(st.scope) : st.scope, st.filter);
            out.push(`${DURATION[st.duration]} ${lc(this.clause(st.static, x, plural, false))}`);
            break;
          }
          const who = st.on ? this.ref(st.on) : st.onPlayer === 'opp' ? 'your opponent' : st.onPlayer === 'self' ? 'you' : this.selfName;
          const plural = st.on && typeof st.on === 'object' ? (this.vars.get(st.on.v) as { plural?: boolean } | undefined)?.plural ?? false : false;
          const x = st.filter ? `${who} (only ${noun(st.filter, true).pl})` : who;
          out.push(`${DURATION[st.duration]} ${lc(this.clause(st.static, x, plural, false))}`);
          break;
        }
        case 'knockOut': {
          if (next?.op === 'knockOut' && [st.target, next.target].sort().join('+') === 'myActive+oppActive') {
            out.push('Both Active Pokémon are Knocked Out');
            i++;
          } else out.push(`${cap(this.ref(st.target))} is Knocked Out`);
          break;
        }
        case 'useAttackOf':
          out.push('Choose 1 of its attacks and use it as this attack');
          break;
        case 'custom': {
          if (!CUSTOMS[st.fn]) this.problems.push(`custom "${st.fn}" is not a function in customs.ts`);
          const g = CUSTOM_GLOSS[st.fn];
          out.push(`[custom: ${st.fn}${g ? ` — ${g(st.args ?? {})}` : ''}]`);
          break;
        }
        case 'end':
          out.push('This effect ends here');
          break;
        default: {
          // A new clause in dsl.ts must get a rendering here: this line stops compiling until it does.
          const unrendered: never = st;
          out.push(`[unrendered: ${(unrendered as Step).op}]`);
        }
      }
    }
    return eachPlayer(out);
  }

  private draw(n: Expr, who?: Who): string {
    const subj = who === 'opp' ? 'Your opponent draws' : 'Draw';
    const cards = (e: Expr): string => (e === 1 ? 'a card' : `${this.num(e)} cards`);
    if (typeof n === 'object' && 'cond' in n) return `${subj} ${cards(n.else)}. If ${this.cond(n.cond)}, ${lc(subj)} ${cards(n.then)} instead`;
    if (typeof n === 'object' && 'mul' in n && typeof n.mul[0] === 'number') return `${subj} ${cards(n.mul[0])} for each ${this.each(n.mul[1])}`;
    return `${subj} ${cards(n)}`;
  }

  private switch(st: Extract<Step, { op: 'switch' }>): string {
    if (st.with) return `Switch ${this.ref(st.with)} with ${owner(st.who)} Active Pokémon`;
    if (st.who === 'opp') {
      return st.chooser === 'opp'
        ? "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
        : "Switch in 1 of your opponent's Benched Pokémon to the Active Spot";
    }
    return st.chooser === 'opp'
      ? 'Switch your Active Pokémon with 1 of your Benched Pokémon. (Your opponent chooses the new Active Pokémon.)'
      : 'Switch your Active Pokémon with 1 of your Benched Pokémon';
  }

  private move(st: Extract<Step, { op: 'move' }>, next: Step | undefined): { text: string; ateShuffle: boolean } {
    const dest = destOf(st.to, st.who);
    if (typeof st.cards === 'string') {
      const v = this.vars.get(st.cards);
      if (v?.k === 'cards') {
        const pron = v.plural ? 'them' : 'it';
        const first = !v.mentioned;
        v.mentioned = true;
        v.done = DONE[st.to];
        if (st.as) this.vars.set(st.as, { ...v, mentioned: true });
        if (first && v.zone === 'deck') {
          const reveal = v.reveal ? `, reveal ${pron}, and` : ' and';
          const act = st.to === 'discard' ? `discard ${pron}` : `put ${pron} ${dest}`;
          return { text: `Search ${zoneOf('deck', v.who)} for ${v.text}${reveal} ${act}`, ateShuffle: false };
        }
        const what = first ? `${v.text} from ${v.zone === 'top' ? 'the top of your deck' : zoneOf(v.zone, v.who)}` : v.plural ? 'those cards' : 'that card';
        // A move whose destination owner differs from the source owner names the destination ("… in your discard pile").
        const same = (v.who ?? 'self') === (st.who ?? 'self');
        if (st.to === 'discard' && same) return { text: `Discard ${what}`, ateShuffle: false };
        if (st.to === 'deck' && same) {
          const ate = next?.op === 'shuffle' && (next.who ?? 'self') === (st.who ?? 'self');
          return { text: ate ? `Shuffle ${what} ${dest}` : `Put ${what} ${dest}`, ateShuffle: ate };
        }
        return { text: `Put ${what} ${dest}`, ateShuffle: false };
      }
      return { text: `Put the cards in "${st.cards}" ${dest}`, ateShuffle: false };
    }
    if ('top' in st.cards) {
      const n = st.cards.top;
      const what = n === 1 ? `the top card of ${zoneOf('deck', st.cards.who)}` : `the top ${this.num(n)} cards of ${zoneOf('deck', st.cards.who)}`;
      if (st.as) this.vars.set(st.as, { k: 'cards', text: n === 1 ? 'that card' : 'those cards', plural: n !== 1, zone: 'top', reveal: false, mentioned: true, done: DONE[st.to] });
      const same = (st.cards.who ?? 'self') === (st.who ?? 'self');
      return { text: st.to === 'discard' && same ? `Discard ${what}` : `Put ${what} ${dest}`, ateShuffle: false };
    }
    const z = zoneOf(st.cards.all, st.cards.who);
    if (st.as) this.vars.set(st.as, { k: 'cards', text: 'those cards', plural: true, zone: st.cards.all, reveal: false, mentioned: true, done: DONE[st.to] });
    const same = (st.cards.who ?? 'self') === (st.who ?? 'self');
    if (same && st.to === 'deck' && next?.op === 'shuffle' && (next.who ?? 'self') === (st.who ?? 'self')) return { text: `Shuffle ${z} ${dest}`, ateShuffle: true };
    if (same && st.to === 'discard') return { text: `Discard ${z}`, ateShuffle: false };
    return { text: `Put ${z} ${dest}`, ateShuffle: false };
  }

  // ---------------------------------------------------------------- statics, triggers, Abilities

  /** "your Benched Pokémon", plural? — the Pokémon (or player) a static applies to. */
  scope(s: Scope, f?: Filter): { x: string; plural: boolean } {
    const nn = noun(f ?? {}, true).pl;
    switch (s) {
      case 'self':
        return { x: f ? `${this.selfName} (if it is ${art(noun(f, true).sg)})` : this.selfName, plural: false };
      case 'myActive':
        return { x: `your Active ${nn}`, plural: false };
      case 'oppActive':
        return { x: `your opponent's Active ${nn}`, plural: false };
      case 'myBench':
        return { x: `your Benched ${nn}`, plural: true };
      case 'oppBench':
        return { x: `your opponent's Benched ${nn}`, plural: true };
      case 'myPokemon':
        return { x: `your ${nn} in play`, plural: true };
      case 'oppPokemon':
        return { x: `your opponent's ${nn} in play`, plural: true };
      case 'allPokemon':
        return { x: `each ${noun(f ?? {}, true).sg} in play (both yours and your opponent's)`, plural: false };
      case 'me':
        return { x: 'you', plural: false };
      case 'opp':
        return { x: 'your opponent', plural: false };
      case 'both':
        return { x: 'each player', plural: false };
    }
  }

  /** One static effect as a sentence about X. `fromOpp`: say whose attacks ("from your opponent's Pokémon") — true for passives, false for timed effects. */
  clause(e: StaticEffect, x: string, plural: boolean, fromOpp: boolean): string {
    const has = plural ? 'have' : 'has';
    const X = cap(x);
    switch (e.k) {
      case 'preventEffects': {
        const what = e.from.includes('attack') && e.from.includes('ability') ? 'attacks and Abilities' : e.from.includes('attack') ? 'attacks' : 'Abilities';
        return `Prevent all effects of ${fromOpp ? "your opponent's Pokémon's " : ''}${what} done to ${x}`;
      }
      case 'preventDamage': {
        const from = fromOpp
          ? `from your opponent's Pokémon${e.attackerMaxEnergy !== undefined ? ` that have ${e.attackerMaxEnergy} or fewer Energy attached` : ''}`
          : e.attackerMaxEnergy !== undefined
            ? `from Pokémon that have ${e.attackerMaxEnergy} or fewer Energy attached`
            : '';
        return e.andEffects
          ? `Prevent all damage from and effects of attacks ${from ? `${from} ` : ''}done to ${x}`
          : `Prevent all damage done to ${x} by attacks${from ? ` ${from}` : ''}`;
      }
      case 'retreatCost':
        if (e.set === 0) return `${X} ${has} no Retreat Cost`;
        if (e.set !== undefined) return `The Retreat Cost of ${x} is ${colorless(e.set)}`;
        return `The Retreat Cost of ${x} is ${colorless(e.delta ?? 0)} ${(e.delta ?? 0) < 0 ? 'less' : 'more'}`;
      case 'attackCostC': {
        const who = e.attack ? `${e.attack} used by ${x} costs` : `The attacks of ${x} cost`;
        const d = e.delta;
        if (typeof d === 'number') return `${who} ${colorless(d)} ${d < 0 ? 'less' : 'more'}`;
        if ('mul' in d) {
          const [a, b] = d.mul;
          const k = typeof a === 'number' ? a : typeof b === 'number' ? b : null;
          const per = typeof a === 'number' ? b : a;
          if (k !== null) return `${who} ${colorless(k)} ${k < 0 ? 'less' : 'more'} for each ${this.each(per)}`;
        }
        return `${who} ${this.num(d)} more {C}`;
      }
      case 'attackCostSet':
        return `${X} can use the ${e.attack} attack for ${e.cost.map(sym).join('') || 'no Energy'}`;
      case 'weaknessType':
        return `The Weakness of ${plural ? 'each of ' : ''}${x} ${'is'} now ${sym(e.type)}`;
      case 'damageOut':
        return `The attacks of ${x} do ${Math.abs(e.amount)} ${e.amount < 0 ? 'less' : 'more'} damage to your opponent's Active ${e.vs ? noun(e.vs, true).pl : 'Pokémon'} (before applying Weakness and Resistance)${e.noStack ? `. The effect of ${e.noStack} doesn't stack` : ''}`; // lane:trevenant
      case 'damageIn':
        // The engine applies damageIn to every attack unless `fromOpp` is set, so only the flag says whose.
        return `${X} ${plural ? 'take' : 'takes'} ${Math.abs(e.amount)} ${e.amount < 0 ? 'less' : 'more'} damage from attacks${e.fromOpp ? " from your opponent's Pokémon" : ''} (after applying Weakness and Resistance)`;
      case 'hp':
        return `${X} ${plural ? 'get' : 'gets'} ${e.delta < 0 ? '-' : '+'}${Math.abs(e.delta)} HP`;
      case 'cantAttack':
        return `${X} can't attack`;
      case 'cantRetreat':
        return `${X} can't retreat`;
      case 'noAbilities':
        return `${X} ${has} no Abilities`;
      case 'itemLock':
        return x === 'each player' ? "Each player can't play any Item cards from their hand" : `${X} can't play any Item cards from ${x === 'you' ? 'your' : 'their'} hand`;
      case 'countersFixed': {
        const on = x === 'you' ? 'your Pokémon' : x === 'your opponent' ? "your opponent's Pokémon" : "each Pokémon (both yours and your opponent's)";
        return `Damage counters on ${on} can't be moved to other Pokémon`;
      }
      case 'extraPrize': {
        const take = x === 'you' ? 'take' : `${x} takes`;
        return `When your opponent's Active Pokémon is Knocked Out, ${e.flip ? `flip a coin. If heads, ${take}` : take} 1 more Prize card`;
      }
      case 'loseSelfKoAbilities':
        return `${X} can't use any Abilities that Knock Out the Pokémon using them`;
      case 'cantUseAttack':
        return `${X} can't use ${e.attack}`;
      case 'noToolEffects':
        return `Pokémon Tools attached to ${x === 'each player' || x === 'you' || x === 'your opponent' ? "each Pokémon (both yours and your opponent's)" : x} have no effect`;
      case 'preventCounters': { // lane:darkrai
        const what = e.from.includes('attack') && e.from.includes('ability') ? 'attacks and Abilities' : e.from.includes('attack') ? 'attacks' : 'Abilities';
        return `Prevent all damage counters from being placed on ${x} by effects of ${what} from the opponent's Pokémon`;
      }
      default: {
        const unrendered: never = e;
        return `[unrendered static: ${(unrendered as StaticEffect).k}]`;
      }
    }
  }

  static(d: StaticDef): string {
    const { x, plural } = this.scope(d.scope, d.filter);
    const s = this.clause(d.effect, x, plural, true);
    return d.when ? `If ${this.cond(d.when)}, ${lc(s)}` : s;
  }

  trigger(t: TriggerScript, ability: boolean): string {
    let lead: string;
    let when = t.when;
    switch (t.on) {
      case 'attachFromHand': {
        let to = 'a Pokémon';
        if (when && 'slotIs' in when && when.slotIs.ref === 'self') {
          to = art(noun(when.slotIs.filter, true).sg);
          when = undefined;
        }
        lead = `When you attach this card from your hand to ${to}`;
        break;
      }
      case 'playToBench':
        lead = 'When you play this Pokémon from your hand onto your Bench';
        break;
      case 'evolveFromHand':
        lead = 'When you play this Pokémon from your hand to evolve 1 of your Pokémon';
        break;
      case 'damagedByAttackActive':
        lead = `If ${this.selfName} is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out)`;
        break;
      case 'knockedOutByAttack':
        lead = `If ${this.selfName} is Knocked Out by damage from an attack from your opponent's Pokémon`;
        break;
      case 'checkup':
        lead = 'During Pokémon Checkup';
        break;
      case 'endOfTurn':
        // Fires for the current player's Pokémon only: for a Tool or Energy, "if this card is attached to 1 of your Pokémon".
        lead = this.src === 'pokemon' ? 'At the end of your turn' : 'At the end of your turn, if this card is attached to 1 of your Pokémon';
        break;
      case 'pokemonBenched': {
        // The trigger's frame slot is the benched Pokémon, so 'self' in its program is "that Pokémon".
        let what = 'a Pokémon';
        if (when && 'slotIs' in when && when.slotIs.ref === 'self') {
          what = art(noun(when.slotIs.filter, true).sg);
          when = undefined;
        }
        lead = `Whenever a player puts ${what} onto their Bench during their turn`;
        this.selfName = 'that Pokémon';
        break;
      }
      case 'oppAttachFromHand':
        lead = 'Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon';
        break;
    }
    if (when) lead += `, and if ${this.cond(when)}`;
    const body = this.program(t.program);
    if (t.optional) return ability ? `${lead}, you may use this Ability. ${body}` : `${lead}, you may ${lc(body)}`;
    return `${lead}, ${lc(body)}`;
  }

  ability(a: AbilityScript): string {
    const out: string[] = [];
    if (a.activated) {
      const g = a.activated;
      let s = g.oncePerTurn === false ? 'As often as you like during your turn' : 'Once during your turn';
      if (g.activeOnly) s += ', if this Pokémon is in the Active Spot';
      if (g.when) s += `, if ${this.cond(g.when)}`;
      out.push(`${s}, you may use this Ability`, this.program(g.program));
      if (g.globalOncePerTurn) out.push(`You can't use more than 1 ${a.name} Ability each turn`);
    }
    for (const d of a.statics ?? []) out.push(this.static(d));
    for (const t of a.triggers ?? []) out.push(this.trigger(t, true));
    return join(out);
  }
}

/** Variables used only as addends of the attack's damage (`set` then renders "and have this attack do N more damage"). */
function bonusVars(a: AttackScript): Set<string> {
  const out = new Set<string>();
  const d = a.damage;
  if (d && typeof d === 'object' && 'add' in d) for (const x of d.add) if (typeof x === 'object' && 'v' in x) out.add(x.v);
  return out;
}

export function renderAttack(a: AttackScript, printedDamage: string | null | undefined, problems: string[] = []): string {
  const r = new Renderer('pokemon', problems);
  r.bonus = bonusVars(a);
  const [base, suffix] = parseDamage(printedDamage);
  if (a.program) {
    const hasDamage = JSON.stringify(a.program).includes('"op":"damage"');
    if (base > 0 && !hasDamage) problems.push(`printed damage ${printedDamage} but the program has no damage step`);
    return r.program(a.program, base);
  }
  const out = [...r.steps(a.pre ?? [], base)];
  if (a.damage !== undefined) {
    const b = firstNumber(a.damage);
    if (base > 0 && b !== null && b !== base) problems.push(`damage starts at ${b} but the printed damage is ${printedDamage}`);
    if (suffix && b === null && !(typeof a.damage === 'object' && 'mul' in a.damage)) problems.push(`printed "${printedDamage}" but the damage expression has no base number`);
    out.push(...r.damage(a.damage, base, a.target));
  } else if (a.target) out.push(...r.damage(base, base, a.target));
  out.push(...ignoreSentence(a.ignore));
  out.push(...r.steps(a.post ?? [], base));
  return join(out);
}

/** Mirror sentences for both players → one "Each player …" sentence (Judge, Unfair Stamp). */
function eachPlayer(out: string[]): string[] {
  const res: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!;
    const b = out[i + 1];
    if (a === 'Shuffle your hand into your deck' && b === "Shuffle your opponent's hand into your opponent's deck") {
      res.push('Each player shuffles their hand into their deck');
      i++;
      continue;
    }
    const m = /^Draw (a card|[0-9]+ cards)$/.exec(a);
    if (m && b === `Your opponent draws ${m[1]}`) {
      res.push(`Each player draws ${m[1]}`);
      i++;
      continue;
    }
    res.push(a);
  }
  return res;
}

/** "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon." */
function ignoreSentence(ig: DamageIgnore | undefined): string[] {
  if (!ig) return [];
  const parts: string[] = [];
  if (ig.weakness && ig.resistance) parts.push('Weakness or Resistance');
  else if (ig.weakness) parts.push('Weakness');
  else if (ig.resistance) parts.push('Resistance');
  if (ig.defenderEffects) parts.push("any effects on your opponent's Active Pokémon");
  return parts.length ? [`This attack's damage isn't affected by ${parts.join(', or by ')}`] : [];
}

function firstNumber(e: Expr): number | null {
  if (typeof e === 'number') return e;
  if ('add' in e && typeof e.add[0] === 'number') return e.add[0];
  if ('sub' in e && typeof e.sub[0] === 'number') return e.sub[0];
  if ('cond' in e && typeof e.else === 'number') return e.else;
  return null;
}

export function renderAbility(a: AbilityScript, problems: string[] = []): string {
  return new Renderer('pokemon', problems).ability(a);
}

/** Trainer / Energy text: playable, play, statics, triggers, Stadium Ability, provides. */
export function renderCardText(s: CardScript, f: CardFrame | null, problems: string[] = []): string {
  const src: Source = f?.category === 'Energy' ? 'energy' : f?.trainerType === 'Tool' ? 'tool' : 'trainer';
  const r = new Renderer(src, problems);
  const out: string[] = [];
  const pa = s.fix?.playAsBasic;
  if (pa) {
    out.push(`Play this card as if it were a ${pa.hp}-HP Basic ${sym(pa.type)} Pokémon`);
    if (pa.cantRetreat) out.push("This card can't retreat");
    if (pa.noConditions) out.push("This card can't be affected by any Special Conditions");
    if (pa.discardable) out.push('At any time during your turn, you may discard this card from play');
  }
  if (s.provides && src === 'energy') out.push(`As long as this card is attached to a Pokémon, it provides ${s.provides.map(sym).join('')} Energy`);
  if (s.providesIf) {
    out.push(`As long as this card is attached to ${art(noun(s.providesIf.filter, true).sg)}, it provides ${s.providesIf.provides.map(sym).join('')} Energy instead`);
  }
  if (s.providesAny) {
    const w = s.providesAny.when ? `As long as this card is attached to ${art(noun(s.providesAny.when, true).sg)}, it` : 'This card';
    out.push(`${w} provides every type of Energy but provides only ${s.providesAny.n} Energy at a time`);
  }
  if (s.koPrizeDelta) {
    const d = s.koPrizeDelta.delta;
    out.push(
      `If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes ${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'} Prize card${Math.abs(d) === 1 ? '' : 's'}`,
    );
    if (s.koPrizeDelta.oncePerGame) out.push("This effect can't be applied more than once per game");
  }
  if (s.firstTurnSupporter) out.push('If you go first, you may use this card during your first turn');
  if (s.playable) out.push(`You can use this card only if ${r.cond(s.playable)}`);
  if (s.play) out.push(r.program(s.play));
  for (const d of s.statics ?? []) out.push(r.static(d));
  for (const t of s.triggers ?? []) out.push(r.trigger(t, false));
  if (s.stadiumAbility) {
    const w = s.stadiumAbility.when ? `, if ${r.cond(s.stadiumAbility.when)}` : '';
    out.push(`Once during each player's turn${w}, that player may ${lc(r.program(s.stadiumAbility.program))}`);
  }
  if (s.reattachAfterOwnAttack) {
    out.push(
      'If this card is discarded by an effect of an attack used by the Pokémon this card is attached to, attach this card from your discard pile to that Pokémon after attacking',
    );
  }
  return join(out);
}

/** Render any program on its own (debugging, the CLI). */
export function renderProgram(p: Program, src: Source = 'pokemon'): string {
  return new Renderer(src, []).program(p);
}

// ------------------------------------------------------------------ the round trip

export interface Section {
  /** 'text' (Trainer/Energy), 'ability:<name>' or 'attack:<name>'. */
  key: string;
  printed: string;
  rendered: string;
  /** A custom step without a CUSTOM_GLOSS: the rendering can't be compared, only reported. */
  opaque: boolean;
  /** Definition problems found while rendering (wrong base damage, unknown custom, name not on the card). */
  defProblems: string[];
}

/** Pair every printed text of the card with the rendering of the script part that implements it. */
export function renderCard(s: CardScript, f: CardFrame): Section[] {
  const out: Section[] = [];
  const mk = (key: string, printed: string, render: (p: string[]) => string): void => {
    const defProblems: string[] = [];
    const rendered = render(defProblems);
    out.push({ key, printed: normText(printed), rendered, opaque: /\[custom: [^\]—]*\]/.test(rendered), defProblems });
  };
  // Abilities on any card (a Trainer played as a Pokémon, e.g. an Antique fossil, has one too).
  {
    for (const b of f.abilities ?? []) {
      const a = s.abilities?.find((x) => normText(x.name) === normText(b.name));
      mk(`ability:${normText(b.name)}`, b.effect, (p) => {
        if (!a) {
          p.push(`no script for the Ability "${b.name}"`);
          return '';
        }
        return renderAbility(a, p);
      });
    }
    for (const a of s.abilities ?? []) {
      if (!(f.abilities ?? []).some((b) => normText(b.name) === normText(a.name))) {
        mk(`ability:${a.name}`, '', (p) => {
          p.push(`script Ability "${a.name}" is not on the card (buildDef matches by name: it would be silently ignored)`);
          return renderAbility(a, p);
        });
      }
    }
  }
  if (f.category === 'Pokemon') {
    for (const fa of f.attacks ?? []) {
      const sa = s.attacks?.[normText(fa.name)];
      if (!fa.effect && !sa) continue;
      mk(`attack:${normText(fa.name)}`, fa.effect ?? '', (p) => (sa ? renderAttack(sa, fa.damage, p) : (p.push(`no script for the attack "${fa.name}"`), '')));
    }
    for (const [name, sa] of Object.entries(s.attacks ?? {})) {
      if (!(f.attacks ?? []).some((a) => normText(a.name) === name)) {
        mk(`attack:${name}`, '', (p) => {
          p.push(`script attack "${name}" is not on the card (it would be silently ignored)`);
          return renderAttack(sa, null, p);
        });
      }
    }
    if (s.play || s.stadiumAbility || s.provides) {
      mk('text', f.effect ?? '', (p) => (p.push('Trainer/Energy fields on a Pokémon script'), renderCardText(s, f, p)));
    }
  } else {
    mk('text', f.effect ?? '', (p) => renderCardText(s, f, p));
  }
  return out;
}

// ------------------------------------------------------------------ comparison

/**
 * Reminder text that states a game rule the engine applies everywhere, so a
 * script never encodes it. Stripped from the printed text before comparing.
 * Parentheticals that DO carry card-specific meaning ("(Your opponent chooses
 * the new Active Pokémon.)", "(both yours and your opponent's)") stay, and the
 * renderer produces them.
 */
export const REMINDERS: RegExp[] = [
  /\(Don't apply Weakness and Resistance for Benched Pokémon\.\)/gi,
  /\(Pokémon ex, Pokémon V, etc\. have Rule Boxes\.\)/gi,
  /\(Damage is not an effect\.\)/gi,
  /\(Apply Weakness as ×2\.\)/gi,
  /\(You can't use more than 1 VSTAR Power in a game\.\)/gi,
  /\(You can't use more than 1 GX attack in a game\.\)/gi,
];

export function stripReminders(s: string): string {
  let t = normText(s);
  for (const re of REMINDERS) t = t.replace(re, ' ');
  return normText(t);
}

const SYMBOL_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_SYMBOL).map(([t, c]) => [c, t.toLowerCase()]),
);
const NUMBER_WORD: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** Lower case, energy symbols to words ({P} → psychic), accents and apostrophes dropped, number words to digits, "Benched" → "bench". */
export function normalize(s: string): string {
  return normText(s)
    .replace(/\{([A-Z])\}/g, (_, c: string) => ` ${SYMBOL_WORD[c] ?? c} `)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/×/g, ' x ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => NUMBER_WORD[w]!)
    .replace(/\bbenched\b/g, 'bench')
    .replace(/\s+/g, ' ')
    .trim();
}

const stem = (t: string): string => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const tokens = (s: string): string[] => normalize(s).split(' ').filter(Boolean).map(stem);

/** Mean of a multiset Dice coefficient and an LCS ratio over normalised, stemmed tokens. 1 = same words in the same order. */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  const bag = new Map<string, number>();
  for (const t of y) bag.set(t, (bag.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of x) {
    const c = bag.get(t) ?? 0;
    if (c > 0) {
      common++;
      bag.set(t, c - 1);
    }
  }
  const dice = (2 * common) / (x.length + y.length);
  const dp = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j]!;
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  const lcs = (2 * dp[y.length]!) / (x.length + y.length);
  return (dice + lcs) / 2;
}

/** Key nouns (and a few load-bearing words): present in the printed text ⇒ present in the rendering. */
export const KEY_TERMS: [string, RegExp][] = [
  ['Basic', /\bbasic\b/],
  ['Stage 1', /\bstage 1\b/],
  ['Stage 2', /\bstage 2\b/],
  ['Evolution', /\bevol/],
  ['Supporter', /\bsupporter/],
  ['Item', /\bitem/],
  ['Stadium', /\bstadium/],
  ['Tool', /\btool/],
  ['Bench', /\bbench/],
  ['Active', /\bactive\b/],
  ['discard pile', /\bdiscard pile\b/],
  ['discard', /\bdiscard\b(?! pile)/],
  ['hand', /\bhand\b/],
  ['deck', /\bdeck\b/],
  ['top', /\btop\b/],
  ['bottom', /\bbottom\b/],
  ['Prize', /\bprize/],
  ['Energy', /\benergy\b/],
  ['damage counter', /\bdamage counter/],
  ['coin', /\bcoin/],
  ['heads', /\bheads\b/],
  ['tails', /\btails\b/],
  ['Ability', /\babilit/],
  ['Retreat Cost', /\bretreat cost\b/],
  ['Weakness', /\bweakness\b/],
  ['Resistance', /\bresistance\b/],
  ['Knocked Out', /\bknocked out\b/],
  ['Asleep', /\basleep\b/],
  ['Burned', /\bburned\b/],
  ['Confused', /\bconfused\b/],
  ['Paralyzed', /\bparalyzed\b/],
  ['Poisoned', /\bpoisoned\b/],
  ['Rule Box', /\brule box/],
  ['ex', /\bpokemon ex\b/],
  ['Lost Zone', /\blost zone\b/],
  ['shuffle', /\bshuffl/],
  ['search', /\bsearch/],
  ['draw', /\bdraw/],
  ['attach', /\battach/],
  ['switch', /\bswitch/],
  ['heal', /\bheal/],
  ['prevent', /\bprevent/],
  ['each', /\beach\b/],
  ['instead', /\binstead\b/],
  ["can't", /\bcant\b/],
  ['your next turn', /\byour next turn\b/],
  ["opponent's next turn", /\bopponents next turn\b/],
  ['this turn', /\bthis turn\b/],
];

/** Present on either side ⇒ present on the other. */
export const BOTH_WAYS: [string, RegExp][] = [
  ['may', /\bmay\b/],
  ['up to', /\bup to\b/],
  ['any number of', /\bany number of\b/],
  ['reveal', /\breveal/],
];

const TYPE_WORDS = Object.keys(TYPE_SYMBOL).map((t) => t.toLowerCase());
const ZONE = '(active|bench|discard pile|hand|deck|prize|pokemon)';
const OPP_ZONE = new RegExp(`\\bopponents? (?:\\w+ ){0,2}?${ZONE}`, 'g');
const MY_ZONE = new RegExp(`\\byour (?!opponent|turn|next)(?:\\w+ ){0,2}?${ZONE}`, 'g');

function matches(re: RegExp, s: string): Set<string> {
  return new Set([...s.matchAll(re)].map((m) => m[1]!));
}

/**
 * Structural differences between the printed text and a rendering: each is a
 * likely bug in the script (or a vocabulary gap). Empty = the rendering says
 * at least everything the card says, with the same numbers, zones and sides.
 */
export function structural(printed: string, rendered: string): string[] {
  const p = normalize(stripReminders(printed));
  const r = normalize(rendered);
  const problems: string[] = [];
  // Numbers and Energy types are multisets: "draw 6 cards … exactly 6 Prize cards" needs two 6s.
  const tally = (xs: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const rn = tally(r.match(/\d+/g) ?? []);
  for (const [n, c] of tally(p.match(/\d+/g) ?? [])) {
    if ((rn.get(n) ?? 0) < c) problems.push(`number ${n} is printed ${c}× but rendered ${rn.get(n) ?? 0}×`);
  }
  for (const [label, re] of KEY_TERMS) if (re.test(p) && !re.test(r)) problems.push(`"${label}" is printed but not rendered`);
  for (const [label, re] of BOTH_WAYS) {
    if (re.test(p) !== re.test(r)) problems.push(`"${label}" is ${re.test(p) ? 'printed but not rendered' : 'rendered but not printed'}`);
  }
  for (const m of p.matchAll(/\bup to (\d+)/g)) if (!r.includes(`up to ${m[1]}`)) problems.push(`"up to ${m[1]}" is printed but not rendered`);
  const words = (s: string): Map<string, number> => tally(s.split(' ').filter((w) => TYPE_WORDS.includes(w)));
  const rt = words(r);
  for (const [t, c] of words(p)) if ((rt.get(t) ?? 0) < c) problems.push(`type ${t} is printed ${c}× but rendered ${rt.get(t) ?? 0}×`);
  const ro = matches(OPP_ZONE, r);
  for (const z of matches(OPP_ZONE, p)) if (!ro.has(z)) problems.push(`"opponent's ${z}" is printed but not rendered`);
  const rm = matches(MY_ZONE, r);
  for (const z of matches(MY_ZONE, p)) if (!rm.has(z)) problems.push(`"your ${z}" is printed but not rendered`);
  if (/\bopponent/.test(r) && !/\bopponent/.test(p) && !/\bboth\b/.test(p)) problems.push('the rendering involves the opponent; the printed text does not');
  return problems;
}

export interface RoundTrip extends Section {
  id: string;
  name: string;
  score: number;
  /** Structural + definition problems. */
  problems: string[];
}

export function roundTrip(s: CardScript, f: CardFrame): RoundTrip[] {
  let sections: Section[];
  try {
    sections = renderCard(s, f);
  } catch (err) {
    const msg = `the renderer threw: ${(err as Error).message} (a clause shape render.ts doesn't handle; fix render.ts)`;
    return [{ key: 'card', printed: '', rendered: '', opaque: false, defProblems: [], id: s.id, name: s.name, score: 0, problems: [msg] }];
  }
  return sections.map((sec) => {
    // A `playable` gate the card doesn't print ("a card with no effect can't be played") is left out of the score.
    const scored = /\bonly (if|when)\b/i.test(sec.printed) ? sec.rendered : sec.rendered.replace(/^You can use this card only if [^.]*\.\s*/, '');
    const score = similarity(stripReminders(sec.printed), scored);
    const low = sec.printed && !sec.opaque && score < SIMILARITY_FLOOR ? [`similarity ${score.toFixed(2)} is below the floor ${SIMILARITY_FLOOR}`] : [];
    return { ...sec, id: s.id, name: s.name, score, problems: [...sec.defProblems, ...structural(sec.printed, sec.rendered), ...low] };
  });
}

/** Below this the rendering is probably about something else. A paraphrase scores ~0.5-0.8; a wrong number still scores high. */
export const SIMILARITY_FLOOR = 0.4;

/**
 * Justified exceptions to the structural checks, by `${id}|${section key}`.
 * Each entry lists substrings of the problems it excuses and WHY. Keep it short:
 * an entry is a claim that the script is right and the check is too blunt.
 */
export const ROUNDTRIP_ALLOW: Record<string, { problems: string[]; why: string }> = {
  // lane:darkrai
  'me05-048|attack:Abyss Eye': {
    problems: ['similarity'],
    why: '"affected by a Special Condition" is a filter `any` of the five conditions, which renders as five clauses; the KO itself is the single `knockOut` the card prints.',
  },
  'me05-075|text': {
    problems: ['similarity'],
    why: '"Both Active non-{D} Pokémon" is one `if` per Active Pokémon (one for each player), so the one printed sentence renders as two.',
  },
  // lane:trevenant
  'sv06-151|text': {
    problems: ['"may" is rendered but not printed', '"reveal" is rendered but not printed'],
    why: "Hassel reuses Pokégear 3.0's lookAtTopTake, whose gloss is worded for Pokégear (\"You may reveal\"); \"put up to 3 of them\" is its max 3 with min 0, which is the same choice.",
  },
  'sv09-157|text': {
    problems: ['similarity'],
    why: "Ruffian's one sentence renders as a playable gate (some opposing Pokémon has a Tool or a Special Energy), the choice of that Pokémon, and the two discards, so it scores low; each part is checked by its card test.",
  },
  'me05-029|attack:All-You-Can-Yeet': {
    problems: ['"may" is printed but not rendered'],
    why: '"You may discard any number of cards": choosing min 0 IS the option to discard none, so a `may` wrapper would only add a redundant yes/no decision.',
  },
  // "up to N" built from a loop or an option, which the renderer can't fold back into a count.
  'me01-179|attack:Aura Jab': {
    problems: ['"up to', 'similarity'],
    why: '"Attach up to 3 … in any way you like" is `repeat 3` of an optional (min 0) pick that ends the loop when declined; each pick chooses its own Benched Pokémon. The loop renders long, hence the low score.',
  },
  // lane:grimmsnarl — same shape as Aura Jab, from the deck.
  'sv10-136|ability:Punk Up': {
    problems: ['"up to'],
    why: '"search your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie\'s Pokémon in any way you like" is `repeat 5` of an optional (min 0) deck pick, each attached to its own chosen Marnie\'s Pokémon; declining shuffles and ends the loop.',
  },
  'me02-041|attack:Garland Ray': {
    problems: ['"up to'],
    why: '"Discard up to 2 Energy cards" is a 3-way chooseOption (2, 1 or none) followed by discarding 2 minus the choice; the damage counts what was actually discarded.',
  },
  'sv07-133|text': {
    problems: ['"up to 2"', 'number 2'],
    why: 'Crispin: the first Basic Energy is an optional pick; the second ("of a different type") comes from the custom chooseEnergyOfOtherType, so the 2 lives in code (tested in cards-ghost.test.ts).',
  },
  'sv08-185|text': {
    problems: ['"up to"', '"any number of"'],
    why: 'Precious Trolley: "any number of Basic Pokémon" onto the Bench is bounded by free Bench space; searchToBench(…, 5) clamps to it and 5 is the whole Bench.',
  },
  // Deliberate: min 1 on an "up to" whose card is only playable with a target (a card with no effect can't be played).
  'sv10-168|text': {
    problems: ['"up to'],
    why: 'Sacred Ash: playable only with a Pokémon in the discard pile, then 1-5 are chosen. Choosing none would play the card for no effect (see the script notes).',
  },
  'me03-108|text': {
    problems: ['"up to'],
    why: 'Energy Recycler: as Sacred Ash. Playable only with a Basic Energy in the discard pile, then 1-5 are chosen.',
  },
  // Same meaning, different words.
  'me01-125|text': {
    problems: ['"can\'t" is printed'],
    why: 'Rare Candy: "You can\'t use this card during your first turn or on a Basic Pokémon that was put into play this turn" is the playable condition rareCandyPlayable plus the custom\'s own filter; both glossed.',
  },
  'me01-110|ability:Evidence Gathering': {
    problems: ['"switch" is printed'],
    why: '"Switch a card from your hand with the top card of your deck" renders as its two moves: the hand card is chosen first, so it can\'t be the card just taken.',
  },
  'me05-065|attack:Maximum Drilling': {
    problems: ['number 2'],
    why: '"At least 2 extra Energy (in addition to this attack\'s cost)": the cost is {M}{M}{M}, so the script tests 5 or more Energy attached.',
  },
  'me05-062|ability:Ancient Bulwark': {
    problems: ['"each" is printed'],
    why: '"each of your Pokémon" is scope myPokemon, which the renderer words as "your Pokémon in play".',
  },
};
