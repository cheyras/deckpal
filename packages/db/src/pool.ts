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
 * (`PGSSLMODE=require pnpm --filter @deckpal/db migrate`) died with
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
 * What a pool is FOR. This is the input that decides both which port it talks
 * to and how many connections it may hold, because the two roles have opposite
 * requirements and conflating them is what made the API unusable in cloud dev.
 *
 *   'request'  Serves HTTP requests. In SUPABASE_MODE the RLS middleware
 *              (apps/api/src/index.ts) checks out ONE pooled connection for the
 *              entire lifetime of every request, so this pool's `max` IS the
 *              server's maximum concurrent requests. It needs headroom, and it
 *              needs nothing session-scoped, so it may use transaction pooling.
 *
 *   'worker'   Migrations, sync jobs, CLIs, MCP. These need SESSION-scoped
 *              state that transaction pooling silently breaks:
 *              `pg_try_advisory_lock` (apps/sync/src/prices/db.ts) is released
 *              when the session ends, and migration 020 creates a TEMPORARY
 *              table. They must stay on the session port, and they run one at
 *              a time, so a tiny cap is correct.
 */
export type PoolRole = 'request' | 'worker';

/**
 * Supabase's Supavisor exposes SESSION pooling on 5432 and TRANSACTION pooling
 * on 6543 for the same host. Detecting the pooler by hostname is what keeps
 * this portable: a plain self-hosted Postgres has no 6543 to move to, so it
 * keeps using PGPORT for everything.
 */
const SUPABASE_POOLER_HOST = /\.pooler\.supabase\.com$/i;
const SUPABASE_TRANSACTION_PORT = 6543;

/**
 * 🔴 Connection caps.
 *
 * DIRECT_CAP 3 is the original contract and still applies to a DIRECT Postgres:
 * the reference self-host box runs max_connections=20 with 3 reserved and ~11
 * used by co-hosted apps, so the cluster budget is 4 total (API 2 + sync 1 +
 * MCP 1 — DECISIONS.md 2026-07-29, Data-Layer wiki §6.5). Never raise it
 * without re-checking headroom on that box.
 *
 * POOLED_CAP is deliberately much larger, because when the backend is a
 * connection POOLER that reasoning inverts: the pooler exists precisely so
 * clients need not ration connections, and it multiplexes them onto a small
 * server pool of its own. Applying DIRECT_CAP to a pooler host was the bug —
 * it capped the API at 2 concurrent requests, which one SPA page load exceeds.
 */
const DIRECT_CAP = 3;
const POOLED_CAP = 24;

export interface MakePoolOptions {
  /** See PoolRole. Defaults to 'worker' — the conservative, session-safe choice. */
  role?: PoolRole;
  /** Explicit ceiling. Still clamped by the role/backend cap. */
  max?: number;
}

interface Backend {
  host: string;
  port: number;
  cap: number;
  /** True when this pool is talking to transaction-mode pooling. */
  transactionPooled: boolean;
}

function resolveBackend(role: PoolRole): Backend {
  const host = process.env.PGHOST ?? '127.0.0.1';
  const sessionPort = Number(process.env.PGPORT ?? 5432);
  const isPooler = SUPABASE_POOLER_HOST.test(host);

  // Workers always take the session port: their advisory locks and temp tables
  // do not survive transaction pooling. Same for any direct Postgres, which
  // has nowhere else to go.
  //
  // The cap follows the BACKEND, not the role: POOLED_CAP's whole
  // justification is that a pooler multiplexes client connections onto its
  // own small server pool. A direct Postgres does no such thing, so it keeps
  // DIRECT_CAP for every role — that ceiling is what guarantees a
  // misconfigured PGPOOL_MAX cannot blow the reference box's cluster budget
  // (max_connections=20, ~11 in use — the original HARD_CAP contract).
  if (role === 'worker' || !isPooler) {
    return { host, port: sessionPort, cap: DIRECT_CAP, transactionPooled: false };
  }
  return {
    host,
    port: Number(process.env.PGPORT_TRANSACTION ?? SUPABASE_TRANSACTION_PORT),
    cap: POOLED_CAP,
    transactionPooled: true,
  };
}

/** Default size for a role, before any explicit override. */
function defaultMax(role: PoolRole): number {
  if (role !== 'request') return 1;
  // Cloud holds a connection per in-flight request (see PoolRole); self-host
  // does not mount the RLS middleware at all and only runs transient queries.
  return process.env.SUPABASE_MODE ? 12 : 2;
}

/**
 * Parse a pool-size env var. Returns undefined for anything that is not a
 * positive integer — in particular the empty string (`PGPOOL_MAX=` left blank
 * in a .env template), which Number() would coerce to 0 and thereby clamp the
 * pool to max 1, serializing the whole API.
 */
function poolSizeFromEnv(name: string): number | undefined {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function makePool(opts?: number | MakePoolOptions): pg.Pool {
  loadEnv();
  const { role = 'worker', max: maxOverride } = typeof opts === 'number' ? { max: opts } : (opts ?? {});
  const backend = resolveBackend(role);

  // PGPOOL_MAX is the historical WORKER knob (sync 1, migrations 1 — the
  // self-host cluster budget). It must not leak into request pools: existing
  // cloud .envs carry PGPOOL_MAX=3 from the old template, and letting it cap
  // the request pool would quietly reintroduce the exact starvation this
  // branch fixed. Request pools are sized by their caller (PGPOOL_MAX_API via
  // apps/api/src/db.ts) or by defaultMax.
  const envMax = role === 'worker' ? poolSizeFromEnv('PGPOOL_MAX') : undefined;
  const requested = maxOverride ?? envMax ?? defaultMax(role);
  const max = Math.max(1, Math.min(Number.isFinite(requested) ? requested : defaultMax(role), backend.cap));

  const pool = new Pool({
    host: backend.host,
    port: backend.port,
    database: process.env.PGDATABASE ?? 'deckpal',
    user: process.env.PGUSER ?? 'deckpal',
    password: process.env.PGPASSWORD,
    // Explicit, so pg's own PGSSLMODE reader never runs (see sslOptionFromEnv).
    ssl: sslOptionFromEnv(),
    max,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: process.env.PGAPPNAME ?? 'deckpal',
  });

  // One line, once per pool, so that "the backend won't connect" is diagnosable
  // on a machine nobody has debugged before — which port and which ceiling were
  // actually chosen is exactly what you need and cannot otherwise see.
  if (role === 'request' || process.env.PGPOOL_VERBOSE) {
    console.error(
      `[db] pool role=${role} ${backend.host}:${backend.port} max=${max} ` +
        `(${backend.transactionPooled ? 'transaction-pooled' : 'session'})`,
    );
  }
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
