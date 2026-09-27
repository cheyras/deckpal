---
date: "2026-08-25"
title: "Battle strategy goes stale; artwork does not. Research now knows the difference"
decided_by: "Claude (Opus 5), from the owner's observation after research"
areas: ["images"]
supersedes: []
---
## 2026-08-25 — Battle strategy goes stale; artwork does not. Research now knows the difference
**Decided by:** Claude (Opus 5), from the owner's observation after research
started working: *"Since the nature of TCGs is constant evolution and change
with new drops, meta changing, etc. we definitely need some intelligence around
that. Collection is mostly evergreen, a cool card years ago is still a cool card
now… but for battle strategy we definitely want to make sure we're not pulling
from outdated sources."*

**Decision:** Two research topics, separated by their relationship to time — and
the mechanism is a **source allowlist, not a date filter**, because the date
filter was measured and made things worse.

### The obvious fix is wrong, and it is worth recording why

`search_recency_filter` does reach Perplexity through the Gateway — in
snake_case only; `searchRecencyFilter` type-checks and is silently dropped,
which is the same trap that killed the xAI live-search idea. And at every window
it made the answer worse:

| window | sources | authoritative | wrong game | answer |
|---|---|---|---|---|
| none | 20 | 2 | 1 | fine |
| week | 20 | 0 | **2** | starved |
| month | 20 | 1 | **2** | starved |
| year | 20 | 0 | 0 | vague |

"Wrong game" is the tell: `mtgo.com`, `mtg-standard.com`, `mtga.untapped.gg`. A
narrow window starves the query of Pokémon results, and the engine takes what it
can get — and "Standard format" is a format name in Magic too. **Filtering for
recency bought less recency and more drift.**

### What works is asking the right sites

| | hosts | on the allowlist | wrong game |
|---|---|---|---|
| baseline | 13 | 2 | 1 |
| **domain allowlist** | **5** | **5** | **0** |
| allowlist + month | 3 | 3 | 0 — but the answer degraded to "cannot be stated with certainty" |

With the allowlist the sources become `limitlesstcg.com`,
`play.limitlesstcg.com`, `pokemon.com`, `pokebeach.com` and
`pokedeckarchitect.com`, instead of `gamesradar`, `ultimateguard` and
`monstercardcorner`. **Recency comes free**, because those are live tournament
data: current by construction in a way a date filter over the open web can never
be. A 2024 SEO listicle is stale the day it is written.

The end-to-end answer is now explicitly rotation-aware without being told to be:
*"identified by Pokémon.com as the 'deck to beat' in the post-rotation Standard
format"*.

Recency ON TOP starved it again, so the allowlist ships alone.

### And it restores a control this project recorded as lost

`models.ts`, on the old research model: *"`gatewayTools.exaSearch` exposes
`include_domains`, which is the real injection control for live research — an
allowlist of known TCG sources plus a recency window, enforced rather than
requested. `o3-deep-research` searches provider-side, so that control is not
available to us here."*

It is available now, for the competitive half. Text reaching the model from a
competitive question can only come from a named list, so the least trustworthy
input in the system is no longer arbitrary. The general half stays open on
purpose — that is where the good answers about artwork and collecting live — and
keeps the existing controls: no tools, framed as data, hosts only.

### The topic is declared, not guessed

`research_meta` takes `topic: 'competitive' | 'general'`, defaulting to general.
Declared by the caller rather than inferred from the query text, because it
decides WHERE the answer may come from, and a control whose input is a regex
over a model's phrasing is not a control.

Competitive calls also carry the rotation warning: Standard drops part of the
card pool every year, so a report from the previous format is wrong rather than
old, and *"I could only find results from the previous format"* is a useful
finding while a confident answer built on them is not.

**Implications:**
- The allowlist must stay short. One that grows to include content farms has
  stopped being an allowlist; a test asserts the length and that entries are
  hosts rather than URLs.
- `runSubAgent` now forwards `providerOptions`. The first attempt spread them
  into its options object, which it did not pass on — so the allowlist did
  nothing and a question about Pokémon Standard came back about **Magic: The
  Gathering**. Declared and never exercised, for the fourth time in two days,
  and caught by a live probe rather than by the compiler.
- Provider options are MERGED rather than spread twice: the reasoning effort and
  the domain allowlist target different vendors, so a clobber would have looked
  fine and done nothing.

---

