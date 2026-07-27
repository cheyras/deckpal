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
} from '@tanstack/react-router'
import './theme.css'
import { CARD_SEARCH_DEFAULTS } from './routes/setSearch'
import { AppShell } from './components/AppShell'
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
import { validateCardSearch } from './routes/setSearch'
import { validateListSearch } from './routes/listSearch'
import { validateDeckSearch } from './routes/deckSearch'

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

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
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
  // chosen view across navigations. FRONTEND.md §A.5.
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

const speciesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pokedex/$speciesId',
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

const routeTree = rootRoute.addChildren([
  indexRoute,
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
])

const router = createRouter({
  routeTree,
  basepath: '/pokedex',
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
