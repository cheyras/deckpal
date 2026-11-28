import { useState } from 'react'
import { setAssetUrl } from './ui'
import { PrintedSetMark } from './PrintedSetMark'
import { useArtSrc } from '../lib/useArtSrc'
import { printedSetCode } from '../lib/printedSetCode'

// The set-symbol tile. It lived in ui.tsx until 2026-11-27 and moved here so the
// printed-mark outlines it draws with ride in the chunks of the pages that show
// a set, not in the entry every visitor downloads (scripts/check-critical-path.mjs).
// Import it from this file; ui.tsx deliberately does not re-export it.

// --- Set-symbol fallbacks ----------------------------------------------------
// Some sets legitimately have no warmed symbol (49 of 218) — and a few families
// (Black Star Promos, McDonald's Collection) either have no symbol or a generic
// one that doesn't convey what the set is. For those we render a small authored
// mark; for everything else we derive a readable acronym tag from the set
// code/id (e.g. `mep`→MEP, `swsh12.5gg`→GG) — never a bare ◆.

// Sets from Scarlet & Violet on print a CODE as their mark (MEG, PBL, SVE, MEE);
// those tiles draw it the way the card prints it, as vector — see
// lib/printedSetCode.ts for which sets and why (low-res rasters, the "M.EG"
// smudge), and ./printedMark.ts for what the printed mark looks like.

// Black Star Promo set ids across every series (name also carries "Black Star Promos").
const BLACK_STAR_PROMO_IDS = new Set([
  'basep', 'bwp', 'dpp', 'hgssp', 'mep', 'np', 'smp', 'svp', 'swshp', 'xyp',
])

type SetMark = 'promo' | null

// Classify a set into a special-mark family from its id and/or name. Works from
// the id alone (so callers that don't pass a name — e.g. CardDetail — still get
// the right mark); the name is a secondary signal for robustness.
//
// There used to be an 'energy' family that drew a 3×2 cluster of energy-type
// icons for `sve` / `mee` and any set named "… Energy". Removed 2026-11-27: those
// sets print a code (SVE, MEE) like every other modern set, and the owner asked
// for it — the cluster was the one tile on a series page that did not say which
// set it was. They are in lib/printedSetCode.ts; the catalog has no other
// energy set, and a future one falls through to its symbol or a derived tag.
//
// There is deliberately no McDonald's branch (issue #15). The mark below is
// original artwork standing in for a *Pokémon TCG* family that has no per-set
// symbol upstream. A McDonald's branch instead reproduced a third-party corporate
// trademark (the Golden Arches) as app chrome — the same exposure the Poké Ball /
// POKÉMON wordmark icons were replaced for (DECISIONS.md 2026-08-09). Those sets
// now use the ordinary ladder: the real TCGdex set symbol where one is published
// (2021swsh), else the derived tag below.
function setMarkKind(setId?: string | null, name?: string | null): SetMark {
  const id = (setId ?? '').toLowerCase()
  const nm = name ?? ''
  if (BLACK_STAR_PROMO_IDS.has(id) || /black star promos?/i.test(nm)) return 'promo'
  return null
}

// Derive a short, readable acronym tag from a set's code/id (falling back to its
// name). Purpose-built for the tile — keeps it to a few uppercase chars so it fits.
function deriveSetTag(setId?: string | null, name?: string | null): string {
  const raw = (setId ?? '').trim()
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '')
  // Short clean codes (mep, mee, svp, rc, np, A3, B1a, P-A, me02…) read best as-is.
  if (compact.length > 0 && compact.length <= 4) return compact.toUpperCase()
  // Year-bucketed sets (the McDonald's Collection: 2011bw … 2024sv) are known by
  // their year, not their era suffix. Without this the name-initials branch below
  // produced "MS2" for "McDonald's Collection 2021" (issue #15).
  const year = raw.match(/^(20\d{2})/)
  if (year) return year[1]!
  // Trailing letter suffix after a digit → Galarian/Trainer Gallery, Shiny Vault,
  // Classic Collection (swsh12.5gg→GG, swsh10.5tg→TG, cel25cc→CC, swsh4.5sv→SV).
  const suffix = raw.match(/\d([a-zA-Z]{2,3})$/)
  if (suffix) return suffix[1].toUpperCase()
  // Otherwise initials from the set name, skipping filler words.
  if (name) {
    const words = name
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !/^(the|of|and|a|an|set|collection|promos?|trainer|classic|pack|cards?|kit)$/i.test(w))
    if (words.length >= 2) return words.slice(0, 4).map((w) => w[0]).join('').toUpperCase()
  }
  // Last resort: leading letter prefix, else the compacted head.
  const prefix = raw.match(/^([a-zA-Z]{1,4})/)
  if (prefix) return prefix[1].toUpperCase()
  return compact.slice(0, 4).toUpperCase() || '?'
}

// Authored mark: the black star with "PROMO" beneath, white-outlined — the icon
// printed on every Black Star Promo card. Reads as a plain black star on the
// white tile (the white outline is for dark backgrounds).
function PromoStarMark({ size }: { size: number }) {
  return (
    <svg width={size * 0.86} height={size * 0.86} viewBox="0 0 24 26" role="img" aria-label="Black Star Promo">
      <title>Black Star Promo</title>
      <path
        d="M12 1.5 L15 8.3 L22.4 9 L16.9 14 L18.5 21.2 L12 17.4 L5.5 21.2 L7.1 14 L1.6 9 L9 8.3 Z"
        fill="#111318"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="24.6"
        textAnchor="middle"
        fontSize="5.4"
        fontWeight="800"
        letterSpacing="0.2"
        fill="#111318"
        stroke="#ffffff"
        strokeWidth="0.35"
        paintOrder="stroke"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        PROMO
      </text>
    </svg>
  )
}

/**
 * The printed plate is drawn at half the tile's height (36 → 18px, 48 → 24px),
 * which leaves the 1.75 : 1 plate a few pixels of tile either side. With a
 * regulation box the tile widens instead, so the plate can take more of the
 * height: on the card sheet's 28px tile that is a 17px plate, not 14.
 */
export const PRINTED_PLATE_RATIO = 0.5
const PRINTED_PLATE_RATIO_WIDE = 0.6

// White rounded set-symbol tile (UI-SPEC §3.7). A set whose mark is its printed
// code gets that code drawn as the card prints it (PrintedSetMark); otherwise
// the symbol is served from the image tier by set id. When a set belongs to a
// special family (Black Star Promo) and has no symbol we render an authored
// mark; when it has no warmed symbol (or the fetch fails) we render a derived
// acronym tag — never a bare ◆, no broken image, no layout shift. `name` is
// optional & backward-compatible.
//
// `regulationMark` is for a CARD's view only (the card sheet): it adds the
// card's own regulation box beside the plate, the way that card prints it, and
// the tile widens to hold it. A set has no single regulation mark — sv07 prints
// G and H — so set-level tiles never pass one. It is ignored for sets whose mark
// is a symbol (those cards print the regulation mark elsewhere on the card).
export function SetSymbolTile({
  setId,
  name,
  size = 40,
  regulationMark,
}: {
  setId?: string | null
  name?: string | null
  size?: number
  regulationMark?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const mark = setMarkKind(setId, name)
  const code = printedSetCode(setId)
  if (code) {
    const reg = regulationMark?.trim().toUpperCase() || null
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg bg-surface-on-light"
        // Square like every other tile; with a regulation box, as wide as the
        // print line needs (max-content, so a block parent cannot stretch it).
        style={{
          height: size,
          width: reg ? 'max-content' : size,
          minWidth: size,
          paddingInline: reg ? Math.round(size * 0.2) : 0,
        }}
      >
        <PrintedSetMark
          code={code}
          height={Math.round(size * (reg ? PRINTED_PLATE_RATIO_WIDE : PRINTED_PLATE_RATIO))}
          regulationMark={reg}
          label={reg ? `${code}, regulation mark ${reg}` : undefined}
        />
      </div>
    )
  }
  // `hasSymbol` (Boolean(set.symbolUrl)) used to gate the image attempt, but the
  // catalog column is NULL for exactly the sets the fallback crosswalk now
  // sources, so the tile would never ask for an asset that exists. Attempt the
  // image for every set without a printed code and let the image-tier ladder
  // degrade: object URL → /deckpal/images → the authored mark (promo) or the
  // derived tag. A set that HAS a real symbol prefers it; the authored mark is the
  // promo fallback when the image ladder exhausts (no real symbol), not the
  // derived tag.
  const showImg = Boolean(setId && !failed)
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-on-light"
      style={{ width: size, height: size }}
    >
      {showImg ? (
        <SetSymbolImg setId={setId!} onExhausted={() => setFailed(true)} />
      ) : mark === 'promo' ? (
        <PromoStarMark size={size} />
      ) : (
        <span
          className="font-black leading-none text-surface-on-light-text"
          style={{ fontSize: size * (deriveSetTag(setId, name).length >= 4 ? 0.3 : 0.4) }}
        >
          {deriveSetTag(setId, name)}
        </span>
      )}
    </div>
  )
}

/**
 * The symbol image itself, split out so it can own the source ladder from
 * lib/cardArt.ts (object URL first, image tier as fallback) with its own hook.
 * `onExhausted` fires only once BOTH have failed, which is when the tile above
 * switches to the derived acronym tag.
 */
function SetSymbolImg({ setId, onExhausted }: { setId: string; onExhausted: () => void }) {
  const art = useArtSrc(setAssetUrl(setId, 'symbol'))
  if (!art.src) {
    // Both sources gone; the parent has been told and is about to re-render.
    return null
  }
  return (
    <img
      key={art.step}
      src={art.src}
      {...(art.crossOrigin ? { crossOrigin: art.crossOrigin } : {})}
      alt=""
      className="h-[70%] w-[70%] object-contain"
      onError={() => {
        if (art.step === 0) art.onError()
        else onExhausted()
      }}
    />
  )
}
