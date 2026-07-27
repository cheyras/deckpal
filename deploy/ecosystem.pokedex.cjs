// pokedex — pm2 process definitions (Phase 7 deploy artifact).
//
// ⚠ NOT ACTIVATED by this phase. The lead applies this by hand (see deploy/DEPLOY.md).
// Do NOT `pm2 start` / `pm2 save` this, and do NOT merge it into
// /home/cheyras/thegrid-api/ecosystem.config.cjs — six services the user depends on
// live in that file. Start it as its OWN pm2 app list:
//   pm2 start /home/cheyras/pokedex/deploy/ecosystem.pokedex.cjs
//
// Shape matches /home/cheyras/thegrid-api/ecosystem.config.cjs exactly: fork mode,
// explicit /usr/bin/node interpreter, max_memory_restart ceiling, autorestart,
// watch:false, absolute cwd, env inline for non-secrets only.
//
// Secrets (PGPASSWORD etc.) are NOT inlined here — they load from
// /home/cheyras/pokedex/.env via @pokedex/db's loadEnv() at process start. loadEnv()
// resolves .env relative to the @pokedex/db module (repo root), so it works regardless
// of each app's cwd. This is why the file is safe to commit.
//
// Ports 3700/3701 are localhost-only; nginx is the sole ingress (ARCHITECTURE §4).
// The apps read POKEDEX_API_PORT / POKEDEX_IMAGES_PORT (not $PORT) — verified in
// apps/api/src/index.ts and apps/images/src/config.ts.
//
// Connection budget: HARD CAP 3 total (API 2 + sync 1); see .env and DECISIONS.md
// 2026-07-24 storage entry. Do NOT raise past 5 without re-checking Postgres headroom.

module.exports = {
  apps: [
    {
      name: 'pokedex-api',
      script: 'dist/index.js',
      cwd: '/home/cheyras/pokedex/apps/api',
      interpreter: '/usr/bin/node',
      env: {
        NODE_ENV: 'production',
        POKEDEX_API_PORT: 3700,
        PGPOOL_MAX_API: 2,
        PGAPPNAME: 'pokedex-api',
      },
      exec_mode: 'fork',
      // Steady state 80–120 MB (ARCHITECTURE §9 / DATA-LAYER §6.5); 256M is ~2x headroom.
      max_memory_restart: '256M',
      autorestart: true,
      watch: false,
    },
    {
      name: 'pokedex-images',
      script: 'dist/index.js',
      cwd: '/home/cheyras/pokedex/apps/images',
      interpreter: '/usr/bin/node',
      env: {
        NODE_ENV: 'production',
        POKEDEX_IMAGES_PORT: 3701,
        // CACHE_ROOT default is this same path; set explicitly to be unambiguous.
        // Layout under it is images/<lang>/<serie>/<set>/<localId>/<low|high>.webp.
        IMAGE_CACHE_ROOT: '/home/cheyras/pokedex/cache',
        PGAPPNAME: 'pokedex-images',
      },
      exec_mode: 'fork',
      max_memory_restart: '300M',
      autorestart: true,
      watch: false,
    },
    {
      name: 'pokedex-sync',
      script: 'dist/index.js',
      cwd: '/home/cheyras/pokedex/apps/sync',
      interpreter: '/usr/bin/node',
      // No listening socket — the node-cron scheduler. Gets 1 of the 3-connection budget.
      env: {
        NODE_ENV: 'production',
        PGPOOL_MAX_SYNC: 1,
        PGAPPNAME: 'pokedex-sync',
      },
      exec_mode: 'fork',
      // Price ingest buffers TCGCSV/Cardmarket payloads; 512M matches the house
      // ceiling for the analogous podscribe/karakeep workers' headroom class.
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
    },
  ],
};
