import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import designEditor from './vite-plugins/design-editor.ts'
import { LIVE_ORIGIN, fetchPublicConfig } from './live-backend.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Which backend does the dev server talk to?
//
// Default: the live product (https://deckpal.app) — real accounts, real data,
// real images, zero setup. See AGENTS.md B12 for why that is the default and
// what it obliges you to do.
//
// This file is the SINGLE place the cloud/self-host decision is made. It used
// to be made independently in four places (this config, src/lib/supabase.ts,
// src/main.tsx's router basepath, src/lib/api.ts's BASE) by each reading
// VITE_SUPABASE_URL for itself. That is fine when the variable comes from a
// .env file, because they all read the same file — but the moment the dev
// server started *deriving* a default, they disagreed: main.tsx would put the
// router on /deckpal while this config served from /, and every route 404'd.
// So the values are resolved here once and injected with `define`; every
// consumer keeps reading import.meta.env and cannot drift.
//
// The whole mechanism is gated on `command === 'serve'`. `vite build` — what
// Vercel runs, and what a self-hoster runs — never sees an injected value and
// behaves exactly as it did before this existed.
// ─────────────────────────────────────────────────────────────────────────────

/** Reject writes that would land on real production data before they leave the dev box. */
function devWriteGuard(active: boolean, allowBugs: boolean): Plugin {
  return {
    name: 'deckpal-dev-write-guard',
    configureServer(server) {
      if (!active) return
      // Registered here (not in the returned post-hook) so it runs BEFORE
      // Vite's own proxy middleware and can actually stop the request.
      server.middlewares.use((req, res, next) => {
        const isBugPost = req.method === 'POST' && (req.url ?? '').startsWith('/api/bugs')
        if (!isBugPost || allowBugs) return next()
        // The bug reporter files a real issue on the real GitHub repo. A
        // verification loop that clicks it spams the actual tracker, and the
        // issues are indistinguishable from a user's.
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            error: {
              message:
                'Blocked by the dev server: POST /api/bugs would open a real issue on ' +
                'github.com/cheyras/deckpal. Re-run with DECKPAL_DEV_ALLOW_BUGS=1 if you mean it.',
            },
          }),
        )
      })
    },
  }
}

export default defineConfig(async ({ command }) => {
  const isDevServer = command === 'serve'

  // vite.config.ts runs in plain Node, so process.env doesn't see
  // apps/web/.env.local (Vite only injects .env files into import.meta.env for
  // client code) — loadEnv reads the same files this config needs to branch on.
  const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), 'VITE_')

  // An explicit VITE_SUPABASE_URL always wins: someone who configured their own
  // Supabase (a fork, a local supabase CLI stack) means it.
  const explicitUrl = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || ''
  const explicitAnon = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || ''

  // Worktree lanes (roadmap/ORCHESTRATION.md) run their own API on their own
  // port and point the proxy at it. If that variable is set, the developer is
  // unambiguously working on a local API — defaulting them to the live backend
  // would silently NOT exercise the very changes they are testing.
  const laneApiPort = process.env.DECKPAL_DEV_API_PORT
  const backend = process.env.DECKPAL_DEV_BACKEND ?? (laneApiPort ? 'local' : 'live')
  const devOrigin = process.env.DECKPAL_DEV_ORIGIN || LIVE_ORIGIN

  const useLive = isDevServer && backend !== 'local' && !explicitUrl
  const live = useLive ? await fetchPublicConfig(devOrigin) : null

  if (isDevServer) {
    const target = live ? `LIVE — ${devOrigin}` : `local — 127.0.0.1:${laneApiPort ?? '3700'}`
    console.log(`\n  \x1b[1mDeckPal dev backend:\x1b[0m ${target}`)
    if (live) {
      console.log('  Real accounts and real data. Sign in with the QA account, not the owner account.')
      console.log('  Local stack instead: pnpm dev --local\n')
    } else {
      console.log('')
    }
  }

  const supabaseUrl = explicitUrl || live?.supabaseUrl || ''
  const supabaseAnon = explicitAnon || live?.supabaseAnonKey || ''

  // Sub-path deploy: served at /deckpal/ behind nginx (see ARCHITECTURE §4).
  // Cloud (Vercel): served at / (a Supabase URL signals cloud mode).
  // Trailing slash on base is required. Router basepath matches (minus trailing slash).
  const isCloud = !!supabaseUrl
  const basePath = isCloud ? '/' : '/deckpal/'
  const apiPrefix = isCloud ? '/api' : '/deckpal/api'
  const proxyTarget = live ? devOrigin : `http://127.0.0.1:${laneApiPort ?? '3700'}`

  return {
    base: basePath,
    // Only injected when the dev server derived these itself. On `vite build`
    // both are undefined and Vite's ordinary .env handling applies untouched.
    ...(isDevServer && live
      ? {
          define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnon),
            // Drives the in-app LIVE ribbon (src/components/DevBackendRibbon.tsx).
            'import.meta.env.VITE_DEV_LIVE_ORIGIN': JSON.stringify(devOrigin),
          },
        }
      : {}),
    plugins: [
      react(),
      tailwindcss(),
      designEditor(),
      devWriteGuard(!!live, process.env.DECKPAL_DEV_ALLOW_BUGS === '1'),
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
          description: 'Pokémon TCG collection tracker',
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
          // /dev/decke ships to production but is owner-only, so its chunk and
          // its assets exist in the build and almost nobody should ever fetch
          // them. Both are excluded from the precache manifest:
          //
          //   models/**      5.6 MB of glb, HDRI and the SDF glyph atlas
          //   assets/Decke-* ~1.17 MB — three.js plus the character runtime.
          //   dev-assets/**  13.3 MB — OpenCV 5.0.0 (opencv.js), the real-OpenCV
          //                  engine /dev/scan-harness lazy-loads on demand for its
          //                  Engine A/B toggle. Same shape of risk as the character:
          //                  a dev-only route whose heavy payload must be fetched
          //                  only by whoever actually clicks into it, not by every
          //                  visitor's service worker on first load.
          //   scan-assets/** ~19 MB — the SHIPPING scanner engine's runtime:
          //                  DocAligner LC050 (lc050.onnx, 4.9 MB) plus the
          //                  onnxruntime-web wasm-only bundle it runs on
          //                  (ort.wasm.min.mjs + ort-wasm-simd-threaded.mjs +
          //                  the 14 MB ort-wasm-simd-threaded.wasm). Unlike
          //                  dev-assets this is NOT dev-only — but it is still
          //                  route-lazy: src/scan/engine/model.ts fetches it on
          //                  the first ready() call from the scan route, never
          //                  at page load. Precaching it would push 19 MB into
          //                  every visitor's cache on first load, including the
          //                  visitors who never open the scanner. DECISIONS.md
          //                  2026-09-02 ("a pretrained corner model replaces
          //                  classical CV") states this exclusion as a shipping
          //                  condition of the model.
          //   Measured from `pnpm --filter deckpal-web build` on 2026-08-22
          //   rather than estimated, and DELIBERATELY APPROXIMATE: it drifts
          //   with every dependency bump, and a precise figure written down in
          //   four places is a figure three of them will be wrong about. An
          //   adversarial review caught exactly that happening to this number
          //   within the same branch that "corrected" it.
          //
          //   THE NUMBER IS NOT THE CONTROL. `scripts/check-precache.mjs`,
          //   which `pnpm --filter deckpal-web build` runs, is: it asserts no
          //   character payload reaches the service worker's precache
          //   manifest, whatever the chunk happens to weigh. If you are here
          //   because the size looks wrong, run the build and read that line.
          //
          // Precaching is eager: without these, the service worker pulls 6.5 MB
          // into EVERY visitor's cache on first load, for a route exactly one
          // account can open. The route is lazy, so with them the cost is paid
          // only by whoever actually opens it.
          globIgnores: ['models/**', 'assets/Decke-*.js', 'dev-assets/**', 'scan-assets/**'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        // Leave this off. Turning it on would put the service worker in front of
        // a dev server that now proxies PRODUCTION data, caching real users'
        // responses to local disk under a localhost origin.
        devOptions: { enabled: false },
      }),
    ],
    server: {
      port: 5199,
      proxy: {
        // One target, whether it is the live deployment or a local API. The
        // client asks for `apiPrefix`; both shapes are forwarded verbatim
        // because the remote serves /api and a local self-host API serves
        // /deckpal/api — the prefix already encodes which one is in play.
        [apiPrefix]: { target: proxyTarget, changeOrigin: true },
        // Cloud image tier is a Vercel function (api/images.mjs); locally,
        // scripts/dev-images-server.mjs stands in for it. Against the live
        // backend some paths 302 to Supabase Storage, which the browser follows
        // directly — fine for <img>, and fine for a WebGL texture ONLY because
        // the Supabase object answers with `access-control-allow-origin: *` and
        // the first hop is same-origin. Deck-E loads card art as textures and so
        // depends on both halves of that; see `character/decke/cardArt.ts` for
        // the cache-poisoning trap that comes with it.
        '/deckpal/images': live
          ? { target: devOrigin, changeOrigin: true }
          : { target: 'http://127.0.0.1:3701', changeOrigin: true },
        // So the Connect/agent-access panel shows a URL that actually resolves.
        '/mcp': { target: proxyTarget, changeOrigin: true },
      },
    },
    build: {
      // tsc is intentionally kept out of the build path (Rolldown/Vite 8).
      target: 'es2022',
      chunkSizeWarningLimit: 300,
      rollupOptions: {
        output: {
          // ONE CHUNK FOR THE CHARACTER, AND IT IS NAMED.
          //
          // `globIgnores` below excludes the character from the service worker's
          // precache BY NAME (`assets/Decke-*.js`), and `check-precache.mjs`
          // gate ONE fails the build if a precached script CONTAINS three.js —
          // by content, precisely because the name-based exclusion is fragile.
          //
          // It became fragile the moment a second module lazily imported the
          // engine. `/dev/decke` was the only importer, so its route chunk was
          // `Decke-<hash>.js` and the glob matched. The persistent host is a
          // second dynamic importer of the same modules, so the bundler hoists
          // three.js and `character/decke/**` into a SHARED chunk whose name it
          // picks — and a shared chunk named anything else is 1.14 MB of three.js
          // in every visitor's precache, which is the exact failure the gate's
          // own header comment predicts.
          //
          // Naming the group pins it: `[name]` resolves to `Decke-runtime`, the
          // emitted file is `assets/Decke-runtime-<hash>.js`, and it matches the
          // glob no matter how many modules import the engine from now on.
          // AND THE APP'S OWN SHARED CODE MUST NOT BE SWEPT INTO IT.
          //
          // A group does not only collect the modules its `test` matches — it
          // also absorbs their DEPENDENCIES, when nothing else has claimed them
          // first. `character/decke/cardSource.ts` imports `lib/api.ts`, so
          // `lib/api.ts` was pulled into the character group, and with it
          // `lib/supabase.ts`, `lib/landingRoute.ts` and `lib/returningVisitor.ts`.
          //
          // Those four are imported by roughly fifty modules the ENTRY reaches:
          // `main.tsx`, `AppShell`, `AuthGuard`, every route. So the entry chunk
          // gained a static import of the character chunk, and Vite — correctly,
          // for a static entry dependency — wrote a `<link rel="modulepreload">`
          // for it into `index.html`. That handed 361 kB gzipped of three.js to
          // every visitor at high priority, ahead of first paint, on a route two
          // accounts can open. Measured on production: 6.3 s to first content on
          // a throttled cold load against 0.3 s warm — issue #75, reported as
          // "a blank gray screen that wouldn't load for a while".
          //
          // Claiming those modules FIRST, at a higher priority, is what stops the
          // absorption: the character group can still reference them, it just
          // cannot own them, so the edge from the entry now points at the app's
          // own plumbing instead of at three.js.
          //
          // WHAT `app-lib` CLAIMS, and why it is those two patterns:
          //
          //   `src/lib/**`            — the app's shared plumbing (api, supabase,
          //                             routing helpers). Everything imports it.
          //   `src/character/*.ts`    — the FLAT files directly under `character/`,
          //                             and nothing in `character/decke/`. This is
          //                             the deliberate boundary layer: modules the
          //                             app shell is allowed to touch that do NOT
          //                             import three.js. `viewport.ts`, `beacon.ts`
          //                             and `cardSource.ts` were moved out of
          //                             `decke/` to sit here, because `DeckeBeacon`
          //                             and `useCardArt` import them statically and
          //                             each such import was one more rope tying
          //                             the entry to the engine.
          //
          // So the directory now means something enforceable: `character/decke/`
          // is the engine and is NEVER on the critical path; `character/*.ts` is
          // the boundary the shell may import; `character/host/**` is the React
          // host in between. A new file that both the shell and the engine need
          // goes in the boundary layer, not in `decke/`.
          //
          // DO NOT widen `app-lib` to "everything except decke". That was tried:
          // the group then absorbs three.js as a dependency of `character/host`
          // and emits ONE 2.3 MB chunk that is both precached and preloaded —
          // strictly worse than the bug being fixed. `check-precache.mjs` gate
          // ONE catches it, which is how we know.
          //
          // `check-precache.mjs` gate THREE fails the build if the character is
          // ever on the document's critical path again. Gate ONE only ever
          // watched the service worker's door; this walked in through the other.
          advancedChunks: {
            groups: [
              {
                name: 'app-lib',
                test: /[\\/]src[\\/]lib[\\/]|[\\/]src[\\/]character[\\/][^\\/]+\.tsx?$/,
                priority: 20,
              },
              {
                name: 'Decke-runtime',
                test: /[\\/]node_modules[\\/]three[\\/]|[\\/]src[\\/]character[\\/]decke[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
  }
})
