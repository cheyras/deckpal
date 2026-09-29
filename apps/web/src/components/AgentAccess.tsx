/* ─────────────────────────────────────────────────────────────────────────────
 * Agent access — connections and personal access tokens for the MCP endpoint
 * (/profile).
 *
 * This is the surface behind DeckPal's sharpest trick: point Claude at your
 * own collection and decks. The main path mints nothing here: a client pointed
 * at bare `/mcp` runs the OAuth sign-in and approval (routes/Authorize.tsx),
 * and the connection it opens is listed below beside any tokens. A token is
 * for clients that can't do that — minted here, shown ONCE, and sent as an
 * `Authorization: Bearer` header. It is never offered inside a URL: request
 * paths land in the host's request logs. The server keeps only a hash, so
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
import { lifetimeText, redirectBadge, tokenState } from '../lib/oauthConsent'
import { isCloudMode } from '../lib/supabase'
import { Field, FormAlert } from './ui'
import { Button } from './ui/Button'
import { Icon } from './Icon'

/**
 * Where an MCP client should point.
 *
 * Cloud: the endpoint is a function of this very deployment (`/mcp` on the same
 * origin), so it is derived rather than configured and can never go stale.
 * Self-host: deckpal-mcp is a separate long-lived process behind the operator's
 * own reverse proxy, so there is no origin-relative answer — the help text says
 * so instead of inventing a URL.
 */
function mcpUrl(): string {
  if (typeof window === 'undefined') return 'https://deckpal.app/mcp'
  // Always the apex host. `www.deckpal.app` 308-redirects here, and a redirect
  // to a different host silently drops the Authorization header — which
  // surfaces inside claude.ai as an authorization failure with no clue why.
  return `${window.location.origin.replace('://www.', '://')}/mcp`
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
        'flex shrink-0 items-center gap-[6px] rounded-full bg-surface-tertiary px-[12px] py-[7px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover'
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
      {label ? <div className="mb-[6px] text-[14px] font-semibold text-text-secondary">{label}</div> : null}
      {/* `break-all`, not a horizontal scroller: tokens and CLI commands are one
          unbroken run of characters, and a clipped run with no visible scrollbar
          reads as truncated data at 390px. Wrapping shows the whole value; the
          Copy button is what anyone actually uses. */}
      <div className="flex flex-wrap items-center gap-[8px] rounded-[10px] border border-action-ghost-border bg-surface-tertiary px-[12px] py-[10px]">
        <code className="min-w-0 flex-1 break-all font-mono text-[14px] leading-[1.55] text-text-primary">
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
      <span className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-[14px] font-bold text-action-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-[6px] text-[14px] font-bold text-text-primary">{title}</div>
        <div className="text-[14px] leading-[1.6] text-text-body">{children}</div>
      </div>
    </div>
  )
}

const BADGE = 'rounded-full px-[8px] py-[2px] text-[12px] font-bold uppercase tracking-wide'

/**
 * One token or connection. A connection's name already says where its
 * approval went; beside it go the badge the consent screen showed, whether it
 * is read-only, and when it lapses. A hand-made token shows its prefix and
 * "No expiry".
 */
function TokenRow({ token: t, revoking, onRevoke }: { token: ApiTokenRow; revoking: boolean; onRevoke: () => void }) {
  const state = tokenState(t)
  const badge = redirectBadge(t)
  const live = state === 'active'
  return (
    <li className="flex flex-wrap items-center justify-between gap-[10px] rounded-[10px] bg-surface-tertiary px-[14px] py-[11px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className={`text-[14px] font-bold ${live ? 'text-text-primary' : 'text-text-muted line-through'}`}>{t.name}</span>
          {/* A connection's own prefix names no secret its app holds (those
              rotate beneath it), so only a hand-made token shows one. */}
          {!t.redirect && <code className="font-mono text-[14px] text-text-muted">{t.prefix}…</code>}
          {live && badge && (
            <span
              className={`${BADGE} border ${
                badge === 'Verified' ? 'border-success/40 bg-halo-success text-success' : 'border-warning/40 bg-warning/[0.12] text-warning'
              }`}
            >
              {badge}
            </span>
          )}
          {live && t.scope === 'read' && (
            <span className={`${BADGE} border border-action-ghost-border text-text-secondary`}>Read only</span>
          )}
          {live && (t as ApiTokenRow & { deckeImprovementRead?: boolean }).deckeImprovementRead && (
            <span className={`${BADGE} border border-action-ghost-border text-text-secondary`}>Deck-E research</span>
          )}
          {!live && <span className={`${BADGE} bg-halo-error text-error`}>{state === 'revoked' ? 'Revoked' : 'Expired'}</span>}
        </div>
        <div className="mt-[2px] break-words text-[14px] text-text-muted">
          {/* The name carries the host, but shortens a long one, and a local
              app's says "this computer": then the full host is spelled out here. */}
          {t.redirect && !t.name.includes(t.redirect.host) ? `Sends to ${t.redirect.host} · ` : ''}
          {t.redirect ? 'Connected' : 'Created'} {fmtDate(t.createdAt)} · Last used {fmtDate(t.lastUsedAt)}
        </div>
        <div className="text-[14px] text-text-muted">{lifetimeText(t)}</div>
      </div>
      {live && (
        <button
          type="button"
          disabled={revoking}
          onClick={onRevoke}
          className="shrink-0 rounded-full border border-action-ghost-border px-[12px] py-[6px] text-[14px] font-semibold text-text-muted hover:border-action-danger hover:text-action-danger disabled:opacity-50"
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </button>
      )}
    </li>
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
  const [canGrantImprovement, setCanGrantImprovement] = useState(false)
  const [grantImprovement, setGrantImprovement] = useState(false)
  const [secret, setSecret] = useState<{ raw: string; name: string } | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  async function refresh() {
    try {
      const res = await api.apiTokens() as Awaited<ReturnType<typeof api.apiTokens>> & { canGrantDeckeImprovementRead?: boolean }
      setTokens(res.tokens)
      setCanGrantImprovement(res.canGrantDeckeImprovementRead === true)
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
      // The API client overload is supplied by the shared web transport lane;
      // the server independently rejects this capability for an ineligible user.
      const createWithCapability = api.createApiToken as unknown as (
        tokenName: string,
        deckeImprovementRead: boolean,
      ) => ReturnType<typeof api.createApiToken>
      const res = await createWithCapability(trimmed, grantImprovement)
      setSecret({ raw: res.secret, name: res.token.name })
      setName('')
      setGrantImprovement(false)
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

  // Expired connections sit with the revoked ones: neither works any more.
  const active = (tokens ?? []).filter((t) => tokenState(t) === 'active')
  const ended = (tokens ?? []).filter((t) => tokenState(t) !== 'active')

  return (
    <section id="agent-access" className="scroll-mt-[90px] rounded-2xl bg-surface-secondary p-[20px]">
      <div className="text-[14px] font-bold uppercase tracking-wide text-text-muted">Agent access</div>

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex min-w-0 items-center gap-[10px]">
          <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-action-primary">
            <Icon name="sparkle" size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-text-primary">Connect an AI assistant</div>
            <div className="text-[14px] text-text-muted">
              {active.length === 0
                ? 'Let Claude read and update your collection. You sign in and approve it here.'
                : `${active.length} active connection${active.length === 1 ? '' : 's'}`}
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
          className="rounded-full bg-surface-tertiary px-[14px] py-[8px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover"
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
              <p className="mt-[4px] text-[14px] leading-[1.55] text-text-body">
                DeckPal stores only a hash of this token, so it cannot be shown a second time. If you lose it,
                revoke it and create another. Your client sends it as an{' '}
                <code className="font-mono text-[14px] text-text-primary">Authorization: Bearer</code> header;{' '}
                {isCloudMode ? 'step 5 below shows where it goes.' : 'see the note below.'}
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
            <CodeRow label="Token" value={secret.raw} />
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
          {canGrantImprovement && (
            <label className="mb-[14px] flex cursor-pointer items-start gap-[10px] text-[14px] text-text-body">
              <input
                type="checkbox"
                checked={grantImprovement}
                disabled={creating}
                onChange={(event) => setGrantImprovement(event.target.checked)}
                className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-[var(--color-action-primary)]"
              />
              <span>
                <span className="block font-semibold text-text-primary">Read the anonymised Deck-E chat collection</span>
                <span className="block text-text-muted">Off by default. Only explicitly shared chats are included.</span>
              </span>
            </label>
          )}
          <Button type="submit" loading={creating} className="ls-cta">
            {creating ? 'Creating…' : 'Create token'}
          </Button>
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
          {[...active, ...ended].map((t) => (
            <TokenRow key={t.id} token={t} revoking={revoking === t.id} onRevoke={() => void handleRevoke(t)} />
          ))}
        </ul>
      )}

      {/* ── Connection instructions ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowHelp((h) => !h)}
        aria-expanded={showHelp}
        aria-controls="agent-access-help"
        className="mt-[16px] flex items-center gap-[6px] text-[14px] font-semibold text-text-secondary hover:text-link"
      >
        <Icon name={showHelp ? 'minus' : 'plus'} size={14} />
        How to connect
      </button>

      {showHelp && (
        <div id="agent-access-help" className="mt-[12px] flex flex-col gap-[16px]">
          {isCloudMode ? (
            <>
              <Step n={1} title="Add the connector in claude.ai">
                <p className="mb-[8px]">
                  In claude.ai: <strong className="text-text-body">Customize → Connectors → + → Add custom connector</strong>.
                  Name it <em>DeckPal</em>, paste this as the Remote MCP server URL, and click{' '}
                  <strong className="text-text-body">Add</strong>. Leave the advanced settings empty — there is
                  nothing to copy from here.
                </p>
                <CodeRow value={mcpUrl()} />
                <p className="mt-[8px] text-text-muted">
                  Any other assistant that supports MCP connectors with sign-in uses the same address.
                </p>
              </Step>

              <Step n={2} title="Sign in and approve">
                <p>
                  Press <strong className="text-text-body">Connect</strong> on the new connector. A DeckPal page
                  opens; sign in if you aren’t already. It shows who is asking before anything else — Claude is
                  marked <strong className="text-text-body">Verified</strong> — and lets you choose{' '}
                  <em>Read and change</em> or <em>Read only</em>. Press{' '}
                  <strong className="text-text-body">Allow</strong> and you are back in Claude, connected. The
                  connection then appears in the list above as <em>Claude (OAuth · claude.ai)</em>.
                </p>
              </Step>

              <Step n={3} title="Check that it works">
                <p>
                  Start a new chat, turn DeckPal on in the tools menu, and ask{' '}
                  <em>“what is my collection worth, and which set am I closest to finishing?”</em> You should get your
                  own numbers back. The connection’s <strong className="text-text-body">Last used</strong> date
                  above updates within a minute.
                </p>
              </Step>

              <Step n={4} title="Claude Code instead (optional)">
                <CodeRow value={`claude mcp add --transport http deckpal ${mcpUrl()}`} />
                <p className="mt-[8px]">
                  Then run <code className="font-mono text-[14px] text-text-primary">/mcp</code> in Claude Code and
                  pick <em>deckpal</em> to sign in. The same approval opens in your browser, where Claude Code shows
                  as <em>An app on this computer</em>. Afterwards{' '}
                  <code className="font-mono text-[14px] text-text-primary">claude mcp list</code> should print{' '}
                  <code className="font-mono text-[14px] text-text-primary">deckpal: {mcpUrl()} (HTTP) - ✔ Connected</code>.
                  Remove it with <code className="font-mono text-[14px] text-text-primary">claude mcp remove deckpal</code>.
                </p>
              </Step>

              <Step n={5} title="Use a token instead (advanced)">
                <p className="mb-[8px]">
                  For a client that can’t sign in this way, create a token with the{' '}
                  <strong className="text-text-body">New token</strong> button above and have the client send it as a
                  header: <code className="font-mono text-[14px] text-text-primary">Authorization: Bearer &lt;your token&gt;</code>.
                </p>

                <div className="mb-[10px] rounded-[10px] border border-action-ghost-border p-[12px]">
                  <div className="mb-[6px] text-[14px] font-bold text-text-primary">
                    In claude.ai, if the dialog has a “Request headers” section
                  </div>
                  <ol className="ml-[16px] list-decimal leading-[1.7]">
                    <li>
                      Remote MCP server URL: <code className="font-mono text-[14px] text-text-primary">{mcpUrl()}</code>
                    </li>
                    <li>
                      Open <strong className="text-text-body">Request headers</strong>, choose the header name{' '}
                      <code className="font-mono text-[14px] text-text-primary">authorization</code>, and set the value
                      to <code className="font-mono text-[14px] text-text-primary">Bearer &lt;your token&gt;</code>{' '}
                      (the word <em>Bearer</em>, a space, then the token). Mark it Required.
                    </li>
                    <li>
                      Click <strong className="text-text-body">Add</strong>.
                    </li>
                  </ol>
                  <p className="mt-[6px] text-text-muted">
                    Request headers are a beta Anthropic is still rolling out. If you don’t see that section, use
                    steps 1 and 2 instead.
                  </p>
                </div>

                <CodeRow
                  label="In Claude Code"
                  value={`claude mcp add --transport http deckpal ${mcpUrl()} --header "Authorization: Bearer <token>"`}
                />

                <p className="mt-[8px] text-text-muted">
                  DeckPal no longer offers a connector address with the token inside it: web addresses end up in
                  server request logs, so a token belongs in a header. One you already set up that way keeps working.
                  To replace it, connect with steps 1 and 2, then revoke the old token.
                </p>
              </Step>

              <Step n={6} title="If it doesn’t connect">
                <ul className="ml-[16px] list-disc leading-[1.7]">
                  <li>
                    Use <code className="font-mono text-[14px] text-text-primary">{mcpUrl()}</code> exactly — not the{' '}
                    <code className="font-mono text-[14px]">www.</code> version. That one redirects, and a redirect
                    breaks the sign-in and drops a token header.
                  </li>
                  <li>
                    If the DeckPal page says <em>“Invalid connection request”</em>, that client doesn’t support this
                    sign-in yet. Use a token (step 5).
                  </li>
                  <li>
                    With a token, “Couldn’t reach the MCP server” or an authorization error almost always means the
                    token is missing, mistyped, or revoked. Create a fresh one and re-paste it — a token cannot be
                    shown twice, so a partial copy is unrecoverable.
                  </li>
                  <li>
                    Include the word <code className="font-mono text-[14px] text-text-primary">Bearer</code> and one
                    space before the token. claude.ai sends the value exactly as typed.
                  </li>
                </ul>
              </Step>

              <Step n={7} title="Disconnecting">
                <p>
                  Press <strong className="text-text-body">Revoke</strong> next to a connection or token here. It
                  stops working immediately, on every client, and the row stays in the list so you can see it
                  happened. Then remove the connector in claude.ai, or connect it again.
                </p>
              </Step>
            </>
          ) : (
            <p className="text-[12px] leading-[1.6] text-text-body">
              On a self-hosted deploy the MCP server (<code className="font-mono text-[12px]">deckpal-mcp</code>) runs
              as its own process behind your reverse proxy — see <span className="font-semibold">DEPLOYMENT.md</span>{' '}
              for the endpoint and how to gate it. Tokens created here work as{' '}
              <code className="font-mono text-[12px]">Authorization: Bearer</code> credentials against the REST API.
            </p>
          )}

          <p className="text-[12px] leading-[1.6] text-text-muted">
            <strong className="text-text-body">What a connection grants.</strong> Anything you connect — by
            approving it or with a token — can read your collection, lists, decks and battle logs, and can change
            them: the same things you can do when signed in. One you approved as <em>Read only</em> can only read.
            None can change your password or account settings, read your Deck-E conversations, spend money, or
            create or revoke tokens. An approved connection ends by itself after 90 days without use. A token you
            make here never expires, so treat it like a password: paste it only into clients you trust, and revoke
            it here the moment you are done with it.
          </p>
        </div>
      )}
    </section>
  )
}
