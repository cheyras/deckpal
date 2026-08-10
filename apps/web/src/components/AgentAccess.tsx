/* ─────────────────────────────────────────────────────────────────────────────
 * Agent access — personal access tokens for the MCP endpoint (/profile).
 *
 * This is the surface behind DeckScout's sharpest trick: point Claude at your
 * own collection and decks. A token is minted here, shown ONCE, and pasted into
 * a claude.ai connector or `claude mcp add`. The server keeps only a hash, so
 * "show it again" is not a feature we can add later — the one-time reveal has
 * to carry that weight visually, which is why it is a full-width panel with its
 * own warning rather than an inline field.
 *
 * Visual language is the Account card's (ChangePassword), so the two read as
 * one settings stack: same 20px surface-secondary card, same haloed glyph +
 * title + pill-button header row, same FormAlert for feedback.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, type ApiTokenRow } from '../lib/api'
import { isCloudMode } from '../lib/supabase'
import { Field, FormAlert } from '../routes/auth/authUi'
import { Icon } from './Icon'

/**
 * Where an MCP client should point.
 *
 * Cloud: the endpoint is a function of this very deployment (`/mcp` on the same
 * origin), so it is derived rather than configured and can never go stale.
 * Self-host: rotom-mcp is a separate long-lived process behind the operator's
 * own reverse proxy, so there is no origin-relative answer — the help text says
 * so instead of inventing a URL.
 */
function mcpUrl(): string {
  if (typeof window === 'undefined') return 'https://deckscout.io/mcp'
  return `${window.location.origin}/mcp`
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Copy-to-clipboard button. `navigator.clipboard` needs a secure context; on
 * plain-HTTP LAN self-host it is simply absent, so the fallback selects the
 * text instead of silently doing nothing.
 */
function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          window.prompt('Copy this value:', value)
        }
      }}
      className={
        className ??
        'flex shrink-0 items-center gap-[6px] rounded-full bg-surface-tertiary px-[12px] py-[7px] text-[12px] font-semibold text-text-primary hover:bg-action-default-hover'
      }
      aria-live="polite"
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? 'Copied' : label}
    </button>
  )
}

/** A labelled block of copyable monospace text (token, URL, CLI command). */
function CodeRow({ value, label }: { value: string; label?: ReactNode }) {
  return (
    <div>
      {label ? <div className="mb-[6px] text-[12px] font-semibold text-text-secondary">{label}</div> : null}
      {/* `break-all`, not a horizontal scroller: tokens and CLI commands are one
          unbroken run of characters, and a clipped run with no visible scrollbar
          reads as truncated data at 390px. Wrapping shows the whole value; the
          Copy button is what anyone actually uses. */}
      <div className="flex flex-wrap items-center gap-[8px] rounded-[10px] border border-action-ghost-border bg-surface-tertiary px-[12px] py-[10px]">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-[1.55] text-text-primary">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

export function AgentAccess() {
  const [tokens, setTokens] = useState<ApiTokenRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<{ raw: string; name: string } | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  async function refresh() {
    try {
      const res = await api.apiTokens()
      setTokens(res.tokens)
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
      setTokens([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Give the token a name so you can tell it apart later.')
      return
    }
    setNameError(null)
    setFormError(null)
    setCreating(true)
    try {
      const res = await api.createApiToken(trimmed)
      setSecret({ raw: res.secret, name: res.token.name })
      setName('')
      setOpen(false)
      // Reveal the connection steps with the token: the two are useless apart.
      setShowHelp(true)
      await refresh()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(t: ApiTokenRow) {
    if (revoking) return
    if (!window.confirm(`Revoke "${t.name}"? Any assistant using it loses access immediately.`)) return
    setRevoking(t.id)
    try {
      await api.revokeApiToken(t.id)
      await refresh()
    } catch (err) {
      setLoadError((err as Error).message)
    } finally {
      setRevoking(null)
    }
  }

  const active = (tokens ?? []).filter((t) => !t.revokedAt)
  const revoked = (tokens ?? []).filter((t) => t.revokedAt)

  return (
    <section id="agent-access" className="scroll-mt-[90px] rounded-2xl bg-surface-secondary p-[20px]">
      <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Agent access</div>

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex min-w-0 items-center gap-[10px]">
          <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-action-primary">
            <Icon name="sparkle" size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-text-primary">Connect an AI assistant</div>
            <div className="text-[12px] text-text-muted">
              {active.length === 0
                ? 'Create a token to let Claude read and update your collection.'
                : `${active.length} active token${active.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o)
            setFormError(null)
            setNameError(null)
          }}
          aria-expanded={open}
          aria-controls="new-token-form"
          className="rounded-full bg-surface-tertiary px-[14px] py-[8px] text-[13px] font-semibold text-text-primary hover:bg-action-default-hover"
        >
          {open ? 'Cancel' : 'New token'}
        </button>
      </div>

      {/* ── One-time reveal ─────────────────────────────────────────────── */}
      {secret && (
        <div className="mt-[16px] rounded-[12px] border border-action-primary bg-halo-neutral p-[16px]">
          <div className="flex items-start gap-[8px]">
            <span className="mt-[1px] shrink-0 text-action-primary">
              <Icon name="alert" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-text-primary">
                Copy “{secret.name}” now — you won’t see it again
              </div>
              <p className="mt-[4px] text-[12px] leading-[1.55] text-text-body">
                DeckScout stores only a hash of this token, so it cannot be shown a second time. If you lose it,
                revoke it and create another.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSecret(null)}
              aria-label="Dismiss token"
              className="shrink-0 text-icon-default hover:text-icon-hover"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="mt-[12px]">
            <CodeRow value={secret.raw} />
          </div>
        </div>
      )}

      {/* ── Create form ─────────────────────────────────────────────────── */}
      {open && (
        <form id="new-token-form" onSubmit={handleCreate} noValidate className="mt-[16px] max-w-[380px]">
          {formError && <FormAlert kind="error">{formError}</FormAlert>}
          <Field
            label="Token name"
            type="text"
            autoComplete="off"
            placeholder="Claude on my laptop"
            value={name}
            disabled={creating}
            error={nameError}
            hint="Only for your own reference — name it after the device or app."
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(null)
            }}
          />
          <button
            type="submit"
            disabled={creating}
            aria-busy={creating || undefined}
            className="ls-cta flex h-[44px] items-center justify-center gap-[8px] rounded-full bg-action-primary px-[22px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-strong disabled:cursor-not-allowed disabled:opacity-55"
          >
            {creating && (
              <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-action-primary-text border-t-transparent" />
            )}
            {creating ? 'Creating…' : 'Create token'}
          </button>
        </form>
      )}

      {/* ── Token list ──────────────────────────────────────────────────── */}
      {loadError && (
        <div className="mt-[16px]">
          <FormAlert kind="error">{loadError}</FormAlert>
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="mt-[16px] flex flex-col gap-[8px]">
          {[...active, ...revoked].map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-[10px] rounded-[10px] bg-surface-tertiary px-[14px] py-[11px]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span className={`text-[13px] font-bold ${t.revokedAt ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                    {t.name}
                  </span>
                  <code className="font-mono text-[11px] text-text-muted">{t.prefix}…</code>
                  {t.revokedAt && (
                    <span className="rounded-full bg-halo-error px-[8px] py-[2px] text-[10px] font-bold uppercase tracking-wide text-error">
                      Revoked
                    </span>
                  )}
                </div>
                <div className="mt-[2px] text-[11px] text-text-muted">
                  Created {fmtDate(t.createdAt)} · Last used {fmtDate(t.lastUsedAt)}
                </div>
              </div>
              {!t.revokedAt && (
                <button
                  type="button"
                  disabled={revoking === t.id}
                  onClick={() => void handleRevoke(t)}
                  className="shrink-0 rounded-full border border-action-ghost-border px-[12px] py-[6px] text-[12px] font-semibold text-text-muted hover:border-action-danger hover:text-action-danger disabled:opacity-50"
                >
                  {revoking === t.id ? 'Revoking…' : 'Revoke'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Connection instructions ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowHelp((h) => !h)}
        aria-expanded={showHelp}
        aria-controls="agent-access-help"
        className="mt-[16px] flex items-center gap-[6px] text-[13px] font-semibold text-text-secondary hover:text-link"
      >
        <Icon name={showHelp ? 'minus' : 'plus'} size={14} />
        How to connect
      </button>

      {showHelp && (
        <div id="agent-access-help" className="mt-[12px] flex flex-col gap-[16px]">
          {isCloudMode ? (
            <>
              <CodeRow label="MCP endpoint" value={mcpUrl()} />

              <div>
                <div className="mb-[6px] text-[12px] font-semibold text-text-secondary">claude.ai</div>
                <ol className="ml-[18px] list-decimal text-[12px] leading-[1.7] text-text-body">
                  <li>Settings → Connectors → Add custom connector.</li>
                  <li>
                    Paste the endpoint above as the URL, and add a header{' '}
                    <code className="font-mono text-[11px] text-text-primary">
                      Authorization: Bearer &lt;token&gt;
                    </code>
                    .
                  </li>
                  <li>Save, then enable the connector in a chat and ask about your collection.</li>
                </ol>
              </div>

              <CodeRow
                label="Claude Code"
                value={`claude mcp add --transport http deckscout ${mcpUrl()} --header "Authorization: Bearer <token>"`}
              />
            </>
          ) : (
            <p className="text-[12px] leading-[1.6] text-text-body">
              On a self-hosted deploy the MCP server (<code className="font-mono text-[11px]">rotom-mcp</code>) runs
              as its own process behind your reverse proxy — see <span className="font-semibold">DEPLOYMENT.md</span>{' '}
              for the endpoint and how to gate it. Tokens created here work as{' '}
              <code className="font-mono text-[11px]">Authorization: Bearer</code> credentials against the REST API.
            </p>
          )}

          <p className="text-[12px] leading-[1.6] text-text-muted">
            <strong className="text-text-body">What the token grants.</strong> Anyone holding it can read your
            collection, lists, decks and battle logs, and can change them — the same things you can do when signed
            in. It cannot change your password, and it cannot create or revoke tokens. Treat it like a password:
            paste it only into clients you trust, and revoke it here the moment you are done with it.
          </p>
        </div>
      )}
    </section>
  )
}
