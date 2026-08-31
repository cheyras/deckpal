import Anthropic from '@anthropic-ai/sdk'
import type { Config, Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

import { CatalogLookupError, resolveRecognition } from './_shared/card-catalog.mts'
import {
  CARD_RECOGNITION_PROMPT,
  CardVisionError,
  estimatedCostMicrousd,
  FAMILY_AI_MODEL,
  MAX_AI_IMAGE_BYTES,
  parseCardRecognition,
  validateAiImage,
} from './_shared/card-vision.mts'
import { FamilyAuthError, requireActiveFamilyIdentity } from './_shared/family-auth.mts'

declare const Netlify: { env: { get(name: string): string | undefined } }

interface Reservation {
  reservation_id: string
  remaining: number
}

function env(name: string): string | undefined {
  return Netlify.env.get(name) ?? process.env[name]
}

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof FamilyAuthError || error instanceof CardVisionError || error instanceof CatalogLookupError) {
    return json(error.status, { error: { code: error.code, message: error.code } })
  }
  const message = error instanceof Error ? error.message : ''
  if (message.includes('quota_exhausted')) return json(429, { error: { code: 'quota_exhausted', message: 'Daily AI scan limit reached.' } })
  if (message.includes('family_ai_disabled')) return json(403, { error: { code: 'family_ai_disabled', message: 'AI scanning is disabled by the family admin.' } })
  if (message.includes('inactive_family_member')) return json(403, { error: { code: 'active_family_required', message: 'An active family account is required.' } })
  return json(500, { error: { code: 'ai_scan_failed', message: 'The AI scan could not be completed.' } })
}

export default async function scanAi(request: Request, _context: Context): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: { code: 'method_not_allowed' } })

  const supabaseUrl = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL')
  const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY')
  const gatewayUrl = env('ANTHROPIC_BASE_URL')
  if (!supabaseUrl || !serviceRole || !gatewayUrl) {
    return json(503, { error: { code: 'ai_gateway_not_configured', message: 'AI scanning is not configured.' } })
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let reservationId: string | null = null

  try {
    const identity = await requireActiveFamilyIdentity(request, supabase)
    const requestId = request.headers.get('x-request-id')?.match(/^[0-9a-f-]{36}$/i)?.[0] ?? crypto.randomUUID()
    const { data: reserved, error: reserveError } = await supabase.rpc('reserve_ai_scan', {
      p_family_id: identity.familyId,
      p_user_id: identity.user.id,
      p_request_id: requestId,
    })
    if (reserveError) throw reserveError
    const reservation = (reserved as Reservation[] | null)?.[0]
    if (!reservation) throw new Error('reservation_failed')
    reservationId = reservation.reservation_id

    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_AI_IMAGE_BYTES) throw new CardVisionError(413, 'image_too_large')
    const mediaType = request.headers.get('content-type') ?? ''
    const image = new Uint8Array(await request.arrayBuffer())
    validateAiImage(mediaType, image.byteLength)

    const anthropic = new Anthropic({ baseURL: gatewayUrl })
    const message = await anthropic.messages.create({
      model: FAMILY_AI_MODEL,
      max_tokens: 220,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType.split(';', 1)[0] as 'image/jpeg' | 'image/png' | 'image/webp',
              data: Buffer.from(image).toString('base64'),
            },
          },
          { type: 'text', text: CARD_RECOGNITION_PROMPT },
        ],
      }],
    })
    const text = message.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') throw new CardVisionError(502, 'invalid_model_response')
    const recognition = parseCardRecognition(text.text)
    const matches = await resolveRecognition(supabase, recognition)
    const inputTokens = message.usage.input_tokens
    const outputTokens = message.usage.output_tokens
    const cost = estimatedCostMicrousd(inputTokens, outputTokens)
    const matched = recognition.confidence >= 0.55 && matches.length > 0

    const summary = {
      recognition,
      matchedCardIds: matches.map((match) => match.cardId),
    }
    const { error: finishError } = await supabase.rpc('finish_ai_scan', {
      p_reservation_id: reservationId,
      p_model: FAMILY_AI_MODEL,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_estimated_cost_microusd: cost,
      p_candidate_summary: summary,
    })
    if (finishError) throw finishError
    reservationId = null

    return json(200, {
      query: { algo: 'claude-vision', hash: '' },
      matched,
      threshold: 29,
      indexSize: matches.length,
      matches,
      recognition,
      quota: { remaining: reservation.remaining },
      privacy: { imageStored: false },
    })
  } catch (error) {
    if (reservationId) {
      await supabase.rpc('fail_ai_scan', {
        p_reservation_id: reservationId,
        p_failure_code: error instanceof Error ? error.message.slice(0, 80) : 'unknown_failure',
      })
    }
    return errorResponse(error)
  }
}

export const config: Config = {
  path: '/api/scan/ai',
  method: 'POST',
}
