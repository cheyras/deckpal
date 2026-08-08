/**
 * DB-backed proof (read-only). Run: `pnpm --filter deckscout-api prove:deck`.
 * Exercises the engine against real catalogue rows: set-alias resolution of a
 * fixture, fingerprint reprint-collision, the reprint-legality oracle, and a
 * full parse -> resolve -> validate of a real decklist. Closes its pool at the end.
 */
import { parsePtcgl } from './ptcgl.js';
import { makeDeckPool, resolveDeck, loadBySetNumber, computeFingerprints, buildReprintOracle } from './db.js';
import { validateDeck } from './formats.js';
import { EXAMPLE_A } from './__tests__/fixtures.js';

async function main() {
  const pool = makeDeckPool();
  const line = (s: string) => console.log(s);

  line('=== 1. Set-alias ladder resolves a code tcgOnline misses (SVI -> sv01) ===');
  const ultra = await loadBySetNumber(pool, 'sv01', '196');
  line(`  PTCGL "Ultra Ball SVI 196"  ->  ${ultra?.tcgdexId} "${ultra?.name}" mark=${ultra?.regulationMark}`);
  const jtg1 = await loadBySetNumber(pool, 'sv09', '1');
  line(`  PTCGL "... JTG 1" (padding)  ->  ${jtg1?.tcgdexId} "${jtg1?.name}" (localId ${jtg1?.localId})`);

  line('\n=== 2. Fingerprint reprint-collision across Charizard ex prints ===');
  const { rows } = await pool.query<{ id: string; set: string; local_id: string }>(
    `SELECT c.id, s.tcgdex_id AS set, c.local_id
       FROM card c JOIN card_set s ON s.id=c.set_id
      WHERE c.name_normalized='charizard ex' AND c.lang='en'
      ORDER BY s.released_on, c.local_id`,
  );
  const fps = await computeFingerprints(pool, rows.map((r) => Number(r.id)));
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const fp = fps.get(Number(r.id));
    if (!fp) continue;
    const key = fp.slice(0, 12);
    const label = `${r.set} ${r.local_id}`;
    groups.set(key, [...(groups.get(key) ?? []), label]);
  }
  for (const [fp, prints] of groups) {
    if (prints.length > 1) line(`  fp ${fp}…  collides across ${prints.length} prints: ${prints.join(', ')}`);
  }
  line(`  (${rows.length} Charizard ex prints -> ${groups.size} distinct playable fingerprints)`);

  line('\n=== 3. Reprint oracle: Ultra Ball SVI (mark G, rotated) legal via me01 reprint (mark I) ===');
  const me131 = await loadBySetNumber(pool, 'me01', '131');
  const uFp = (await computeFingerprints(pool, [ultra!.id])).get(ultra!.id);
  const mFp = (await computeFingerprints(pool, [me131!.id])).get(me131!.id);
  line(`  sv01-196 fp = ${uFp?.slice(0, 16)}…  (mark ${ultra?.regulationMark})`);
  line(`  me01-131 fp = ${mFp?.slice(0, 16)}…  (mark ${me131?.regulationMark})  ->  match=${uFp === mFp}`);
  const oracle = await buildReprintOracle(pool, [ultra!], ['H', 'I', 'J']);
  line(`  oracle.isInFormatByReprint(Ultra Ball SVI) = ${oracle(ultra!)}  (expected true)`);

  line('\n=== 4. Full parse -> resolve -> validate of a real decklist (Example A, Standard) ===');
  const parsed = parsePtcgl(EXAMPLE_A);
  const deck = await resolveDeck(pool, parsed, 'standard');
  const resolvedOracle = await buildReprintOracle(pool, deck.entries.map((e) => e.card), ['H', 'I', 'J']);
  const result = validateDeck(deck, { isInFormatByReprint: resolvedOracle });
  line(`  parsed ${parsed.lines.length} lines; resolved ${deck.entries.length} entries; ` +
    `${(deck.importWarnings ?? []).filter((w) => w.code === 'UNRESOLVED_CARD').length} unresolved`);
  line(`  counts: ${JSON.stringify(result.counts)}`);
  line(`  legal=${result.legal}; violation codes: ${result.violations.map((v) => v.code).join(', ') || '(none)'}`);
  for (const v of result.violations.slice(0, 6)) line(`    - [${v.code}] ${v.message}`);

  await pool.end();
  line('\n(pool closed; connections returned to baseline)');
}

main().catch((err) => { console.error(err); process.exit(1); });
