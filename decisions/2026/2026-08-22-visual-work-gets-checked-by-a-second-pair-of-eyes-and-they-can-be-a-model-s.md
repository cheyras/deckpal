---
date: "2026-08-22"
title: "Visual work gets checked by a second pair of eyes, and they can be a model's"
decided_by: "Chey, implemented by Claude Opus 5"
areas: ["agents"]
supersedes: []
---
## 2026-08-22 — Visual work gets checked by a second pair of eyes, and they can be a model's

**Decided by:** Chey, implemented by Claude Opus 5

**Decision:** Add `scripts/visual-harness/` — an operator-run harness that
captures screenshots, records interactions, tiles a recording into a contact
sheet, and can put a falsifiable claim about the result to a vision model
(`judge-motion.mjs --assert`, exit 0 pass / 1 fail / 2 unclear). It sits beside
`scripts/decke-gates.mjs` and follows the same rule about Playwright: resolved
at runtime via `PLAYWRIGHT_MODULE`, never a declared dependency, never in CI.

**Why:** `decke-gates.mjs` already answers *"did the thing actually happen?"* by
hooking the network, because this codebase shipped a character that narrated
actions the browser never received. There is a second version of that same
failure one level up: an agent captures a screenshot and then asserts, from
memory, that the animation worked. Nothing checked the pixels. That gap is
exactly where "he should scale up from zero and travel" and "he is facing the
wrong way" live — claims no unit test can reach and no `page.url()` can settle.
A contact sheet plus an independent reader closes it.

Two things made this worth building rather than eyeballing. Chromium can be made
to report real safe-area insets (CDP `Emulation.setSafeAreaInsetsOverride`,
measured at 47px top / 34px bottom against the live page), so the mobile overlay
defects are reproducible in automation after all — earlier analysis had
concluded they needed a physical iPhone. And a vision model, given a contact
sheet, reliably distinguishes "the panel expanded" from "the panel was always
open", which is the whole question for most of this work.

**Implications:**

- **The judge is optional and degrades, it does not gate.** Without
  `AI_GATEWAY_API_KEY` the harness still produces every artifact and
  `judge-motion.mjs` exits `3` — deliberately distinct from fail (`1`) and error
  (`4`) so a caller can tell *"the change is wrong"* from *"nobody checked."*
  Collapsing those two is how an unverified change gets recorded as a passing
  one. Collaborators without a vision model API lose the automated verdict and
  nothing else.
- **Spend lands on the shared `AI_GATEWAY_API_KEY`, never
  `DECKE_VERCEL_AI_GATEWAY_KEY`.** Deck-E's key exists so his per-user spend
  stays legible; dev tooling must not pollute that number. ~$0.01–0.03 a call.
- **A model verdict is evidence, not a fact.** Assert things a human could
  settle by looking for two seconds; treat a `fail` as a reason to go and look.
  The raw answer and model id are in the output so a human can overrule it, and
  `unclear` is a first-class answer because a confident wrong verdict is worse
  than an admission when the point is catching where belief and pixels disagree.
- **This does not replace `AGENTS.md` verification standard 1.** Desktop and
  390px, and you actually look. The harness makes that repeatable and gives an
  agent a way to be caught out.
- **A real device is still the final word** on `backdrop-filter` compositing
  under a translucent status bar. Chromium approximates the geometry; it does
  not reproduce the compositing.
- **No new runtime env var, so B11 does not apply** — `AI_GATEWAY_API_KEY`
  already exists and is already declared, and nothing deployed reads it. Nothing
  in `package.json`, the lockfile, or `ci.yml` changed; the only tracked
  additions are the harness itself and six `.gitignore` lines for
  `.visual-harness/` artifacts, matching the existing `.gate-shots/` convention.

