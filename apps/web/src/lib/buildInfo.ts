/**
 * Which commit this bundle was built from.
 *
 * Vercel exposes `VERCEL_GIT_COMMIT_SHA` as build-time env; `vite.config.ts`
 * bakes it into the bundle with `define` (the same mechanism as
 * `VITE_VERCEL_ENV`). This is the client-side twin of
 * `apps/api/src/decke/build.ts`'s `buildStamp()` — same source, same
 * "empty is an honest answer" stance: outside a Vercel build (self-host,
 * local `vite build`, CI) there is no commit to name, so this is `''`
 * rather than a guess.
 *
 * Read by the error boundaries (`components/ErrorBoundary.tsx`) so a crash
 * report can say which build was actually running in the browser that hit
 * it — which can legitimately differ from whichever build the API happens
 * to be answering from at the moment the report arrives (a stale client
 * hitting a newer deploy is exactly the failure mode `lib/lazyRoute.ts`
 * exists for).
 */
export const BUILD_SHA: string = import.meta.env.VITE_BUILD_SHA ?? ''
