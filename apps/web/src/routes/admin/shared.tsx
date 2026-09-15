import { useState, type ReactNode, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, FormAlert, Spinner } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { ApiError } from '../../lib/api'
import { useAccess } from '../../lib/access'

export const panelClass = 'rounded-[16px] border border-border-default bg-surface-secondary p-[20px]'
export const selectClass = 'w-full rounded-[10px] border border-border-default bg-surface-tertiary px-[12px] py-[12px] text-text-primary'
export const fmtDate = (date: string | null) => date ? new Date(date).toLocaleString() : 'Not recorded'
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className={panelClass}><h2 className="mb-[16px] font-display text-[22px] text-text-primary">{title}</h2>{children}</section>
}
export function useAdminQuery<T>(key: readonly unknown[], queryFn: (signal: AbortSignal) => Promise<T>, permission: string) {
  const access = useAccess()
  return useQuery({ queryKey: ['admin', access.identity, access.revision, ...key], queryFn: ({ signal }) => queryFn(signal),
    enabled: access.ready && access.permissions.includes('admin.access') && access.permissions.includes(permission),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false })
}
export function LoadState({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => unknown }) {
  if (loading) return <div role="status" className="py-[32px]"><Spinner /> Loading…</div>
  if (error) return <div><FormAlert kind="error">{error instanceof Error ? error.message : 'Could not load this section.'}</FormAlert><Button variant="ghost" onClick={() => void retry()}>Try again</Button></div>
  return null
}
export function Paging({ offset, total, limit = 25, setOffset }: { offset: number; total: number; limit?: number; setOffset: (n: number) => void }) {
  return <nav aria-label="Pagination" className="mt-[20px] flex flex-wrap items-center justify-between gap-[12px] text-[14px] text-text-muted">
    <span>{total ? offset + 1 : 0}–{Math.min(offset + limit, total)} of {total}</span>
    <div className="flex gap-[8px]"><Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button><Button variant="ghost" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button></div>
  </nav>
}
export function useAdminSave() {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const save = async (action: () => Promise<unknown>, done?: () => void) => {
    setBusy(true); setError(''); setSuccess('')
    try { await action(); await client.invalidateQueries({ queryKey: ['admin'] }); setSuccess('Saved.'); done?.() }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? 'This record changed while you were editing. Close this form and reload the latest version before trying again.' : e instanceof Error ? e.message : 'Could not save. Please try again.') }
    finally { setBusy(false) }
  }
  return { busy, error, success, save }
}
export function ConfirmAction({ title, description, action, close, reasonRequired = true }: {
  title: string; description: string; action: (reason: string) => Promise<unknown>; close: () => void; reasonRequired?: boolean
}) {
  const [reason, setReason] = useState('')
  const state = useAdminSave()
  const submit = (e: FormEvent) => { e.preventDefault(); void state.save(() => action(reason.trim()), close) }
  return <Sheet title={title} onClose={() => { if (state.busy) return false; close() }}><form onSubmit={submit} className="space-y-[16px]">
    <p className="text-text-body">{description}</p>
    {reasonRequired && <Field label="Reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} hint="Recorded in the administrative audit log." />}
    {state.error && <FormAlert kind="error">{state.error}</FormAlert>}
    <div className="flex flex-wrap gap-[12px]"><Button type="submit" loading={state.busy}>{title}</Button><Button variant="ghost" disabled={state.busy} onClick={close}>Cancel</Button></div>
  </form></Sheet>
}
