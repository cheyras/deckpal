---
date: "2026-08-27"
title: "GLC's Classic Collection carve-out is enforced, and it outranks the reprint oracle"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["decks"]
supersedes: []
---
## 2026-08-27 — GLC's Classic Collection carve-out is enforced, and it outranks the reprint oracle
**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision.** `apps/api/src/deck/formats.ts` gains `ruleSetCarveouts`, which
enforces the `set_carveouts` block that `glc-rules.json` has carried since the
data was vendored (DECK-FORMATS §2.3.4 item 5). It runs in the GLC extras and
emits `NOT_IN_FORMAT` for any `cel25cc` print whose normalized name is not in
`except_names` — today, anything that is not Reshiram or Zekrom. The
"vendored, not yet enforced" annotations the 2026-08-24 hygiene pass left on
`SetCarveout` in `data.ts` are gone, because they are no longer true. Closes
issue #93, which that pass filed.

**Why it was a real user-facing bug, not dead data.** The GLC pool rule
(`ruleSetAllowancePool`) passes a card three ways: set prefix, regulation mark,
or the reprint oracle (§2.1.5). `cel25cc` matches no GLC prefix and its prints
carry no regulation mark — but **every** Classic Collection card is a
fingerprint-identical reprint of an older print, which is the exact condition
the reprint oracle exists to wave through. So against the real catalogue, where
`db.ts` supplies a live oracle, the whole set validated as GLC-legal: a
legality **false-negative**, the app telling a user an illegal deck is legal.
The pure test suite never saw it, because a test with no oracle injected gets a
`NOT_IN_FORMAT` from the pool rule for an unrelated reason and looks fine. The
new fixtures inject `isInFormatByReprint: () => true` — the production shape —
so the carve-out is the only thing standing between the deck and a wrong
"legal".

**Why the carve-out is a hard deny rather than another pool escape hatch.**
§2.3.6 item 5 defines the GLC pool as Black & White onward **minus** the
§2.3.4 carve-outs. Subtraction, not another way in — so the deny is evaluated
ahead of the oracle, and `ruleSetAllowancePool` now takes an optional
`carvedOut` predicate and stays quiet about those cards so one illegal card
produces one violation row, not two saying the same thing.

**Matching keys, stated explicitly, because the mirror-image bug is worse.**
The deny keys on `setTcgdexId`; the exception keys on `normalizeName(name)` —
the same keys bans (§2.2) and exclusive groups (§2.3.4 item 2) already use in
this file. Getting that wrong in the other direction (matching the deny on name
alone) would fail every Blastoise ever printed — a false *positive*, which is
worse for a user than the gap being fixed. There is a fixture for exactly that.
Basic Energy is skipped, per §3.3's unconditional exemption, consistent with
every other pool rule here. Carve-out `mode`s other than `deny_except` are
ignored rather than guessed at, so §2.3.4 item 6 (the Pokémon TCG Classic
fingerprint allow) can be vendored later without this rule mis-reading it.

**Implications.**
- No new violation code: `NOT_IN_FORMAT` already covers "outside this format's
  card pool" and the §5.6 enumeration is unchanged, so no API or frontend
  change rides along. `detail` carries `set`, `carveout_mode`, `except_names`
  and the vendored note as `source_text`.
- A GLC deck holding a non-excepted Classic Collection card now reports
  **Not Legal** where it previously reported legal. That is the fix, but it is
  a visible verdict change for any stored deck in that shape.
- `data.test.ts` pins the carve-out's set id to the same id the PTCGL alias
  table maps `CEL-CC` to. A carve-out keyed on a set id fails **silently** if
  upstream re-keys the set — the Trainer Gallery rename class, except the
  failure mode here is the false-negative above rather than a wrong print.

**Verified.** `test:deck` 68/68 (the carve-out fixture fails before the change:
`expected illegal, got []`, and passes after), plus the full CI-equivalent
sequence green locally: builds of `@deckpal/db`, `@deckpal/storage`,
`@deckpal/agent-tools`; workspace-wide `tsc --noEmit`; `test:images` 33,
`test:decke` 316, `test:variants` 61, `test:adapter` 7, `check-functions` 4/4,
web `test:decke` 618, `test:insights` 12, `test:pure` 61, storage 11,
`test:auth` 36, images 8; builds of web and images. No UI change to capture —
this is a validator verdict, rendered by the existing `LegalityPanel` rows.

---

