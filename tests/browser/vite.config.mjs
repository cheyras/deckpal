import { defineConfig } from '../../apps/web/node_modules/vite/dist/node/index.js'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url))
// `resolve` returns a filesystem path; on Windows that is `E:\…`, which the ESM
// loader rejects as an unknown URL scheme. Import it as a file URL.
const { default: react } = await import(pathToFileURL(requireWeb.resolve('@vitejs/plugin-react')).href)
const { default: tailwindcss } = await import(pathToFileURL(requireWeb.resolve('@tailwindcss/vite')).href)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: false,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: {
    react: fileURLToPath(new URL('../../apps/web/node_modules/react', import.meta.url)),
    'react-dom': fileURLToPath(new URL('../../apps/web/node_modules/react-dom', import.meta.url)),
    // `PwaUi` (fixture's `?offline` mode) pulls in `apps/web/src/pwa.ts`,
    // which imports the real app's `virtual:pwa-register` — only resolvable
    // when the `vite-plugin-pwa` plugin is registered. This fixture doesn't
    // need real SW registration, just a module the bundler can resolve.
    'virtual:pwa-register': fileURLToPath(new URL('pwaRegisterStub.ts', import.meta.url)),
    // The same copy the chat hook imports, so the fixture's provider is the one it reads.
    '@tanstack/react-query': fileURLToPath(new URL('../../apps/web/node_modules/@tanstack/react-query', import.meta.url)),
  } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
  },
  build: { rollupOptions: { input: fileURLToPath(new URL('fixture.html', import.meta.url)) } },
})
