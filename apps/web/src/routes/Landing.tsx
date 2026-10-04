/* ─────────────────────────────────────────────────────────────────────────────
 * Landing: the public marketing page at `/` for logged-OUT visitors.
 *
 * Rendered chrome-free: main.tsx routes `/` here only when Supabase is
 * configured AND there is no session (see indexRoute.beforeLoad), and both
 * RootComponent and AppShell treat it as a public path, so AuthGuard never runs
 * and none of the app's authenticated queries ever mount. That matters: those
 * firing while signed out is what caused the 401 → location.assign → reload loop
 * that api.ts's handle401 guard was added for.
 *
 * WHAT THE PAGE IS. One night at a league table, told as the loop a player runs
 * with their own AI: plan, playtest, tune, build. Every word is in
 * `landing/copy.ts`, which the crawler-visible prerender also reads.
 *
 * HOW IT IS BUILT. Full-width sections, each a split of copy and one visual: a
 * photograph from the same league night (tools/landing-photos: generated scenes
 * with real card art composited in) carrying a small, working piece of the
 * product. One signature motion (the loop marker) plus product demos (the hero
 * chat, the opening hand, the log parse, the approve button); everything else is
 * a hover or a reveal. Reduced motion lands every demo in its finished state.
 *
 * NOT ON THIS PAGE, ON PURPOSE: the card scanner, Deck-E, DeckPal credits, or
 * anything else that is not generally released.
 * ───────────────────────────────────────────────────────────────────────────── */
import { SkipLink } from '../components/SkipLink'
import { Nav, useScrollReveal, useScrollY } from './landing/parts'
import { SiteFooter } from './landing/SiteFooter'
import { AskSection } from './landing/sections/Ask'
import { Hero } from './landing/sections/Hero'
import { JobsSection } from './landing/sections/Jobs'
import { LoopSection, StageBar, WorksWith } from './landing/sections/Loop'
import { MoreSection } from './landing/sections/More'
import { BuildSection, PlanSection, PlaytestSection, TuneSection } from './landing/sections/Stages'
import { ClosingSection, ConnectSection, FaqSection, FounderSection } from './landing/sections/Tail'
import './landing/landing.css'
import './landing/page.css'

export function Landing() {
  const scrollY = useScrollY()
  useScrollReveal()
  return (
    <div className="ls lp min-h-screen">
      <SkipLink />
      <Nav scrolled={scrollY > 12} />
      <StageBar />
      <main id="main" tabIndex={-1}>
        <Hero />
        <WorksWith />
        <LoopSection />
        <PlanSection />
        <PlaytestSection />
        <TuneSection />
        <BuildSection />
        <AskSection />
        <JobsSection />
        <MoreSection />
        <FounderSection />
        <ConnectSection />
        <FaqSection />
        <ClosingSection />
      </main>
      <SiteFooter onLanding />
    </div>
  )
}
