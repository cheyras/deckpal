import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnv } from './env.js';

const { Pool } = pg;

/**
 * Translate libpq's `PGSSLMODE` into a node-postgres `ssl` option.
 *
 * 🔴 Why this exists: pg does not implement libpq's semantics. Its built-in
 * env reader maps `prefer`/`require`/`verify-ca`/`verify-full` all to
 * `ssl: true`, which is a bare `tls.connect()` — i.e. full chain **and**
 * hostname verification for every one of them. libpq is explicit that
 * `require` means "encrypt, but do not verify the chain" (PostgreSQL docs,
 * libpq §"SSL Support"), so the documented Supabase path
 * (`PGSSLMODE=require pnpm --filter @deckscout/db migrate`) died with
 * `self-signed certificate in certificate chain` against Supabase's pooler.
 * Deferring to pg here would mean either lying in DEPLOYMENT.md or telling
 * every open-core deployer to set a pg-only value (`no-verify`).
 *
 * The mapping below matches libpq, including the nuance that `require` *does*
 * verify the chain (like `verify-ca`) when a root certificate is supplied:
 *
 *   unset / disable       no TLS at all — the self-host default (local socket
 *                         or trusted LAN TCP). Unchanged behaviour.
 *   allow / prefer        encrypt opportunistically, no verification. (pg
 *                         cannot downgrade to plaintext mid-handshake the way
 *                         libpq does, so these attempt TLS unconditionally.)
 *   require               encrypt; verify only if PGSSLROOTCERT is supplied.
 *   verify-ca             encrypt + verify the chain, but NOT the hostname.
 *   verify-full           encrypt + verify the chain AND the hostname.
 *   no-verify             pg's own spelling of "encrypt, never verify".
 *
 * An unrecognised value throws instead of silently falling through to *no*
 * encryption, which is what pg does today — a typo'd `PGSSLMODE` must never
 * quietly downgrade a production connection to plaintext.
 */
function sslOptionFromEnv(): pg.PoolConfig['ssl'] {
  const mode = (process.env.PGSSLMODE ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'disable') return false;

  // libpq's sslrootcert. Read eagerly: a CA file that was named but cannot be
  // read must be a hard error, never a silent fallback to the system store.
  const rootCertPath = process.env.PGSSLROOTCERT?.trim();
  let ca: string | undefined;
  if (rootCertPath) {
    try {
      ca = readFileSync(rootCertPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `PGSSLROOTCERT points at ${rootCertPath}, which could not be read: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  switch (mode) {
    case 'allow':
    case 'prefer':
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'require':
      // Encrypted but unauthenticated unless the operator supplied a CA, which
      // libpq treats as an opt-in upgrade to verify-ca.
      return ca
        ? { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined }
        : { rejectUnauthorized: false };
    case 'verify-ca':
      // Chain verified, hostname deliberately not: that is the whole difference
      // between verify-ca and verify-full.
      return { ...(ca ? { ca } : {}), rejectUnauthorized: true, checkServerIdentity: () => undefined };
    case 'verify-full':
      return { ...(ca ? { ca } : {}), rejectUnauthorized: true };
    default:
      throw new Error(
        `Unrecognised PGSSLMODE="${process.env.PGSSLMODE}". Use one of: ` +
          'disable, allow, prefer, require, verify-ca, verify-full (or pg\'s no-verify).',
      );
  }
}

/**
 * A pg Pool with a HARD connection cap.
 *
 * 🔴 HARD_CAP 3 is PER-PROCESS — the cluster budget is 4 TOTAL (API 2 + sync
 * 1 + MCP 1; see DECISIONS.md 2026-07-29). Postgres on this box runs at
 * max_connections=20, 3 reserved, ~11 already used by co-hosted apps. See
 * DECISIONS.md 2026-07-24 (storage) and https://github.com/cheyras/deckscout/wiki/Data-Layer §6.5. Never
 * raise past 5 without re-checking headroom AND a Postgres restart (which
 * requires the user's permission).
 *
 * `PGPOOL_MAX` is clamped to HARD_CAP (3) per process regardless of what the
 * environment asks for, so a misconfigured process cannot blow the cluster
 * budget (no single app is allotted more than 2).
 */
const HARD_CAP = 3;

export function makePool(maxOverride?: number): pg.Pool {
  loadEnv();
  const requested = maxOverride ?? Number(process.env.PGPOOL_MAX ?? 3);
  const max = Math.min(Number.isFinite(requested) ? requested : 3, HARD_CAP);
  const pool = new Pool({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'deckscout',
    user: process.env.PGUSER ?? 'deckscout',
    password: process.env.PGPASSWORD,
    // Explicit, so pg's own PGSSLMODE reader never runs (see sslOptionFromEnv).
    ssl: sslOptionFromEnv(),
    max,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: process.env.PGAPPNAME ?? 'deckscout',
  });
  // node-postgres docs: an idle client that errors out (e.g. a brief network
  // blip to the upstream Postgres) emits 'error' on the pool. Without a
  // listener here, that error is unhandled and the pool is left wedged —
  // every future pool.connect() times out until the process is restarted.
  // Logging and letting the pool recover on its own is the documented fix.
  pool.on('error', (err) => {
    console.error('[db] idle client error (pool recovers automatically):', err.message);
  });
  return pool;
}
