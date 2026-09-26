#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { decisionFile, decisions, metadata, parseDecisionFile, root, slug, splitLegacy } from './decisions-lib.mjs';

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
  const historic = all();
  // An appended H2 often adds a blank separator to the preceding entry.
  // Ignore that boundary whitespace while recognizing a historical body.
  const knownBodies = new Set(historic.map(item => item.body.trimEnd()));
  const knownHeadings = new Set(historic.map(item => `${item.meta.date}\n${item.meta.title}`));
  const sourceBlocks = splitLegacy(source);
  const appended = sourceBlocks.filter(block => block.kind === 'entry' && !knownBodies.has(block.body.trimEnd()));
  const edited = appended.filter(block => knownHeadings.has(`${block.date}\n${block.title}`));
  if (edited.length) fail(`The branch also edits existing decisions; review these manually:\n${edited.map(block => `${block.date} ${block.title}`).join('\n')}`);
  const baseHeadings = new Set(splitLegacy(base).filter(block => block.kind === 'entry').map(block => `${block.date}\n${block.title}`));
  const branchHeadings = new Set(sourceBlocks.filter(block => block.kind === 'entry').map(block => `${block.date}\n${block.title}`));
  if ([...baseHeadings].some(heading => !branchHeadings.has(heading))) fail('The branch removed an existing decision; review its diff manually');
  if (headSource && sourceRef !== 'HEAD') {
    const adoptedHeadings = new Set(appended.map(block => `${block.date}\n${block.title}`));
    const extra = splitLegacy(headSource).filter(block => block.kind === 'entry' &&
      !knownHeadings.has(`${block.date}\n${block.title}`) && !adoptedHeadings.has(`${block.date}\n${block.title}`));
    if (extra.length) fail(`The branch added decisions after merging main; review these manually:\n${extra.map(block => block.title).join('\n')}`);
  }
  if (output === root && !sourceFile && (sourceRef === 'HEAD' || headSource)) {
    const working = readFileSync(join(root, 'DECISIONS.md'), 'utf8');
    const merging = git('ls-files', '-u', '--', 'DECISIONS.md').trim().length > 0;
    if (working !== (headSource ?? source) && working !== targetGuide && !merging) {
      fail('DECISIONS.md has uncommitted edits; save them first');
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
    console.log('Restored DECISIONS.md to the main guide. Stage it and the new files, then complete the merge or commit.');
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
    const date = flag('--date', new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
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
