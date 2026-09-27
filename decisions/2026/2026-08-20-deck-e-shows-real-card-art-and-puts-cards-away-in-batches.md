---
date: "2026-08-20"
title: "Deck-E shows real card art, and puts cards away in batches"
decided_by: "user, in a follow-up to the Deck-E interface pass."
areas: ["agents","images","decks","catalog"]
supersedes: []
---
## 2026-08-20 — Deck-E shows real card art, and puts cards away in batches
**Decided by:** user, in a follow-up to the Deck-E interface pass.
**Decision:** the cards he handles carry the user's ACTUAL card art from the
catalog rather than the AI-generated placeholders baked into the glb, the card
back is the real Pokémon TCG back, and a stash of more cards than fit on screen
plays as a sequence of batches rather than being clamped to what fits.

**Why it is a respecification and not a texture swap.** The stash flight exists
because "they add a whole bunch of cards to their collection, and this is his way
of showing the actual cards they added going down into the deck box." A card that
is not one of the cards they added is a decoration; the whole beat only means
anything if the reader recognises what is going in. That also decides the batch
question: clamping thirty cards to twelve would show twelve of the user's cards
and silently drop eighteen, which is worse than showing none, because it looks
correct.

**Three facts about the asset shaped `cardArt.ts` and are worth keeping.**
`Card_Front_Rose3` is ONE material shared by `Card_Loose_Rose_anim` and all five
`Stash_Card_*` meshes, and three clones share materials by reference — so a
texture assigned naively lands on every card at once, which is precisely the
failure this feature must not have. The unwrap is a clean 0..1 on both faces but
the V axis is glTF's, so a texture made the obvious way (`flipY` defaults true)
comes out upside down. And `materials.ts` binds `emissiveMap = map` on the fronts
to tint the holographic foil by the artwork, so `map` and `emissiveMap` have to
move together or a card glows in the shape of a card it is not showing.

**The CORS trap is the same one the bug reporter's screenshots hit** (see
2026-08-10). Card images are requested from the same-origin `/deckpal/images/…`,
which on cloud 302s to Supabase Storage on another origin; a plain `<img>` with
no `crossOrigin` — which is every card in the app — leaves an OPAQUE entry in the
HTTP cache, and WebGL refuses to upload an image that is not origin-clean. A
texture fetch of a URL the card grid has already rendered would fail on cloud
only, after the user had scrolled past that card, and never in dev. The fix is
the same shape: a marker query parameter so the texture has its own cache entry.
Both image tiers ignore unknown query parameters. The cost is that cards Deck-E
shows are cached twice, which is a handful of images.

**Batching.** `BATCH_MAX` is `MAX_STASH` (12) and that coupling is asserted in
`__tests__/batches.test.ts`, because the no-interpenetration proof for the fan
only covers batching while the two are equal. Every batch but the LAST is a
self-contained cycle — launch, hang `holdMs`, gather, file in — and the last
batch is exactly the animation that was reviewed and signed off: it hangs, and
its close is the state's outro, so the lid shutting and the final cards diving in
stay the single authored beat they were written as. `autoClose` decides who ends
the run; the card system only ever REQUESTS the close (`wantsClose`), because
closing him is the state machine's job.

`MAX_RUN` is four batches, 48 cards, and past it the rest are dropped with a
`console.warn` and a `notes[]` entry back to the model. Someone importing two
hundred cards is not owed a two-minute animation, and the alternative to a cap is
that the character is unavailable for other work for minutes at a time. Silence
was not an option: a model told only `applied: 1` would narrate that all two
hundred went in.

**`runCommands` became async**, which is a real change to the surface. It had to:
`cards: ["sv3pt5-25", …]` is a catalog lookup, and the file's own rule is REJECT
LOUDLY — an id that does not exist can only be reported by waiting to find out.
Ids and never image URLs, so a model cannot express "load this arbitrary image
into the page".

**The card back is the one asset here that is not ours** — © Nintendo /
Creatures / GAME FREAK. It lives at `apps/web/public/models/decke/card_back.webp`
rather than in the image service, because it is a fixed graphic with nothing to
key on, warm or invalidate, and `models/**` is already outside the PWA precache.
Provenance and how to regenerate it are in that directory's `CREDITS.md`. The
source PNG's rounded corners are fully transparent and the card material is
opaque, so it is composited over the back's own border navy first — otherwise the
corners render as four black notches.

**What review caught, because it is the interesting part.** A Fable code review
and my own passes found the same three defects independently, and all three were
the batching work quietly breaking a rule the pre-batching code already had.
(1) The LRU eviction was a `while` loop with no bound — if every settled texture
were bound to a visible card it would spin forever, hanging the tab; it is one
pass now, and going over the limit is the correct outcome when nothing is free.
(2) Re-issuing `card_stash` with a NEW set of cards was swallowed by the "a state
you are already in is a no-op" guard, so the run sat pending and he went on
holding up the previous batch while `runCommands` reported success — silently
showing the wrong cards, which is the one failure this feature cannot have. A
pending run now counts as a real change and takes the outro-then-enter path, so
the old lot files in first. (3) Worst: interrupting a run during a NON-FINAL
batch froze twelve cards rigid in mid-air — float and all — for the length of the
outro, and then deleted them at the state change. The batch clock freezes at the
outro on purpose (an unlaunched card must not spawn inside the animation that is
putting things away) and the close was reading that frozen clock. Two clocks can
start a close and they COMPOSE rather than choose; `closeProgress` is pure and
exported for exactly that reason, and its property test is that the number it
returns never goes backwards, over every batch shape and every interrupt moment.

Review also found the `deck` face asking for the LARGE image on every landing —
a fetch nothing had preloaded, twelve of them during the most motion-dense beat
of the animation, evicting the next batch's warm textures on the way. Only
`card_r` is drawn big enough to need it. And `idAt()` did not revert to "nothing"
when a texture failed to load, so the one caller who cannot look at the screen
would be told the card that 404'd was up.

**One review finding turned out not to be a defect, and chasing it made things
worse before it was measured properly.** A visual pass reported the stash fan
interpenetrating at twelve cards, with two pairs overlapping by 3-10% of a card.
Both that measurement and the property test it appeared to contradict were
PROXIES: they project each card to an axis-aligned box and ask whether the boxes
overlap. A card is a rotated, tilted quad, and `splayPerX` turns the outer ones
by up to 30 degrees, so its box is nearly half again its real footprint. Tuning
the depth constants until the proxy went green made the REAL minimum separation
worse — 0.166 units down to 0.058 at seven cards — which is only visible if you
measure the quads. So the constants are unchanged, and the test now measures
closest approach between the two quads directly, in Blender coordinates, where
the layout is expressed.

Driven through the real render pipeline for forty seconds of hang at every batch
size, the closest any two cards ever come is 0.050 units against a card 0.006
thick. Nothing intersects, at any count, at any moment. What the visual pass saw
is one card in FRONT of another, which this layout has always allowed on purpose
— a hand of cards reads correctly and a wall of evenly-spaced ones does not.

**And the asset did not ship, which is the part worth recording.**
`.gitignore` carries a blanket `**/*.webp` for the fetched card-image cache, and
it swallowed the card back silently — `git add -A` said nothing, the commit
looked complete, the local build worked because the file was still on disk, CI
passed, and it 404'd only in production. `apps/web/public/marketing/` had already
needed the same negation for the same reason and says so in a comment; this was
the second instance.

**And `.gitignore` was only half of it.** `.vercelignore` carries the same
blanket `*.webp`, with the same marketing negation, above a comment predicting
exactly this outcome — "the deployed hero/accents 404 into their CSS gradient
fallbacks with no build-time error". Two independent lists, and fixing one leaves
the asset in git and still absent from the deploy. That state is not observable
from a local build, from CI, or from `git status`: only from a build log.

So `scripts/check-precache.mjs` gained a second gate, and the two are the same
check from opposite directions: the first says a character asset must never ship
to every visitor, the second says it must actually ship at all. The gate found
the `.vercelignore` half within minutes of being written — it failed the Vercel
deploy while the identical tree built cleanly from a fresh clone using
`vercel.json`'s own buildCommand, and that discrepancy IS the finding. It scans the
character's own source for `models/decke/<file>` references — including the ones
written as template literals, which is most of them — and fails the build if any
is absent from `dist`. A build from a fresh clone is what CI and Vercel both are,
so that is where this would have been caught.

**Known and deliberate.** The default cards come from `/collection/events`, which
is an activity FEED and not an owned-cards table: it biases toward recent
acquisitions and will not surface a card bought a year ago. It is the only
endpoint that returns owned cards across every set with images attached in one
request, and for "two random cards the user owns" behind a spinner the bias is a
feature. If a real owned-cards listing appears, `cardSource.ts` is the one file
that changes.

