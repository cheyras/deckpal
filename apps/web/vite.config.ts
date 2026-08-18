import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import designEditor from './vite-plugins/design-editor.ts'

// Worktree branches that change the API run their own instance and point the dev
// proxy at it via DECKPAL_DEV_API_PORT (see roadmap/ORCHESTRATION.md port table).
const devApiPort = process.env.DECKPAL_DEV_API_PORT ?? '3700';

// vite.config.ts runs in plain Node, so process.env doesn't see apps/web/.env.local
// (Vite only injects .env files into import.meta.env for client code) — loadEnv
// reads the same files this config needs to branch on cloud vs self-host.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), 'VITE_');

// Sub-path deploy: served at /deckpal/ behind nginx (see ARCHITECTURE §4).
// Cloud (Vercel): served at / (VITE_SUPABASE_URL signals cloud mode).
// Trailing slash on base is required. Router basepath matches (minus trailing slash).
const isCloud = !!(process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL);
const basePath = isCloud ? '/' : '/deckpal/';
export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    designEditor(),
    // PWA — injectManifest (hand-written src/sw.ts) so we control the SSO
    // JSON guard, network-only mutations, and the LRU image cap (wiki: Frontend-Research §C.2).
    // start_url/scope inherit base; the SW is emitted at <base>/sw.js and can
    // only control <base>/* — exactly the desired scope.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // we call registerSW() ourselves in src/pwa.ts
      manifest: {
        name: 'DeckPal',
        short_name: 'DeckPal',
        description: 'Self-hosted Pokémon TCG collection tracker',
        id: basePath,
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1c1917', // --color-surface-primary (stone-900, theme.css)
        theme_color: '#1c1917',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Tier 0: precache the shell + all route chunks, fonts, and icons.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // The Deck-E character assets live in public/models/ so the dev route can
        // fetch them by URL, but /dev/decke is dev-only and no production user
        // will ever load them. Without this the 1 MB SDF glyph atlas lands in
        // every visitor's precache for a route they cannot reach.
        globIgnores: ['models/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5199,
    proxy: isCloud
      ? {
          // Dev-only: cloud-mode API base is /api (see apps/api/src/index.ts).
          '/api': `http://127.0.0.1:${devApiPort}`,
          // Cloud image tier is normally a Vercel function (api/images.mjs);
          // scripts/dev-images-server.mjs stands in for it locally.
          '/deckpal/images': 'http://127.0.0.1:3701',
        }
      : {
          // Dev-only: proxy API + image service so the app talks to /deckpal/... same-origin.
          '/deckpal/api': `http://127.0.0.1:${devApiPort}`,
          '/deckpal/images': 'http://127.0.0.1:3701',
        },
  },
  build: {
    // tsc is intentionally kept out of the build path (Rolldown/Vite 8).
    target: 'es2022',
    chunkSizeWarningLimit: 300,
  },
})
