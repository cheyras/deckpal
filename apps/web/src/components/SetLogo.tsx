import { setAssetUrl } from './ui'
import { setLogoNeedsLightPlate } from '../lib/setLogoContrast'

/**
 * A set's logo, with a light plate behind it when the artwork needs one.
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
  alt = '',
  imgClassName,
  platedImgClassName,
  plateClassName = 'rounded-md px-[10px] py-[7px]',
  onError,
}: {
  setId: string
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
  const plated = setLogoNeedsLightPlate(setId)
  const img = (
    <img
      src={setAssetUrl(setId, 'logo')}
      alt={alt}
      className={`${(plated && platedImgClassName) || imgClassName} object-contain`}
      onError={onError ?? ((e) => (e.currentTarget.style.display = 'none'))}
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
