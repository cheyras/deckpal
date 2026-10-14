#!/usr/bin/env node
/**
 * Builds apps/web/public/skill/deckpal-skill.zip: the claude.ai skill that points at DeckPal's hosted playbooks.
 *
 * The owner, 2026-10-13: host the skill at deckpal.app/skill as one source of truth, and make the copy saved in
 * claude.ai only a pointer. So this skill carries no instructions of its own: it tells Claude to open DeckPal's
 * `playbook` tool (and, without it, the page), which always match the DeckPal Claude is connected to. A skill that
 * held the guides would go stale the day DeckPal changed.
 *
 *   node scripts/build-skill-pointer.mjs          write the zip
 *   node scripts/build-skill-pointer.mjs --check  exit 1 when the committed zip is stale (run by a test)
 *
 * The zip is written by hand (stored, not deflated) with fixed timestamps, so the bytes depend on the text alone and
 * the check can compare them.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps', 'web', 'public', 'skill', 'deckpal-skill.zip');

export const SKILL_MD = `---
name: deckpal
description: Coach a Pokémon TCG player through their DeckPal account (the DeckPal connector). Use whenever the user pastes a PTCG Live battle log, asks to log or review games, asks how a deck is doing, wants to build or change a deck, asks a card or rules question, logs cards, asks about set completion, lists, carts or prices, or wants to undo a DeckPal change.
---

# DeckPal

DeckPal keeps its own step-by-step playbooks for every job, current with the tools it serves. This skill only says where they are.

1. Before your first DeckPal tool call for a job, call DeckPal's \`playbook\` tool with no name. It returns the rules for every job and which playbook fits the request.
2. Call \`playbook\` again with that playbook's name, and follow it.
3. If the DeckPal connector is not connected, say so: these jobs need it (deckpal.app/connect).
4. If the connector has no \`playbook\` tool, fetch the same playbooks as one Markdown document from https://deckpal.app/api/playbooks?format=markdown (people can read them at https://deckpal.app/skill).
`;

/** CRC-32 (IEEE), as the zip format needs. */
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A zip of one stored file, timestamps fixed at 2026-01-01 00:00. */
export function zipOne(path, data) {
  const name = Buffer.from(path, 'utf8');
  const crc = crc32(data);
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // local header offset
  const centralStart = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([local, name, data, central, name, end]);
}

export function buildSkillZip() {
  return zipOne('deckpal/SKILL.md', Buffer.from(SKILL_MD, 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const zip = buildSkillZip();
  if (process.argv.includes('--check')) {
    let current = null;
    try {
      current = readFileSync(OUT);
    } catch {
      // missing counts as stale
    }
    if (!current || !current.equals(zip)) {
      console.error('apps/web/public/skill/deckpal-skill.zip is stale: run node scripts/build-skill-pointer.mjs');
      process.exit(1);
    }
    console.log('deckpal-skill.zip is current');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, zip);
    console.log(`wrote ${OUT} (${zip.length} bytes)`);
  }
}
