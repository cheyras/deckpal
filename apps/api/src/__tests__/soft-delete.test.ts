import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

/**
 * Soft delete is only as good as its least careful read.
 *
 * Migration 038 made `card_list` and `deck` soft-deletable, which means every
 * query that reads either one has to say `deleted_at IS NULL` or a deleted row
 * comes back from the dead in that one place. There is no type system for
 * "this SQL string filtered the right column", so this is a source guard — the
 * same shape as `identity.test.ts`, which exists because ~30 routes silently
 * passed `undefined` into `WHERE user_id = $1` and nothing caught it.
 *
 * The rule: any statement that READS `card_list` or `deck` (`FROM` / `JOIN`),
 * or DELETEs from them, must either filter `deleted_at` or carry an explicit
 * `-- soft-delete-exempt: <reason>` marker nearby. Exemptions are legitimate
 * (the recycle-bin listing wants the deleted rows; a purge is deleting them;
 * an internal helper runs behind a lock that already checked) — they just have
 * to be stated rather than accidental.
 *
 * Scope, stated deliberately: `UPDATE <table> SET … WHERE id = $1` is NOT
 * covered. Every such write in this app is preceded by a locking existence
 * check (`assertDeck`, or the PATCH/bulk routes' own
 * `SELECT … deleted_at IS NULL … FOR UPDATE`), and that check is the guard.
 * Requiring a redundant filter on the follow-up UPDATE would add twenty
 * annotations that teach a future reader nothing. Reads are where a deleted
 * row leaks to a person; that is what this test defends.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..');

/** Every .ts file under apps/api/src, tests excluded. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
      sources(p, out);
    } else if (entry.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Statements are found by locating a `FROM`/`JOIN`/`UPDATE`/`DELETE FROM` on
 * the guarded table and then reading to the end of that template literal —
 * `deleted_at` frequently sits several lines below the `FROM`.
 */
const TABLE_RE = /\b(?:FROM|JOIN)\s+(card_list|deck)\b(?!_)/gi;

interface Hit {
  file: string;
  line: number;
  table: string;
  snippet: string;
}

function findUnguarded(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const m of text.matchAll(TABLE_RE)) {
      const idx = m.index ?? 0;
      const lineNo = text.slice(0, idx).split('\n').length;
      // The statement is taken as the enclosing backtick string when there is
      // one, else the line — either way it is what the reader would call "this
      // query".
      const openTick = text.lastIndexOf('`', idx);
      const closeTick = openTick === -1 ? -1 : text.indexOf('`', idx);
      const stmt = openTick !== -1 && closeTick !== -1 ? text.slice(openTick, closeTick + 1) : (lines[lineNo - 1] ?? '');
      // A marker anywhere in the statement, or on the four lines above where
      // the statement STARTS, counts — comments sit above the query they
      // explain, and the matched table name is often several lines into it.
      const stmtStartLine = openTick !== -1 ? text.slice(0, openTick).split('\n').length : lineNo;
      const context = lines.slice(Math.max(0, stmtStartLine - 5), lineNo + 1).join('\n');
      if (/deleted_at/i.test(stmt) || /soft-delete-exempt/i.test(context) || /soft-delete-exempt/i.test(stmt)) continue;
      hits.push({
        file: file.slice(SRC.length + 1),
        line: lineNo,
        table: m[1]!,
        snippet: stmt.replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
  }
  return hits;
}

test('every card_list / deck statement filters deleted_at or declares an exemption', () => {
  const hits = findUnguarded();
  assert.deepEqual(
    hits,
    [],
    'Unguarded reads of a soft-deletable table:\n' +
      hits.map((h) => `  ${h.file}:${h.line} (${h.table}) — ${h.snippet}`).join('\n') +
      '\n\nAdd `AND deleted_at IS NULL`, or a `-- soft-delete-exempt: <reason>` comment if the ' +
      'statement genuinely wants deleted rows (recycle bin, purge, or a read already behind a checked lock).',
  );
});
