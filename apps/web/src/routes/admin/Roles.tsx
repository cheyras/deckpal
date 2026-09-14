import { useState } from 'react'
import { Button, Field, FormAlert, EmptyState, DataTable, DataTableToolbar, type DataTableSort } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { api } from '../../lib/api'
import { useAccess, invalidateAccess } from '../../lib/access'
import type { AdminRole, Permission } from '../../lib/adminTypes'
import { useAdminQuery, useAdminSave, ConfirmAction, selectClass } from './shared'

function RoleEditor({ role, clone, catalog, close }: { role?: AdminRole; clone: boolean; catalog: Permission[]; close: () => void }) {
  const access = useAccess(), state = useAdminSave()
  const [name, setName] = useState(role ? role.name + (clone ? ' copy' : '') : ''), [description, setDescription] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState(role?.permissions ?? [])
  const groups = [...new Set(catalog.map(p => p.group))]
  return <Sheet title={role && !clone ? 'Edit role' : 'Create role'} size="lg" onClose={() => { if (!state.busy) close() }}><form className="space-y-[16px]" onSubmit={e => { e.preventDefault(); const body = { name: name.trim(), description: description.trim(), permissions }; void state.save(() => role && !clone ? api.adminUpdateRole(role.id, { ...body, expectedRevision: role.revision }) : api.adminCreateRole(body), () => { close(); invalidateAccess() }) }}>
    <Field label="Role name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
    <Field label="Description" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} />
    <p className="text-[14px] text-text-muted">Choose from permissions enforced by the app. Administration access opens this workspace; each section also requires its own permission. You can grant only permissions you hold.</p>
    {groups.map(group => <fieldset key={group} className="space-y-[12px] rounded-[12px] border border-border-default p-[16px]"><legend className="px-[6px] font-semibold text-text-primary">{group}</legend>{catalog.filter(p => p.group === group).map(permission => <label key={permission.key} className="flex items-start gap-[12px]"><input className="mt-[4px]" type="checkbox" checked={permissions.includes(permission.key)} disabled={!access.permissions.includes(permission.key)} onChange={e => setPermissions(e.target.checked ? [...permissions, permission.key] : permissions.filter(p => p !== permission.key))} /><span className="min-w-0"><span className="break-words font-semibold text-text-primary">{permission.key}</span><span className="mt-[2px] block text-[14px] text-text-muted">{permission.description}</span></span></label>)}</fieldset>)}
    {state.error && <FormAlert kind="error">{state.error}</FormAlert>}<Button loading={state.busy} type="submit">{role && !clone ? 'Save role' : 'Create role'}</Button>
  </form></Sheet>
}
export function AdminRoles() {
  const access = useAccess(), canManage = access.permissions.includes('roles.manage')
  const query = useAdminQuery(['roles'], signal => api.adminRoles(signal), 'roles.read')
  const [editing, setEditing] = useState<{ role?: AdminRole; clone: boolean } | null>(null), [deleting, setDeleting] = useState<AdminRole | null>(null)
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [offset, setOffset] = useState(0), [pageSize, setPageSize] = useState(25), [sort, setSort] = useState<DataTableSort>({ columnId: 'name', direction: 'asc' })
  const term = search.trim().toLocaleLowerCase()
  const filtered = (access.permissions.includes('roles.read') ? query.data?.roles ?? [] : []).filter(role => (!term || [role.name, role.key, role.description].some(value => value.toLocaleLowerCase().includes(term))) && (kind === 'all' || role.protected === (kind === 'protected'))).sort((a, b) => {
    const order = sort.columnId === 'members' ? a.memberCount - b.memberCount : sort.columnId === 'permissions' ? a.permissions.length - b.permissions.length : a.name.localeCompare(b.name)
    return (sort.direction === 'asc' ? 1 : -1) * (order || a.id.localeCompare(b.id))
  })
  return <section className="min-w-0 space-y-[20px]"><div className="flex flex-wrap items-center justify-between gap-[12px]"><h2 className="font-display text-[24px] text-text-primary">Roles</h2>{canManage && <Button onClick={() => setEditing({ clone: false })}>Create role</Button>}</div>
    <p className="max-w-[760px] text-text-muted">Assign roles from a user's account. A person receives the combined permissions of all their roles. The built-in super administrator role is protected.</p>
    <DataTable label="Administration roles" rows={filtered.slice(offset, offset + pageSize)} getRowId={role => role.id} getRowLabel={role => role.name}
      loading={query.isPending} refreshing={query.isFetching && !query.isPending} error={query.error?.message} onRetry={() => void query.refetch()}
      empty={<EmptyState icon="lists" title="No matching roles" body="Try a different filter, or create a role to define a contributor's access." />}
      sort={sort} onSortChange={next => { setSort(next); setOffset(0) }} pagination={{ offset, pageSize, total: filtered.length, onOffsetChange: setOffset, onPageSizeChange: setPageSize }}
      toolbar={<DataTableToolbar label="Filter roles" search={{ label: 'Search roles', value: search, onChange: value => { setSearch(value); setOffset(0) }, placeholder: 'Name, key, or description' }} onReset={() => { setSearch(''); setKind('all'); setOffset(0) }} resetDisabled={!search && kind === 'all'}><label className="text-[14px] font-semibold text-text-secondary">Role type<select aria-label="Role type" className={selectClass + ' mt-[6px]'} value={kind} onChange={e => { setKind(e.target.value); setOffset(0) }}><option value="all">All roles</option><option value="protected">Protected</option><option value="custom">Custom</option></select></label></DataTableToolbar>}
      columns={[
        { id: 'name', header: 'Role', sortable: true, className: 'min-w-[200px] max-w-[280px] break-words', cell: role => <><strong>{role.name}</strong><p className="mt-[4px] text-[12px] text-text-muted">{role.key}</p></> },
        { id: 'type', header: 'Type', cell: role => role.protected ? 'Protected' : 'Custom' },
        { id: 'members', header: 'Members', sortable: true, align: 'right', cell: role => role.memberCount.toLocaleString() },
        { id: 'permissions', header: 'Permissions', sortable: true, align: 'right', cell: role => role.permissions.length.toLocaleString() },
        ...(canManage ? [{ id: 'actions', header: 'Actions', className: 'min-w-[260px]', cell: (role: AdminRole) => <div className="flex flex-wrap gap-[8px]">{!role.protected && <Button variant="ghost" size="sm" aria-label={'Edit ' + role.name} onClick={() => setEditing({ role, clone: false })}>Edit</Button>}<Button variant="ghost" size="sm" aria-label={'Clone ' + role.name} onClick={() => setEditing({ role, clone: true })}>Clone</Button>{!role.protected && <Button variant="ghost" size="sm" aria-label={'Delete ' + role.name} disabled={role.memberCount > 0} title={role.memberCount ? 'Remove assignments before deleting this role.' : undefined} onClick={() => setDeleting(role)}>Delete</Button>}</div> }] : []),
      ]}
      renderExpandedRow={role => <div className="max-w-[760px] space-y-[12px]"><p className="break-words text-text-body">{role.description || 'No description.'}</p><h3 className="font-semibold text-text-primary">Permissions for {role.name}</h3>{role.permissions.length ? <ul className="grid gap-[4px] break-words text-text-muted sm:grid-cols-2">{role.permissions.map(permission => <li key={permission}>{permission}</li>)}</ul> : <p className="text-text-muted">No permissions.</p>}<p className="text-[12px] text-text-muted">Revision {role.revision}</p></div>} />
    {canManage && editing && query.data && <RoleEditor {...editing} catalog={query.data.permissions} close={() => setEditing(null)} />}
    {canManage && deleting && <ConfirmAction title="Delete role" reasonRequired={false} description={'Delete ' + deleting.name + '? Assigned roles cannot be deleted. This action is recorded in the audit log.'} close={() => setDeleting(null)} action={() => api.adminDeleteRole(deleting.id, deleting.revision)} />}
  </section>
}
