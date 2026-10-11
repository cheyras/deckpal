/**
 * Data diff: every snapshotted printing (src/cards/frames-all.ts, from the
 * DeckPal catalog, TCGdex-derived) compared field by field against a second,
 * independent card database, the open PokemonTCG/pokemon-tcg-data repo (MIT,
 * cards/en/<setId>.json). Two sources that agree on a card's printed frame are
 * strong evidence the frame is right; where they disagree, DATA-DIFF.md records
 * which one is right and how the engine is made to match it (a script `fix`).
 *
 * Fields compared (the ones that change play first): HP, attack cost/damage,
 * Weakness/Resistance, Retreat, then name, types, stage/evolvesFrom, attack and
 * Ability names, Trainer type, Energy kind (Basic/Special), ACE SPEC and Tera.
 * The engine-side value is the frame with the card script's `fix` applied, so a
 * disagreement a fix already corrects shows as resolved, not open.
 *
 *   node --import tsx scripts/data-diff.ts            # print every disagreement, grouped by field
 *   node --import tsx scripts/data-diff.ts --json     # machine-readable
 *   node --import tsx scripts/data-diff.ts --refresh  # refetch the cached set files
 *
 * The set files are fetched once into packages/sim/.cache/ptcg-data/ (gitignored
 * by the repo-wide `.cache/` rule). PTCG_DATA_REF pins a commit (default master).
 * Exit code 1 when any disagreement is neither fixed nor accepted in ACCEPTED below.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMES, scriptFor } from '../src/cards/registry.js';
import { normText } from '../src/cards/frame.js';
import type { CardFrame } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, '..', '.cache', 'ptcg-data');
const REF = process.env.PTCG_DATA_REF ?? 'master';
const RAW = `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/${REF}`;
const args = process.argv.slice(2);
const json = args.includes('--json');
const refresh = args.includes('--refresh');

interface PtcgCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  abilities?: { name: string; text: string; type: string }[];
  attacks?: { name: string; cost?: string[]; damage?: string; text?: string }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  convertedRetreatCost?: number;
  number: string;
}

/**
 * TCGdex set id → pokemon-tcg-data set id. The general rule is `svNN.5` →
 * `svNpt5` (leading zero dropped, `.5` → `pt5`), same for `me`; the rest are
 * named here. Mega Evolution Energies (mee) and Promos (mep) have no file in
 * that repo, so those printings are matched by name against a reprint (below).
 */
const SET_OVERRIDES: Record<string, string | null> = {
  '30th': 'me55', // 30th Celebration (TCGdex "30th") — me55c is the Classic Collection subset
  'sv10.5b': 'zsv10pt5', // Black Bolt
  'sv10.5w': 'rsv10pt5', // White Flare
  mee: null,
  mep: null,
};
export function ptcgSetId(tcgdexSet: string): string | null {
  if (tcgdexSet in SET_OVERRIDES) return SET_OVERRIDES[tcgdexSet]!;
  const m = /^(sv|me|swsh|sm|xy)0*(\d+)(\.5)?$/.exec(tcgdexSet);
  if (m) return `${m[1]}${m[2]}${m[3] ? 'pt5' : ''}`;
  return tcgdexSet; // base1, base4, sve, … share the id
}

function splitId(id: string): [string, string] {
  const i = id.lastIndexOf('-');
  return [id.slice(0, i), id.slice(i + 1)];
}

async function loadSet(setId: string): Promise<PtcgCard[]> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${setId}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const r = await fetch(`${RAW}/cards/en/${setId}.json`);
  if (!r.ok) throw new Error(`${setId}: HTTP ${r.status}`);
  const body = await r.text();
  writeFileSync(file, body);
  return JSON.parse(body);
}

// ── normalisers: both sources spell the same printed thing differently ──────────
const num = (s: string): string => s.replace(/^0+(?=\d)/, '');
// "Psychic Energy" (TCGdex) is "Basic Psychic Energy" (pokemon-tcg-data).
const nName = (s: string | null | undefined): string =>
  normText(s).replace(/[é]/g, 'e').toLowerCase().replace(/^basic (?=\w+ energy$)/, '');
const nMult = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, '').replace(/[x×]/gi, '×').replace(/[−–]/g, '-');
const nDamage = (s: string | null | undefined): string => nMult(s);
const nCost = (c: string[]): string => c.filter((x) => x && x !== 'Free').sort().join(',');
const nStage = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, '');
const wr = (xs: { type: string; value: string }[] | undefined): string =>
  (xs ?? []).map((w) => `${w.type}${nMult(w.value)}`).join(' ') || '—';

/** One field's two values: `frame` is what the engine plays (frame + script fix). */
export interface Disagreement {
  field: string;
  id: string;
  name: string;
  frame: string;
  ptcg: string;
  /** Set when a script `fix` already makes the engine side match pokemon-tcg-data. */
  fixed?: string;
  /** Set when ACCEPTED says the frame is right (or the difference does not reach play). */
  accepted?: string;
}

/**
 * Disagreements where the frame is right, keyed `<id>|<field>`. Each reason
 * cites what settles it; DATA-DIFF.md carries the longer write-up.
 */
const ACCEPTED: Record<string, string> = {};

const PLAY_FIELDS = ['hp', 'attack.cost', 'attack.damage', 'weakness', 'resistance', 'retreat', 'stage', 'evolvesFrom', 'energyKind', 'aceSpec', 'tera', 'trainerType', 'types', 'attack.count'];

function compare(f: CardFrame, p: PtcgCard): Disagreement[] {
  const s = scriptFor(f);
  const fix = s?.fix;
  const out: Disagreement[] = [];
  const add = (field: string, frame: string, ptcg: string, fixedTo?: string): void => {
    checks++;
    if (frame === ptcg) return;
    const d: Disagreement = { field, id: f.cardId, name: f.name, frame, ptcg };
    if (fixedTo !== undefined && fixedTo === ptcg) d.fixed = `script fix → ${fixedTo}`;
    const acc = ACCEPTED[`${f.cardId}|${field}`];
    if (acc && !d.fixed) d.accepted = acc;
    out.push(d);
  };
  const sub = new Set(p.subtypes ?? []);
  const cat = p.supertype.startsWith('Pok') ? 'Pokemon' : p.supertype;
  add('category', f.category, cat);
  add('name', nName(f.name), nName(p.name));
  if (f.category === 'Pokemon') {
    add('hp', String(f.hp ?? ''), p.hp ?? '');
    add('types', (f.types ?? []).join('/'), (p.types ?? []).join('/'));
    const pStage = sub.has('Stage 2') ? 'Stage2' : sub.has('Stage 1') ? 'Stage1' : sub.has('Basic') ? 'Basic' : (p.subtypes ?? []).join('/');
    add('stage', nStage(f.stage), pStage);
    const ev = fix?.evolvesFrom ?? f.evolvesFrom;
    add('evolvesFrom', nName(f.evolvesFrom) || '—', nName(p.evolvesFrom) || '—', fix?.evolvesFrom ? nName(ev) : undefined);
    add('weakness', wr(f.weaknesses), wr(p.weaknesses), fix?.weakness ? `${fix.weakness}×2` : undefined);
    add('resistance', wr(f.resistances), wr(p.resistances), fix?.resistance ? `${fix.resistance.type}-${fix.resistance.amount}` : undefined);
    add('retreat', String(f.retreat ?? 0), String(p.convertedRetreatCost ?? 0));
    add('tera', String(!!fix?.tera), String(sub.has('Tera')));
    const fa = f.attacks ?? [];
    const pa = p.attacks ?? [];
    add('attack.count', String(fa.length), String(pa.length));
    for (let i = 0; i < Math.min(fa.length, pa.length); i++) {
      const a = fa[i]!;
      const b = pa[i]!;
      add('attack.name', nName(a.name), nName(b.name));
      const tag = (v: string): string => `${normText(a.name)}: ${v || '—'}`;
      add('attack.cost', tag(nCost((a.cost ?? '').split(',').map((x) => x.trim()))), tag(nCost(b.cost ?? [])));
      add('attack.damage', tag(nDamage(a.damage)), tag(nDamage(b.damage)));
    }
    add('ability.names', (f.abilities ?? []).map((a) => nName(a.name)).join(' / ') || '—', (p.abilities ?? []).map((a) => nName(a.name)).join(' / ') || '—');
  } else if (f.category === 'Trainer') {
    const pt = sub.has('Pokémon Tool') || sub.has('Pokemon Tool') ? 'Tool' : (['Item', 'Supporter', 'Stadium'].find((t) => sub.has(t)) ?? (p.subtypes ?? []).join('/'));
    add('trainerType', f.trainerType ?? '—', pt);
    add('aceSpec', String(false), String(sub.has('ACE SPEC')), fix?.aceSpec ? 'true' : undefined);
  } else {
    const frameKind = f.energyType === 'Special' ? 'Special' : 'Basic';
    const pk = sub.has('Special') ? 'Special' : 'Basic';
    add('energyKind', frameKind, pk, fix?.specialEnergy ? 'Special' : undefined);
    add('aceSpec', String(false), String(sub.has('ACE SPEC')), fix?.aceSpec ? 'true' : undefined);
  }
  return out;
}

// ── run ────────────────────────────────────────────────────────────────────────
const frames = Object.values(FRAMES);
const needed = new Set<string>();
for (const f of frames) {
  const ps = ptcgSetId(splitId(f.cardId)[0]);
  if (ps) needed.add(ps);
}
const sets = new Map<string, PtcgCard[]>();
for (const id of [...needed].sort()) sets.set(id, await loadSet(id));
// Reprint lookup order: Scarlet & Violet / Mega era first, the Base Set files last.
const everything = [...sets.entries()]
  .sort(([a], [b]) => Number(a.startsWith('base')) - Number(b.startsWith('base')))
  .flatMap(([, cs]) => cs);

const diffs: Disagreement[] = [];
const unmatched: { id: string; name: string; why: string }[] = [];
const viaReprint: { id: string; ptcg: string }[] = [];
let compared = 0;
let checks = 0;
for (const f of frames) {
  const [set, number] = splitId(f.cardId);
  const ps = ptcgSetId(set);
  let p = ps ? sets.get(ps)!.find((c) => num(c.number) === num(number)) : undefined;
  if (p && nName(p.name) !== nName(f.name)) p = undefined; // numbering differs (sve, promos): fall back
  if (!p) {
    // A reprint with the same name and attack names elsewhere in the fetched sets.
    const atk = (f.attacks ?? []).map((a) => nName(a.name)).join('|');
    p = everything.find((c) => nName(c.name) === nName(f.name) && (c.attacks ?? []).map((a) => nName(a.name)).join('|') === atk);
    if (p) viaReprint.push({ id: f.cardId, ptcg: p.id });
  }
  if (!p) {
    unmatched.push({ id: f.cardId, name: f.name, why: ps ? `no ${ps} #${num(number)} named ${f.name}` : `set ${set} absent from pokemon-tcg-data` });
    continue;
  }
  compared++;
  diffs.push(...compare(f, p));
}

const open = diffs.filter((d) => !d.fixed && !d.accepted);
if (json) {
  console.log(JSON.stringify({ ref: REF, frames: frames.length, compared, checks, unmatched, viaReprint, diffs }, null, 1));
} else {
  console.log(`pokemon-tcg-data@${REF}: ${frames.length} frames, ${compared} compared (${viaReprint.length} via a reprint), ${unmatched.length} unmatched, ${checks} field checks`);
  for (const u of unmatched) console.log(`  unmatched ${u.id} ${u.name}: ${u.why}`);
  for (const v of viaReprint) console.log(`  reprint   ${v.id} ↔ ${v.ptcg}`);
  const fields = [...new Set(diffs.map((d) => d.field))].sort(
    (a, b) => (PLAY_FIELDS.indexOf(a) + 1 || 99) - (PLAY_FIELDS.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
  for (const field of fields) {
    const ds = diffs.filter((d) => d.field === field);
    console.log(`\n${field} (${ds.length})${PLAY_FIELDS.includes(field) ? ' — changes play' : ''}`);
    for (const d of ds) {
      const state = d.fixed ? `FIXED (${d.fixed})` : d.accepted ? `ACCEPTED (${d.accepted})` : 'OPEN';
      console.log(`  ${d.id} ${d.name}: frame=${d.frame} | ptcg-data=${d.ptcg}  [${state}]`);
    }
  }
  console.log(`\n${diffs.length} disagreements: ${diffs.filter((d) => d.fixed).length} fixed, ${diffs.filter((d) => d.accepted).length} accepted, ${open.length} open`);
}
if (open.length) process.exitCode = 1;
