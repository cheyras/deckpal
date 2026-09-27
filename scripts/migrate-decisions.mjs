import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { decisionFile, metadata, root, sha256, slug, splitLegacy } from './decisions-lib.mjs';

const sourceRef = process.argv[2] || 'HEAD';
const source = execFileSync('git', ['show', `${sourceRef}:DECISIONS.md`],
  { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (!source.startsWith('# DeckPal — Decision Log\n')) throw new Error('Expected the original Decision Log');
const blocks = splitLegacy(source);
const sourceCommit = execFileSync('git', ['rev-parse', sourceRef], { cwd: root, encoding: 'utf8' }).trim();
const explicitSupersedes = new Map([
  ['Never run the self-hosted TCGdex API', ['BRIEF §3a local TCGdex API container']],
  ['Stack: match the box, not the brief', ['BRIEF Python 3.11 + FastAPI and docker-compose.arm64.yml deliverable']],
  ['Layer only the sheen scaffolding, not all of premium.css', ['2026-08-16 move premium.css into @layer components suggestion']],
  ['TCGplayer Mass Entry: product ids, because names are not unique and one miss voids the cart', ['2026-08-16 NUMBERED_GROUP_IDS entry']],
]);
const used = new Set();
const manifest = { source_commit: sourceCommit, source_sha256: sha256(source), blocks: [] };
let noteNumber = 0;
for (const block of blocks) {
  let path;
  if (block.kind === 'preamble') path = 'decisions/legacy/preamble.md';
  else if (block.kind === 'note') path = `decisions/legacy/${String(++noteNumber).padStart(2, '0')}-${slug(block.title)}.md`;
  else {
    const stem = `decisions/${block.date.slice(0, 4)}/${block.date}-${slug(block.title)}`;
    path = `${stem}.md`;
    for (let suffix = 2; used.has(path); suffix++) path = `${stem}-${suffix}.md`;
  }
  if (used.has(path)) throw new Error(`Duplicate path ${path}`);
  used.add(path);
  mkdirSync(join(root, path, '..'), { recursive: true });
  let content = block.body;
  if (block.kind === 'entry') {
    const supersedes = explicitSupersedes.get(block.title) ||
      (block.body.includes('**Supersedes** the assumption in `roadmap/plans/foil-main.md`')
        ? ['roadmap/plans/foil-main.md reverse holo frame-only assumption'] : []);
    content = decisionFile(metadata(block, { supersedes }), block.body);
  }
  writeFileSync(join(root, path), content, { flag: 'wx' });
  manifest.blocks.push({ kind: block.kind, path, bytes: Buffer.byteLength(block.body), sha256: sha256(block.body),
    ...(block.kind === 'entry' ? { date: block.date, title: block.title } : {}) });
}
writeFileSync(join(root, 'decisions/history.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
const rows = manifest.blocks.filter(block => block.kind === 'entry')
  .map(block => `| ${block.date} | [${block.title.replaceAll('|', '\\|')}](../${block.path}) |`);
writeFileSync(join(root, 'decisions/INDEX.md'), `# Historical decision index\n\n` +
  `Citations such as \`DECISIONS.md 2026-08-10\` refer to this log. Dates may have several decisions; find the title below. ` +
  `The original document is preserved byte for byte by the files and manifest in this folder. ` +
  `See [the guide](../DECISIONS.md) for current usage.\n\n| Date | Decision |\n|---|---|\n${rows.join('\n')}\n`, { flag: 'wx' });
console.log(`Migrated ${rows.length} dated entries and ${noteNumber} undated sections; full source SHA-256 ${manifest.source_sha256}`);
