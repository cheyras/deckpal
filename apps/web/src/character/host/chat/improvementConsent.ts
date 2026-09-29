import type { DeckeImprovementConsentRequest } from '../../../lib/api'

export function improvementConsentRequest(
  conversationId: string,
  share: boolean,
  shareAll = false,
): DeckeImprovementConsentRequest {
  return {
    conversationId,
    share,
    ...(share && shareAll ? { shareAll: true as const } : {}),
    source: 'decke_ask',
  }
}

/** Keeps the card callback, transport body, and Profile cache refresh on one tested path. */
export async function submitImprovementConsent({
  conversationId,
  share,
  shareAll = false,
  send,
  refreshSettings,
}: {
  conversationId: string
  share: boolean
  shareAll?: boolean
  send: (request: DeckeImprovementConsentRequest) => Promise<unknown>
  refreshSettings: () => Promise<unknown>
}): Promise<void> {
  const request = improvementConsentRequest(conversationId, share, shareAll)
  await send(request)
  if (request.shareAll) await refreshSettings()
}
