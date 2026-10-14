/**
 * src/rulingIndex.ts is generated from the Compendium index and the simulator's own ruling summaries. A ruling pinned in a
 * test or a card script after the last regeneration must reach rules_lookup too, so a stale file fails here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { RULING_INDEX, RULING_URL } from '../rulingIndex.js';
import { cardTags, idsWithTag } from '../cardTags.js';

const here = dirname(fileURLToPath(import.meta.url));

test('rulingIndex.ts is current (regenerate with node --import tsx scripts/ruling-index.ts)', () => {
  // The generator runs as its own process: scripts/ sits outside this package's rootDir.
  const script = join(here, '..', '..', 'scripts', 'ruling-index.ts');
  const out = execFileSync(process.execPath, ['--import', 'tsx', script, '--check'], { encoding: 'utf8' });
  assert.match(out, /is current/);
});

test('every Compendium ruling is indexed, with its link; summaries carry no URLs', () => {
  const raw = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'rulings-compendium.json'), 'utf8')) as { count: number };
  assert.equal(RULING_INDEX.length, raw.count);
  assert.equal(RULING_URL(2425), 'https://compendium.pokegym.net/ruling/2425/');
  for (const e of RULING_INDEX) for (const s of e.summaries) assert.doesNotMatch(s, /https?:\/\//, `#${e.id}: ${s}`);
  const cursed = RULING_INDEX.find((e) => e.id === 2425);
  assert.ok(cursed && cursed.summaries.some((s) => /Prize is taken/.test(s)), 'the Cursed Blast / Hide n Sneak ruling keeps its summary');
});

test('a comment citing two rulings gives each its own explanation (Astra, #340 round 4)', () => {
  // std-c02.ts: "Ruling (…/2328/): devolving is not benching. Ruling #2327 (…/2327/): the reminder text is overridden."
  const timepiece = RULING_INDEX.find((e) => e.id === 2328)!;
  assert.ok(timepiece.summaries.some((s) => /does not count as putting it onto the Bench/.test(s)), timepiece.summaries.join(' | '));
  assert.ok(!timepiece.summaries.some((s) => /Boosted Evolution/.test(s)), "#2327's explanation landed on #2328");
  // std-c09.ts: "#2353 (…) the opponent chooses first…; #2354 (…) Energy attached … is discarded"
  const first = RULING_INDEX.find((e) => e.id === 2353)!;
  assert.ok(!first.summaries.some((s) => /#2354|discarded/.test(s)), first.summaries.join(' | '));
  // A citation written without its scheme leaves no URL fragment behind.
  for (const e of RULING_INDEX) for (const s of e.summaries) assert.doesNotMatch(s, /pokegym\.net/, `#${e.id}: ${s}`);
});

test('card tags: both Dragapult ex printings are Tera, an Ancient card is Ancient, an untagged card has none', () => {
  assert.deepEqual(cardTags('sv06-130'), ['Tera']);
  assert.deepEqual(cardTags('me02.5-160'), ['Tera']);
  assert.deepEqual(cardTags('sv04-086'), ['Ancient']);
  assert.deepEqual(cardTags('sv06-128'), []); // Dreepy
  assert.ok(idsWithTag('Tera').includes('sv06-130'));
  assert.ok(idsWithTag('Future').includes('sv04-028'));
});
