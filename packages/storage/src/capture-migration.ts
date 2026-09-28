import {
  CAPTURE_CONFLICT_PREFIX,
  CAPTURE_PREFIXES,
  md5Hex,
  sha256Hex,
  type CaptureBucket,
  type CaptureObject,
  type CapturePrefix,
} from './capture-store.js';
import type { StoredObject } from './object-store.js';

/**
 * Move the captures still sitting in the PUBLIC card-art bucket into the
 * private capture bucket — copy, verify, and only then delete.
 *
 * ── THE ONE RULE ───────────────────────────────────────────────────────────
 *
 * These are the owner's labelled training data. Losing one is the worst
 * outcome this code can have — worse than a photo staying public for another
 * day. So a public object is deleted only after a private object holding
 * BYTE-IDENTICAL content (same length, same SHA-256, read back from the private
 * bucket after the write) is known to exist. Every other path leaves the public
 * copy exactly where it was, for the next run.
 *
 * ── PER OBJECT ─────────────────────────────────────────────────────────────
 *
 *  1. Read the public copy with the service key (the authenticated route, not
 *     the CDN). If it no longer matches what the listing said (size, and the
 *     MD5 etag when Storage gave one), it changed or the read was stale: skip.
 *  2. Write it to the private bucket CREATE-ONLY. Never overwrite: after the
 *     deploy the private bucket is where new writes land, so an object already
 *     there may be NEWER than the public one (a comment edited after the move
 *     started). Overwriting it would lose that edit.
 *  3. Read the private copy back and compare. Identical → step 5.
 *  4. Different → the private key holds other bytes. Keep them, and park the
 *     public bytes at `legacy-conflicts/<key with its hash>`, create-only,
 *     read back and compared the same way. Nothing lists that prefix; it exists
 *     so that "which copy was right" is a question a human can still answer.
 *  5. Delete the public copy.
 *
 * ── WHY RE-RUNS, RACES AND CRASHES ARE SAFE ────────────────────────────────
 *
 * Every step is idempotent and every write is create-only, so the state after
 * any interruption is one of: nothing done; a verified private copy beside an
 * untouched public one (the next run finds it, compares, and finishes); or both
 * done. Two runs at once create the same key — one gets "exists", both compare
 * identical bytes, both delete, and the second delete finds nothing. A run over
 * an empty legacy prefix lists nothing and does nothing.
 *
 * The one residual race is benign by construction: an owner DELETE landing on
 * a `dev-flags/` object in the second it is being moved can leave the private
 * copy behind (the row reappears and can be deleted again). It can never go the
 * other way. Queue objects do not have even that: the API runs each one under
 * the queue's own family lock (`lock` below), the lock discard already holds.
 */

export interface CaptureMigrationOptions {
  primary: CaptureBucket;
  legacy: CaptureBucket | null;
  prefixes?: readonly CapturePrefix[];
  /** Stop STARTING objects after this long. In-flight ones finish. */
  budgetMs?: number;
  concurrency?: number;
  /** Serialise one object against the routes that touch the same family. */
  lock?: <T>(path: string, work: () => Promise<T>) => Promise<T>;
  now?: () => number;
}

export interface CaptureMigrationReport {
  /** Public objects found under the capture prefixes at the start of the run. */
  listed: number;
  /** Deleted from public after a verified private copy at the same key. */
  moved: number;
  /** Deleted from public after a verified copy under `legacy-conflicts/`. */
  preserved: number;
  /** Already gone when this run reached them (another run, or a delete). */
  gone: number;
  /** Left in public for the next run, with the reason. */
  failed: Array<{ path: string; reason: string }>;
  /** Public objects this run did not finish: failures plus anything the budget
   *  did not reach. */
  remaining: number;
  done: boolean;
}

type Outcome = 'moved' | 'preserved' | 'gone';

const MD5_HEX = /^[0-9a-f]{32}$/;

/** Does what we read match what the listing said is stored? */
function matchesListing(bytes: Buffer, listed: StoredObject): string | null {
  if (listed.byteSize > 0 && bytes.length !== listed.byteSize) {
    return `read ${bytes.length} bytes but the listing says ${listed.byteSize}`;
  }
  // Storage's etag is the MD5 of a single-part upload (verified 2026-08-10, see
  // object-store.ts). Anything else (a multipart etag) is not comparable, and
  // size alone has to do.
  if (listed.etag && MD5_HEX.test(listed.etag) && md5Hex(bytes) !== listed.etag) {
    return 'read bytes whose MD5 does not match the listed etag';
  }
  return null;
}

/** `dev-flags/123.png` → `legacy-conflicts/dev-flags/123.<sha16>.png`. */
export function conflictKey(path: string, digest: string): string {
  const tag = digest.slice(0, 16);
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const dot = name.indexOf('.');
  const stamped = dot > 0 ? `${name.slice(0, dot)}.${tag}${name.slice(dot)}` : `${name}.${tag}`;
  return `${CAPTURE_CONFLICT_PREFIX}/${dir}/${stamped}`;
}

export async function migrateLegacyCaptures(options: CaptureMigrationOptions): Promise<CaptureMigrationReport> {
  const { primary, legacy } = options;
  const report: CaptureMigrationReport = { listed: 0, moved: 0, preserved: 0, gone: 0, failed: [], remaining: 0, done: true };
  // Same bucket on both sides would make "delete the old copy" delete the only one.
  if (!legacy || legacy.name === primary.name) return report;

  const prefixes = options.prefixes ?? CAPTURE_PREFIXES;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 20_000);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const lock = options.lock ?? (<T>(_path: string, work: () => Promise<T>) => work());

  const listed: StoredObject[] = [];
  for (const prefix of prefixes) listed.push(...(await legacy.list(prefix)));
  listed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  report.listed = listed.length;

  /** Does the private bucket hold exactly these bytes at `key`? */
  async function holds(key: string, digest: string, length: number): Promise<boolean> {
    const copy = await primary.read(key);
    return !!copy && copy.bytes.length === length && sha256Hex(copy.bytes) === digest;
  }

  /** Put a verified private copy somewhere, and say where. Throws if it cannot. */
  async function place(key: string, source: CaptureObject, digest: string): Promise<string> {
    await primary.write(key, source.bytes, source.contentType, 'create');
    if (await holds(key, digest, source.bytes.length)) return key;
    const parked = conflictKey(key, digest);
    await primary.write(parked, source.bytes, source.contentType, 'create');
    if (await holds(parked, digest, source.bytes.length)) return parked;
    throw new Error(`verification failed: the private copy at ${parked} does not match the public bytes`);
  }

  async function migrateOne(object: StoredObject): Promise<Outcome> {
    const source = await legacy!.read(object.path);
    if (!source) return 'gone';
    const drift = matchesListing(source.bytes, object);
    if (drift) throw new Error(`the public copy changed or was read stale (${drift}); left for the next run`);
    const digest = sha256Hex(source.bytes);
    const target = await place(object.path, source, digest);
    // The ONLY delete in this module, and it is reached only through `place`,
    // which returns only after a read-back matched byte for byte.
    await legacy!.remove(object.path);
    return target === object.path ? 'moved' : 'preserved';
  }

  let next = 0;
  async function worker(): Promise<void> {
    while (next < listed.length && now() < deadline) {
      const object = listed[next++]!;
      try {
        report[await lock(object.path, () => migrateOne(object))]++;
      } catch (error) {
        report.failed.push({ path: object.path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, listed.length) }, worker));

  report.remaining = listed.length - report.moved - report.preserved - report.gone;
  report.done = report.remaining === 0;
  return report;
}
