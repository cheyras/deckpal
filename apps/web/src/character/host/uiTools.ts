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

/** Total serialised size of one movement's recorded arguments. */
const UI_ARGS_MAX = 800

/**
 * What a movement was asked to do, small enough to keep for ever.
 *
 * ── WHY THE TRANSCRIPT NEEDS THIS ───────────────────────────────────────────
 *
 * Server tools have recorded their arguments since `decke/toolArgs.ts`, on the
 * argument that `{name, phase, title, summary}` answers WHICH tool and HOW IT
 * WENT and never WITH WHAT — and that every defect that pass fixed lived in an
 * argument value. The movements were left out, and they are the calls where the
 * argument IS the whole event: `flyTo` without its selector says he flew and
 * refuses to say where.
 *
 * That gap has already cost a diagnosis. Reviewing a turn where a needless
 * flight forced an extra leg, the record held six `flyTo` calls across the
 * entire history with `args` null on every one — so "which landmark did he
 * reach for" was unanswerable, and the empty object printed in its place read
 * as a malformed call that had never happened.
 *
 * ── AND WHY IT IS NOT `briefArgs` ───────────────────────────────────────────
 *
 * `apps/web` deliberately does not depend on the API package (see
 * `__tests__/approvalPhrases.test.ts`), so that helper cannot be imported here,
 * and reproducing its shaping would be the copy-pasted-helper problem the
 * hygiene pass removed. It does not need reproducing: every field a movement
 * takes is bounded by its own schema — `selector` is `.max(120)`, `journey` is
 * `.max(JOURNEY_MAX_STEPS)` — so the only real risk is a long journey, and one
 * total cap covers it.
 *
 * KEYS ARE ALWAYS KEPT, which is the one rule worth carrying over: a key whose
 * value was too big still answers "was this field even sent", and that question
 * is most of what a transcript is read for.
 */
export function uiToolArgs(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0) return undefined

  const out: Record<string, unknown> = {}
  let used = 0
  for (const k of keys) {
    let json: string
    try {
      json = JSON.stringify(obj[k] ?? null)
    } catch {
      // A cyclic or otherwise unserialisable value is not worth throwing on the
      // path that records what he did.
      out[k] = '…(not recordable)'
      continue
    }
    if (used + json.length > UI_ARGS_MAX) {
      out[k] = `…(${json.length} chars, too big to record)`
      continue
    }
    out[k] = obj[k]
    used += json.length
  }
  return out
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
 * ── THE CARD TILE, AND WHY IT NEEDED A SEAM OF ITS OWN ───────────────────────
 *
 * Everything else he can point at is a LANDMARK: the app marks it, it is in the
 * document for as long as its page is, and `travelAfterRoute` only has to wait
 * for the page to paint. A card tile is not like that. The set grid is
 * window-virtualized (`GridView`, `useWindowVirtualizer`), so the page holds
 * only the tiles you can currently SEE — two screens' worth out of a set that
 * runs to three hundred cards. Waiting for `[data-decke-card="me05-084"]` to
 * turn up therefore never finished, because nothing was ever going to render
 * it: the tile does not exist until somebody scrolls to where it lives. The
 * system prompt said exactly that out loud, and told him not to try.
 *
 * The owner asked for it anyway, and described the shape he wanted:
 *
 *   "bring up the set page … then scrolled down the page for me to the specific
 *    card … so it looks like he's flying down the page to the card."
 *
 * So the wait becomes a REQUEST. `decke:reveal` is that request: a window event
 * carrying the selector he is waiting on and the card id inside it. The page
 * that owns the grid is the only thing that knows where `me05-084` sits in a
 * filtered, sorted, virtualized list, so it does the scrolling; this side only
 * asks, and then goes on waiting exactly as it always did. The tile mounts, the
 * MutationObserver sees it, the settle fires, and the ordinary `flyTo` carries
 * him to a tile that is now real and already near the middle of the screen.
 *
 * Deliberately an EVENT rather than a callback registry or a module singleton:
 * the requester lives in the character host, the responder lives in a route,
 * they mount and unmount on their own schedules, and neither should hold a
 * reference to the other. A page that is not listening simply does not answer,
 * which is the same outcome as the old behaviour — a polite failure at the 6 s
 * cap, not a hang.
 */
export const DECKE_REVEAL_EVENT = 'decke:reveal'

export type DeckeRevealDetail = {
  /** The selector he is waiting on, verbatim. */
  selector: string
  /** The card id inside it, when the selector names a card tile. */
  cardId?: string
}

/**
 * How often the request is repeated while he is still waiting.
 *
 * FIRE-AND-FORGET WOULD LOSE THE RACE IT MATTERS MOST IN. The common case is a
 * `goTo` that navigates to a set page and then waits for a tile on it, and the
 * navigation is what MOUNTS the listener — so the first dispatch reliably
 * arrives at a page that is not there yet and lands on nobody. Repeating is the
 * cheap half of a handshake: an event with no listener costs a function call,
 * and the listener dedupes a request it is already acting on, so the only cost
 * of asking again is the asking. Cleared the instant the wait resolves, and
 * bounded anyway by the same 6 s cap that bounds the wait.
 */
export const REVEAL_RETRY_MS = 400

/**
 * The ONE selector shape that names something the app does not keep in the DOM.
 *
 * Strict on purpose, and strict in both directions:
 *
 *   - the attribute name is matched literally, not as a prefix. `data-decke-card`
 *     is a distinct attribute from `data-decke-card-grid` and
 *     `data-decke-card-image`, both of which are ordinary landmarks and must keep
 *     going through the ordinary path;
 *   - the id is a bounded charset that cannot leave the quoted attribute value:
 *     no quote, no backslash, no bracket, no whitespace, no comma. Card ids are
 *     `<setId>-<number>` (`me05-084`, `swshp-SWSH001`), so alphanumerics with
 *     dash/underscore/dot is the shape, and 60 characters is generous for it.
 *
 * This is NOT a general CSS opening. `[data-decke-card]` on its own, a `^=`
 * prefix match, a descendant combinator, a comma-separated list — every one of
 * those reaches for a tile and none of them is this form, so every one is
 * refused rather than being quietly allowed through the landmark path. The
 * whole value of the allowlist is that a selector is a capability, and widening
 * "he may name one specific card" into "he may write attribute selectors" would
 * give away the second while only meaning the first.
 */
const CARD_TILE_SELECTOR = /^\[data-decke-card="([A-Za-z0-9][A-Za-z0-9._-]{0,59})"\]$/
/** Reaches for a card tile at all, however badly written. See above. */
const NAMES_A_CARD_TILE = /data-decke-card(?![\w-])/

/**
 * The card id inside a card-tile selector, or null if this is not one.
 *
 * The single source of truth for the shape, shared by the thing that ALLOWS it
 * (`resolveTarget`) and the thing that ACTS on it (`travelAfterRoute`, and
 * through the event, the set page). Two regexes that agree today are two
 * regexes that disagree after the next set with an odd id.
 */
export function revealCardId(selector: unknown): string | null {
  if (typeof selector !== 'string') return null
  const m = CARD_TILE_SELECTOR.exec(selector)
  return m ? m[1]! : null
}

/** The selector for one card's tile. Build it here so nobody hand-writes it. */
export function cardTileSelector(cardId: string): string {
  return `[data-decke-card="${cardId}"]`
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
 *
 * ── AND ONE MARKING THAT IS NOT AN ANCESTOR ──────────────────────────────────
 *
 * `data-decke-card` is the second deliberate marking, and it sits ON the thing
 * rather than around it. A tile is inside the grid's landmark on the set page,
 * so the ancestor rule would already have let it through there — but the same
 * `CardTile` renders on the species page and in search results, where nothing
 * wraps it, and "he can point at this card here but not there" is not a rule
 * anybody could hold in their head. So the strict tile form is allowed on its
 * own authority: the attribute IS the marking, written in exactly one place
 * (`CardTile`), on the tile's own anchor, and grep-auditable like the other one.
 *
 * It stays a POINTING capability. `resolveClickTarget` runs this first and then
 * demands `data-decke-clickable`, which no tile carries, so nothing here makes
 * a card pressable — which matters, because a tile's anchor opens the card
 * sheet and the click policy is a separate, smaller allowlist on purpose.
 */
function resolveTarget(selector: string): { el: Element | null; refused?: string } {
  if (typeof selector !== 'string' || !selector || selector.length > 120) {
    return { el: null, refused: 'that is not a selector I can use' }
  }
  // Refused BEFORE the query, so a loose reach for a tile ("any tile", "tiles
  // whose id starts with…") is answered as the mistake it is rather than
  // resolving to whichever card happens to be on screen.
  const cardId = revealCardId(selector)
  if (!cardId && NAMES_A_CARD_TILE.test(selector)) {
    return { el: null, refused: 'I need a card’s full number before I can point at it' }
  }
  let el: Element | null
  try {
    el = document.querySelector(selector)
  } catch {
    return { el: null, refused: 'that selector is not valid' }
  }
  if (!el) return { el: null }
  if (cardId) return { el }
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
 * How far across the viewport a destination has to be before the trip is worth
 * routing through the background plane. A third of the width — "is he even near
 * it".
 */
export const BACKGROUND_HOP_FRACTION = 1 / 3

/**
 * Does this hop go the long way round, or straight there?
 *
 * ── WHY THERE IS A CHOICE AT ALL ─────────────────────────────────────────────
 *
 * `via: 'background'` pulls him back to the far plane and brings him in again.
 * Measured in the engine's own notes, a depth change is 24-27 world units while
 * every same-depth leg is under 3 — so the far-plane round trip is not a
 * flourish on a short hop, it is a trip that is ten times longer than the one
 * that was asked for, and `travelRate` plays it at the top of its ramp (2.95x,
 * `flight.ts:87`), which is the most dramatic leg the system has.
 *
 * ── ONE RULE, TWO CALLERS, AND THE SECOND ONE IS THE POINT ───────────────────
 *
 * `flyTo` has judged this since the distance threshold landed. `travelAfterRoute`
 * did not: it forced `via: 'background'` unconditionally on the grounds that
 * after a full page swap "there is no continuity to preserve by going straight."
 * That argument is about the PAGE, and the reader is watching the CHARACTER.
 *
 * Measured at the shipped desktop framing (1440x900, composer-derived character
 * height 216px, camera at 14.4 units), a `goTo` that lands on a card near the
 * middle of the new page cost **two** legs of 29-32 units — 2271 ms with his
 * body past 20 degrees off vertical for 610 ms of it — where going straight is
 * one 8.5-unit leg of 836 ms. He shrinks to the far plane and swells back to
 * full size in the middle of the screen, which is exactly the complaint:
 *
 *   "And that needs to be, like, a smooth animation. Right now, it wasn't. It
 *    kind of just, like, became big."                                    (C35)
 *
 * So the same question gets the same answer wherever it is asked. A destination
 * genuinely across the page still earns the long way round — that reading, "he
 * travelled", is what the round trip was for — and a destination he is already
 * standing near does not.
 *
 * ── MEASURED FROM HIM WHEN WE KNOW WHERE HE IS ───────────────────────────────
 *
 * The shipped rule measured the target against the middle of the VIEWPORT,
 * which is a proxy for "near him" that is only true while he is parked near the
 * middle. `screenRect()` answers the real question, so pass it when it is
 * available; `null` falls back to the proxy and reproduces the old answer
 * exactly, which is what a character who has not finished loading gets.
 */
export function viaBackground(
  fromX: number | null,
  targetCentreX: number,
  viewportWidth: number,
): boolean {
  // Written as `!(w > 0)` rather than `w <= 0` so a NaN viewport is refused too.
  // A target that is itself NaN needs no guard: every comparison against NaN is
  // false, so it falls out here as "not far", which is the safe answer — the
  // far-plane round trip is the expensive one and has to be earned.
  if (!(viewportWidth > 0)) return false
  const origin = fromX === null || !Number.isFinite(fromX) ? viewportWidth / 2 : fromX
  return Math.abs(targetCentreX - origin) > viewportWidth * BACKGROUND_HOP_FRACTION
}

/** Where he is on screen right now, or null if he has no resolved position. */
function himX(ctx: UiToolContext): number | null {
  const box = ctx.decke.screenRect()
  if (!box) return null
  return box.left + box.width / 2
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
        // is not. See `viaBackground` for the measurement and the reason the
        // same rule now governs the post-navigation flight too.
        //
        // The `flying` guard is this caller's own: chaining a far-plane round
        // trip onto a leg already in the air reads as him changing his mind
        // mid-flight, and the leg he is on already carries the travel.
        const here = ctx.decke.getState()
        const target = el.getBoundingClientRect()
        const far =
          !here.flying &&
          viaBackground(himX(ctx), target.left + target.width / 2, window.innerWidth)
        ctx.decke.flyTo(
          { selector: String(input.selector) },
          {
            // HE RESTS SMALL WHILE PRESENTING. The background depth system was
            // only ever used as a mid-flight waypoint; every destination
            // hard-coded 'foreground', so he swelled back to full size the
            // instant he arrived — "he's very big himself here, annoyingly
            // big." A presentation is pointing at someone else's content: he
            // parks on the far plane (a third of his size), the ring and the
            // bubble carry the message, and the content stays the subject.
            // The park solve, keep-out, screenRect and the beacon all take the
            // same depth-scaled distance, so everything downstream agrees.
            depth: 'background',
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
 * How long the new page has to stop changing before he sets off.
 *
 * ── STAGED, NOT SIMULTANEOUS ─────────────────────────────────────────────────
 *
 * The `MutationObserver` below fires on the FIRST mutation that makes the
 * selector resolve, and on a route change that is usually the skeleton, not the
 * content — a landmark on an empty grid that is about to grow rows, move, and
 * push everything below it. Flying at that moment is what put him "large,
 * centred, over a loading spinner" in C35's own frames: he solved a stand point
 * against a box that no longer existed by the time he landed on it.
 *
 * So the transition is staged — navigate, let the new page settle, THEN travel,
 * and the ring lands on arrival (`DeckE.flyTo` already rings from `onArrive`,
 * deliberately, "rather than racing him across the page"). Heer & Robertson
 * (IEEE TVCG 2007) measured staged transitions beating direct interpolation on
 * graphical perception across two controlled experiments; this is the cheap half
 * of that, and it is the half that was missing.
 *
 * 120 ms is a quiet window, not a delay: it is re-armed by every further
 * mutation, so a page that settles instantly waits 120 ms and a page that churns
 * waits until it stops — bounded by `LIMIT_MS`, which does not move.
 *
 * X1, ANSWERED EXPLICITLY RATHER THAN BY SILENCE: nothing here adds motion, so
 * there is no new reduce path to ship with it. Both changes in this pair make
 * the existing motion shorter and gentler, and the reduced-motion route is
 * untouched — `DeckE.flyTo` still cuts, and a cut lands on a settled page for
 * the same reason a flight does.
 */
/**
 * How long to wait for the page to stop scrolling before flying at something.
 *
 * ── THE RACE THIS CLOSES ─────────────────────────────────────────────────────
 *
 * There are TWO things that scroll this page on his behalf and they were never
 * introduced to each other.
 *
 * `DeckE.driveScroll` is the good one: `flyTo({ scrollWith: true })` solves a
 * scroll target and drives it from the flight's own clock, so the page moves
 * because he is moving. Its cancel is deliberately paranoid and its own comment
 * says why — "between frames `window.scrollY` should equal what the drive last
 * wrote; anything else is the reader's wheel, their trackpad, or a keyboard" —
 * and the reader is meant to win, instantly and permanently.
 *
 * The other one is `GridView`'s answer to a `decke:reveal`: a virtualized tile
 * does not exist until it is scrolled to, so the grid scrolls to it ITSELF, with
 * the browser's own `behavior: 'smooth'`. That scroll is not the reader and the
 * drive has no way to know it. So the sequence was: the grid starts a smooth
 * scroll, the tile mounts, the mutation observer settles 120 ms later with the
 * scroll still animating, `flyTo` solves its destination and its scroll target
 * against a rect captured MID-SCROLL, and on the drive's very first frame it
 * sees a `scrollY` it did not write and disarms itself for good.
 *
 * What that looks like is the report: "he goes to show me a card, but the
 * scrolling doesn't happen so he just dives off the page downward, leaving me
 * to scroll down myself. defeats the point." — and then, once the reader
 * scrolls down by hand, "his message is still there, but he's nowhere to be
 * seen", because he flew to a spot solved against a rect that had not finished
 * moving.
 *
 * Waiting for quiet is the whole fix: one writer at a time, and the rect he is
 * aimed at is the rect it will still be when he gets there.
 *
 * The cap is a bound, not a schedule. A page that never stops scrolling — an
 * infinite loader, a reader with their finger on the wheel — must not strand a
 * tool call, and flying at a moving rect is what he did before this existed, so
 * the fallback is the old behaviour rather than a failure.
 */
const SCROLL_QUIET_CAP_MS = 700

/**
 * Call `then` once the page's scroll offset has held still for two consecutive
 * frames, or the cap expires.
 *
 * TWO frames, not one: a smooth scroll's final frame and the frame after it
 * carry the same offset only once it has actually finished, and a single
 * sample cannot tell "arrived" from "a frame where it happened not to move".
 * The same shape the entrance's park-settle poll uses, and for the same reason.
 */
function whenScrollQuiet(then: () => void): void {
  // A FRAME, or a timer where there are no frames. `runUiTool`'s tests drive
  // this module against a hand-built `window` with no compositor behind it, and
  // a bare `requestAnimationFrame` there is a `ReferenceError` that surfaces as
  // the tool answering "requestAnimationFrame is not defined" — a real failure
  // mode for any host that is not a browser tab, not only for the tests.
  const frame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => window.setTimeout(fn, 16)
  const read = () => window.scrollY ?? 0
  let last = read()
  let same = 0
  const started = Date.now()
  const tick = () => {
    const now = read()
    same = now === last ? same + 1 : 0
    last = now
    if (same >= 2 || Date.now() - started >= SCROLL_QUIET_CAP_MS) {
      then()
      return
    }
    frame(tick)
  }
  frame(tick)
}


const SETTLE_MS = 120

/**
 * How long the destination may take to arrive before he shows that he is
 * waiting for it.
 *
 * THE DEAD AIR IS THE DEFECT, not the wait. `travelAfterRoute` is bounded at
 * six seconds and routinely uses a good fraction of that on a cold cache, and
 * for all of it he stood in whatever pose the last sentence left him in while
 * the panel was already collapsed to its bar. The owner, watching it back:
 * "waits way too long here to announce what he's showing… then the page just
 * suddenly becomes the actual thing I asked about — really broken feeling."
 *
 * `loading` is the authored answer to exactly this and has never once been
 * played — declared engine-owned in the model's own prompt, present in the
 * shipped playbook with its own spin rate, and reachable from nothing but the
 * dev preview. It is played here.
 *
 * 300 ms because a navigation that resolves faster than that has no dead air to
 * fill, and a spinner that flashes for two frames is worse than none. Roughly
 * the threshold the interaction literature puts on "did that respond?", and
 * comfortably longer than a warm same-origin route swap.
 */
const DEAD_AIR_MS = 300

/**
 * Wait for the destination to actually exist and stop moving, then travel to it.
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
    // ── ASKING FOR THE DESTINATION TO EXIST ──────────────────────────────────
    //
    // A virtualized tile is the one target that will not turn up on its own,
    // so waiting for it has to be accompanied by asking for it. See
    // `DECKE_REVEAL_EVENT` above for why this is an event and why it repeats.
    // Everything below this — the observer, the settle, the flight, the cap —
    // is untouched: the request only changes whether the thing being waited
    // for ever mounts, not what happens when it does.
    const cardId = revealCardId(selector)
    let asking = 0
    const ask = () => {
      window.dispatchEvent(
        new CustomEvent<DeckeRevealDetail>(DECKE_REVEAL_EVENT, {
          detail: { selector, cardId: cardId ?? undefined },
        }),
      )
    }
    // ONE EXIT, so the interval cannot outlive the wait down any of the four
    // paths that end it (found, refused, settled-but-gone, capped). An interval
    // that survives its promise would keep scrolling the reader's page for a
    // turn that finished.
    // ── SHOWING THAT HE IS WAITING ───────────────────────────────────────────
    //
    // Armed below, once, if the destination has not turned up promptly. Cleared
    // through `settle`, which is the one exit — the same reason the reveal
    // interval is cleared there.
    let waiting = 0
    let showedWaiting = false
    const settle = (result: UiToolResult) => {
      if (asking) window.clearInterval(asking)
      asking = 0
      window.clearTimeout(waiting)
      // A SUCCESS HANDS HIM OVER, A FAILURE HANDS HIM BACK. `go` has just
      // launched a flight whose `then: 'point'` owns his state from the moment
      // it lands, so clearing the posture here would fight it. Nothing was
      // launched on the failing paths, and a character left spinning over a
      // page he never reached is the dead air again with a costume on.
      if (showedWaiting && !result.ok) {
        try {
          ctx.decke.setState('idle')
        } catch {
          /* an engine mid-teardown must not take the tool's answer with it */
        }
      }
      resolve(result)
    }

    const go = (): boolean => {
      const { el, refused } = resolveTarget(selector)
      if (refused) {
        settle({ ok: false, reason: refused })
        return true
      }
      if (!el) return false
      // AFTER THE PAGE HAS STOPPED MOVING, and the measurement below is the
      // reason. `whenScrollQuiet`'s header has the full account; the short
      // version is that the reveal this tool just asked for is answered with
      // the grid's own smooth scroll, the settle above waits for DOM mutations
      // rather than for that scroll, and both the destination rect and the
      // flight's own scroll drive were being solved against a page still in
      // motion.
      //
      // The rect is therefore read INSIDE the callback, not out here: reading
      // it now and using it later is the same bug wearing a different hat.
      whenScrollQuiet(() => {
        const again = resolveTarget(selector)
        // The page moved for most of a second; the thing being pointed at may
        // not have survived it. Nothing to fly to is not an error worth
        // re-answering — `settle` below has already told the model he is on
        // his way — but flying at a stale rect is. He does have to stop
        // LOOKING like he is on his way, though: no flight will arrive to take
        // his state back off the waiting posture.
        if (!again.el || again.refused) {
          if (showedWaiting) {
            try {
              ctx.decke.setState('idle')
            } catch {
              /* an engine mid-teardown must not take the tool's answer with it */
            }
          }
          return
        }
        // THE SAME QUESTION `flyTo` ASKS, and it used to be answered here with
        // a hard-coded "always the long way round". `viaBackground` carries the
        // measurement and the reason; the short version is that forcing the
        // far-plane round trip made every navigation cost two 30-unit legs,
        // which is the "it kind of just became big" this is filed under (C35).
        //
        // A destination genuinely across the new page still gets it. That
        // reading — he travelled, the page changed under him — is what the
        // round trip was for, and it survives.
        const target = again.el.getBoundingClientRect()
        const far = viaBackground(himX(ctx), target.left + target.width / 2, window.innerWidth)
        ctx.decke.flyTo(
          { selector },
          {
            // Background, for the same reason the same-page `flyTo` case gives:
            // arriving on a new page to present something is still presenting,
            // and full size over fresh content is the "annoyingly big" the
            // owner filed. See the `flyTo` case above.
            depth: 'background',
            highlight: true,
            then: 'point',
            via: far ? 'background' : undefined,
            scrollWith: true,
          },
        )
      })
      settle({ ok: true })
      return true
    }

    // ALREADY ON THE PAGE. Nothing was replaced, so there is nothing to settle
    // and waiting would only make him look slow.
    if (immediate) {
      const { el, refused } = resolveTarget(selector)
      if (refused || el) {
        go()
        return
      }
    }

    // BOTH PATHS ARRIVE HERE, and both need the request. The waiting path is
    // obvious — the page is being replaced and the tile has never existed. The
    // `immediate` path is the one the owner actually hit: he was ALREADY on the
    // set page, the card was two thousand pixels below the fold, and the only
    // difference between that and a bad card id was that one of them could be
    // fixed by scrolling. Falling through to here means the selector did not
    // resolve, which is precisely when the reveal is worth asking for.
    //
    // Asking is unconditional rather than "only if it is missing" for the
    // navigating case: the outgoing page can still be mounted for a tick, so a
    // resolve-first test would read the OLD page's tile and skip the request
    // that the new page needs. A reveal for a card already sitting in the
    // middle of the screen is a no-op on the listening side.
    if (cardId) {
      ask()
      asking = window.setInterval(ask, REVEAL_RETRY_MS)
    }

    waiting = window.setTimeout(() => {
      try {
        ctx.decke.setState('loading')
        showedWaiting = true
      } catch {
        /* an engine mid-teardown must not take the tool's answer with it */
      }
    }, DEAD_AIR_MS)

    let quiet = 0
    const finish = () => {
      obs.disconnect()
      window.clearTimeout(timer)
      // Resolved again HERE rather than trusting the match that armed the
      // settle: the whole point of waiting is that the page moved, and the
      // element that armed it may have been replaced by the real one.
      if (!go()) {
        settle({ ok: false, reason: 'we are on the page, but I could not find that part of it' })
      }
    }
    const obs = new MutationObserver(() => {
      const { el, refused } = resolveTarget(selector)
      // A REFUSAL IS AN ANSWER, and waiting for the page to stop moving cannot
      // change it — the selector resolves to something he is not allowed to
      // point at, and it will still be that in 120 ms.
      if (refused) {
        finish()
        return
      }
      if (!el) return
      // Re-armed, not scheduled once: the first match is usually the skeleton,
      // and every mutation after it is the page still arriving.
      window.clearTimeout(quiet)
      quiet = window.setTimeout(finish, SETTLE_MS)
    })
    obs.observe(document.body, { childList: true, subtree: true })
    const timer = window.setTimeout(() => {
      obs.disconnect()
      window.clearTimeout(quiet)
      // He ARRIVED — the navigation happened. Only the last step failed, and
      // saying which half worked is the difference between "I took you there,
      // but I cannot find it" and an unexplained shrug.
      settle({ ok: false, reason: 'we are on the page, but I could not find that part of it' })
    }, LIMIT_MS)
  })
}
