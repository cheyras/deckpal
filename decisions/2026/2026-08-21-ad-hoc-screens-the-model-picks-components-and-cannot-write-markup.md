---
date: "2026-08-21"
title: "Ad-hoc screens: the model picks components, and cannot write markup"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["agents","frontend"]
supersedes: []
---
## 2026-08-21 — Ad-hoc screens: the model picks components, and cannot write markup
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** `apps/api/src/decke/screens.ts` defines a closed palette of seven
blocks (`heading`, `text`, `cardGrid`, `statTile`, `progress`, `status`,
`empty`) with typed props. A screen is a title and 1-8 blocks. Unknown kinds are
refused by the schema; malformed blocks are dropped with a reason and the rest
of the screen still renders.

**The guarantee is structural, not a filter.** There is no field anywhere in the
schema that carries HTML, a class name, a style, a URL or a selector — so there
is nothing to inject into and nothing to sanitize. A test asserts the exact
field list, so that adding an interpreted field is a deliberate act someone has
to walk past rather than an accident.

**It cannot look like slop for the same reason.** Every block is a component the
design system already owns; the model chooses arrangement, never appearance.
`Sheet` is deliberately absent from the palette — it is the container a screen
is rendered inside, not a block a model picks.

**Flat with a `kind` enum**, matching `tools.ts`. `validateBlock` enforces what
the flat schema cannot express (a `statTile` needs both a label and a value;
`quantities` must line up positionally with `cards`), and rejects rather than
clamps — a quantity below 1 is not a card anyone owns, and silently correcting
it teaches the model nothing.

**One bad block does not take the screen down.** These are usually "here is what
I just added", so losing a panel is a shame and losing the confirmation that
their cards went in is a bug report.

Seven tests, wired into CI as a new pure step.

---

