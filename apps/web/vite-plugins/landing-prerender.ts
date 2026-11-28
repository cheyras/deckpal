/**
 * Landing prerender — build-only Vite plugin.
 *
 * Every route is a client-rendered React page, so the HTML a crawler gets
 * without running JavaScript (GPTBot, ClaudeBot, PerplexityBot, most link
 * fetchers) was only the boot skeleton: no headline, no text, no links. This
 * writes two real documents from the same copy the React pages render:
 *
 *   dist/landing.html   served for `/`
 *   dist/connect.html   served for `/connect`
 *   dist/features.html  served for `/features`
 *
 * Each is `index.html` with that page's words as semantic HTML inside `#root`,
 * plus its own title, description, canonical and og:url. The landing also
 * carries FAQPage JSON-LD. Every route's shell (`index.html`) gets the
 * WebApplication JSON-LD, which describes the whole site.
 *
 * The root `middleware.ts` (Vercel Routing Middleware) rewrites `/` and
 * `/connect` to these files. A vercel.json rewrite cannot: Vercel serves the
 * real `index.html` for `/` before it applies rewrites (checked on a preview,
 * 2026-10-04).
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
import { appJsonLd, faqJsonLd, renderConnectStatic, renderFeaturesStatic, renderLandingStatic, renderLlmsFull } from '../src/routes/landing/staticHtml'
import { COPY } from '../src/routes/landing/copy'
import { HERO_POSTER_SIZES, HERO_VIDEO } from '../src/routes/landing/heroVideo'

const ORIGIN = 'https://deckpal.app'

const VISUALLY_HIDDEN =
  '<style>#seo-landing,#seo-connect,#seo-features{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style>'

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Replace the content of one <meta> in the shell's head. Throws when the tag is missing, so a renamed tag cannot silently drop. */
function setMeta(html: string, key: 'name' | 'property', value: string, content: string): string {
  const re = new RegExp(`(<meta\\s+${key}="${value}"\\s+content=")[^"]*(")`)
  if (!re.test(html)) throw new Error(`landing-prerender: <meta ${key}="${value}"> not found in index.html`)
  // Function replacements throughout: the copy has dollar amounts, and `$'` in a replacement string is a pattern.
  return html.replace(re, (_m, a: string, b: string) => `${a}${attr(content)}${b}`)
}

type Page = {
  file: string
  path: string
  title: string
  description: string
  /** Social cards; default to the title and description. */
  ogTitle?: string
  ogDescription?: string
  body: string
  head?: string
}

function prerender(shell: string, page: Page): string {
  let html = shell
  const url = ORIGIN + page.path
  const ogTitle = page.ogTitle ?? page.title
  const ogDescription = page.ogDescription ?? page.description
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${attr(page.title)}</title>`)
  html = setMeta(html, 'name', 'description', page.description)
  html = setMeta(html, 'property', 'og:title', ogTitle)
  html = setMeta(html, 'property', 'og:description', ogDescription)
  html = setMeta(html, 'name', 'twitter:title', ogTitle)
  html = setMeta(html, 'name', 'twitter:description', ogDescription)
  const head = `<link rel="canonical" href="${url}" />\n<meta property="og:url" content="${url}" />\n${page.head ?? ''}${VISUALLY_HIDDEN}\n`
  html = html.replace('</head>', () => `${head}</head>`)
  // inside #root, after the boot skeleton: React replaces both on first commit
  const marker = '<div id="root">'
  if (!html.includes(marker)) throw new Error('landing-prerender: #root not found in index.html')
  return html.replace(marker, () => `${marker}${page.body}`)
}

/** Preload for the hero poster, AVIF (every browser the CSP and the build target support decodes it). */
export function posterPreload(): string {
  const { name, widths } = HERO_VIDEO.poster
  const set = widths.map((w) => `/marketing/landing/${name}-${w}.avif ${w}w`).join(', ')
  return `<link rel="preload" as="image" type="image/avif" imagesrcset="${set}" imagesizes="${HERO_POSTER_SIZES}" />`
}

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
      return html.replace('</head>', () => `${appJsonLd()}\n</head>`)
    },
    closeBundle() {
      const indexPath = join(outDir, 'index.html')
      if (!existsSync(indexPath)) throw new Error(`landing-prerender: no index.html in ${outDir}`)
      const shell = readFileSync(indexPath, 'utf8')
      const pages: Page[] = [
        {
          file: 'landing.html',
          path: '/',
          title: COPY.meta.title,
          description: COPY.meta.description,
          ogTitle: COPY.meta.ogTitle,
          ogDescription: COPY.meta.ogDescription,
          body: renderLandingStatic(),
          // The hero video slot's poster is the home page's LCP on a phone. React
          // draws it only once the route chunk has run, so without this hint the
          // browser would not ask for it until then; with it, the still downloads
          // alongside the scripts. Same srcset and sizes as HeroVideo's <picture>.
          // Measured 2026-11-27 on the throttled mobile profile: with it, LCP
          // 3.10 s and FCP 2.50 s; without it, LCP 3.31 s and FCP 2.32 s. LCP wins.
          head: `${faqJsonLd()}\n${posterPreload()}\n`,
        },
        {
          file: 'connect.html',
          path: '/connect',
          title: COPY.connectPage.metaTitle,
          description: COPY.connectPage.metaDescription,
          body: renderConnectStatic(),
        },
        {
          file: 'features.html',
          path: '/features',
          title: COPY.featuresPage.metaTitle,
          description: COPY.featuresPage.metaDescription,
          body: renderFeaturesStatic(),
        },
      ]
      for (const page of pages) writeFileSync(join(outDir, page.file), prerender(shell, page))

      writeFileSync(join(outDir, 'llms.txt'), `${COPY.seo.llmsTxt}\n`)
      writeFileSync(join(outDir, 'llms-full.txt'), `${renderLlmsFull()}\n`)
    },
  }
}
