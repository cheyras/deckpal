import { useEffect, useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon, BrandMark, type IconName } from './Icon'
import { PwaUi } from './PwaUi'
import { BugButton } from './BugReport'
import { api } from '../lib/api'

// Signed-in avatar chip (single-user "me") — replaces Log In / Sign Up. The level
// badge reads straight from the insights overview; links to the profile surface.
function ProfileChip() {
  const { data } = useQuery({ queryKey: ['insights', 'overview'], queryFn: ({ signal }) => api.overview(signal) })
  const level = data?.trainer.level ?? 0
  return (
    <Link
      to="/profile"
      className="flex items-center gap-[8px] rounded-full bg-surface-tertiary py-[6px] pl-[6px] pr-[14px] hover:bg-action-default-hover"
      aria-label="Your profile"
    >
      <span className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-raised text-icon-default">
        <Icon name="user" size={20} />
        <span className="absolute -bottom-[3px] left-1/2 -translate-x-1/2 rounded-full bg-action-primary px-[5px] text-[9px] font-extrabold leading-[13px] text-action-primary-text">
          {level}
        </span>
      </span>
      <span className="text-[14px] font-semibold text-text-primary">Trainer</span>
    </Link>
  )
}

interface NavItem {
  label: string
  icon: IconName
  to?: string
  expandable?: boolean
  external?: boolean
}

// Order mirrors pkmn.gg's rail (UI-SPEC §3.1). Only "English TCG" is wired;
// the rest render as authentic-looking but inert entries for this browse MVP.
const NAV: NavItem[] = [
  { label: 'English TCG', icon: 'cards', to: '/series', expandable: true },
  { label: 'Japanese TCG', icon: 'cards', expandable: true },
  { label: 'TCG Pocket', icon: 'cards', expandable: true },
  { label: 'My Lists', icon: 'lists', to: '/lists' },
  { label: 'Deck Builder', icon: 'deck', to: '/decks' },
  { label: 'Pokédex', icon: 'pokedex', to: '/pokedex' },
  { label: 'Insights', icon: 'chart', to: '/insights' },
  { label: 'Scan Card', icon: 'camera', to: '/scan' },
  { label: 'Stream Tools', icon: 'stream', to: '/overlay' },
  { label: 'Discord', icon: 'discord', external: true },
  { label: 'Merch', icon: 'merch', external: true },
  { label: 'Pro Membership', icon: 'pro' },
]

function NavRow({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
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
          {item.expandable && <Icon name="chevron-down" size={18} className="text-icon-muted" />}
          {item.external && <Icon name="external" size={14} className="text-icon-muted" />}
        </>
      )}
    </span>
  )
  if (item.to) {
    return (
      <Link to={item.to} className="block">
        {body}
      </Link>
    )
  }
  return <div className="block cursor-default select-none opacity-90">{body}</div>
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
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
          <span className="flex-1 text-[22px] font-extrabold tracking-tight text-text-primary">
            pokedex
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
          const active = !!item.to && (pathname === item.to || pathname.startsWith(`${item.to}/`))
          return <NavRow key={item.label} item={item} active={active} collapsed={collapsed} />
        })}
      </nav>
    </aside>
  )
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const top = 'calc(99px + env(safe-area-inset-top))'
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
          <Link
            to="/profile"
            className="flex h-[48px] items-center justify-center gap-[8px] rounded-full bg-action-primary text-[14px] font-semibold text-action-primary-text"
          >
            <Icon name="user" size={18} /> View Profile
          </Link>
        </div>
        <nav>
          {NAV.map((item) => (
            <div key={item.label} onClick={item.to ? onClose : undefined}>
              <NavRow item={item} active={false} collapsed={false} />
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}

function Header({ onBurger, drawerOpen }: { onBurger: () => void; drawerOpen: boolean }) {
  return (
    <header
      className="app-header fixed left-0 right-0 top-0 z-[20] border-b border-border-default bg-surface-secondary"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="flex h-[99px] items-center gap-[12px] px-[16px] nav:h-[78px] nav:px-[24px]">
        {/* mobile: burger + brand */}
        <button
          onClick={onBurger}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-icon-default nav:hidden"
          aria-label="Menu"
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} size={24} />
        </button>
        <span className="flex items-center gap-[8px] nav:hidden">
          <BrandMark size={30} />
        </span>

        {/* search input — desktop full, mobile circular button */}
        <label className="relative hidden flex-1 items-center nav:flex" style={{ maxWidth: 511 }}>
          <span className="pointer-events-none absolute left-[14px] text-icon-default">
            <Icon name="search" size={20} />
          </span>
          <input
            type="search"
            placeholder="Search Cards…"
            className="h-[46px] w-full rounded-lg border border-border-default bg-surface-primary pl-[46px] pr-[44px] text-[16px] text-text-primary placeholder:text-text-muted"
          />
          <span className="absolute right-[14px] text-icon-default">
            <Icon name="sliders" size={18} />
          </span>
        </label>
        <div className="flex-1 nav:hidden" />
        <button
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default nav:hidden"
          aria-label="Search"
        >
          <Icon name="search" size={20} />
        </button>

        {/* scan shortcut — camera CTA into the card scanner */}
        <Link
          to="/scan"
          aria-label="Scan a card"
          className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover hover:text-icon-hover nav:h-[42px] nav:w-auto nav:gap-[8px] nav:px-[16px]"
        >
          <Icon name="camera" size={20} />
          <span className="hidden text-[14px] font-semibold text-text-primary nav:inline">Scan</span>
        </Link>

        {/* report-a-bug — captures a screenshot of the current view + a comment */}
        <BugButton />

        {/* profile chip — desktop only (single-user signed-in state) */}
        <div className="hidden items-center gap-[12px] nav:flex">
          <ProfileChip />
        </div>
      </div>
    </header>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const sidebarW = collapsed ? 82 : 275

  // The OBS overlay is a standalone browser source: no header, no sidebar, no
  // page surface — it must render chrome-free and transparent.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (pathname === '/pokedex/overlay' || pathname === '/overlay') {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <Header onBurger={() => setDrawerOpen((o) => !o)} drawerOpen={drawerOpen} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className={drawerOpen ? 'app-main opacity-20 nav:opacity-100' : 'app-main'}>
        <div className="app-content pt-[99px] nav:pt-[78px]">{children}</div>
      </main>
      {/* Fixed sidebar occupies the left rail at ≥1068; offset main + header to match. */}
      <style>{`.app-content{padding-top:calc(99px + env(safe-area-inset-top))}@media (min-width:1068px){.app-main{margin-left:${sidebarW}px}.app-header{left:${sidebarW}px}.app-content{padding-top:78px}}`}</style>
      <PwaUi />
    </div>
  )
}
