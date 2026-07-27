import { useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Icon, BrandMark, type IconName } from './Icon'

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
  { label: 'Deck Builder', icon: 'deck' },
  { label: 'Pokédex', icon: 'pokedex' },
  { label: 'Stream Tools', icon: 'stream' },
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
  if (!open) return null
  return (
    <div
      className="fixed left-0 top-[100px] z-[10] h-[calc(100vh-100px)] w-[275px] overflow-y-auto bg-surface-primary nav:hidden"
      role="dialog"
      aria-label="Navigation"
    >
      <div className="flex gap-[10px] px-[16px] py-[20px]">
        <button className="h-[48px] flex-1 rounded-full bg-action-default text-[14px] font-semibold text-action-default-text">
          Log In
        </button>
        <button className="h-[48px] flex-1 rounded-full bg-action-primary text-[14px] font-semibold text-action-primary-text">
          Sign Up
        </button>
      </div>
      <nav>
        {NAV.map((item) => (
          <div key={item.label} onClick={item.to ? onClose : undefined}>
            <NavRow item={item} active={false} collapsed={false} />
          </div>
        ))}
      </nav>
    </div>
  )
}

function Header({ onBurger, drawerOpen }: { onBurger: () => void; drawerOpen: boolean }) {
  return (
    <header className="app-header fixed left-0 right-0 top-0 z-[20] border-b border-border-default bg-surface-secondary">
      <div className="flex h-[99px] items-center gap-[12px] px-[16px] nav:h-[78px] nav:px-[24px]">
        {/* mobile: burger + brand */}
        <button
          onClick={onBurger}
          className="flex h-[39px] w-[39px] items-center justify-center rounded-full text-icon-default nav:hidden"
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
          className="flex h-[39px] w-[39px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default nav:hidden"
          aria-label="Search"
        >
          <Icon name="search" size={20} />
        </button>

        {/* auth pills — desktop only */}
        <div className="hidden items-center gap-[12px] nav:flex">
          <button className="h-[48px] w-[117px] rounded-full bg-action-default text-[14px] font-semibold text-action-default-text hover:bg-action-default-hover">
            Log In
          </button>
          <button className="h-[48px] w-[117px] rounded-full bg-action-primary text-[14px] font-semibold text-action-primary-text hover:bg-action-primary-hover">
            Sign Up
          </button>
        </div>
      </div>
    </header>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const sidebarW = collapsed ? 82 : 275

  return (
    <div className="min-h-screen bg-surface-primary">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <Header onBurger={() => setDrawerOpen((o) => !o)} drawerOpen={drawerOpen} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className={drawerOpen ? 'app-main opacity-20 nav:opacity-100' : 'app-main'}>
        <div className="pt-[99px] nav:pt-[78px]">{children}</div>
      </main>
      {/* Fixed sidebar occupies the left rail at ≥1068; offset main + header to match. */}
      <style>{`@media (min-width:1068px){.app-main{margin-left:${sidebarW}px}.app-header{left:${sidebarW}px}}`}</style>
    </div>
  )
}
