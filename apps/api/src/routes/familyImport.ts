import { Router } from 'express'

import { q } from '../db.js'
import { requireFamilyAdmin } from '../family/access.js'
import { importFinishKey, parseFamilyCollectionImport } from '../family/import.js'
import { asyncHandler, badRequest } from '../http.js'
import { currentUserId } from '../identity.js'

export const familyImportRouter: Router = Router()

interface VariantRow {
  card_id: string
  variant_id: string
  is_primary: boolean
  kind_code: string
  display_name: string
  finish: string
  foil: string | null
}

familyImportRouter.post('/import/preview', asyncHandler(async (req, res) => {
  await requireFamilyAdmin(currentUserId(req))
  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  if (text.length > 2_000_000) throw badRequest('Collection import is too large')
  const parsed = parseFamilyCollectionImport(text)
  if (parsed.errors.length > 0 || parsed.rows.length === 0) {
    res.json({ ...parsed, matched: [], ambiguous: [], unresolved: [] })
    return
  }
  const ids = [...new Set(parsed.rows.map((row) => row.cardId))]
  const variants = await q<VariantRow>(
    `SELECT c.tcgdex_id AS card_id, cv.id AS variant_id, cv.is_primary,
            vk.code AS kind_code, vk.display_name, vk.finish, vk.foil
       FROM card c JOIN card_variant cv ON cv.card_id = c.id
       JOIN variant_kind vk ON vk.code = cv.variant_kind_code
      WHERE c.tcgdex_id = ANY($1::text[])
      ORDER BY c.tcgdex_id, cv.sort_order`,
    [ids],
  )
  const byCard = new Map<string, VariantRow[]>()
  for (const variant of variants) byCard.set(variant.card_id, [...(byCard.get(variant.card_id) ?? []), variant])
  const matched: unknown[] = []
  const ambiguous: unknown[] = []
  const unresolved: unknown[] = []
  for (const row of parsed.rows) {
    const available = byCard.get(row.cardId) ?? []
    const wanted = importFinishKey(row.finish)
    let candidates = wanted === 'primary'
      ? available.filter((variant) => variant.is_primary)
      : available.filter((variant) => [variant.kind_code, variant.display_name, variant.finish, variant.foil ?? ''].some((value) => importFinishKey(value) === wanted))
    if (candidates.length > 1) {
      const exact = candidates.filter((variant) => importFinishKey(variant.kind_code) === wanted || importFinishKey(variant.display_name) === wanted)
      if (exact.length === 1) candidates = exact
    }
    if (candidates.length === 1) matched.push({ ...row, variantId: Number(candidates[0]!.variant_id), variantName: candidates[0]!.display_name })
    else if (candidates.length > 1) ambiguous.push({ ...row, candidates: candidates.map((variant) => ({ variantId: Number(variant.variant_id), variantName: variant.display_name })) })
    else unresolved.push({ ...row, reason: available.length ? 'finish_not_found' : 'card_not_found' })
  }
  res.json({ fingerprint: parsed.fingerprint, errors: [], matched, ambiguous, unresolved })
}))
