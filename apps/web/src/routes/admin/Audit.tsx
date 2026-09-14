import { useState } from 'react'
import { Field, EmptyState, DataTable, DataTableToolbar } from '../../components/ui'
import { api } from '../../lib/api'
import { useAccess } from '../../lib/access'
import { useAdminQuery, fmtDate } from './shared'
export function AdminAudit() {
  const access = useAccess()
  const [draft, setDraft] = useState({ actor: '', action: '', target: '' }), [filters, setFilters] = useState(draft), [offset, setOffset] = useState(0), [pageSize, setPageSize] = useState(25)
  const params = new URLSearchParams({ ...filters, limit: String(pageSize), offset: String(offset) })
  const query = useAdminQuery(['audit', params.toString()], signal => api.adminAudit(params.toString(), signal), 'audit.read')
  return <section className="min-w-0 space-y-[20px]"><h2 className="font-display text-[24px] text-text-primary">Audit log</h2><p className="text-text-muted">Administrative changes, newest first. Filters match the exact actor ID, action, and target ID.</p>
    <DataTable label="Administrative audit events" rows={access.permissions.includes('audit.read') ? query.data?.events ?? [] : []} getRowId={event => event.id} getRowLabel={event => event.action + ' at ' + fmtDate(event.createdAt)}
      loading={query.isPending} refreshing={query.isFetching && !query.isPending} error={query.error?.message} onRetry={() => void query.refetch()}
      empty={<EmptyState icon="lists" title="No matching events" body="Try fewer filters. Future administrative changes will appear here." />}
      pagination={{ offset, pageSize, total: query.data?.total ?? 0, onOffsetChange: setOffset, onPageSizeChange: setPageSize }}
      toolbar={<DataTableToolbar label="Filter audit log" onSubmit={() => { setFilters({ actor: draft.actor.trim(), action: draft.action.trim(), target: draft.target.trim() }); setOffset(0) }} submitLabel="Filter audit log" onReset={() => { setDraft({ actor: '', action: '', target: '' }); setFilters({ actor: '', action: '', target: '' }); setOffset(0) }} resetDisabled={!Object.values(draft).some(Boolean) && !Object.values(filters).some(Boolean)}>{(['actor', 'action', 'target'] as const).map(key => <Field key={key} label={{ actor: 'Actor ID', action: 'Exact action', target: 'Target ID' }[key]} value={draft[key]} maxLength={200} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />)}</DataTableToolbar>}
      columns={[
        { id: 'time', header: 'Time', className: 'min-w-[170px]', cell: event => <time title={event.createdAt} dateTime={event.createdAt}>{fmtDate(event.createdAt)}</time> },
        { id: 'action', header: 'Action', className: 'min-w-[160px] max-w-[240px] break-all', cell: event => <strong>{event.action}</strong> },
        { id: 'actor', header: 'Actor', className: 'min-w-[180px] max-w-[240px] break-all', cell: event => <>{event.actorName || event.actorId}{event.actorName && <p className="mt-[4px] text-[12px] text-text-muted">{event.actorId}</p>}</> },
        { id: 'target', header: 'Target', className: 'min-w-[180px] max-w-[240px] break-all', cell: event => <>{event.targetType}{event.targetId && <p className="mt-[4px] text-[12px] text-text-muted">{event.targetId}</p>}</> },
        { id: 'reason', header: 'Reason', className: 'min-w-[200px] max-w-[320px] break-words', cell: event => event.reason || '—' },
      ]}
      renderExpandedRow={event => <div className="grid gap-[12px] md:grid-cols-2">{[['Before', event.before], ['After', event.after]].map(([label, value]) => <div key={String(label)} className="min-w-0"><h3 className="font-semibold text-text-primary">{String(label)}</h3><pre className="mt-[6px] max-h-[260px] overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-surface-tertiary p-[12px] text-[12px] text-text-muted">{JSON.stringify(value, null, 2) ?? '—'}</pre></div>)}</div>} />
  </section>
}
