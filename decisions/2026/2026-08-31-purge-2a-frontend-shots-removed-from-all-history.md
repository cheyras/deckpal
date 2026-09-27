---
date: "2026-08-31"
title: "Purge 2a: frontend-shots removed from all history"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-31 -- Purge 2a: frontend-shots removed from all history

**Decision.** `research/frontend-shots/` (98 PNGs of DeckPal UI rendering real
card art; 93 blobs, ~37 MB of history weight, present on every branch) was
removed from the repository history with a single `git filter-repo --invert-paths --path research/frontend-shots/` pass over a fresh mirror, and
every branch was updated to the rewritten history. Only SHAs changed; commit
messages, authorship and dates are preserved verbatim. The path is now
gitignored, with a README tombstone in place.

**Archives, made and verified before the rewrite:** the offline mirror
`deckpal-mirror-2026-08-31.git` (fsck-clean, all pre-rewrite tips recorded) and
the media-corpus archive `foil-video-reference-archive-2026-08-31/` (387/387
files sha256-verified against MANIFEST.sha256), both outside git. The wiki page
`Foil-Branch-Log` snapshots all 8 foil/* branches (465 commits, 76,291 words)
with their pre-rewrite tip SHAs; SHAs cited anywhere before this date resolve
against the mirror.

**Fork note.** `suwari2000/deckpal`, a public fork created 2026-08-30, holds
the pre-rewrite objects (all 8 foil branches and the frontend-shots media) and
is outside this repository's control. GitHub's server-side copies of the old
objects also remain fetchable by direct SHA until garbage collection; a support
ticket covering the rewrite and the upcoming branch deletion (purge 2b) will
request GC and raise the fork.

**pkmn.gg history question -- closed (tip-only).** The 2026-08-26 entry left
open whether the pkmn.gg text mentions in already-public history warranted a
rewrite. Decided now: no. The working tree was cleaned at the tip (PR #150);
the text-only exposure in history does not justify a second rewrite round, and
the single rewrite budget was spent on the 37 MB media above. This closes the
open item rather than deferring it a third time.

---

