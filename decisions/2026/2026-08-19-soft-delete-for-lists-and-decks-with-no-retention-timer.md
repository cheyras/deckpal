---
date: "2026-08-19"
title: "Soft delete for lists and decks, with no retention timer"
decided_by: "Claude (on behalf of @cheyras). Migration 038."
areas: ["decks"]
supersedes: []
---
## 2026-08-19 — Soft delete for lists and decks, with no retention timer
**Decided by:** Claude (on behalf of @cheyras). Migration 038.
**Decision:** `card_list.deleted_at` and `deck.deleted_at`. Delete hides the row
and keeps it; `?purge=true` is a real DELETE and the one deliberate no-undo path
in the API. `delete_deck` no longer takes the deck's version history and every
battle log with it by default.

**Retention is indefinite, and said out loud.** "We keep it 30 days" would need
a scheduled sweeper this project does not have, and an unenforced retention
promise is worse than an honest indefinite one: it reads as "gone soon" while
the rows sit there forever. Indefinite retention is a real privacy consequence,
so it is stated in SECURITY.md and the purge path is reachable from every
surface that can delete — REST, MCP, and a "Recently deleted" section on the
lists and decks indexes with Restore and Delete-forever. An agent that can undo
something the user cannot is a worse deal, not a better one.

**Enforced by a source guard.** `__tests__/soft-delete.test.ts` fails CI if any
`FROM`/`JOIN` on either table lacks a `deleted_at` predicate and lacks a
`-- soft-delete-exempt: <reason>` marker. Writes-by-id are out of scope and the
test says so: every one is preceded by a locking existence check (`assertDeck`,
or the route's own `SELECT … deleted_at IS NULL … FOR UPDATE`), and that check
is the guard.

