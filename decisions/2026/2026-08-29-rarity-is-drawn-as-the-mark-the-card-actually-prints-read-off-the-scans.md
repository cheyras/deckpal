---
date: "2026-08-29"
title: "Rarity is drawn as the mark the card actually prints, read off the scans"
decided_by: "@cheyras, implemented by Claude Opus 5 via a Ringer swarm"
areas: ["scanner","catalog"]
supersedes: []
---
## 2026-08-29 — Rarity is drawn as the mark the card actually prints, read off the scans

**Decided by:** @cheyras, implemented by Claude Opus 5 via a Ringer swarm
**Decision:** `rarityGlyph()` — five Unicode characters standing in for all 30
catalog rarity values — is replaced by `lib/rarity.ts` (a data table) and
`components/RarityMark.tsx` (hand-authored SVG). Every entry is derived from a
real high-resolution card scan, named in that entry's comment, and NOT from a
press release, a wiki, or a prose description.

**Why:** The old mapping collapsed `Illustration rare`, `Special illustration
rare`, `Hyper rare` and `Ultra Rare` onto one white star, so a card printing
three gold stars and a card printing one black star looked identical in the
grid. Two things only the scans could settle:

- **Hyper rare prints THREE gold stars** (jtg/188). One gold star is
  Illustration rare (me1/133), two gold is Special illustration rare (me1/177).
  A first pass built from a written source had Hyper rare at two.
- **Six rarities print a plain star where we had invented a letter badge** —
  `V`, `PRIME`, `LEGEND`, `RADIANT`, `TGU`, `SH`. That is the same defect the
  owner complained about for set symbols (a badge of letters standing in for the
  real glyph), reproduced in the rarity marks. Corrected against swsh12/008,
  hgss2/84, hgss2/90, swsh12/016, swsh12tg/TG23 and swsh45sv/SV105.

**Implications:**

- **The print is the source of truth.** Do not "improve" an entry from a
  description; fetch `https://images.pokemontcg.io/<set>/<number>_hires.png` and
  look at it. Every entry cites the card it was read from, so any claim in the
  table is re-checkable by one HTTP GET.
- The printed colour tracks the CARD's own background — a star is inked black on
  a pale card and white on a dark one — so it is contrast, not identity. Our UI
  has a single dark surface, so `black` resolves to `currentColor` and both read
  as the REGULAR star. **The distinction that must survive is regular vs gold.**
  `Double rare` and `Ultra Rare` are allowed to look alike, because they do on
  the card; do not invent a matte-vs-metallic treatment to separate them.
- We author the geometry ourselves. No Pokémon-specific rarity artwork is
  cleanly licensed: Malie's SVG set publishes no reuse grant (its licensing
  section reads "FIXME") and Bulbagarden's files carry only an uploader's
  fair-use claim. Shipping traced or downloaded marks was rejected in favour of
  our own shapes, which is also what the owner asked for.
- `Promo`, `Classic Collection` and `Black White Rare` are **UNVERIFIED** — no
  scan was obtained for them. They keep their previous treatment and say so in
  the table. Do not quietly promote them.
- A contract test the implementing agent could not edit pins the star ladder and
  forbids a `wordmark` shape on any of the six corrected rarities, so this cannot
  silently regress.

