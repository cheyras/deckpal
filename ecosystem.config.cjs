// pokedex — pm2 process definitions.
//
// ⚠ NOT ACTIVATED by Phase 2 task 1. This file exists for a later (hardening) task.
// Do NOT `pm2 start` this yet, and do NOT merge it into
// /home/cheyras/thegrid-api/ecosystem.config.cjs without the user's say-so — six services
// the user depends on live in that file.
//
// Ports 3700-3709 are localhost-only; nginx is the sole ingress (ARCHITECTURE §4).
// Secrets (PGPASSWORD etc.) come from /home/cheyras/pokedex/.env, loaded by @pokedex/db's
// loadEnv() at process start — they are deliberately NOT inlined here (unlike some older
// apps in thegrid-api) so this file can be committed.
//
// Memory ceilings follow the house convention and DATA-LAYER §6.5:
//   api ~80-120MB steady -> 400M ceiling; sync ~150MB peak -> 512M ceiling.

module.exports = {
  apps: [
    {
      name: 'pokedex-api',
      script: 'dist/index.js',
      cwd: '/home/cheyras/pokedex/apps/api',
      interpreter: '/usr/bin/node',
      env: { NODE_ENV: 'production', POKEDEX_API_PORT: 3700, PGPOOL_MAX_API: 2, PGAPPNAME: 'pokedex-api' },
      exec_mode: 'fork',
      max_memory_restart: '400M',
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
      // No listening socket; the node-cron scheduler. Gets 1 of the 3-connection budget.
      env: { NODE_ENV: 'production', PGPOOL_MAX_SYNC: 1, PGAPPNAME: 'pokedex-sync' },
      exec_mode: 'fork',
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
    },
  ],
};
