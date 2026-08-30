import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRouter,
  createRootRoute,
  createRoute,
  notFound,
  redirect,
  retainSearchParams,
  stripSearchParams,
  RouterProvider,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import './theme.css'
// The premium visual pass. Every rule inside is scoped to `[data-skin='premium']`
// (set by initSkin below), so importing it is inert until the attribute is on —
// which is what makes the pass reversible without a rebuild. See lib/skin.ts.
import './premium.css'
import { initSkin } from './lib/skin'
import { preconnectArtOrigin } from './lib/cardArt'
import { initTopbar } from './lib/topbar'
import { initSettingsSync } from './lib/settingsSync'
import { registerPwa } from './pwa'
import { lazyRoute } from './lib/lazyRoute'
import { CARD_SEARCH_DEFAULTS } from './routes/setSearch'
import { AppShell } from './components/AppShell'
import { AuthGuard } from './components/AuthGuard'
import { isPublicPathname, isSafeNextPath } from './lib/landingRoute'
import { api } from './lib/api'
import { isCloudMode } from './lib/supabase'
import { readSession } from './lib/authSession'
import { isReturningVisitor } from './lib/returningVisitor'
import { Auth } from './routes/Auth'
import { Authorize } from './routes/Authorize'
import { ResetPassword } from './routes/auth/ResetPassword'
import { AcceptInvite } from './routes/auth/AcceptInvite'
import { SignedOut } from './routes/auth/SignedOut'
import { Landing } from './routes/Landing'
import { SeriesIndex } from './routes/SeriesIndex'
import { SeriesDetail } from './routes/SeriesDetail'
import { SetDetail } from './routes/SetDetail'
import { CardDetail } from './routes/CardDetail'
import { ListsIndex } from './routes/ListsIndex'
import { ListDetail } from './routes/ListDetail'
import { DecksIndex } from './routes/DecksIndex'
import { DeckBuilder } from './routes/DeckBuilder'
import { Insights } from './routes/Insights'
import { PokedexIndex } from './routes/PokedexIndex'
import { SpeciesDetail } from './routes/SpeciesDetail'
import { Profile } from './routes/Profile'
import { Scan } from './routes/Scan'
import { SearchResults } from './routes/SearchResults'
import { Family } from './routes/Family'
import { FamilyAdmin } from './routes/FamilyAdmin'
import { PriceApprovalAdmin } from './routes/PriceApprovalAdmin'
import { validateGlobalSearch, GLOBAL_SEARCH_DEFAULTS } from './routes/globalSearch'
import { validateCardSearch } from './routes/setSearch'
import { validateListSearch } from './routes/listSearch'
import { validateDeckSearch, DECK_SEARCH_DEFAULTS } from './routes/deckSearch'
import { DevBackendRibbon } from './components/DevBackendRibbon'
import { DeckeHost } from './character/host/DeckeHost'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Public by definition, and each for its own reason:
  //   • the marketing landing at `/` and every auth surface — wrapping them in
  //     AuthGuard would bounce the visitor straight to /auth, including off the
  //     page they were just sent to by email;
  //   • the catalog (/series, /pokedex, /search) — the whole point: 20,964 cards
  //     are readable without an account. AppShell still renders the nav for
  //     these; what it does NOT do is mount an authenticated query while signed
  //     out (see isChromelessPathname vs isCatalogPathname).
  const shell = isPublicPathname(pathname) ? (
    <AppShell>
      <Outlet />
    </AppShell>
  ) : (
    <AuthGuard>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGuard>
  )
  // Outside AuthGuard on purpose: when the dev server is pointed at production
  // the warning matters most on the signed-out auth screen, which is exactly
  // where you are about to type real credentials.
  //
  // `DeckeHost` is here for a related but stricter reason. `shell` above is two
  // different element trees, and crossing the public/private boundary swaps
  // `<AppShell>` for `<AuthGuard>` at this position — which unmounts everything
  // inside it. Deck-E must survive `/series` → `/decks` with his GL context and
  // his pose intact, so he cannot live in there; a sibling of `{shell}` is the
  // only tree position that survives every in-app navigation. See DeckeHost.
  return (
    <>
      <DevBackendRibbon />
      {shell}
      <DeckeHost />
    </>
  )
}

const rootRoute = createRootRoute({
  component: RootComponent,
})

// `/` is two different things depending on who is asking:
//   • self-host (no Supabase)  → straight into the app, as it always has been.
//     A self-hoster has no signup flow, so a marketing page with a dead
//     "Create your free account" button would be a cul-de-sac.
//   • cloud + signed in         → straight into the app (preserves the old
//     redirect for every existing user and every bookmarked deep link).
//   • cloud + session lapsed    → the sign-in form. They have an account; the
//     pitch to create one is the wrong page, and it is the page they got
//     (issue #50). "Lapsed" means a session existed in this browser and was
//     not deliberately signed out of — see lib/returningVisitor.ts.
//   • cloud + signed out        → the public marketing landing.
//
// THE READ IS BOUNDED, AND THIS IS THE ROUTE THAT PROVED IT HAD TO BE. A warm
// read does resolve in a tick out of localStorage — which is what the comment
// here used to claim it ALWAYS did — but inside the 90 s expiry margin, and on
// every load where the stored token has already expired, `getSession()`
// refreshes over the network first, and there is no timeout anywhere in
// `@supabase/auth-js`. `beforeLoad` is awaited before the router renders
// anything at all, so a stalled refresh left `#root` empty: an indefinite blank
// page, which is issue #75. See lib/sessionDeadline.ts.
//
// On timeout we route to `/series` rather than guess. It is public, it renders
// for signed-in and signed-out visitors alike, and it is where a signed-in
// visitor was going anyway — so "I don't know yet" costs at worst a marketing
// page nobody with an account wanted, and never a wrongful bounce to /auth.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    if (!isCloudMode) throw redirect({ to: '/series' })
    const { session, timedOut } = await readSession()
    if (session || timedOut) throw redirect({ to: '/series' })
    if (isReturningVisitor()) throw redirect({ to: '/auth' })
  },
  component: Landing,
})

const seriesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series',
  component: SeriesIndex,
})

const seriesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series/$series',
  component: SeriesDetail,
})

const setDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series/$series/$set',
  validateSearch: validateCardSearch,
  // Keep default-valued params OUT of the URL (clean canonical URL); carry the
  // chosen view across navigations. wiki: Frontend-Research §A.5.
  search: {
    middlewares: [retainSearchParams(['view']), stripSearchParams(CARD_SEARCH_DEFAULTS)],
  },
  component: SetDetail,
})

const cardDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series/$series/$set/$number',
  component: CardDetail,
})

const listsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lists',
  component: ListsIndex,
})

const listDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lists/$id',
  validateSearch: validateListSearch,
  component: ListDetail,
})

const decksIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks',
  component: DecksIndex,
})

const deckBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks/$id',
  validateSearch: validateDeckSearch,
  // Default-valued params (q='', sort=section, tab=cards) stay OUT of the URL.
  search: {
    middlewares: [stripSearchParams(DECK_SEARCH_DEFAULTS)],
  },
  component: DeckBuilder,
})

const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  component: Insights,
})

const pokedexIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pokedex',
  component: PokedexIndex,
})

// `?card=<cardId>` opens the card-detail bottom-sheet over the species page
// (leaving it mounted so scroll/owned-filter survive), same pattern as the set
// page. Only present while a card is open.
const speciesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pokedex/$speciesId',
  validateSearch: (raw: Record<string, unknown>): { card?: string } => ({
    card: typeof raw.card === 'string' && raw.card ? raw.card : undefined,
  }),
  component: SpeciesDetail,
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: Profile,
})

// pkmn.gg's canonical profile URL is /u/{name}; alias /u/me → the same surface.
const profileAliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/u/me',
  component: Profile,
})

// `?card=<cardId>` opens the card-detail bottom-sheet over the scanner match list
// without tearing down the camera/result state.
const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scan',
  validateSearch: (raw: Record<string, unknown>): { card?: string } => ({
    card: typeof raw.card === 'string' && raw.card ? raw.card : undefined,
  }),
  component: Scan,
})

const familyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/family',
  component: Family,
})

const familyAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/family/admin',
  component: FamilyAdmin,
})

const familyPriceAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/family/admin/prices',
  component: PriceApprovalAdmin,
})

// Global cross-set card search — the destination for the header search field.
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: validateGlobalSearch,
  search: { middlewares: [stripSearchParams(GLOBAL_SEARCH_DEFAULTS)] },
  component: SearchResults,
})

// Public registration is disabled for the family fork. `?mode=forgot` gives
// the password-reset request its own shareable URL; accounts originate only
// from an administrator invitation.
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  validateSearch: (raw: Record<string, unknown>): { mode?: 'forgot'; next?: string } => ({
    mode: raw.mode === 'forgot' ? 'forgot' : undefined,
    // Same-origin relative path only — /authorize is the one caller today,
    // bouncing a signed-out visitor here and back once they sign in.
    next: isSafeNextPath(raw.next) ? raw.next : undefined,
  }),
  component: Auth,
})

// The OAuth 2.1 "Connect" consent screen (apps/api/src/oauthServer.ts mints
// the authorize URL a client redirects here to). Every param stays an
// untyped string at the route layer — Authorize.tsx does the real validation
// (response_type==='code', S256 PKCE, etc.) because a malformed request here
// must render an in-app error page, not a router-level crash.
const authorizeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/authorize',
  validateSearch: (raw: Record<string, unknown>) => {
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    return {
      response_type: str(raw.response_type),
      client_id: str(raw.client_id),
      redirect_uri: str(raw.redirect_uri),
      code_challenge: str(raw.code_challenge),
      code_challenge_method: str(raw.code_challenge_method),
      state: str(raw.state),
      resource: str(raw.resource),
    }
  },
  component: Authorize,
})

// Everything below this line is Supabase-only. A self-host deploy has no
// password-reset email, no hosted sign-out and no account to recover, so these
// routes send self-hosters back into the app rather than rendering a dead end.
const cloudOnly = () => {
  if (!isCloudMode) throw redirect({ to: '/series' })
}

// Target of the recovery link in the reset email. Public: the whole point is
// that whoever opens it is NOT signed in.
const authResetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/reset',
  beforeLoad: cloudOnly,
  component: ResetPassword,
})

const authInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/invite',
  beforeLoad: cloudOnly,
  component: AcceptInvite,
})

// Where signing out lands — a confirmation, not the login form.
const signedOutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signed-out',
  beforeLoad: cloudOnly,
  component: SignedOut,
})

const coreRoutes = [
  indexRoute,
  authRoute,
  authorizeRoute,
  authResetRoute,
  authInviteRoute,
  signedOutRoute,
  seriesIndexRoute,
  seriesDetailRoute,
  setDetailRoute,
  cardDetailRoute,
  listsIndexRoute,
  listDetailRoute,
  decksIndexRoute,
  deckBuilderRoute,
  insightsRoute,
  pokedexIndexRoute,
  speciesDetailRoute,
  profileRoute,
  profileAliasRoute,
  scanRoute,
  familyRoute,
  familyAdminRoute,
  familyPriceAdminRoute,
  searchRoute,
]

// Design-system route. In dev it is the full editor (the Vite plugin serves
// the /__design write endpoints). In production it ships as an OWNER-ONLY
// read-only reference: beforeLoad checks the server-verified `designEditor`
// flag on /me and throws notFound() for everyone else, so the route is
// indistinguishable from a URL that does not exist. The flag's identity check
// lives server-side (DESIGN_EDITOR_USER_ID) — nothing about who the owner is
// appears in this bundle.
const LazyDesignSystem = lazyRoute(() => import('./routes/design/DesignSystem'))
const DesignSystemRoute = () => (
  <Suspense
    fallback={
      <div className="flex h-screen items-center justify-center text-text-muted">
        Loading design system...
      </div>
    }
  >
    <LazyDesignSystem />
  </Suspense>
)
const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  beforeLoad: async () => {
    if (import.meta.env.DEV) return
    // Self-host has exactly one user (the owner) behind their own auth proxy.
    if (!isCloudMode) return
    try {
      const me = await api.me()
      if (me.designEditor) return
    } catch {
      // Signed out, or /me unavailable — fall through to not-found.
    }
    throw notFound()
  },
  component: DesignSystemRoute,
})

// Deck-E preview. Ships to production but is OWNER-ONLY, the same shape as
// /design above: `beforeLoad` checks the server-verified `owner` flag on /me and
// throws notFound() for everyone else, so for any other visitor — signed in,
// signed out, or poking at URLs — the route is indistinguishable from one that
// never existed. The identity check lives server-side (DESIGN_EDITOR_USER_ID);
// nothing about who the owner is appears in this bundle, and if that variable is
// unset the answer is nobody. It fails closed.
//
// COST, AND WHY IT IS NOT PAID BY VISITORS. Shipping the route means rollup does
// emit the chunk — about 945 kB of three.js and the character runtime — and the
// character's 5.6 MB of assets sit in public/models. Neither is downloaded by
// anyone who does not open the route, because the import is lazy. What DOES have
// to be prevented is the service worker helpfully precaching them for every
// visitor on first load; `vite.config.ts` excludes both from the manifest, and
// that exclusion is the only thing standing between this route and a megabyte of
// dead weight in every session. Do not remove it without re-reading the note
// there.
const LazyDecke = lazyRoute(() => import('./routes/dev/Decke'))
const LazyDeckeCompare = lazyRoute(() => import('./routes/dev/DeckeCompare'))
const LazyChatUi = lazyRoute(() => import('./routes/dev/ChatUi'))
const DeckeRoute = () => (
  <Suspense
    fallback={
      <div className="flex h-screen items-center justify-center text-text-muted">
        Loading Deck-E...
      </div>
    }
  >
    <LazyDecke />
  </Suspense>
)
const deckeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/decke',
  beforeLoad: async () => {
    if (import.meta.env.DEV) return
    // Self-host has exactly one user (the owner) behind their own auth proxy.
    if (!isCloudMode) return
    try {
      const me = await api.me()
      if (me.owner) return
    } catch {
      // Signed out, or /me unavailable — fall through to not-found.
    }
    throw notFound()
  },
  component: DeckeRoute,
})

/**
 * `/dev/chat-ui` — every chat surface at once, without a conversation.
 *
 * Same owner gate and the same lazy-chunk reasoning as `/dev/decke`: it is a
 * review surface, not a product page. It does NOT pull the character runtime —
 * it imports the chat components only — so it is cheap in a way `/dev/decke`
 * is not.
 */
const ChatUiRoute = () => (
  <Suspense
    fallback={
      <div className="flex h-screen items-center justify-center text-text-muted">Loading…</div>
    }
  >
    <LazyChatUi />
  </Suspense>
)
const chatUiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/chat-ui',
  beforeLoad: async () => {
    if (import.meta.env.DEV) return
    if (!isCloudMode) return
    try {
      const me = await api.me()
      if (me.owner) return
    } catch {
      // Signed out, or /me unavailable — fall through to not-found.
    }
    throw notFound()
  },
  component: ChatUiRoute,
})

/**
 * `/dev/decke-compare` — the shipped glb beside an optimized candidate, driven
 * in lockstep from one animation frame.
 *
 * Same owner gate and the same lazy chunk as `/dev/decke`, and for the same
 * reason: it pulls the whole character runtime, twice over, and is a review
 * surface rather than a product page.
 */
const DeckeCompareRoute = () => (
  <Suspense
    fallback={
      <div className="flex h-screen items-center justify-center text-text-muted">
        Loading Deck-E…
      </div>
    }
  >
    <LazyDeckeCompare />
  </Suspense>
)
const deckeCompareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/decke-compare',
  beforeLoad: async () => {
    if (import.meta.env.DEV) return
    if (!isCloudMode) return
    try {
      const me = await api.me()
      if (me.owner) return
    } catch {
      // Signed out, or /me unavailable — fall through to not-found.
    }
    throw notFound()
  },
  component: DeckeCompareRoute,
})

const routeTree = rootRoute.addChildren([
  ...coreRoutes,
  designRoute,
  deckeRoute,
  deckeCompareRoute,
  chatUiRoute,
])

const router = createRouter({
  routeTree,
  basepath: import.meta.env.VITE_SUPABASE_URL ? '' : '/deckpal',
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Issue #40: every page on iOS Safari 26 ("Liquid Glass") loaded initially
// scrolled down a hair, with the title cut off under the fixed header until
// the user scrolled up. Root cause is upstream, not ours: TanStack Router
// installs an internal `onRendered` subscriber (unconditionally — it does
// not require the opt-in `scrollRestoration` router option we don't set)
// that ends every route render, including the very first, with
// `scrollTo({ top: 0, left: 0 })` (`@tanstack/router-core`'s
// scroll-restoration.js). scrollY 0 is exactly the state Safari 26 won't
// composite real content behind its translucent status bar for — it paints
// its fallback root colour there instead, which is what "scrolled down,
// title cut off" turned out to be (confirmed: it needs the page scrolled by
// even a device pixel to draw correctly there).
//
// `router.subscribe` fires listeners in registration order (a plain Set),
// and the router's own reset-to-top listener was registered synchronously
// during `createRouter()` above — so this one, registered after, always
// runs after it and gets the final say. It nudges to `scrollY: 1` instead of
// fighting the router for `0`; theme.css's `body { min-height: 100dvh + 1px
// }` reserves that 1px on every page (even ones shorter than the viewport)
// so there is always somewhere to land, and it's discarded (gated on
// `scrollY === 0`) when the browser has just restored a real scrolled
// position on a back/forward navigation — this must never fight that.
router.subscribe('onRendered', () => {
  if (window.scrollY === 0) {
    window.scrollTo({ top: 1, left: 0 })
  }
})

// Before first paint, so the skin never flashes from classic to premium.
initSkin()
initTopbar()
// Then let the ACCOUNT have the final say: pull the server-side settings and
// apply them over the device cache (migration 049 — "remembered on this
// device only" stopped being the deal). Async on purpose; boot never waits.
initSettingsSync()
// Open the connection to the card-art origin now, not when the first tile asks.
// Card art is served straight off the Storage CDN (lib/cardArt.ts), which is a
// different origin from the app — so without this the first image on a cold load
// pays DNS + TCP + TLS before a single byte of art moves.
preconnectArtOrigin()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

// Register the service worker + request persistent storage (iOS-eviction guard).
registerPwa()
