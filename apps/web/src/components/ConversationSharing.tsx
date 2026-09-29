import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAccess } from '../lib/access'
import { FormAlert } from './ui'
export function ConversationSharing() {
  const access = useAccess(), client = useQueryClient(), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const query = useQuery({ queryKey: ['settings', access.identity], queryFn: ({ signal }) => api.settings(signal), enabled: access.ready && !!access.identity, retry: false, gcTime: 0, refetchOnWindowFocus: true })
  const enabled = query.data?.settings?.deckeSharePrompts ?? true
  const change = async (next: boolean) => {
    setSaving(true); setError('')
    try {
      await api.updateSettings({ deckeSharePrompts: next })
      await client.invalidateQueries({ queryKey: ['settings', access.identity] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your Deck-E preference.')
    } finally { setSaving(false) }
  }
  return <section className="space-y-[12px] rounded-2xl bg-surface-secondary p-[20px]"><h2 className="font-display text-[22px] text-text-primary">Deck-E chat sharing</h2><label className="flex min-h-[44px] items-center justify-between gap-[16px] text-text-body"><span>Let Deck-E ask to share chats</span><input type="checkbox" role="switch" aria-label="Let Deck-E ask to share chats" checked={enabled} disabled={!query.data || saving} onChange={event => void change(event.target.checked)} /></label><p className="text-[14px] text-text-muted">Now and then, when something goes wrong, Deck-E may ask to save a chat so the team can see it. Nothing is shared unless you say yes.</p><p className="text-[14px] text-text-muted"><a href="/privacy#deck-e" className="text-link">Learn how Deck-E chat sharing works</a>.</p><p className="text-[14px] text-text-muted">Chats you’ve shared can be managed in Deck-E’s History.</p>{query.isPending && <p role="status">Loading Deck-E preference…</p>}{(error || query.error) && <FormAlert kind="error">{error || query.error?.message}</FormAlert>}</section>
}
