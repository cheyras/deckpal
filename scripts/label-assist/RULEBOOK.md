# Label-assist rulebook: how the owner labels a frame

You are pre-labelling photos for the owner's quad labeler. The owner reviews
every one of your answers afterwards, and your answer is only a suggestion.
Even so, a wrong suggestion costs them more time than no suggestion, so be
right, and say "low" confidence when you are not sure.

## What you look at

Each item is a review image (`<id>.review.png`):

- **LEFT panel: the square to label.** This is exactly the square the owner
  will see in the labeler. A cyan grid marks every 10% (labels 0–100 on the
  top and left edges). If the scanner's detector found something, its
  proposal is drawn in red with corners numbered 1–4. The bottom strip gives
  the detector's presence score (0–1).
- **RIGHT panel: the whole photo,** for context, with the proposed square as
  a yellow dashed box. Its grid is % of the photo. Validation items have no
  right panel.

Also look once at `owner-examples.png`: 26 frames the owner labelled
themselves, with their quad in green, the card's top-left corner marked with
a magenta dot, and their verdict above each frame. Match how they did it.

## The verdict: decide in this order

1. **Is there a card front or back at all?**
   - Nothing card-like: `reject` + `no_card`.
   - Something card-LIKE that is not a card (a booster pack, a box, an
     envelope, a binder cover, a phone screen, a person, a deck box):
     `reject` + `not_a_card`.
2. **Is there ONE card that is clearly the subject?**
   - A binder page, a table spread, a grid of slabs or toploaders, or a pile
     where no single card stands out: `reject` + `multiple_no_clear_foreground`.
     This is the owner's most common rejection.
   - Several cards, but ONE is clearly the intended subject (held up in a
     hand, lying on top of a pile, in front): that card is the subject. Go
     on to step 3 with it.
3. **Can its four corners be placed confidently?** If yes, the verdict is
   `card`, or `back` for the back of a Pokémon card (the blue swirl and
   Poké Ball). If no, `reject` with the reason that says why:
   - `cut_off`: part of the card is outside the photo itself. If it is only
     outside the left SQUARE but inside the photo, that is not cut_off: see
     "Crop" below.
   - `too_obscured`: a corner cannot be seen, or more than about a third of an
     edge is hidden (fingers, another card, an object). Fingers across the
     artwork with all four corners clear are a `card`.
   - `too_blurry`: a human could not place the corners. Blurry but still
     placeable is a `card`.
   - `too_far`: the card is so small in the frame that corners cannot be placed.
   - `too_dark`, `glare_washout` (glare hides the card's edges), `too_oblique`
     (seen nearly edge-on), `too_bent` (visibly bowed, so straight edges do
     not describe it).

## Corners, for `card` and `back`

The quad goes on **the printed card's own outer edge**:

- Not the sleeve, toploader, magnetic holder or graded slab. In a PSA or CGC
  slab, the quad is the card inside, not the slab and not its label.
- A card on top of a pile: that card's edges, not the pile's.
- A rotated or tilted card: follow its edges (the quad need not be axis-aligned).

**The detector's red proposal is often wrong in exactly these cases.** On the
owner's 116 labelled cards the detector was a median of 11 px (of 416) off. It
locks onto slabs, sleeves, piles and the card underneath.

- **`proposal: "accept"`**: the red quad sits on the subject card's outer edge
  at all four corners, within about 1% of the square. Then give `top_left`:
  the red number at the card's own top-left, meaning where the card's name or
  title begins when the card is held upright. A card shown upside down has its
  top-left at the bottom-right of the image.
- **`proposal: "fix"`**: otherwise. Give your own `corners` as percentages of
  the LEFT panel, with one decimal, e.g. `[[31.5, 18.0], [68.2, 17.4], [69.0,
  82.3], [30.8, 83.1]]`. **Start at the card's own top-left and go clockwise
  in the card's orientation** (top-left, top-right, bottom-right,
  bottom-left). Read them off the grid carefully. A tool snaps them to the
  card's edges afterwards, but only from within a few pixels, so get them
  close.

## Crop: only when the queue item has a right panel

`crop: "ok"` when the whole subject card is inside the left square, or the
verdict is `reject`.

`crop: "card_cut_off_by_square"` when the card is a valid subject, whole in
the photo (right panel) but cut by the square. Then give `photo_corners` as %
of the right panel's photo grid, top-left first and clockwise, as above. The
tool re-crops around it.

## Output

Write ONE JSON file for your batch: an array with one object per item, in the
order given.

```json
{
  "id": "1790219629889",
  "verdict": "card | back | reject",
  "reason": "null, or one of: no_card, not_a_card, multiple_no_clear_foreground, cut_off, too_obscured, too_blurry, too_far, too_dark, glare_washout, too_oblique, too_bent",
  "proposal": "accept | fix | none",
  "top_left": "1-4 when proposal is accept, else null",
  "corners": "[[x,y] x4] in % of the LEFT panel when proposal is fix, else null",
  "crop": "ok | card_cut_off_by_square",
  "photo_corners": "[[x,y] x4] in % of the photo when crop is card_cut_off_by_square, else null",
  "confidence": "high | medium | low",
  "note": "under 12 words: what you saw"
}
```

`proposal` is `none` for every `reject`. Use `high` only when the owner would
surely agree.

## The owner is stricter than the rules above (measured on 59 of their labels)

- **Blur:** they rejected as `too_blurry` a card whose text is smeared by
  motion or focus blur, even when its outline looked placeable. Reserve `card`
  for frames where the card's text is reasonably crisp.
- **Fingers:** they rejected as `too_obscured` a card with a finger or thumb
  over or touching a corner, or over part of an edge. Fingers only across the
  artwork, with all four corners and edges clear, are still a `card`.
- **When torn between `card` and one of those two rejections,** say
  `confidence: "low"`.

# Pass 2: placing corners exactly (`<id>.corners.png`)

The sheet's LEFT panel is the whole square for context. The red quad is the
current guess, with corners numbered. The four panels on the RIGHT are
close-ups of each numbered corner:

- 1 = the card's top-left, 2 = top-right, 3 = bottom-right, 4 = bottom-left,
  in the card's own orientation.
- Each close-up is a small window of the square, magnified. The grid runs
  0–100 across and down, a line every 10.
- The small red ring at (50, 50) is where the corner currently is.

For each corner, find where the **printed card's own outer edges** meet, not
the sleeve's, toploader's or slab's. For rounded card corners, use where the
two straight edges would meet if extended. Report that point in the
close-up's units, to one decimal. Report (50, 50) if the ring is already
right.

If the close-ups show the verdict was wrong (a corner is actually hidden, the
card is cut off, or the edges are a smear), set `verdict` to `reject` with the
reason. Otherwise leave `verdict` as `card` or `back`.

Output: ONE JSON array for the batch, one object per item, in order:

```json
{ "id": "1789100551977", "verdict": "card", "reason": null,
  "corners": [[52.0, 48.5], [47.5, 51.0], [50.0, 62.5], [49.0, 50.5]],
  "confidence": "high", "note": "corners 3,4 were above the real bottom edge" }
```
