const NETLIFY_ENV_ALLOWLIST = [
  'DATABASE_URL',
  'SUPABASE_MODE',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'API_BASE_PATH',
  'API_CORS_ORIGINS',
  'DESIGN_EDITOR_USER_ID',
  'FAMILY_OWNER_USER_ID',
  'FAMILY_INVITE_REDIRECT_URL',
  'ANTHROPIC_BASE_URL',
  'CARD_ART_BUCKET',
  'USER_AVATAR_BUCKET',
  'PGSSLMODE',
  'PGSSLROOTCERT',
  'PGPOOL_MAX_API',
  'PGPOOL_MAX_CHAT',
  'PGRLS_MAX_HOLD_MS',
  'PGRLS_CLEANUP_MS',
  'DECKE_VERCEL_AI_GATEWAY_KEY',
  'DECKE_APPROVAL_SECRET',
  'DECKE_CREDITS_ENABLED',
  'DECKE_ENTITLED_USER_IDS',
  'DECKE_MAX_TURNS_PER_DAY',
  'DECKE_MAX_DEEP_CALLS_PER_DAY',
] as const

const REQUIRED_SUPABASE_ENV = [
  'DATABASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const

function hydratePostgresEnvironment(databaseUrl: string): void {
  const parsed = new URL(databaseUrl)
  const values: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres'),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  }

  const sslmode = parsed.searchParams.get('sslmode')
  if (sslmode) values.PGSSLMODE = sslmode

  for (const [name, value] of Object.entries(values)) {
    if (process.env[name] === undefined && value) process.env[name] = value
  }
}

/**
 * Copy the small, reviewed set of Netlify values needed by DeckPal into the
 * process environment expected by the existing application. Existing process
 * values always win so local and test configuration remains deterministic.
 */
export function hydrateDeckPalEnvironment(
  read: (name: string) => string | undefined,
): void {
  for (const name of NETLIFY_ENV_ALLOWLIST) {
    if (process.env[name] !== undefined) continue

    const value = read(name)?.trim()
    if (value) process.env[name] = value
  }

  process.env.SUPABASE_MODE ??= 'true'
  process.env.API_BASE_PATH ??= '/api'

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl) hydratePostgresEnvironment(databaseUrl)
}

/** Return names only. Secret values must never enter logs or error messages. */
export function missingRequiredEnvironment(): string[] {
  const supabaseEnabled =
    process.env.SUPABASE_MODE === 'true' || process.env.SUPABASE_MODE === '1'

  if (!supabaseEnabled) return []

  return REQUIRED_SUPABASE_ENV.filter((name) => !process.env[name]?.trim())
}
