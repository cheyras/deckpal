/**
 * Thin typed client for the /__design/* dev-server endpoints.
 *
 * In production these endpoints do not exist (the SPA fallback answers with
 * index.html, so `res.json()` rejects) — callers treat any failure here as
 * "editing offline" and fall back to read-only sources.
 */
import { type TokenInfo } from './themeTokens'

export { type TokenInfo }

export interface TokensResponse {
  fileHash: string
  tokens: TokenInfo[]
}

export interface HealthResponse {
  ok: boolean
  worktree: string
  branch: string
}

export interface ChangeRequest {
  id: string
  kind: string
  target: string
  intent: string
  context?: Record<string, unknown>
  createdAt: string
  status: 'queued' | 'working' | 'done' | 'failed'
  result?: unknown
}

export interface RequestsResponse {
  agentAlive: boolean
  requests: ChangeRequest[]
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (!res.ok) {
    const err = new Error((data as any).error || `HTTP ${res.status}`)
    ;(err as any).status = res.status
    throw err
  }
  return data as T
}

export const designApi = {
  health: () => fetchJson<HealthResponse>('/__design/health'),

  tokens: () => fetchJson<TokensResponse>('/__design/tokens'),

  applyToken: (name: string, newValue: string, expectedValue: string) =>
    fetchJson<{ fileHash: string }>('/__design/tokens/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, newValue, expectedValue }),
    }),

  submitRequest: (req: { kind: string; target: string; intent: string; context?: Record<string, unknown> }) =>
    fetchJson<{ id: string }>('/__design/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),

  requests: () => fetchJson<RequestsResponse>('/__design/requests'),
}
