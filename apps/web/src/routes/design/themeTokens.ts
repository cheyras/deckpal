/**
 * theme.css token parsing — shared by the Vite dev-server plugin
 * (vite-plugins/design-editor.ts) and the /design route's read-only fallback.
 *
 * The plugin parses the file it is about to WRITE; the route parses the same
 * source imported as text (`theme.css?raw`) when the dev endpoints are absent
 * (production). One parser, so the two views can never disagree about what a
 * token is.
 *
 * Pure functions only — this module must run in both Node and the browser.
 */

export type TokenCategory =
  | 'color'
  | 'radius'
  | 'shadow'
  | 'font'
  | 'text'
  | 'ease'
  | 'breakpoint'
  | 'z'

export interface TokenInfo {
  name: string
  value: string
  category: TokenCategory
  section: string
  block: 'theme' | 'root'
  livePreviewable: boolean
  note?: string
}

export function categorize(name: string, block: 'theme' | 'root'): TokenCategory {
  // :root holds two families: z-index layers and the variant gradient fills.
  // Gradients take the permissive free-text treatment (they are full
  // linear-gradient() expressions consumed via var(), so they DO live-preview).
  if (block === 'root') return name.startsWith('--z-') ? 'z' : 'ease'
  if (name.startsWith('--color-')) return 'color'
  if (name.startsWith('--radius-')) return 'radius'
  if (name.startsWith('--shadow-')) return 'shadow'
  if (name.startsWith('--font-')) return 'font'
  if (name.startsWith('--text-')) return 'text'
  if (name.startsWith('--ease-')) return 'ease'
  if (name.startsWith('--breakpoint-')) return 'breakpoint'
  return 'color' // fallback — should not happen with well-formed theme.css
}

export function isLivePreviewable(cat: TokenCategory): boolean {
  // Breakpoints compile to @media literals — save-then-HMR only. Shadows use
  // inlined values in Tailwind's --tw-shadow variable, not var(--shadow-*).
  // z tokens became live-previewable when C11a converted call sites to
  // z-(--z-*) var-syntax utilities.
  if (cat === 'breakpoint') return false
  // Colors, radii, text, font, ease, z all resolve through var() references
  return true
}

export function noteFor(cat: TokenCategory, name: string): string | undefined {
  if (cat === 'breakpoint') return 'Applies on save only (media queries use literal values)'
  if (cat === 'shadow') return 'Save-then-HMR (Tailwind inlines shadow values into --tw-shadow)'
  if (name.endsWith('--line-height')) return 'Paired with its size token'
  return undefined
}

/**
 * Parse theme.css into TokenInfo[].
 *
 * The file has two blocks:
 *   @theme static { ... }   — Tailwind tokens
 *   :root { ... }           — gradient fills and z-index layers
 *
 * Within each block, declarations match:
 *   --name: value;          (with optional trailing comments)
 * Section headers are:
 *   /* ── section ── * /
 */
export function parseThemeCss(content: string): TokenInfo[] {
  const tokens: TokenInfo[] = []
  const lines = content.split('\n')

  let currentBlock: 'theme' | 'root' | null = null
  let currentSection = 'uncategorized'
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect section headers: /* ── section ── */
    // The closing */ may sit on a later line (several headers carry multi-line
    // prose after the ── rule), so only the opening /* ── name ── is required.
    const sectionMatch = trimmed.match(/^\/\*\s*──\s*(.+?)\s*──/)
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim()
      continue
    }

    // Detect block starts
    if (trimmed.startsWith('@theme')) {
      currentBlock = 'theme'
      if (trimmed.includes('{')) braceDepth++
      continue
    }
    if (trimmed === ':root {' || trimmed.startsWith(':root {')) {
      currentBlock = 'root'
      braceDepth++
      continue
    }

    // Track braces
    if (trimmed === '{') {
      braceDepth++
      continue
    }
    if (trimmed === '}') {
      braceDepth--
      if (braceDepth <= 0) {
        currentBlock = null
        braceDepth = 0
      }
      continue
    }

    if (!currentBlock) continue

    // Parse declarations: --name: value; /* optional comment */
    const declMatch = trimmed.match(/^(--[a-z0-9-]+(?:--[a-z-]+)?):\s*(.+?)\s*;(.*)$/)
    if (declMatch) {
      const [, name, value] = declMatch
      const cat = categorize(name, currentBlock)
      tokens.push({
        name,
        value,
        category: cat,
        section: currentSection,
        block: currentBlock,
        livePreviewable: isLivePreviewable(cat),
        note: noteFor(cat, name),
      })
    }
  }

  return tokens
}
