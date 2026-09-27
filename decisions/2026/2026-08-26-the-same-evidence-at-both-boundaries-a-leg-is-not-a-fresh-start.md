---
date: "2026-08-26"
title: "The same evidence, at both boundaries: a leg is not a fresh start"
decided_by: "Claude (Opus 5), from the owner’s report on a turn that mostly"
areas: ["general"]
supersedes: []
---
## 2026-08-26 — The same evidence, at both boundaries: a leg is not a fresh start
**Decided by:** Claude (Opus 5), from the owner’s report on a turn that mostly
went well: *"I asked him to show the current deck list, and he made a really
nice looking little widget… but then for some reason he attempted a flyTo,
which isn’t at all necessary after creating an in-chat widget. And then after
that he produced just a plain table decklist, and it was split into multiple
responses."*

**Decision:** The compacted lookup record is replayed between the LEGS of a
turn, exactly as it already was between turns. Three symptoms, one cause.

### What a leg is, and what it was throwing away

A tool the browser has to run — `flyTo`, `goTo`, `journey` — has no server
`execute`, so it ends the stream. The client runs it and re-sends the
conversation for him to continue. That second request is a leg, and it was
built as **his text, plus the movement’s own result, and nothing else**:

```ts
const parts: WirePart[] = []
if (outcome.text.trim()) parts.push({ type: 'text', text: outcome.text })
for (const call of outcome.pending) { /* client tool call + result */ }
```

So the moment he flew anywhere he lost every server tool he had just run. In
the reported turn: `decks` → nine `search_cards` → `showScreen` (the panel) →
`flyTo` → **`decks` again**, then the decklist written out a second time in
prose. Two rules should have stopped that and neither could fire:

| rule | where it lives | why it could not apply |
|---|---|---|
| *"when a panel carries the answer, do not also narrate it"* | `prompt.ts` | he no longer knew a panel existed |
| *"the panel is on screen. Do not repeat its contents in words"* | `showScreen`’s return value | the tool result did not cross the boundary |

**A rule cannot apply to evidence that was thrown away before it was read.**

### The fix already existed, one level up

`messagesToWire` has replayed this between TURNS since the transcript work, and
its own comment says why: *"turn N+1 had no record that turn N had read 604
cards — only its own prose about them."* The same sentence with s/turn/leg/ was
live the entire time. The helper is now `chat/lookupRecord.ts` with two callers
and real unit tests, rather than a loop inside the function that had the
insight first.

Only the calls a leg ADDED are replayed. Chips live on the reply message for
the whole turn, so replaying all of them each leg would send leg 1’s record
again on leg 2 and a third time on leg 3 — the same reading arriving three
times reads as three readings, which is the drift the record exists to prevent.

### Two more gaps, found because they hid this one

**`showScreen` and `express` had never once appeared in the transcript.** Not
rarely — zero times, across the owner’s entire recorded history. Chips come
from `buildDataTools`’ execute wrapper; these two are built by `buildTools` and
spread in beside them, so they emitted nothing. The turn above therefore read,
in the record, as nine searches and a flight with **nothing visual in it at
all**, which sent the first diagnosis looking in the wrong place. It also
matters beyond the record: a chip’s summary is what gets replayed, so a panel
that emits no chip is a panel the next leg cannot be told about.

**The movements recorded no `args`.** `toolArgs.ts` added arguments for the
data tools on the argument that `{name, phase, title, summary}` answers WHICH
and HOW IT WENT and never WITH WHAT. The movements were left out — and they are
the calls where the argument IS the event. All six `flyTo` calls in the history
carried null args, so "which landmark did he reach for" was unanswerable, and
the empty object printed in its place was read, in the first pass over this
turn, as a malformed call that had never happened. It was a recording gap.

### And `finishReason` was read, used, and discarded

The recorded reply ended mid-word — *"…cuts/adds for v"*. Three explanations
fit and the record could not separate them: the client’s keepalive trimmer
(which stamps a mark, and had not fired), the model’s 1200-token output budget
against a step carrying a sixty-card panel, or a cut stream. The diagnosis had
to be written as a hypothesis with its reasoning shown, because the one value
that says outright — returned on every single call — was used for control flow
and dropped. Migration 046 adds `decke_turn.finish_reason`; NULL means "not
reported", never "finished cleanly".

**Implications:**
- The column is optional AT RUNTIME. Migrations are run by hand (DEPLOYMENT.md
  §2) and Vercel deploys on merge, so between those moments the code names a
  column that does not exist. The write is fire-and-forget with its errors
  swallowed, so the history would have stopped silently and stayed stopped. One
  retry without the column and a loud warning naming the migration — the B11
  shape applied to schema rather than configuration.
- 046 is deliberately NOT `@supabase-only`, unlike 044 and 045 beside it. Those
  are RLS policies; this is a column on a table 043 created everywhere. Marked
  Supabase-only it would have broken exactly the self-host deployments nobody
  is watching. Caught before merge by checking 043’s own marker.
- Nothing here touches WHY he chose to fly after drawing a panel. The prompt
  rule for that is about narration, not movement, and with `args` now recorded
  the next occurrence will at least say where he was going.
