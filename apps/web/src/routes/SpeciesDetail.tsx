import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch, useNavigate } from '@tanstack/react-router'
import { api, type CardRow, type SpeciesDetailCard } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill } from '../components/ui'
import { GridView } from '../components/GridView'
import { SpriteTile } from '../components/SpriteTile'
import { SpeciesName } from '../components/SpeciesName'
import { CardSheet } from './CardDetail'
import { fmtNumber, typeColor } from '../lib/format'
import { SignInPrompt } from '../components/SignInPrompt'

// The card-detail route param $series is a series SLUG (e.g. "scarlet-violet"),
// but the species-detail cards only carry the serie tcgdexId (e.g. "sv") inside
// their image path. We resolve tcgdexId → slug from /series (cached) so GridView's
// card links resolve correctly across the many sets a species spans.
function serieFromImagePath(low: string): string | null {
  // /deckpal/images/en/{serie}/{set}/{localId}/low.webp
  const m = /\/images\/[^/]+\/([^/]+)\//.exec(low)
  return m ? m[1]! : null
}

// `owned`/`ownedQuantity` are absent on an anonymous read, and the synthesized
// ownership block is then left off too — GridView's tiles render as plain
// catalog rather than as 'you own none of these'.
function toCardRow(c: SpeciesDetailCard, seriesSlug: string | null): CardRow {
  return {
    cardId: c.cardId,
    number: c.number,
    numberSort: c.number,
    name: c.name,
    category: c.category,
    rarity: c.rarity,
    artist: c.artist,
    variantCount: c.variantCount,
    images: c.images,
    price: c.price,
    ...(c.owned === undefined || c.ownedQuantity === undefined
      ? {}
      : {
          ownership: {
            totalQuantity: c.ownedQuantity,
            requiredCount: 1,
            ownedRequired: c.owned ? 1 : 0,
            have: c.owned,
            need: !c.owned,
            dupe: c.ownedQuantity >= 2,
          },
        }),
    seriesSlug: seriesSlug ?? undefined,
    setId: c.set.setId,
  }
}

export function SpeciesDetail() {
  const { speciesId } = useParams({ from: '/pokedex/$speciesId' })
  const search = useSearch({ from: '/pokedex/$speciesId' })
  const navigate = useNavigate({ from: '/pokedex/$speciesId' })
  const [ownedOnly, setOwnedOnly] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['species', speciesId],
    queryFn: ({ signal }) => api.species(speciesId, signal),
  })
  // Series slug map (tcgdexId → slug) for correct card-detail links.
  const seriesQ = useQuery({ queryKey: ['series'], queryFn: ({ signal }) => api.series(signal), staleTime: Infinity })
  const slugByTcgdex = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of seriesQ.data?.series ?? []) m.set(s.tcgdexId, s.slug)
    return m
  }, [seriesQ.data])

  const cards = useMemo(() => {
    const list = (data?.cards ?? []).map((c) => {
      const serie = serieFromImagePath(c.images.low)
      const slug = serie ? slugByTcgdex.get(serie) ?? null : null
      return toCardRow(c, slug)
    })
    return ownedOnly ? list.filter((c) => c.ownership?.have) : list
  }, [data, slugByTcgdex, ownedOnly])

  const sp = data?.species

  return (
    <Content cap={1165}>
      <div className="mb-[16px]">
        <BackPill to="/pokedex" label="Pokédex" />
      </div>

      {isLoading && !data && <Spinner label="Loading species…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {sp && (
        <>
          {/* species header */}
          <div className="flex flex-col gap-[16px] rounded-2xl bg-surface-secondary p-[20px] sm:flex-row sm:items-center">
            <div className="w-[128px] shrink-0">
              <SpriteTile
                src={sp.sprite.art}
                alt={sp.name}
                captured={sp.captured ?? true}
                pixelated={false}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[10px]">
                <span className="text-[14px] font-bold text-text-muted">{fmtNumber(String(sp.speciesId))}</span>
                <span className="rounded-full bg-surface-tertiary px-[8px] py-[2px] text-[12px] font-semibold text-text-body">
                  Gen {sp.generation}
                </span>
                {sp.captured === undefined ? null : sp.captured ? (
                  <span className="rounded-full bg-action-primary px-[8px] py-[2px] text-[12px] font-extrabold text-action-primary-text">
                    Captured · LVL {sp.levelLabel}
                  </span>
                ) : (
                  <span className="rounded-full bg-surface-tertiary px-[8px] py-[2px] text-[12px] font-semibold text-text-muted">
                    Uncaptured
                  </span>
                )}
                {sp.shiny && (
                  <span className="text-[14px] text-action-primary" title={`Shiny breadth ${sp.shinyBreadth}`}>
                    ✦ Shiny
                  </span>
                )}
              </div>
              <h1 className="mt-[6px] text-[32px] font-extrabold leading-[40px] text-text-primary">
                <SpeciesName name={sp.name} />
              </h1>
              {sp.genus && <div className="text-[14px] text-text-secondary">{sp.genus}</div>}
              <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
                {sp.types.map((t) => (
                  <span
                    key={t}
                    className="rounded-full px-[10px] py-[2px] text-[12px] font-bold capitalize text-surface-on-light-text"
                    style={{ background: typeColor(t) }}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-[10px] text-[14px] text-text-muted">
                {sp.uniqueOwned === undefined ? (
                  <>
                    <span className="font-bold text-text-body">{sp.cardPool}</span> cards feature {sp.name}.
                  </>
                ) : (
                  <>
                    You own <span className="font-bold text-action-primary">{sp.uniqueOwned}</span> of {sp.cardPool} cards
                    featuring {sp.name}.
                  </>
                )}
              </div>
            </div>
          </div>

          {/* owned filter — nothing to filter by when nobody is signed in */}
          <div className="mt-[20px] flex flex-wrap items-center justify-between gap-[12px]">
            <div className="text-[14px] font-semibold text-text-body">{cards.length} cards</div>
            {sp.captured === undefined ? (
              <SignInPrompt title="Track this Pokémon" />
            ) : (
              <label className="flex cursor-pointer items-center gap-[8px] text-[14px] text-text-body">
                <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
                Owned only
              </label>
            )}
          </div>

          <div className="mt-[16px]">
            {cards.length === 0 ? (
              <div className="py-[60px] text-center text-[14px] text-text-muted">
                {ownedOnly ? 'You own none of this species yet.' : 'No cards found for this species.'}
              </div>
            ) : (
              <GridView cards={cards} seriesSlug="" setId="" ownership={sp.captured !== undefined} />
            )}
          </div>
        </>
      )}

      {/* Card detail as a bottom-sheet driven by the ?card=<cardId> search param.
          Rendering it here (rather than navigating to the standalone card route)
          keeps SpeciesDetail mounted, so scroll position + the owned filter survive
          an open→close cycle — identical to the set page. */}
      {search.card && (
        <CardSheet
          cardId={search.card}
          onClose={() =>
            navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: undefined })) as never, resetScroll: false })
          }
        />
      )}
    </Content>
  )
}
