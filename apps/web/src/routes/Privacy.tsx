/* ─────────────────────────────────────────────────────────────────────────────
 * /privacy — what deckpal.app collects, who else receives it, and what a
 * reader can do about it.
 *
 * EVERY FACT HERE WAS READ OUT OF THE CODE, not assumed, and the decision file
 * `decisions/2026/2026-09-27-privacy-page-and-its-processor-list.md` names the
 * file behind each one. When the code changes what it sends where — a new AI
 * model, a new third-party script, a new field on a public bug report — this
 * page is wrong until it changes too. The places most likely to move:
 *
 *   • Deck-E's models: `apps/api/src/decke/models.ts`, and `jev.ts` for the
 *     only request that asks for zero data retention. Every model call goes
 *     through the Vercel AI Gateway.
 *   • What the browser may talk to: the CSP in `vercel.json`. "No third-party
 *     analytics or tracking scripts" is true BECAUSE that allow-list is
 *     DeckPal, Supabase and Stripe (with Stripe's Link) and nothing else.
 *   • The public bug-report body: `formatIssueBody` in `apps/api/src/routes/bugs.ts`.
 *   • What Stripe is sent: `apps/api/src/billing/service.ts` (support) and
 *     `apps/api/src/credits/payments.ts` (Deck-E credits).
 *
 * Anything that is a legal or business decision rather than a fact in the code
 * — who runs DeckPal, the contact address, retention periods, the age limit,
 * which privacy laws apply — is a <ToDecide> marker, drawn so it cannot ship
 * looking finished. Fill those in; do not invent them.
 *
 * Chrome-free and public (lib/landingRoute.ts): it is linked from the landing
 * footer and the sign-up form, both read by people with no account.
 * ───────────────────────────────────────────────────────────────────────────── */
import { cloneElement, Fragment, isValidElement, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandLogo } from '../components/Icon'
import { SkipLink } from '../components/SkipLink'
import { useAccess } from '../lib/access'
import { REPO, SiteFooter } from './landing/SiteFooter'
import './landing/landing.css'

const SOURCE = `${REPO}/blob/main/apps/web/src/routes/Privacy.tsx`
const HISTORY = `${REPO}/commits/main/apps/web/src/routes/Privacy.tsx`
const ISSUES = `${REPO}/issues`

/* ── primitives ───────────────────────────────────────────────────────────── */

/**
 * A fact only the people running DeckPal can supply. Loud on purpose: dashed,
 * warning-coloured and labelled, so a screenshot of an unfinished page can
 * never be mistaken for a finished one.
 */
function ToDecide({ children }: { children: ReactNode }) {
  return (
    <span className="box-decoration-clone rounded-[6px] border border-dashed border-warning px-[6px] py-[1px] font-semibold text-warning">
      To decide: {children}
    </span>
  )
}

/**
 * Keeps "Deck-E" on one line. A browser may break a line after any hyphen, and
 * "Deck-" / "E" split across two lines reads as a typo, most of all in the
 * narrow processor cards. Walks strings inside elements too (links, list
 * items, <ToDecide>), so prose can be written normally.
 */
function keepDeckE(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    if (!node.includes('Deck-E')) return node
    return node.split(/(Deck-E)/).map((part, i) =>
      part === 'Deck-E' ? (
        <span key={i} className="whitespace-nowrap">
          Deck-E
        </span>
      ) : (
        part
      ),
    )
  }
  if (Array.isArray(node)) return node.map((child, i) => <Fragment key={i}>{keepDeckE(child)}</Fragment>)
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined) {
    return cloneElement(node, undefined, keepDeckE(node.props.children))
  }
  return node
}

/** In-text link. Underlined so it is not told apart from prose by colour alone. */
function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2 hover:text-link-hover">
      {children}
    </a>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-[14px] text-[16px] leading-[1.7] text-text-body">{keepDeckE(children)}</p>
}

/** `lead` is the short version's list: no top margin (its box pads it), a little more air, brand bullets. */
function Bullets({ children, lead = false }: { children: ReactNode; lead?: boolean }) {
  const tone = lead ? 'gap-[12px] marker:text-action-primary' : 'mt-[14px] gap-[10px] marker:text-text-muted'
  return (
    <ul className={`flex list-disc flex-col pl-[22px] text-[16px] leading-[1.65] text-text-body ${tone}`}>
      {keepDeckE(children)}
    </ul>
  )
}

/** A link to another section of this page. Same underline rule as `A`. */
function ToSection({ id, children }: { id: string; children: ReactNode }) {
  return (
    <a href={`#${id}`} className="text-link underline underline-offset-2 hover:text-link-hover">
      {children}
    </a>
  )
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-[30px] text-[17px] font-bold text-text-primary">{keepDeckE(children)}</h3>
}

const SECTIONS = [
  { id: 'short-version', title: 'The short version' },
  { id: 'what-we-collect', title: 'What we collect' },
  { id: 'services', title: 'Services that receive your data' },
  { id: 'deck-e', title: 'Deck-E and AI models' },
  { id: 'bug-reports', title: 'Bug reports are public' },
  { id: 'your-device', title: 'Cookies and storage on your device' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'your-choices', title: 'Your choices' },
  { id: 'children', title: 'Children' },
  { id: 'changes', title: 'Changes to this page' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)!.title
  return (
    <section aria-labelledby={id} className="mt-[56px]">
      <h2
        id={id}
        tabIndex={-1}
        className="scroll-mt-[24px] text-[24px] font-extrabold tracking-[-0.02em] text-text-primary focus:outline-none"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

/* ── processors ───────────────────────────────────────────────────────────── */

interface Processor {
  name: string
  gets: ReactNode
  why: ReactNode
}

// Running the service. Order: the ones every account touches first.
const INFRASTRUCTURE: Processor[] = [
  {
    name: 'Supabase',
    gets: 'Your email address and password (stored as a hash), everything you keep in DeckPal, your profile photo and any bug-report screenshot. It also sees your IP address and browser when you sign in.',
    why: 'Runs sign-in, the database and file storage. Card images are served from its storage too.',
  },
  {
    name: 'Resend',
    gets: 'Your email address, and the account emails sent to it: the sign-up confirmation and password resets.',
    why: 'Delivers the emails Supabase sends for DeckPal.',
  },
  {
    name: 'Vercel',
    gets: 'Every request your browser makes to deckpal.app, including your IP address and browser details, and the app’s server logs.',
    why: 'Hosts the website and the API, and runs the AI Gateway that Deck-E’s requests pass through.',
  },
  {
    name: 'Stripe',
    gets: 'Your email address, your DeckPal account ID, and the card details you type into Stripe’s own payment form. Its script also sees your device and IP address when a payment form opens.',
    why: 'Takes support payments and Deck-E credit purchases, sends receipts and checks for fraud.',
  },
  {
    name: 'GitHub',
    gets: 'The bug reports you send: what you typed, the page, your screen size and browser, and a report ID. It also runs DeckPal’s scheduled jobs, which read the database.',
    why: 'DeckPal’s public issue tracker, and nightly jobs such as the daily snapshot of each collection’s value.',
  },
  {
    name: 'DuckDuckGo',
    gets: 'The hostname of each web-research source shown in Deck-E, and your IP address when its favicon is loaded.',
    why: 'Provides the favicons beside Deck-E web-research sources.',
  },
]

// Deck-E's models, all reached through the Vercel AI Gateway.
const AI_MODELS: Processor[] = [
  {
    name: 'Anthropic (Claude)',
    gets: 'Your Deck-E messages, and the collection, deck, list and battle-log details Deck-E looks up to answer them.',
    why: 'Writes Deck-E’s replies, plans and analyses with its available tools. It also suggests next steps on bug reports.',
  },
  {
    name: 'Perplexity',
    gets: 'A short web-search question that Deck-E writes. It is screened first to keep out email addresses, account IDs and talk about your own collection.',
    why: 'Looks up the current competitive meta on the web.',
  },
  {
    name: 'TypeSafe (Jev)',
    gets: 'Your latest Deck-E message (up to 2,000 characters), the end of Deck-E’s replies and the page you are on.',
    why: 'Judges what you asked for, and checks that Deck-E only claims actions he really took. Under zero data retention.',
  },
]

function ProcessorList({ label, items }: { label: string; items: Processor[] }) {
  return (
    <ul aria-label={label} className="mt-[16px] grid gap-[12px] sm:grid-cols-2">
      {items.map((p) => (
        <li key={p.name} className="rounded-[16px] border border-border-default bg-surface-secondary p-[18px]">
          <h4 className="text-[16px] font-bold text-text-primary">{p.name}</h4>
          <dl className="mt-[10px] text-[14px] leading-[1.6]">
            <dt className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-secondary">Receives</dt>
            <dd className="mt-[2px] text-text-body">{keepDeckE(p.gets)}</dd>
            <dt className="mt-[10px] text-[12px] font-bold uppercase tracking-[0.08em] text-text-secondary">Why</dt>
            <dd className="mt-[2px] text-text-body">{keepDeckE(p.why)}</dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}

/* ── chrome ───────────────────────────────────────────────────────────────── */

const PILL_PRIMARY =
  'ls-cta flex h-[40px] items-center rounded-full bg-action-primary px-[16px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-strong sm:px-[18px]'

/** The landing's nav, minus its scroll behaviour. A signed-in reader gets a way back into the app instead of a sign-up pitch. */
function Header() {
  const { identity } = useAccess()
  return (
    <header className="border-b border-border-default" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <nav className="ls-wrap flex h-[66px] items-center gap-[10px]" aria-label="Primary">
        <Link to="/" className="flex items-center rounded-lg" aria-label="DeckPal home">
          <BrandLogo height={27} />
        </Link>
        <span className="flex-1" />
        {identity ? (
          <Link to="/series" className={PILL_PRIMARY}>
            Open DeckPal
          </Link>
        ) : (
          <>
            <Link
              to="/auth"
              className="flex h-[40px] items-center rounded-full px-[10px] text-[14px] font-semibold text-text-body hover:text-text-primary sm:px-[14px]"
            >
              Sign in
            </Link>
            <Link to="/auth" search={{ mode: 'signup' as const }} className={PILL_PRIMARY}>
              Get started
            </Link>
          </>
        )}
      </nav>
    </header>
  )
}

function OnThisPage() {
  return (
    <nav aria-label="On this page" className="mt-[32px] rounded-[16px] border border-border-default p-[18px]">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-text-secondary">On this page</h2>
      <ol className="mt-[10px] grid gap-x-[24px] gap-y-[8px] text-[15px] sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="text-text-body underline decoration-border-default underline-offset-4 hover:text-link hover:decoration-current"
            >
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export function Privacy() {
  return (
    <div className="ls min-h-screen bg-surface-primary">
      <SkipLink />
      <Header />
      <main id="main" tabIndex={-1} className="ls-wrap pb-[80px] pt-[40px] focus:outline-none sm:pt-[64px]">
        <article className="mx-auto max-w-[720px]">
          <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-action-primary">Privacy</p>
          <h1
            className="mt-[10px] font-extrabold tracking-[-0.025em] text-text-primary"
            style={{ fontSize: 'clamp(32px, 4.4vw, 46px)', lineHeight: 1.08 }}
          >
            Privacy at DeckPal
          </h1>
          <p className="mt-[18px] text-[18px] leading-[1.65] text-text-body">
            DeckPal is a Pokémon TCG collection tracker. This page covers what deckpal.app collects, which outside
            services receive it, and what you can do about it. DeckPal is open source, so you can check any of it
            against <A href={SOURCE}>the code</A>.
          </p>
          <p className="mt-[16px] text-[14px] leading-[1.6] text-text-muted">
            Last updated: <ToDecide>the date this page takes effect</ToDecide>
          </p>
          <p className="mt-[8px] text-[14px] leading-[1.6] text-text-muted">
            This page is about deckpal.app. If you use a copy of DeckPal that someone else runs, that copy is theirs,
            and their own practices apply.
          </p>

          <OnThisPage />

          <Section id="short-version">
            <div className="mt-[16px] rounded-[20px] border border-border-default bg-surface-secondary p-[20px] sm:p-[26px]">
              <Bullets lead>
                <li>
                  We don’t sell your data or show ads, and there are no third-party analytics or tracking scripts.
                  The site’s security settings only let your browser talk to DeckPal, Supabase and Stripe.
                </li>
                <li>
                  Your collection, decks, lists and battle logs are visible only to you. A few profile details are
                  not private; <ToSection id="profile">the profile section</ToSection> lists them.
                </li>
                <li>Payments go through Stripe. Your full card number never reaches DeckPal.</li>
                <li>
                  If you use Deck-E, DeckPal’s assistant, what you type and the parts of your collection he looks up
                  go to AI model providers so they can answer.
                </li>
                <li>
                  Bug reports become public GitHub issues. The report form tells you what will be posted before you
                  send one.
                </li>
              </Bullets>
            </div>
            <P>
              DeckPal is run by <ToDecide>the person or company that runs DeckPal</ToDecide>. For anything on this
              page, write to <ToDecide>a contact address for privacy requests</ToDecide>.
            </P>
          </Section>

          <Section id="what-we-collect">
            <H3>Your account</H3>
            <P>
              Your email address and password. They go from your browser straight to Supabase, which runs sign-in for
              us, and Supabase stores the password only as a one-way hash, so DeckPal never sees it. We also make a
              username from the part of your email address before the @. DeckPal’s administrators can see your email
              address and when you last signed in.
            </P>

            <H3>What you put in</H3>
            <P>
              Your collection (which printings you own, how many and in what condition), grading details and card
              notes, set goals, decks and every saved version of them, lists and binders, showcase cards, settings,
              and the battle logs you paste in, which include your opponents’ in-game names. We also keep a daily
              snapshot of your collection’s value and a history of every change you make, so you can undo it.
            </P>

            <H3>
              <span id="profile" className="scroll-mt-[24px]">
                Your profile, which is not private
              </span>
            </H3>
            <P>
              Your profile photo, the date you joined, your collection totals and trainer level, and your showcase
              cards can be read by anyone who knows how to ask DeckPal’s database, without an account. No page in
              the app shows them to other people yet, and they carry an internal account number, not your name or
              email address. Your photo is re-encoded when you upload it, which strips the location and other details
              a camera adds.
            </P>

            <H3>Payments</H3>
            <P>
              If you support DeckPal or buy Deck-E credits, you pay on Stripe’s form and your card details go to
              Stripe, not to us. We keep your Stripe customer ID, the amount, date and status of each payment, your
              card’s brand, last four digits and expiry date (so you can recognise it), and your credit balance and
              spending.
            </P>

            <H3>The support prompt</H3>
            <P>
              While you are signed in, we count your visits, note when we last asked you to support DeckPal, and
              record which suggested amounts you were shown and which you chose. That decides when to ask, and tells
              us which amounts to suggest.
            </P>

            <H3>Deck-E conversations</H3>
            <P>
              If your account has Deck-E, your conversations with him are saved to your Deck-E history.{' '}
              <ToSection id="deck-e">Deck-E and AI models</ToSection>{' '}
              covers where they go.
            </P>

            <H3>Bug reports</H3>
            <P>
              What you type into the report form, the page, your screen size and browser, and a screenshot if you
              include one. We keep a private copy of each report with your email address, so we can follow up.
            </P>

            <H3>Connected assistants</H3>
            <P>
              If you connect an AI assistant such as Claude to your DeckPal account, we store a record of the
              connection, and the database keeps the access token only as a one-way hash. Whatever your assistant
              reads from DeckPal then goes to that assistant’s provider, under your agreement with them.
            </P>

            <H3>Technical data</H3>
            <P>
              Vercel, which hosts DeckPal, logs the requests your browser makes, including your IP address. We use
              your IP address for a moment, in memory, to limit how fast requests can arrive. If the app crashes in
              your browser, it sends us the error, the page and which version of the app was running, but nothing
              that identifies you.
            </P>
          </Section>

          <Section id="services">
            <P>
              These are the outside services that receive data about you when you use deckpal.app.{' '}
              <ToDecide>whether DeckPal has a data-processing agreement with each of them</ToDecide>
            </P>
            <H3>Running DeckPal</H3>
            <ProcessorList label="Services that run DeckPal" items={INFRASTRUCTURE} />
            <H3>Deck-E’s AI models, through the Vercel AI Gateway</H3>
            <ProcessorList label="Deck-E’s AI model providers" items={AI_MODELS} />
            <H3>Places you choose to send it</H3>
            <Bullets>
              <li>
                An AI assistant you connect gets whatever you allow it to read or change: your collection, decks,
                lists and battle logs.
              </li>
              <li>
                A buy link to TCGplayer carries the cards you chose, and for a “buy the missing cards” link, the
                whole list. DeckPal adds no affiliate or tracking codes.
              </li>
            </Bullets>
            <P>
              Card data, prices and card images come from public sources that DeckPal’s servers download on their
              own. Those sources never receive anything about you.
            </P>
          </Section>

          <Section id="deck-e">
            <P>
              Deck-E is DeckPal’s assistant. He is only available to accounts that have been given access. When you
              chat with him:
            </P>
            <Bullets>
              <li>
                Your messages, and the parts of your collection, decks, lists and battle logs he looks up to answer,
                are sent through the Vercel AI Gateway to the AI providers listed above. Your email address and
                account ID are not.
              </li>
              <li>
                Requests to TypeSafe’s Jev require zero data retention: TypeSafe keeps nothing once it has answered,
                and the Gateway refuses to send those requests anywhere that would.
              </li>
              <li>
                Requests to the other providers do not ask for zero retention, so each provider’s own terms decide
                how long they keep them, and the Gateway may pass a request to a company that hosts the model rather
                than the model’s maker.{' '}
                <ToDecide>whether to require zero data retention for every Deck-E model</ToDecide>
              </li>
              <li>
                Your conversations are saved to your Deck-E history, and you can delete any of them there. Nothing is
                deleted automatically.
              </li>
              <li>
                For each request we record which model answered, how much it used and what it cost. That is how the
                credit meter works.
              </li>
              <li>
                Cost per conversation is also recorded for every Deck-E chat as part of usage accounting, without
                keeping the chat’s content for that purpose.
              </li>
            </Bullets>
            <H3>Sharing chats to improve Deck-E</H3>
            <P>
              You can share one chat when Deck-E asks or with your feedback. You can also turn on <strong>Always share
              my Deck-E chats</strong> in Profile: new chats will then be shared from their first recorded part.
              Turning it off affects future chats only; chats already shared stay shared until you stop them in History.
              The <strong>Let Deck-E ask to share chats</strong> setting only matters while always sharing is off.
            </P>
            <P>
              When you share a chat, DeckPal keeps its messages and replies, tool activity with full results,
              approvals, feedback, animations, timings, model and cost information. Access is limited to DeckPal
              administrators and the tools they explicitly authorise, and shared chats are kept for 180 days. We do not
              keep your account ID in this improvement copy, and make a best effort to remove your username, display
              name and email wherever they appear, including common encodings. Things you type about yourself, or a
              very distinctive collection, could still identify you — this is
              pseudonymised, not anonymous.
            </P>
            <P>
              History marks a shared chat as Shared; choosing Stop sharing there deletes its saved copy.
            </P>
          </Section>

          <Section id="bug-reports">
            <P>
              When you report a bug, it is filed as an issue on{' '}
              <A href={ISSUES}>DeckPal’s public GitHub repository</A>, where anyone can read it. The issue holds what
              you typed, the page you were on (without anything after a ? or #), your screen size and browser, and a
              report ID. It does not hold your email address or your account.
            </P>
            <P>
              A screenshot is optional. If you include one, it is stored privately and is never posted with the
              issue. Pages that show account details — your profile, your credits, administration — never get a
              screenshot at all.
            </P>
            <P>
              An AI model (Anthropic’s Claude, through the Vercel AI Gateway) reads new reports and posts suggested
              next steps on the public issue.
            </P>
          </Section>

          <Section id="your-device">
            <P>
              DeckPal itself sets no cookies. Your browser keeps your sign-in session (which includes your email
              address) and your account ID, your preferences, and copies of the app, public card data and card images
              so DeckPal opens without a connection. When a payment form opens, Stripe’s script may set its own
              cookies to help prevent fraud. Clearing your browser’s data for deckpal.app removes DeckPal’s copies and
              signs you out.
            </P>
          </Section>

          <Section id="retention">
            <Bullets>
              <li>
                Your account and everything in it: for as long as you have the account.{' '}
                <ToDecide>how an account is deleted, and how long deleted data lasts in backups</ToDecide>
              </li>
              <li>
                Deleted lists and decks: kept in Recently deleted until you choose Delete forever, so you can bring
                them back.
              </li>
              <li>Deck-E conversations: until you delete them. A copy you explicitly share to improve Deck-E: 180 days, unless you Stop sharing sooner.</li>
              <li>
                Payment records and Deck-E usage records:{' '}
                <ToDecide>how long these are kept (tax rules may set a minimum)</ToDecide>
              </li>
              <li>
                Bug reports: the public issue stays on GitHub.{' '}
                <ToDecide>how long the private copy and any screenshot are kept</ToDecide>
              </li>
              <li>Server logs: for as long as Vercel keeps them.</li>
            </Bullets>
          </Section>

          <Section id="your-choices">
            <Bullets>
              <li>See and change what you have stored at any time in the app.</li>
              <li>Delete lists and decks for good from Recently deleted.</li>
              <li>Delete Deck-E conversations from his history.</li>
              <li>Turn Let Deck-E ask to share chats on or off in your profile, or Stop sharing a shared chat from History.</li>
              <li>Remove your profile photo.</li>
              <li>Disconnect an assistant by revoking its access in your profile, under Agent access.</li>
              <li>Leave the screenshot out of a bug report.</li>
              <li>
                Take a copy: there is no one-click export yet. You can download decks and lists as PDFs, copy a deck
                list as text, and a connected assistant can read your collection, decks, lists and battle logs.
              </li>
              <li>
                Delete your account: there is no button for this yet.{' '}
                <ToDecide>how to ask, and what gets deleted</ToDecide>
              </li>
              <li>
                Your legal rights:{' '}
                <ToDecide>which privacy laws DeckPal commits to (for example GDPR or CCPA) and how to use them</ToDecide>
              </li>
            </Bullets>
          </Section>

          <Section id="children">
            <P>
              <ToDecide>the minimum age for a DeckPal account</ToDecide>
            </P>
          </Section>

          <Section id="changes">
            <P>
              This page is part of DeckPal’s public source code, so <A href={HISTORY}>every change to it</A> is on
              the record. When something important changes, <ToDecide>how people will be told</ToDecide>
            </P>
          </Section>
        </article>
      </main>
      <SiteFooter />
    </div>
  )
}
