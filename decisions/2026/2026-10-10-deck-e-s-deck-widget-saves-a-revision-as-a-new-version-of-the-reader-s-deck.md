---
date: "2026-10-10"
title: "Deck-E's deck widget saves a revision as a new version of the reader's deck"
decided_by: "@cheyras, on an audit of the deck widget; built by Claude Opus 5.5."
areas: ["agents", "decks", "frontend"]
supersedes: []
---
## 2026-10-10 — Deck-E's deck widget saves a revision as a new version of the reader's deck
**Decided by:** @cheyras, on an audit of the deck widget; built by Claude Opus 5.5.

**Decision:** `showDeck` takes an optional `deck_id` and `version_note`. When the server finds that deck among the reader's own (`ownedDeck` in `apps/api/src/decke/deckCheck.ts`: the reader's token, RLS, strict match), it adds `base: { id, name }` to the deck block. The widget then leads with "Save as new version" and an editable note (prefilled with Deck-E's), with "Save as a separate deck" as a quiet secondary action. The version save goes through `POST /decks/save` with `newVersion: true`. That route already resolves every card first, writes in one transaction and keeps printings and pins, and it re-checks ownership (`404` otherwise). `newVersion` always lands a CHANGED list as the next version, even on an unplayed version; a list the deck already matches writes nothing; the response carries `bumped`. Without a `base` — a brand-new deck, an id that is not the reader's, or no way to check — the widget is exactly what it was: "Save to my decks" through `/decks/import`.
- `base` and `versionNote` are server-only. `showScreen`'s schema has no field for them, `sanitizeScreen` strips them, and `sourceSync.test.ts` names them as the only renderer fields the schema lacks.
- The next turn is told which version the save landed on, or that nothing changed (`savedDeckRecord`), and the chat notice says the same (`savedLine`).
- Also fixed: `api/chat.mjs` passed `toolCtx` to the shared `checkDeck(ctx, …)`, and `toolCtx` has no `api`. `apps/api/src/decke/deckCheck.ts` now takes the turn's options and builds the tool `Ctx` (`withToolCtx`), the path `check_deck` already used.

**Why:** The audit was right on every point, checked in the code. The prompt tells Deck-E to show every revised deck with `showDeck`, and the widget's Save (`deckSave.ts`) could only import a NEW deck. So "make a v2 of my Dragapult deck based on my results", saved from the widget, became a twin, and the version history, version notes and battle logs stayed on the original. Only the approval-held `save_deck` with a `deck_id` versioned the deck. Forcing the bump follows the 2026-09-26 revert ruling: amending in place is for stepper noise, and a whole revision the reader saves on purpose would otherwise erase the only copy of an unplayed list. The ownership check is on the server twice because the Save has no approval card: the reader's click is the consent, so which deck it writes over is the thing a model must not be able to choose. Separately, reproduced: the shared `checkDeck` given chat's `toolCtx` throws "Cannot read properties of undefined (reading 'send')". `showDeck` catches that and answers NOT SHOWN, so as wired the widget could not render at all. `tools.test.ts` never saw it because it hands `buildTools` a fake `checkDeck`; `deckCheck.test.ts` now calls the real one over HTTP in chat's shape.

**Implications:**
- Deck-E passes `deck_id` only if told to. The prompt and pathway texts belong to other branches, so they need one line: when `showDeck` shows a revision of one of the reader's decks, pass that deck's `deck_id` and a one-line `version_note`.
- The version save keeps the deck's name and format; the shown list's name and format are not sent. A count change on a card the deck holds as two printings is refused whole, as for `save_deck`, and the widget shows the API's sentence.
- A retry after a lost response finds the deck already matching and reports "already matches · v3" rather than "Saved v3"; no twin version is made.
- `POST /decks/save` responses gained `bumped`, and the mutation batch stores it. Replays of results stored before this change answer `false`.
- Proof: `reach.mjs` (real Postgres) covers v1 kept on an unplayed save, a pinned printing surviving, a battle log staying on v2, the unchanged no-op and its replay, the old amend rule, and another account's `404`. `tests/browser/deckeDeckWidget.mjs` (`decke-deck-widget` suite) covers Chromium 1440 and 390 and WebKit 390.
