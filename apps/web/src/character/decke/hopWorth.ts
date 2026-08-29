/**
 * IS THIS MOVE A JOURNEY, OR IS IT A CORRECTION?
 *
 * ── WHY THE QUESTION HAS TO BE ASKED AT ALL ──────────────────────────────────
 *
 * `shapeFor` gives every flight a vertical arc, and its floor is a constant:
 * `0.18 + dist * 0.06`. At zero distance that is still 0.18 — so a re-park of a
 * few pixels got the same rise-and-descend as a trip across the page. The owner,
 * on watching it happen through a keyboard transition:
 *
 *   *"He should never have to do a little hop when the keyboard comes up or goes
 *    away... right now it seems like even if he moves like 10 pixels relative to
 *    where he's supposed to be, he does a hop. Hop is really for when he is
 *    PURPOSELY traveling somewhere, like to show off something in the UI, or to
 *    go from the chat button and back. It's not intended to be used for tiny
 *    page shifts."*
 *
 * That is a statement about MEANING, not about smoothness, and it is why the
 * fix is a threshold rather than a softer curve: a hop is punctuation. Spending
 * it on a composer that grew by one line is the animation equivalent of
 * shouting, and no amount of easing makes a shout quieter.
 *
 * ── MEASURED AGAINST HIM, NOT AGAINST THE SCREEN ─────────────────────────────
 *
 * The threshold is a fraction of HIS OWN HEIGHT, and that is the whole of why
 * it needs no per-device tuning. He is dollied to a pixel height that already
 * tracks the viewport and the composer, so "a quarter of him" is the same
 * apparent nudge on a 390px phone and a 1600px desktop, where any fixed pixel
 * count would be a shrug on one and a lurch on the other.
 *
 * A quarter, because of where the real cases fall. At his default 300px that is
 * a 75px threshold:
 *
 *   a layout settle, 5-20px            slides   — invisible, as it should be
 *   the composer growing a line, ~24px slides   — he is standing on its edge
 *   rising over an approval card       HOPS     — 150px+, and the owner asked
 *                                                for that one by name: *"I'd
 *                                                like him to jump up above the
 *                                                permission prompt"*
 *   the beacon, or a walk to a card    HOPS     — hundreds of px, the real
 *                                                thing this animation is for
 *
 * ── WHAT IT DOES NOT COVER ───────────────────────────────────────────────────
 *
 * A keyboard opening moves the composer ~300px, which is over the line — and it
 * still must not hop, because it must not be a FLIGHT at all. He tracks his
 * mark rigidly through a viewport change (`DeckE`'s `visualViewport`
 * listeners); that is a different mechanism, upstream of this one, and this
 * threshold is the second line of defence rather than the first.
 */

/**
 * How much of himself he has to be asked to move before it reads as travel.
 *
 * NOT A SMOOTHNESS KNOB. Raising it does not make small moves prettier, it
 * makes larger deliberate moves stop reading as deliberate.
 */
export const HOP_MIN_FRACTION = 0.25

/**
 * The floor, for when his height is not known yet.
 *
 * `characterHeightPx` is null between construction and the host's first
 * measure, and a null that disabled hopping would silently turn his arrival
 * into a slide on exactly the frames an arrival matters. 18px is small enough
 * that nothing deliberate falls under it and large enough to still swallow the
 * settle-sized moves this exists for.
 */
export const HOP_MIN_PX = 18

/**
 * Does a move of `screenPx` deserve the arc?
 *
 * `screenPx` is the distance the SILHOUETTE travels, not the world distance —
 * a move straight at the lens covers world units and almost no screen, and
 * arcing through it would be a hop the reader can only interpret as a glitch.
 */
export function worthHopping(screenPx: number, characterHeightPx: number | null): boolean {
  if (!Number.isFinite(screenPx)) return true
  const height =
    characterHeightPx !== null && Number.isFinite(characterHeightPx) && characterHeightPx > 0
      ? characterHeightPx
      : null
  const threshold = height === null ? HOP_MIN_PX : Math.max(HOP_MIN_PX, height * HOP_MIN_FRACTION)
  return screenPx >= threshold
}

/**
 * The path for a move that is not a journey: straight, and flat.
 *
 * `cruise` is `shapeFor`'s own short-move value, kept so a glide is paced by
 * the same controller as everything else and only its SHAPE differs. Zero arc
 * and zero bow is the whole difference between a slide and a hop.
 */
export const GLIDE_SHAPE = { arc: 0, bow: 0, cruise: 0.1 } as const
