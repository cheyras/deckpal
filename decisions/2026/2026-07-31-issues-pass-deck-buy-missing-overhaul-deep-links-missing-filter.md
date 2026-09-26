---
date: "2026-07-31"
title: "Issues pass + deck buy-missing overhaul (deep links, Missing filter)"
decided_by: "user (reports), agents (fixes)."
areas: ["decks"]
supersedes: []
---
## 2026-07-31 — Issues pass + deck buy-missing overhaul (deep links, Missing filter)
**Decided by:** user (reports), agents (fixes).
- **Mobile chrome 99px → 64px** (AppShell, 4 synced spots) + **"Pokédex" gradient wordmark**
  (live text, `.brand-wordmark`) in mobile header + desktop sidebar (issues r6q59q, zlfrqp).
- **Scanner accuracy** (issue lqyure): measured root causes — dHash's zero rotation tolerance
  (4° = 40% top-1, still confidently wrong → client auto-locked bad matches) + client cropping
  exactly to the guide box. Fix: single index+query hash pipeline (`dhash8v2`), ~33 geometric
  probe candidates at query time, 14% client capture margin, CONFIDENT_MAX 12→9. Benchmark
  (150 cards × 10 phone-degradation scenes, live /scan): mean top-1 73%→95%. Full re-index.
  **Invariant: index and query must share one exact hash pipeline** — mixing ImageMagick's
  direct hash with JS-resampled probes carried a 3-19-bit noise floor.
- **Deck buy-missing** (user report with TCGplayer rejection screenshot): deck pricing emitted
  bare `3 Banette` Mass Entry lines whenever the stored tcgplayer_mass_entry token was NULL —
  TCGplayer rejects bare names in practice (its help doc claims they're fine; reality wins).
  Extracted the set route's builder into shared `apps/api/src/tcgplayer/massentry.ts`
  (TCGCSV abbrev vocabulary, `qty Name [CODE] number`, ~1800-char URL chunking); new
  `GET /decks/:id/massentry`; BuyMissingModal is deep-link-first ("Fill TCGplayer cart") with
  a Cart Optimizer consolidation tip (TCGplayer's own optimizer is the sanctioned
  one-seller/fewest-packages answer — seller choice is not link-encodable); Cards tab gained a
  Missing filter (URL state `missing`); deckpal-mcp `decks include:pricing` now appends the cart
  URL(s). All verified on the built app at 428/390/1440px.

