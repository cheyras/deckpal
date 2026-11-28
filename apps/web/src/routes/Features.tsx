/* ─────────────────────────────────────────────────────────────────────────────
 * /features: how DeckPal works, in full.
 *
 * Everything the home page used to say at length, moved here intact when the
 * home page was cut down to its story (redesign, 2026-11-27): the loop diagram,
 * the four stage deep dives with their working demos (draw an opening hand,
 * parse a log, price the missing cards), the example conversation, "ask it
 * anything", "give it a job", the "and more" carousel and the open-source facts.
 * The connect steps and the AI-app comparison chart are on /connect.
 *
 * Chrome-free and public (lib/landingRoute.ts), like /connect: it is read by
 * people with no account. Cloud-only like the landing. Every word is in
 * landing/copy.ts, and `renderFeaturesStatic` writes the crawler copy from it.
 * ───────────────────────────────────────────────────────────────────────────── */
import { SkipLink } from '../components/SkipLink'
import { usePageMeta } from '../lib/seo'
import { COPY } from './landing/copy'
import { Nav, PrimaryCta, useScrollReveal, useScrolledPast } from './landing/parts'
import { SiteFooter } from './landing/SiteFooter'
import { AskSection } from './landing/sections/Ask'
import { HeroPhone } from './landing/sections/Hero'
import { JobsSection } from './landing/sections/Jobs'
import { LoopSection, StageBar } from './landing/sections/Loop'
import { MoreSection } from './landing/sections/More'
import { BuildSection, PlanSection, PlaytestSection, TuneSection } from './landing/sections/Stages'
import { ClosingSection, FounderSection } from './landing/sections/Tail'
import './landing/landing.css'
import './landing/page.css'

export function Features() {
  const p = COPY.featuresPage
  const scrolled = useScrolledPast(12)
  useScrollReveal()
  usePageMeta({ title: p.metaTitle, description: p.metaDescription, path: '/features' })
  return (
    <div className="ls lp min-h-screen">
      <SkipLink />
      <Nav scrolled={scrolled} links={p.links} home={false} />
      <StageBar />
      <main id="main" tabIndex={-1}>
        <header className="lp-sec lp-features-intro" id="top" aria-labelledby="features-title">
          <div className="ls-wrap lp-features-grid">
            <div>
              <h1 className="lp-h2" id="features-title">
                {p.title}
              </h1>
              <p className="lp-lede">{p.lead}</p>
              <div className="lp-cta-row">
                <PrimaryCta>{COPY.nav.cta}</PrimaryCta>
              </div>
            </div>
            <HeroPhone />
          </div>
        </header>
        <LoopSection />
        <PlanSection />
        <PlaytestSection />
        <TuneSection />
        <BuildSection />
        <AskSection />
        <JobsSection />
        <MoreSection />
        <FounderSection />
        <ClosingSection />
      </main>
      <SiteFooter aiLogos />
    </div>
  )
}
