import type { CSSProperties, ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import type { CardRow } from '../lib/api'
import type { CardSearch } from '../routes/setSearch'
import type { ListSearch } from '../routes/listSearch'

/**
 * The one definition of where clicking a card goes.
 *
 * This rule used to exist three times — `CardTile`'s four-branch tail,
 * `TableView`'s row `<Link>` and `BinderView`'s slot `<Link>` — and the copies
 * had already drifted: the tile opened a scroll-preserving sheet on the set and
 * species pages while the table row navigated away from the same page, and the
 * binder slot silently rendered no link at all whenever its caller had no
 * set-level routing keys (which is every list page). Three copies of a rule
 * that must agree is a rule that will disagree, so it lives here once, the same
 * argument `lib/variantStyle.ts` records for variant colour.
 *
 * Two shapes, chosen by which page is asking:
 *
 *   • SHEET — the page that owns the grid stays mounted and a `?card=` search
 *     change opens the detail over it, so scroll position, filters and sort all
 *     survive an open→close cycle. Set, species and list pages.
 *   • NAVIGATE — a full trip to the standalone card route. Search results, and
 *     anywhere with no page to hold the sheet.
 *
 * The set page keys `?card=` by card NUMBER (`SetDetail` rebuilds the id from
 * its own set); the species and list pages key it by the full `cardId`, because
 * both span many sets and a bare number would be ambiguous.
 */
export function CardLink({
  card,
  seriesSlug = '',
  setId = '',
  className,
  style,
  children,
}: {
  card: CardRow
  /**
   * Fallback routing keys, for callers that have a single set (the set page).
   * Optional because a page spanning many sets has none to give — every card
   * row there carries its own, and the binder slot may have no card at all.
   */
  seriesSlug?: string
  setId?: string
  className?: string
  /** The binder slot carries its aspect ratio on the anchor itself. */
  style?: CSSProperties
  children: ReactNode
}) {
  const leafId = useRouterState({ select: (s) => s.matches[s.matches.length - 1]?.routeId })
  const params = useRouterState(
    { select: (s) => s.matches[s.matches.length - 1]?.params as Record<string, string> | undefined },
  )

  // ── DECK-E'S ADDRESS FOR THIS ONE CARD ─────────────────────────────────────
  //
  // The full card id (`me05-084`), on the card's own anchor, everywhere a card
  // is clickable. It is the second deliberate marking in the app —
  // `data-decke-landmark` is the other — and the one that sits ON the thing
  // rather than around it, because the grid is virtualized and a tile is not a
  // place, it is a row that happens to be on screen.
  //
  // A plain attribute and nothing else: no ref, no registry, no effect, no
  // per-tile subscription. There can be three hundred of these on a page and
  // several dozen mounting per second while somebody flicks through a set, so
  // whatever addressing costs has to be paid by the code that goes LOOKING for
  // a card (`uiTools.resolveTarget`, and the reveal listener on the set page),
  // never by the card itself. See `DECKE_REVEAL_EVENT` in
  // `character/host/uiTools.ts` for the half that makes an off-screen id
  // reachable at all.
  //
  // Pointable, not pressable: no `data-decke-clickable` here, deliberately —
  // this anchor opens the card sheet, and the click allowlist is a separate and
  // smaller list for exactly that kind of reason.
  const address = { 'data-decke-card': card.cardId }
  const shared = { className, style, ...address }

  // Set page: sheet, keyed by number.
  if (leafId === '/series/$series/$set') {
    return (
      <Link
        to="/series/$series/$set"
        params={{ series: card.seriesSlug ?? seriesSlug, set: card.setId ?? setId }}
        search={((prev: CardSearch) => ({ ...prev, card: card.number })) as never}
        resetScroll={false}
        {...shared}
      >
        {children}
      </Link>
    )
  }

  // Species page: sheet, keyed by cardId (spans many sets).
  if (leafId === '/pokedex/$speciesId' && params?.speciesId) {
    return (
      <Link
        to="/pokedex/$speciesId"
        params={{ speciesId: params.speciesId }}
        search={((prev: { card?: string }) => ({ ...prev, card: card.cardId })) as never}
        resetScroll={false}
        {...shared}
      >
        {children}
      </Link>
    )
  }

  // List page: sheet, keyed by cardId (spans many sets).
  if (leafId === '/lists/$id' && params?.id) {
    return (
      <Link
        to="/lists/$id"
        params={{ id: params.id }}
        search={((prev: ListSearch) => ({ ...prev, card: card.cardId })) as never}
        resetScroll={false}
        {...shared}
      >
        {children}
      </Link>
    )
  }

  // Everywhere else: full navigation to the standalone card route. A card row
  // carries its own series/set when the page spans sets (search results); the
  // caller's keys are the fallback for a single-set page.
  return (
    <Link
      to="/series/$series/$set/$number"
      params={{
        series: card.seriesSlug ?? seriesSlug,
        set: card.setId ?? setId,
        number: card.number,
      }}
      {...shared}
    >
      {children}
    </Link>
  )
}
