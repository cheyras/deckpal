---
date: "2026-08-19"
title: "Recovering the 2026-08-12 interface tuning pass"
decided_by: "agent, at the user's request, after the user asked whether a"
areas: ["general"]
supersedes: []
---
## 2026-08-19 — Recovering the 2026-08-12 interface tuning pass
**Decided by:** agent, at the user's request, after the user asked whether a
stash left on `design-system` mapped to the open design issues.

**What this was.** A tuning pass driven by a screen recording on 2026-08-12 was
applied to `design-system`, never committed, and left in a stash. The branch
merged into main without it and the branch was deleted. Everything in it was
then reported again from the app as issues #41-#48 — including #47, which says
outright "I have a feeling there were other things I specifically did on purpose
in that design system branch that somehow didn't get merged in".

**What landed here, and what did not.** While this was being merged, main
independently fixed several of the same things — the sheen-scaffolding layer
(#44), the Tabs underline padding (#42), the Pokedex ProgressBar (#43) and the
LevelRing inline-position revert. Those versions are main's and were kept as-is;
the recovered pass's equivalents were dropped rather than re-litigated. In
particular the recovered pass guarded the position rule with
`:not([class*='absolute'])`, which works but only for classes literally
containing those substrings; main's `@layer components` is the better remedy and
is what survives.

**What was genuinely still missing, and is what this commit is:** the recessed
left-pointing back plate (#46, absent from theme.css entirely), the set header
without its art wash, the full-bleed set-logo section on series rows (#47), the
collapsed nav rail centring the mark and cross-fading it with the expand control,
the card modal's "In this deck" leading tab, the deck-history diff in brand
rather than status colours, and the Insights change labels.

**A note on merge discipline.** `origin/main` moved 41 commits between the stash
being cut and the first rebase, and another 9 during the work itself. The second
batch is what made half of this redundant. Re-checking upstream immediately
before pushing is what caught it; one of those checks was a false positive from a
loose grep (main's dynamic `aria-label` matched a search for the new rail's
button) and only reading the surrounding markup showed the rail fix was still
absent. Grep for a change's mechanism, not its label.

