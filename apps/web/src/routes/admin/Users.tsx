import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { Button, Field, FormAlert, EmptyState, DataTable, DataTableToolbar } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { api } from '../../lib/api'
import { useAccess, invalidateAccess } from '../../lib/access'
import type { AdminUser, AdminRole } from '../../lib/adminTypes'
import { Panel, LoadState, useAdminQuery, useAdminSave, ConfirmAction, selectClass, fmtDate } from './shared'

export function AdminUsers() {
  const access = useAccess(), canRead = access.permissions.includes('users.read'), canReadRoles = access.permissions.includes('roles.read')
  const [search, setSearch] = useState(''), [term, setTerm] = useState(''), [status, setStatus] = useState('all'), [role, setRole] = useState(''), [offset, setOffset] = useState(0), [pageSize, setPageSize] = useState(25)
  const roles = useAdminQuery(['roles'], signal => api.adminRoles(signal), 'roles.read')
  useEffect(() => { if (!canReadRoles) { setRole(''); setOffset(0) } }, [canReadRoles])
  const params = new URLSearchParams({ search, status, role: canReadRoles ? role : '', offset: String(offset), limit: String(pageSize) })
  const query = useAdminQuery(['users', params.toString()], signal => api.adminUsers(params.toString(), signal), 'users.read')
  const reset = () => { setSearch(''); setTerm(''); setStatus('all'); setRole(''); setOffset(0) }
  return <section className="min-w-0 space-y-[20px]"><h2 className="font-display text-[24px] text-text-primary">Users</h2>
    <DataTable label="Matching user accounts" rows={canRead ? query.data?.users ?? [] : []} getRowId={user => user.id}
      loading={query.isPending} refreshing={query.isFetching && !query.isPending} error={query.error?.message} onRetry={() => void query.refetch()}
      empty={<EmptyState icon="lists" title="No matching users" body="Try a different search or filter." />}
      pagination={{ offset, pageSize, total: query.data?.total ?? 0, onOffsetChange: setOffset, onPageSizeChange: setPageSize }}
      toolbar={<DataTableToolbar label="Filter users" search={{ label: 'Search users', value: term, onChange: setTerm, placeholder: 'Email, username, or exact ID', maxLength: 200 }} onSubmit={() => { setSearch(term.trim()); setOffset(0) }} submitLabel="Search" onReset={reset} resetDisabled={!term && !search && status === 'all' && !role}>
        <label className="text-[14px] font-semibold text-text-secondary">Status<select aria-label="Status" className={selectClass + ' mt-[6px]'} value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        <div><label className="text-[14px] font-semibold text-text-secondary">Role<select aria-label="Role" className={selectClass + ' mt-[6px]'} value={role} disabled={!canReadRoles || roles.isPending || !!roles.error} onChange={e => { setRole(e.target.value); setOffset(0) }}><option value="">All roles</option>{canReadRoles && !roles.error && roles.data?.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          {!canReadRoles && <p className="mt-[6px] text-[13px] text-text-muted">Role filtering requires permission to view roles.</p>}
          {canReadRoles && roles.error && <div role="status" className="mt-[6px] text-[13px] text-text-muted">Role filters unavailable. <Button variant="ghost" onClick={() => void roles.refetch()}>Retry role filters</Button></div>}</div>
      </DataTableToolbar>}
      columns={[
        { id: 'user', header: 'User', className: 'min-w-[220px] max-w-[320px]', cell: user => <><Link to="/admin/users/$userId" params={{ userId: user.id }} className="break-words font-semibold text-link">{user.username || 'Unnamed user'}</Link><p className="mt-[4px] break-all text-text-muted">{user.email ?? user.id}</p></> },
        { id: 'roles', header: 'Roles', className: 'min-w-[180px] max-w-[260px] break-words', cell: user => user.roles.map(r => r.name).join(', ') || 'No assigned roles' },
        { id: 'status', header: 'Status', className: 'min-w-[110px]', cell: user => <span className={user.suspended ? 'text-error' : 'text-text-body'}>{user.suspended ? 'Suspended' : 'Active'}</span> },
        { id: 'joined', header: 'Joined', className: 'whitespace-nowrap', cell: user => new Date(user.createdAt).toLocaleDateString() },
      ]} />
  </section>
}
function AssignRoles({ user, roles, close }: { user: AdminUser; roles: AdminRole[]; close: () => void }) {
  const access = useAccess(), state = useAdminSave()
  const [chosen, setChosen] = useState(user.roles.map(r => r.id)), [reason, setReason] = useState('')
  const superAdmin = roles.some(r => r.key === 'super_admin' && access.roles.some(own => own.id === r.id))
  return <Sheet title="Assign roles" onClose={() => { if (!state.busy) close() }}><form onSubmit={e => { e.preventDefault(); void state.save(() => api.adminUserRoles(user.id, chosen, user.revision, reason.trim()), () => { close(); invalidateAccess() }) }} className="space-y-[16px]">
    <p className="text-text-muted">Roles combine their permissions. The server protects the last active super administrator.</p>
    <fieldset className="space-y-[12px]"><legend className="mb-[12px] font-semibold text-text-primary">Roles for {user.username}</legend>{roles.map(role => {
      const canGrant = role.protected ? superAdmin : role.permissions.every(p => access.permissions.includes(p))
      return <label key={role.id} className="flex items-start gap-[12px] rounded-[10px] border border-border-default p-[12px]"><input type="checkbox" className="mt-[4px]" checked={chosen.includes(role.id)} disabled={!canGrant} onChange={e => setChosen(e.target.checked ? [...chosen, role.id] : chosen.filter(id => id !== role.id))} /><span className="min-w-0"><span className="break-words font-semibold text-text-primary">{role.name}</span><span className="mt-[4px] block text-[13px] text-text-muted">{role.description}</span></span></label>
    })}</fieldset>
    <p className="break-words text-[14px] text-text-muted">Resulting permissions: {[...new Set(roles.filter(r => chosen.includes(r.id)).flatMap(r => r.permissions))].sort().join(', ') || 'None'}</p>
    <Field label="Reason" value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} />
    {state.error && <FormAlert kind="error">{state.error}</FormAlert>}<Button type="submit" loading={state.busy}>Save role assignments</Button>
  </form></Sheet>
}
function AdjustCredits({ id, close }: { id: string; close: () => void }) {
  const [delta, setDelta] = useState(''), [reason, setReason] = useState(''), [key] = useState(() => crypto.randomUUID())
  const state = useAdminSave()
  return <Sheet title="Adjust AI credits" onClose={() => { if (!state.busy) close() }}><form onSubmit={e => { e.preventDefault(); if (Number.isSafeInteger(Number(delta)) && Number(delta) !== 0) void state.save(() => api.adminAdjustCredits(id, Number(delta), reason.trim(), key), close) }} className="space-y-[16px]">
    <p className="text-text-muted">Positive credits repay any refund debt first. Negative adjustments remove spendable credits; any amount beyond the balance becomes debt. This creates a permanent ledger entry.</p>
    <Field label="Credit adjustment" type="number" step="1" required value={delta} onChange={e => setDelta(e.target.value)} hint="Use a positive number to add credits or a negative number to remove them." />
    <Field label="Reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
    {state.error && <FormAlert kind="error">{state.error}</FormAlert>}<Button type="submit" loading={state.busy} disabled={!Number.isSafeInteger(Number(delta)) || Number(delta) === 0}>Confirm credit adjustment</Button>
  </form></Sheet>
}
export function AdminUserDetail() {
  const { userId } = useParams({ strict: false }) as { userId: string }
  const access = useAccess()
  const userQuery = useAdminQuery(['user', userId], signal => api.adminUser(userId, signal), 'users.read')
  const roles = useAdminQuery(['roles'], signal => api.adminRoles(signal), 'roles.read')
  const [creditOffset, setCreditOffset] = useState(0)
  const credits = useAdminQuery(['user-credits', userId, creditOffset], signal => api.adminUserCredits(userId, signal, creditOffset), 'credits.read')
  const [dialog, setDialog] = useState<'roles' | 'status' | 'tokens' | 'credits' | 'hold' | null>(null)
  const user = userQuery.data?.user
  return <div className="space-y-[20px]"><Link to="/admin/users" className="text-link">← All users</Link><LoadState loading={userQuery.isLoading} error={userQuery.error} retry={userQuery.refetch} />
    {user && <><Panel title={user.username || 'User account'}><dl className="grid gap-[16px] sm:grid-cols-2">{[['Email', user.email ?? 'Not available'], ['User ID', user.id], ['Joined', fmtDate(user.createdAt)], ['Last sign in', fmtDate(user.lastSignInAt)], ['Status', user.suspended ? 'Suspended' : 'Active']].map(([label, value]) => <div key={label}><dt className="text-[14px] text-text-muted">{label}</dt><dd className="mt-[4px] break-all text-text-primary">{value}</dd></div>)}</dl>
      <div className="mt-[20px] flex flex-wrap gap-[12px]">{access.permissions.includes('users.manage') && <><Button variant="ghost" onClick={() => setDialog('status')}>{user.suspended ? 'Reactivate account' : 'Suspend account'}</Button><Button variant="ghost" onClick={() => setDialog('tokens')}>Revoke connectors</Button></>}</div></Panel>
      <Panel title="Roles and permissions"><p className="break-words text-text-body">{user.roles.map(r => r.name).join(', ') || 'No assigned roles'}</p><p className="my-[16px] break-words text-[14px] text-text-muted">{userQuery.data?.permissions.join(', ') || 'No privileged permissions'}</p>
        {access.permissions.includes('roles.manage') && roles.data && <Button onClick={() => setDialog('roles')}>Assign roles</Button>}</Panel>
      <Panel title="Account activity"><dl className="flex flex-wrap gap-[24px]">{Object.entries(userQuery.data?.stats ?? {}).map(([key, count]) => <div key={key}><dt className="text-text-muted">{({ collectionItems: 'Collection items', decks: 'Decks', connectors: 'Connectors' } as Record<string, string>)[key]}</dt><dd className="text-[22px] text-text-primary">{count}</dd></div>)}</dl></Panel>
      {access.permissions.includes('credits.read') && <Panel title="AI credits"><LoadState loading={credits.isLoading} error={credits.error} retry={credits.refetch} />{credits.data && <><p className="text-[28px] font-bold text-text-primary">{credits.data.balance.toLocaleString()} credits</p>{credits.data.debt > 0 && <p className="mt-[8px] text-error">Refund debt: {credits.data.debt} credits. Incoming credits repay this first.</p>}{credits.data.purchaseHold && <p className="mt-[8px] text-error">Purchases are on hold pending payment review.</p>}<DataTable label="User credit ledger" className="mt-[16px]" rows={credits.data.events ?? []} getRowId={event => event.id}
        loading={credits.isPending} refreshing={credits.isFetching && !credits.isPending} error={credits.error?.message} onRetry={() => void credits.refetch()}
        empty={<EmptyState icon="lists" title="No credit activity" body="Credit adjustments and usage will appear here." />}
        pagination={{ offset: creditOffset, pageSize: 25, total: credits.data.total ?? 0, onOffsetChange: setCreditOffset }}
        columns={[
          { id: 'date', header: 'Date', className: 'min-w-[170px]', cell: event => fmtDate(event.createdAt) },
          { id: 'kind', header: 'Activity', className: 'min-w-[150px] break-words', cell: event => event.kind },
          { id: 'delta', header: 'Credits', align: 'right', cell: event => (event.delta > 0 ? '+' : '') + event.delta.toLocaleString() },
          { id: 'debt', header: 'Debt change', align: 'right', cell: event => event.debtDelta ? (event.debtDelta > 0 ? '+' : '') + event.debtDelta.toLocaleString() : '—' },
          { id: 'reason', header: 'Reason', className: 'min-w-[200px] max-w-[360px] break-words', cell: event => event.reason || '—' },
        ]} /></>}{access.permissions.includes('credits.manage') && <div className="mt-[16px] flex flex-wrap gap-[12px]"><Button onClick={() => setDialog('credits')}>Adjust credits</Button>{credits.data?.purchaseHold && !credits.data.debt && <Button variant="ghost" onClick={() => setDialog('hold')}>Resolve purchase hold</Button>}</div>}</Panel>}
      {dialog === 'roles' && roles.data && <AssignRoles user={user} roles={roles.data.roles} close={() => setDialog(null)} />}
      {dialog === 'credits' && <AdjustCredits id={user.id} close={() => setDialog(null)} />}
      {dialog === 'status' && <ConfirmAction title={user.suspended ? 'Reactivate account' : 'Suspend account'} description={user.suspended ? 'Restore app access. Previously revoked connector tokens remain revoked.' : 'Block new app requests and connector access. Work already sent to an external provider may finish.'} close={() => setDialog(null)} action={reason => api.adminUserStatus(user.id, !user.suspended, user.revision, reason)} />}
      {dialog === 'tokens' && <ConfirmAction title="Revoke connectors" description="Revoke all connector tokens. The user will need to reconnect their assistants. This does not sign them out of the app." close={() => setDialog(null)} action={reason => api.adminRevokeTokens(user.id, reason)} />}
      {dialog === 'hold' && <ConfirmAction title="Resolve purchase hold" description="Clear a closed dispute hold after reviewing the payment. Open disputes and unpaid credit debt cannot be cleared." close={() => setDialog(null)} action={reason => api.adminResolveCreditHold(user.id, reason)} />}
    </>}
  </div>
}
