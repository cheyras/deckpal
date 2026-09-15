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
  { key: 'usage', label: 'AI usage', to: '/admin/usage', permission: 'admin.access' },
  { key: 'features', label: 'Features', to: '/admin/features', permission: 'roles.manage' },
]
export default function Admin() {
  const access = useAccess()
  const pathname = useRouterState({ select: s => s.location.pathname })
  if (!access.ready) return <Content><p role="status">Checking access…</p></Content>
  if (!access.permissions.includes('admin.access')) return <Content><EmptyState icon="lists" title="Administration unavailable" body="Your account does not currently have access to this area." /></Content>
  const active = ADMIN_SECTIONS.find(s => s.key !== 'overview' && pathname.includes(s.to))?.key ?? 'overview'
  return <Content><div className="space-y-[24px] pb-[40px]">
    <header><p className="mb-[6px] text-[12px] font-bold uppercase tracking-widest text-text-muted">DeckPal workspace</p><h1 className="font-display text-[32px] text-text-primary">Administration</h1><p className="mt-[8px] max-w-[680px] text-text-muted">Manage your people, permissions, and app settings.</p></header>
    <nav aria-label="Administration sections"><Tabs value={active} items={ADMIN_SECTIONS.filter(s => s.key === 'usage' ? access.actorCapabilities.canReadSharedConversations : s.key === 'features' ? access.actorCapabilities.canEditRoles : access.permissions.includes(s.permission) || (s.key === 'settings' && access.permissions.includes('credits.read')))} /></nav>
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
    <Panel title="Dev tools"><p className="mb-[16px] text-text-muted">Open development galleries, diagnostics and review surfaces your role permits.</p><Link to="/devtools" className="font-semibold text-link">Browse Dev tools</Link></Panel>
  </div>
}
