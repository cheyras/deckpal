import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api } from '../lib/api'
import { supabase, isCloudMode } from '../lib/supabase'
import { forgetReturningVisitor } from '../lib/returningVisitor'
import { Content, Spinner, ErrorState, Tabs, StatTile } from '../components/ui'
import { LevelRing } from '../components/LevelRing'
import { CardImage } from '../components/CardImage'
import { Icon } from '../components/Icon'
import { AvatarDisc, AvatarSpinner, useAvatarEditor } from '../components/Avatar'
import { ChangePassword } from './auth/ChangePassword'
import { AgentAccess } from '../components/AgentAccess'
import { SupportSettings } from '../components/billing/SupportSettings'
import { DeckeVisibility } from '../components/DeckeVisibility'
import { Sheet } from '../components/ui/Sheet'
import { fmtUsd } from '../lib/format'
import { useLateEntrance } from '../lib/lateEntrance'
import { signOutBounded } from '../lib/authSession'
import { CARD_ASPECT_RATIO_CSS, CARD_RADIUS_CSS } from '../lib/cardGeometry'

// The showcase's offline cache. The durable copy moved to the ACCOUNT — the
// user_showcase table has existed since migration 005 and this page finally
// uses it (via /me/showcase), so a profile curated here shows up on the next
// device too. localStorage keeps the instant first paint and the offline case.
const SHOWCASE_KEY = 'deckpal.showcase.v1'
// Set once the local picks have been offered up to an empty account row, so a
// deliberate later "clear my showcase" is not resurrected by an old cache.
const SHOWCASE_PUSHED_KEY = 'deckpal.showcase.pushed.v1'

interface ShowcasePick {
  cardId: string
  name: string
  low: string
  high: string
}

// A flat snapshot of every owned card, assembled from the captured-species details.
// Single-user, small (the demo owns a handful), so a fan-out over captured species
// is cheap and keeps us on the read-only insights contract (no collection dump route).
function useOwnedCards() {
  return useQuery({
    queryKey: ['ownedCards'],
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const grid = await api.dex(new URLSearchParams({ own: 'captured', pageSize: '1025' }), signal)
      const details = await Promise.all(grid.species.map((s) => api.species(String(s.speciesId), signal)))
      const byId = new Map<string, ShowcasePick>()
      for (const d of details) {
        for (const c of d.cards) {
          if (c.owned && !byId.has(c.cardId)) {
            byId.set(c.cardId, { cardId: c.cardId, name: c.name, low: c.images.low, high: c.images.high })
          }
        }
      }
      return [...byId.values()]
    },
  })
}

function loadShowcase(): ShowcasePick[] {
  try {
    const raw = localStorage.getItem(SHOWCASE_KEY)
    return raw ? (JSON.parse(raw) as ShowcasePick[]) : []
  } catch {
    return []
  }
}

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'collection', label: 'Collection', to: '/series' },
  { key: 'insights', label: 'Insights', to: '/insights' },
  { key: 'activity', label: 'Activity' },
  { key: 'lists', label: 'Lists', to: '/lists' },
  { key: 'decks', label: 'Decks', to: '/decks' },
  { key: 'friends', label: 'Friends' },
] as const

export function Profile() {
  const navigate = useNavigate()
  const overview = useQuery({ queryKey: ['insights', 'overview'], queryFn: ({ signal }) => api.overview(signal) })
  // Issue #49: the wrapper entrance fires while this is still a spinner.
  const enter = useLateEntrance(overview.isLoading)
  const owned = useOwnedCards()
  // Self-host has no per-user account, so no query — 'Trainer' stays the
  // generic label there, exactly as before (issue #25 is cloud-only).
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api.me(signal), enabled: isCloudMode })
  const username = isCloudMode ? (me.data?.username ?? 'Trainer') : 'Trainer'
  const [signingOut, setSigningOut] = useState(false)
  const photo = useAvatarEditor()

  // Cache-first render, account-truth follow-up: paint from localStorage
  // immediately, then let /me/showcase overwrite it when it answers.
  const [showcase, setShowcase] = useState<ShowcasePick[]>(() => loadShowcase())
  const [picking, setPicking] = useState<number | null>(null)
  const serverShowcase = useQuery({ queryKey: ['showcase'], queryFn: ({ signal }) => api.showcase(signal) })
  const hydratedShowcase = useRef(false)
  useEffect(() => {
    if (!serverShowcase.data || hydratedShowcase.current) return
    hydratedShowcase.current = true
    const fromServer: ShowcasePick[] = serverShowcase.data.showcase.map((s) => ({
      cardId: s.cardId,
      name: s.name,
      low: s.images.low,
      high: s.images.high,
    }))
    let pushed = true
    try {
      pushed = localStorage.getItem(SHOWCASE_PUSHED_KEY) === '1'
    } catch {
      /* no storage — nothing local to migrate up either */
    }
    const local = loadShowcase()
    if (!pushed && fromServer.length === 0 && local.length > 0) {
      // One-time migration: this device curated a showcase before the account
      // could hold one. Offer it up; the server's answer becomes the truth.
      api
        .setShowcase(local.map((p) => p.cardId))
        .then((res) => {
          setShowcase(res.showcase.map((s) => ({ cardId: s.cardId, name: s.name, low: s.images.low, high: s.images.high })))
        })
        .catch((e) => console.warn('showcase migration failed:', e))
    } else {
      setShowcase(fromServer)
    }
    try {
      localStorage.setItem(SHOWCASE_PUSHED_KEY, '1')
    } catch {
      /* fine */
    }
  }, [serverShowcase.data])
  useEffect(() => {
    try {
      localStorage.setItem(SHOWCASE_KEY, JSON.stringify(showcase))
    } catch {
      /* storage may be unavailable (private mode); keep in-memory state */
    }
  }, [showcase])

  const setSlot = (idx: number, pick: ShowcasePick | null) => {
    setShowcase((prev) => {
      const next = [...prev]
      // pad to length
      while (next.length < 4) next.push(undefined as unknown as ShowcasePick)
      if (pick) next[idx] = pick
      else next.splice(idx, 1)
      const out = next.filter(Boolean).slice(0, 4)
      // Write-through to the account. Optimistic — the local state and cache
      // already show the change; a failed PUT surfaces on the next hydration.
      api.setShowcase(out.map((p) => p.cardId)).catch((e) => console.warn('showcase save failed:', e))
      return out
    })
    setPicking(null)
  }

  const ov = overview.data
  const usd = ov?.collectionValue.find((c) => c.currency === 'USD')
  const banner = useMemo(() => (owned.data ?? []).slice(0, 3), [owned.data])

  const slots: (ShowcasePick | undefined)[] = [0, 1, 2, 3].map((i) => showcase[i])

  return (
    <div>
      {/* Banner — 3 card-art panels */}
      <div className="relative h-[180px] w-full overflow-hidden bg-surface-secondary">
        <div className="absolute inset-0 grid grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="relative overflow-hidden">
              {banner[i] ? (
                <img src={banner[i]!.high} alt="" className="h-full w-full object-cover object-top opacity-40" />
              ) : (
                <div className="h-full w-full" style={{ background: 'linear-gradient(160deg, var(--color-surface-secondary), var(--color-surface-tertiary))' }} />
              )}
            </div>
          ))}
        </div>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-surface-primary) 20%, transparent), var(--color-surface-primary))' }} />
      </div>

      <Content cap={1000}>
        {/* Avatar + identity, deliberately overlapping the banner.
            `relative z-[1]`: the banner's scrim is an absolutely-positioned
            child, so it paints above this statically-positioned row whatever
            the DOM order — it was swallowing clicks on Sign out.
            `min-h-[96px]`: the LevelRing (96px, and the only thing giving this
            row height) renders only once the overview query resolves. Without a
            floor the row collapsed to ~40px, rode the -54px margin up INTO the
            banner, and took the name, the gear and Sign out with it — so an
            insights outage left nobody able to sign out. */}
        <div className="relative z-(--z-raised) -mt-[54px] flex min-h-[96px] items-end gap-[16px]">
          {/* The ring renders unconditionally now. It used to be gated on `ov`,
              which meant an insights outage took the profile photo — and its
              upload control — off the page along with the level. The level is
              the only part that actually needs insights, so only the badge is
              gated; the photo is the user's own and must not depend on a
              statistics endpoint, exactly as Sign out and Account do below. */}
          <div className="relative shrink-0">
            <LevelRing
              level={ov?.trainer.level ?? 0}
              intoLevel={ov?.trainer.intoLevel ?? 0}
              size={96}
              showBadge={!!ov}
            >
              <AvatarDisc url={photo.displayUrl} iconSize={44} dimmed={photo.busy === 'upload'} />
              {photo.busy === 'upload' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <AvatarSpinner size={26} />
                </span>
              )}
            </LevelRing>
            {photo.enabled && (
              // Top-right, not bottom-right: the level badge owns the bottom
              // edge. Always visible rather than hover-revealed — a hover-only
              // control is unreachable on the 390px layout this ships to.
              <button
                type="button"
                onClick={photo.choose}
                disabled={photo.busy !== null}
                aria-label={photo.hasPhoto ? 'Change profile photo' : 'Add a profile photo'}
                title={photo.hasPhoto ? 'Change profile photo' : 'Add a profile photo'}
                className="absolute -right-[2px] -top-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-surface-primary bg-action-primary text-action-primary-text shadow-panel hover:brightness-110 disabled:opacity-60"
              >
                <Icon name="camera" size={15} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-[8px] pb-[10px]">
            <span className="text-[24px] font-extrabold text-text-primary">{username}</span>
            {isCloudMode ? (
              // Was a dead decorative glyph; now the shortcut to the Account
              // card further down (password, signed-in address).
              <a
                href="#account"
                title="Account settings"
                aria-label="Account settings"
                className="rounded-full text-icon-muted hover:text-icon-hover"
              >
                <Icon name="gear" size={18} />
              </a>
            ) : (
              <span className="text-icon-muted" title="Account settings">
                <Icon name="gear" size={18} />
              </span>
            )}
            {isCloudMode && (
              <button
                type="button"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true)
                  // Deliberately signing out is the one event that means "stop
                  // treating this browser as mine" — an expiring session does
                  // not, which is why AuthGuard's path leaves the marker alone.
                  forgetReturningVisitor()
                  await signOutBounded()
                  // AuthGuard sends a lost session to the same place, so the two
                  // cannot race each other to different pages.
                  navigate({ to: '/signed-out' })
                }}
                className="ml-[4px] flex items-center gap-[6px] rounded-full bg-surface-tertiary px-[12px] py-[5px] text-[14px] font-semibold text-text-muted hover:bg-action-default-hover hover:text-text-body disabled:opacity-50"
                title="Sign out"
              >
                <Icon name="logout" size={16} />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>

        {/* joined / friends / photo actions.
            The photo actions live here rather than beside the name: that row is
            already name + gear + Sign out and has no room left at 390px. This
            one is short, wraps cleanly, and is still adjacent to the avatar.
            The camera badge on the ring is the shortcut; these are the labelled
            path, and the only place "Remove" can be reached. */}
        <div className="mt-[10px] flex flex-wrap items-center gap-x-[16px] gap-y-[8px] text-[14px]">
          <span className="text-text-muted">
            Joined <span className="font-semibold text-text-body">Jul 2026</span>
          </span>
          <span className="hidden h-[14px] w-px bg-divider-subtle sm:block" />
          <span className="text-text-muted">
            Friends <span className="font-semibold text-text-body">0</span>
          </span>
          {photo.enabled && (
            <>
              <span className="hidden h-[14px] w-px bg-divider-subtle sm:block" />
              <button
                type="button"
                onClick={photo.choose}
                disabled={photo.busy !== null}
                className="inline-flex items-center gap-[6px] font-semibold text-text-body hover:text-action-primary disabled:opacity-50"
              >
                <Icon name="camera" size={14} />
                {photo.busy === 'upload' ? 'Uploading…' : photo.hasPhoto ? 'Change photo' : 'Add photo'}
              </button>
              {photo.hasPhoto && (
                <button
                  type="button"
                  onClick={photo.remove}
                  disabled={photo.busy !== null}
                  className="inline-flex items-center gap-[6px] font-semibold text-text-muted hover:text-error disabled:opacity-50"
                >
                  <Icon name="close" size={14} />
                  {photo.busy === 'remove' ? 'Removing…' : 'Remove'}
                </button>
              )}
            </>
          )}
        </div>
        {photo.input}
        {photo.error && (
          <div
            role="alert"
            className="mt-[10px] flex items-start gap-[8px] rounded-[10px] bg-halo-error px-[14px] py-[11px] text-[14px] leading-[1.5] text-error"
          >
            <span className="mt-[1px] shrink-0">
              <Icon name="alert" size={15} />
            </span>
            <span>{photo.error}</span>
          </div>
        )}

        {/* tab strip */}
        <Tabs items={TABS} value="profile" className="mt-[16px]" />

        {overview.isLoading && <Spinner label="Loading profile…" />}
        {overview.error && <ErrorState message={(overview.error as Error).message} className={enter} />}

        {ov && (
          <div className={`mt-[20px] flex flex-col gap-[16px] ${enter}`}>
            {/* Showcase */}
            <section>
              <div className="mb-[10px] flex items-center justify-between">
                <h2 className="text-[16px] font-bold text-text-primary">Showcase Cards</h2>
                <span className="text-[14px] text-text-muted">{slots.filter(Boolean).length}/4 selected</span>
              </div>
              <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
                {slots.map((pick, i) => (
                  <div key={i}>
                    {pick ? (
                      <div className="group relative">
                        <CardImage low={pick.low} high={pick.high} alt={pick.name} />
                        <button
                          onClick={() => setSlot(i, null)}
                          aria-label="Remove showcase card"
                          className="absolute right-[6px] top-[6px] flex h-[24px] w-[24px] items-center justify-center rounded-full bg-action-danger text-action-danger-text opacity-0 group-hover:opacity-100"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPicking(i)}
                        className="flex w-full items-center justify-center border-2 border-dashed border-border-default text-text-muted hover:border-action-primary hover:text-action-primary"
                        style={{ aspectRatio: CARD_ASPECT_RATIO_CSS, borderRadius: CARD_RADIUS_CSS }}
                      >
                        <span className="flex flex-col items-center gap-[6px] text-[14px]">
                          <Icon name="plus" size={22} />
                          Add card
                        </span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-[8px] text-[14px] text-text-muted">
                Choose up to 4 Showcase Cards from your collection.
              </p>
            </section>

            {/* Total Estimated Collection Value */}
            <section className="rounded-2xl bg-surface-secondary p-[20px]">
              <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">
                Total Estimated Collection Value
              </div>
              <div className="mt-[6px] flex flex-wrap items-baseline justify-between gap-[12px]">
                <span className="text-[32px] font-extrabold text-change-positive">{fmtUsd(usd?.total ?? null)}</span>
                <Link
                  to="/insights"
                  className="inline-flex items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] py-[8px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover"
                >
                  <Icon name="sparkle" size={16} className="text-action-primary" /> Value History
                </Link>
              </div>
            </section>

            {/* Collection at a glance */}
            <section className="rounded-2xl bg-surface-secondary p-[20px]">
              <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Pokémon TCG (English)</div>
              <div className="mt-[10px] grid grid-cols-3 gap-[12px]">
                <StatTile variant="boxed" label="Total Cards" value={ov.trainer.totalCards} />
                <StatTile variant="boxed" label="Unique Cards" value={ov.trainer.uniqueCards} />
                <StatTile variant="boxed" label="Pokédex" value={`${ov.pokedex.captured}/${ov.pokedex.total}`} />
              </div>
            </section>
          </div>
        )}

        {/* Account + Agent access — deliberately outside the `ov &&` block:
            rotating a password or revoking a leaked token must not depend on
            the insights API being up. ChangePassword is cloud-only (a self-host
            deploy has no Supabase account); Agent access is not — self-hosters
            connect assistants too. */}
        <div className="mt-[16px] mb-[8px] flex flex-col gap-[16px]">
          {/* Billing first in the stack: it is the surface every line of the
              support prompt promises exists ("change or stop it any time"), so
              somebody arriving from that modal must not have to hunt. It is
              cloud-only and self-gating -- SupportSettings renders nothing at
              all on a deployment with no Stripe, rather than an empty card. */}
          <SupportSettings />
          {isCloudMode && <ChangePassword />}
          <DeckeVisibility />
          <AgentAccess />
        </div>
      </Content>

      {/* showcase picker */}
      {picking != null && (
        <Sheet title="Pick a Showcase Card" onClose={() => setPicking(null)} size="md">
          <>
            {owned.isLoading ? (
              <Spinner label="Loading your cards…" />
            ) : (owned.data ?? []).length === 0 ? (
              <div className="py-[40px] text-center text-[14px] text-text-muted">
                You don't own any cards yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-[10px] sm:grid-cols-4">
                {(owned.data ?? []).map((c) => (
                  <button key={c.cardId} onClick={() => setSlot(picking, c)} className="block text-left">
                    <CardImage low={c.low} high={c.high} alt={c.name} />
                    <div className="mt-[4px] truncate text-[14px] text-text-body">{c.name}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        </Sheet>
      )}
    </div>
  )
}

