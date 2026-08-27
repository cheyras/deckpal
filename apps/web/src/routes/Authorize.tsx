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
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import { readSession } from '../lib/authSession'
import { api } from '../lib/api'
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

/** Host shown on the consent screen — what the visitor is actually trusting. */
function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export function Authorize() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as AuthorizeSearch

  const [session, setSession] = useState<Session | null | undefined>(isCloudMode ? undefined : null)
  const [clientName, setClientName] = useState<string | null>(null)
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
      .then((r) => setClientName(r.clientName))
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

  if (clientName === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-primary">
        <Spinner inline size={32} className="text-action-primary" />
      </div>
    )
  }

  return (
    <AuthPage>
      <AuthCard title="Connect to DeckPal" subtitle={<><span className="font-semibold text-text-primary">{clientName}</span> wants to access your account.</>}>
        <div className="mb-[20px] flex items-start gap-[12px] rounded-[12px] border border-action-ghost-border bg-surface-tertiary p-[14px]">
          <div className="mt-[1px] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-halo-neutral text-action-primary">
            <Icon name="link" size={16} />
          </div>
          <div className="text-[14px] leading-[1.55] text-text-body">
            It will be able to view and update your collection, decks, lists and battle logs — the same access
            you have when signed in. It will not see your password and cannot change your account.
          </div>
        </div>

        <p className="mb-[20px] text-[14px] text-text-muted">
          After you approve, you'll be redirected to <span className="font-semibold text-text-secondary">{hostOf(redirectUri!)}</span>.
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
