import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Worktree branches that change the API run their own instance and point the dev
// proxy at it via DECKSCOUT_DEV_API_PORT (see roadmap/ORCHESTRATION.md port table).
const devApiPort = process.env.DECKSCOUT_DEV_API_PORT ?? '3700';

// Sub-path deploy: served at /deckscout/ behind nginx (see ARCHITECTURE §4).
// Cloud (Vercel): served at / (VITE_SUPABASE_URL signals cloud mode).
// Trailing slash on base is required. Router basepath matches (minus trailing slash).
const isCloud = !!process.env.VITE_SUPABASE_URL;
const basePath = isCloud ? '/' : '/deckscout/';
export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
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
        name: 'DeckScout',
        short_name: 'DeckScout',
        description: 'Self-hosted Pokémon TCG collection tracker',
        id: basePath,
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#15181f', // surface-primary (UI-SPEC dark)
        theme_color: '#15181f',
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
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5199,
    proxy: {
      // Dev-only: proxy API + image service so the app talks to /deckscout/... same-origin.
      '/deckscout/api': `http://127.0.0.1:${devApiPort}`,
      '/deckscout/images': 'http://127.0.0.1:3701',
    },
  },
  build: {
    // tsc is intentionally kept out of the build path (Rolldown/Vite 8).
    target: 'es2022',
    chunkSizeWarningLimit: 300,
  },
})
