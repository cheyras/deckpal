import { useState } from 'react'
import { Button, Field, FormAlert, EmptyState } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { api } from '../../lib/api'
import { useAccess, invalidateAccess } from '../../lib/access'
import type { AdminRole, Permission } from '../../lib/adminTypes'
import { useAdminQuery, useAdminSave, LoadState, ConfirmAction, Panel } from './shared'

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
  return <section className="space-y-[20px]"><div className="flex flex-wrap items-center justify-between gap-[12px]"><h2 className="font-display text-[24px] text-text-primary">Roles</h2>{canManage && <Button onClick={() => setEditing({ clone: false })}>Create role</Button>}</div>
    <p className="max-w-[760px] text-text-muted">Assign roles from a user's account. A person receives the combined permissions of all their roles. The built-in super administrator role is protected.</p>
    <LoadState loading={query.isLoading} error={query.error} retry={query.refetch} />
    {query.data?.roles.length === 0 && <EmptyState icon="lists" title="No roles available" body="Create a role to define a contributor's access." />}
    <div className="grid gap-[16px] lg:grid-cols-2">{query.data?.roles.map(role => <Panel key={role.id} title={role.name}><p className="text-text-muted">{role.description}</p><p className="mt-[12px] text-[14px] text-text-body">{role.memberCount} member{role.memberCount === 1 ? '' : 's'} · {role.permissions.length} permissions{role.protected ? ' · Protected' : ''}</p><details className="mt-[12px] text-[14px] text-text-muted"><summary className="cursor-pointer text-link">View permissions</summary><ul className="mt-[8px] space-y-[4px]">{role.permissions.map(p => <li key={p}>{p}</li>)}</ul></details>
      {canManage && <div className="mt-[16px] flex flex-wrap gap-[10px]">{!role.protected && <Button variant="ghost" onClick={() => setEditing({ role, clone: false })}>Edit {role.name}</Button>}<Button variant="ghost" onClick={() => setEditing({ role, clone: true })}>Clone {role.name}</Button>{!role.protected && <Button variant="ghost" disabled={role.memberCount > 0} title={role.memberCount ? 'Remove assignments before deleting this role.' : undefined} onClick={() => setDeleting(role)}>Delete {role.name}</Button>}</div>}
    </Panel>)}</div>
    {editing && query.data && <RoleEditor {...editing} catalog={query.data.permissions} close={() => setEditing(null)} />}
    {deleting && <ConfirmAction title="Delete role" reasonRequired={false} description={'Delete ' + deleting.name + '? Assigned roles cannot be deleted. This action is recorded in the audit log.'} close={() => setDeleting(null)} action={() => api.adminDeleteRole(deleting.id, deleting.revision)} />}
  </section>
}
