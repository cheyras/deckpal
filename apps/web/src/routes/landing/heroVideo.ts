/* ─────────────────────────────────────────────────────────────────────────────
 * The home page's hero video: THE ONE PLACE TO POINT AT THE FINAL FILE.
 *
 * The film is being made separately and ships only once the owner has approved
 * it. Until then `sources` is empty and the slot shows its poster, a still the
 * same shape as the film, so swapping the film in moves nothing on the page.
 *
 * TO PLUG IN THE FINAL VIDEO
 *   1. Encode a 16:9 cut, silent (it autoplays muted), about 1920x1080:
 *        hero.webm  VP9 or AV1, the smaller file, listed first
 *        hero.mp4   H.264 High, +faststart, for Safari
 *      plus a poster still from the film's first frame at 1600x900 as WebP
 *      and AVIF, so the poster and frame one match and the swap is invisible.
 *   2. Put them in apps/web/public/marketing/landing/ (same origin: the CSP's
 *      media-src is 'self' blob:, so a video on another host would be blocked
 *      until vercel.json changes, which needs the maintainer, AGENTS.md B9).
 *   3. Fill `sources` (and `poster`, if it is a new still) below. Optional:
 *      `captions` for a WebVTT track if the film has words on screen.
 *
 * WHAT THE SLOT DOES WITH IT (HeroVideo in landing/home/Hero.tsx)
 *   - The poster paints first and is the page's LCP; the video is attached
 *     only after the page has loaded and gone idle, so it never competes with
 *     first paint (preload="none" until then).
 *   - Muted, inline, looping autoplay, but only while on screen: it pauses
 *     when scrolled away, and a visible pause button stops it (WCAG 2.2.2).
 *   - Reduced motion: no autoplay; the poster stays, with a play button.
 *   - Save-Data or a 2G connection: no video at all, just the poster.
 *   - No video configured, or the file fails: the poster, no play button.
 *   - The film is never precached by the service worker (vite.config.ts
 *     precaches js/css/html/woff2/svg/png only), so it costs only the visitors
 *     who actually watch the home page.
 * ───────────────────────────────────────────────────────────────────────────── */

export type HeroVideoSource = { src: string; type: 'video/webm' | 'video/mp4' }

export type HeroVideoConfig = {
  /** Best first. Empty means "no film yet": the slot renders its poster only. */
  sources: readonly HeroVideoSource[]
  /** The still shown before (and instead of) the film. Path stem under /marketing/landing, widths encoded. */
  poster: { name: 'hero'; widths: readonly number[] }
  /** Optional WebVTT captions, same origin. */
  captions?: string
}

/** The poster's `sizes`, shared with the prerender's preload hint so the two pick the same file. */
export const HERO_POSTER_SIZES = '(min-width: 1100px) 1040px, 100vw'

export const HERO_VIDEO: HeroVideoConfig = {
  sources: [],
  // e.g. once approved:
  // sources: [
  //   { src: '/marketing/landing/hero.webm', type: 'video/webm' },
  //   { src: '/marketing/landing/hero.mp4', type: 'video/mp4' },
  // ],
  poster: { name: 'hero', widths: [2560, 1600, 960] },
}
