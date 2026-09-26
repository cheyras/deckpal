---
date: "2026-08-27"
title: "The narration leak filter derives its tag list instead of holding a copy of it"
decided_by: "Claude Opus 5 on behalf of @cheyras (issue #90, PR pending)"
areas: ["general"]
supersedes: []
---
## 2026-08-27 — The narration leak filter derives its tag list instead of holding a copy of it

**Decided by:** Claude Opus 5 on behalf of @cheyras (issue #90, PR pending)

**Decision:** `apps/api/src/decke/narration.ts` no longer holds a hand-written
`TOOL_TAGS` literal. It derives the alternation from a new
`COSMETIC_TOOLS` export in `decke/tools.ts` — the union of `SERVER_TOOLS`
(`express`, `showScreen`) and the existing `CLIENT_TOOLS` — and both halves are
pinned by `tools.test.ts` against the structural property that decides them
(whether the tool has an `execute`). `narration.test.ts` closes the loop from
the other side: it reads `Object.keys(buildTools(…))`, the tool registry itself,
and asserts every name is stripped as a plain element, behind a namespace
prefix, and as a `name="…"` attribute.

**Why:** The literal said seven while `buildTools` exposed nine. `journey` and
`escort` were added later and nobody came back to the filter, so for as long as
those two tools had existed a model that wrote `<journey>…</journey>` or
`<xai:escort>…</xai:escort>` as prose reached the reader in full — the exact
defect the file exists to remove, reintroduced by an unrelated feature. Nothing
failed to say so: not a type error, not a test, not a log line. The comment even
carried the count (`OUR seven tool names`), which is a fact with an expiry date
sitting next to the thing that expires it.

A test alone would have caught the drift, but a derivation makes it
unrepresentable, and the repo already pays for the same connection twice
(`CLIENT_TOOLS` ↔ `buildTools`, and the web mirror in `uiTools.ts`). Deriving
costs one import: `narration.ts` was dependency-free and now pulls `tools.js`
(and through it `ai`, `zod`, `prompt.js`, `screens.js`). No cycle — nothing in
that chain imports `narration.ts` — and both existing importers, `beats.ts` and
`api/chat.mjs`, already load `tools.js` anyway, so the hot path pays nothing new.
`scripts/check-functions.mjs` confirms all four serverless functions still load.

**Scope deliberately NOT taken.** The model holds 36 tools: 9 cosmetic, 23 data,
4 deep. This covers the 9. The other 27 are model-callable and could leak the
same way, but their names are ordinary English — `decks`, `lists`, `health`,
`revert` — and the attribute rule strips a WHOLE ELEMENT on a bare `name="…"`
match. Widening to them trades a leak nobody has measured for false positives on
prose that happens daily, which is precisely the "stripping pass to get wrong"
that `tools.ts` warns about. That is a separate call needing its own evidence,
and it is written into `narration.ts` as an explicit boundary rather than left
as an omission.

**Regex safety, checked rather than assumed.** `TOOL_TAGS` is interpolated into
four patterns with no escaping pass, so two properties have to hold and both are
now tested: no name contains a regex metacharacter (asserted over the registry,
so a future `get*` fails loudly instead of silently widening the pattern), and
no name can shadow a longer one — every use follows the alternation with `\b` or
with the closing quote of a `name="…"`, which is why `<journeyman>` and
`<input name="escorted">` still survive.

**Implications.**
- Adding a tool to `buildTools` now REQUIRES updating `CLIENT_TOOLS` or
  `SERVER_TOOLS`; three tests fail otherwise, one of them naming the real
  consequence ("`<newtool>` leaked as an element").
- `narration.ts` is no longer a leaf module. Anything importing it for the
  filter alone now pulls the tool registry with it.
- Nothing about the observable filter behaviour changed for the seven names that
  were already listed; the 316-test `test:decke` suite passes unchanged at 323.

---

