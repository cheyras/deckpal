import { Router } from 'express'
import { z } from 'zod'

import { q, q1 } from '../db.js'
import { requireActiveFamily, requireFamilyAdmin } from '../family/access.js'
import { ApiError, asyncHandler, badRequest, notFound, UUID_RE } from '../http.js'
import { currentUserId } from '../identity.js'

export const familyPricesRouter: Router = Router()

const conditions = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
const statuses = ['pending', 'approved', 'rejected', 'superseded'] as const
const webUrl = z.url().max(1000).refine(
  (value) => /^https?:\/\//i.test(value),
  { message: 'sourceUrl must use http or https' },
)

export const familyPriceInputSchema = z.object({
  cardVariantId: z.coerce.number().int().positive(),
  amountMinor: z.coerce.number().int().positive(),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  sourceName: z.string().trim().min(1).max(80),
  sourceUrl: z.union([webUrl, z.literal(''), z.null()]).optional(),
  condition: z.enum(conditions),
  observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(1000).nullable().optional(),
})

const decisionSchema = z.object({ note: z.string().trim().max(500).nullable().optional() })

function malaysiaDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'Invalid price data')
  return result.data
}

interface PriceRow {
  id: string
  family_id: string
  card_variant_id: string
  proposed_by: string
  amount_minor: number
  currency_code: string
  source_name: string
  source_url: string | null
  condition: string
  observed_on: string
  notes: string | null
  status: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
  card_id: string
  card_name: string
  card_number: string
  set_name: string
  variant_name: string | null
  proposer_name: string
}

const priceSelect = `SELECT fps.*, c.tcgdex_id AS card_id, c.name AS card_name,
  c.local_id AS card_number, cs.name AS set_name, cv.display_name AS variant_name,
  au.username AS proposer_name
  FROM family_price_suggestion fps
  JOIN card_variant cv ON cv.id = fps.card_variant_id
  JOIN card c ON c.id = cv.card_id
  JOIN card_set cs ON cs.id = c.set_id
  JOIN app_user au ON au.id = fps.proposed_by`

function present(row: PriceRow) {
  return {
    id: row.id,
    cardVariantId: String(row.card_variant_id),
    cardId: row.card_id,
    cardName: row.card_name,
    cardNumber: row.card_number,
    setName: row.set_name,
    variantName: row.variant_name,
    proposedBy: row.proposed_by,
    proposerName: row.proposer_name,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code.trim(),
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    condition: row.condition,
    observedOn: row.observed_on,
    notes: row.notes,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  }
}

familyPricesRouter.post('/prices/suggestions', asyncHandler(async (req, res) => {
  const userId = currentUserId(req)
  const family = await requireActiveFamily(userId)
  const input = parse(familyPriceInputSchema, req.body)
  if (input.observedOn > malaysiaDate()) throw badRequest('observedOn cannot be in the future')

  const variant = await q1<{ id: string }>('SELECT id FROM card_variant WHERE id = $1', [input.cardVariantId])
  if (!variant) throw notFound('Card printing not found')
  const currency = await q1<{ code: string }>('SELECT code FROM currency WHERE code = $1', [input.currencyCode])
  if (!currency) throw badRequest('Unsupported currency')

  const inserted = await q1<{ id: string }>(
    `INSERT INTO family_price_suggestion
      (family_id, card_variant_id, proposed_by, amount_minor, currency_code,
       source_name, source_url, condition, observed_on, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [family.familyId, input.cardVariantId, userId, input.amountMinor, input.currencyCode,
      input.sourceName, input.sourceUrl || null, input.condition, input.observedOn, input.notes || null],
  )
  const row = inserted ? await q1<PriceRow>(`${priceSelect} WHERE fps.id = $1`, [inserted.id]) : null
  if (!row) throw new ApiError(500, 'price_create_failed', 'Price suggestion could not be loaded')
  res.status(201).json({ suggestion: present(row) })
}))

familyPricesRouter.get('/prices/suggestions', asyncHandler(async (req, res) => {
  const userId = currentUserId(req)
  const family = await requireActiveFamily(userId)
  const raw = typeof req.query.status === 'string' ? req.query.status : 'pending'
  if (!statuses.includes(raw as (typeof statuses)[number])) throw badRequest('Unknown price status')
  const rows = await q<PriceRow>(
    `${priceSelect} WHERE fps.family_id = $1 AND fps.status = $2 ORDER BY fps.created_at DESC LIMIT 250`,
    [family.familyId, raw],
  )
  res.json({ suggestions: rows.map(present) })
}))

for (const decision of ['approve', 'reject'] as const) {
  familyPricesRouter.post(`/prices/suggestions/:id/${decision}`, asyncHandler(async (req, res) => {
    const userId = currentUserId(req)
    const admin = await requireFamilyAdmin(userId)
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (!rawId || !UUID_RE.test(rawId)) throw notFound('Price suggestion not found')
    const body = parse(decisionSchema, req.body ?? {})
    const target = await q1<{ status: string; family_id: string }>(
      'SELECT status, family_id FROM family_price_suggestion WHERE id = $1', [rawId],
    )
    if (!target || target.family_id !== admin.familyId) throw notFound('Price suggestion not found')
    if (target.status !== 'pending') throw new ApiError(409, 'already_decided', 'This suggestion was already decided')
    await q1(`SELECT (moderate_family_price($1,$2,$3,$4)).id`, [rawId, userId, decision === 'approve' ? 'approved' : 'rejected', body.note ?? null])
    const row = await q1<PriceRow>(`${priceSelect} WHERE fps.id = $1`, [rawId])
    if (!row) throw notFound('Price suggestion not found')
    res.json({ suggestion: present(row) })
  }))
}

familyPricesRouter.get('/cards/:cardId/manual-prices', asyncHandler(async (req, res) => {
  const userId = currentUserId(req)
  const family = await requireActiveFamily(userId)
  const rawCardId = Array.isArray(req.params.cardId) ? req.params.cardId[0] : req.params.cardId
  if (!rawCardId) throw notFound('Card not found')
  const rows = await q<PriceRow>(
    `${priceSelect} WHERE fps.family_id = $1 AND c.tcgdex_id = $2 AND fps.status = 'approved'
      ORDER BY fps.observed_on DESC, fps.created_at DESC`,
    [family.familyId, rawCardId],
  )
  res.json({ prices: rows.map(present) })
}))
