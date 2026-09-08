# frontend-shots (removed)

This directory held 98 PNG screenshots of the DeckPal web UI (browse grids,
card detail, species pages) captured during the Phase 3.2 browse-MVP work.
Because the UI renders real card artwork, the screenshots reproduced
third-party art, and on 2026-08-31 the directory was removed from the
repository **and from its entire git history** (Project Holo, purge step 2a —
see DECISIONS.md, same date). The path is now gitignored so it cannot
reappear by accident.

Where things went:

- The pre-rewrite repository (screenshots included) is preserved in the
  maintainer's offline mirror `deckpal-mirror-2026-08-31.git`.
- Commit SHAs cited in old PR discussion or wiki pages predating the rewrite
  resolve against that mirror, not against this repo.

To regenerate screenshots for development purposes: run the app (`pnpm dev`)
and capture the pages you need (Playwright or any screenshot tool). Keep them
out of the repo — this directory stays empty by design.
