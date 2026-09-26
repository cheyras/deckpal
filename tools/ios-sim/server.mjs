// DeckPal iOS Simulator fixture server.
//
// Serves the real built web app (cloud mode) at a fixed local port, faking a
// signed-in session and a hermetic fixture API -- no real accounts, no real
// backend, no secrets. Built on the repo's existing Playwright fixture harness
// (tests/browser/support.mjs + admin.mjs + feedback.mjs), which already knows
// how to build the SPA and how to plant a fake Supabase session -- this file
// adds only what those don't: a fixed port, a couple of card/list/pokedex
// routes worth poking at in a real WKWebView, and a static-file server that
// stays up instead of tearing down after one test.
//
// Usage:
//   pnpm sim:serve                                              # build (if needed) + serve, foreground
//   pnpm sim:serve -- --port 5410                                # serve on a different port
//   node --import tsx tools/ios-sim/server.mjs                   # same, without pnpm
//   nohup node --import tsx tools/ios-sim/server.mjs > /tmp/deckpal-sim.log 2>&1 &   # background
//
// `--import tsx` is required on plain `node` (this repo's minimum is Node 20):
// admin.mjs -> upcoming.mjs imports a .ts file directly, which only Node's own
// native type stripping (unflagged since Node ~23) or a loader can resolve.
//
// Then, from the simulator's Safari: visit http://localhost:<port>/__seed once
// to sign in, and use the app from there. See tools/ios-sim/README.md for the
// full runbook (Web Inspector attach, Home Screen install, keyboard probe).
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { adminFixture } from '../../tests/browser/admin.mjs'
import { buildWeb } from '../../tests/browser/support.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_PORT = 5310
const NOW = '2026-09-12T18:00:00Z'
const FAKE_USER_ID = '10000000-0000-4000-8000-000000000002' // matches feedback.mjs's non-owner USER id

export function parseArgs(argv) {
  let port = DEFAULT_PORT
  let rebuild = false
  for (let i = 0; i < argv.length; i++) {
    // `pnpm sim:serve -- --port 5410` -- pnpm does not always strip the `--` separator before
    // forwarding to the underlying script (observed: it didn't here), so a leading one is a
    // normal, harmless no-op rather than an error the quickstart's own documented command hits.
    if (argv[i] === '--' && i === 0) continue
    if (argv[i] === '--port') port = Number(argv[++i])
    else if (argv[i] === '--rebuild') rebuild = true
    else throw new Error(`Unknown argument: ${argv[i]} (known: --port <n>, --rebuild)`)
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error(`--port must be a positive integer, got: ${port}`)
  return { port, rebuild }
}

// Everything below builds the fixture's ROUTING -- no build, no socket, no filesystem beyond
// what admin.mjs itself touches -- so it is importable and testable on its own (see
// __tests__/server.test.mjs). `main()` is the only part that builds the SPA and binds a port.
export function createFixture() {
  // ── Base fixture state, reusing the real admin/feedback fixture ──────────
  const admin = adminFixture('') // mount='' == cloud
  const { state } = admin
  state.actor = 'ordinary' // signed-in, NON-OWNER regular user
  state.permissions = [] // no admin/devtools permissions
  state.signedOut = false
  state.users[0].id = FAKE_USER_ID

  // ── 3. Fake card catalog (search + showcase) ──────────────────────────────
  const PLACEHOLDER_IMG = { low: '/__fixture/card.svg', high: '/__fixture/card.svg' }
  const PRICE = { market: 4.5, low: 3, mid: 4.5, high: 6, currency: 'USD' }
  function fakeCatalogCard(id, name, number) {
    return {
      cardId: id, number, name, category: 'Pokémon', rarity: 'Rare', artist: 'Fixture Artist',
      regulationMark: null, set: { setId: 'sim1', name: 'Simulator Set' },
      series: { slug: 'sim', name: 'Simulator Series' }, variantCount: 1, images: PLACEHOLDER_IMG, price: PRICE,
    }
  }
  const CATALOG = [
    fakeCatalogCard('sim1-1', 'Simuchu', '001'),
    fakeCatalogCard('sim1-2', 'Fixturemon', '002'),
    fakeCatalogCard('sim1-3', 'Testadactyl', '003'),
    fakeCatalogCard('sim1-4', 'Mockipom', '004'),
    fakeCatalogCard('sim1-5', 'Stubbicoon', '005'),
  ]
  // One synthetic "primary variant" id per catalog card, shared by the card-detail route
  // (which advertises it) and the add-to-list route (which resolves it back to a card) --
  // one formula, so the two routes cannot silently disagree about what a variant id means.
  const variantIdForCard = (card) => 9000 + Number(card.number)
  const cardForVariantId = (variantId) => CATALOG.find((c) => variantIdForCard(c) === variantId)

  // ── 4. Fake "My Lists" data ────────────────────────────────────────────────
  let lists = [{
    id: 'list-1', kind: 'dynamic', name: 'My Simulator List', description: 'A fixture list for iOS keyboard testing',
    visibility: 'private', isFavorite: false, coverRender: '', pocketSize: null, itemCount: 0,
    progress: null, marketValueUsd: 0, coverImage: null, coverImages: [],
    rule: null, ruleEvaluatedAt: null, createdAt: NOW, updatedAt: NOW,
  }]
  let nextListId = 2
  let nextItemId = 1
  // listId -> ListItem[] (see apps/web/src/lib/api.ts's ListItem/ListDetailResponse). Kept
  // separate from `lists` because the real API does too: itemCount lives on the summary,
  // the rows live in the detail response. ListDetail.tsx refetches this after every mutation,
  // so a count-only fixture (itemCount alone) makes an add LOOK like it worked while the grid
  // stays empty -- caught by Astra's review; see DECISIONS.md.
  const listItems = { 'list-1': [] }

  // ── 5. Fake owned Pokédex species (feeds the Profile "Pick a Showcase Card" sheet) ──
  const SPECIES = [
    { speciesId: 1, slug: 'simuchu', name: 'Simuchu', cards: [CATALOG[0], CATALOG[1]] },
    { speciesId: 2, slug: 'fixturemon', name: 'Fixturemon', cards: [CATALOG[2]] },
  ]

  // ── 6. Custom fixture routes ────────────────────────────────────────────────
  const unmatchedApiPaths = new Set()
  const ok = (body, extra = {}) => ({ body, headers: { 'Cache-Control': 'no-store, private' }, ...extra })

  function customResponse(rel, url, { method, body } = { method: 'GET' }) {
    // Placeholder image, used by every fake card in this fixture.
    if (rel === '/__fixture/card.svg') {
      return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" rx="12" fill="#64748b"/><text x="100" y="145" font-size="16" fill="#fff" text-anchor="middle">Fixture</text></svg>', type: 'image/svg+xml' }
    }

    // Never let a real service worker install over this fixture.
    if (rel === '/sw.js') return { status: 404, body: 'no service worker in the sim fixture', type: 'text/plain' }

    // Seed page: plants the same fake Supabase session shape the Playwright
    // fixtures use (see tests/browser/admin.mjs `signIn`), then bounces to /lists.
    if (rel === '/__seed') {
      const html = `<!doctype html><html><body>
<script>
  var token = btoa(JSON.stringify({alg:'HS256',typ:'JWT'})) + '.' +
    btoa(JSON.stringify({sub:${JSON.stringify(FAKE_USER_ID)}, exp:4102444800, role:'authenticated'})) + '.fixture'
  var session = {
    access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: 4102444800,
    user: { id: ${JSON.stringify(FAKE_USER_ID)}, email: 'fixture@example.invalid', aud: 'authenticated',
      role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: ${JSON.stringify(NOW)} },
  }
  localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
  localStorage.setItem('deckpal.settings.pushed.v1', '1')
  location.replace('/lists')
</script>
Signing you in…
</body></html>`
      return { raw: html, type: 'text/html' }
    }

    // Bug report -- never contacts GitHub, always succeeds.
    if (rel === '/api/bugs' && method === 'POST') {
      return ok({ id: 'bug-fixture-' + Date.now(), saved: 'fixture', note: 'Simulator fixture: never contacts GitHub or persists anywhere real.' })
    }

    // ── Lists ──
    if (rel === '/api/lists' && method === 'GET') {
      if (url.searchParams.get('deleted') === 'true') return ok({ lists: [] })
      return ok({ lists })
    }
    if (rel === '/api/lists' && method === 'POST') {
      const list = {
        id: 'list-' + nextListId++, kind: body.kind ?? 'dynamic', name: body.name, description: body.description ?? null,
        visibility: body.visibility ?? 'private', isFavorite: false, coverRender: '', pocketSize: null, itemCount: 0,
        progress: null, marketValueUsd: 0, coverImage: null, coverImages: [],
        rule: body.rule ?? null, ruleEvaluatedAt: body.rule ? NOW : null, createdAt: NOW, updatedAt: NOW,
      }
      lists.push(list)
      listItems[list.id] = []
      return ok({ list })
    }
    if (/^\/api\/lists\/[^/]+$/.test(rel) && method === 'GET') {
      const id = rel.split('/').at(-1)
      const list = lists.find((l) => l.id === id)
      if (!list) return { status: 404, body: { error: { message: 'No such list' } } }
      return ok({ list, items: listItems[id] ?? [] })
    }
    if (/^\/api\/lists\/[^/]+$/.test(rel) && method === 'PATCH') {
      const id = rel.split('/').at(-1)
      const list = lists.find((l) => l.id === id)
      if (!list) return { status: 404, body: { error: { message: 'No such list' } } }
      Object.assign(list, body, { updatedAt: NOW })
      return ok({ list })
    }
    if (/^\/api\/lists\/[^/]+$/.test(rel) && method === 'DELETE') {
      const id = rel.split('/').at(-1)
      return ok({ deleted: id, restorable: true })
    }
    if (/^\/api\/lists\/[^/]+\/restore$/.test(rel) && method === 'POST') {
      const id = rel.split('/')[3]
      return ok({ restored: id, list: lists.find((l) => l.id === id) ?? lists[0] })
    }
    if (/^\/api\/lists\/[^/]+\/items$/.test(rel) && method === 'POST') {
      const id = rel.split('/')[3]
      const list = lists.find((l) => l.id === id)
      if (!list) return { status: 404, body: { error: { message: 'No such list' } } }
      const card = cardForVariantId(body.cardVariantId)
      if (!card) return { status: 400, body: { error: { message: 'Unknown fixture cardVariantId: ' + body.cardVariantId } } }
      const items = listItems[id] ?? (listItems[id] = [])
      const itemId = 'item-' + nextItemId++
      // A real ListItem (extends CardRow -- see apps/web/src/lib/api.ts), so GridView/
      // TableView/BinderView render it exactly as they would a real list's rows.
      items.push({
        itemId, position: items.length, itemKind: 'card', variantId: body.cardVariantId,
        variant: { kind: 'normal', displayName: 'Normal', tier: 'standard', isPrimary: true },
        cardId: card.cardId, number: card.number, numberSort: card.number, name: card.name,
        category: card.category, rarity: card.rarity, artist: card.artist, variantCount: card.variantCount,
        images: card.images, price: card.price, setName: card.set.name, seriesSlug: card.series.slug, setId: card.set.setId,
        staticQuantity: list.kind === 'static' ? (body.staticQuantity ?? 1) : null, ownedQuantity: 0,
      })
      list.itemCount++
      list.updatedAt = NOW
      return ok({ itemId, alreadyPresent: false, list })
    }
    if (/^\/api\/lists\/[^/]+\/items\/[^/]+$/.test(rel) && method === 'DELETE') {
      const id = rel.split('/')[3]
      const itemId = rel.split('/').at(-1)
      const list = lists.find((l) => l.id === id)
      const items = listItems[id]
      const index = items ? items.findIndex((item) => item.itemId === itemId) : -1
      if (index !== -1) {
        items.splice(index, 1)
        if (list) { list.itemCount = Math.max(0, list.itemCount - 1); list.updatedAt = NOW }
      }
      return ok({ deleted: itemId, list: list ?? null })
    }

    // ── Card search (Add Cards modal) ──
    if (rel === '/api/search' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const pageSize = Number(url.searchParams.get('pageSize') ?? 24)
      const cards = q ? CATALOG.filter((c) => c.name.toLowerCase().includes(q) || c.number.includes(q)) : CATALOG
      return ok({ pagination: { page: 1, pageSize, total: cards.length, pageCount: 1 }, cards: cards.slice(0, pageSize) })
    }

    // ── Card detail (ListDetail's "Add" reads this for the primary variant
    // before it can mutate -- api.card(cardId).variants.find(v => v.isPrimary))──
    if (/^\/api\/cards\/sim1-\d+$/.test(rel) && method === 'GET') {
      const card = CATALOG.find((c) => c.cardId === rel.split('/').at(-1))
      if (!card) return { status: 404, body: { error: { message: 'No such fixture card' } } }
      const variantId = variantIdForCard(card)
      return ok({
        card: {
          cardId: card.cardId, number: card.number, printedTotal: CATALOG.length, name: card.name,
          category: card.category, rarity: card.rarity, artist: card.artist, hp: null, stage: null,
          evolvesFrom: null, retreat: null, regulationMark: null, releasedOn: null,
          set: { setId: card.set.setId, name: card.set.name, slug: card.set.setId, logoUrl: null, symbolUrl: null },
          series: { slug: card.series.slug, name: card.series.name, tcgdexId: card.series.slug },
          images: card.images, types: [], subtypes: [], tags: [], attacks: [], abilities: [],
          weaknesses: [], resistances: [], species: [],
        },
        variants: [{
          variantId, kind: 'normal', displayName: 'Normal', provenance: null, tier: 'standard',
          isPrimary: true, source: 'fixture', quantity: 0, buyUrl: null, prices: [],
        }],
      })
    }

    // ── Owned Pokédex species (feeds Profile's "Pick a Showcase Card") ──
    if (rel === '/api/insights/pokedex' && method === 'GET') {
      const species = SPECIES.map((s) => ({
        speciesId: s.speciesId, slug: s.slug, name: s.name, genus: 'Fixture Pokémon', generation: 1,
        types: ['normal'], cardPool: s.cards.length, uniqueOwned: s.cards.length, captured: true, level: 1,
        levelLabel: 'Lv. 1', shiny: false, shinyBreadth: 0,
        sprite: { pixel: '/__fixture/card.svg', pixelShiny: '/__fixture/card.svg', art: '/__fixture/card.svg', artShiny: '/__fixture/card.svg' },
      }))
      return ok({ completion: { captured: species.length, total: species.length }, pagination: { page: 1, pageSize: species.length, total: species.length, pageCount: 1 }, species })
    }
    if (/^\/api\/insights\/pokedex\/\d+$/.test(rel) && method === 'GET') {
      const id = Number(rel.split('/').at(-1))
      const s = SPECIES.find((s) => s.speciesId === id)
      const cards = (s?.cards ?? []).map((c) => ({
        cardId: c.cardId, number: c.number, name: c.name, category: c.category, rarity: c.rarity, artist: c.artist,
        set: c.set, variantCount: c.variantCount, owned: true, ownedQuantity: 1, images: c.images, price: c.price,
      }))
      return ok({ species: { speciesId: id, slug: s?.slug ?? 'unknown', name: s?.name ?? 'Unknown', genus: 'Fixture Pokémon', generation: 1, types: ['normal'], evolutions: [], sprite: { pixel: '/__fixture/card.svg', pixelShiny: '/__fixture/card.svg', art: '/__fixture/card.svg', artShiny: '/__fixture/card.svg' } }, cards })
    }

    // ── Minimal public catalog (never deeply exercised by this fixture) ──
    if (rel === '/api/series' && method === 'GET') return ok({ series: [{ id: 1, slug: 'sim', name: 'Simulator Series', setCount: 1, cardCount: CATALOG.length, sortOrder: 1 }] })
    if (rel === '/api/series/sim' && method === 'GET') return ok({ series: { id: 1, slug: 'sim', name: 'Simulator Series', firstReleaseOn: NOW }, sets: [{ setId: 'sim1', slug: 'sim1', name: 'Simulator Set', releasedOn: NOW, isPromo: false, printedCount: CATALOG.length, secretCount: 0, cardCountTotal: CATALOG.length, logoUrl: null, symbolUrl: null }] })

    return null // not handled here -- fall through
  }

  function respondApi(rel, url, req) {
    const custom = customResponse(rel, url, req)
    if (custom) return custom

    const fromAdmin = admin.response(rel, url, req)
    if (fromAdmin) return fromAdmin

    if (rel.startsWith('/api/')) {
      if (!unmatchedApiPaths.has(rel)) {
        unmatchedApiPaths.add(rel)
        console.log('[sim] unknown API path, returning empty 200:', req.method, rel)
      }
      return { body: {} }
    }
    return null
  }

  return { admin, respondApi }
}

export async function main(argv = process.argv.slice(2)) {
  const { port, rebuild } = parseArgs(argv)
  const origin = `http://127.0.0.1:${port}`
  // `dist` is gitignored (repo-wide `dist/` rule) and lives inside this tool
  // rather than a sibling checkout -- there is no case-sensitivity trap to
  // route around here (fixed in #201; see DECISIONS.md), so building straight
  // from this worktree's own web source is enough.
  const dist = path.join(HERE, 'dist')

  // The auth storage key Supabase's client derives is `sb-<hostname-segment>-
  // auth-token`; for host `127.0.0.1` that's always `sb-127-auth-token`
  // regardless of port, so a build baked with one port's origin still seeds
  // and reads sessions correctly if you restart on another port. Rebuilding
  // per port is unnecessary; --rebuild forces one anyway (e.g. after editing
  // the app).
  if (rebuild || !fs.existsSync(path.join(dist, 'index.html'))) {
    console.log('[sim] building web app (cloud mode) into', dist, '...')
    console.log(buildWeb(dist, true, origin).trim().split('\n').slice(-5).join('\n'))
    console.log('[sim] build complete')
  } else {
    console.log('[sim] reusing existing build at', dist, '(pass --rebuild, or delete it, to force a rebuild)')
  }

  const { respondApi } = createFixture()

  // Serve on a fixed port. (support.mjs's `serve()` always binds a random
  // port for test isolation; this fixture needs a stable, chosen one, so
  // it's a small standalone server instead -- same static+API dispatch
  // shape, driven by the same respondApi() above. 127.0.0.1 only: this must
  // never be reachable from another device on the network.)
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    const mutation = !['GET', 'HEAD'].includes(req.method)
    let body
    if (mutation) {
      let raw = ''
      for await (const chunk of req) raw += chunk
      try { body = raw ? JSON.parse(raw) : {} } catch { body = {} }
    }
    const rel = decodeURIComponent(url.pathname)
    const response = respondApi(rel, url, { method: req.method, body, headers: req.headers })
    if (response) {
      res.writeHead(response.status ?? 200, { 'Content-Type': response.type ?? 'application/json', ...(response.headers ?? {}) })
      res.end(response.raw ?? JSON.stringify(response.body))
      return
    }
    let file = path.resolve(dist, '.' + rel)
    if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(403); res.end('Path outside fixture output'); return }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) { res.writeHead(404); res.end('Missing asset: ' + rel); return }
      file = path.join(dist, 'index.html')
    }
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
      '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  console.log(`[sim] DeckPal fixture serving at ${origin}`)
  console.log(`[sim] Seed a signed-in session: ${origin}/__seed`)
  return server
}

// Only run when invoked directly (`node server.mjs`), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[sim]', error.message)
    process.exit(1)
  })
}
