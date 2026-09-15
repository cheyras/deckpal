import { useState } from 'react'
import type { GalleryMeta } from '../../routes/design/galleryTypes'
import { DataTable, DataTableToolbar, type DataTableColumn, type DataTableSort } from './DataTable'

interface Member { id: string; name: string; email: string; role: string; status: 'Active' | 'Suspended'; decks: number }
const names = ['Ada Brooks', 'Ravi Chen', 'Maya Ellis', 'Noah Reed', 'Zoe Morgan', 'Luca Patel']
const members: Member[] = Array.from({ length: 63 }, (_, index) => ({
  id: `member-${index + 1}`,
  name: `${names[index % names.length]} ${String(index + 1).padStart(2, '0')}`,
  email: `collector.${index + 1}@example.test`,
  role: index % 3 === 0 ? 'Contributor' : 'Collector',
  status: index % 7 === 0 ? 'Suspended' : 'Active',
  decks: (index * 13) % 47,
}))
const columns: DataTableColumn<Member>[] = [
  { id: 'name', header: 'Member', sortable: true, className: 'min-w-[220px] max-w-[320px]', cell: member => <div>
    <span className="font-bold text-text-primary">{member.name}</span>
    <p className="mt-[4px] text-text-muted">{member.email}</p>
  </div> },
  { id: 'role', header: 'Role', cell: member => member.role },
  { id: 'status', header: 'Status', cell: member => <span className={member.status === 'Active' ? 'text-success' : 'text-error'}>{member.status}</span> },
  { id: 'decks', header: 'Decks', sortable: true, align: 'right', cell: member => member.decks },
]
interface ExampleProps { mode: 'ready' | 'loading' | 'empty' | 'error' }

/** Local complete-set example. Server consumers instead pass their API's exact page/total. */
function DataTableExample({ mode }: ExampleProps) {
  // Each gallery mode starts its own scenario, including a fresh failed request.
  return <DataTableExampleState key={mode} mode={mode} />
}

function DataTableExampleState({ mode }: ExampleProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'name', direction: 'asc' })
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [retried, setRetried] = useState(false)
  const needle = search.trim().toLowerCase()
  const filtered = (mode === 'empty' ? [] : members).filter(member =>
    (status === 'all' || member.status === status) && `${member.name} ${member.email}`.toLowerCase().includes(needle),
  ).sort((left, right) => {
    const order = sort.columnId === 'decks' ? left.decks - right.decks : left.name.localeCompare(right.name)
    return (order || left.id.localeCompare(right.id)) * (sort.direction === 'asc' ? 1 : -1)
  })
  return <DataTable label="Example members" columns={columns} rows={filtered.slice(offset, offset + pageSize)} getRowId={member => member.id}
    getRowLabel={member => member.name}
    sort={sort} onSortChange={next => { setSort(next); setOffset(0) }}
    pagination={{ offset, pageSize, total: filtered.length, onOffsetChange: setOffset, onPageSizeChange: setPageSize }}
    loading={mode === 'loading'} error={mode === 'error' && !retried ? 'Example request failed. Retry to view the fictional records.' : undefined}
    onRetry={() => setRetried(true)} empty="No example members match these filters."
    renderExpandedRow={member => <p>{member.name} has {member.decks} decks. This fictional record demonstrates optional row details.</p>}
    toolbar={<DataTableToolbar label="Filter example members" search={{
      label: 'Member name or email', value: search, onChange: value => { setSearch(value); setOffset(0) }, placeholder: 'Try collector.40',
    }} onReset={() => { setSearch(''); setStatus('all'); setOffset(0) }} resetDisabled={!search && status === 'all'}>
      <label className="block text-[14px] font-semibold text-text-secondary">Status
        <select value={status} onChange={event => { setStatus(event.target.value); setOffset(0) }}
          className="mt-[6px] block rounded-[10px] border border-action-ghost-border bg-surface-tertiary px-[14px] py-[12px] text-[15px] text-text-primary">
          <option value="all">All statuses</option><option value="Active">Active</option><option value="Suspended">Suspended</option>
        </select>
      </label>
    </DataTableToolbar>}
  />
}

export default {
  name: 'DataTable',
  source: 'apps/web/src/components/ui/DataTable.tsx',
  section: 'component',
  description: 'Reusable row table and filter toolbar. The owner supplies the complete local result or an exact server page; sorting and pagination are controlled. All examples are fictional and stay in this browser.',
  component: DataTableExample,
  defaults: { mode: 'ready' },
  variants: [
    { label: 'Interactive search, status, sort and pages', props: { mode: 'ready' } },
    { label: 'Loading', props: { mode: 'loading' } },
    { label: 'Empty', props: { mode: 'empty' } },
    { label: 'Error and retry', props: { mode: 'error' } },
  ],
  knobs: { mode: { kind: 'select', options: ['ready', 'loading', 'empty', 'error'] as const } },
} satisfies GalleryMeta<ExampleProps>