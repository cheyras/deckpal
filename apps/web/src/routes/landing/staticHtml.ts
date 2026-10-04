/* The landing page as plain, semantic HTML: what a crawler that does not run
 * JavaScript reads, generated from the SAME copy the React page renders.
 *
 * `vite-plugins/landing-prerender.ts` writes this into `dist/landing.html`, the
 * document meant for `/` (not served yet: see that plugin). It sits inside `#root`, visually hidden with the
 * standard screen-reader-only clip, and React's first commit replaces it
 * (createRoot, not hydrateRoot, so there is nothing to mismatch). It is the same
 * words the visitor sees, so it is a text alternative rather than hidden
 * keywords; no wording exists only here. Demo answers are left out: they are
 * examples, not claims.
 *
 * Pure: strings in, string out, no DOM and no imports beyond the copy, so the
 * build plugin can load it and a unit test can read it. */
import { COPY } from './copy'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const p = (s: string): string => `<p>${esc(s)}</p>`
const ps = (items: readonly string[]): string => items.map(p).join('')
const list = (items: readonly string[]): string => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`

const section = (id: string, eyebrow: string, h: string, body: string): string =>
  `<section id="${id}"><p>${esc(eyebrow)}</p><h2>${esc(h)}</h2>${body}</section>`

export function renderLandingStatic(): string {
  const c = COPY
  const parts: string[] = []

  parts.push(
    `<header><p>${esc(c.hero.eyebrow)}</p><h1>${esc(c.hero.headlineA)} ${esc(c.hero.headlineB)}</h1>${ps(c.hero.body)}` +
      `<nav aria-label="Primary"><a href="/auth?mode=signup">${esc(c.hero.ctaPrimary)}</a> ` +
      `<a href="/series">${esc(c.hero.ctaBrowse)}, ${esc(c.hero.ctaBrowseNote)}</a> ` +
      `<a href="https://github.com/cheyras/deckpal">${esc(c.nav.github)}</a></nav>` +
      `${p(c.hero.price)}<p>${esc(c.works.lead)}: ${esc(c.works.apps.join(', '))}.</p></header>`,
  )

  parts.push(
    section(
      'loop',
      c.loop.eyebrow,
      c.loop.headline,
      `${p(c.loop.body)}<ol>${c.loop.steps.map((s) => `<li><strong>${esc(s.title)}.</strong> ${esc(s.body)}</li>`).join('')}</ol>`,
    ),
  )
  parts.push(section('plan', c.plan.eyebrow, c.plan.headline, ps(c.plan.body)))
  parts.push(section('playtest', c.playtest.eyebrow, c.playtest.headline, ps(c.playtest.body)))
  parts.push(section('tune', c.tune.eyebrow, c.tune.headline, `<blockquote>${esc(c.tune.quote)}</blockquote>${ps(c.tune.body)}`))
  parts.push(section('build', c.build.eyebrow, c.build.headline, ps(c.build.body)))
  parts.push(
    section('ask', c.ask.eyebrow, c.ask.headline, `${p(c.ask.body)}${list(c.ask.prompts.map((x) => x.q))}`),
  )
  parts.push(section('jobs', c.jobs.eyebrow, c.jobs.headline, `${p(c.jobs.body)}${list(c.jobs.items)}`))

  const cells = Object.values(c.more.cells)
  parts.push(
    section(
      'more',
      c.more.eyebrow,
      c.more.headline,
      `<ul>${cells.map((x) => `<li><strong>${esc(x.title)}.</strong> ${esc(x.body)}</li>`).join('')}</ul>`,
    ),
  )
  parts.push(
    section(
      'open-source',
      c.founder.eyebrow,
      c.founder.headline,
      `${p(c.founder.body)}<p><a href="https://github.com/cheyras/deckpal">${esc(c.founder.repoCta)}</a> ` +
        `${esc(c.founder.licenseLabel)}: ${esc(c.founder.license)}.</p>`,
    ),
  )

  const t = c.connect
  parts.push(
    section(
      'connect',
      t.eyebrow,
      t.headline,
      `${p(t.body)}<ol>${t.steps.map((s) => `<li><strong>${esc(s.title)}.</strong> ${esc(s.body)}</li>`).join('')}</ol>` +
        `${list(t.trust)}<table><caption>${esc(t.summaryLabel)}</caption><thead><tr><th scope="col">${esc(t.columns.app)}</th>` +
        `<th scope="col">${esc(t.summaryFree)}</th><th scope="col">${esc(t.summaryChange)}</th></tr></thead><tbody>` +
        t.table.map((r) => `<tr><th scope="row">${esc(r.app)}</th><td>${esc(r.freeShort)}</td><td>${esc(r.changeShort)}</td></tr>`).join('') +
        `</tbody></table>${p(t.summaryNote + ' ' + t.disclaimer)}<p><a href="/connect">${esc(t.learnMore)}</a></p>`,
    ),
  )
  parts.push(
    section(
      'faq',
      c.faq.eyebrow,
      c.faq.headline,
      `<dl>${c.faq.items.map((f) => `<dt id="faq-${f.id}">${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join('')}</dl>`,
    ),
  )
  parts.push(
    `<footer><h2>${esc(c.closing.headline)}</h2>${p(c.closing.body)}` +
      `<p><a href="/auth?mode=signup">${esc(c.closing.primary)}</a> <a href="/series">${esc(c.closing.secondary)}</a></p>` +
      `${p(c.closing.microline)}<p><a href="/privacy">Privacy</a></p></footer>`,
  )

  return `<div id="seo-landing">${parts.join('')}</div>`
}

const ldScript = (j: object): string =>
  `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`

/** WebApplication JSON-LD. It describes the whole site, so the build puts it on every route's shell. Truthful fields only: no ratings, no reviews. */
export function appJsonLd(): string {
  const c = COPY
  const app = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'DeckPal',
    url: 'https://deckpal.app/',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web',
    description: c.seo.jsonLdDescription,
    featureList: c.seo.jsonLdFeatureList,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: c.seo.jsonLdOfferDescription,
    },
    codeRepository: 'https://github.com/cheyras/deckpal',
    author: { '@type': 'Person', name: 'cheyras', url: 'https://github.com/cheyras' },
  }
  return ldScript(app)
}

/** FAQPage JSON-LD. Only the landing shows the FAQ, so only the landing document carries it. */
export function faqJsonLd(): string {
  const c = COPY
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faq.items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  return ldScript(faq)
}

/** Both blocks, as the landing document ends up with them. */
export function landingJsonLd(): string {
  return `${appJsonLd()}\n${faqJsonLd()}`
}

/** llms-full.txt: the llms.txt summary followed by every section's words, as markdown. */
export function renderLlmsFull(): string {
  const c = COPY
  const md: string[] = [c.seo.llmsTxt, '', '---', '']
  const block = (title: string, paras: readonly string[], points: readonly string[] = []) =>
    md.push(`## ${title}`, '', ...paras.flatMap((x) => [x, '']), ...points.map((x) => `- ${x}`), '')
  block(c.loop.headline, [c.loop.body], c.loop.steps.map((s) => `${s.title}: ${s.body}`))
  block(c.plan.headline, c.plan.body)
  block(c.playtest.headline, c.playtest.body)
  block(c.tune.headline, [c.tune.quote, ...c.tune.body])
  block(c.build.headline, c.build.body)
  block(c.ask.headline, [c.ask.body], c.ask.prompts.map((x) => x.q))
  block(c.jobs.headline, [c.jobs.body], c.jobs.items)
  block(c.more.headline, [], Object.values(c.more.cells).map((x) => `${x.title}: ${x.body}`))
  block(c.founder.headline, [c.founder.body])
  block(c.connect.headline, [c.connect.body, c.connect.finePrint], c.connect.table.map(
    (r) => `${r.app}: free plan ${r.free}; lowest plan ${r.lowest}; can change data: ${r.change}${r.notes ? `; ${r.notes}` : ''}${r.tested ? ' (tested with DeckPal)' : ' (from the app docs, not yet tested with DeckPal)'}`,
  ))
  md.push(`## ${c.faq.headline}`, '')
  for (const f of c.faq.items) md.push(`### ${f.q}`, '', f.a, '')
  return md.join('\n')
}
