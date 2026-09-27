---
date: "2026-08-29"
title: "UI preferences move to the account; localStorage becomes the cache"
decided_by: "maintainer (2026-08-29 walkthrough recording; deferred item now built)"
areas: ["images","frontend"]
supersedes: []
---
## 2026-08-29 — UI preferences move to the account; localStorage becomes the cache

**Decided by:** maintainer (2026-08-29 walkthrough recording; deferred item now built)

**Decision:** The five device-local UI preferences — Deck-E visibility, skin,
top bar, and the Series index's sort/direction/grouping — are stored on
`user_settings` (migration 049) and served by `GET`/`PATCH /me/settings`. The
profile showcase moves off `deckpal.showcase.v1` onto the `user_showcase`
table that has existed since migration 005, via `GET`/`PUT /me/showcase`.
localStorage is demoted to an offline cache: the synchronous readers
(deckePreference/skin/topbar/series prefs) are unchanged, and
`lib/settingsSync.ts` applies the account's values over them on boot and on
sign-in, with a one-time upward migration of existing local choices (flagged,
so it happens once) and write-through from every toggle.

**Why:** The owner: "I'd like this to not be remembered on this device only…
a settings table per user, row level security… prep work for a proper
settings page." The DeckeVisibility card literally had to caption itself
"remembered on this device only — signing in elsewhere shows him again."
Both halves of the fix already existed as schema: `user_settings` (005, RLS
in 021, row per signup) and `user_showcase` (005, RLS in 021) — the work was
columns and endpoints, not tables.

**Implications:** `skin`/`topbar` columns are NULLable — NULL means "no
explicit choice, follow the app default", so `DEFAULT_SKIN`/`DEFAULT_TOPBAR`
stay flippable in code without a data migration. PATCH validation is strict
(a typo'd value is a 400, never a silent reset), unlike the query-param
`oneOf()`. The upward migration flag (`deckpal.settings.pushed.v1`) is set
only after a successful round trip, so a failed first sync retries. Docs:
API.md §Account, research/SCHEMA.md §9.1 note.

