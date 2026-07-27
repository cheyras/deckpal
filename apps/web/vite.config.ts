import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Sub-path deploy: served at /pokedex/ behind nginx (see ARCHITECTURE §4).
// Trailing slash on base is required. Router basepath is /pokedex (no slash).
export default defineConfig({
  base: '/pokedex/',
  plugins: [
    react(),
    tailwindcss(),
    // PWA — injectManifest (hand-written src/sw.ts) so we control the Authelia
    // JSON guard, network-only mutations, and the LRU image cap (FRONTEND.md §C.2).
    // start_url/scope inherit base ('/pokedex/'); the SW is emitted at
    // /pokedex/sw.js and can only control /pokedex/* — exactly the desired scope.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // we call registerSW() ourselves in src/pwa.ts
      manifest: {
        name: 'pokedex',
        short_name: 'pokedex',
        description: 'Self-hosted Pokémon TCG collection tracker',
        id: '/pokedex/',
        start_url: '/pokedex/',
        scope: '/pokedex/',
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
      // Dev-only: proxy API + image service so the app talks to /pokedex/... same-origin.
      '/pokedex/api': 'http://127.0.0.1:3700',
      '/pokedex/images': 'http://127.0.0.1:3701',
    },
  },
  build: {
    // tsc is intentionally kept out of the build path (Rolldown/Vite 8).
    target: 'es2022',
    chunkSizeWarningLimit: 300,
  },
})
