// Dry-run validator: exercises the pure transforms over the compiled JSON with NO database.
// Usage: tsx src/catalog/dryrun.ts [dataDir]   (default: <repo>/data/catalog/en)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planCardVariants, tierDerived, type RawCard } from './transform.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DIR = process.argv[2] ?? join(repoRoot, 'data', 'catalog', 'en');
const cards: RawCard[] = JSON.parse(readFileSync(`${DIR}/cards.json`, 'utf-8'));

let totalPlanned = 0, synthesized = 0, dropped = 0;
const kinds = new Set<string>();
const bySet = new Map<string, RawCard[]>();
for (const c of cards) {
  (bySet.get(c.set.id) ?? bySet.set(c.set.id, []).get(c.set.id)!).push(c);
  const plan = planCardVariants(c);
  totalPlanned += plan.variants.length;
  dropped += plan.droppedDuplicates;
  for (const v of plan.variants) {
    kinds.add(v.code);
    if (v.isSynthesized) synthesized++;
    // sanity: exactly one primary per card is asserted below
  }
}

// primary-per-card invariant
let badPrimary = 0;
for (const c of cards) {
  const plan = planCardVariants(c);
  if (plan.variants.filter((v) => v.isPrimary).length !== 1) badPrimary++;
}

console.log('=== WHOLE-CATALOG RECONCILIATION ===');
console.log('cards:', cards.length, '(truth 23,444)');
console.log('card_variant rows planned:', totalPlanned);
console.log('  of which synthesized:', synthesized, '(truth 75)');
console.log('intra-card exact facet dupes collapsed:', dropped);
console.log('=> source vd rows would be:', totalPlanned - synthesized + dropped, '(truth 35,648)');
console.log('distinct variant_kind codes:', kinds.size);
console.log('cards with != 1 primary:', badPrimary);

function setStandardPairs(setId: string): number {
  let n = 0;
  for (const c of bySet.get(setId) ?? []) {
    for (const v of planCardVariants(c).variants) if (tierDerived(v.facet) === 'standard') n++;
  }
  return n;
}
console.log('\n=== base1 (Base Set) — tier v3 proving ground ===');
const base1 = bySet.get('base1') ?? [];
console.log('cards:', base1.length);
let base1Variants = 0;
for (const c of base1) base1Variants += planCardVariants(c).variants.length;
console.log('card_variant rows:', base1Variants);
console.log('STANDARD pairs:', setStandardPairs('base1'), '(v3 predicts 102)');
const cardsWithoutStd = base1.filter(
  (c) => !planCardVariants(c).variants.some((v) => tierDerived(v.facet) === 'standard'),
).length;
console.log('base1 cards with NO standard variant:', cardsWithoutStd, '(expect 0)');

console.log('\n=== base1-5 Clefairy — display names (verify 5/5 forms exist) ===');
const clef = cards.find((c) => c.id === 'base1-5')!;
for (const v of planCardVariants(clef).variants) {
  console.log(
    `  [${v.sortOrder}] ${v.isPrimary ? '*' : ' '} ${v.code}\n       name="${v.displayName}" tier=${tierDerived(v.facet)} tp=${v.tcgplayerProductId} cm=${v.cardmarketProductId} prov=${v.provenance ?? 'NULL'}`,
  );
}

console.log('\n=== sv03.5 (151) summary ===');
const sv = bySet.get('sv03.5') ?? [];
let svVariants = 0;
for (const c of sv) svVariants += planCardVariants(c).variants.length;
console.log('cards:', sv.length, 'card_variant rows:', svVariants, 'standard pairs:', setStandardPairs('sv03.5'));
const svSample = sv[3];
if (svSample) {
  console.log(`sample ${svSample.id} ${svSample.name}:`);
  for (const v of planCardVariants(svSample).variants) {
    console.log(`  [${v.sortOrder}] ${v.isPrimary ? '*' : ' '} "${v.displayName}" tier=${tierDerived(v.facet)} tp=${v.tcgplayerProductId} cm=${v.cardmarketProductId}`);
  }
}
