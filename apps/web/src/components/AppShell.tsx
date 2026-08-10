import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useRouterState, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon, BrandMark, type IconName } from './Icon'
import { AvatarDisc, useAvatar } from './Avatar'
import { PwaUi } from './PwaUi'
import { BugButton } from './BugReport'
import { api } from '../lib/api'
import { isChromelessPathname } from '../lib/landingRoute'
import { useSignedIn } from '../lib/session'
import { GLOBAL_SEARCH_DEFAULTS } from '../routes/globalSearch'

// Signed-in avatar chip (single-user "me") — replaces Log In / Sign Up. The level
// badge reads straight from the insights overview; links to the profile surface.
// The photo comes from its own ['avatar'] query, shared with the profile page, so
// a change there repaints here with no refetch — and an insights outage costs the
// level badge but never the face.
function ProfileChip() {
  const { data } = useQuery({ queryKey: ['insights', 'overview'], queryFn: ({ signal }) => api.overview(signal) })
  const avatar = useAvatar()
  const level = data?.trainer.level ?? 0
  return (
    <Link
      to="/profile"
      className="flex items-center gap-[8px] rounded-full bg-surface-tertiary py-[6px] pl-[6px] pr-[14px] hover:bg-action-default-hover"
      aria-label="Your profile"
    >
      <span className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-raised text-icon-default">
        {/* The disc is clipped in its own element so the level badge, which
            hangs 3px past the bottom edge, is not clipped with it. */}
        <span className="h-full w-full overflow-hidden rounded-full">
          <AvatarDisc url={avatar.data?.avatarUrl} iconSize={20} fallbackClass="text-icon-default" />
        </span>
        <span className="absolute -bottom-[3px] left-1/2 -translate-x-1/2 rounded-full bg-action-primary px-[5px] text-[9px] font-extrabold leading-[13px] text-action-primary-text">
          {level}
        </span>
      </span>
      <span className="text-[14px] font-semibold text-text-primary">Trainer</span>
    </Link>
  )
}

// The signed-out counterpart to ProfileChip. It mounts NO query — that is the
// point. ProfileChip's ['insights','overview'] call 401s while signed out, and
// a 401 on a page the visitor is allowed to be on is how the reload loop starts.
function SignInChip() {
  return (
    <div className="flex items-center gap-[8px]">
      <Link
        to="/auth"
        className="flex h-[38px] items-center rounded-full px-[14px] text-[14px] font-semibold text-text-body hover:text-text-primary"
      >
        Sign in
      </Link>
      <Link
        to="/auth"
        search={{ mode: 'signup' } as never}
        className="flex h-[38px] items-center rounded-full bg-action-primary px-[16px] text-[14px] font-semibold text-action-primary-text hover:opacity-90"
      >
        Sign up free
      </Link>
    </div>
  )
}

interface NavItem {
  label: string
  icon: IconName
  to?: string
  expandable?: boolean
  external?: boolean
  soon?: boolean
  /** Needs an account. Signed out, the row links to /auth instead of a dead end. */
  gated?: boolean
}

// Order mirrors pkmn.gg's rail (UI-SPEC §3.1). Single-user English-TCG build:
// "English TCG" expands to the live series list; every other entry is wired.
const NAV: NavItem[] = [
  { label: 'Pokémon TCG (English)', icon: 'cards', to: '/series', expandable: true },
  { label: 'My Lists', icon: 'lists', to: '/lists', gated: true },
  { label: 'Deck Builder', icon: 'deck', to: '/decks', gated: true },
  { label: 'Pokédex', icon: 'pokedex', to: '/pokedex' },
  { label: 'Insights', icon: 'chart', to: '/insights', gated: true },
  { label: 'Scan Card', icon: 'camera', to: '/scan', gated: true },
  // Stream Tools is the OBS overlay browser source (chrome-free/transparent), which
  // renders as a black screen in a normal tab — so it's non-navigable with a "Soon"
  // badge until there's a real in-app surface for it. The /overlay route still exists.
  { label: 'Stream Tools', icon: 'stream', soon: true },
]

function NavRow({
  item,
  active,
  collapsed,
  signedOut = false,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  signedOut?: boolean
}) {
  // A gated row stays visible signed-out — hiding it would hide what an account
  // is FOR — but it leads to the sign-up form rather than to a page that would
  // immediately bounce there anyway.
  const locked = signedOut && !!item.gated
  const body = (
    <span
      className={[
        'flex h-[56px] items-center',
        collapsed ? 'justify-center px-0' : 'gap-[14px] px-[24px]',
        active ? 'bg-surface-secondary text-text-primary' : 'text-text-muted hover:text-text-body',
      ].join(' ')}
    >
      <span className={active ? 'text-text-primary' : 'text-icon-muted-strong'}>
        <Icon name={item.icon} size={item.icon === 'discord' ? 20 : 24} />
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-[14px] font-normal leading-[21px]">{item.label}</span>
          {item.soon && (
            <span className="rounded-full bg-surface-tertiary px-[8px] py-[2px] text-[10px] font-bold uppercase tracking-wide text-text-muted">
              Soon
            </span>
          )}
          {locked && (
            <span className="rounded-full bg-surface-tertiary px-[8px] py-[2px] text-[10px] font-bold uppercase tracking-wide text-text-muted">
              Sign in
            </span>
          )}
          {item.expandable && <Icon name="chevron-down" size={18} className="text-icon-muted" />}
          {item.external && <Icon name="external" size={14} className="text-icon-muted" />}
        </>
      )}
    </span>
  )
  if (locked) {
    return (
      <Link to="/auth" search={{ mode: 'signup' } as never} className="block">
        {body}
      </Link>
    )
  }
  if (item.to) {
    return (
      <Link to={item.to} className="block">
        {body}
      </Link>
    )
  }
  return <div className="block cursor-default select-none opacity-90">{body}</div>
}

// The live series list, rendered as indented sub-items under an expanded parent.
// Shares react-query's ['series'] cache with SeriesIndex, so it's usually warm.
// `onNavigate` lets the mobile drawer close itself when a sub-item is tapped.
function SeriesSubNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data, isLoading, error } = useQuery({ queryKey: ['series'], queryFn: ({ signal }) => api.series(signal) })
  if (isLoading) {
    return <div className="py-[8px] pl-[62px] pr-[24px] text-[13px] text-text-muted">Loading series…</div>
  }
  if (error || !data?.series.length) {
    return <div className="py-[8px] pl-[62px] pr-[24px] text-[13px] text-text-muted">No series</div>
  }
  return (
    <div className="pb-[6px]">
      {data.series.map((s) => {
        const active = pathname === `/series/${s.slug}` || pathname.startsWith(`/series/${s.slug}/`)
        return (
          <Link
            key={s.slug}
            to="/series/$series"
            params={{ series: s.slug }}
            onClick={onNavigate}
            className={[
              'block py-[8px] pl-[62px] pr-[24px] text-[13px] leading-[18px]',
              active ? 'font-medium text-text-primary' : 'text-text-muted hover:text-text-body',
            ].join(' ')}
          >
            {s.name}
          </Link>
        )
      })}
    </div>
  )
}

// An expandable parent row (English TCG). Not-collapsed: the row is a toggle that
// reveals SeriesSubNav and rotates its chevron. Collapsed (icon-only rail): there's
// no room for sub-items, so it degrades to a plain link via NavRow.
function ExpandableNavRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate?: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [open, setOpen] = useState(false)
  const active = !!item.to && (pathname === item.to || pathname.startsWith(`${item.to}/`))
  if (collapsed) {
    return <NavRow item={item} active={active} collapsed />
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full text-left">
        <span
          className={[
            'flex h-[56px] items-center gap-[14px] px-[24px]',
            active ? 'bg-surface-secondary text-text-primary' : 'text-text-muted hover:text-text-body',
          ].join(' ')}
        >
          <span className={active ? 'text-text-primary' : 'text-icon-muted-strong'}>
            <Icon name={item.icon} size={24} />
          </span>
          <span className="flex-1 text-[14px] font-normal leading-[21px]">{item.label}</span>
          <Icon
            name="chevron-down"
            size={18}
            className={['text-icon-muted transition-transform', open ? 'rotate-180' : ''].join(' ')}
          />
        </span>
      </button>
      {open && <SeriesSubNav onNavigate={onNavigate} />}
    </div>
  )
}

function Sidebar({ collapsed, onToggle, signedOut }: { collapsed: boolean; onToggle: () => void; signedOut: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <aside
      className="fixed left-0 top-0 z-[20] hidden h-screen flex-col border-r border-border-default bg-surface-primary nav:flex"
      style={{ width: collapsed ? 82 : 275 }}
    >
      <div
        className={[
          'flex h-[78px] shrink-0 items-center border-b border-border-default',
          collapsed ? 'justify-center px-0' : 'gap-[10px] px-[20px]',
        ].join(' ')}
      >
        <BrandMark size={33} />
        {!collapsed && (
          <span className="flex-1">
            <span className="brand-wordmark text-[21px] leading-none">DeckScout</span>
          </span>
        )}
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-icon-default hover:bg-surface-secondary hover:text-icon-hover"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-[6px]">
        {NAV.map((item) => {
          if (item.expandable) {
            return <ExpandableNavRow key={item.label} item={item} collapsed={collapsed} />
          }
          const active = !!item.to && (pathname === item.to || pathname.startsWith(`${item.to}/`))
          return <NavRow key={item.label} item={item} active={active} collapsed={collapsed} signedOut={signedOut} />
        })}
      </nav>
    </aside>
  )
}

function MobileDrawer({ open, onClose, signedIn }: { open: boolean; onClose: () => void; signedIn: boolean | undefined }) {
  // The drawer's "View Profile" button is the ONLY identity surface on mobile —
  // the header chip is desktop-only (`nav:flex`). So the photo belongs here too,
  // or a phone user never sees the avatar they just uploaded outside /profile.
  // Signed out it becomes the sign-up CTA, and useAvatar (an authenticated
  // query) is never mounted — see SignInChip.
  //
  // `signedIn === true`, not `!signedOut`: the hook returns `undefined` for the
  // first tick while the session is read out of localStorage, and `!undefined`
  // is `true`. That one-tick window was enough to fire GET /avatar on every
  // catalog page and take a 401 — measured in the browser, not reasoned about.
  // The drawer's `if (!open) return null` sits BELOW this hook, so a closed
  // drawer fired it too.
  const signedOut = signedIn === false
  const avatar = useAvatar(signedIn === true)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const top = 'calc(64px + env(safe-area-inset-top))'
  return (
    <>
      {/* tap-anywhere-outside backdrop */}
      <div
        className="fixed inset-0 z-[9] nav:hidden"
        style={{ top }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed left-0 z-[10] w-[280px] max-w-[85vw] overflow-y-auto border-r border-border-default bg-surface-primary nav:hidden"
        style={{ top, height: `calc(100dvh - ${top})`, paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-label="Navigation"
      >
        <div className="px-[16px] py-[20px]" onClick={onClose}>
          {signedOut ? (
            <Link
              to="/auth"
              search={{ mode: 'signup' } as never}
              className="flex h-[48px] items-center justify-center rounded-full bg-action-primary text-[14px] font-semibold text-action-primary-text"
            >
              Sign up free
            </Link>
          ) : (
            <Link
              to="/profile"
              className="flex h-[48px] items-center justify-center gap-[8px] rounded-full bg-action-primary text-[14px] font-semibold text-action-primary-text"
            >
              <span className="h-[26px] w-[26px] shrink-0 overflow-hidden rounded-full">
                <AvatarDisc url={avatar.data?.avatarUrl} iconSize={18} fallbackClass="text-action-primary-text" />
              </span>
              View Profile
            </Link>
          )}
        </div>
        <nav>
          {NAV.map((item) =>
            item.expandable ? (
              // Self-manages its toggle + sub-links; closes the drawer on a sub-item tap.
              <ExpandableNavRow key={item.label} item={item} collapsed={false} onNavigate={onClose} />
            ) : (
              <div key={item.label} onClick={item.to ? onClose : undefined}>
                <NavRow item={item} active={false} collapsed={false} signedOut={signedOut} />
              </div>
            ),
          )}
        </nav>
      </div>
    </>
  )
}

function Header({ onBurger, drawerOpen, signedIn }: { onBurger: () => void; drawerOpen: boolean; signedIn: boolean | undefined }) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  // Submitting hands the term to /search, which owns the query from there on.
  // Clearing the header field afterwards keeps it from drifting out of sync with
  // the search page's own input, which is the one the user then edits.
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = term.trim()
    if (!q) return
    setTerm('')
    void navigate({ to: '/search', search: { q } as never })
  }
  return (
    <header
      className="app-header fixed left-0 right-0 top-0 z-[20] border-b border-border-default bg-surface-secondary"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="flex h-[64px] items-center gap-[12px] px-[16px] nav:h-[78px] nav:px-[24px]">
        {/* mobile: burger + brand */}
        <button
          onClick={onBurger}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-icon-default nav:hidden"
          aria-label="Menu"
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} size={24} />
        </button>
        <span className="flex min-w-0 items-center gap-[8px] nav:hidden">
          <BrandMark size={30} />
          <span className="brand-wordmark text-[18px] leading-none">DeckScout</span>
        </span>

        {/* search — desktop submits to /search; mobile is a link to the same page.
            The advanced filter vocabularies the API exposes have no UI yet, so the
            field carries no filter affordance rather than a dead one. */}
        <form onSubmit={submit} className="relative hidden flex-1 items-center nav:flex" style={{ maxWidth: 511 }}>
          <label className="relative flex w-full items-center">
            <span className="pointer-events-none absolute left-[14px] text-icon-default">
              <Icon name="search" size={20} />
            </span>
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search Cards…"
              aria-label="Search cards"
              className="h-[46px] w-full rounded-lg border border-border-default bg-surface-primary pl-[46px] pr-[14px] text-[16px] text-text-primary placeholder:text-text-muted"
            />
          </label>
        </form>
        <div className="flex-1 nav:hidden" />
        <Link
          to="/search"
          search={GLOBAL_SEARCH_DEFAULTS}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default nav:hidden"
          aria-label="Search"
        >
          <Icon name="search" size={20} />
        </Link>

        {/* scan shortcut — camera CTA into the card scanner. The scanner writes
            to a collection, so signed out it leads to the sign-up form. */}
        <Link
          to={signedIn === false ? '/auth' : '/scan'}
          {...(signedIn === false ? { search: { mode: 'signup' } as never } : {})}
          aria-label="Scan a card"
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover hover:text-icon-hover nav:h-[42px] nav:w-auto nav:gap-[8px] nav:px-[16px]"
        >
          <Icon name="camera" size={20} />
          <span className="hidden text-[14px] font-semibold text-text-primary nav:inline">Scan</span>
        </Link>

        {/* report-a-bug — captures a screenshot of the current view + a comment.
            The reporter posts as a user, so it is signed-in only. */}
        {signedIn === true && <BugButton />}

        {/* Identity: the avatar chip when signed in, the sign-up CTA when not.
            `undefined` (still resolving) renders neither — a flash of "Sign in"
            in front of a signed-in user reads as a bug, and ProfileChip's
            authenticated query must not fire before we know there is a session. */}
        <div className="hidden items-center gap-[12px] nav:flex">
          {signedIn === true && <ProfileChip />}
          {signedIn === false && <SignInChip />}
        </div>
      </div>
    </header>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const sidebarW = collapsed ? 82 : 275
  // Self-host is always `true` (no signed-out state); cloud settles from the
  // persisted session in a tick. Drives which identity affordance the chrome
  // shows AND which authenticated queries are allowed to mount at all.
  const signedIn = useSignedIn()

  // Chrome-free paths: the OBS overlay, every auth surface, and the marketing
  // landing at `/` — see isChromelessPathname. Rendering the full nav on /auth
  // fired ProfileChip's overview query which 401'd → handle401 →
  // location.assign('/auth') → infinite reload.
  //
  // The public catalog gets the nav (a catalog with no navigation is not a
  // product) and avoids the same trap differently: every authenticated query in
  // this shell — ProfileChip's overview, the avatar, the bug reporter — is
  // mounted only when `signedIn === true`, so a logged-out visitor still fires
  // exactly zero authenticated calls.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (isChromelessPathname(pathname)) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} signedOut={signedIn === false} />
      <Header onBurger={() => setDrawerOpen((o) => !o)} drawerOpen={drawerOpen} signedIn={signedIn} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} signedIn={signedIn} />
      <main className={drawerOpen ? 'app-main opacity-20 nav:opacity-100' : 'app-main'}>
        <div className="app-content pt-[64px] nav:pt-[78px]">{children}</div>
      </main>
      {/* Fixed sidebar occupies the left rail at ≥1068; offset main + header to match. */}
      <style>{`.app-content{padding-top:calc(64px + env(safe-area-inset-top))}@media (min-width:1068px){.app-main{margin-left:${sidebarW}px}.app-header{left:${sidebarW}px}.app-content{padding-top:78px}}`}</style>
      <PwaUi />
    </div>
  )
}
