import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decisions, root, sha256, slug, splitLegacy } from './decisions-lib.mjs';

const guide = readFileSync(join(root, 'DECISIONS.md'), 'utf8');
if (/^## \d{4}-\d{2}-\d{2} (?:—|--) /m.test(guide)) {
  throw new Error('Add decisions under decisions/YYYY/, not to DECISIONS.md. Run pnpm decisions new "Title".');
}
const manifest = JSON.parse(readFileSync(join(root, 'decisions/history.json'), 'utf8'));
const allDecisions = decisions();
const decisionsByPath = new Map(allDecisions.map(item => [item.path, item]));
const original = manifest.blocks.map(block => {
  const content = readFileSync(join(root, block.path), 'utf8');
  const body = block.kind === 'entry' ? decisionsByPath.get(block.path)?.body : content;
  if (body === undefined) throw new Error(`Missing historical entry: ${block.path}`);
  if (Buffer.byteLength(body) !== block.bytes || sha256(body) !== block.sha256) {
    throw new Error(`Historical body changed: ${block.path}`);
  }
  return body;
});
const reconstructed = original.join('');
if (sha256(reconstructed) !== manifest.source_sha256) throw new Error('Original Decision Log does not round-trip byte for byte');
const sourceCommit = spawnSync('git', ['show', `${manifest.source_commit}:DECISIONS.md`],
  { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (sourceCommit.status === 0 && sourceCommit.stdout !== reconstructed) {
  throw new Error('Reconstructed log differs from the original Git commit');
}
const parsed = splitLegacy(reconstructed);
if (parsed.length !== manifest.blocks.length) throw new Error('Historical block count changed');
for (let index = 0; index < parsed.length; index++) {
  if (parsed[index].kind !== manifest.blocks[index].kind) throw new Error(`Historical block ${index} changed kind`);
}
for (const item of allDecisions) {
  const stem = `decisions/${item.meta.date.slice(0, 4)}/${item.meta.date}-${slug(item.meta.title)}`;
  if (item.path !== `${stem}.md` && !new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[2-9][0-9]*\\.md$`).test(item.path)) {
    throw new Error(`${item.path}: path does not match date and title`);
  }
  if (!item.meta.areas.length || item.meta.areas.some(area => typeof area !== 'string' || !area)) {
    throw new Error(`${item.path}: areas must contain at least one name`);
  }
  if (item.body.includes('**Decision:** TODO') || item.body.includes('**Why:** TODO') || item.body.includes('**Implications:** TODO')) {
    throw new Error(`${item.path}: finish the decision template before committing`);
  }
}
console.log(`Verified ${manifest.blocks.filter(block => block.kind === 'entry').length} historical entries, ` +
  `${allDecisions.length - manifest.blocks.filter(block => block.kind === 'entry').length} new entries, and byte-for-byte legacy round trip` +
  `${sourceCommit.status === 0 ? ' against the original Git commit' : ' against the recorded SHA-256'}.`);
