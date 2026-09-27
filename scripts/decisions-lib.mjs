import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(process.env.DECKPAL_DECISIONS_ROOT || fileURLToPath(new URL('../', import.meta.url)));
export const headingPattern = /^## (\d{4}-\d{2}-\d{2}) (?:—|--) (.+)$/m;

export function decisionDate(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function slug(title) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 80).replace(/-$/g, '') || 'decision';
}

const areaPatterns = [
  ['security', /auth|oauth|sign.?in|permission|security|privacy|rls|token/i],
  ['agents', /mcp|agent|assistant|deck-e|decke|model|chat|tool/i],
  ['images', /image|artwork|card art|sprite|storage|bucket|logo/i],
  ['data', /schema|database|postgres|migration|sql|query|import/i],
  ['commerce', /price|cart|payment|billing|stripe|credit|checkout/i],
  ['scanner', /scan|foil|camera|hash|vision/i],
  ['decks', /deck|battle log|validation|reprint/i],
  ['frontend', /ui|web|mobile|css|design|navigation|screen|layout|page|table/i],
  ['catalog', /catalog|tcg|dex|variant|card|set|pok[eé]mon/i],
  ['operations', /deploy|ci|build|worker|cron|backup|server|infra|route/i],
];

export function inferAreas(title) {
  const areas = areaPatterns.filter(([, pattern]) => pattern.test(title)).map(([area]) => area);
  return areas.length ? areas : ['general'];
}

export function splitLegacy(source) {
  const headings = [...source.matchAll(/^## ([^\n]+)$/gm)];
  const blocks = [{ kind: 'preamble', body: source.slice(0, headings[0]?.index ?? source.length) }];
  for (let i = 0; i < headings.length; i++) {
    const body = source.slice(headings[i].index, headings[i + 1]?.index ?? source.length);
    const match = body.match(headingPattern);
    blocks.push(match && match.index === 0
      ? { kind: 'entry', date: match[1], title: match[2], body }
      : { kind: 'note', title: headings[i][1], body });
  }
  if (blocks.map(block => block.body).join('') !== source) throw new Error('Legacy split lost bytes');
  return blocks;
}

export function metadata(block, overrides = {}) {
  const by = block.body.match(/^\*\*Decided by:\*\*\s*(.*)$/m)?.[1]?.trim() || 'Not recorded';
  return {
    date: block.date,
    title: block.title,
    decided_by: by,
    areas: inferAreas(block.title),
    supersedes: [],
    ...overrides,
  };
}

export function decisionFile(meta, body) {
  return `---\n${Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${body}`;
}

export function parseDecisionFile(content, path = 'decision') {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${path}: missing front matter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([a-z_]+): (.*)$/);
    if (!field) throw new Error(`${path}: invalid front matter line: ${line}`);
    if (Object.hasOwn(meta, field[1])) throw new Error(`${path}: duplicate ${field[1]}`);
    try { meta[field[1]] = JSON.parse(field[2]); }
    catch { throw new Error(`${path}: invalid ${field[1]} value`); }
  }
  const body = content.slice(match[0].length);
  const heading = body.match(headingPattern);
  if (!heading || heading.index !== 0 || heading[1] !== meta.date || heading[2] !== meta.title) {
    throw new Error(`${path}: heading does not match front matter`);
  }
  if (typeof meta.decided_by !== 'string' || !Array.isArray(meta.areas) || !Array.isArray(meta.supersedes)) {
    throw new Error(`${path}: decided_by, areas, or supersedes is invalid`);
  }
  return { meta, body };
}

export function decisionPaths(base = root) {
  const decisions = join(base, 'decisions');
  if (!existsSync(decisions)) return [];
  return readdirSync(decisions, { withFileTypes: true })
    .filter(item => item.isDirectory() && item.name !== 'legacy')
    .flatMap(year => {
      if (!/^\d{4}$/.test(year.name)) throw new Error(`Invalid decisions year directory: ${year.name}`);
      return readdirSync(join(decisions, year.name))
        .filter(name => name.endsWith('.md'))
        .map(name => join(decisions, year.name, name));
    })
    .sort();
}

export function decisions(base = root) {
  return decisionPaths(base).map(path => ({
    path: relative(base, path).replaceAll('\\', '/'),
    ...parseDecisionFile(readFileSync(path, 'utf8'), path),
  }));
}
