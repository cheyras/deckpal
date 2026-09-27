import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decisionFile, metadata, parseDecisionFile, splitLegacy } from '../decisions-lib.mjs';

const cli = fileURLToPath(new URL('../decisions.mjs', import.meta.url));
const run = (repo, command, args = []) => execFileSync(command, args, { cwd: repo, encoding: 'utf8',
  env: { ...process.env, DECKPAL_DECISIONS_ROOT: repo }, stdio: ['ignore', 'pipe', 'pipe'] });

test('the splitter preserves decorated and undated historical sections exactly', () => {
  const source = '# Preamble\n\n---\n\n## 2026-01-01 — First\nbody\n\n## Phase 2 progress\nnotes\n' +
    '## 2026-01-02 -- Second\nlast line\n';
  const blocks = splitLegacy(source);
  assert.deepEqual(blocks.map(block => block.kind), ['preamble', 'entry', 'note', 'entry']);
  assert.equal(blocks.map(block => block.body).join(''), source);
  const file = decisionFile(metadata(blocks[1]), blocks[1].body);
  assert.equal(parseDecisionFile(file).body, blocks[1].body);
});

function branchFixture(otherConflict = false) {
  const repo = mkdtempSync(join(tmpdir(), 'deckpal-decisions-test-'));
  run(repo, 'git', ['init', '-q', '-b', 'main']);
  run(repo, 'git', ['config', 'user.name', 'Test']);
  run(repo, 'git', ['config', 'user.email', 'test@example.invalid']);
  const old = '# DeckPal — Decision Log\n\n## 2026-01-01 — Original\n**Decided by:** Chey\n\n**Decision:** First.\n';
  const added = '\n## 2026-01-02 — Branch decision\n**Decided by:** Chey\n\n**Decision:** Second.\n';
  writeFileSync(join(repo, '.gitattributes'), 'DECISIONS.md merge=union\n');
  writeFileSync(join(repo, 'DECISIONS.md'), old);
  if (otherConflict) writeFileSync(join(repo, 'code.txt'), 'baseline\n');
  run(repo, 'git', ['add', '.']);
  run(repo, 'git', ['commit', '-qm', 'baseline']);
  run(repo, 'git', ['branch', 'feature']);
  const guide = '# DeckPal decisions\n\nUse decision files.\n';
  writeFileSync(join(repo, 'DECISIONS.md'), guide);
  const original = splitLegacy(old)[1];
  mkdirSync(join(repo, 'decisions/2026'), { recursive: true });
  writeFileSync(join(repo, 'decisions/2026/2026-01-01-original.md'), decisionFile(metadata(original), original.body));
  if (otherConflict) writeFileSync(join(repo, 'code.txt'), 'main change\n');
  run(repo, 'git', ['add', '.']);
  run(repo, 'git', ['commit', '-qm', 'migrate']);
  run(repo, 'git', ['checkout', '-q', 'feature']);
  writeFileSync(join(repo, 'DECISIONS.md'), old + added);
  if (otherConflict) writeFileSync(join(repo, 'code.txt'), 'branch change\n');
  run(repo, 'git', ['add', '.']);
  run(repo, 'git', ['commit', '-qm', 'append']);
  if (otherConflict) assert.throws(() => run(repo, 'git', ['merge', '-q', 'main']));
  else run(repo, 'git', ['merge', '-q', 'main']);
  return { repo, guide, added };
}

test('adopt-branch recovers a real union-merge shape and is safe to run twice', () => {
  const { repo, guide, added } = branchFixture();
  const first = run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']);
  assert.match(first, /1 new, 0 already present/);
  assert.equal(readFileSync(join(repo, 'DECISIONS.md'), 'utf8'), guide);
  const files = readdirSync(join(repo, 'decisions/2026'));
  assert.equal(files.length, 2);
  const adopted = files.find(file => file.includes('branch-decision'));
  assert.equal(parseDecisionFile(readFileSync(join(repo, 'decisions/2026', adopted), 'utf8')).body, added.trimStart());
  const second = run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']);
  assert.match(second, /Adopted 0 entries \(0 new, 0 already present\)/);
  assert.equal(readFileSync(join(repo, 'DECISIONS.md'), 'utf8'), guide);
});

test('adopt-branch refuses corrections made after the main merge', () => {
  const { repo } = branchFixture();
  const path = join(repo, 'DECISIONS.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('**Decision:** Second.', '**Decision:** Corrected after merge.'));
  run(repo, 'git', ['add', 'DECISIONS.md']);
  run(repo, 'git', ['commit', '-qm', 'correct decision']);
  assert.throws(() => run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']),
    /DECISIONS.md changed after merging main/);
  assert.match(readFileSync(path, 'utf8'), /Corrected after merge/);
  assert.equal(readdirSync(join(repo, 'decisions/2026')).length, 1);
});

test('adopt-branch works while another file is conflicted', () => {
  const { repo, guide } = branchFixture(true);
  assert.match(run(repo, 'git', ['diff', '--name-only', '--diff-filter=U']), /code\.txt/);
  const result = run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']);
  assert.match(result, /1 new, 0 already present/);
  assert.equal(readFileSync(join(repo, 'DECISIONS.md'), 'utf8'), guide);
  assert.equal(readdirSync(join(repo, 'decisions/2026')).length, 2);
  assert.match(run(repo, 'git', ['diff', '--name-only', '--diff-filter=U']), /code\.txt/);
});
