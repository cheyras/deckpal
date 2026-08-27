/**
 * The object-key allow-list — the same algebra `parseImagePath` enforces, but
 * standing AT the choke point instead of a module away.
 *
 * WHY THIS EXISTS. Every object key this package writes is derived by
 * `paths.ts` (`cardRelativePath`, `setImageRelativePath`, `spriteRelativePath`)
 * from segments that already passed `parseImagePath`'s `SEGMENT` allow-list, so
 * the keys were always safe *in practice*. But `objectExists`, `uploadObject`,
 * `moveObject` and friends are exported, and the bulk callers — `storage:backfill`
 * (`apps/images/src/cloudBackfill.ts`), `rekey:set` (`rekeySet.ts`) and the
 * warmers — hand them `relative_path` values read back out of Postgres, never
 * through `parseImagePath`. "The key is always allow-listed" was therefore a
 * convention holding across every call site rather than an invariant any one
 * function enforced, which is exactly the shape of guarantee that survives right
 * up until someone adds the next caller.
 *
 * It is also why CodeQL rated `js/request-forgery` critical on three of those
 * functions (alerts #37, #60, #39): the validation was real but a module away,
 * so its taint tracker could not see a barrier. Asserting here makes the
 * guarantee local — to a reader, to a new caller, and to the analyser.
 *
 * The host in those URLs is `process.env.SUPABASE_URL`, never attacker-controlled,
 * so what this actually defends is PATH injection into a fixed host: escaping the
 * bucket prefix, reaching Storage's admin routes by walking up with `..`, or
 * smuggling a query string onto a write. `encodeURI(objectPath)` in
 * `object-store.ts` does NOT close those — it leaves `/`, `?`, `#` and `%` intact.
 *
 * Zero dependencies, pure, and cheap enough (one regex per short segment) to run
 * on every call including the hot `objectExists` check.
 */

/**
 * One path segment. Deliberately IDENTICAL to `SEGMENT` in `paths.ts`: a leading
 * alphanumeric, then alphanumerics, dots and hyphens. It contains no separator,
 * no `%`, no `?`, no `#`, no whitespace and no control character, so a key built
 * only from segments that match cannot escape its subtree or grow a query.
 *
 * Every key shape in the bucket satisfies it:
 *   images/en/sv/sv03.5/102.low.webp
 *   sets/swsh9tg/logo.webp
 *   sprites/other/official-artwork/shiny/25.png
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** Generous, but bounded: the longest real key is well under 100 characters. */
export const MAX_OBJECT_PATH_LENGTH = 1024;

/** Quote for a log line without letting a hostile key BE the log line. */
function snip(value: string, max = 80): string {
  return JSON.stringify(value.length > max ? `${value.slice(0, max)}…` : value);
}

/**
 * Why this string is not a usable object key, or `null` if it is fine.
 *
 * Returned rather than thrown so callers can report the reason; `assertSafeObjectPath`
 * is the throwing form and is what the choke points use.
 */
export function objectPathProblem(objectPath: unknown): string | null {
  if (typeof objectPath !== 'string') return `expected a string, got ${typeof objectPath}`;
  if (objectPath.length === 0) return 'empty';
  if (objectPath.length > MAX_OBJECT_PATH_LENGTH) {
    return `longer than ${MAX_OBJECT_PATH_LENGTH} characters (${objectPath.length})`;
  }

  // Named individually so the failure says WHICH trap was hit. The SEGMENT test
  // below would reject every one of these anyway; this is for the human reading
  // the log line, and for the reader of this file.
  if (objectPath.includes('\0')) return 'contains a NUL byte';
  if (objectPath.includes('\\')) return 'contains a backslash';
  if (objectPath.includes('?')) return 'contains a query separator';
  if (objectPath.includes('#')) return 'contains a fragment separator';
  // encodeURI() does NOT escape '%', so a '%2e%2e' here would reach Storage as
  // '..' after ITS decode. Refuse percent-escapes rather than decode-and-recheck.
  if (objectPath.includes('%')) return 'contains a percent-escape';
  if (objectPath.includes('..')) return "contains '..'";

  if (objectPath.startsWith('/')) return 'starts with a separator';
  if (objectPath.endsWith('/')) return 'ends with a separator';

  for (const segment of objectPath.split('/')) {
    if (segment.length === 0) return 'has an empty path segment';
    if (!SEGMENT.test(segment)) return `segment ${snip(segment)} is not allow-listed`;
  }
  return null;
}

/** Is this a key we are willing to address in the bucket? */
export function isSafeObjectPath(objectPath: unknown): objectPath is string {
  return objectPathProblem(objectPath) === null;
}

/**
 * Throw unless `objectPath` is a key we are willing to address.
 *
 * THROWS rather than returning a soft failure, on purpose. An unsafe key is a
 * programming error — nothing in this codebase can legitimately produce one — and
 * the alternative is a `false`/`{ ok: false }` that a bulk run would count as
 * "asset missing" and quietly work around. The cloud image handler already turns
 * a thrown error into a placeholder plus a `console.error`, so the request still
 * answers with an image; the bulk paths fail loudly, which is what they should do.
 *
 * @param where  The function being protected, for the message ('uploadObject').
 */
export function assertSafeObjectPath(objectPath: string, where: string): void {
  const problem = objectPathProblem(objectPath);
  if (problem === null) return;
  throw new Error(
    `[storage] ${where}: refusing unsafe object key (${problem}): ${snip(String(objectPath), 200)}`,
  );
}
