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
 * WHAT THE PAGE IS (redesign, 2026-11-27). Show, don't tell. The owner found
 * the old page "an overwhelm of information", so this one tells the whole story
 * in a few big, friendly lines and lets pictures of the product do the rest:
 *
 *   hero          one line, one button, and the hero video slot under them
 *   how it works  the loop as a timeline: plan, playtest, tune, build
 *   four beats    a headline, two or three lines and a small looping mock each
 *   card orbit    real card art turning around the live catalog count
 *   works with    the AI apps; the plan-by-plan comparison is on /connect
 *   promises      pay what you want, private, open source
 *   FAQ, closing
 *
 * Everything the old page said in full now lives one click away: the stage
 * deep dives, example questions, "give it a job" and the rest on /features
 * (routes/Features.tsx), the connect steps and the comparison chart on
 * /connect. Every word is in `landing/copy.ts` (`home`), which the
 * crawler-visible prerender also reads.
 *
 * MOTION. Only transform and opacity move, on the #410 motion tokens; loops
 * run only while on screen; reduced motion lands every demo on its finished
 * frame and stops the orbit.
 *
 * NOT ON THIS PAGE, ON PURPOSE: the card scanner, Deck-E, DeckPal credits, or
 * anything else that is not generally released.
 * ───────────────────────────────────────────────────────────────────────────── */
import { SkipLink } from '../components/SkipLink'
import { usePageMeta } from '../lib/seo'
import { COPY } from './landing/copy'
import { BuildBeat, PlanBeat, PlaytestBeat, TuneBeat } from './landing/home/Beats'
import { FairSection, WorksSection } from './landing/home/Closer'
import { HomeHero } from './landing/home/Hero'
import { HowItWorks } from './landing/home/HowItWorks'
import { OrbitSection } from './landing/home/Orbit'
import { Nav, useScrollReveal, useScrolledPast } from './landing/parts'
import { SiteFooter } from './landing/SiteFooter'
import { ClosingSection, FaqSection } from './landing/sections/Tail'
import './landing/landing.css'
import './landing/page.css'

export function Landing() {
  const scrolled = useScrolledPast(12)
  useScrollReveal()
  usePageMeta({ title: COPY.meta.title, description: COPY.meta.description, path: '/' })
  return (
    <div className="ls lp hm min-h-screen">
      <SkipLink />
      <Nav scrolled={scrolled} />
      <main id="main" tabIndex={-1}>
        <HomeHero />
        <HowItWorks />
        <PlanBeat />
        <PlaytestBeat />
        <TuneBeat />
        <BuildBeat />
        <OrbitSection />
        <WorksSection />
        <FairSection />
        <FaqSection plain />
        <ClosingSection />
      </main>
      <SiteFooter onLanding />
    </div>
  )
}
