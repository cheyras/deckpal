/**
 * Token panel: fetches all design tokens from the dev-server plugin,
 * renders per-category controls, wires live overrides + save/reset.
 *
 * When the dev endpoints are absent (production — the /design route ships as
 * an owner-only read-only reference), tokens are parsed client-side from the
 * same theme.css source, imported as text. Overrides still preview live;
 * nothing can be saved.
 */
import { useState, useEffect, useCallback } from 'react'
import { designApi, type TokenInfo } from './designApi'
import { parseThemeCss } from './themeTokens'
import themeCssRaw from '../../theme.css?raw'
import { type TokenOverrideStore } from './useTokenOverrides'
import { ColorKnob, PxKnob, NumberKnob, TextKnob, SelectKnob } from './knobs'

// Curated font stacks for the font-sans selector
const FONT_OPTIONS = [
  "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif",
  'ui-sans-serif, system-ui, -apple-system, sans-serif',
  "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
] as const

interface TokenPanelProps {
  overrides: TokenOverrideStore
  /** False when the /__design dev endpoints are absent (production) — hides save. */
  editable: boolean
}

interface TokenGroup {
  section: string
  tokens: TokenInfo[]
}

export function TokenPanel({ overrides, editable }: TokenPanelProps) {
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [fileHash, setFileHash] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const fetchTokens = useCallback(async () => {
    try {
      const data = await designApi.tokens()
      setTokens(data.tokens)
      setFileHash(data.fileHash)
      setError(null)
    } catch {
      // No dev server (production read-only): parse the same theme.css source,
      // bundled as text. The values are the ones this build shipped with.
      setTokens(parseThemeCss(themeCssRaw))
      setFileHash('bundled')
      setError(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  const handleSave = async (token: TokenInfo) => {
    const overrideValue = overrides.get(token.name)
    if (!overrideValue) return

    setSaving(token.name)
    setSaveError(null)

    try {
      const result = await designApi.applyToken(token.name, overrideValue, token.value)
      setFileHash(result.fileHash)
      overrides.savedAck(token.name)
      // Refresh tokens to get the updated values
      await fetchTokens()
    } catch (e: any) {
      if (e.status === 409) {
        // Stale panel — refetch
        setSaveError('Token value changed on disk — refetching...')
        await fetchTokens()
      } else {
        setSaveError(e.message)
      }
    } finally {
      setSaving(null)
    }
  }

  const handleSaveAll = async () => {
    for (const [name] of overrides.overrides) {
      const token = tokens.find((t) => t.name === name)
      if (token) await handleSave(token)
    }
  }

  if (loading) {
    return <div className="text-text-muted text-[13px] py-[20px] text-center">Loading tokens...</div>
  }
  if (error) {
    return <div className="text-error text-[13px] py-[20px] text-center">Error: {error}</div>
  }

  // Group tokens by section
  const groups: TokenGroup[] = []
  let currentGroup: TokenGroup | null = null
  for (const token of tokens) {
    if (!currentGroup || currentGroup.section !== token.section) {
      currentGroup = { section: token.section, tokens: [] }
      groups.push(currentGroup)
    }
    currentGroup.tokens.push(token)
  }

  const toggleSection = (section: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  return (
    <div className="space-y-[4px]">
      {/* Save all bar */}
      {overrides.count > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg bg-surface-tertiary px-[16px] py-[10px] mb-[8px]">
          <span className="text-[13px] text-text-body">
            {overrides.count} override{overrides.count !== 1 ? 's' : ''} pending
          </span>
          <div className="flex gap-[8px]">
            <button
              onClick={overrides.resetAll}
              className="h-[32px] rounded-full bg-surface-quaternary px-[16px] text-[12px] font-medium text-text-primary hover:bg-action-default-hover"
            >
              Reset all
            </button>
            {editable && (
              <button
                onClick={handleSaveAll}
                className="h-[32px] rounded-full bg-action-primary px-[16px] text-[12px] font-bold text-action-primary-text hover:bg-action-primary-hover"
              >
                Save all
              </button>
            )}
          </div>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg bg-halo-error px-[12px] py-[8px] text-[12px] text-error mb-[8px]">
          {saveError}
        </div>
      )}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.section)
        const overrideCount = group.tokens.filter((t) => overrides.has(t.name)).length

        return (
          <div key={group.section} className="rounded-lg bg-surface-secondary">
            <button
              className="flex w-full items-center justify-between px-[16px] py-[10px] text-left hover:bg-surface-tertiary rounded-lg"
              onClick={() => toggleSection(group.section)}
            >
              <span className="text-[13px] font-semibold text-text-primary capitalize">
                {group.section}
              </span>
              <div className="flex items-center gap-[8px]">
                {overrideCount > 0 && (
                  <span className="rounded-full bg-action-primary/20 px-[8px] py-[1px] text-[10px] font-medium text-action-primary">
                    {overrideCount}
                  </span>
                )}
                <span className="text-[11px] text-text-muted">
                  {group.tokens.length}
                </span>
                <span className="text-text-muted text-[14px]">
                  {isCollapsed ? '+' : '-'}
                </span>
              </div>
            </button>
            {!isCollapsed && (
              <div className="px-[16px] pb-[12px] space-y-[6px]">
                {group.tokens.map((token) => (
                  <TokenControl
                    key={token.name}
                    token={token}
                    overrides={overrides}
                    onSave={() => handleSave(token)}
                    saving={saving === token.name}
                    editable={editable}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="text-[10px] text-text-muted text-center pt-[8px]">
        File hash: {fileHash.slice(0, 8)} | {tokens.length} tokens
      </div>
    </div>
  )
}

// ── Individual token control ────────────────────────────────────────────

interface TokenControlProps {
  token: TokenInfo
  overrides: TokenOverrideStore
  onSave: () => void
  saving: boolean
  editable: boolean
}

function TokenControl({ token, overrides, onSave, saving, editable }: TokenControlProps) {
  const isOverridden = overrides.has(token.name)
  const displayValue = overrides.get(token.name) ?? token.value

  // Linked line-height: when a text-size token changes with keep-ratio,
  // find and update its paired --line-height token proportionally
  const isTextSize = token.category === 'text' && !token.name.endsWith('--line-height')
  const isLineHeight = token.name.endsWith('--line-height')

  // Skip standalone rendering of line-height tokens (they show inline with their size)
  if (isLineHeight) return null

  const handleChange = (newValue: string) => {
    overrides.set(token.name, newValue)

    // If this is a text-size token, update its paired line-height proportionally
    if (isTextSize) {
      const lhName = `${token.name}--line-height`
      const oldSize = parseFloat(token.value) || 1
      const newSize = parseFloat(newValue) || 1
      const ratio = newSize / oldSize
      // Get the line-height's current disk value from the token name
      const existingLh = overrides.get(lhName)
      if (!existingLh) {
        // Look up the original line-height from the DOM
        const computed = getComputedStyle(document.documentElement).getPropertyValue(lhName)
        if (computed) {
          const lhVal = parseFloat(computed)
          if (!isNaN(lhVal)) {
            overrides.set(lhName, `${Math.round(lhVal * ratio * 10) / 10}px`)
          }
        }
      }
    }
  }

  const shortName = token.name.replace(/^--(color-|radius-|shadow-|font-|text-|ease-|breakpoint-|z-)/, '')

  return (
    <div className="flex items-center gap-[8px] group">
      <div className="flex-1 min-w-0">
        {token.category === 'color' && (
          <ColorKnob label={shortName} value={displayValue} onChange={handleChange} />
        )}
        {(token.category === 'radius' || token.category === 'breakpoint') && (
          <PxKnob label={shortName} value={displayValue} onChange={handleChange} />
        )}
        {token.category === 'text' && (
          <PxKnob label={shortName} value={displayValue} onChange={handleChange} step={0.5} />
        )}
        {token.category === 'z' && (
          <NumberKnob label={shortName} value={displayValue} onChange={handleChange} min={-1} max={99999} />
        )}
        {token.category === 'font' && (
          <SelectKnob label={shortName} value={displayValue} onChange={handleChange} options={FONT_OPTIONS} />
        )}
        {(token.category === 'shadow' || token.category === 'ease') && (
          <TextKnob label={shortName} value={displayValue} onChange={handleChange} />
        )}
      </div>

      {/* Note badge */}
      {token.note && (
        <span className="text-[9px] text-text-muted italic max-w-[120px] truncate" title={token.note}>
          {token.note.includes('save only') ? 'save-only' : token.note.includes('not wired') ? 'not wired' : ''}
        </span>
      )}

      {/* Save / Reset buttons */}
      {isOverridden && (
        <div className="flex gap-[4px] opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => overrides.reset(token.name)}
            className="h-[24px] rounded bg-surface-quaternary px-[8px] text-[10px] text-text-muted hover:text-text-primary"
            title="Reset to disk value"
          >
            Reset
          </button>
          {editable && (
            <button
              onClick={onSave}
              disabled={saving}
              className="h-[24px] rounded bg-action-primary px-[8px] text-[10px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
              title="Save to theme.css"
            >
              {saving ? '...' : 'Save'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
