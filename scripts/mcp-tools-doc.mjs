#!/usr/bin/env node
/**
 * pnpm mcp:tools-doc — regenerate the tool lists the docs carry, from the
 * registry: apps/mcp/TOOLS.md in full, and the marked region of
 * apps/mcp/README.md.
 *
 * Both are read back from the MCP server's own `tools/list`, so they are
 * exactly what a client is shown. apps/mcp/src/__tests__/docs.test.ts fails
 * when either committed copy is out of date; run this and commit the result.
 * Reads @deckpal/agent-tools' dist, so build that package first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const doc = await import(pathToFileURL(join(REPO, 'apps/mcp/src/audit/toolsDoc.ts')).href);

const tools = join(REPO, 'apps/mcp/TOOLS.md');
writeFileSync(tools, await doc.renderToolsDoc());
console.log(`wrote ${tools}`);

const readme = join(REPO, 'apps/mcp/README.md');
const current = readFileSync(readme, 'utf8');
const eol = current.includes('\r\n') ? '\r\n' : '\n';
const region = (await doc.renderReadmeTools()).replace(/\n/g, eol);
writeFileSync(readme, doc.fillReadme(current, region));
console.log(`updated the tool list in ${readme}`);
