/**
 * The claude.ai skill DeckPal offers for download (apps/web/public/skill/deckpal-skill.zip, built by
 * scripts/build-skill-pointer.mjs) is a POINTER: it holds no guidance of its own, only where the playbooks are — the
 * `playbook` tool and deckpal.app/skill — so it cannot go stale (the owner, 2026-10-13). The committed zip must be the
 * one the script builds now.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- a plain .mjs build script, imported for its exports
import { SKILL_MD, buildSkillZip } from '../../../../scripts/build-skill-pointer.mjs';
import { allTools } from '../index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('the committed deckpal-skill.zip is the one the script builds (run scripts/build-skill-pointer.mjs)', () => {
  const committed = readFileSync(join(root, 'apps', 'web', 'public', 'skill', 'deckpal-skill.zip'));
  assert.ok(committed.equals(buildSkillZip() as Buffer), 'stale: node scripts/build-skill-pointer.mjs');
});

test('the skill is a pointer: the playbook tool first, the page as the fallback, and no playbook text of its own', () => {
  const md = SKILL_MD as string;
  assert.match(md, /^---\nname: deckpal\ndescription: /);
  assert.match(md, /call DeckPal's `playbook` tool with no name/);
  assert.match(md, /https:\/\/deckpal\.app\/skill/);
  assert.ok(md.length < 1_500, `a pointer, not a playbook (${md.length} chars)`);
  assert.ok(allTools().some((t) => t.name === 'playbook'), 'the tool it points at exists');
});
