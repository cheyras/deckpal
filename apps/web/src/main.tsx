import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRouter,
  createRootRoute,
  createRoute,
  redirect,
  retainSearchParams,
  stripSearchParams,
  RouterProvider,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import './theme.css'
import { registerPwa } from './pwa'
import { CARD_SEARCH_DEFAULTS } from './routes/setSearch'
import { AppShell } from './components/AppShell'
import { AuthGuard } from './components/AuthGuard'
import { Auth } from './routes/Auth'
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
import { Overlay } from './routes/Overlay'
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
  const isPublic = pathname.endsWith('/auth') || pathname.includes('/overlay')
  if (isPublic) {
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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/series' })
  },
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

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: Auth,
})

// Standalone OBS browser-source overlay — AppShell renders it chrome-free.
const overlayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overlay',
  component: Overlay,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
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
  overlayRoute,
])

const router = createRouter({
  routeTree,
  basepath: import.meta.env.VITE_SUPABASE_URL ? '' : '/deckscout',
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

// Register the service worker + request persistent storage (iOS-eviction guard).
registerPwa()
