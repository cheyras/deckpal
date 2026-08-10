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
  // Always the apex host. `www.deckscout.io` 308-redirects here, and a redirect
  // to a different host silently drops the Authorization header — which
  // surfaces inside claude.ai as an authorization failure with no clue why.
  return `${window.location.origin.replace('://www.', '://')}/mcp`
}

/** The whole-URL form: the credential is the URL. Used by clients that cannot send a header. */
function connectorUrl(token: string): string {
  return `${mcpUrl()}/${token}`
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

/** One numbered step of the setup guide. Numbered because people follow them in order. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-[10px]">
      <span className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-[11px] font-bold text-action-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-[6px] text-[13px] font-bold text-text-primary">{title}</div>
        <div className="text-[12px] leading-[1.6] text-text-body">{children}</div>
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
          <div className="mt-[12px] flex flex-col gap-[12px]">
            <CodeRow label="Token" value={secret.raw} />
            {isCloudMode && (
              <CodeRow
                label={
                  <>
                    Personal connector URL <span className="font-normal text-text-muted">— the token is inside it</span>
                  </>
                }
                value={connectorUrl(secret.raw)}
              />
            )}
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
              <Step n={1} title="Create a token">
                <p>
                  Use the <strong className="text-text-body">New token</strong> button above. Copy the value the
                  moment it appears — it is shown once and cannot be recovered.
                </p>
              </Step>

              <Step n={2} title="Add the connector in claude.ai">
                <p className="mb-[8px]">
                  In claude.ai: <strong className="text-text-body">Settings → Connectors → Add custom connector</strong>.
                  Name it <em>DeckScout</em>, then use whichever of these two the dialog offers you.
                </p>

                <div className="mb-[10px] rounded-[10px] border border-action-ghost-border p-[12px]">
                  <div className="mb-[6px] text-[12px] font-bold text-text-primary">
                    A · If the dialog has a “Request headers” section (preferred)
                  </div>
                  <ol className="ml-[16px] list-decimal leading-[1.7]">
                    <li>
                      Remote MCP server URL: <code className="font-mono text-[11px] text-text-primary">{mcpUrl()}</code>
                    </li>
                    <li>
                      Open <strong className="text-text-body">Request headers</strong>, choose the header name{' '}
                      <code className="font-mono text-[11px] text-text-primary">authorization</code>, and set the value
                      to <code className="font-mono text-[11px] text-text-primary">Bearer &lt;your token&gt;</code>{' '}
                      (the word <em>Bearer</em>, a space, then the token). Mark it Required.
                    </li>
                    <li>
                      Click <strong className="text-text-body">Add</strong>.
                    </li>
                  </ol>
                  <p className="mt-[6px] text-text-muted">
                    Request headers are a beta Anthropic is still rolling out. If you don’t see that section, use B.
                  </p>
                </div>

                <div className="rounded-[10px] border border-action-ghost-border p-[12px]">
                  <div className="mb-[6px] text-[12px] font-bold text-text-primary">
                    B · If there is no header field — use your personal connector URL
                  </div>
                  <ol className="ml-[16px] list-decimal leading-[1.7]">
                    <li>
                      Paste your personal connector URL as the Remote MCP server URL. It looks like{' '}
                      <code className="font-mono text-[11px] text-text-primary">{`${mcpUrl()}/dsk_…`}</code> and is shown
                      once, next to the token, when you create it.
                    </li>
                    <li>Add no headers. Click Add.</li>
                  </ol>
                  <p className="mt-[6px] text-text-muted">
                    That URL <strong className="text-text-body">contains your token</strong> — treat the whole thing
                    like a password. Revoking the token kills the URL too.
                  </p>
                </div>
              </Step>

              <Step n={3} title="Check that it works">
                <p>
                  Start a new chat, turn DeckScout on in the tools menu, and ask{' '}
                  <em>“what is my collection worth, and which set am I closest to finishing?”</em> You should get your
                  own numbers back. The token’s <strong className="text-text-body">Last used</strong> date above
                  updates within a minute.
                </p>
              </Step>

              <Step n={4} title="Claude Code instead (optional)">
                <CodeRow
                  value={`claude mcp add --transport http deckscout ${mcpUrl()} --header "Authorization: Bearer <token>"`}
                />
                <p className="mt-[8px]">
                  Then <code className="font-mono text-[11px] text-text-primary">claude mcp list</code> should print{' '}
                  <code className="font-mono text-[11px] text-text-primary">deckscout: {mcpUrl()} (HTTP) - ✔ Connected</code>.
                  Remove it with <code className="font-mono text-[11px] text-text-primary">claude mcp remove deckscout</code>.
                </p>
              </Step>

              <Step n={5} title="If it doesn’t connect">
                <ul className="ml-[16px] list-disc leading-[1.7]">
                  <li>
                    Use <code className="font-mono text-[11px] text-text-primary">{mcpUrl()}</code> exactly — not the{' '}
                    <code className="font-mono text-[11px]">www.</code> version. That one redirects, and a redirect
                    drops the header.
                  </li>
                  <li>
                    “Couldn’t reach the MCP server” or an authorization error almost always means the token is missing,
                    mistyped, or revoked. Create a fresh one and re-paste it — a token cannot be shown twice, so a
                    partial copy is unrecoverable.
                  </li>
                  <li>
                    Include the word <code className="font-mono text-[11px] text-text-primary">Bearer</code> and one
                    space before the token in option A. claude.ai sends the value exactly as typed.
                  </li>
                </ul>
              </Step>

              <Step n={6} title="Revoking">
                <p>
                  Press <strong className="text-text-body">Revoke</strong> next to a token here. It stops working
                  immediately, on every client, and the row stays in the list so you can see it happened. Then delete
                  the connector in claude.ai, or replace its token with a new one.
                </p>
              </Step>
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
