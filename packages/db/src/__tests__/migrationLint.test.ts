import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Supabase's advisor rule 0010 (security_definer_view), as a migration lint.
 *
 * A Postgres view runs with its OWNER's rights unless it is created
 * `WITH (security_invoker = true)`. Our owner is the migration role, which owns
 * every table and is never subject to their RLS, so a plain view over a
 * per-user table publishes all of it to whoever may SELECT the view — and
 * Supabase's default grants make that the anon key. Migration 020 shipped
 * exactly that (`collection_dupe_predicate`, security audit SEC-01, dropped by
 * 072). This file makes it impossible to ship again.
 *
 * Two rules:
 *  1. From 072 on, every `CREATE [OR REPLACE] VIEW` in `public` says
 *     `security_invoker = true` itself, and there are no materialized views in
 *     `public` at all (RLS never applies to one, and it has no invoker option).
 *     `CREATE OR REPLACE VIEW` without the option also RESETS it to definer, so
 *     the rule is per statement, not per view.
 *  2. Replaying every migration in order, every view still standing at the end
 *     is an invoker view. That is what lets the pre-072 files (immutable, B4)
 *     keep their plain `CREATE VIEW`s: 072 fixes each one after the fact.
 *
 * The parse is textual. A view built inside dynamic SQL would slip past it,
 * which is why the database integration suite (`reach.mjs`) checks the same
 * property on the real catalog after applying every migration.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FIRST_CHECKED = '072';

type ViewEvent =
  | { at: number; kind: 'create'; name: string; invoker: boolean; materialized: boolean }
  | { at: number; kind: 'alter'; name: string; invoker: boolean }
  | { at: number; kind: 'rename'; name: string; to: string }
  | { at: number; kind: 'drop'; names: string[] };

/** `public.x`, `"x"` and `x` are the same view; anything in another schema is not ours to check. */
function publicName(raw: string): string | null {
  const [schema = '', relation] = raw.replaceAll('"', '').toLowerCase().split('.');
  if (relation === undefined) return schema;
  return schema === 'public' ? relation : null;
}

/** `security_invoker` with no value, or true/on/yes/1, is on; anything else is off. */
function invokerIn(options: string | undefined): boolean | undefined {
  for (const option of (options ?? '').split(',')) {
    const [key, value] = option.split('=').map((s) => s.trim().replaceAll("'", '').toLowerCase());
    if (key === 'security_invoker') return value === undefined || ['true', 'on', 'yes', '1'].includes(value);
  }
  return undefined;
}

function viewEvents(sql: string): ViewEvent[] {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const events: ViewEvent[] = [];
  const name = String.raw`((?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?)`;
  for (const m of text.matchAll(new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary)\s+)?(?:recursive\s+)?(materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${name}([\s\S]*?)\bas\b`, 'gi'))) {
    const [, materialized, raw = '', between = ''] = m;
    const view = publicName(raw);
    const withClause = /\bwith\s*\(([^)]*)\)/i.exec(between);
    if (view) events.push({ at: m.index, kind: 'create', name: view, invoker: invokerIn(withClause?.[1]) === true, materialized: !!materialized });
  }
  for (const m of text.matchAll(new RegExp(String.raw`\balter\s+view\s+(?:if\s+exists\s+)?${name}\s+(set|reset)\s*\(([^)]*)\)`, 'gi'))) {
    const [, raw = '', verb = '', options] = m;
    const view = publicName(raw);
    const invoker = invokerIn(options);
    if (view && invoker !== undefined) events.push({ at: m.index, kind: 'alter', name: view, invoker: verb.toLowerCase() === 'set' && invoker });
  }
  for (const m of text.matchAll(new RegExp(String.raw`\balter\s+view\s+(?:if\s+exists\s+)?${name}\s+rename\s+to\s+(\w+)`, 'gi'))) {
    const [, raw = '', to = ''] = m;
    const view = publicName(raw);
    if (view) events.push({ at: m.index, kind: 'rename', name: view, to: to.toLowerCase() });
  }
  for (const m of text.matchAll(/\bdrop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?([^;]+?)\s*(?:cascade|restrict)?\s*;/gi)) {
    const names = (m[1] ?? '').split(',').map((n) => publicName(n.trim())).filter((n): n is string => n !== null);
    events.push({ at: m.index, kind: 'drop', names });
  }
  return events.sort((a, b) => a.at - b.at);
}

/** Rule 1 for one file's SQL: the statements that create a view the wrong way. */
function unsafeCreates(sql: string): string[] {
  return viewEvents(sql)
    .filter((e): e is Extract<ViewEvent, { kind: 'create' }> => e.kind === 'create' && (e.materialized || !e.invoker))
    .map((e) => (e.materialized ? 'materialized view ' : 'definer view ') + e.name);
}

/** Rule 2: replay every file; the views left standing that would run as their owner. */
function definerViewsAfter(files: { sql: string }[]): string[] {
  const invoker = new Map<string, boolean>();
  for (const { sql } of files) {
    for (const e of viewEvents(sql)) {
      if (e.kind === 'create') invoker.set(e.name, e.invoker && !e.materialized);
      else if (e.kind === 'alter' && invoker.has(e.name)) invoker.set(e.name, e.invoker);
      else if (e.kind === 'rename' && invoker.has(e.name)) {
        invoker.set(e.to, invoker.get(e.name)!);
        invoker.delete(e.name);
      } else if (e.kind === 'drop') for (const n of e.names) invoker.delete(n);
    }
  }
  return [...invoker].filter(([, safe]) => !safe).map(([view]) => view).sort();
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }));

describe('migration lint: views obey the caller\'s RLS (Supabase advisor 0010)', () => {
  it(`every view created from ${FIRST_CHECKED} on is created WITH (security_invoker = true)`, () => {
    const offenders = files
      .filter(({ file }) => file >= FIRST_CHECKED)
      .flatMap(({ file, sql }) => unsafeCreates(sql).map((what) => `${file}: ${what}`));
    assert.deepEqual(offenders, []);
  });

  it('after every migration, no view in public runs with its owner\'s rights', () => {
    assert.deepEqual(definerViewsAfter(files), []);
  });

  it('the history it forgives is real: before 072, six views ran as their owner', () => {
    const before = files.filter(({ file }) => file < FIRST_CHECKED);
    assert.deepEqual(definerViewsAfter(before), [
      'admin_user_role', 'card_without_standard_variant', 'collection_dupe_predicate',
      'master_required_variant', 'set_variant_coverage', 'variant_tier_resolved',
    ]);
  });

  it('catches each way a definer view gets written', () => {
    assert.deepEqual(unsafeCreates('CREATE VIEW leak AS SELECT user_id FROM collection_item;'), ['definer view leak']);
    assert.deepEqual(unsafeCreates('create or replace view public."leak" as select 1;'), ['definer view leak']);
    assert.deepEqual(unsafeCreates('CREATE VIEW leak WITH (security_invoker = false) AS SELECT 1;'), ['definer view leak']);
    assert.deepEqual(unsafeCreates('CREATE MATERIALIZED VIEW snap AS SELECT 1;'), ['materialized view snap']);
    assert.deepEqual(unsafeCreates('CREATE VIEW ok WITH (security_invoker = true) AS SELECT 1;'), []);
    assert.deepEqual(unsafeCreates("CREATE VIEW ok (a) WITH (security_barrier, security_invoker='on') AS SELECT 1;"), []);
    assert.deepEqual(unsafeCreates('CREATE VIEW auth.elsewhere AS SELECT 1;'), []);
    assert.deepEqual(unsafeCreates('-- CREATE VIEW commented AS SELECT 1;\n/* CREATE VIEW blocked AS SELECT 1; */'), []);
  });

  it('replays fixes, replacements, renames and drops in order', () => {
    const replay = (...sql: string[]) => definerViewsAfter(sql.map((s) => ({ sql: s })));
    assert.deepEqual(replay('CREATE VIEW v AS SELECT 1;', 'ALTER VIEW public.v SET (security_invoker = true);'), []);
    // CREATE OR REPLACE without the option silently turns an invoker view back into a definer view.
    assert.deepEqual(replay('CREATE VIEW v WITH (security_invoker = true) AS SELECT 1;', 'CREATE OR REPLACE VIEW v AS SELECT 2;'), ['v']);
    assert.deepEqual(replay('CREATE VIEW v WITH (security_invoker) AS SELECT 1;', 'ALTER VIEW v RESET (security_invoker);'), ['v']);
    assert.deepEqual(replay('CREATE VIEW v AS SELECT 1;', 'ALTER VIEW v RENAME TO w;'), ['w']);
    assert.deepEqual(replay('CREATE VIEW v AS SELECT 1; CREATE VIEW w AS SELECT 1;', 'DROP VIEW IF EXISTS v, public.w;'), []);
  });
});
