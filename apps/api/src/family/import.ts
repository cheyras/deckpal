import { createHash } from 'node:crypto'

const CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'DMG'])
const FINISH_ALIASES = new Map([
  ['primary', 'primary'], ['default', 'primary'], ['normal', 'normal'],
  ['holo', 'holo'], ['holofoil', 'holo'], ['reverse', 'reverse'],
  ['reverseholo', 'reverse'], ['reverseholofoil', 'reverse'],
])

export interface FamilyImportRow {
  cardId: string
  finish: string
  quantity: number
  condition: string
}

export interface FamilyImportParseResult {
  rows: FamilyImportRow[]
  errors: { row: number; message: string }[]
  fingerprint: string
}

function csvLine(line: string): string[] {
  const fields: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (char === ',' && !quoted) { fields.push(value); value = '' } else value += char
  }
  fields.push(value)
  return fields.map((field) => field.trim())
}

function normalizedFinish(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  return FINISH_ALIASES.get(key) ?? (raw && raw.length <= 80 ? raw.toLowerCase() : null)
}

export function parseFamilyCollectionImport(input: string): FamilyImportParseResult {
  const text = input.replace(/^\uFEFF/, '').trim()
  const errors: { row: number; message: string }[] = []
  let rawItems: unknown[] = []
  if (!text) errors.push({ row: 0, message: 'Import file is empty' })
  else if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown
      rawItems = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { items?: unknown[] }).items) ? (parsed as { items: unknown[] }).items : []
      if (!rawItems.length) errors.push({ row: 0, message: 'JSON must contain a non-empty items array' })
    } catch { errors.push({ row: 0, message: 'JSON could not be parsed' }) }
  } else {
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    const headers = csvLine(lines.shift() ?? '').map((header) => header.toLowerCase())
    const required = ['cardid', 'finish', 'quantity', 'condition']
    if (required.some((header) => !headers.includes(header))) errors.push({ row: 1, message: 'CSV headers must be cardId,finish,quantity,condition' })
    rawItems = lines.map((line) => {
      const values = csvLine(line)
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
    })
  }

  if (rawItems.length > 5_000) errors.push({ row: 0, message: 'Import is limited to 5,000 rows' })
  const folded = new Map<string, FamilyImportRow>()
  const conditionByPrinting = new Map<string, string>()
  rawItems.slice(0, 5_000).forEach((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>
    const cardId = String(item.cardId ?? item.cardid ?? '').trim()
    const finish = normalizedFinish(item.finish)
    const quantity = Number(item.quantity)
    const condition = String(item.condition ?? '').trim().toUpperCase()
    const rowNumber = index + 2
    if (!cardId || cardId.length > 120) { errors.push({ row: rowNumber, message: 'cardId is required' }); return }
    if (!finish) { errors.push({ row: rowNumber, message: 'finish is required' }); return }
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) { errors.push({ row: rowNumber, message: 'quantity must be an integer from 0 to 100000' }); return }
    if (!CONDITIONS.has(condition)) { errors.push({ row: rowNumber, message: 'condition must be NM, LP, MP, HP or DMG' }); return }
    const printingKey = `${cardId.toLowerCase()}\u0000${finish}`
    const existingCondition = conditionByPrinting.get(printingKey)
    if (existingCondition && existingCondition !== condition) {
      errors.push({ row: rowNumber, message: 'One physical printing can have only one condition in DeckPal' })
      return
    }
    conditionByPrinting.set(printingKey, condition)
    const key = `${cardId.toLowerCase()}\u0000${finish}\u0000${condition}`
    const existing = folded.get(key)
    folded.set(key, { cardId, finish, condition, quantity: (existing?.quantity ?? 0) + quantity })
  })
  const rows = [...folded.values()].sort((a, b) => `${a.cardId}|${a.finish}|${a.condition}`.localeCompare(`${b.cardId}|${b.finish}|${b.condition}`))
  const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  return { rows, errors, fingerprint }
}

export function importFinishKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}
