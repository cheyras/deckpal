import { Router } from 'express'

import { q, q1 } from '../db.js'
import { requireActiveFamily, requireFamilyAdmin } from '../family/access.js'
import { ApiError, asyncHandler, notFound, UUID_RE, userCache } from '../http.js'
import { currentUserId } from '../identity.js'

export const FAMILY_AI_MODEL = 'claude-haiku-4-5-20251001'
export const familyAiRouter: Router = Router()

export function nextMalaysiaMidnight(now = new Date()): string {
  const malaysia = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const nextLocalMidnightAsUtc = Date.UTC(
    malaysia.getUTCFullYear(),
    malaysia.getUTCMonth(),
    malaysia.getUTCDate() + 1,
  )
  return new Date(nextLocalMidnightAsUtc - 8 * 60 * 60 * 1000).toISOString()
}

function boundedInteger(value: unknown, min: number, max: number, field: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ApiError(400, 'bad_request', `${field} must be an integer from ${min} to ${max}`)
  }
  return number
}

interface QuotaRow {
  enabled: boolean
  quota_limit: number
  bonus_remaining: number
  used: number
  reserved: number
}

familyAiRouter.get(
  '/ai/quota',
  asyncHandler(async (req, res) => {
    userCache(res)
    const userId = currentUserId(req)
    const family = await requireActiveFamily(userId)
    const row = await q1<QuotaRow>(
      `SELECT COALESCE(fas.enabled, TRUE) AS enabled,
              COALESCE(mal.daily_limit, fas.default_daily_limit, 5)::INTEGER AS quota_limit,
              COALESCE(mal.bonus_remaining, 0)::INTEGER AS bonus_remaining,
              count(ase.id) FILTER (WHERE ase.status = 'succeeded')::INTEGER AS used,
              count(ase.id) FILTER (
                WHERE ase.status = 'reserved' AND ase.created_at > now() - interval '5 minutes'
              )::INTEGER AS reserved
         FROM (SELECT $1::uuid AS family_id, $2::uuid AS user_id) seed
         LEFT JOIN family_ai_setting fas ON fas.family_id = seed.family_id
         LEFT JOIN member_ai_limit mal
           ON mal.family_id = seed.family_id AND mal.user_id = seed.user_id
         LEFT JOIN ai_scan_event ase
           ON ase.family_id = seed.family_id AND ase.user_id = seed.user_id
          AND ase.usage_day = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
        GROUP BY fas.enabled, mal.daily_limit, fas.default_daily_limit, mal.bonus_remaining`,
      [family.familyId, userId],
    )
    const quota = row ?? { enabled: true, quota_limit: 5, bonus_remaining: 0, used: 0, reserved: 0 }
    const consumed = quota.used + quota.reserved
    res.json({
      enabled: quota.enabled,
      model: FAMILY_AI_MODEL,
      limit: quota.quota_limit,
      used: quota.used,
      reserved: quota.reserved,
      bonusRemaining: quota.bonus_remaining,
      remaining: quota.enabled
        ? Math.max(quota.quota_limit - consumed, 0) + quota.bonus_remaining
        : 0,
      resetsAt: nextMalaysiaMidnight(),
    })
  }),
)

familyAiRouter.get(
  '/ai/usage',
  asyncHandler(async (req, res) => {
    userCache(res)
    const admin = await requireFamilyAdmin(currentUserId(req))
    const rows = await q<{
      user_id: string
      username: string
      usage_day: string
      succeeded: number
      failed: number
      input_tokens: number
      output_tokens: number
      estimated_cost_microusd: string
    }>(
      `SELECT ase.user_id, au.username, ase.usage_day,
              count(*) FILTER (WHERE ase.status = 'succeeded')::INTEGER AS succeeded,
              count(*) FILTER (WHERE ase.status = 'failed')::INTEGER AS failed,
              COALESCE(sum(ase.input_tokens) FILTER (WHERE ase.status = 'succeeded'), 0)::INTEGER AS input_tokens,
              COALESCE(sum(ase.output_tokens) FILTER (WHERE ase.status = 'succeeded'), 0)::INTEGER AS output_tokens,
              COALESCE(sum(ase.estimated_cost_microusd) FILTER (WHERE ase.status = 'succeeded'), 0)::TEXT AS estimated_cost_microusd
         FROM ai_scan_event ase JOIN app_user au ON au.id = ase.user_id
        WHERE ase.family_id = $1 AND ase.usage_day >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - 31
        GROUP BY ase.user_id, au.username, ase.usage_day
        ORDER BY ase.usage_day DESC, lower(au.username)`,
      [admin.familyId],
    )
    const settings = await q1<{ enabled: boolean; default_daily_limit: number; warning_percent: number }>(
      `SELECT enabled, default_daily_limit, warning_percent
         FROM family_ai_setting WHERE family_id = $1`,
      [admin.familyId],
    )
    const memberLimits = await q<{ user_id: string; daily_limit: number | null; bonus_remaining: number }>(
      `SELECT user_id, daily_limit, bonus_remaining
         FROM member_ai_limit WHERE family_id = $1 ORDER BY user_id`,
      [admin.familyId],
    )
    res.json({
      settings: {
        enabled: settings?.enabled ?? true,
        defaultDailyLimit: settings?.default_daily_limit ?? 5,
        warningPercent: settings?.warning_percent ?? 80,
      },
      memberLimits: memberLimits.map((item) => ({
        userId: item.user_id,
        dailyLimit: item.daily_limit,
        bonusRemaining: item.bonus_remaining,
      })),
      rows,
    })
  }),
)

familyAiRouter.patch(
  '/ai/settings',
  asyncHandler(async (req, res) => {
    const admin = await requireFamilyAdmin(currentUserId(req))
    const current = await q1<{ enabled: boolean; default_daily_limit: number; warning_percent: number }>(
      `SELECT enabled, default_daily_limit, warning_percent FROM family_ai_setting WHERE family_id = $1`,
      [admin.familyId],
    )
    const enabled = req.body?.enabled === undefined ? (current?.enabled ?? true) : req.body.enabled === true
    const daily = req.body?.defaultDailyLimit === undefined
      ? (current?.default_daily_limit ?? 5)
      : boundedInteger(req.body.defaultDailyLimit, 0, 100, 'defaultDailyLimit')
    const warning = req.body?.warningPercent === undefined
      ? (current?.warning_percent ?? 80)
      : boundedInteger(req.body.warningPercent, 1, 100, 'warningPercent')
    const updated = await q1<{ enabled: boolean; default_daily_limit: number; warning_percent: number }>(
      `INSERT INTO family_ai_setting (family_id, enabled, default_daily_limit, warning_percent, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (family_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         default_daily_limit = EXCLUDED.default_daily_limit,
         warning_percent = EXCLUDED.warning_percent,
         updated_at = now()
       RETURNING enabled, default_daily_limit, warning_percent`,
      [admin.familyId, enabled, daily, warning],
    )
    res.json({
      settings: {
        enabled: updated?.enabled ?? enabled,
        defaultDailyLimit: updated?.default_daily_limit ?? daily,
        warningPercent: updated?.warning_percent ?? warning,
      },
    })
  }),
)

familyAiRouter.patch(
  '/members/:userId/ai-limit',
  asyncHandler(async (req, res) => {
    const admin = await requireFamilyAdmin(currentUserId(req))
    const rawUserId = req.params.userId
    const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId
    if (!userId || !UUID_RE.test(userId)) throw notFound('Family member not found')
    const member = await q1<{ user_id: string }>(
      `SELECT user_id FROM family_member WHERE family_id = $1 AND user_id = $2`,
      [admin.familyId, userId],
    )
    if (!member) throw notFound('Family member not found')

    const dailyLimit = req.body?.dailyLimit === null || req.body?.dailyLimit === undefined
      ? null
      : boundedInteger(req.body.dailyLimit, 0, 100, 'dailyLimit')
    const bonus = req.body?.bonusRemaining === undefined
      ? 0
      : boundedInteger(req.body.bonusRemaining, 0, 1000, 'bonusRemaining')
    const updated = await q1<{ daily_limit: number | null; bonus_remaining: number }>(
      `INSERT INTO member_ai_limit (family_id, user_id, daily_limit, bonus_remaining)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (family_id, user_id) DO UPDATE SET
         daily_limit = EXCLUDED.daily_limit,
         bonus_remaining = EXCLUDED.bonus_remaining
       RETURNING daily_limit, bonus_remaining`,
      [admin.familyId, userId, dailyLimit, bonus],
    )
    res.json({ member: { userId, dailyLimit: updated?.daily_limit ?? null, bonusRemaining: updated?.bonus_remaining ?? bonus } })
  }),
)

export function familyAiGateStatus(): { configured: boolean; model: string } {
  return { configured: !!process.env.ANTHROPIC_BASE_URL, model: FAMILY_AI_MODEL }
}
