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
        ctx.decke.flyTo(
          { selector: String(input.selector) },
          {
            depth: 'foreground',
            highlight: input.highlight !== false,
            then: input.point === true ? 'point' : undefined,
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
      ctx.decke.flyTo({ selector }, { depth: 'foreground', highlight: true, then: 'point' })
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
