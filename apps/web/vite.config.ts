import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Sub-path deploy: served at /pokedex/ behind nginx (see ARCHITECTURE §4).
// Trailing slash on base is required. Router basepath is /pokedex (no slash).
export default defineConfig({
  base: '/pokedex/',
  plugins: [react(), tailwindcss()],
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
