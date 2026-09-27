---
date: "2026-08-21"
title: "Committing a rip: resolve, then ONE write"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Committing a rip: resolve, then ONE write
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** `ripCommit.ts` resolves every scanned `cardId` to a `variantId` in
parallel via `api.card()`, then writes the whole pack with a single
`POST /collection/batch`. `api.collectionBatch()` is new on the client; the
endpoint already existed.

**The two halves of the feature spoke different languages.** `/scan` identifies
a CARD (`"sv8pt5-1"`) and `/collection/batch` owns VARIANTS (`37183`) — one card
can have several: normal, reverse holo, a promo stamp. Nothing bridged them, and
it needed no API change: `api.card()` already returns `variants[]`.

**Which variant, absent an instruction, is the primary one** — and that is not a
convention invented here. `POST /collection/cards/:cardId/have` makes the same
choice in SQL via `card_variant.is_primary`, so a card added by the scanner and
the same card added by the Have toggle land in the same row rather than two.

**One request is correctness, not speed.** Called per item the per-variant
endpoints cost ~0.65 s each, measured in production, which put a 99-item batch
past the serverless wall clock: the caller saw a dead stream, the database saw
most of the writes committed, and the retry inflated quantities up to 4x.
`/collection/batch` exists because of that. The idempotency key is derived from
the session's own contents so a retry of a half-succeeded request is a no-op.

**An unresolvable card is named, never dropped.** The other nine cards in the
pack are still the reader's and still belong in their collection.

**Rip mode never pauses.** The single-card loop stops itself after two stable
frames (`Scan.tsx:308`), which is right when you are checking one card and wrong
for a pack. In rip mode every frame goes to `ripSession.onFrame` and the loop
keeps running.

