import { StrictMode, lazy, Suspense } from 'react'
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
import { initTopbar } from './lib/topbar'
import { registerPwa } from './pwa'
import { CARD_SEARCH_DEFAULTS } from './routes/setSearch'
import { AppShell } from './components/AppShell'
import { AuthGuard } from './components/AuthGuard'
import { isPublicPathname, isSafeNextPath } from './lib/landingRoute'
import { api } from './lib/api'
import { supabase, isCloudMode } from './lib/supabase'
import { Auth } from './routes/Auth'
import { Authorize } from './routes/Authorize'
import { ResetPassword } from './routes/auth/ResetPassword'
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
import { validateGlobalSearch, GLOBAL_SEARCH_DEFAULTS } from './routes/globalSearch'
import { validateCardSearch } from './routes/setSearch'
import { validateListSearch } from './routes/listSearch'
import { validateDeckSearch, DECK_SEARCH_DEFAULTS } from './routes/deckSearch'

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
  //   • the catalog (/series, /pokedex, /search) — the whole point: 23 546 cards
  //     are readable without an account. AppShell still renders the nav for
  //     these; what it does NOT do is mount an authenticated query while signed
  //     out (see isChromelessPathname vs isCatalogPathname).
  if (isPublicPathname(pathname)) {
    return (
      <AppShell>
        <Outlet />
      </AppShell>
    )
  }
  return (
    <AuthGuard>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGuard>
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
//   • cloud + signed out        → the public marketing landing.
// getSession() reads the persisted session out of localStorage, so the common
// case resolves in a tick without a network round-trip.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    if (!isCloudMode) throw redirect({ to: '/series' })
    const { data } = await supabase.auth.getSession()
    if (data.session) throw redirect({ to: '/series' })
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

// Global cross-set card search — the destination for the header search field.
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: validateGlobalSearch,
  search: { middlewares: [stripSearchParams(GLOBAL_SEARCH_DEFAULTS)] },
  component: SearchResults,
})

// `?mode=signup` opens the form on the Sign Up tab — the landing page's primary
// CTA links here, and dropping someone on the Sign In tab after they clicked
// "Create your free account" is a needless extra click. `?mode=forgot` gives
// the password-reset request its own shareable URL.
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  validateSearch: (raw: Record<string, unknown>): { mode?: 'signup' | 'forgot'; next?: string } => ({
    mode: raw.mode === 'signup' ? 'signup' : raw.mode === 'forgot' ? 'forgot' : undefined,
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
  searchRoute,
]

// Design-system route. In dev it is the full editor (the Vite plugin serves
// the /__design write endpoints). In production it ships as an OWNER-ONLY
// read-only reference: beforeLoad checks the server-verified `designEditor`
// flag on /me and throws notFound() for everyone else, so the route is
// indistinguishable from a URL that does not exist. The flag's identity check
// lives server-side (DESIGN_EDITOR_USER_ID) — nothing about who the owner is
// appears in this bundle.
const LazyDesignSystem = lazy(() => import('./routes/design/DesignSystem'))
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

const routeTree = rootRoute.addChildren([...coreRoutes, designRoute])

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

// Before first paint, so the skin never flashes from classic to premium.
initSkin()
initTopbar()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

// Register the service worker + request persistent storage (iOS-eviction guard).
registerPwa()
