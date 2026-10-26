import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type KnowledgeNote, type KnowledgeNoteStatus } from '../../lib/api'
import { useAccess } from '../../lib/access'
import { Button, Content, DataTable, EmptyState, Tabs } from '../../components/ui'
import { ConfirmAction, fmtDate } from './shared'

/**
 * Knowledge notes review (Phase 6): what agents proposed about how cards interact, approved or rejected here before
 * every account sees it in get_card and rules_lookup.
 *
 * Gated on knowledge.review alone, never admin.access: a contributor role can be given review, and a contributor
 * never holds admin.access. So this component does not use useAdminQuery (which requires admin.access), and it is
 * mounted twice: as an Administration tab for admins, and at /dev/knowledge for contributors.
 *
 * Every text field is the proposer's. React escapes it; the source link opens in a new tab with no referrer and is
 * shown in full, so the reviewer sees where it goes before following it.
 */
const STATUSES: { key: KnowledgeNoteStatus; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

function NoteBody({ note }: { note: KnowledgeNote }) {
  return <div className="min-w-0 space-y-[10px]">
    <p className="text-[13px] font-semibold text-text-secondary">{note.cards.join(' · ')}</p>
    <p className="whitespace-pre-wrap break-words text-text-body">{note.statement}</p>
    <blockquote className="border-l-[3px] border-border-default pl-[12px] text-[14px] italic text-text-muted break-words">“{note.quote}”</blockquote>
    <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="block break-all text-[13px] text-link">{note.sourceUrl}</a>
    {note.flags.length > 0 && <ul aria-label="Automatic checks" className="flex flex-wrap gap-[6px]">{note.flags.map(flag =>
      <li key={flag} className="rounded-full bg-warning/15 px-[10px] py-[3px] text-[12px] font-semibold text-warning">{flag}</li>)}</ul>}
    {note.reviewReason && <p className="text-[13px] text-text-muted">Review note: {note.reviewReason}</p>}
  </div>
}

export function KnowledgeReview() {
  const access = useAccess()
  const [status, setStatus] = useState<KnowledgeNoteStatus>('pending')
  const [before, setBefore] = useState<number | null>(null)
  const [deciding, setDeciding] = useState<{ note: KnowledgeNote; decision: 'approved' | 'rejected' } | null>(null)
  const allowed = access.ready && access.permissions.includes('knowledge.review')
  const params = new URLSearchParams({ status, limit: '50', ...(before ? { before: String(before) } : {}) }).toString()
  // The key starts with 'admin' so ConfirmAction's save refreshes it after a decision.
  const query = useQuery({ queryKey: ['admin', access.identity, access.revision, 'knowledge', params], queryFn: ({ signal }) => api.adminKnowledgeNotes(params, signal), enabled: allowed, retry: false, staleTime: 0 })
  if (!allowed) return <EmptyState icon="lock" title="Note review unavailable" body="Reviewing knowledge notes needs the knowledge.review permission." />
  return <section className="min-w-0 space-y-[20px]">
    <h2 className="font-display text-[24px] text-text-primary">Knowledge notes</h2>
    <p className="max-w-[760px] text-text-muted">Findings agents proposed about how cards interact. An approved note appears for every account in card details and rules answers, under the note’s source. Check the quote against the source before approving; reject anything wrong, unsourced or personal.</p>
    <Tabs variant="pill" size="sm" value={status} onChange={key => { setStatus(key as KnowledgeNoteStatus); setBefore(null) }} items={STATUSES} />
    <DataTable label="Knowledge notes" rows={query.data?.notes ?? []} getRowId={note => String(note.id)} getRowLabel={note => note.cards.join(', ')}
      loading={query.isPending} refreshing={query.isFetching && !query.isPending} error={query.error?.message} onRetry={() => void query.refetch()}
      empty={<EmptyState icon="lists" title={status === 'pending' ? 'Nothing waiting' : 'No notes here yet'} body={status === 'pending' ? 'New proposals appear here.' : 'Decided notes appear here.'} />}
      columns={[
        { id: 'note', header: 'Note', className: 'min-w-[320px] max-w-[640px]', cell: note => <NoteBody note={note} /> },
        { id: 'proposed', header: 'Proposed', className: 'min-w-[150px]', cell: note => <time dateTime={note.proposedAt}>{fmtDate(note.proposedAt)}</time> },
        status === 'pending'
          ? { id: 'decide', header: 'Decision', className: 'min-w-[200px]', cell: note => <div className="flex flex-wrap gap-[8px]">
              <Button size="sm" onClick={() => setDeciding({ note, decision: 'approved' })}>Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeciding({ note, decision: 'rejected' })}>Reject</Button>
            </div> }
          : { id: 'reviewed', header: 'Decided', className: 'min-w-[150px]', cell: note => note.reviewedAt ? <time dateTime={note.reviewedAt}>{fmtDate(note.reviewedAt)}</time> : '—' },
      ]} />
    {query.data?.next && <Button variant="ghost" onClick={() => setBefore(query.data?.next ?? null)}>Older notes</Button>}
    {before && <Button variant="ghost" onClick={() => setBefore(null)}>Back to newest</Button>}
    {deciding && <ConfirmAction
      title={deciding.decision === 'approved' ? 'Approve note' : 'Reject note'}
      description={deciding.decision === 'approved'
        ? `Every account will see this note about ${deciding.note.cards.join(', ')}. A decision is final and recorded in the audit log.`
        : 'The proposer will see it as rejected; nobody else ever sees it. Say why, briefly.'}
      reasonRequired={deciding.decision === 'rejected'}
      action={reason => api.adminReviewKnowledgeNote(deciding.note.id, { decision: deciding.decision, reason })}
      close={() => setDeciding(null)} />}
  </section>
}

/** /dev/knowledge: the same screen for a contributor, who has Dev tools but not Administration. */
export function DevKnowledgeReview() {
  return <Content><div className="pb-[40px]"><KnowledgeReview /></div></Content>
}
