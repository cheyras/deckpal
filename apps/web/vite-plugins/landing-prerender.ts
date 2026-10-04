/**
 * Landing prerender — build-only Vite plugin.
 *
 * `/` is a client-rendered React route, so the HTML a crawler gets without
 * running JavaScript (GPTBot, ClaudeBot, PerplexityBot, most link fetchers) was
 * only the boot skeleton: no headline, no text, no links. This writes
 * `dist/landing.html` — `index.html` with the landing copy as semantic HTML
 * inside `#root`, the landing's own canonical / og:url, and WebApplication +
 * FAQPage JSON-LD — which vercel.json serves for `/` only. Every other route keeps
 * the plain shell.
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
import { landingJsonLd, renderLandingStatic, renderLlmsFull } from '../src/routes/landing/staticHtml'
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
    closeBundle() {
      const indexPath = join(outDir, 'index.html')
      if (!existsSync(indexPath)) throw new Error(`landing-prerender: no index.html in ${outDir}`)
      let html = readFileSync(indexPath, 'utf8')

      const canonical = `<link rel="canonical" href="${ORIGIN}/" />\n<meta property="og:url" content="${ORIGIN}/" />\n`
      html = html.replace('</head>', `${canonical}${landingJsonLd()}\n${VISUALLY_HIDDEN}\n</head>`)
      // inside #root, after the boot skeleton: React replaces both on first commit
      const marker = '<div id="root">'
      if (!html.includes(marker)) throw new Error('landing-prerender: #root not found in index.html')
      html = html.replace(marker, `${marker}${renderLandingStatic()}`)
      html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${COPY.meta.title}</title>`)
      writeFileSync(join(outDir, 'landing.html'), html)

      writeFileSync(join(outDir, 'llms.txt'), `${COPY.seo.llmsTxt}\n`)
      writeFileSync(join(outDir, 'llms-full.txt'), `${renderLlmsFull()}\n`)
    },
  }
}
