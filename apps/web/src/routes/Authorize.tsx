/* ─────────────────────────────────────────────────────────────────────────────
 * /authorize — the OAuth 2.1 consent screen for the /mcp "Connect" flow.
 *
 * Every MCP client (claude.ai, ChatGPT, Gemini, or anything speaking the MCP
 * Authorization spec) that wants to connect without a copy-pasted personal
 * access token lands here mid-flow, driven by its own backend: response_type,
 * client_id, redirect_uri, a PKCE code_challenge and an opaque state all
 * arrive as query params (see apps/api/src/oauthServer.ts for the /register
 * and /token halves of the exchange).
 *
 * Chrome-free like /auth (lib/landingRoute.ts) and PUBLIC — it must render
 * for a signed-out visitor so IT can decide where to send them next
 * (/auth?next=<this url>) rather than AuthGuard bouncing them to a bare
 * /auth that forgets every query param this page was just given.
 *
 * Any site can register an app called "Claude", so the screen leads with where
 * the approval is sent and quotes the app's own name only as a claim, unless
 * the server recognised the exact callback (lib/oauthConsent.ts, SEC-07). The
 * person also chooses what the connection may do: read and change, or read.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import { readSession } from '../lib/authSession'
import { api, type OAuthClientInfo } from '../lib/api'
import { consentView, SCOPE_OPTIONS, supportsScopedConsent, type ConsentScope, type ConsentView } from '../lib/oauthConsent'
import { Icon } from '../components/Icon'
import { Spinner } from '../components/ui'
import { AuthCard, AuthPage, CTA_GHOST, SubmitButton } from './auth/authUi'
import { FormAlert } from '../components/ui/FormAlert'
import type { Session } from '@supabase/supabase-js'

interface AuthorizeSearch {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  code_challenge?: string
  code_challenge_method?: string
  state?: string
  resource?: string
}

/** A verified app reads calm; anything we cannot vouch for reads as a caution. */
const TONE = {
  verified: {
    card: 'border-action-ghost-border bg-surface-tertiary',
    glyph: 'bg-halo-success text-success',
    icon: 'shield-check',
    badge: 'border-success/40 bg-halo-success text-success',
  },
  caution: {
    card: 'border-warning/35 bg-warning/[0.07]',
    glyph: 'bg-warning/[0.12] text-warning',
    icon: 'alert',
    badge: 'border-warning/40 bg-warning/[0.12] text-warning',
  },
} as const

/** Who is asking, led by where the approval goes. */
function ClientIdentity({ view }: { view: ConsentView }) {
  const tone = TONE[view.trust === 'verified' ? 'verified' : 'caution']
  return (
    <div className={`mb-[20px] flex items-start gap-[12px] rounded-[12px] border p-[14px] ${tone.card}`}>
      <div className={`mt-[1px] flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full ${tone.glyph}`}>
        <Icon name={tone.icon} size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
          <span className="break-all text-[16px] font-bold text-text-primary">{view.heading}</span>
          <span className={`rounded-full border px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-wide ${tone.badge}`}>
            {view.badge}
          </span>
        </div>
        <p className="mt-[4px] text-[14px] leading-[1.55] text-text-body">{view.detail}</p>
        {view.caution && <p className="mt-[6px] text-[14px] leading-[1.55] text-text-secondary">{view.caution}</p>}
      </div>
    </div>
  )
}

export function Authorize() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as AuthorizeSearch

  const [session, setSession] = useState<Session | null | undefined>(isCloudMode ? undefined : null)
  const [client, setClient] = useState<OAuthClientInfo | null>(null)
  const [scope, setScope] = useState<ConsentScope>('full')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { response_type: responseType, client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, state, resource } = search

  const malformed =
    !isCloudMode ||
    responseType !== 'code' ||
    !clientId ||
    !redirectUri ||
    !codeChallenge ||
    codeChallengeMethod !== 'S256'

  useEffect(() => {
    if (!isCloudMode) return
    let live = true
    // Bounded (lib/sessionDeadline.ts). A TIMEOUT MUST NOT SET `null` HERE: the
    // effect below reads `null` as "signed out" and navigates away, and this
    // page is mid-OAuth-handshake — bouncing a signed-in visitor to /auth over
    // a slow network would restart a flow their client is waiting on. Stay
    // `undefined` (the spinner) and let `onLate` settle it if it arrives.
    void readSession((s) => {
      if (live) setSession(s)
    }).then(({ session: s, timedOut }) => {
      if (live && !timedOut) setSession(s)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (malformed || session === undefined) return
    if (session === null) {
      navigate({ to: '/auth', search: { next: `${window.location.pathname}${window.location.search}` } })
      return
    }
    api
      .oauthClient(clientId!, redirectUri!)
      .then(setClient)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not look up this connector.'))
  }, [malformed, session, clientId, redirectUri, navigate])

  async function decide(decision: 'allow' | 'deny') {
    if (busy) return
    setBusy(decision)
    setActionError(null)
    try {
      const { redirectTo } = await api.oauthDecision({
        decision,
        responseType: responseType!,
        clientId: clientId!,
        redirectUri: redirectUri!,
        codeChallenge: codeChallenge!,
        codeChallengeMethod: codeChallengeMethod!,
        state,
        resource,
        scope: client && supportsScopedConsent(client) ? scope : 'full',
      })
      window.location.href = redirectTo
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setBusy(null)
    }
  }

  if (malformed) {
    return (
      <AuthPage>
        <AuthCard title="Invalid connection request" subtitle="This link is missing something an MCP connector request needs.">
          <p className="text-[14px] leading-[1.6] text-text-body">
            {!isCloudMode
              ? "This DeckPal deployment is self-hosted and doesn't use sign-in-based connections — use the shared key instead."
              : 'Go back to the app you were connecting DeckPal to and try adding the connector again.'}
          </p>
        </AuthCard>
      </AuthPage>
    )
  }

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-primary">
        <Spinner inline size={32} className="text-action-primary" />
      </div>
    )
  }

  if (loadError) {
    return (
      <AuthPage>
        <AuthCard title="Can't connect" subtitle={loadError}>
          <p className="text-[14px] leading-[1.6] text-text-body">
            Go back to the app you were connecting and try again, or use a personal access token instead
            (Profile → Agent access).
          </p>
        </AuthCard>
      </AuthPage>
    )
  }

  if (client === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-primary">
        <Spinner inline size={32} className="text-action-primary" />
      </div>
    )
  }

  const view = consentView(client)
  const scopedConsent = supportsScopedConsent(client)
  const displayedScope = scopedConsent ? scope : 'full'

  return (
    <AuthPage>
      <AuthCard title="Connect to DeckPal" subtitle="Check who is asking before you approve.">
        <ClientIdentity view={view} />

        <fieldset className="mb-[16px]" disabled={busy !== null}>
          <legend className="mb-[8px] text-[14px] font-bold text-text-primary">What it can do</legend>
          <div className="flex flex-col gap-[8px]">
            {SCOPE_OPTIONS.filter((option) => option.value === 'full' || scopedConsent).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-[10px] rounded-[12px] border p-[12px] transition-colors ${
                  displayedScope === option.value
                    ? 'border-action-primary bg-halo-neutral'
                    : 'border-action-ghost-border bg-surface-tertiary hover:border-text-muted'
                }`}
              >
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  checked={displayedScope === option.value}
                  onChange={() => setScope(option.value)}
                  className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-[var(--color-action-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold text-text-primary">{option.label}</span>
                  <span className="block text-[14px] leading-[1.5] text-text-body">{option.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="mb-[20px] text-[14px] leading-[1.55] text-text-muted">
          {scopedConsent
            ? 'Either way it can’t see your password, change your account settings or spend money. It stays connected while you use it, and you can disconnect it any time in Profile → Agent access.'
            : 'This connection has full access to your DeckPal account. You can disconnect it any time in Profile → Agent access.'}
        </p>

        {actionError && <FormAlert kind="error">{actionError}</FormAlert>}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void decide('allow')
          }}
          className="flex flex-col gap-[10px]"
        >
          <SubmitButton loading={busy === 'allow'} disabled={busy !== null && busy !== 'allow'}>
            {busy === 'allow' ? 'Connecting…' : 'Allow'}
          </SubmitButton>
          <button
            type="button"
            onClick={() => void decide('deny')}
            disabled={busy !== null}
            className={CTA_GHOST}
          >
            {busy === 'deny' ? 'Cancelling…' : 'Deny'}
          </button>
        </form>
      </AuthCard>
    </AuthPage>
  )
}
