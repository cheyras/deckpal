#!/usr/bin/env node
/**
 * catalog-job-summary.mjs — turn a catalog-import summary into a GitHub job
 * summary, and gate the run on the one outcome that leaves manual work behind.
 *
 * Reads the JSON that `apps/sync/src/catalog/cli.ts` writes when
 * `CATALOG_SUMMARY_JSON` is set. It is deliberately a FILE rather than a scrape of
 * the log: the importer prints plenty, and "find the JSON in stdout" works right
 * up until a card name contains a brace.
 *
 * Two modes:
 *   node scripts/catalog-job-summary.mjs           → markdown on stdout
 *   node scripts/catalog-job-summary.mjs --gate    → exit 1 if a rename is outstanding
 *
 * Zero dependencies, so it runs before (or without) a pnpm install.
 *
 * ── Why the gate ────────────────────────────────────────────────────────────
 * Card art is addressed by the set's `tcgdex_id` (AGENTS.md B6). When upstream
 * re-keys a set the importer now re-keys our catalog rows in place — correctly —
 * and in doing so strands every cached image of that set under an address nothing
 * resolves, so ~30 cards per set serve placeholders until someone runs
 * `rekey:set`. That is exactly the user-visible regression of 2026-08-10, and a
 * green run that nobody reads is how it would happen again.
 *
 * The gate therefore fails the JOB, on purpose, AFTER the import has committed:
 * the catalog is already correct, the importer is idempotent (B8) so a re-run is
 * free, and once the re-key is done a re-run detects no rename at all (our id now
 * equals upstream's) and goes green with no override to remember.
 */

import { readFileSync } from 'node:fs';

const gate = process.argv.includes('--gate');
const path = process.env.SUMMARY_JSON ?? process.env.CATALOG_SUMMARY_JSON;

if (!path) {
  process.stderr.write('[catalog-summary] SUMMARY_JSON is not set\n');
  process.exit(gate ? 0 : 1);
}

let s = null;
try {
  s = JSON.parse(readFileSync(path, 'utf-8'));
} catch (err) {
  // The import failed before it could write a summary. The import step has
  // already failed the job; say what is known and do not fail a second time with
  // a less useful message.
  if (!gate) {
    process.stdout.write(
      '## Catalog refresh — no summary written\n\n' +
        'The import did not reach the point where it writes its summary, so it failed ' +
        'outright. **Read the "Extract upstream catalog and import" step.** The two failure ' +
        'modes this job exists to make visible both abort the whole run rather than skip a ' +
        'row:\n\n' +
        '* an upstream **set-id rename** colliding with the `(series_id, slug)` UNIQUE, and\n' +
        '* a **retired-variant `sort_order` collision**, which detonates at COMMIT because ' +
        '`(card_id, sort_order)` is DEFERRABLE INITIALLY DEFERRED.\n\n' +
        'Both are handled by `apps/sync/src/catalog/import.ts` as of `5ce5570`; a fresh one ' +
        'here means a new shape. Nothing was partially applied — the importer rolls back per ' +
        'transaction and is idempotent (B8), so re-running is the supported recovery.\n\n' +
        `_(${(err && err.message) || 'unreadable summary'})_\n`,
    );
  }
  process.exit(gate ? 0 : 0);
}

const renames = Array.isArray(s.renames) ? s.renames : [];
const n = (v) => (typeof v === 'number' ? v : 0);
const delta = (before, after) => {
  const d = n(after) - n(before);
  return `${n(before)} → ${n(after)} (${d >= 0 ? '+' : ''}${d})`;
};

if (gate) {
  if (renames.length === 0) process.exit(0);
  const list = renames.map((r) => `${r.from} → ${r.to}`).join(', ');
  process.stderr.write(
    `::error title=Card art is stranded by a set rename::` +
      `The catalog imported correctly, but ${renames.length} set(s) were re-keyed (${list}) and ` +
      `their cached images still sit under the old address. Run rekey:set for both tiers ` +
      `(see the job summary), then re-run this workflow.\n`,
  );
  process.exit(1);
}

const L = [];
L.push('## Catalog refresh');
L.push('');
L.push('| | |');
L.push('|---|---|');
L.push(`| cards (\`lang='en'\`) | ${delta(s.cardsBefore, s.cardsAfter)} |`);
L.push(`| sets | ${delta(s.setsBefore, s.setsAfter)} |`);
L.push(`| series upserted | ${n(s.series)} |`);
L.push(`| cards processed | ${n(s.cards)} |`);
L.push(`| variants upserted | ${n(s.variants)} (synthesized ${n(s.synthesized)}) |`);
L.push(`| duplicate variants dropped | ${n(s.droppedDuplicates)} |`);
L.push(`| variant kinds | ${n(s.variantKinds)} |`);
L.push(`| **sets re-keyed by upstream** | **${n(s.renamedSets)}** |`);
L.push(`| **cards re-keyed by upstream** | **${n(s.renamedCards)}** |`);
L.push('');

if (renames.length > 0) {
  L.push('### ⚠ Upstream re-keyed a set — its card art is now stranded');
  L.push('');
  L.push(
    'The catalog rows were re-keyed in place and are correct. Cached images are addressed by ' +
      'the set id (AGENTS.md B6), so they are **not**: every card in these sets serves a ' +
      'placeholder until the images are re-addressed. The bytes are already right — this is a ' +
      're-key, not a re-warm, and re-fetching can destroy art whose upstream URL now 404s.',
  );
  L.push('');
  for (const r of renames) L.push(`* \`${r.from}\` → \`${r.to}\` — ${r.name}`);
  L.push('');
  L.push('```bash');
  L.push('# disk tier (self-host cache, PG* → that box\'s database)');
  for (const r of renames) {
    L.push(`pnpm --filter deckpal-images rekey:set --rename ${r.from}:${r.to}`);
  }
  L.push('');
  L.push('# object tier (Supabase Storage, .env.cloud loaded)');
  for (const r of renames) {
    L.push(`pnpm --filter deckpal-images rekey:set --object-store --rename ${r.from}:${r.to}`);
  }
  L.push('');
  L.push('# then, both tiers:');
  L.push('pnpm --filter deckpal-images manifest:check');
  L.push('pnpm --filter deckpal-images manifest:check --object-store');
  L.push('```');
  L.push('');
  L.push('**This run is marked failed for that reason alone.** Re-run it after the re-key: the ');
  L.push('importer is idempotent (B8) and will report no rename the second time.');
} else {
  L.push('No set renames — no image work outstanding.');
}

L.push('');
L.push(
  '_Re-running this workflow is always safe: every importer statement is `ON CONFLICT DO ' +
    'UPDATE`, batched and resumable, and no user-owned row is ever deleted (AGENTS.md B8)._',
);
process.stdout.write(L.join('\n') + '\n');
