import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from '../Icon'
import { Field } from './Field'
import { DATA_TABLE_PAGE_SIZES, getDataTablePage, nextDataTableSort, type DataTableSort } from './dataTableHelpers'

export type { DataTableSort } from './dataTableHelpers'

export interface DataTableColumn<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Enable only when the parent can sort the complete result set. */
  sortable?: boolean
  align?: 'left' | 'right'
  className?: string
  headerClassName?: string
}

export interface DataTablePagination {
  offset: number
  pageSize: number
  /** Exact total for the applied filters. Ignored while loading/refreshing. */
  total: number
  onOffsetChange: (offset: number) => void
  /** Omit for an API with a fixed page size. Both callbacks run when size changes. */
  onPageSizeChange?: (size: number) => void
}

export interface DataTableProps<T> {
  label: string
  /** Already filtered, sorted and paged by the owner; the table never transforms rows. */
  rows: readonly T[]
  columns: readonly DataTableColumn<T>[]
  getRowId: (row: T) => string
  toolbar?: ReactNode
  sort?: DataTableSort | null
  onSortChange?: (sort: DataTableSort) => void
  /** Parent resets offset alongside changes to its applied filters/sort. */
  pagination?: DataTablePagination
  loading?: boolean
  refreshing?: boolean
  error?: ReactNode
  onRetry?: () => void
  empty?: ReactNode
  renderExpandedRow?: (row: T) => ReactNode
  getRowLabel?: (row: T) => string
  className?: string
}

/**
 * A semantic, horizontally scrollable row table at every viewport width.
 * Async owners must pass loading/refreshing until rows AND total match applied
 * filters. Pending/error states withhold rows, including expanded private data.
 */
export function DataTable<T>({
  label, rows, columns, getRowId, toolbar, sort, onSortChange, pagination,
  loading = false, refreshing = false, error, onRetry,
  empty = 'No results match your filters.', renderExpandedRow, getRowLabel, className = '',
}: DataTableProps<T>) {
  const id = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const region = scrollRef.current
    if (!region) return
    const measure = () => setOverflows(region.scrollWidth > region.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(region)
    if (region.firstElementChild) observer.observe(region.firstElementChild)
    return () => observer.disconnect()
  }, [])
  const busy = loading || refreshing
  const hasError = Boolean(error)
  const page = pagination ? getDataTablePage(pagination.offset, pagination.pageSize, pagination.total, rows.length) : null
  const correctingPage = Boolean(!busy && !hasError && page?.isOutOfRange)
  const hideRows = busy || hasError || correctingPage
  const [expanded, setExpanded] = useState<{ rows: readonly T[]; ids: Set<string> }>({ rows, ids: new Set() })
  const onOffsetChange = pagination?.onOffsetChange
  const recoveredOffset = page?.offset
  useEffect(() => {
    if (correctingPage && recoveredOffset !== undefined) onOffsetChange?.(recoveredOffset)
  }, [correctingPage, recoveredOffset, onOffsetChange])

  const status = hasError ? 'Results unavailable.'
    : loading ? 'Loading results…'
    : refreshing ? 'Refreshing results…'
    : correctingPage ? 'Updating page…'
    : page ? `${page.from.toLocaleString()}–${page.to.toLocaleString()} of ${page.total.toLocaleString()} results`
    : `${rows.length.toLocaleString()} ${rows.length === 1 ? 'result' : 'results'}`
  const columnCount = columns.length + (renderExpandedRow ? 1 : 0)

  return (
    <section aria-label={label} className={`min-w-0 max-w-full space-y-[12px] ${className}`}>
      {toolbar}
      {overflows && <p id={`${id}-scroll-hint`} className="text-[14px] text-text-muted">Scroll horizontally to see all columns.</p>}
      <div
        ref={scrollRef} role="region" aria-label={`${label} table`} aria-describedby={overflows ? `${id}-scroll-hint` : undefined}
        tabIndex={overflows ? 0 : undefined} aria-busy={busy || correctingPage || undefined}
        className="max-w-full overflow-x-auto overscroll-x-contain rounded-[12px] border border-border-default bg-surface-secondary focus-visible:outline-offset-[-2px]"
      >
        <table className="w-full min-w-full border-collapse text-[14px] text-text-body">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-surface-tertiary text-text-secondary">
            <tr>
              {columns.map(column => {
                const sortable = Boolean(column.sortable && onSortChange)
                const direction = sortable && sort?.columnId === column.id ? sort.direction : undefined
                const next = nextDataTableSort(sort, column.id)
                return (
                  <th key={column.id} scope="col"
                    aria-sort={sortable ? direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none' : undefined}
                    className={`px-[16px] py-[12px] font-bold ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.headerClassName ?? ''}`}
                  >
                    {sortable ? (
                      <button type="button" disabled={hideRows}
                        className="inline-flex min-h-[36px] items-center gap-[6px] rounded-[4px] text-text-primary disabled:opacity-50"
                        aria-label={`${column.header}: sort ${next.direction === 'asc' ? 'ascending' : 'descending'}`}
                        onClick={() => onSortChange?.(next)}
                      >
                        {column.header}<Icon name={direction === 'asc' ? 'arrow-up' : direction === 'desc' ? 'arrow-down' : 'arrow-up-down'} size={14} />
                      </button>
                    ) : column.header}
                  </th>
                )
              })}
              {renderExpandedRow && <th scope="col" className="px-[16px] py-[12px] text-left font-bold">Details</th>}
            </tr>
          </thead>
          <tbody>
            {hideRows || rows.length === 0 ? (
              <tr><td colSpan={columnCount} className="px-[16px] py-[24px] text-text-secondary">
                {hasError ? <div role="alert" className="space-y-[12px] text-error">
                  <div>{error}</div>
                  {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
                </div> : busy || correctingPage ? status : empty}
              </td></tr>
            ) : rows.map(row => {
              const rowId = getRowId(row)
              const isExpanded = expanded.rows === rows && expanded.ids.has(rowId)
              const detailsId = `${id}-details-${encodeURIComponent(rowId)}`
              const rowLabel = getRowLabel?.(row) ?? rowId
              return (
                <Fragment key={rowId}>
                  <tr className="border-t border-border-default align-top hover:bg-surface-tertiary-subtle focus-within:bg-surface-tertiary-subtle">
                    {columns.map(column => <td key={column.id}
                      className={`px-[16px] py-[12px] whitespace-normal [overflow-wrap:anywhere] ${column.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${column.className ?? 'min-w-[120px] max-w-[360px]'}`}
                    >{column.cell(row)}</td>)}
                    {renderExpandedRow && <td className="px-[16px] py-[12px]">
                      <Button variant="ghost" size="sm" aria-label={`Details for ${rowLabel}`} aria-expanded={isExpanded}
                        aria-controls={isExpanded ? detailsId : undefined}
                        onClick={() => setExpanded(previous => {
                          const ids = new Set(previous.rows === rows ? previous.ids : [])
                          if (ids.has(rowId)) ids.delete(rowId)
                          else ids.add(rowId)
                          return { rows, ids }
                        })}
                      >{isExpanded ? 'Hide' : 'Show'}</Button>
                    </td>}
                  </tr>
                  {renderExpandedRow && isExpanded && <tr id={detailsId} className="border-t border-border-default bg-surface-tertiary-subtle">
                    <td colSpan={columnCount} className="px-[16px] py-[16px]">
                      <div role="region" aria-label={`Details for ${rowLabel}`} className="max-w-full [overflow-wrap:anywhere]">
                        {renderExpandedRow(row)}
                      </div>
                    </td>
                  </tr>}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-[12px]">
        <p role="status" aria-live="polite" aria-atomic="true" className="text-[14px] text-text-secondary">{status}</p>
        {pagination && page && <div className="flex max-w-full flex-wrap items-center gap-[12px]">
          {pagination.onPageSizeChange && <label className="flex items-center gap-[8px] text-[14px] text-text-secondary">
            Rows per page
            <select value={pagination.pageSize} disabled={hideRows}
              onChange={event => {
                pagination.onPageSizeChange?.(Number(event.target.value))
                pagination.onOffsetChange(0)
              }}
              className="rounded-[8px] border border-action-ghost-border bg-surface-tertiary px-[10px] py-[8px] text-text-primary disabled:opacity-50"
            >
              {DATA_TABLE_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>}
          <div className="flex items-center gap-[8px]">
            <Button variant="ghost" size="sm" disabled={hideRows || !page.canPrevious}
              onClick={() => pagination.onOffsetChange(Math.max(0, page.offset - page.pageSize))}>Previous</Button>
            <Button variant="ghost" size="sm" disabled={hideRows || !page.canNext}
              onClick={() => pagination.onOffsetChange(page.offset + page.pageSize)}>Next</Button>
          </div>
        </div>}
      </div>
    </section>
  )
}

export interface DataTableToolbarProps {
  label: string
  search?: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; maxLength?: number }
  /** Compose labelled Field/select controls here; filtering belongs to the caller. */
  children?: ReactNode
  actions?: ReactNode
  onSubmit?: () => void
  submitLabel?: string
  onReset?: () => void
  resetDisabled?: boolean
  busy?: boolean
}

/** Shared responsive search/filter/action layout; supports draft-submit or live filters. */
export function DataTableToolbar({
  label, search, children, actions, onSubmit, submitLabel = 'Apply filters', onReset,
  resetDisabled = false, busy = false,
}: DataTableToolbarProps) {
  return (
    <form aria-label={label} onSubmit={event => { event.preventDefault(); onSubmit?.() }}
      className="flex min-w-0 flex-wrap items-end gap-[12px] rounded-[12px] border border-border-default bg-surface-secondary p-[16px]"
    >
      {search && <div className="min-w-0 basis-[240px] grow [&>div]:mb-0">
        <Field label={search.label} type="search" value={search.value} placeholder={search.placeholder} maxLength={search.maxLength}
          onChange={event => search.onChange(event.target.value)} />
      </div>}
      <div className="flex min-w-0 flex-wrap items-end gap-[12px] [&>div]:mb-0 [&>div]:min-w-0 [&>label]:min-w-0">{children}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
        {onSubmit && <Button type="submit" variant="secondary" loading={busy}>{submitLabel}</Button>}
        {onReset && <Button variant="ghost" disabled={resetDisabled} onClick={onReset}>Clear filters</Button>}
        {actions}
      </div>
    </form>
  )
}