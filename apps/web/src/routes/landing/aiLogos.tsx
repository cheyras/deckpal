/* The AI apps DeckPal works with, shown by their own logos.
 *
 * Every file under /brand/ai/ is that company's own file, shipped unmodified
 * from its brand kit (Gemini: from gemini.google.com itself); provenance and each
 * brand's usage rules are in apps/web/public/brand/README.md. Logos say what DeckPal works with; they are
 * never placed so they read as an endorsement.
 *
 * If a file is ever missing, the mark degrades to the app's name in DeckPal's own
 * type, so the page loses a picture rather than a fact. */
import { useState } from 'react'

export type AiId = 'claude' | 'chatgpt' | 'gemini' | 'grok' | 'perplexity' | 'mistral'

/** `fill`: how much of the file the mark itself occupies (measured), so files
 *  shipped with generous built-in clear space can be shown at the same optical
 *  size as the rest without cropping the file. */
type Mark = { src: string; w: number; h: number; fill?: number }
type Brand = {
  name: string
  /** The square product symbol, for table rows and buttons. */
  symbol?: Mark
  /** The full logo (symbol plus wordmark), for the "works with" strip. */
  lockup?: Mark
}

const B = '/brand/ai/'
// ChatGPT has no mark of its own (OpenAI ships only the Blossom and the
// "OpenAI" wordmark), and Gemini's kit sits behind Google's partner login, so
// both show their symbol beside the product name instead of a lockup.
export const AI_BRANDS: Record<AiId, Brand> = {
  claude: {
    name: 'Claude',
    symbol: { src: B + 'claude-symbol.svg', w: 94, h: 94 },
    lockup: { src: B + 'claude-lockup.svg', w: 9156, h: 2000 },
  },
  chatgpt: { name: 'ChatGPT', symbol: { src: B + 'chatgpt-symbol.svg', w: 716, h: 716, fill: 0.5 } },
  gemini: { name: 'Gemini', symbol: { src: B + 'gemini-symbol.png', w: 512, h: 512 } },
  grok: {
    name: 'Grok',
    symbol: { src: B + 'grok-symbol.svg', w: 1024, h: 1024 },
    lockup: { src: B + 'grok-lockup.svg', w: 1024, h: 400 },
  },
  perplexity: {
    name: 'Perplexity',
    symbol: { src: B + 'perplexity-symbol.svg', w: 172, h: 172, fill: 0.72 },
    lockup: { src: B + 'perplexity-lockup.svg', w: 626, h: 136 },
  },
  mistral: {
    name: 'Mistral',
    symbol: { src: B + 'mistral-symbol.svg', w: 162, h: 162 },
    lockup: { src: B + 'mistral-lockup.svg', w: 805, h: 182 },
  },
}

/** "Mistral (Vibe Work)" and friends to their id. */
export function aiIdFor(app: string): AiId | null {
  const k = app.split(' ')[0].toLowerCase()
  return k in AI_BRANDS ? (k as AiId) : null
}

/** The full logo where the kit has one, else symbol plus name. */
export function AiLockup({ id, height = 28 }: { id: AiId; height?: number }) {
  const b = AI_BRANDS[id]
  const [broken, setBroken] = useState(false)
  if (b.lockup && !broken) {
    return (
      <img
        className="lp-ai-lockup"
        src={b.lockup.src}
        alt={b.name}
        height={height}
        width={Math.round((height * b.lockup.w) / b.lockup.h)}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className="lp-ai-pair">
      <AiSymbol id={id} size={Math.round(height * 0.86)} decorative />
      <span>{b.name}</span>
    </span>
  )
}

/** The square symbol alone. `decorative` when the name is printed beside it. */
export function AiSymbol({ id, size = 20, decorative = false }: { id: AiId; size?: number; decorative?: boolean }) {
  const b = AI_BRANDS[id]
  const [broken, setBroken] = useState(false)
  if (!b.symbol || broken) return null
  // Draw the file larger by its clear space and let that margin overlap its
  // neighbours, so every mark reads at `size`.
  const box = Math.round(size / (b.symbol.fill ?? 1))
  const over = (box - size) / 2
  return (
    <img
      className="lp-ai-symbol"
      src={b.symbol.src}
      alt={decorative ? '' : b.name}
      width={Math.round((box * b.symbol.w) / b.symbol.h)}
      height={box}
      style={over ? { margin: `${-over}px` } : undefined}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}
