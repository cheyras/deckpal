import { useState } from 'react'
import { api } from '../../lib/api'
import { useAccess } from '../../lib/access'
import type { AiOverride } from '../../lib/adminTypes'
import { decimalUnits } from '../../lib/creditMath'
import { Button, Field, FormAlert } from '../../components/ui'
import { Panel, LoadState, useAdminQuery, useAdminSave } from './shared'
function OverrideForm({ data }: { data: AiOverride }) {
  const [unlimited, setUnlimited] = useState(data.unlimited), [inherit, setInherit] = useState(data.markupBps === null), [markup, setMarkup] = useState(String((data.markupBps ?? data.effectiveMarkupBps) / 100)), [reason, setReason] = useState('')
  const state = useAdminSave(), units = decimalUnits(markup, 2), valid = inherit || units !== null && units <= 100000
  return <form className="space-y-[16px]" onSubmit={e => { e.preventDefault(); if (valid) void state.save(() => api.adminSetAiOverride(data.userId, { expectedRevision: data.revision, unlimited, markupBps: inherit ? null : units!, reason: reason.trim() })) }}><p className="text-text-muted">These settings belong to this user, independently of their role. Only an Owner can change them. Unlimited usage does not remove feature restrictions, suspension, refund debt, holds or operational limits.</p><label className="flex items-center gap-[10px] text-text-primary"><input type="checkbox" checked={unlimited} onChange={e => setUnlimited(e.target.checked)} />Unlimited AI credits</label><label className="flex items-center gap-[10px] text-text-primary"><input type="checkbox" checked={inherit} onChange={e => setInherit(e.target.checked)} />Inherit global markup</label>{!inherit && <Field label="User provider-cost markup (%)" inputMode="decimal" value={markup} onChange={e => setMarkup(e.target.value)} required hint="0 is a valid zero markup. Maximum 1000%, up to two decimal places." />}<p className="text-[14px] text-text-muted">Current effective markup: {data.effectiveMarkupBps / 100}%. Global pricing revision {data.globalPolicyRevision}; user override revision {data.revision}.</p><Field label="Override reason" value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} />{state.error && <FormAlert kind="error">{state.error}</FormAlert>}{state.success && <FormAlert kind="success">{state.success}</FormAlert>}<Button type="submit" loading={state.busy} disabled={!valid}>Save user AI override</Button></form>
}
export function UserAiOverride({ userId }: { userId: string }) {
  const access = useAccess()
  const query = useAdminQuery(['ai-override', userId], signal => api.adminAiOverride(userId, signal), 'credits.read')
  if (!access.actorCapabilities.canManageUserOverrides) return null
  return <Panel title="Owner controls: user AI override"><LoadState loading={query.isLoading} error={query.error} retry={query.refetch} />{query.data?.canEdit && <OverrideForm key={`${userId}:${query.data.revision}`} data={query.data} />}<Button variant="ghost" className="mt-[12px]" disabled={query.isFetching} onClick={() => void query.refetch()}>Reload and discard override draft</Button></Panel>
}
