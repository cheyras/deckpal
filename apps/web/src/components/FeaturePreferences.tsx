import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { useAccess, invalidateAccess } from '../lib/access'
import { Button, DataTable, FormAlert } from './ui'
import type { FeatureAccess } from '../lib/adminTypes'
const explanations: Record<string, string> = { released: 'Available to all active accounts.', opted_in: 'You opted in.', automatic: 'Included automatically for your role.', opt_in_required: 'Choose whether to try this feature.', experimental_tier_required: 'Experimental opt-in requires Superuser or a higher role.', disabled: 'Unavailable while the team has this feature disabled.', account_unavailable: 'Unavailable while your account is inactive or access is not ready.' }
export function FeaturePreferences() {
  const access = useAccess(), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const query = useQuery({ queryKey: ['features', access.identity, access.revision], queryFn: ({ signal }) => api.meFeatures(signal), enabled: access.ready && !!access.identity, retry: false, gcTime: 0 })
  const save = async (feature: FeatureAccess) => {
    setBusy(feature.key); setError('')
    try { await api.setMeFeature(feature.key, !feature.optedIn, feature.revision); invalidateAccess(); await query.refetch() }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? 'Feature settings changed. Reload the latest settings before trying again.' : e instanceof Error ? e.message : 'Could not save feature preference.') }
    finally { setBusy('') }
  }
  return <section className="min-w-0 space-y-[16px] rounded-2xl bg-surface-secondary p-[20px]"><h2 className="font-display text-[22px] text-text-primary">Feature preferences</h2><p className="text-[14px] text-text-muted">Beta and experimental features may be incomplete or unreliable. Your opt-in is separate from Deck-E visibility and conversation sharing. Superusers can opt in to every experiment; Superadmins and Owners receive experiments automatically. Disabled features are unavailable for everyone.</p>{error && <FormAlert kind="error">{error}</FormAlert>}<DataTable label="Product features" rows={query.data?.features ?? []} getRowId={f => f.key} loading={query.isPending} refreshing={query.isFetching && !query.isPending} error={query.error?.message} onRetry={() => void query.refetch()} columns={[
    { id: 'feature', header: 'Feature', cell: f => <strong>{f.label}</strong> },
    { id: 'stage', header: 'Release stage', cell: f => f.lifecycle },
    { id: 'access', header: 'Access', className: 'min-w-[240px]', cell: f => <><p>{f.enabled ? 'Enabled' : 'Not enabled'}</p><p className="mt-[4px] text-text-muted">{explanations[f.reason] ?? 'Access is determined by your current role and preference.'}</p></> },
    { id: 'preference', header: 'Your preference', className: 'min-w-[180px]', cell: f => f.eligible && !['released', 'disabled'].includes(f.lifecycle) && f.reason !== 'automatic' ? <Button variant="ghost" size="sm" disabled={!!busy} aria-label={`${f.optedIn ? 'Opt out of' : 'Opt in to'} ${f.label}`} onClick={() => void save(f)}>{f.optedIn ? 'Opt out' : 'Opt in'}</Button> : <span className="text-text-muted">{f.reason === 'automatic' ? 'Automatic for your role' : 'No preference available'}</span> },
  ]} /></section>
}
