/**
 * The one file in this character that knows DeckPal exists.
 *
 * `cardArt.ts` takes URLs and puts them on cards. Something has to turn "the
 * cards they just added" and "sv3pt5-25" into URLs, and that something has to
 * know about the catalog, the collection and the image service. Keeping it to a
 * single module is the point: everything else here would survive the product
 * changing its mind about where card images come from, and this would be the
 * file that changed.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not cache textures (that is
 * `cardArt`), it does not decide which card goes where (that is the caller), and
 * it never throws for a card it cannot find — a missing card resolves to `null`
 * and the slot keeps its placeholder. A character animation is the last place
 * that should be able to break a page.
 */
import { api, type CollectionEvent, type SearchCard } from '../lib/api'
import type { CardArt } from './decke/cardArt'

/** Turn the two image URLs the API returns into one piece of art. */
function toArt(
  id: string,
  images: { low: string | null; high: string | null } | undefined,
  name?: string,
): CardArt | null {
  const front = images?.low ?? images?.high
  if (!front) return null
  return { id, front, frontLarge: images?.high ?? front, name }
}

/**
 * The cards this user most recently ADDED, newest first.
 *
 * The feed is an activity log, so three things have to be filtered out and each
 * of them is a card that would otherwise be wrong on screen: a removal (they
 * took it out — showing it going IN is a lie), a quantity decrease (same), and a
 * second event for a card already in the list (the same card twice in one fan
 * reads as a rendering bug, not as "you own two").
 */
export async function recentlyAdded(limit = 12, signal?: AbortSignal): Promise<CardArt[]> {
  const res = await api.collectionEvents(Math.min(200, Math.max(limit * 3, 24)), signal)
  const seen = new Set<string>()
  const out: CardArt[] = []
  for (const e of res.events as CollectionEvent[]) {
    if (e.quantityDelta <= 0) continue
    if (seen.has(e.cardId)) continue
    seen.add(e.cardId)
    const art = toArt(e.cardId, e.images, e.cardName)
    if (art) out.push(art)
    if (out.length >= limit) break
  }
  return out
}

/**
 * A few cards the user owns, in no particular order.
 *
 * "By default it can just pick two random cards that the user owns" — for the
 * `loading` orbit, where the two cards are decoration that should nonetheless be
 * THEIRS. Drawn from the same activity feed, because it is the only endpoint
 * that returns owned cards across every set with images attached in one request;
 * see `api.collectionEvents`. That biases toward recent acquisitions, which for
 * a spinner is a feature — those are the cards they care about this week.
 *
 * `Math.random` and not the seeded PRNG on purpose: this is a fresh draw per
 * page load, not part of the animation, and making it reproducible would mean
 * the same two cards forever.
 */
export async function randomOwned(n = 2, signal?: AbortSignal): Promise<CardArt[]> {
  const pool = await recentlyAdded(Math.max(n * 6, 24), signal)
  return shuffle(pool).slice(0, n)
}

/**
 * Resolve catalog card ids to art, in the order asked for.
 *
 * An id that does not resolve comes back as `null` rather than throwing or being
 * dropped — dropping would silently shift every later card into the wrong slot,
 * which is the kind of bug that looks like a layout problem for a week.
 */
export async function artForIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<(CardArt | null)[]> {
  return Promise.all(ids.map((id) => artForId(id, signal)))
}

/** Resolved cards, so a repeated stash of the same batch costs one request each
 *  and a re-run costs none. Card art is immutable, so there is nothing to
 *  invalidate. */
const byId = new Map<string, Promise<CardArt | null>>()

export function artForId(id: string, signal?: AbortSignal): Promise<CardArt | null> {
  const hit = byId.get(id)
  if (hit) return hit
  const p = api
    .card(id, signal)
    .then((res) => toArt(res.card.cardId, res.card.images, res.card.name))
    .catch(() => {
      // Not cached: a 404 is permanent but a network blip is not, and the whole
      // point of this path is that the next attempt should be allowed to work.
      byId.delete(id)
      return null
    })
  byId.set(id, p)
  return p
}

/**
 * A random handful from the whole catalog, for the dev page's randomiser.
 *
 * Two requests the first time (one to learn how many pages there are, one to
 * fetch a random one) and one thereafter. `pageCount` is remembered rather than
 * re-derived because the catalog does not grow during a session, and the search
 * endpoint caps `page` at 100000 anyway.
 */
let pageCount = 0

export async function randomCatalog(n: number, signal?: AbortSignal): Promise<CardArt[]> {
  const pageSize = 60
  if (!pageCount) {
    const first = await api.searchCards(
      new URLSearchParams({ page: '1', pageSize: String(pageSize) }),
      signal,
    )
    pageCount = Math.max(1, first.pagination.pageCount)
  }
  const page = 1 + Math.floor(Math.random() * pageCount)
  const res = await api.searchCards(
    new URLSearchParams({ page: String(page), pageSize: String(pageSize) }),
    signal,
  )
  const arts = (res.cards as SearchCard[])
    .map((c) => toArt(c.cardId, c.images, c.name))
    .filter((a): a is CardArt => a !== null)
  return shuffle(arts).slice(0, n)
}

/**
 * "His real cards" for anything that plays `card_stash` without being told
 * WHICH cards — the ACTIONS panel's bare `card_stash` button, and a command
 * turn that says `{op:'state', value:'card_stash'}` with neither `cards` nor
 * `count`. "For some reason, these are all fake cards... default needs to not
 * be fake cards" — the AI-generated placeholders baked into the glb are the
 * fallback now, never the picture.
 *
 * THE FALLBACK CHAIN, in order: the cards this user just added (what the
 * stash flight is FOR), then a random draw from what they own (recently
 * added covers everyone whose activity log has anything in it; this covers
 * an account whose collection predates the log), then a random handful of
 * the catalog (still real Pokemon, just not theirs yet — better than a
 * fabricated one for a signed-out visitor or a brand new account). Empty
 * only when every one of those failed, in which case the caller's own
 * placeholder fallback is exactly right.
 */
export async function defaultStash(n: number, signal?: AbortSignal): Promise<CardArt[]> {
  try {
    const recent = await recentlyAdded(n, signal)
    if (recent.length) return recent
  } catch {
    // Fall through to the next rung — see FAILURE IS SILENT AND TOTAL above.
  }
  try {
    const owned = await randomOwned(n, signal)
    if (owned.length) return owned
  } catch {
    // Fall through.
  }
  try {
    return await randomCatalog(n, signal)
  } catch {
    return []
  }
}

/**
 * Fill his four single-card slots with cards this user owns.
 *
 * "By default it can just pick two random cards that the user owns" — for the
 * `loading` orbit, which is the pair. The other two come from the same draw
 * because they are visible in the same breath: `single` is the card inside him
 * and `deck` is the face on top of the stack in the box, and leaving those on
 * AI-generated placeholders while two real cards orbit an inch away is worse
 * than either being placeholder or both being real.
 *
 * FAILURE IS SILENT AND TOTAL, deliberately. Signed out, offline, an empty
 * collection, a 500 — every one of them ends with the cards he already had, and
 * the character does not know anything went wrong. There is no state of this
 * app in which a decorative texture is worth a broken page or a console full of
 * red, and a user with no collection yet is the FIRST person to see this
 * character, not an edge case.
 */
export async function applyDefaultCards(
  decke: {
    setCardArt(slot: 'card_l' | 'card_r' | 'single' | 'deck', art: CardArt | null): void
  },
  signal?: AbortSignal,
): Promise<CardArt[]> {
  let cards: CardArt[] = []
  try {
    cards = await randomOwned(4, signal)
  } catch {
    return []
  }
  if (!cards.length) return []
  // Fewer than four owned cards repeats rather than leaving a placeholder in the
  // middle of three real ones — which reads as one card failing to load.
  const slots = ['card_l', 'card_r', 'single', 'deck'] as const
  slots.forEach((slot, i) => decke.setCardArt(slot, cards[i % cards.length]))
  return cards
}

/** Fisher-Yates, on a copy. */
function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
