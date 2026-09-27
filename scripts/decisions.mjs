#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { decisionDate, decisionFile, decisions, metadata, parseDecisionFile, root, slug, splitLegacy } from './decisions-lib.mjs';

const [command, ...args] = process.argv.slice(2);
const usage = `Usage: pnpm decisions <list [--area name] [--year YYYY] | recent [count] | search words... | show date-or-path | new "Title" [--date YYYY-MM-DD] [--by name] [--area name] | adopt-branch [--source-ref ref] [--base-ref ref] [--source-file path] [--output-dir path]>`;
const fail = message => { throw new Error(`${message}\n${usage}`); };
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) fail(`${name} needs a value`);
  return args[index + 1];
};
const display = item => `${item.meta.date}  ${item.meta.title}  (${item.path})`;
const all = () => decisions().sort((a, b) => b.meta.date.localeCompare(a.meta.date) || a.path.localeCompare(b.path));
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

function unionResult(ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), 'deckpal-decision-merge-'));
  try {
    const paths = ['ours', 'base', 'theirs'].map(name => join(dir, name));
    for (const [index, content] of [ours, base, theirs].entries()) writeFileSync(paths[index], content);
    return execFileSync('git', ['merge-file', '--union', '-p', ...paths],
      { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function uniquePath(base, block) {
  const stem = `decisions/${block.date.slice(0, 4)}/${block.date}-${slug(block.title)}`;
  for (let suffix = 1; ; suffix++) {
    const path = `${stem}${suffix === 1 ? '' : `-${suffix}`}.md`;
    const absolute = join(base, path);
    if (!existsSync(absolute)) return { path, exists: false };
    if (parseDecisionFile(readFileSync(absolute, 'utf8'), path).body === block.body) return { path, exists: true };
  }
}

function adoptBranch() {
  let sourceRef = flag('--source-ref', 'HEAD');
  const baseRef = flag('--base-ref', 'origin/main');
  const sourceFile = flag('--source-file', null);
  const output = resolve(flag('--output-dir', root));
  const unmerged = git('ls-files', '-u', '--', 'DECISIONS.md').trim();
  let conflicted = false;
  if (unmerged) {
    if (sourceRef !== 'HEAD' || sourceFile || output !== root) {
      fail('DECISIONS.md is conflicted. Run pnpm decisions adopt-branch in this branch without --source-ref, --source-file, or --output-dir.');
    }
    const stages = unmerged.split('\n').map(line => Number(line.match(/\s([123])\tDECISIONS\.md$/)?.[1]));
    if (stages.join(',') !== '1,2,3') {
      fail('DECISIONS.md has unexpected Git index stages. Inspect git ls-files -u -- DECISIONS.md; preserve any new decisions as files, restore the guide, then run git add DECISIONS.md decisions/ and git merge --continue.');
    }
    conflicted = true;
  }
  const headSource = !sourceFile && sourceRef === 'HEAD' ? git('show', 'HEAD:DECISIONS.md') : null;
  if (headSource && !headSource.startsWith('# DeckPal — Decision Log\n')) {
    // A union merge can insert the short guide inside the final legacy entry.
    // Read the branch's first-parent version before that merge, not the damaged
    // merge result. Never silently drop a later decision added after the merge.
    for (const commit of git('rev-list', '--first-parent', 'HEAD').trim().split('\n').slice(1, 100)) {
      const candidate = git('show', `${commit}:DECISIONS.md`);
      if (candidate.startsWith('# DeckPal — Decision Log\n')) { sourceRef = commit; break; }
    }
  }
  const ancestor = git('merge-base', sourceRef, baseRef).trim();
  const base = git('show', `${ancestor}:DECISIONS.md`);
  const targetGuide = git('show', `${baseRef}:DECISIONS.md`);
  const source = sourceFile ? readFileSync(resolve(sourceFile), 'utf8') : git('show', `${sourceRef}:DECISIONS.md`);
  if (conflicted) {
    const [stageBase, stageOurs, stageTheirs] = [1, 2, 3].map(stage => git('show', `:${stage}:DECISIONS.md`));
    if (stageBase !== base || stageOurs !== source || stageTheirs !== targetGuide ||
        !stageBase.startsWith('# DeckPal — Decision Log\n') || !stageOurs.startsWith('# DeckPal — Decision Log\n') ||
        !stageTheirs.startsWith('# DeckPal decisions\n')) {
      fail('DECISIONS.md is not the expected old-log-versus-guide merge. Inspect git show :1:DECISIONS.md, :2:DECISIONS.md, and :3:DECISIONS.md; preserve any new decisions as files, restore the guide, then run git add DECISIONS.md decisions/ and git merge --continue. No decision files were written.');
    }
    let generated;
    try { generated = git('show', 'AUTO_MERGE:DECISIONS.md'); }
    catch { fail('Git has no AUTO_MERGE copy of DECISIONS.md to verify the untouched conflict. Preserve any new decisions as files, restore the guide, then run git add DECISIONS.md decisions/ and git merge --continue. No decision files were written.'); }
    if (readFileSync(join(root, 'DECISIONS.md'), 'utf8') !== generated) {
      fail('DECISIONS.md differs from Git\'s original conflict markers. Review those edits, preserve any new decisions as files, restore the guide, then run git add DECISIONS.md decisions/ and git merge --continue. No decision files were written.');
    }
  }
  const expectedUnion = headSource ? unionResult(source, base, targetGuide) : null;
  if (headSource && sourceRef !== 'HEAD' && headSource !== expectedUnion && headSource !== targetGuide) {
    fail('DECISIONS.md changed after merging main; review those corrections before adoption');
  }
  const historic = all();
  // An appended H2 often adds a blank separator to the preceding entry.
  // Ignore that boundary whitespace while recognizing a historical body.
  const knownBodies = new Set(historic.map(item => item.body.trimEnd()));
  const knownHeadings = new Set(historic.map(item => `${item.meta.date}\n${item.meta.title}`));
  const sourceBlocks = splitLegacy(source);
  const baseBlocks = splitLegacy(base);
  if (source.startsWith('# DeckPal — Decision Log\n')) {
    const sourceNotes = sourceBlocks.filter(block => block.kind !== 'entry');
    const baseNotes = baseBlocks.filter(block => block.kind !== 'entry');
    if (sourceNotes.length !== baseNotes.length || sourceNotes.some((block, index) =>
      block.title !== baseNotes[index].title || block.body.trimEnd() !== baseNotes[index].body.trimEnd())) {
      fail('The branch edits an undated section of the old log; review that edit manually');
    }
  }
  const baseEntries = new Map(baseBlocks.filter(block => block.kind === 'entry')
    .map(block => [`${block.date}\n${block.title}`, block.body.trimEnd()]));
  const appended = sourceBlocks.filter(block => block.kind === 'entry' &&
    !knownBodies.has(block.body.trimEnd()) &&
    baseEntries.get(`${block.date}\n${block.title}`) !== block.body.trimEnd());
  const edited = appended.filter(block => knownHeadings.has(`${block.date}\n${block.title}`));
  if (edited.length) fail(`The branch also edits existing decisions; review these manually:\n${edited.map(block => `${block.date} ${block.title}`).join('\n')}`);
  const baseHeadings = new Set(baseEntries.keys());
  const branchHeadings = new Set(sourceBlocks.filter(block => block.kind === 'entry').map(block => `${block.date}\n${block.title}`));
  if ([...baseHeadings].some(heading => !branchHeadings.has(heading))) fail('The branch removed an existing decision; review its diff manually');
  if (output === root && !sourceFile && (sourceRef === 'HEAD' || headSource)) {
    const working = readFileSync(join(root, 'DECISIONS.md'), 'utf8');
    if (!conflicted && working !== (headSource ?? source) && working !== targetGuide && working !== expectedUnion) {
      fail('DECISIONS.md has edits beyond the automatic merge; resolve it to the main guide or save those edits first');
    }
  }
  let created = 0;
  for (const block of appended) {
    const chosen = uniquePath(output, block);
    if (chosen.exists) continue;
    const path = join(output, chosen.path);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, decisionFile(metadata(block), block.body), { flag: 'wx' });
    created++;
    console.log(`Created ${relative(output, path)}`);
  }
  if (output === root && !sourceFile && headSource && readFileSync(join(root, 'DECISIONS.md'), 'utf8') !== targetGuide) {
    writeFileSync(join(root, 'DECISIONS.md'), targetGuide);
    console.log('Restored DECISIONS.md to the main guide. Run git add DECISIONS.md decisions/, resolve any other conflicts, then run git merge --continue (or commit if no merge is active).');
  }
  console.log(`Adopted ${appended.length} entries (${created} new, ${appended.length - created} already present).`);
}

switch (command) {
  case 'list': {
    const area = flag('--area', null);
    const year = flag('--year', null);
    for (const item of all().filter(item => (!area || item.meta.areas.includes(area)) && (!year || item.meta.date.startsWith(year)))) {
      console.log(display(item));
    }
    break;
  }
  case 'recent': {
    const count = args[0] === undefined ? 10 : Number(args[0]);
    if (!Number.isSafeInteger(count) || count < 1) fail('Count must be a positive integer');
    for (const item of all().slice(0, count)) console.log(display(item));
    break;
  }
  case 'search': {
    if (!args.length) fail('Give one or more search terms');
    const query = args.join(' ').toLowerCase();
    for (const item of all().filter(item => `${item.meta.title}\n${item.body}\n${item.meta.areas.join(' ')}`.toLowerCase().includes(query))) {
      console.log(display(item));
    }
    break;
  }
  case 'show': {
    if (args.length !== 1) fail('Give one date, title fragment, or path');
    const matches = all().filter(item => item.path === args[0] || item.meta.date === args[0] ||
      item.meta.title.toLowerCase().includes(args[0].toLowerCase()));
    if (!matches.length) fail(`No decision matches ${args[0]}`);
    if (matches.length > 1) fail(`More than one decision matches:\n${matches.map(display).join('\n')}`);
    process.stdout.write(matches[0].body);
    break;
  }
  case 'new': {
    const title = args[0];
    if (!title || title.startsWith('--')) fail('Give a title in quotes');
    const date = flag('--date', decisionDate());
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
      fail('Use a valid YYYY-MM-DD date');
    }
    const by = flag('--by', 'Chey (via Codex)');
    const area = flag('--area', null);
    const path = join(root, `decisions/${date.slice(0, 4)}/${date}-${slug(title)}.md`);
    mkdirSync(join(path, '..'), { recursive: true });
    const body = `## ${date} — ${title}\n**Decided by:** ${by}\n\n**Decision:** TODO\n\n**Why:** TODO\n\n**Implications:** TODO\n`;
    writeFileSync(path, decisionFile(metadata({ date, title, body }, { areas: area ? [area] : [] }), body), { flag: 'wx' });
    console.log(relative(root, path));
    break;
  }
  case 'adopt-branch': adoptBranch(); break;
  default: fail(command ? `Unknown command: ${command}` : 'Choose a command');
}
