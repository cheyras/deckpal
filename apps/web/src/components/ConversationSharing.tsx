import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { useAccess, invalidateAccess } from '../lib/access'
import { Button, FormAlert } from './ui'
export function ConversationSharing() {
  const access = useAccess(), client = useQueryClient(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const query = useQuery({ queryKey: ['decke-sharing', access.identity], queryFn: ({ signal }) => api.deckeSharing(signal), enabled: access.ready && !!access.identity, retry: false, gcTime: 0, refetchOnWindowFocus: true })
  const change = async () => {
    if (!query.data) return
    setBusy(true); setError('')
    await client.cancelQueries({ queryKey: ['admin'] }); client.removeQueries({ queryKey: ['admin'] })
    try { await api.setDeckeSharing(!query.data.enabled, query.data.revision); await query.refetch(); invalidateAccess() }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? 'Sharing preference changed. Reload the current preference before trying again.' : e instanceof Error ? e.message : 'Could not save your sharing preference.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-[12px] rounded-2xl bg-surface-secondary p-[20px]"><h2 className="font-display text-[22px] text-text-primary">Conversation sharing</h2><p className="text-text-body">Allow my conversations to improve Deck-E</p><p className="text-[14px] text-text-muted">Off by default. When enabled, your new messages and Deck-E replies can be read by administrators to improve the product. Turning this off withdraws access to previously shared content; it cannot recall text already seen or copied. Usage and cost metadata remain available. Turning it on again does not restore older shared conversations.</p>{query.isPending && <p role="status">Loading sharing preference…</p>}{(error || query.error) && <FormAlert kind="error">{error || query.error?.message}</FormAlert>}{query.data && <Button variant="ghost" aria-pressed={query.data.enabled} disabled={busy || query.isFetching} onClick={() => void change()}>{query.data.enabled ? 'Turn off conversation sharing' : 'Turn on conversation sharing'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => void query.refetch()}>Reload sharing preference</Button></section>
}
