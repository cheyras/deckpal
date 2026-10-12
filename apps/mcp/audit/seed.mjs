/**
 * The MCP audit's fixture: a real-sized catalog and a heavy, realistic user,
 * built the way a user builds one.
 *
 * The CATALOG is inserted directly, because nothing but the sync job writes
 * one. It comes from the battle simulator's card frames (`@deckpal/sim`'s
 * FRAMES): every Standard card the simulator knows, with its real id, name,
 * HP, attacks and Abilities, so `search_cards`, `check_deck` and
 * `simulate_battles` answer about real cards. Rarities and prices are not in
 * the frames, so they are derived deterministically from the card id.
 *
 * The USER's data is written through the MCP write tools themselves, each with
 * `dry_run: false`, against the real API and database: collection batches,
 * the twelve meta decks and variants of them, one deck played across several
 * versions with a hundred-odd battle logs, a long strategy guide, and big
 * lists. That is deliberate. It is how the data really gets there, and it
 * means every commit path the audit seeds through is exercised end to end.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** A stable number in [0, 1) from a string — rarities, prices and picks never vary between runs. */
export function unit(key) {
  return createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;
}

const setOf = (id) => id.slice(0, id.lastIndexOf('-'));
const localOf = (id) => id.slice(id.lastIndexOf('-') + 1);
const seriesOf = (set) => set.replace(/[\d.].*$/, '') || set;
const normalize = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function rarityFor(frame) {
  if (frame.category === 'Energy') return 'Common';
  if (frame.suffix === 'ex' || /\bex$/.test(frame.name)) return unit(frame.cardId + ':sir') < 0.15 ? 'Special Illustration Rare' : 'Double Rare';
  if (frame.category === 'Trainer') return unit(frame.cardId) < 0.7 ? 'Uncommon' : 'Common';
  const u = unit(frame.cardId);
  return u < 0.45 ? 'Common' : u < 0.8 ? 'Uncommon' : u < 0.93 ? 'Rare' : 'Illustration Rare';
}

/** USD minor units by rarity, or null for the few cards with no price at all. */
function priceFor(variantKey, rarity, kind) {
  const u = unit(variantKey + ':price');
  if (u < 0.04) return null;
  const base = {
    Common: [5, 25], Uncommon: [10, 60], Rare: [40, 300], 'Illustration Rare': [150, 1500],
    'Double Rare': [100, 1200], 'Special Illustration Rare': [2000, 15000],
  }[rarity] ?? [5, 50];
  const minor = Math.round(base[0] + (base[1] - base[0]) * unit(variantKey + ':spread'));
  return kind === 'reverse' ? Math.round(minor * 1.6) : minor;
}

async function insertRows(db, table, columns, rows, conflict = '') {
  // The catalog keys are identity columns; the fixture names its own ids so
  // cards, variants and prices can reference each other without a round trip.
  const overriding = columns[0] === 'id' ? 'OVERRIDING SYSTEM VALUE' : '';
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params = [];
    const tuples = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
    await db.query(`INSERT INTO ${table} (${columns.join(',')}) ${overriding} VALUES ${tuples.join(',')} ${conflict}`, params);
  }
}

/**
 * Catalog from the simulator's frames. Returns the ids the user seed draws on.
 */
export async function seedCatalog(db, FRAMES) {
  const frames = Object.values(FRAMES).sort((a, b) => a.cardId.localeCompare(b.cardId, 'en', { numeric: true }));
  const sets = [...new Set(frames.map((f) => setOf(f.cardId)))];
  const series = [...new Set(sets.map(seriesOf))];

  await insertRows(db, 'series', ['id', 'catalogue_code', 'tcgdex_id', 'slug', 'name', 'sort_order'],
    series.map((s, i) => [i + 1, 'en', s, s, `Series ${s.toUpperCase()}`, i]), 'ON CONFLICT DO NOTHING');
  const seriesId = new Map(series.map((s, i) => [s, i + 1]));
  const counts = new Map();
  for (const f of frames) counts.set(setOf(f.cardId), (counts.get(setOf(f.cardId)) ?? 0) + 1);
  await insertRows(db, 'card_set',
    ['id', 'series_id', 'tcgdex_id', 'slug', 'name', 'released_on', 'card_count_official', 'card_count_total', 'abbreviation'],
    sets.map((s, i) => [i + 1, seriesId.get(seriesOf(s)), s, s, `Set ${s.toUpperCase()}`, new Date(Date.UTC(2023, 0, 1) + i * 45 * 864e5).toISOString().slice(0, 10),
      counts.get(s), counts.get(s), s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)]),
    'ON CONFLICT DO NOTHING');
  const setId = new Map(sets.map((s, i) => [s, i + 1]));

  await insertRows(db, 'variant_kind', ['code', 'display_name', 'finish', 'size', 'tier_derived', 'tier_rule_version'],
    [['normal', 'Normal', 'normal', 'standard', 'standard', 3], ['reverse', 'Reverse Holo', 'reverse', 'standard', 'standard', 3],
      ['holo', 'Holo', 'holo', 'standard', 'standard', 3]], 'ON CONFLICT DO NOTHING');

  const cards = [];
  const types = [];
  const attacks = [];
  const abilities = [];
  const variants = [];
  const prices = [];
  let variantId = 0;
  const cardIdOf = new Map();
  frames.forEach((f, i) => {
    const id = i + 1;
    cardIdOf.set(f.cardId, id);
    const local = localOf(f.cardId);
    const numeric = /^\d+$/.test(local) ? Number(local) : null;
    const rarity = rarityFor(f);
    const basicEnergy = f.category === 'Energy' && f.energyType === 'Normal';
    cards.push([id, setId.get(setOf(f.cardId)), f.cardId, local, numeric, local.padStart(4, '0'), f.name, normalize(f.name),
      f.category, rarity, f.hp ?? null, f.stage ?? null, f.suffix ?? null, f.evolvesFrom ?? null, f.trainerType ?? null,
      f.energyType ?? null, f.retreat ?? null, f.effect ?? null, f.regulationMark?.toUpperCase().slice(0, 1) ?? null,
      basicEnergy || ['H', 'I', 'J'].includes(f.regulationMark ?? ''), true]);
    (f.types ?? []).forEach((t, slot) => types.push([id, t, slot]));
    (f.attacks ?? []).forEach((a, ord) => attacks.push([id, ord, a.name, a.damage, a.effect, a.cost]));
    (f.abilities ?? []).forEach((a, ord) => abilities.push([id, ord, a.kind, a.name, a.effect]));
    const kinds = ['normal'];
    if (f.category !== 'Energy' && !(f.suffix === 'ex' || /\bex$/.test(f.name))) kinds.push('reverse');
    kinds.forEach((kind, sort) => {
      variantId++;
      variants.push([variantId, id, kind, sort, sort === 0, 'none', 0]);
      const minor = priceFor(`${f.cardId}:${kind}`, rarity, kind);
      if (minor !== null) prices.push([variantId, 'tcgcsv', 'USD', minor, Math.round(minor * 0.8), minor, Math.round(minor * 1.5)]);
    });
  });
  await insertRows(db, 'card', ['id', 'set_id', 'tcgdex_id', 'local_id', 'local_id_numeric', 'number_sort', 'name', 'name_normalized',
    'category', 'rarity', 'hp', 'stage', 'suffix', 'evolve_from', 'trainer_type', 'energy_type', 'retreat', 'effect',
    'regulation_mark', 'legal_standard', 'legal_expanded'], cards);
  await insertRows(db, 'card_type', ['card_id', 'type', 'slot'], types, 'ON CONFLICT DO NOTHING');
  await insertRows(db, 'card_attack', ['card_id', 'ord', 'name', 'damage', 'effect', 'cost'], attacks);
  await insertRows(db, 'card_ability', ['card_id', 'ord', 'kind', 'name', 'effect'], abilities);
  await insertRows(db, 'card_variant', ['id', 'card_id', 'variant_kind_code', 'sort_order', 'is_primary', 'id_source', 'id_confidence'], variants);
  await insertRows(db, 'price_current', ['card_variant_id', 'source_code', 'currency_code', 'market_minor', 'low_minor', 'mid_minor', 'high_minor'], prices);
  return { cards: frames.length, sets: sets.length, variants: variantId, prices: prices.length, cardIdOf };
}

/**
 * Daily observations for one card's printings over the last `days` days, so
 * `card_price_history` has a series to page through. Monthly partitions are
 * created on demand, the way the sync job's would be.
 */
export async function seedPriceHistory(db, cardDbId, days = 120) {
  const { rows: variants } = await db.query('SELECT id FROM card_variant WHERE card_id = $1', [cardDbId]);
  const now = new Date();
  const start = new Date(now.getTime() - days * 864e5);
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= now; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const name = `price_observation_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    await db.query(`CREATE TABLE IF NOT EXISTS ${name} PARTITION OF price_observation FOR VALUES FROM ('${d.toISOString().slice(0, 10)}') TO ('${next.toISOString().slice(0, 10)}')`)
      .catch((error) => { if (!/overlap|already exists/i.test(error.message)) throw error; });
  }
  const rows = [];
  for (const v of variants) {
    for (let i = 0; i < days; i++) {
      const at = new Date(start.getTime() + i * 864e5);
      const market = Math.round(800 + 400 * Math.sin(i / 9) + 200 * unit(`${v.id}:${i}`));
      rows.push([Number(v.id), 1, 'USD', at.toISOString(), market, Math.round(market * 0.85), market, Math.round(market * 1.3)]);
    }
  }
  await insertRows(db, 'price_observation', ['card_variant_id', 'source_code', 'currency_code', 'captured_at', 'market_minor', 'low_minor', 'mid_minor', 'high_minor'], rows);
  return rows.length;
}

/** Real PTCG Live logs from the repo's own fixtures, with the players renamed. */
export function liveLogs(repo) {
  const dirs = [
    join(repo, 'packages/sim/src/__tests__/fixtures/live-logs'),
    join(repo, 'apps/api/src/deck/__tests__/fixtures'),
  ];
  const logs = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.txt') || file.includes('future-drift')) continue;
      const text = readFileSync(join(dir, file), 'utf8');
      if (text.includes('PlayerA') && text.includes('PlayerB')) logs.push({ file, text });
    }
  }
  return logs;
}

export const OWNER_NAME = 'AuditTrainer';
const OPPONENTS = ['Robni16', 'kaiju_88', 'MistyRiver', 'zoroark.main', 'Haruto_TCG', 'pkmnLeo', 'BenchSitter', 'TopdeckTina'];

export function asOwner(log, i) {
  return log.split('PlayerA').join(OWNER_NAME).split('PlayerB').join(OPPONENTS[i % OPPONENTS.length]);
}

/** A strategy guide of realistic length (about 10k characters of markdown). */
export function strategyGuide(deckName) {
  const sections = ['Game plan', 'Opening priorities', 'Turn two setup', 'Prize mapping', 'Matchups', 'Tech choices', 'Common misplays', 'Sideboard notes'];
  return [`# ${deckName} — strategy guide`, '',
    ...sections.flatMap((s, i) => [`## ${s}`, '',
      ...Array.from({ length: 6 }, (_, j) =>
        `- ${s} point ${j + 1}: prioritise the line that keeps two attackers ready, count prizes before committing, and ` +
        `keep a switch effect for the turn the opponent forces a bad active. Note ${i}.${j}.`),
      '']),
  ].join('\n');
}

/** A post-game review in markdown, the kind the server instructions ask for. */
export function review(i) {
  return [
    `### Game ${i} review`, '',
    'Turning point: the turn-three Boss line took the wrong two-prize target and left their attacker loaded.',
    'Variance: prized one of the two stage-one lines; the deck still had outs through search.',
    'Misplay: benched a second basic into a spread attack instead of holding it.',
    'Lesson: map prizes before the first knock out, not after.',
  ].join('\n');
}
