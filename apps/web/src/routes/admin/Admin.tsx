import { CreditOperations } from './CreditOperations'
import { Outlet, useRouterState, Link } from '@tanstack/react-router'
import { Content, Tabs, StatTile, EmptyState } from '../../components/ui'
import { useAccess } from '../../lib/access'
import { api } from '../../lib/api'
import { LoadState, Panel, useAdminQuery } from './shared'

export const ADMIN_SECTIONS = [
  { key: 'overview', label: 'Overview', to: '/admin', permission: 'admin.access' },
  { key: 'users', label: 'Users', to: '/admin/users', permission: 'users.read' },
  { key: 'roles', label: 'Roles', to: '/admin/roles', permission: 'roles.read' },
  { key: 'settings', label: 'Settings', to: '/admin/settings', permission: 'settings.read' },
  { key: 'audit', label: 'Audit', to: '/admin/audit', permission: 'audit.read' },
  { key: 'tools', label: 'Tools', to: '/admin/tools', permission: 'admin.access' },
]
export default function Admin() {
  const access = useAccess()
  const pathname = useRouterState({ select: s => s.location.pathname })
  if (!access.ready) return <Content><p role="status">Checking access…</p></Content>
  if (!access.permissions.includes('admin.access')) return <Content><EmptyState icon="lists" title="Administration unavailable" body="Your account does not currently have access to this area." /></Content>
  const active = ADMIN_SECTIONS.find(s => s.key !== 'overview' && pathname.includes(s.to))?.key ?? 'overview'
  return <Content><div className="space-y-[24px] pb-[40px]">
    <header><p className="mb-[6px] text-[12px] font-bold uppercase tracking-widest text-text-muted">DeckPal workspace</p><h1 className="font-display text-[32px] text-text-primary">Administration</h1><p className="mt-[8px] max-w-[680px] text-text-muted">Manage your people, permissions, and app settings.</p></header>
    <nav aria-label="Administration sections"><Tabs value={active} items={ADMIN_SECTIONS.filter(s => access.permissions.includes(s.permission) || (s.key === 'settings' && access.permissions.includes('credits.read')))} /></nav>
    <Outlet />
  </div></Content>
}
export function AdminOverview() {
  const access = useAccess()
  const query = useAdminQuery(['overview'], signal => api.adminOverview(signal), 'admin.access')
  return <div className="space-y-[24px]"><LoadState loading={query.isLoading} error={query.error} retry={query.refetch} />
    {query.data && <><div className="grid grid-cols-2 gap-[16px] xl:grid-cols-4">
      {Object.entries(query.data.counts).map(([key, value]) => <StatTile variant="boxed" key={key} label={({ users: 'Users', suspended: 'Suspended accounts', roles: 'Roles', auditEvents: 'Audit events' } as Record<string, string>)[key] ?? key} value={value.toLocaleString()} />)}
    </div><Panel title="Workspace status"><dl className="grid gap-[16px] sm:grid-cols-2"><div><dt className="text-text-muted">Administration</dt><dd className="mt-[4px] text-text-primary">{query.data.adminReady ? 'Ready' : 'Setup required'}</dd></div><div><dt className="text-text-muted">Deployment</dt><dd className="mt-[4px] text-text-primary">{query.data.status.mode}</dd></div></dl><p className="mt-[16px] text-[14px] text-text-muted">Status reflects administrative setup. Payment availability is reported separately in AI credits.</p></Panel></>}
    {access.permissions.includes('credits.read') && <CreditOperations />}
    <Panel title="Contributor tools"><p className="mb-[16px] text-text-muted">Open the scanner, design kit, and review surfaces your role permits.</p><Link to="/admin/tools" className="font-semibold text-link">Browse tools →</Link></Panel>
  </div>
}
export const ADMIN_TOOLS = [
  { to: '/scan', name: 'Card scanner', permission: 'scanner.use', description: 'Capture cards, review matches, and add them to your collection.' },
  { to: '/design', name: 'Design system', permission: 'design.view', description: 'Explore the current UI kit. Read-only in production; editing requires the local design service.' },
  { to: '/dev/decke', name: 'Deck-E character', permission: 'diagnostics.view', description: 'Inspect character animation and presentation.' },
  { to: '/dev/chat-ui', name: 'Chat UI gallery', permission: 'diagnostics.view', description: 'Review chat states without starting a paid conversation.' },
  { to: '/dev/decke-compare', name: 'Character comparison', permission: 'diagnostics.view', description: 'Compare character models and animation side by side.' },
  { to: '/dev/scan-harness', name: 'Scanner harness', permission: 'diagnostics.view', description: 'Exercise detector fixtures and camera diagnostics.' },
  { to: '/dev/quad-labeler', name: 'Quad labeler', permission: 'scanner.label', description: 'Capture and annotate training photos. Includes access to the shared photo corpus.' },
  { to: '/dev/quad-harvest', name: 'Training photo review', permission: 'scanner.label', description: 'Inspect and remove captured training photos and their labels.' },
]
export function AdminTools() {
  const access = useAccess()
  const tools = ADMIN_TOOLS.filter(tool => access.permissions.includes(tool.permission))
  return <section><h2 className="mb-[16px] font-display text-[24px] text-text-primary">Tools</h2>
    {tools.length ? <div className="grid gap-[16px] md:grid-cols-2">{tools.map(tool => <Link key={tool.to} to={tool.to} className="rounded-[16px] border border-border-default bg-surface-secondary p-[20px] hover:border-action-primary"><h3 className="font-semibold text-text-primary">{tool.name} →</h3><p className="mt-[8px] text-[14px] text-text-muted">{tool.description}</p></Link>)}</div> : <EmptyState icon="lists" title="No tools assigned" body="An administrator can add tool permissions to your role." />}
  </section>
}
