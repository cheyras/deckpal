---
date: "2026-08-22"
title: "Nine defects that only a deployment could find"
decided_by: "Claude (Opus 5), on behalf of @cheyras. Recorded because the"
areas: ["operations"]
supersedes: []
---
## 2026-08-22 — Nine defects that only a deployment could find
**Decided by:** Claude (Opus 5), on behalf of @cheyras. Recorded because the
pattern matters more than any individual entry.

**The code was "done" and every test was green.** 88 API tests, 183 web tests,
typecheck clean across nine workspaces, CI and CodeQL passing, a byte-identical
`tools/list` proof for the refactor, and an adversarial security review. Then it
was deployed to a preview and asked real questions, and nine things were wrong.

None of them were found by tests. Several could not have been.

| What was wrong | Why no test caught it |
|---|---|
| The approval ANSWER was destroyed on the wire — `{type:'tool-approval-response'}` is read by `isToolUIPart` as a call to a tool named "approval-response", so consent produced a failed leg and no write | The tests pinned the POLICY (which tools need approval) and the SDK's HOLD (`execute` ran 0 times). Nobody drove the ANSWER through `convertToModelMessages` |
| `showScreen` fired three times per turn, twice with a newline-wrapped title | Only appears at `stepCountIs(12)` with real lookups between speaking and acting |
| He printed the `showScreen` payload as a fenced JSON block in his reply | Model behaviour; no code path is wrong |
| "out July 17 **next year**" for a set released five weeks earlier | Nothing told him today's date, and no test asserts a tense |
| Four wasted tool calls guessing set ids before finding `me05` | Each call succeeded; only the sequence was wasteful |
| **`search_cards` with an unknown `set_id` returned "no cards match"**, so he said "No Basic Grass Energy in Pitch Black — checked the catalog, nothing matches" | Every layer behaved correctly; an unknown id is just another WHERE clause |
| The approval prompt asked permission for a change it never described | The control worked perfectly; it was simply silent |
| **The client gate asked `me.owner` while the server gated on the entitlement list**, so Deck-E was invisible to the only account permitted to test him | Each layer was right ALONE. Health said `owner-plus-list`, curl got 200, the UI showed nothing |
| Two `unref()`d timers that let Node exit mid-race, cancelling ten tests | Passed locally every time; failed on CI, where different things keep the loop alive |

**The one worth reading twice** is `search_cards`. The sentence that started this
whole effort was "No 'Pitch Black' set in Pokémon TCG" — a model asserting
absence from memory. What the deployment produced was "No Basic Grass Energy in
Pitch Black — checked the catalog, nothing matches", which is the SAME CLAIM,
now with a real tool call behind it that really did return nothing. It is worse
than the original, because it looks sourced. An empty result under a filter that
could never match is not evidence, and the tool now says so in those words.

**Why the gates are a program and not a checklist.** `AGENTS.md` says "verify the
artifact, not the report", and the report is what was wrong last time. Every one
of these was found by reading what the deployed thing actually said and
comparing it against the database — never by asking whether the code looked
right. It looked right throughout.

**Implications.** `scripts/decke-gates.mjs` is kept and is the thing to run
before any future change to this feature. The QA account is seeded so its
figures are falsifiable, and `GET /me` now returns `decke` so the client and
server gates cannot drift apart again — that last one is not a nicety: it made
the feature untestable by the one account B12 permits to test it.

