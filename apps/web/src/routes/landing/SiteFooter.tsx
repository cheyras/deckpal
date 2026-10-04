/* ─────────────────────────────────────────────────────────────────────────────
 * The public site's footer — the landing page's, shared with /privacy.
 *
 * It lived inside Landing.tsx until the privacy page needed the same one: two
 * copies of a footer are two places for a link to go missing from. Everything
 * here is static markup, so importing it costs a page nothing it would not
 * already pay for the landing's own stylesheet.
 *
 * `onLanding` switches on the two things that are only true ON the landing:
 * the FAQ row (an in-page anchor — anywhere else it would point at a section
 * that is not there, so it is left out rather than linked to nothing) and the
 * sentence about the page's interface illustrations (no other page has any).
 * ───────────────────────────────────────────────────────────────────────────── */
import { Link } from '@tanstack/react-router'
import { BrandLogo } from '../../components/Icon'

export const REPO = 'https://github.com/cheyras/deckpal'
const WIKI = `${REPO}/wiki`
const LICENSE = `${REPO}/blob/main/LICENSE`

const LINK = 'inline-block py-[12px] text-text-body hover:text-link'

/** `aiLogos`: the page shows other companies' AI logos, so it says it is not affiliated with them. */
export function SiteFooter({ onLanding = false, aiLogos = onLanding }: { onLanding?: boolean; aiLogos?: boolean }) {
  return (
    <footer className="border-t border-border-default bg-surface-footer">
      <div className="ls-wrap py-[48px]">
        <div className="flex flex-col gap-[32px] md:flex-row md:justify-between">
          <div className="max-w-[320px]">
            <span className="flex items-center">
              <BrandLogo height={26} />
            </span>
            <p className="mt-[12px] text-[14px] leading-[1.6] text-text-muted">
              An open-source Pokémon TCG collection tracker. Track, build, and master your collection.
            </p>
          </div>

          <div className="flex gap-[48px]">
            <div>
              <h2 className="mb-[8px] text-[12px] font-bold uppercase tracking-[0.1em] text-text-secondary">
                Product
              </h2>
              <ul className="flex flex-col text-[14px] leading-[20px]">
                <li>
                  <Link to="/auth" search={{ mode: 'signup' as const }} className={LINK}>
                    Create account
                  </Link>
                </li>
                <li>
                  <Link to="/auth" className={LINK}>
                    Sign in
                  </Link>
                </li>
                {onLanding && (
                  <li>
                    <a href="#faq" className={LINK}>
                      FAQ
                    </a>
                  </li>
                )}
                <li>
                  <Link to="/privacy" className={LINK}>
                    Privacy
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="mb-[8px] text-[12px] font-bold uppercase tracking-[0.1em] text-text-secondary">
                Open source
              </h2>
              <ul className="flex flex-col text-[14px] leading-[20px]">
                <li>
                  <a href={REPO} target="_blank" rel="noreferrer" className={LINK}>
                    GitHub
                  </a>
                </li>
                <li>
                  <a href={WIKI} target="_blank" rel="noreferrer" className={LINK}>
                    Wiki
                  </a>
                </li>
                <li>
                  <a href={LICENSE} target="_blank" rel="noreferrer" className={LINK}>
                    License (AGPL-3.0)
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-[32px] border-t border-border-default pt-[24px] text-[12px] leading-[1.6] text-text-muted">
          DeckPal is an independent, fan-made project. Pokémon and all related names are trademarks of
          Nintendo, Creatures Inc. and GAME FREAK inc. DeckPal is not affiliated with, endorsed or sponsored
          by them.
          {aiLogos &&
            ' DeckPal is not affiliated with or endorsed by Anthropic, OpenAI, Google, xAI, Perplexity, Mistral or TCGplayer; their product names and logos belong to them and appear only to say what DeckPal works with.'}
          {onLanding &&
            ' The photographs on this page are generated scenes with real card images added. Interface pictures are simplified recreations of the product.'}
        </p>
      </div>
    </footer>
  )
}
