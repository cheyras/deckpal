// Where `pnpm dev` points by default: the live product.
//
// This module is imported by vite.config.ts (Node side) only. It is never
// bundled into the client.
//
// Deliberately contains NO keys. The dev server asks the live deployment for
// its own public configuration at startup (`GET /api/public-config`, added in
// apps/api/src/index.ts) rather than this repo committing a Supabase URL and
// anon key. Those two values are not secret — they ship in every production
// bundle — but fetching them still buys three things worth having:
//
//   1. A rotated anon key reaches developers on their next `pnpm dev`, with no
//      commit and no "why is dev suddenly broken" hunt.
//   2. There is no credential-shaped string in the repo for an agent to
//      pattern-match against and "helpfully" put the service-role key beside.
//   3. A fork that repoints DECKPAL_DEV_ORIGIN at its own deployment gets its
//      own config for free.
//
// ⚠️ Never add a key to this file. If you need one, you are doing something
// the public-config endpoint should be doing instead.

/** The deployment `pnpm dev` proxies to unless told otherwise. */
export const LIVE_ORIGIN = 'https://deckpal.app'

/**
 * Ask a deployment for the public values its own SPA is built with.
 *
 * Fails loudly and specifically (AGENTS.md B11): every failure here otherwise
 * surfaces as an opaque "supabaseUrl is required" from supabase-js three
 * seconds later, in the browser, with nothing pointing at the real cause.
 */
export async function fetchPublicConfig(
  origin: string,
): Promise<{ supabaseUrl: string; supabaseAnonKey: string; mode: string }> {
  const url = `${origin}/api/public-config`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch (cause) {
    throw new Error(
      `Could not reach ${url} to configure the dev server.\n` +
        `  ${cause instanceof Error ? cause.message : String(cause)}\n\n` +
        `  You are offline, or the deployment is down. To work without it:\n` +
        `    pnpm dev --local     (full local stack; needs .env — see CONTRIBUTING.md)`,
      { cause },
    )
  }
  if (!res.ok) {
    throw new Error(
      `${url} returned HTTP ${res.status}.\n\n` +
        `  If that deployment predates the /public-config endpoint, upgrade it,\n` +
        `  point elsewhere with DECKPAL_DEV_ORIGIN, or run: pnpm dev --local`,
    )
  }
  const body = (await res.json()) as { supabaseUrl?: string; supabaseAnonKey?: string; mode?: string }
  if (!body.supabaseUrl || !body.supabaseAnonKey) {
    throw new Error(
      `${url} answered with mode='${body.mode ?? 'unknown'}' and no Supabase config.\n\n` +
        `  That deployment is self-hosted (no Supabase), so there is no account\n` +
        `  to sign into against it. Run: pnpm dev --local`,
    )
  }
  return { supabaseUrl: body.supabaseUrl, supabaseAnonKey: body.supabaseAnonKey, mode: body.mode ?? 'cloud' }
}
