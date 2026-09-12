/**
 * Safe error formatting for the migration CLI.
 *
 * The CLI's main().catch previously logged raw Error messages and unknown
 * objects. Error.message from `pg` typically contains connection parameters
 * (host, port, role, and sometimes the full DSN including credentials). This
 * module replaces open-ended stringification with a closed set of diagnostic
 * categories keyed on pg error codes.
 *
 * Rules:
 *   - NEVER include err.message, err.stack, err.detail, or String(err).
 *   - NEVER use a regex redactor — it cannot cover every credential encoding.
 *   - NEVER invoke getters, toString, or any coercion on the caught value.
 *   - Only emit fixed strings plus an optional pg error code from the explicit
 *     known allowlist below. No unknown code is ever printed.
 *   - Guard dictionary membership as own-only (hasOwnProperty).
 *   - Catch hostile Proxy traps and return a fixed fallback.
 */

/** Known pg error codes and system error codes → operator-facing diagnostic. */
const PG_CODE_MAP: Record<string, string> = Object.create(null) as Record<string, string>;

// Connection
PG_CODE_MAP['08000'] = 'Connection error — check DATABASE_URL and network reachability.';
PG_CODE_MAP['08001'] = 'Unable to establish connection — verify host, port, and firewall.';
PG_CODE_MAP['08003'] = 'Connection does not exist — the pool may have been closed.';
PG_CODE_MAP['08006'] = 'Connection failure — the server closed the connection unexpectedly.';
PG_CODE_MAP['28000'] = 'Authentication failed — check database username and password.';
PG_CODE_MAP['28P01'] = 'Authentication failed — invalid password.';
PG_CODE_MAP['3D000'] = 'Database does not exist — check the database name in DATABASE_URL.';
PG_CODE_MAP['42501'] = 'Insufficient privileges — the database role lacks required permissions.';
PG_CODE_MAP['42P01'] = 'Relation does not exist — migrations may not have been applied.';
PG_CODE_MAP['42P07'] = 'Relation already exists — a migration may have been partially applied.';
PG_CODE_MAP['23505'] = 'Unique constraint violation — this migration may have been partially applied.';
PG_CODE_MAP['57014'] = 'Statement was cancelled — query timeout or manual cancellation.';
PG_CODE_MAP['57P03'] = 'Server is not accepting connections — it may be starting up or shutting down.';
// System errors
PG_CODE_MAP['ECONNREFUSED'] = 'Connection refused — is the database server running?';
PG_CODE_MAP['ENOTFOUND'] = 'Host not found — check the hostname in DATABASE_URL.';
PG_CODE_MAP['ETIMEDOUT'] = 'Connection timed out — check network and firewall settings.';

/**
 * Safely read the `code` property from a caught value. Getters, `toString`
 * and any coercion are avoided, but reading the descriptor *can* trigger a
 * hostile Proxy `getOwnPropertyDescriptor` trap — that exception is caught
 * and discarded (never logged or stringified).
 *
 * Returns the code string only if it is a plain own data property with a
 * string value. Returns undefined for accessors, non-string values, missing
 * properties, or any exception during introspection.
 */
function safeReadCode(obj: unknown): string | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  try {
    const desc = Object.getOwnPropertyDescriptor(obj, 'code');
    // Only accept data descriptors (has `value`), never accessors (get/set).
    // This avoids invoking any getter.
    if (!desc || !('value' in desc)) return undefined;
    // Only accept string values — never call String() or toString() on them.
    if (typeof desc.value !== 'string') return undefined;
    return desc.value;
  } catch {
    // Proxy getOwnPropertyDescriptor trap or other hostile behavior.
    return undefined;
  }
}

/**
 * Extract a safe diagnostic message from a caught value.
 *
 * Returns a fixed-string category (never the raw error content) plus the
 * pg/system error code ONLY if it appears in the explicit known allowlist.
 * Unknown codes are never printed — a code like 'TOPSECRET' would leak
 * through a regex-based filter.
 */
export function safeDiagnostic(err: unknown): string {
  if (err == null) {
    return 'Migration failed with no error details.';
  }

  // Attempt to read a `code` property safely.
  const code = safeReadCode(err);
  if (code !== undefined && Object.prototype.hasOwnProperty.call(PG_CODE_MAP, code)) {
    return `[${code}] ${PG_CODE_MAP[code]}`;
  }

  // An object (Error or plain) without a recognized code.
  if (typeof err === 'object') {
    return 'Migration failed — check DATABASE_URL and database server status.';
  }

  // Not an object at all (string, number, etc.) — do NOT stringify it.
  return 'Migration failed with an unexpected error type. Check database connectivity.';
}
