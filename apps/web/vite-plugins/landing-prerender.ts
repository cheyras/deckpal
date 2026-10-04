/**
 * Landing prerender — build-only Vite plugin.
 *
 * `/` is a client-rendered React route, so the HTML a crawler gets without
 * running JavaScript (GPTBot, ClaudeBot, PerplexityBot, most link fetchers) was
 * only the boot skeleton: no headline, no text, no links. This writes
 * `dist/landing.html` — `index.html` with the landing copy as semantic HTML
 * inside `#root`, the landing's own canonical / og:url, and FAQPage JSON-LD.
 * Every route's shell (`index.html`) gets the WebApplication JSON-LD, which
 * describes the whole site.
 *
 * NOT SERVED FOR `/` YET. A vercel.json rewrite from `/` to `/landing.html` was
 * checked on a preview (2026-10-04) and never fired: Vercel serves a real file
 * before it applies rewrites, and `index.html` answers `/`. Serving it needs
 * Routing Middleware for `/`, or the landing emitted as `index.html` with the
 * shell renamed. Both change how Vercel serves the site, so both wait for the
 * maintainer (AGENTS.md B9). See the 2026-10-03 decision.
 *
 * It also writes `llms.txt` and `llms-full.txt` from the same copy, so what an
 * assistant reads about DeckPal cannot drift from what the page says.
 *
 * NO NEW INLINE SCRIPTS: JSON-LD is a data block, not executed, so the CSP's
 * script-src hashes in vercel.json are untouched. React replaces the static block
 * on first commit (createRoot), so there is no hydration to get wrong.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { appJsonLd, faqJsonLd, renderLandingStatic, renderLlmsFull } from '../src/routes/landing/staticHtml'
import { COPY } from '../src/routes/landing/copy'

const ORIGIN = 'https://deckpal.app'

const VISUALLY_HIDDEN =
  '<style>#seo-landing{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style>'

export function landingPrerender(): Plugin {
  let outDir = 'dist'
  return {
    name: 'deckpal-landing-prerender',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir)
    },
    // Before the HTML is emitted, so the service worker's precache revision covers it.
    transformIndexHtml(html) {
      // Function replacements throughout: the copy has dollar amounts, and `$'` in a replacement string is a pattern.
      return html.replace('</head>', () => `${appJsonLd()}\n</head>`)
    },
    closeBundle() {
      const indexPath = join(outDir, 'index.html')
      if (!existsSync(indexPath)) throw new Error(`landing-prerender: no index.html in ${outDir}`)
      let html = readFileSync(indexPath, 'utf8')

      const canonical = `<link rel="canonical" href="${ORIGIN}/" />\n<meta property="og:url" content="${ORIGIN}/" />\n`
      html = html.replace('</head>', () => `${canonical}${faqJsonLd()}\n${VISUALLY_HIDDEN}\n</head>`)
      // inside #root, after the boot skeleton: React replaces both on first commit
      const marker = '<div id="root">'
      if (!html.includes(marker)) throw new Error('landing-prerender: #root not found in index.html')
      html = html.replace(marker, () => `${marker}${renderLandingStatic()}`)
      html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${COPY.meta.title}</title>`)
      writeFileSync(join(outDir, 'landing.html'), html)

      writeFileSync(join(outDir, 'llms.txt'), `${COPY.seo.llmsTxt}\n`)
      writeFileSync(join(outDir, 'llms-full.txt'), `${renderLlmsFull()}\n`)
    },
  }
}
