#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionDate, decisions, root } from './decisions-lib.mjs';

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output needs a path');
const agentIndex = process.argv.indexOf('--agent');
if (agentIndex >= 0 && !process.argv[agentIndex + 1]) throw new Error('--agent needs a name');
const agent = agentIndex >= 0 ? process.argv[agentIndex + 1] : 'decision generator';
const manifest = JSON.parse(readFileSync(join(root, 'decisions/history.json'), 'utf8'));
const all = new Map(decisions().map(item => [item.path, item]));
const historical = manifest.blocks.map(block => {
  if (block.kind !== 'entry') return readFileSync(join(root, block.path), 'utf8');
  const entry = all.get(block.path);
  if (!entry) throw new Error(`Missing historical entry ${block.path}`);
  all.delete(block.path);
  return entry.body;
});
const later = [...all.values()].sort((a, b) => a.meta.date.localeCompare(b.meta.date) || a.path.localeCompare(b.path));
const source = historical.join('') + later.map(entry => `\n${entry.body}`).join('') +
  `\n_Last updated by ${agent} on behalf of @cheyras -- ${decisionDate()}_\n`;
if (outputIndex >= 0) {
  writeFileSync(process.argv[outputIndex + 1], source);
  console.log(`Wrote ${process.argv[outputIndex + 1]}`);
} else process.stdout.write(source);
