import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decisionDate, decisionFile, metadata, parseDecisionFile, sha256, splitLegacy } from '../decisions-lib.mjs';

const cli = fileURLToPath(new URL('../decisions.mjs', import.meta.url));
const checker = fileURLToPath(new URL('../check-decisions.mjs', import.meta.url));
const run = (repo, command, args = []) => execFileSync(command, args, { cwd: repo, encoding: 'utf8',
  env: { ...process.env, DECKPAL_DECISIONS_ROOT: repo, GIT_EDITOR: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });

test('the splitter preserves decorated and undated historical sections exactly', () => {
  const source = '# Preamble\n\n---\n\n## 2026-01-01 — First\nbody\n\n## Phase 2 progress\nnotes\n' +
    '## 2026-01-02 -- Second\nlast line\n';
  const blocks = splitLegacy(source);
  assert.deepEqual(blocks.map(block => block.kind), ['preamble', 'entry', 'note', 'entry']);
  assert.equal(blocks.map(block => block.body).join(''), source);
  const file = decisionFile(metadata(blocks[1]), blocks[1].body);
  assert.equal(parseDecisionFile(file).body, blocks[1].body);
});

test('a date remains on the Denver day across midnight UTC', () => {
  assert.equal(decisionDate(new Date('2026-09-27T00:06:00Z')), '2026-09-26');
});

test('the archive check rejects a decision hidden behind a malformed filename', () => {
  const repo = mkdtempSync(join(tmpdir(), 'deckpal-decisions-test-'));
  mkdirSync(join(repo, 'decisions/2026'), { recursive: true });
  mkdirSync(join(repo, 'decisions/legacy'));
  writeFileSync(join(repo, 'DECISIONS.md'), '# DeckPal decisions\n');
  writeFileSync(join(repo, 'decisions/legacy/preamble.md'), '');
  writeFileSync(join(repo, 'decisions/history.json'), JSON.stringify({
    source_commit: 'missing', source_sha256: sha256(''),
    blocks: [{ kind: 'preamble', path: 'decisions/legacy/preamble.md', bytes: 0, sha256: sha256('') }],
  }));
  const body = '## 2026-09-26 — Misnamed\n**Decision:** Check the filename.\n';
  writeFileSync(join(repo, 'decisions/2026/2026-9-26-misnamed.md'), decisionFile(metadata({
    date: '2026-09-26', title: 'Misnamed', body,
  }), body));
  assert.throws(() => run(repo, process.execPath, [checker]), /path does not match date and title/);
});

function branchFixture(otherConflict = false, mainCorrection = false, extraNote = false, firstMerge = false) {
  const repo = mkdtempSync(join(tmpdir(), 'deckpal-decisions-test-'));
  run(repo, 'git', ['init', '-q', '-b', 'main']);
  run(repo, 'git', ['config', 'user.name', 'Test']);
  run(repo, 'git', ['config', 'user.email', 'test@example.invalid']);
  const old = '# DeckPal — Decision Log\n\n## 2026-01-01 — Original\n**Decided by:** Chey\n\n**Decision:** First.\n';
  const added = '\n## 2026-01-02 — Branch decision\n**Decided by:** Chey\n\n**Decision:** Second.\n' +
    (extraNote ? '\n## Verification\nThis must survive conversion.\n' : '');
  if (!firstMerge) writeFileSync(join(repo, '.gitattributes'), 'DECISIONS.md merge=union\n');
  writeFileSync(join(repo, 'DECISIONS.md'), old);
  if (otherConflict) writeFileSync(join(repo, 'code.txt'), 'baseline\n');
  run(repo, 'git', ['add', '.']);
  run(repo, 'git', ['commit', '-qm', 'baseline']);
  run(repo, 'git', ['branch', 'feature']);
  const guide = '# DeckPal decisions\n\nUse decision files.\n';
  writeFileSync(join(repo, 'DECISIONS.md'), guide);
  if (firstMerge) writeFileSync(join(repo, '.gitattributes'), 'DECISIONS.md merge=union\n');
  const original = splitLegacy(old)[1];
  mkdirSync(join(repo, 'decisions/2026'), { recursive: true });
  writeFileSync(join(repo, 'decisions/2026/2026-01-01-original.md'), decisionFile(metadata(original),
    mainCorrection ? original.body.replace('**Decision:** First.', '**Decision:** Corrected by main.') : original.body));
  if (otherConflict) writeFileSync(join(repo, 'code.txt'), 'main change\n');
  run(repo, 'git', ['add', '.']);
  run(repo, 'git', ['commit', '-qm', 'migrate']);
  run(repo, 'git', ['checkout', '-q', 'feature']);
  writeFileSync(join(repo, 'DECISIONS.md'), old + added);
  if (otherConflict) writeFileSync(join(repo, 'code.txt'), 'branch change\n');
  run(repo, 'git', ['add', '.']);
  run(repo, 'git', ['commit', '-qm', 'append']);
  if (otherConflict || firstMerge) assert.throws(() => run(repo, 'git', ['merge', '-q', 'main']));
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

test('adopt-branch resolves the first merge before the branch has the union attribute', () => {
  const { repo, guide, added } = branchFixture(false, false, false, true);
  assert.match(run(repo, 'git', ['ls-files', '-u', '--', 'DECISIONS.md']), /\tDECISIONS\.md/);
  assert.match(readFileSync(join(repo, 'DECISIONS.md'), 'utf8'), /<<<<<<< HEAD/);
  const result = run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']);
  assert.match(result, /git add DECISIONS\.md decisions\//);
  assert.match(result, /git merge --continue/);
  assert.match(result, /1 new, 0 already present/);
  assert.equal(readFileSync(join(repo, 'DECISIONS.md'), 'utf8'), guide);
  const adopted = readdirSync(join(repo, 'decisions/2026')).find(file => file.includes('branch-decision'));
  assert.equal(parseDecisionFile(readFileSync(join(repo, 'decisions/2026', adopted), 'utf8')).body, added.trimStart());
  run(repo, 'git', ['add', 'DECISIONS.md', 'decisions/']);
  run(repo, 'git', ['merge', '--continue']);
  assert.equal(run(repo, 'git', ['ls-files', '-u', '--', 'DECISIONS.md']), '');
  const second = run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']);
  assert.match(second, /Adopted 0 entries \(0 new, 0 already present\)/);
});

test('adopt-branch refuses edited conflict markers without writing files', () => {
  const { repo } = branchFixture(false, false, false, true);
  const path = join(repo, 'DECISIONS.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('**Decision:** Second.', '**Decision:** Hand edited.'));
  assert.throws(() => run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']),
    /differs from Git's original conflict markers/);
  assert.equal(readdirSync(join(repo, 'decisions/2026')).length, 1);
  assert.match(readFileSync(path, 'utf8'), /Hand edited/);
});

test('adopt-branch refuses a first-merge conflict that changes an old decision', () => {
  const { repo } = branchFixture(false, false, false, true);
  run(repo, 'git', ['merge', '--abort']);
  const path = join(repo, 'DECISIONS.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('**Decision:** First.', '**Decision:** Branch correction.'));
  run(repo, 'git', ['add', 'DECISIONS.md']);
  run(repo, 'git', ['commit', '-qm', 'correct old decision']);
  assert.throws(() => run(repo, 'git', ['merge', '-q', 'main']));
  assert.throws(() => run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']),
    /edits existing decisions/);
  assert.equal(readdirSync(join(repo, 'decisions/2026')).length, 1);
  assert.match(readFileSync(path, 'utf8'), /Branch correction/);
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

test('adopt-branch keeps a correction made only on main', () => {
  const { repo } = branchFixture(false, true);
  const result = run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']);
  assert.match(result, /1 new, 0 already present/);
  const mainFile = readFileSync(join(repo, 'decisions/2026/2026-01-01-original.md'), 'utf8');
  assert.match(parseDecisionFile(mainFile).body, /Corrected by main/);
});

test('adopt-branch refuses an appended undated section', () => {
  const { repo } = branchFixture(false, false, true);
  assert.throws(() => run(repo, process.execPath, [cli, 'adopt-branch', '--base-ref', 'main']),
    /edits an undated section/);
  assert.equal(readdirSync(join(repo, 'decisions/2026')).length, 1);
});
