import { setAssetUrl } from './ui'
import { useArtSrc } from '../lib/useArtSrc'
import { setLogoNeedsLightPlate } from '../lib/setLogoContrast'
import { bundledSetLogo, templateSetLogo } from '../lib/releasedSetAssets'

/** A bundled public path, under whatever base the build is served from (/ or /deckpal/). */
function withBase(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

/**
 * A set's logo, with a light plate behind it when the artwork needs one.
 *
 * Sets with no official logo anywhere draw DeckPal's template logo
 * (`templateSetLogo`, `lib/releasedSetAssets.ts`) instead of the image tier,
 * unless the API's `logoUrl` says upstream has since published one of their own.
 * Pass `logoUrl` wherever the caller has it; without it the tier goes first.
 *
 * Most TCG set logos are drawn with a light stroke and read fine on our dark
 * surfaces. A minority are inked for white cardboard — black wordmarks, black
 * outlines, no light edge — and on #15181f/#282d38 those strokes are within a
 * few percent of the backdrop and simply vanish (issue #16: the Pokémon
 * Organized Play logo showed a Poké Ball and no words at all).
 *
 * Which logos those are is decided offline by scripts/set-logo-contrast.sh and
 * baked into a static id list, so this is a Set lookup per render and never an
 * image analysis. See setLogoContrast.ts.
 *
 * The plate deliberately uses the existing on-light surface tokens rather than
 * pure white: an off-white card with a hairline border reads as a deliberate
 * part of the design system, the way a logo sits on packaging, instead of as a
 * hole punched in the page.
 */
export function SetLogo({
  setId,
  logoUrl,
  alt = '',
  imgClassName,
  platedImgClassName,
  plateClassName = 'rounded-md px-[10px] py-[7px]',
  onError,
}: {
  setId: string
  /**
   * The API's `logoUrl` for this set (null when it reported none). Decides
   * whether a template logo outranks what the image tier would serve; leave it
   * out only where the caller genuinely does not have it.
   */
  logoUrl?: string | null
  alt?: string
  /** Sizing for the <img> itself — max-h/max-w, as at each call site. */
  imgClassName: string
  /**
   * Sizing to use instead when the plate is drawn. Call sites with a fixed-size
   * slot pass a slightly smaller box so the plate's padding still fits; the
   * unplated majority keep their original dimensions untouched.
   */
  platedImgClassName?: string
  plateClassName?: string
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void
}) {
  // A template logo, when it outranks the tier for this set. It is drawn for
  // our dark surfaces (outlined, shadowed), so it never takes the light plate
  // the placeholder it replaces may have needed — the generic PROMO star is on
  // the plate list.
  const template = templateSetLogo(setId, logoUrl)
  // Object URL first, image tier as the fallback — see lib/cardArt.ts. A series
  // page draws one of these per set, so they were one serverless hop each.
  // (Called unconditionally — it is a hook. It only computes a URL; nothing is
  // requested unless an <img> below is given it.)
  const art = useArtSrc(setAssetUrl(setId, 'logo'))

  if (template) {
    return (
      <img
        key="template"
        src={withBase(template)}
        alt={alt}
        className={`${imgClassName} object-contain`}
        onError={(e) => {
          if (onError) onError(e)
          else e.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  // Sets whose upstream logo is absent but a bundled asset exists (e.g. the
  // 30th Celebration logo carried over from the upcoming-set placeholder, or a
  // template logo that has stepped aside for a new upstream one). Used as a
  // final fallback after the image tier exhausts its sources.
  const bundled = bundledSetLogo(setId)

  // Resolve the effective src: image-tier sources first, then the bundled
  // fallback (BASE_URL-prefixed so it works under both / and /deckpal/).
  const effectiveSrc = art.src ?? (bundled ? withBase(bundled) : null)
  const usingBundled = art.failed && bundled != null
  // The plate list describes what the TIER serves for a set; a bundled logo is
  // judged on its own (none of them needs a plate).
  const plated = !usingBundled && setLogoNeedsLightPlate(setId)

  const img = (
    <img
      key={usingBundled ? 'bundled' : art.step}
      src={effectiveSrc ?? undefined}
      {...(!usingBundled && art.crossOrigin ? { crossOrigin: art.crossOrigin } : {})}
      alt={alt}
      className={`${(plated && platedImgClassName) || imgClassName} object-contain`}
      onError={(e) => {
        // Not exhausted yet: step to the next source and let it try.
        if (!art.failed && art.step === 0) {
          art.onError()
          return
        }
        // Bundled fallback is active — if IT fails, fall through to the
        // caller's handler or hide the element.
        if (usingBundled) {
          if (onError) onError(e)
          else e.currentTarget.style.display = 'none'
          return
        }
        // Image tier not yet exhausted and there is a bundled fallback —
        // advance past the tier so the next render picks up effectiveSrc.
        if (!art.failed && bundled != null) {
          art.onError()
          return
        }
        // Genuinely unavailable — hand it to the caller, or hide it.
        if (onError) onError(e)
        else e.currentTarget.style.display = 'none'
      }}
    />
  )

  if (!plated) return img

  return (
    <span
      className={`inline-flex items-center justify-center border border-surface-on-light-border bg-surface-on-light ${plateClassName}`}
    >
      {img}
    </span>
  )
}
