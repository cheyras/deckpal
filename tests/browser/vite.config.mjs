import { defineConfig } from '../../apps/web/node_modules/vite/dist/node/index.js'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const { default: react } = await import(requireWeb.resolve('@vitejs/plugin-react'))
const { default: tailwindcss } = await import(requireWeb.resolve('@tailwindcss/vite'))
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: false,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: {
    react: fileURLToPath(new URL('../../apps/web/node_modules/react', import.meta.url)),
    'react-dom': fileURLToPath(new URL('../../apps/web/node_modules/react-dom', import.meta.url)),
  } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
  },
  build: { rollupOptions: { input: fileURLToPath(new URL('fixture.html', import.meta.url)) } },
})
