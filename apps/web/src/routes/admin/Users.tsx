import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { Button, Field, FormAlert, EmptyState } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { api } from '../../lib/api'
import { useAccess, invalidateAccess } from '../../lib/access'
import type { AdminUser, AdminRole } from '../../lib/adminTypes'
import { Panel, LoadState, Paging, useAdminQuery, useAdminSave, ConfirmAction, selectClass, fmtDate } from './shared'

export function AdminUsers() {
  const [search, setSearch] = useState(''), [term, setTerm] = useState(''), [status, setStatus] = useState('all'), [role, setRole] = useState(''), [offset, setOffset] = useState(0)
  const roles = useAdminQuery(['roles'], signal => api.adminRoles(signal), 'roles.read')
  const params = new URLSearchParams({ search, status, role, offset: String(offset), limit: '25' })
  const query = useAdminQuery(['users', params.toString()], signal => api.adminUsers(params.toString(), signal), 'users.read')
  return <section className="space-y-[20px]"><h2 className="font-display text-[24px] text-text-primary">Users</h2>
    <form onSubmit={e => { e.preventDefault(); setSearch(term); setOffset(0) }} className="grid items-end gap-[12px] md:grid-cols-[2fr_1fr_1fr_auto]">
      <Field label="Search users" type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Email, username, or ID" maxLength={200} />
      <label className="mb-[16px] text-[14px] font-semibold text-text-secondary">Status<select aria-label="Status" className={selectClass + ' mt-[6px]'} value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
      <label className="mb-[16px] text-[14px] font-semibold text-text-secondary">Role<select aria-label="Role" className={selectClass + ' mt-[6px]'} value={role} onChange={e => { setRole(e.target.value); setOffset(0) }}><option value="">All roles</option>{roles.data?.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <Button className="mb-[16px]" type="submit">Search</Button>
    </form>
    <LoadState loading={query.isLoading} error={query.error} retry={query.refetch} />
    {query.data && <>{!query.data.users.length ? <EmptyState icon="lists" title="No matching users" body="Try a different search or filter." /> : <><div className="space-y-[12px] md:hidden">{query.data.users.map(user => <article key={user.id} className="grid gap-[12px] rounded-[14px] border border-border-default bg-surface-secondary p-[16px] md:grid-cols-[2fr_2fr_1fr]">
      <div className="min-w-0"><Link to="/admin/users/$userId" params={{ userId: user.id }} className="break-words font-semibold text-link">{user.username || 'Unnamed user'}</Link><p className="mt-[4px] break-all text-[14px] text-text-muted">{user.email ?? user.id}</p></div>
      <div className="flex flex-wrap items-start gap-[6px]">{user.roles.length ? user.roles.map(r => <span key={r.id} className="break-words rounded-full bg-surface-tertiary px-[10px] py-[3px] text-[13px] text-text-body">{r.name}</span>) : <span className="text-[14px] text-text-muted">No assigned roles</span>}</div>
      <div className="text-[14px] text-text-muted"><span className={user.suspended ? 'text-error' : 'text-text-body'}>{user.suspended ? 'Suspended' : 'Active'}</span><p className="mt-[4px]">Joined {new Date(user.createdAt).toLocaleDateString()}</p></div>
    </article>)}</div><div className="hidden overflow-x-auto rounded-[14px] border border-border-default md:block"><table className="w-full text-left text-[14px]"><caption className="sr-only">Matching user accounts</caption><thead className="bg-surface-tertiary text-text-muted"><tr>{['User','Roles','Status','Joined'].map(label => <th key={label} scope="col" className="px-[16px] py-[12px] font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-border-default">{query.data.users.map(user => <tr key={user.id} className="bg-surface-secondary"><td className="max-w-[320px] px-[16px] py-[16px]"><Link to="/admin/users/$userId" params={{ userId: user.id }} className="break-words font-semibold text-link">{user.username || 'Unnamed user'}</Link><p className="mt-[4px] break-all text-text-muted">{user.email ?? user.id}</p></td><td className="max-w-[240px] break-words px-[16px] py-[16px] text-text-body">{user.roles.map(role => role.name).join(', ') || 'No assigned roles'}</td><td className="px-[16px] py-[16px] text-text-body">{user.suspended ? 'Suspended' : 'Active'}</td><td className="whitespace-nowrap px-[16px] py-[16px] text-text-muted">{new Date(user.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div></>}<Paging total={query.data.total} offset={offset} setOffset={setOffset} /></>}
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
      {access.permissions.includes('credits.read') && <Panel title="AI credits"><LoadState loading={credits.isLoading} error={credits.error} retry={credits.refetch} />{credits.data && <><p className="text-[28px] font-bold text-text-primary">{credits.data.balance.toLocaleString()} credits</p>{credits.data.debt > 0 && <p className="mt-[8px] text-error">Refund debt: {credits.data.debt} credits. Incoming credits repay this first.</p>}{credits.data.purchaseHold && <p className="mt-[8px] text-error">Purchases are on hold pending payment review.</p>}{credits.data.events?.length ? <ul className="my-[16px] divide-y divide-border-default">{credits.data.events.map(event => <li key={event.id} className="py-[8px] text-[14px] text-text-body">{event.delta > 0 ? '+' : ''}{event.delta} · {event.kind} · {fmtDate(event.createdAt)}<p className="text-text-muted">{event.reason}</p>{!!event.debtDelta && <p className="text-text-muted">Debt change: {event.debtDelta > 0 ? "+" : ""}{event.debtDelta} credits</p>}</li>)}</ul> : null}<Paging total={credits.data.total ?? 0} offset={creditOffset} setOffset={setCreditOffset} /></>}{access.permissions.includes('credits.manage') && <div className="mt-[16px] flex flex-wrap gap-[12px]"><Button onClick={() => setDialog('credits')}>Adjust credits</Button>{credits.data?.purchaseHold && !credits.data.debt && <Button variant="ghost" onClick={() => setDialog('hold')}>Resolve purchase hold</Button>}</div>}</Panel>}
      {dialog === 'roles' && roles.data && <AssignRoles user={user} roles={roles.data.roles} close={() => setDialog(null)} />}
      {dialog === 'credits' && <AdjustCredits id={user.id} close={() => setDialog(null)} />}
      {dialog === 'status' && <ConfirmAction title={user.suspended ? 'Reactivate account' : 'Suspend account'} description={user.suspended ? 'Restore app access. Previously revoked connector tokens remain revoked.' : 'Block new app requests and connector access. Work already sent to an external provider may finish.'} close={() => setDialog(null)} action={reason => api.adminUserStatus(user.id, !user.suspended, user.revision, reason)} />}
      {dialog === 'tokens' && <ConfirmAction title="Revoke connectors" description="Revoke all connector tokens. The user will need to reconnect their assistants. This does not sign them out of the app." close={() => setDialog(null)} action={reason => api.adminRevokeTokens(user.id, reason)} />}
      {dialog === 'hold' && <ConfirmAction title="Resolve purchase hold" description="Clear a closed dispute hold after reviewing the payment. Open disputes and unpaid credit debt cannot be cleared." close={() => setDialog(null)} action={reason => api.adminResolveCreditHold(user.id, reason)} />}
    </>}
  </div>
}
