/**
 * Test-strength gate for a batch of card scripts: each card's tests must FAIL when its script is
 * switched off (SIM_DISABLE_SCRIPTS, read by registry.ts). A card whose tests still pass without its
 * script is unprotected: the tests don't check what the card does.
 *   node --import tsx scripts/mutation-check.ts <lane script module> <lane test file>
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CardScript } from '../src/dsl.js';
import '../src/cards/scripts/index.js'; // load the registry's index first: a lane module imported alone is a circular import

const [modPath, testPath] = process.argv.slice(2);
const mod = (await import(pathToFileURL(resolve(modPath!)).href)) as Record<string, unknown>;
const scripts = Object.values(mod).find((v) => Array.isArray(v)) as CardScript[];
const run = (disable: string) =>
  spawnSync(process.execPath, ['--import', 'tsx', '--test', testPath!], { env: { ...process.env, SIM_DISABLE_SCRIPTS: disable }, encoding: 'utf8' });
const base = run('');
if (base.status !== 0) {
  console.log('the test file fails even with every script on; fix that first');
  process.exit(1);
}
const unprotected: string[] = [];
for (const s of scripts) {
  if (run(s.id).status === 0) unprotected.push(`${s.id} ${s.name}`);
}
console.log(`${scripts.length - unprotected.length}/${scripts.length} cards protected (their tests fail without the script)`);
for (const u of unprotected) console.log('UNPROTECTED', u);
process.exitCode = unprotected.length ? 1 : 0;
