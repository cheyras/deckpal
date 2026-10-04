#!/usr/bin/env node
/**
 * Download the card art the landing-photo specs composite, into
 * .marketing-raw/landing/cards/ (gitignored). The list is read from
 * tools/landing-photos/specs/*.json, so it cannot drift from the specs.
 *
 *   node tools/landing-photos/fetch-art.mjs [--force]
 *
 * Source: DeckPal's own image store, the same URL the app uses,
 *   https://deckpal.app/deckpal/images/en/<serie>/<set>/<localId>/high.webp
 * which 302s to the public Supabase bucket (600x825 WebP with alpha corners).
 * <serie> is the set id's letter prefix (me05 -> me, sv08.5 -> sv), except
 * the Mega Evolution energy set `mee`, which lives under `me`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, '.marketing-raw', 'landing', 'cards');
const force = process.argv.includes('--force');

const ids = new Set();
for (const f of fs.readdirSync(path.join(HERE, 'specs')).filter((f) => f.endsWith('.json'))) {
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'specs', f), 'utf8'));
  for (const c of spec.cards ?? []) ids.add(path.basename(c.art, '.webp'));
}

function artUrl(id) {
  const i = id.lastIndexOf('-');
  const set = id.slice(0, i);
  const localId = id.slice(i + 1);
  let serie = set.match(/^[a-z]+/)[0];
  if (serie === 'mee') serie = 'me';
  return `https://deckpal.app/deckpal/images/en/${serie}/${set}/${localId}/high.webp`;
}

fs.mkdirSync(OUT, { recursive: true });
let fetched = 0;
for (const id of [...ids].sort()) {
  const file = path.join(OUT, `${id}.webp`);
  if (!force && fs.existsSync(file)) continue;
  const res = await fetch(artUrl(id));
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} from ${artUrl(id)}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched++;
  console.log(`${id}  ${artUrl(id)}`);
}
console.log(`${ids.size} cards referenced, ${fetched} downloaded, ${ids.size - fetched} already present.`);
