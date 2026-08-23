/**
 * The tools Deck-E runs in the browser, and the results he gets back.
 *
 * These are declared server-side with no `execute` (`apps/api/src/decke/tools.ts`),
 * which is what forwards them here. Each one answers with a real outcome —
 * `{ok: false, reason: "no element matches '#deck-list'"}` — because the whole
 * reason they are not fire-and-forget commands is that they can FAIL, and a
 * model that is told nothing will cheerfully narrate a thing that did not
 * happen.
 *
 * Every result is a sentence the model can say out loud. "That is not on this
 * page" is useful to a reader; "ERR_NO_MATCH" is not.
 */
import type { DeckEInstance } from './runtime'

export type UiToolResult = { ok: boolean; reason?: string }

/**
 * The tools that run HERE, in the browser.
 *
 * MIRRORS `CLIENT_TOOLS` in `apps/api/src/decke/tools.ts`, the same way
 * `ROUTE_ALLOWLIST` below mirrors the server's — the web app does not depend on
 * `deckpal-api`, so the two lists are kept honest by a test on each side rather
 * than by a shared import.
 *
 * This list is a FILTER, not a convenience. Server-executed tools (`express`,
 * `showScreen`) put the identical `tool-input-available` chunk on the wire after
 * they have already run. Anything not named here that reaches `runUiTool` gets
 * re-run in a place that cannot do it, fails, and posts a tool output that
 * contradicts the one the server already produced for that same call id.
 */
export const CLIENT_TOOLS = [
  'flyTo',
  'highlight',
  'goTo',
  'scrollToMe',
  'click',
  'journey',
  'escort',
] as const

export type ClientToolName = (typeof CLIENT_TOOLS)[number]

export function isClientTool(name: unknown): name is ClientToolName {
  return typeof name === 'string' && (CLIENT_TOOLS as readonly string[]).includes(name)
}

/** Routes he may navigate to. MIRRORS the server's allowlist deliberately. */
const ROUTE_ALLOWLIST = ['/series', '/lists', '/decks', '/pokedex', '/insights', '/scan', '/search']

/**
 * DEFENCE IN DEPTH, not belt and braces.
 *
 * The server already refuses a route outside its allowlist. This checks again
 * because the check that matters is the one nearest the thing it protects: this
 * function is what actually changes the URL of an authenticated session, and it
 * should be safe to call even if something upstream is ever wrong. `/profile` is
 * absent from both lists for the same reason — it mints API tokens.
 */
export function routeAllowed(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  const clean = path.split('?')[0].split('#')[0]
  return ROUTE_ALLOWLIST.some((r) => clean === r || clean.startsWith(`${r}/`))
}

/**
 * Elements he is allowed to travel to or ring.
 *
 * AN ALLOWLIST, and it is load-bearing rather than tidy. A selector is a
 * capability: `document.querySelector` will happily return the sign-out button
 * or a token field. Text he reads is attacker-influenceable — a card can be
 * NAMED anything — so the only elements he can reach are ones the app has
 * deliberately marked with `data-decke-landmark`, plus the safe structural
 * anchors below.
 *
 * The `#`-prefixed forms are the app's own layout anchors; everything else must
 * be marked. A selector that resolves to something unmarked is refused with a
 * reason he can say.
 */
function resolveTarget(selector: string): { el: Element | null; refused?: string } {
  if (typeof selector !== 'string' || !selector || selector.length > 120) {
    return { el: null, refused: 'that is not a selector I can use' }
  }
  let el: Element | null
  try {
    el = document.querySelector(selector)
  } catch {
    return { el: null, refused: 'that selector is not valid' }
  }
  if (!el) return { el: null }
  const marked = el.closest('[data-decke-landmark]')
  if (!marked) {
    return { el: null, refused: 'that part of the page is not something I can point at' }
  }
  return { el }
}

/**
 * Elements he is allowed to PRESS. A strictly smaller set than the ones he can
 * point at, and a separate attribute rather than a second use of the same one.
 *
 * ── POINTABLE IS NOT PRESSABLE ───────────────────────────────────────────────
 *
 * A price block, a completion bar and a card image are all worth flying to and
 * ringing. None of them should ever be clicked, and several things near them
 * change the reader's collection. Reusing `data-decke-landmark` for both would
 * mean that marking something as "worth pointing at" silently also marked it
 * "safe to press", which is exactly the kind of coupling nobody notices until
 * it is a bug report about a deck that deleted itself.
 *
 * ── AND THE LIMIT OF THIS CONTROL, SAID PLAINLY ──────────────────────────────
 *
 * This function CANNOT inspect what a React `onClick` handler does. It checks
 * that an element was marked, and that it is the kind of thing that is pressed.
 * It cannot check that pressing it does not write.
 *
 * So "never a write" is a property of the MARKING DISCIPLINE, not of this code.
 * Whoever adds `data-decke-clickable` is the safeguard. The attribute is
 * grep-auditable on purpose, and every addition is reviewed for side effects —
 * a review step, not a guarantee, and the difference is worth being honest
 * about.
 *
 * The evidence that a review step is needed rather than a rule: the spec that
 * designed this tool listed the quantity stepper and the add-card control as
 * clickable in its own table. Both are writes. A rule its own author broke
 * while writing it down needs a second pair of eyes on every use.
 */
/**
 * Is this element one the click tool would actually press?
 *
 * EXPORTED SO THE LANDMARK LIST CAN ASK THE SAME QUESTION. The model is told
 * which landmarks are pressable, and that claim has to be computed by the code
 * that will later refuse or allow the press — not by a second, looser test.
 * `hasAttribute('data-decke-clickable')` is that looser test: it would promise
 * a press for a marked element that is not a control, or a marked anchor
 * pointing off the allowlist, and the runtime would then refuse it. A list that
 * promises a press the runtime refuses is worse than no list at all, because he
 * announces the plan before he executes it.
 */
export function isPressable(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false
  const pressable = el.closest<HTMLElement>('[data-decke-clickable]')
  if (!pressable) return false
  const tag = pressable.tagName.toLowerCase()
  const role = pressable.getAttribute('role')
  const isControl =
    tag === 'button' || (tag === 'a' && pressable.hasAttribute('href')) || role === 'button'
  if (!isControl) return false
  if (pressable.hasAttribute('disabled') || pressable.getAttribute('aria-disabled') === 'true') {
    return false
  }
  if (tag === 'a') {
    const href = pressable.getAttribute('href') ?? ''
    let url: URL
    try {
      url = new URL(href, window.location.href)
    } catch {
      return false
    }
    if (url.origin !== window.location.origin) return false
    if (!routeAllowed(url.pathname)) return false
  }
  return true
}

function resolveClickTarget(selector: string): { el: HTMLElement | null; refused?: string } {
  const { el, refused } = resolveTarget(selector)
  if (refused) return { el: null, refused }
  if (!el) return { el: null }

  const pressable = el.closest<HTMLElement>('[data-decke-clickable]')
  if (!pressable) {
    return { el: null, refused: 'that is not something I am allowed to press' }
  }

  // DEFENCE IN DEPTH, and cheap. The attribute is the authorisation; this is a
  // sanity check that the marked thing is actually a control, so a stray
  // attribute on a wrapper `div` cannot turn a whole region into a button.
  const tag = pressable.tagName.toLowerCase()
  const role = pressable.getAttribute('role')
  const isControl =
    tag === 'button' || (tag === 'a' && pressable.hasAttribute('href')) || role === 'button'
  if (!isControl) {
    return { el: null, refused: 'that is marked as pressable but is not a control' }
  }

  // ── AN ANCHOR IS A NAVIGATION, SO IT GETS THE NAVIGATION RULE ──────────────
  //
  // `goTo` is guarded by `routeAllowed`. `click` was not, and it accepts
  // `a[href]` — so the moment anyone marks an anchor pressable, `el.click()`
  // follows wherever it points with no allowlist anywhere in the path.
  //
  // That is not hypothetical. This app already renders "Buy on TCGplayer" as an
  // anchor whose `href` is built from CARD DATA, which is exactly the
  // attacker-influenceable category the landmark allowlist exists for. Marking
  // it would look entirely reasonable — it is navigation and disclosure, which
  // is what this tool is for — and would hand a model-reachable control an
  // off-site URL derived from a string an attacker can name.
  //
  // Found by the adversarial pass that this tool's own existence forced
  // (DECISIONS.md 2026-08-21: the previous clean verdict rested on "there is no
  // click tool"). Nothing is exploitable today because both marked controls are
  // buttons. This closes it while that is still true, rather than after
  // somebody marks the third one.
  if (tag === 'a') {
    const href = pressable.getAttribute('href') ?? ''
    // Resolved against the page, so `//evil.example` and `\\evil.example` are
    // judged as what the browser would actually do with them rather than as
    // what they look like.
    let url: URL
    try {
      url = new URL(href, window.location.href)
    } catch {
      return { el: null, refused: 'that link does not go anywhere I can follow' }
    }
    if (url.origin !== window.location.origin) {
      return { el: null, refused: 'that link leaves DeckPal, so I will not press it for you' }
    }
    if (!routeAllowed(url.pathname)) {
      return { el: null, refused: 'that link goes somewhere I am not allowed to take you' }
    }
  }
  if (pressable.hasAttribute('disabled') || pressable.getAttribute('aria-disabled') === 'true') {
    return { el: null, refused: 'that is disabled right now' }
  }
  return { el: pressable }
}

export type UiToolContext = {
  decke: DeckEInstance
  /** TanStack's imperative navigate. Injected so this module stays router-agnostic. */
  navigate: (to: string) => void
}

/**
 * Run one browser-side tool call.
 *
 * Never throws: a rejected tool has to come back as a RESULT the model can react
 * to, and an exception here would abort the turn instead.
 */
export async function runUiTool(
  ctx: UiToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<UiToolResult> {
  try {
    switch (name) {
      case 'flyTo': {
        const { el, refused } = resolveTarget(String(input.selector ?? ''))
        if (refused) return { ok: false, reason: refused }
        if (!el) return { ok: false, reason: 'there is nothing like that on this page' }
        // VIA THE BACKGROUND when it is a real journey, straight there when it
        // is not. Measured in the engine's own notes: a depth change is 24-27
        // world units while every same-depth leg is under 3, so routing a short
        // hop through the far plane spends most of the trip going nowhere. The
        // threshold is "is he even near it" — a third of the viewport.
        const here = ctx.decke.getState()
        const target = el.getBoundingClientRect()
        const far =
          !here.flying &&
          Math.abs(target.left + target.width / 2 - window.innerWidth / 2) >
            window.innerWidth / 3
        ctx.decke.flyTo(
          { selector: String(input.selector) },
          {
            depth: 'foreground',
            highlight: input.highlight !== false,
            then: input.point === true ? 'point' : undefined,
            via: far ? 'background' : undefined,
            scrollWith: true,
          },
        )
        return { ok: true }
      }

      case 'highlight': {
        const { el, refused } = resolveTarget(String(input.selector ?? ''))
        if (refused) return { ok: false, reason: refused }
        if (!el) return { ok: false, reason: 'there is nothing like that on this page' }
        ctx.decke.highlight(String(input.selector), {
          durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
        })
        return { ok: true }
      }

      case 'scrollToMe':
        ctx.decke.scrollIntoView()
        return { ok: true }

      case 'click': {
        const { el, refused } = resolveClickTarget(String(input.selector ?? ''))
        if (refused) return { ok: false, reason: refused }
        if (!el) return { ok: false, reason: 'there is nothing like that on this page' }
        // A REAL CLICK on the element itself, not a synthesised event on the
        // document: React listens at the root and reconstructs the path, so
        // `el.click()` is what a person's press actually looks like to it.
        el.click()
        // ANSWERED WITH WHAT IT WAS, not just "ok". "I opened the Mega
        // Evolution row" is something he can say; "true" is not, and the whole
        // reason these are tools rather than commands is that the result is
        // supposed to be sayable.
        const label = el.getAttribute('data-decke-label') ?? el.textContent?.trim().slice(0, 60)
        return { ok: true, reason: label ? `pressed ${label}` : undefined }
      }

      case 'goTo': {
        const route = input.route
        if (!routeAllowed(route)) {
          return { ok: false, reason: 'I am not allowed to take you to that page' }
        }
        if (window.location.pathname === route) {
          // Already here. Saying so beats a navigation that looks like nothing
          // happened, and lets him go straight to the selector.
          if (typeof input.selector === 'string') {
            return await travelAfterRoute(ctx, input.selector, true)
          }
          return { ok: true, reason: 'we are already on that page' }
        }
        ctx.navigate(route)
        if (typeof input.selector !== 'string') return { ok: true }
        return await travelAfterRoute(ctx, input.selector, false)
      }

      case 'journey': {
        // DELEGATED, not implemented here. A journey needs things this boundary
        // does not have — a way to speak into the bubble, a flag that keeps the
        // route watcher from tidying up mid-hop, and the TURN's abort signal so
        // that Stop halts the walk and the turn together. `useDeckeChat` has all
        // three, so it hands `runJourney` a richer context and this case exists
        // to satisfy the tool boundary's own audit: every advertised tool has a
        // case, and falling through to `default` answers "I do not know how to
        // do X" — the one reason a model cannot act on.
        return { ok: false, reason: 'a journey is run by the conversation, not from here' }
      }

      case 'escort': {
        // DELEGATED for the same reason as `journey`, which is what it expands
        // into. `useDeckeChat` builds the steps and hands `runJourney` the
        // richer context; this case exists so the boundary's own audit stays
        // true — every advertised tool has a case, and `default` answers "I do
        // not know how to do X", the one reason a model cannot act on.
        return { ok: false, reason: 'an escort is run by the conversation, not from here' }
      }

      default:
        return { ok: false, reason: `I do not know how to do "${name}"` }
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'that did not work' }
  }
}

/**
 * Wait for the destination to actually exist, then travel to it.
 *
 * "After the route settles" is not a moment the router can tell us about. A
 * route renders, then its data resolves, then the list it renders appears —
 * seconds later on a cold cache, and never if the page is empty. So this
 * watches for the element with a MutationObserver and gives up politely.
 *
 * BOUNDED, and the bound is the point: an unbounded wait leaves the model
 * blocked mid-turn with a tool that never answers, which reads to the user as
 * Deck-E freezing.
 */
function travelAfterRoute(
  ctx: UiToolContext,
  selector: string,
  immediate: boolean,
): Promise<UiToolResult> {
  const LIMIT_MS = 6000
  return new Promise((resolve) => {
    const tryNow = (): boolean => {
      const { el, refused } = resolveTarget(selector)
      if (refused) {
        resolve({ ok: false, reason: refused })
        return true
      }
      if (!el) return false
      // ALWAYS via the background after a navigation. The page under him has
      // just been replaced, so there is no continuity to preserve by going
      // straight — pulling back and coming in is what makes the load read as
      // him travelling rather than as him teleporting.
      ctx.decke.flyTo(
        { selector },
        { depth: 'foreground', highlight: true, then: 'point', via: 'background', scrollWith: true },
      )
      resolve({ ok: true })
      return true
    }
    if (immediate && tryNow()) return

    const obs = new MutationObserver(() => {
      if (tryNow()) {
        obs.disconnect()
        window.clearTimeout(timer)
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    const timer = window.setTimeout(() => {
      obs.disconnect()
      // He ARRIVED — the navigation happened. Only the last step failed, and
      // saying which half worked is the difference between "I took you there,
      // but I cannot find it" and an unexplained shrug.
      resolve({ ok: false, reason: 'we are on the page, but I could not find that part of it' })
    }, LIMIT_MS)
  })
}
