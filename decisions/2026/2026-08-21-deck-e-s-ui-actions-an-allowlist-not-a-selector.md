---
date: "2026-08-21"
title: "Deck-E's UI actions: an allowlist, not a selector"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["agents","decks","frontend"]
supersedes: []
---
## 2026-08-21 — Deck-E's UI actions: an allowlist, not a selector
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** the tools Deck-E runs in the browser (`flyTo`, `highlight`,
`goTo`, `scrollToMe`) resolve targets ONLY through elements carrying
`data-decke-landmark`, and navigate only to an allowlisted route. Their results
come back to the model as a follow-up turn.

**Why an allowlist rather than a selector.** A CSS selector is a capability:
`document.querySelector` will happily return the sign-out button or a token
field, and the text he reads — card names, deck descriptions, lists other people
have shared — is attacker-influenceable. Marking the elements he may reach
inverts the default from "anything not forbidden" to "nothing not offered",
which is the only version that survives a card being NAMED something hostile.
The check is duplicated client-side, not because the server's is unreliable, but
because the check that matters is the one nearest the thing it protects: the
browser function is what actually changes the URL of an authenticated session.

**Why results go back at all.** These are tools rather than fire-and-forget
commands precisely because they can FAIL, and every result is phrased as a
sentence he can say — "there is nothing like that on this page", "we are on the
page, but I could not find that part of it". A model told nothing narrates a
thing that did not happen. ONE follow-up round: each re-bills the whole system
prompt, and a model that needs three attempts to point at something will not
find it on the fourth.

**"After the route settles" is not an event the router can give you.** A route
renders, its data resolves, and the list it renders appears — seconds later on a
cold cache, or never on an empty page. `goTo` therefore watches for the element
with a bounded MutationObserver (6 s) and, on timeout, reports which half
worked, because "I took you there but cannot find it" is a different fact from
a shrug.

**The speech bubble is solved, not placed.** It reads three rectangles — his,
the highlight's, and the viewport — prefers above him, falls through to below
and then the sides, rejects any candidate overlapping the highlight, and clamps
into the viewport. Degenerate case (a highlight filling the screen) takes the
least-bad candidate, because some of the words beats none of them. Six tests in
`character/host/__tests__/bubble.test.ts` pin it, including the one that matters:
the target sitting exactly in the preferred slot, where the solve has to reject
its own first choice. `pnpm --filter deckpal-web test:decke` now runs the host
tests too — 142 total.

---

