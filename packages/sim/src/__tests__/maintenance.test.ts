/** The new-set / rotation / FAQ-update pipeline's pure parts (src/maintenance, driven by packages/sim/scripts). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PRINTED_WR } from '../cards/printed-wr.js';
import { CARD_TAGS } from '../cards/tags.js';
import { TERA_PRINTINGS } from '../cards/tera.js';
import { citedRulingIds, parseRulingsHtml, rulingMatch, rulingsNamingCard, sourceDate, type Ruling } from '../maintenance/rulings.js';
import { diffTables, normName, ptcgCardToOurs, ptcgSetToOurs, renderPrintedWR, renderTags, renderTera, type WRTable } from '../maintenance/tables.js';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('pokemontcg.io set ids map to ours', () => {
  const cases: [string, string | null][] = [
    ['sv1', 'sv01'], ['sv5', 'sv05'], ['sv10', 'sv10'], ['sv3pt5', 'sv03.5'], ['sv6pt5', 'sv06.5'], ['sv8pt5', 'sv08.5'],
    ['zsv10pt5', 'sv10.5b'], ['rsv10pt5', 'sv10.5w'], ['me1', 'me01'], ['me2pt5', 'me02.5'], ['me4', 'me04'], ['svp', 'svp'],
    ['swsh12pt5', null], ['base1', null],
  ];
  for (const [ptcg, ours] of cases) assert.equal(ptcgSetToOurs(ptcg), ours, ptcg);
  assert.equal(ptcgCardToOurs('sv6pt5', '15'), 'sv06.5-015');
  assert.equal(ptcgCardToOurs('svp', '165'), 'svp-165');
  assert.equal(ptcgCardToOurs('sv1', '231'), 'sv01-231');
  assert.equal(ptcgCardToOurs('swsh1', '1'), null);
});

test('names compare ignoring case, accents and punctuation', () => {
  assert.equal(normName('Pokémon Center Lady'), normName('Pokemon Center Lady'));
  assert.equal(normName('Team Rocket’s Mewtwo ex'), normName("Team Rocket's Mewtwo ex"));
  assert.notEqual(normName('Mewtwo ex'), normName('Mew ex'));
});

test('the renderers reproduce the committed tables byte for byte', () => {
  assert.equal(renderTera(read('../cards/tera.ts'), TERA_PRINTINGS), read('../cards/tera.ts'));
  assert.equal(renderTags(read('../cards/tags.ts'), CARD_TAGS), read('../cards/tags.ts'));
  assert.equal(renderPrintedWR(read('../cards/printed-wr.ts'), PRINTED_WR as WRTable), read('../cards/printed-wr.ts'));
});

test('the renderers sort, de-duplicate and keep the header and footer', () => {
  const tera = renderTera(read('../cards/tera.ts'), ['sv02-005', 'sv01-032', 'sv01-032']);
  assert.ok(tera.includes('Tera Pokémon printings'));
  assert.ok(tera.indexOf('"sv01-032"') < tera.indexOf('"sv02-005"'));
  assert.equal(tera.split('"sv01-032"').length, 2);
  const wr = renderPrintedWR(read('../cards/printed-wr.ts'), { 'svp-001': { weaknesses: [{ type: 'Fire', value: '×2' }], resistances: [] } });
  assert.ok(wr.includes(' 1 printings,'));
  assert.ok(wr.includes('"svp-001": {weaknesses:[{type:"Fire",value:"×2"}],resistances:[]},'));
  assert.ok(wr.includes('export function withPrintedWR'));
});

test('diffTables reports added, removed and changed keys', () => {
  assert.deepEqual(diffTables({ a: 1, b: 2, c: 3 }, { b: 2, c: 4, d: 5 }), { added: ['d'], removed: ['a'], changed: ['c'] });
});

const PAGE = `<div class="entry-summary"><button></button><div class="ruling-2354">
<div class="ruling-categories"><a href="x">Attacks</a> &raquo; <a href="y">Pleasing Present</a> | <a href="x">Abilities</a> &raquo; <a href="z">Unaware</a></div>
<dl class="q-and-a"><dt>If I use Delibird's &quot;Pleasing Present&quot; attack, what happens with Skeledirge&#8217;s Unaware?</dt>
<dd>Because Skeledirge's Unaware &quot;prevents all effects&quot;, the energy is discarded.<br />Second line.</dd></dl>
<div id="source"><span style="font-weight: bold;">Source: </span>
 Chaos Rising FAQ; TPCi Rules Team (2026-05-21)</div></div></div>
<div class="entry-summary"><button></button><div class="ruling-2176">
<div class="ruling-categories"><a href="x">Errata</a> &raquo; <a href="y">Sacred Ash</a></div>
<dl class="single-entry"><dd>The new card text for Sacred Ash will be: "Shuffle up to 5 Pokemon".</dd></dl>
<div id="source"><span style="font-weight: bold;">Source: </span>Jun 13, 2025 TPCi Announcements (date approximate), TPCi Rules Team (2025-06-05)</div></div></div>`;

test('the Compendium page parses into rulings', () => {
  const rs = parseRulingsHtml(PAGE);
  assert.equal(rs.length, 2);
  const [a, b] = rs as [Ruling, Ruling];
  assert.equal(a.id, 2354);
  assert.equal(a.date, '2026-05-21');
  assert.deepEqual(a.categories, ['Pleasing Present', 'Unaware']);
  assert.deepEqual(a.paths, ['Attacks » Pleasing Present', 'Abilities » Unaware']);
  assert.ok(a.q!.includes('Delibird\'s "Pleasing Present"') && a.q!.includes('Skeledirge’s'));
  assert.equal(a.a, 'Because Skeledirge\'s Unaware "prevents all effects", the energy is discarded.\nSecond line.');
  assert.equal(a.source, 'Chaos Rising FAQ; TPCi Rules Team (2026-05-21)');
  assert.equal(b.id, 2176);
  assert.equal(b.q, null);
  assert.equal(b.date, '2025-06-05');
  assert.throws(() => parseRulingsHtml('<html></html>'), /no rulings/);
});

test('source dates', () => {
  assert.equal(sourceDate('A (2024-01-02); B (2025-03-04)'), '2025-03-04');
  assert.equal(sourceDate('Jun 13, 2025 TPCi Announcements (date approximate)'), '2025-06-13');
  assert.equal(sourceDate('nothing'), null);
});

test('a ruling is matched to a card by category (strong) or by name in the text (weak)', () => {
  const [a, b] = parseRulingsHtml(PAGE) as [Ruling, Ruling];
  assert.deepEqual(rulingMatch(a, ['Delibird', 'Pleasing Present']), { by: 'category', name: 'Pleasing Present' });
  assert.deepEqual(rulingMatch(a, ['Delibird']), { by: 'text', name: 'Delibird' });
  assert.equal(rulingMatch(a, ['Deli']), null, 'a prefix of a word is not a mention');
  assert.deepEqual(rulingMatch(b, ['Sacred Ash']), { by: 'category', name: 'Sacred Ash' });
  assert.equal(rulingsNamingCard([a, b], 'Skeledirge').length, 1);
});

test('cited ruling ids are found in every citation style', () => {
  const text = `// https://compendium.pokegym.net/ruling/2352/ and (compendium.pokegym.net/ruling/12), Compendium #994, Compendium #5 and #6, Compendium #7, #8`;
  assert.deepEqual([...citedRulingIds(text)].sort((x, y) => x - y), [5, 6, 7, 8, 12, 994, 2352]);
});

test('the committed rulings snapshot is well formed and attributed', () => {
  const snap = JSON.parse(read('../../data/rulings-compendium.json')) as { source: string; _comment: string; count: number; rulings: Ruling[] };
  assert.equal(snap.source, 'https://compendium.pokegym.net/all-rulings-by-date/');
  assert.match(snap._comment, /TPCi Rules Team/);
  assert.equal(snap.count, snap.rulings.length);
  assert.ok(snap.rulings.length > 1900);
  assert.equal(new Set(snap.rulings.map((r) => r.id)).size, snap.rulings.length, 'ids are unique');
  assert.ok(snap.rulings.every((r, i, all) => i === 0 || all[i - 1]!.id > r.id), 'newest id first');
  assert.ok(snap.rulings.every((r) => r.a && r.source));
});
