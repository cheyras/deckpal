---
date: "2026-08-25"
title: "Deck-E as an agent: 91% of his tool errors were an id he had to guess"
decided_by: "Claude (Opus 5), from the owner's own transcript history read"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-25 — Deck-E as an agent: 91% of his tool errors were an id he had to guess
**Decided by:** Claude (Opus 5), from the owner's own transcript history read
end to end — 15 conversations, 65 turns, 275 tool calls, builds #80–#95 — after
the animation pass of the same day explicitly deferred this: *"this isn't for
you to fix. That's going to be in a different pass."* The owner's framing was
*"there are a lot of crappy responses going on, a lot of failed tool calls, and
a lot of rough spots where he doesn't feel that intelligent."* Plan reviewed by
an independent agent before implementation; six of its corrections were taken
and are noted below.

**Decision:** Six fixes, all from the record rather than from taste.

### What the record actually says

229 ok, 35 error, 8 declined, 2 partial. Plus 41 of 97 `search_cards` calls
returning "No cards match" — recorded `ok`, and useless. Two consecutive turns
spent their whole 12-step budget and shipped the canned "I went round in
circles" apology; the reader replied *"are you fucking retarded? What
happened?"* and, later and deliberately, *"For a future agent looking at this
whole exchange - this is a great example of a really piss poor agentic
experience."*

**32 of the 35 errors — 91% — were one bug: an identifier the model had to
guess.** Every entity tool keyed on an opaque id and users speak names.
`resolve.ts` had solved exactly this for CARDS; sets, decks and lists never got
it.

| tool | sent | times |
|---|---|---|
| `set_progress` | `none` | 7 |
| `set_progress` | `sv3pt5` | 9 |
| `set_progress` | `sv3.5`, `base`, `fossil`, `jungle`, `phantasmal` | 5 |
| `search_cards` | `sv3pt5`, `swsh` | 4 |
| `decks` | `dhelmise`, `slowking-toolbox`, `None`, a LIST's uuid | 5 |
| `battle_logs` | `slowking-toolbox` | 1 |
| `lists` | a DECK's uuid | 1 |

### Three of those loops were self-inflicted by our own error text

- **`'sv3pt5'` was offered as an example of a valid set id and is not one.**
  TCGdex's public spelling of `sv03.5`, copied out of migration 003's column
  comment into `search_cards`'s input schema and `set_progress`'s not-found
  message. The model read it from the schema — which it sees before making any
  call — tried it, was told "Set ids are TCGdex ids like 'me05', 'sv3pt5'", and
  tried it again. Nine times in one turn.
- **"call set_progress with NO set_id" came back as `set_id: 'none'`**, seven
  times, in the turn that produced no answer at all.
- **"that lists every set with its id" was false.** The no-argument overview is
  `HAVING max(owned_required) > 0` — only sets the reader already has progress
  in. For a set they own nothing from, which is exactly the set somebody asks
  about by name, every documented route to its id was a dead end. That is why
  *"show me how to get to phantasmal flames set"* took five turns for a set that
  exists as `me02`.

**Rules locked from this:** a failure message may never contain an invented
example identifier, and may never phrase advice as something that could be
mistaken for a value. Ids in a failure come from the caller's own data or are
absent. Migration 003's comment is the origin of `sv3pt5` and is checksummed, so
it stays; `entities.ts` records where the string came from.

### The six fixes

1. **`entities.ts`** — `resolveSet` / `resolveDeck` / `resolveList` in
   `resolve.ts`'s idiom. Every `set_id`, `deck_id`, `list_id` takes a name as
   readily as an id; a valid id is unchanged, so this is additive for MCP too.
2. **Fuzzy for reads, exact for writes.** A read that resolves the wrong set
   shows the wrong page. A write that resolves the wrong deck replaces the wrong
   deck's strategy guide — and `deck_strategy`, `add_battle_log` and
   `edit_battle_log` have no `dry_run`, with no approval dialog over MCP. Every
   write passes `strict`; a prefix or trigram hit comes back as a choice.
   (Taken from the review, which caught that the plan had not said this.)
3. **`repeat.ts`** — a per-request ledger. Identical failing calls repeated up
   to 14 times in one turn; these are deterministic reads and the second call
   cannot answer differently. It keys PROMISES, not results, because the repeats
   are often concurrent — 24 calls against a 12-step cap means several ran in one
   step, before any result existed. Writes are never deduped and a write drops
   the cache. Scope is one leg, documented as such: inferring from replayed text
   which past results were failures, and whether a write has happened since,
   risks serving a stale read, which is worse than the thrash.
4. **`declined.ts`** — a call the reader explicitly refused earlier in the
   conversation raises no second dialog, runs nothing, and is not charged.
   `research_meta` and `deck_strategy` were each declined four times, with the
   complaint written into the chat. NOT `activeTools` subtraction, which the
   review correctly called too strong: an absent tool is uncallable, so "go on
   then, do the research" would produce nothing, and the prompt still advertises
   it. An ABANDONED panel ("the reader did not answer") is not a refusal.
5. **`toolArgs.ts` + `decke_turn.tools.args`** — 043's four keys answered WHICH
   tool and HOW IT WENT and never WITH WHAT, which is where every defect above
   lived. They were recovered by reading error prose, and three of those messages
   were themselves the bug — fixing them removes the only channel the arguments
   were on. Bounded twice (120 chars per value, 800 per object, 1,200 at the
   route) and dropped whole rather than truncated, because half a JSON object is
   not queryable. No migration: 043's GIN index serves the new nested keys as-is.
6. **`repair.ts`** — `repairToolCall`, deterministic. `showScreen` failed schema
   validation five times in one turn while the model shortened the wrong field,
   because the surfaced message says WHAT broke and not WHERE. A validation
   failure never reaches `execute`, so the ledger cannot see it — this was the
   one thrash class the rest of the pass left standing. Only strings past a
   documented `maxLength` are mended, and the tool REPORTS the trim: this file's
   own rule is that a silently corrected model learns nothing.

Plus `search_cards`'s empty result, which said "Loosen the query or drop a
filter" 41 times without ever saying which. It now names the filters, re-counts
with each dropped to identify the one responsible, and recognises a SET name in
`query` — the commonest shape of those 41 — answering with the set and its id.

**Why:** The tool layer was correct and unusable. Nothing here makes Deck-E
cleverer; it stops him spending his turn re-asking questions our own messages
had taught him to ask wrongly.

**Implications:**
- `apps/mcp/SPEC.md` §3 and §4 carry the new identifier and resolution contract.
  Claude-over-MCP gets name resolution in the same commit, by construction.
- **Never quote an example identifier in a failure message**, and never phrase
  advice as something a model could send back as a value. Both are now spec.
- `ToolEvent` gained a `declined` phase — already the transcript's and the
  client's word for a refused call; `toolRowState.ts`'s own comment anticipated
  it. Its `-declined` id-suffix bridge can now be deleted when `useDeckeChat`'s
  `deny` starts emitting the phase directly.
- `needsApproval` on the data tools and the deep tools is a PREDICATE now, not
  `true`. `false` means "raise no dialog", never "run it": `execute` refuses the
  same call using the same predicate. The sub-agent safety test read
  `needsApproval === true` as a property and would have passed for a function
  that always answered false — it now calls it.
- The repeat ledger, the repair log and the declined set are all per request and
  never module state. A shared one would be a cross-account read.

### What the adversarial review found, before merge

The finished branch built, typechecked and passed every suite. It was reviewed
hostilely anyway, and that found **two production incidents CI could not see**.
Both are recorded because both are the same shape: a change that is correct in
the case it was written for and destructive one step outside it.

1. **The resolver broke RESTORE.** `GET /decks` and `GET /lists` exclude
   soft-deleted rows, and resolution had been inserted in FRONT of the restore
   branch in `delete_deck` and `edit_list`. A deleted deck's own uuid matched no
   live row, `UUID_RE` correctly refused to fuzz it into a name, and the handler
   failed before reaching `POST /:id/restore`. `delete_deck`'s own success
   message tells the reader how to undo it — and following that instruction
   answered "No deck matches". Migration 038 exists so that "an agent deleted my
   deck" is recoverable; this made it unrecoverable from the agent surface.
   A restore now resolves against the bin (`deleted: true`).

2. **`strict` was not exact for non-Latin names.** `foldName` stripped
   everything outside `[a-z0-9]`, which deletes Japanese, Chinese, Korean,
   Cyrillic and Greek entirely — so every such name folded to `''` and two
   unrelated names compared EQUAL under the one flag standing between a fuzzy
   match and a rewritten deck. On a catalogue for a Japanese game. Fixed with
   `\p{L}\p{N}`, a blank-fold guard, and NFC recomposition so a dakuten is not
   read as punctuation.

**The rule this adds, and it is the general one:** a fold or a normalisation is
an equality claim, and any input it maps to the empty string is an input it
claims is equal to every other such input. Guard the degenerate output, not just
the interesting one.

Four smaller findings fixed in the same commit: `repairToolCall` clamped strings
on all 36 tools while only `showScreen` reported it (a stored strategy guide
would have been silently truncated — allowlisted now); a declined write still
ran its dry run and emitted an orphan approval preview; `battle_logs` printed
logs with no deck named after a loose match; and two sed-rename artifacts leaked
an internal variable name into tool output.

