/**
 * Design-system editor — Vite dev-server plugin.
 *
 * Exposes `/__design/*` endpoints that parse, serve, and write design tokens
 * from `apps/web/src/theme.css`, manage the Lane B change-request queue, and
 * maintain an append-only ledger of every mutation.
 *
 * These endpoints exist ONLY while `vite dev` runs — they are not part of
 * `vite build` output and cannot ship to production. See DECISIONS.md
 * 2026-08-11 for the B9 approval that covers this capability.
 */
import { type Plugin } from 'vite'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, appendFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { execSync } from 'node:child_process'
// The parser is shared with the /design route's read-only production fallback
// (see themeTokens.ts) so the two views can never disagree about what a token is.
import { parseThemeCss, type TokenCategory } from '../src/routes/design/themeTokens'

// ── Types ────────────────────────────────────────────────────────────────────

interface LedgerEntry {
  ts: string
  lane: 'direct' | 'agent'
  kind: string
  name: string
  from: string
  to: string
}

interface ChangeRequest {
  id: string
  kind: string
  target: string
  intent: string
  context?: Record<string, unknown>
  createdAt: string
  status: 'queued' | 'working' | 'done' | 'failed'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const THEME_CSS_RELATIVE = 'src/theme.css'

function fileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Validate a proposed new value by category.
 */
function validateValue(cat: TokenCategory, value: string): string | null {
  // No semicolons, closing braces, or newlines in any value
  if (/[;\}\n\r]/.test(value)) return 'Value contains forbidden characters (;, }, newline)'

  switch (cat) {
    case 'color':
      // Accept #rgb, #rrggbb, or rgb(r g b / a) forms
      if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return null
      if (/^rgb\(\s*\d+\s+\d+\s+\d+\s*\/\s*[\d.]+\s*\)$/.test(value)) return null
      return 'Color must be #rgb, #rrggbb, or rgb(r g b / a)'

    case 'radius':
    case 'breakpoint':
      if (/^\d+(\.\d+)?px$/.test(value)) return null
      if (value === '9999px') return null // radius-full
      return 'Must be a <number>px value'

    case 'text':
      if (/^\d+(\.\d+)?px$/.test(value)) return null
      return 'Must be a <number>px value'

    case 'z':
      if (/^-?\d+$/.test(value)) return null
      return 'Must be an integer'

    case 'font':
    case 'ease':
    case 'shadow':
      // Permissive — just no forbidden chars (already checked)
      return null

    default:
      return null
  }
}

/**
 * Anchored write: find the single line matching --name: expectedValue; and
 * replace expectedValue with newValue. Returns the updated file content, or
 * throws with status code info.
 */
function anchoredReplace(
  content: string,
  name: string,
  expectedValue: string,
  newValue: string,
): string {
  const lines = content.split('\n')
  const normalizeWs = (s: string) => s.replace(/\s+/g, ' ').trim()
  const expectedNorm = normalizeWs(expectedValue)

  let matchIndex = -1
  let matchCount = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // Match the declaration: --name: value; (possibly with trailing comment)
    const declMatch = trimmed.match(new RegExp(`^(${escapeRegExp(name)}):\\s*(.+?)\\s*;(.*)$`))
    if (declMatch) {
      const foundValue = normalizeWs(declMatch[2])
      if (foundValue === expectedNorm) {
        matchIndex = i
        matchCount++
      }
    }
  }

  if (matchCount === 0) {
    const err = new Error(`No matching declaration found for ${name} with expected value`)
    ;(err as any).statusCode = 409
    throw err
  }
  if (matchCount > 1) {
    const err = new Error(`Multiple matches for ${name} — invariant broken, refusing to write`)
    ;(err as any).statusCode = 500
    throw err
  }

  // Replace only the value span on the matched line, preserving indentation and comments
  const originalLine = lines[matchIndex]
  const lineMatch = originalLine.match(new RegExp(`^(\\s*${escapeRegExp(name)}:\\s*).+?(\\s*;.*)$`))
  if (!lineMatch) {
    const err = new Error('Failed to re-match line for replacement')
    ;(err as any).statusCode = 500
    throw err
  }

  lines[matchIndex] = `${lineMatch[1]}${newValue}${lineMatch[2]}`
  return lines.join('\n')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default function designEditorPlugin(): Plugin {
  let webRoot = ''
  let themeCssPath = ''
  let requestsRoot = ''
  let ledgerPath = ''

  return {
    name: 'design-editor',
    configResolved(config) {
      webRoot = config.root
      themeCssPath = resolve(webRoot, THEME_CSS_RELATIVE)

      // design-requests/ at the monorepo root (two levels up from apps/web)
      const repoRoot = resolve(webRoot, '../..')
      requestsRoot = join(repoRoot, 'design-requests')
      ledgerPath = join(requestsRoot, 'ledger.ndjson')

      // Ensure queue directories exist
      for (const dir of ['queue', 'working', 'done', 'failed']) {
        mkdirSync(join(requestsRoot, dir), { recursive: true })
      }
    },

    configureServer(server) {
      // All endpoints under /__design/
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/__design')) return next()

        const url = new URL(req.url, 'http://localhost')
        const path = url.pathname

        // ── Health ─────────────────────────────────────────────
        if (path === '/__design/health' && req.method === 'GET') {
          let branch = 'unknown'
          try {
            branch = execSync('git rev-parse --abbrev-ref HEAD', {
              cwd: webRoot,
              encoding: 'utf-8',
            }).trim()
          } catch { /* ignore */ }

          const repoRoot = resolve(webRoot, '../..')
          return sendJson(res, 200, {
            ok: true,
            worktree: repoRoot,
            branch,
          })
        }

        // ── GET tokens ────────────────────────────────────────
        if (path === '/__design/tokens' && req.method === 'GET') {
          try {
            const content = readFileSync(themeCssPath, 'utf-8')
            const tokens = parseThemeCss(content)
            return sendJson(res, 200, {
              fileHash: fileHash(content),
              tokens,
            })
          } catch (e: any) {
            return sendJson(res, 500, { error: e.message })
          }
        }

        // ── POST tokens/apply ─────────────────────────────────
        if (path === '/__design/tokens/apply' && req.method === 'POST') {
          return readBody(req).then((body) => {
            try {
              const { name, newValue, expectedValue } = body
              if (!name || !newValue || !expectedValue) {
                return sendJson(res, 400, { error: 'name, newValue, expectedValue required' })
              }

              // Read current file
              const content = readFileSync(themeCssPath, 'utf-8')
              const tokens = parseThemeCss(content)
              const token = tokens.find((t) => t.name === name)
              if (!token) {
                return sendJson(res, 404, { error: `Token ${name} not found` })
              }

              // Validate new value
              const validationError = validateValue(token.category, newValue)
              if (validationError) {
                return sendJson(res, 422, { error: validationError })
              }

              // Anchored replace
              const updated = anchoredReplace(content, name, expectedValue, newValue)

              // Atomic write: write to temp file in same dir, then rename
              const tmpPath = join(dirname(themeCssPath), `.theme-css-${Date.now()}.tmp`)
              writeFileSync(tmpPath, updated, 'utf-8')
              renameSync(tmpPath, themeCssPath)

              // Ledger entry
              const entry: LedgerEntry = {
                ts: new Date().toISOString(),
                lane: 'direct',
                kind: 'token-set',
                name,
                from: expectedValue,
                to: newValue,
              }
              appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf-8')

              return sendJson(res, 200, { fileHash: fileHash(updated) })
            } catch (e: any) {
              const status = e.statusCode || 500
              return sendJson(res, status, { error: e.message })
            }
          })
        }

        // ── POST requests (Lane B seam) ───────────────────────
        if (path === '/__design/requests' && req.method === 'POST') {
          return readBody(req).then((body) => {
            try {
              const id = randomUUID()
              const request: ChangeRequest = {
                id,
                kind: body.kind || 'unknown',
                target: body.target || '',
                intent: body.intent || '',
                context: body.context,
                createdAt: new Date().toISOString(),
                status: 'queued',
              }

              const filePath = join(requestsRoot, 'queue', `${id}.json`)
              writeFileSync(filePath, JSON.stringify(request, null, 2), 'utf-8')

              // Ledger entry
              const entry: LedgerEntry = {
                ts: new Date().toISOString(),
                lane: 'agent',
                kind: request.kind,
                name: request.target,
                from: '',
                to: request.intent,
              }
              appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf-8')

              return sendJson(res, 201, { id })
            } catch (e: any) {
              return sendJson(res, 500, { error: e.message })
            }
          })
        }

        // ── GET requests (Lane B seam) ────────────────────────
        if (path === '/__design/requests' && req.method === 'GET') {
          try {
            const requests: Array<ChangeRequest & { result?: unknown }> = []

            for (const dir of ['queue', 'working', 'done', 'failed']) {
              const dirPath = join(requestsRoot, dir)
              if (!existsSync(dirPath)) continue
              const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'))
              for (const file of files.slice(-50)) {
                try {
                  const content = readFileSync(join(dirPath, file), 'utf-8')
                  const parsed = JSON.parse(content)
                  requests.push({
                    ...parsed,
                    status: dir === 'queue' ? 'queued' : dir as any,
                  })
                } catch { /* skip malformed */ }
              }
            }

            // Sort by createdAt descending
            requests.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

            // Agent alive check: heartbeat file freshness < 15s
            let agentAlive = false
            const heartbeatPath = join(requestsRoot, 'agent-heartbeat.json')
            if (existsSync(heartbeatPath)) {
              try {
                const hb = JSON.parse(readFileSync(heartbeatPath, 'utf-8'))
                agentAlive = Date.now() - new Date(hb.ts).getTime() < 15_000
              } catch { /* ignore */ }
            }

            return sendJson(res, 200, { agentAlive, requests })
          } catch (e: any) {
            return sendJson(res, 500, { error: e.message })
          }
        }

        return next()
      })
    },
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function sendJson(res: any, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}
