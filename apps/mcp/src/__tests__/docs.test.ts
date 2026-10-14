/**
 * The docs say what the registry says (2026-10-12).
 *
 * On that date the repo claimed 23, 26, 27 and 28 tools in different places,
 * DEPLOYMENT.md listed 27 names (no `battle_digest`) and apps/mcp/SPEC.md said
 * a read-only connection sees 15 read tools when it sees 17. Every number
 * below is derived from the running server's tools/list, and every place that
 * states one is checked against it:
 *
 *  - apps/mcp/TOOLS.md and the tool list in apps/mcp/README.md are generated
 *    (`pnpm mcp:tools-doc`) and must match a fresh generation;
 *  - each prose claim of a count in the README, AGENTS.md's package table,
 *    ARCHITECTURE.md, DEPLOYMENT.md and SPEC.md must equal the derived count;
 *  - so must the public ones: the landing page's copy (llms.txt and the
 *    /connect page's Read only paragraph, apps/web/src/routes/landing/copy.ts)
 *    and the link-preview card's pill (scripts/gen-og-image.mjs). The card is a
 *    JPEG, so after changing the script, regenerate it (`node
 *    scripts/gen-og-image.mjs` after a web build) and commit the image too.
 *
 * Adding or removing a tool therefore fails here until the docs follow — which
 * is the point. Dated records (decisions/, roadmap/) are history and are not
 * checked. Reads @deckpal/agent-tools' dist; build it first.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { fillReadme, renderReadmeTools, renderToolsDoc, toolCounts, type ToolCounts } from '../audit/toolsDoc.js';
import { listTools } from '../audit/surface.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const STALE = 'Run `pnpm mcp:tools-doc` (after building @deckpal/agent-tools) and commit the result.';

let counts: ToolCounts;
let readOnlyCount = 0;
before(async () => {
  counts = await toolCounts();
  readOnlyCount = (await listTools({ readOnly: true })).tools.length;
});

test('the registry is what the docs below are checked against', () => {
  assert.equal(counts.tools, counts.read + counts.write);
  assert.ok(counts.tools > 0 && counts.read > 0 && counts.write > 0 && counts.gated >= 0);
  assert.equal(readOnlyCount, counts.read, 'a read-only connection is served exactly the read tools');
});

test('apps/mcp/TOOLS.md is the current generation', async () => {
  assert.equal(read('apps/mcp/TOOLS.md'), await renderToolsDoc(), STALE);
});

test("apps/mcp/README.md's tool list is the current generation", async () => {
  const readme = read('apps/mcp/README.md');
  assert.equal(fillReadme(readme, await renderReadmeTools()), readme, STALE);
});

/** Every match of `pattern` in `file`, each capture checked against `expected` in order. */
function claims(file: string, pattern: RegExp, expected: (c: ToolCounts) => number[]): void {
  const text = read(file);
  const found = [...text.matchAll(pattern)];
  assert.ok(found.length > 0, `${file}: the claim ${pattern} is gone — update this test with the new wording, keeping the count checked`);
  for (const m of found) {
    const got = m.slice(1).map(Number);
    assert.deepEqual(got, expected(counts), `${file}: "${m[0]}" disagrees with the registry`);
  }
}

test('README.md states the registry counts', () => {
  claims('README.md', /\("deckpal-mcp"\) -- (\d+) tools \((\d+) read, (\d+) write\)/g, (c) => [c.tools, c.read, c.write]);
  claims('README.md', /The (\d+) agent tool definitions/g, (c) => [c.tools]);
});

test("AGENTS.md's package table states the registry count", () => {
  claims('AGENTS.md', /The (\d+) agent tool definitions/g, (c) => [c.tools]);
});

test('ARCHITECTURE.md states the registry counts', () => {
  claims('ARCHITECTURE.md', /(\d+) tools \((\d+) read, (\d+) write\)/g, (c) => [c.tools, c.read, c.write]);
});

test('DEPLOYMENT.md states the registry counts', () => {
  claims('DEPLOYMENT.md', /(\d+) tools \((\d+) read, (\d+) write\)/g, (c) => [c.tools, c.read, c.write]);
  claims('DEPLOYMENT.md', /only the (\d+) read tools/g, (c) => [c.read]);
});

test('apps/mcp/SPEC.md states the registry counts', () => {
  claims('apps/mcp/SPEC.md', /only the (\d+) `readOnlyHint` tools/g, (c) => [c.read]);
  claims('apps/mcp/SPEC.md', /(\d+) ordinary tools \+ (\d+) capability-gated/g, (c) => [c.tools, c.gated]);
  claims('apps/mcp/SPEC.md', /only the (\d+) `readOnlyHint` tools \((\d+) with the Deck-E/g, (c) => [c.read, c.read + c.gated]);
});

test('SECURITY.md states the registry count', () => {
  claims('SECURITY.md', /All (\d+) tools, plus Deck-E's own/g, (c) => [c.tools]);
});

test('apps/mcp/README.md states the registry counts', () => {
  claims('apps/mcp/README.md', /(\d+) tools \((\d+) read, (\d+) write\)/g, (c) => [c.tools, c.read, c.write]);
});

test("the landing page's copy states the registry counts", () => {
  const copy = 'apps/web/src/routes/landing/copy.ts';
  claims(copy, /(\d+) tools \((\d+) read, (\d+) write\)/g, (c) => [c.tools, c.read, c.write]);
  claims(copy, /Read only gives your AI the (\d+) tools/g, () => [readOnlyCount]);
  claims(copy, /Read and change adds the (\d+)/g, (c) => [c.write]);
});

test('the link-preview card states the registry count', () => {
  claims('scripts/gen-og-image.mjs', /(\d+) tools over MCP/g, (c) => [c.tools]);
});
