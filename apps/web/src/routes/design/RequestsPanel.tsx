/**
 * RequestsPanel — polls GET /__design/requests every 3s while mounted.
 *
 * Each row shows kind, target, intent excerpt, status chip (queued/working/
 * done/failed), and for done requests: the agent's summary, filesChanged
 * list, and a "hot-reloaded" hint. No approve/reject UI in-app — per the
 * plan, git is the review surface.
 */
import { useState, useEffect, useRef } from 'react'
import { designApi, type ChangeRequest } from './designApi'

const POLL_INTERVAL_MS = 3_000

interface DoneResult {
  id: string
  status: 'done' | 'failed'
  summary?: string
  filesChanged?: string[]
  startedAt?: string
  finishedAt?: string
  agent?: string
  error?: string
}

type RequestWithResult = ChangeRequest & { result?: DoneResult }

export function RequestsPanel({ editable }: { editable: boolean }) {
  const [requests, setRequests] = useState<RequestWithResult[]>([])
  const [agentAlive, setAgentAlive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = async () => {
    try {
      const data = await designApi.requests()
      setRequests(data.requests as RequestWithResult[])
      setAgentAlive(data.agentAlive)
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to fetch requests')
    }
  }

  useEffect(() => {
    if (!editable) return
    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  // The request queue lives on the dev server's filesystem; without it there
  // is nothing to poll and nothing to submit.
  if (!editable) {
    return (
      <div className="rounded-lg border border-dashed border-border-default bg-surface-secondary px-4 py-6 text-center">
        <p className="text-[13px] text-text-muted">Change requests need the local dev server.</p>
        <p className="text-[11px] text-text-muted mt-1">
          This is the read-only view — run <span className="font-mono">pnpm dev</span> in the
          worktree to queue changes for an agent.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold text-text-primary">Change Requests</h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              agentAlive
                ? 'bg-success/15 text-success'
                : 'bg-surface-quaternary text-text-muted'
            }`}
          >
            <span
              className={`inline-block h-[6px] w-[6px] rounded-full ${
                agentAlive ? 'bg-success' : 'bg-text-muted'
              }`}
            />
            {agentAlive ? 'Agent online' : 'Agent offline'}
          </span>
          <span className="text-[10px] text-text-muted">
            Polls every {POLL_INTERVAL_MS / 1000}s
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-halo-error px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      {/* Empty state */}
      {requests.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border-default bg-surface-secondary px-4 py-6 text-center">
          <p className="text-[13px] text-text-muted">No change requests yet.</p>
          <p className="text-[11px] text-text-muted mt-1">
            Use the "Send to agent" composer on any gallery entry to create one.
          </p>
        </div>
      )}

      {/* Request list */}
      {requests.map((req) => (
        <RequestRow key={req.id} request={req} />
      ))}
    </div>
  )
}

// ── Status chip ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-surface-quaternary text-text-muted',
  working: 'bg-action-primary/15 text-action-primary',
  done: 'bg-success/15 text-success',
  failed: 'bg-halo-error text-error',
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-px text-[10px] font-medium ${
        STATUS_STYLES[status] || STATUS_STYLES.queued
      }`}
    >
      {status}
    </span>
  )
}

// ── Request row ──────────────────────────────────────────────────────────

function RequestRow({ request }: { request: RequestWithResult }) {
  const [expanded, setExpanded] = useState(false)
  const result = request.result as DoneResult | undefined

  return (
    <div className="rounded-lg bg-surface-secondary overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-tertiary/30"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-surface-quaternary px-1.5 py-px text-[10px] font-mono text-text-muted">
              {request.kind}
            </span>
            <span className="text-[12px] font-medium text-text-primary truncate">
              {request.target}
            </span>
            <StatusChip status={request.status} />
          </div>
          <p className="text-[11px] text-text-muted mt-1 line-clamp-2">
            {request.intent}
          </p>
        </div>
        <span className="text-[10px] text-text-muted whitespace-nowrap flex-shrink-0 mt-0.5">
          {formatTime(request.createdAt)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border-default px-4 py-2.5 space-y-2">
          {/* Full intent */}
          <div>
            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1">
              Intent
            </div>
            <p className="text-[12px] text-text-primary whitespace-pre-wrap">
              {request.intent}
            </p>
          </div>

          {/* Context (if present) */}
          {request.context && Object.keys(request.context).length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1">
                Context
              </div>
              <pre className="text-[10px] text-text-muted font-mono bg-surface-primary rounded px-2 py-1.5 overflow-x-auto">
                {JSON.stringify(request.context, null, 2)}
              </pre>
            </div>
          )}

          {/* Done: show agent result */}
          {request.status === 'done' && result && (
            <div className="space-y-1.5">
              {result.summary && (
                <div>
                  <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1">
                    Agent summary
                  </div>
                  <p className="text-[12px] text-text-primary whitespace-pre-wrap">
                    {result.summary}
                  </p>
                </div>
              )}
              {result.filesChanged && result.filesChanged.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1">
                    Files changed
                  </div>
                  <ul className="space-y-0.5">
                    {result.filesChanged.map((f) => (
                      <li key={f} className="text-[11px] font-mono text-link">
                        {f}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-success mt-1">
                    Changes hot-reloaded into the catalog. Review via git diff.
                  </p>
                </div>
              )}
              {result.agent && (
                <p className="text-[10px] text-text-muted">
                  Processed by: {result.agent}
                </p>
              )}
              {result.finishedAt && (
                <p className="text-[10px] text-text-muted">
                  Completed: {formatTime(result.finishedAt)}
                </p>
              )}
            </div>
          )}

          {/* Failed: show error */}
          {request.status === 'failed' && result && (
            <div>
              <div className="text-[10px] font-medium text-error uppercase tracking-wide mb-1">
                Failure reason
              </div>
              <p className="text-[12px] text-error whitespace-pre-wrap">
                {result.error || result.summary || 'Unknown error'}
              </p>
            </div>
          )}

          {/* Request ID (always) */}
          <p className="text-[9px] text-text-muted font-mono">
            ID: {request.id}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
