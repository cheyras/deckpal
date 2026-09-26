/** Controlled table helpers. These never filter, sort or slice a data set. */
export interface DataTableSort {
  columnId: string
  direction: 'asc' | 'desc'
}

export const DATA_TABLE_PAGE_SIZES = [25, 50, 100] as const

export function nextDataTableSort(current: DataTableSort | null | undefined, columnId: string): DataTableSort {
  return { columnId, direction: current?.columnId === columnId && current.direction === 'asc' ? 'desc' : 'asc' }
}

function count(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** Last-page recovery uses a settled total, never an in-flight response's placeholder. */
export function getDataTablePage(offset: number, pageSize: number, total: number, rowCount: number) {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 25
  const countTotal = count(total)
  const requestedOffset = count(offset)
  const lastOffset = countTotal === 0 ? 0 : Math.floor((countTotal - 1) / size) * size
  const boundedOffset = Math.min(Math.floor(requestedOffset / size) * size, lastOffset)
  const isOutOfRange = offset !== boundedOffset
  const visible = isOutOfRange ? 0 : Math.min(count(rowCount), Math.max(0, countTotal - boundedOffset))
  return {
    offset: boundedOffset,
    pageSize: size,
    total: countTotal,
    lastOffset,
    isOutOfRange,
    from: visible === 0 ? 0 : boundedOffset + 1,
    to: visible === 0 ? 0 : boundedOffset + visible,
    canPrevious: boundedOffset > 0,
    canNext: boundedOffset + size < countTotal,
  }
}