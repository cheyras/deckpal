import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataTable, DataTableToolbar, type DataTableProps } from '../DataTable'
import { getDataTablePage, nextDataTableSort } from '../dataTableHelpers'

test('pagination has honest zero, partial-last-page and deleted-page boundaries', () => {
  const empty = getDataTablePage(0, 25, 0, 0)
  assert.deepEqual([empty.from, empty.to, empty.canPrevious, empty.canNext], [0, 0, false, false])
  const last = getDataTablePage(50, 25, 63, 13)
  assert.deepEqual([last.from, last.to, last.canPrevious, last.canNext], [51, 63, true, false])
  const deleted = getDataTablePage(50, 25, 50, 0)
  assert.equal(deleted.isOutOfRange, true)
  assert.equal(deleted.offset, 25)
  assert.deepEqual([deleted.from, deleted.to], [0, 0], 'a page awaiting recovery must not claim rows')
  const emptyAfterDelete = getDataTablePage(25, 25, 0, 0)
  assert.equal(emptyAfterDelete.offset, 0)
  assert.equal(emptyAfterDelete.isOutOfRange, true)
})

test('page boundaries survive invalid input and page-size changes', () => {
  for (const [offset, size, total] of [[NaN, 0, NaN], [-25, -1, -1], [Infinity, Infinity, Infinity]]) {
    const page = getDataTablePage(offset!, size!, total!, 0)
    assert.equal(page.offset, 0)
    assert.equal(page.pageSize, 25)
    assert.equal(page.from, 0)
    assert.equal(page.canNext, false)
  }
  assert.equal(getDataTablePage(25, 50, 120, 50).offset, 0, 'old offset is aligned to the new page size')
  assert.equal(getDataTablePage(75, 50, 120, 50).offset, 50)
  assert.equal(getDataTablePage(0, 25, 70, 7).to, 7, 'range reports actual rows, not capacity')
})

test('sort switches columns ascending and toggles the existing column without mutating its owner', () => {
  const current = { columnId: 'name', direction: 'asc' as const }
  assert.deepEqual(nextDataTableSort(current, 'name'), { columnId: 'name', direction: 'desc' })
  assert.deepEqual(nextDataTableSort({ columnId: 'name', direction: 'desc' }, 'name'), current)
  assert.deepEqual(nextDataTableSort(current, 'count'), { columnId: 'count', direction: 'asc' })
  assert.equal(current.direction, 'asc')
})

interface Row { id: string; name: string }
const rows = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }]
const base: DataTableProps<Row> = {
  label: 'Members', rows, getRowId: row => row.id,
  columns: [{ id: 'name', header: 'Name', sortable: true, cell: row => createElement('a', { href: `/members/${row.id}` }, row.name) }],
}
const render = (props: Partial<DataTableProps<Row>> = {}) => renderToStaticMarkup(createElement(DataTable<Row>, { ...base, ...props }))

test('table owns semantics and navigation controls but preserves parent row ordering', () => {
  const html = render({ sort: { columnId: 'name', direction: 'asc' }, onSortChange: () => {},
    pagination: { offset: 0, pageSize: 25, total: 63, onOffsetChange: () => {} },
    renderExpandedRow: row => row.name, getRowLabel: row => row.name })
  assert.match(html, /<table\b/)
  assert.match(html, /<caption[^>]*>Members<\/caption>/)
  assert.match(html, /<th[^>]*scope="col"[^>]*aria-sort="ascending"/)
  assert.match(html, /aria-label="Name: sort descending"/)
  assert.match(html, /role="region"[^>]*aria-label="Members table"/)
  assert.match(html, /href="\/members\/b"/)
  assert.ok(html.indexOf('href="/members/b"') < html.indexOf('href="/members/a"'), 'no implicit sorting of a server page')
  assert.match(html, /aria-label="Details for Beta" aria-expanded="false"/)
  assert.match(html, /1–2 of 63 results/)
  assert.doesNotMatch(html, /Rows per page/, 'fixed-page APIs have no misleading selector')
  const noSort = render()
  assert.doesNotMatch(noSort, /aria-sort=/, 'sortable metadata alone must not imply supported sort')
})

test('pending, refreshing, error and out-of-range states never expose stale rows', () => {
  for (const props of [{ loading: true }, { refreshing: true }, { error: 'Request failed', onRetry: () => {} },
    { pagination: { offset: 50, pageSize: 25, total: 20, onOffsetChange: () => {} } }]) {
    const html = render(props)
    assert.doesNotMatch(html, /href="\/members\//)
    assert.doesNotMatch(html, /1–2 of/, 'stale data must not be labelled as current results')
  }
  assert.match(render({ error: 'Request failed', onRetry: () => {} }), /role="alert"/)
  assert.match(render({ error: 'Request failed', onRetry: () => {} }), />Retry<\/button>/)
  assert.match(render({ loading: true }), /role="status"[^>]*>Loading results…/)
  const empty = render({ rows: [], pagination: { offset: 0, pageSize: 25, total: 0, onOffsetChange: () => {} } })
  assert.match(empty, /0–0 of 0 results/)
  assert.match(empty, /No results match your filters\./)
})

test('toolbar names search/filter form and action controls using kit primitives', () => {
  const html = renderToStaticMarkup(createElement(DataTableToolbar, { label: 'Filter members',
    search: { label: 'Email', value: '', onChange: () => {}, placeholder: 'Search members', maxLength: 200 },
    onSubmit: () => {}, onReset: () => {} }))
  assert.match(html, /<form aria-label="Filter members"/)
  assert.match(html, /<label[^>]*for="[^"]+"[^>]*>Email<\/label>/)
  assert.match(html, /type="search"/)
  assert.match(html, /type="submit"[^>]*>Apply filters<\/button>/)
  assert.match(html, />Clear filters<\/button>/)
})