# BEHAVIOR-SPEC.md — pkmn.gg interaction behaviour, reverse-specified

**Purpose:** a step-by-step written spec of every interaction flow the DeckPal clone must replicate.
**Scope:** behaviour only. No pkmn.gg code, bundles, or private endpoints are referenced or required.

## Evidence tags — read this first

Every factual claim below carries exactly one tag:

| Tag | Meaning |
|---|---|
| **[D]** documented | Stated in a pkmn.gg-published article. URL given inline or in the source table. |
| **[O]** observed | Present in the local capture at `/home/cheyras/pokedex/research/pkmn-gg/dom/*.html` or `../styles/*.json`. File named inline. |
| **[I]** inferred | My reasoning from D/O facts. Not authoritative. Treat as a design proposal, not a requirement. |

A wrong **[D]** is worse than an honest **[I]**. Where the docs and the observed DOM disagree, both are recorded and the conflict is flagged.

### Primary source table

| # | Article | URL |
|---|---|---|
| A1 | Help Center index | https://articles.pkmn.gg/help-center |
| A2 | Tracking Set Progress | https://articles.pkmn.gg/help-topic/tracking-set-progress |
| A3 | Collection Basics | https://articles.pkmn.gg/help-topic/collection-basics |
| A4 | Card Preferences | https://articles.pkmn.gg/help-topic/card-preferences |
| A5 | Card Details | https://articles.pkmn.gg/help-topic/card-details |
| A6 | Advanced Search | https://articles.pkmn.gg/help-topic/advanced-search |
| A7 | Collection Filters & Sorting | https://articles.pkmn.gg/help-topic/collection-filters-sorting |
| A8 | Binder View | https://articles.pkmn.gg/help-topic/binder-view |
| A9 | Dynamic Lists | https://articles.pkmn.gg/help-topic/dynamic-lists |
| A10 | Static Lists | https://articles.pkmn.gg/help-topic/static-lists |
| A11 | Favoriting Lists | https://articles.pkmn.gg/help-topic/favoriting-lists |
| A12 | Set the Cover Image for Lists | https://articles.pkmn.gg/help-topic/set-the-cover-image-for-lists |
| A13 | Increased List Limits | https://articles.pkmn.gg/help-topic/increased-list-limits |
| A14 | Unlimited Lists & Decks | https://articles.pkmn.gg/help-topic/unlimited-lists-decks |
| A15 | Standard, Expanded, GLC, & Unlimited Formats | https://articles.pkmn.gg/help-topic/standard-expanded-gym-leader-challenge-unlimited-formats |
| A16 | Automatic Legality Status | https://articles.pkmn.gg/help-topic/automatic-legality-status |
| A17 | Deck Price & Quick Deck Purchasing | https://articles.pkmn.gg/help-topic/deck-price-quick-deck-purchasing |
| A18 | Set the Cover Image for Decks | https://articles.pkmn.gg/help-topic/set-the-cover-image-for-decks |
| A19 | Favorite Decks | https://articles.pkmn.gg/help-topic/favorite-decks |
| A20 | Using the Pokédex | https://articles.pkmn.gg/help-topic/using-the-pokedex |
| A21 | How to Unlock Shiny Pokémon | https://articles.pkmn.gg/help-topic/how-to-unlock-shiny-pokemon |
| A22 | Leveling Up | https://articles.pkmn.gg/help-topic/leveling-up |
| A23 | Card Pricing | https://articles.pkmn.gg/help-topic/card-pricing |
| A24 | Your Total Estimated Collection Value | https://articles.pkmn.gg/help-topic/your-total-estimated-collection-value |
| A25 | Currency Display | https://articles.pkmn.gg/help-topic/currency-display |
| A26 | Your Collection Tab | https://articles.pkmn.gg/help-topic/your-collection-tab |
| A27 | Activity Log | https://articles.pkmn.gg/help-topic/activity-log |
| A28 | Graded Cards | https://articles.pkmn.gg/help-topic/graded-cards |
| A29 | Private Card Notes | https://articles.pkmn.gg/help-topic/private-card-notes |
| A30 | Reset Collection | https://articles.pkmn.gg/help-topic/reset-collection |
| A31 | Adding Showcase Cards | https://articles.pkmn.gg/help-topic/adding-showcase-cards |
| A32 | Profile Customization | https://articles.pkmn.gg/help-topic/profile-customization |
| A33 | Purchasing Cards | https://articles.pkmn.gg/help-topic/purchasing-cards |
| A34 | Shop on eBay | https://articles.pkmn.gg/help-topic/shop-on-ebay |
| A35 | Using Global Card Search | https://articles.pkmn.gg/help-topic/using-global-card-search |
| A36 | Stream Tools | https://articles.pkmn.gg/help-topic/stream-tools |
| A37 | How to Add Friends | https://articles.pkmn.gg/help-topic/how-to-add-friends |
| A38 | Comparing with Friends | https://articles.pkmn.gg/help-topic/comparing-with-friends |
| A39 | Viewing the Collection of Others | https://articles.pkmn.gg/help-topic/viewing-the-collection-of-others |
| A40 | Viewing Lists of Others | https://articles.pkmn.gg/help-topic/viewing-lists-of-others |
| A41 | Viewing Decks of Others | https://articles.pkmn.gg/help-topic/viewing-decks-of-others |
| A42 | How to Create an Account | https://articles.pkmn.gg/help-topic/how-to-create-an-account |
| A43 | Magic Link Not Working | https://articles.pkmn.gg/help-topic/magic-link-not-working |
| A44 | How to Report a Missing Card | https://articles.pkmn.gg/help-topic/how-to-report-a-missing-card |
| **C1** | **Developer changelog: "Collection Goals" (July 15 2026)** | https://www.pkmn.gg/changelog/collection-goals — captured at `dom/changelog-post.html` + `dom/changelog.html`. **This post supersedes A2.** |
| C2 | Developer changelog: "Layout and filter fixes across the site" (July 8 2026) | captured in `dom/changelog.html` |
| C3 | Developer changelog: "Search, Decks, and Activity Fixes" (June 10 2026) | captured in `dom/changelog.html` |

> **Live-site fetches beyond the help center returned HTTP 403** to WebFetch (`/series/base/base/004`, `/changelog/collection-goals`). Everything marked [O] therefore comes from the pre-existing local capture, which was taken **logged out**. Consequence: all authenticated-only UI (the Have/Need/Dupes tab strip, quantity steppers, goal switcher, list editor, deck editor) is reconstructed from C1/C2/C3 changelog prose plus article text, not from live DOM. Flagged individually below.

---

# 1. The core data model (get this right first)

## 1.1 The unit of collection is `(card, variant)`, not `card`

1. Every card in the database carries an ordered list of **named variants**. **[O]** `dom/card-changelog.html` shows the variant list as a first-class, editable, per-card field, e.g. `Variants: Holofoil, Reverse Holofoil → Holofoil, Reverse Holofoil, Normal`.
2. The card detail page renders a **variant table** with columns `Variant | Market Price | Quantity`. **[O]** `dom/card-151-006.html`.
3. Therefore ownership is stored per variant. A collection row is `(card_id, variant_name, quantity)`. **[O]** — `dom/profile-collection.html` renders each collection row as `qty · name · price · #number · variant` (e.g. `1 | Gastly | $101.06 | #177 | Holofoil`), and `dom/list-public.html` renders list rows the same way (`7 | Entei | $32.15 | 034 | Reverse Holofoil`).
4. Pricing is per variant, not per card. **[D]** A23: "If you want to see the pricing of a special variant such as Pokémon Center Stamp, click on a card to view the Card Details. You will see any data available for other variants and their pricing."
5. Price history is per variant, and the price chart is multi-series with one line per variant; **clicking a variant name removes it from the graph**. **[D]** A23.
6. The set grid tile shows a **"+N Variant(s)"** badge when a card has more than one variant. **[O]** `dom/set-151.html` — e.g. Venusaur ex renders `+ 4  Variants`, Charizard ex renders `+ 2  Variants`.

> **Clone requirement:** the schema must be `collection_item(card_id, variant_id, quantity)` with a unique key on `(card_id, variant_id)`. Do **not** model ownership at card level with a variant side-table of flags — every downstream feature (progress goals, Dupes tab, collection value, activity log, binder stacking, graded overrides) reads the per-variant quantity.

## 1.2 Observed variant taxonomy

These are the **exact strings pkmn.gg uses**, harvested from the card changelog feed. **[O]** `dom/card-changelog.html` unless noted.

**Standard, pack-pulled printings**
- `Normal`
- `Holofoil`
- `Reverse Holofoil`

**Pattern / parallel reverse printings (SV-era)**
- `Poke Ball Pattern`
- `Master Ball Pattern`

**Stamped / distribution variants**
- `Play Pokémon Stamp Holo`
- `Play Pokémon Stamp Normal`
- `Professor Program Stamp Normal`
- `Staff Stamp`
- `GameStop Stamp`
- `EB Games Stamp`
- `Stamp` (generic; used for retailer-exclusive prints — the changelog notes read "Barnes & Noble variant", "Best buy Variant", "What's Your Favorite?")
- `Pokémon Center Stamp` **[D]** A23, A33 (not present in the local capture, but named verbatim in two articles)

**Format / physical variants**
- `Jumbo` **[O]** + **[D]** A33
- `TCG Pocket` — appears as a variant name in the activity log; C3 notes the friendly-name fix ("Card variants in your activity log now always show their friendly names (for example 'TCG Pocket' instead of 'tcgPocket')"). **[O]** `dom/changelog.html`

**Vintage-era variants — NOT CONFIRMED**
`1st Edition`, `Shadowless`, `Unlimited Edition`, `Cosmos Holo`, `Gold Star`, `Prerelease` do **not** appear anywhere in the local capture, and the live Base Set card page returned 403. The brief assumes they exist; the naming is unverified. **[I]** — see §14 Open Questions.

**Structural observations:**
- Variant names are free-text-ish labels, curated by the pkmn.gg team, not a fixed enum. New ones are added per card via a moderation flow ("Report Missing Variant"). **[D]** A44 + **[O]** `dom/card-changelog.html`.
- A single card can carry 5+ variants. `dom/card-changelog.html` shows `Holofoil, Reverse Holofoil, GameStop Stamp, EB Games Stamp, Play Pokémon Stamp N…` on one card.
- Variants carry per-variant provenance metadata rendered next to the name — `dom/card-151-006.html` shows `Found in Booster Packs` under the `Holofoil` row. **[O]**
- Each variant carries its own TCGplayer product mapping. **[O]** `dom/card-changelog.html` has a per-card field `TCGplayer Mass Entry: Empty → 1 Goldeen [ME05] 13`, and each variant row on the card page has its own TCGplayer button and its own price.

> **Clone requirement:** model `variant` as a row in a `card_variants` table with `(card_id, name, sort_order, tier, tcgplayer_product_id, tcgplayer_printing, source_note)`. `tier` is the crucial derived/curated field — see §2.

## 1.3 Card supertype / grouping

- Cards are grouped for deck display as **Pokémon / Trainer / Energy**. **[O]** `dom/deck-public.html` renders `Pokémon (17)`, `Trainer (35)`, `Energy (8)`.
- The search filter field is called **Card Type** and its documented values are "Pokémon, Trainer, Item" **[D]** A6 — note the article mixes supertype and subtype in its example; the deck sections prove the top-level split is Pokémon/Trainer/Energy. **[I]** Card Type is the supertype; Item/Supporter/Stadium/Tool live under Sub-Type.
- **Sub-Type** is a multi-value field, order-sensitive: `Subtypes: Stage 1, ex, MEGA → Stage 1, MEGA, ex` was an explicit changelog edit. **[O]** `dom/card-changelog.html`. Documented example values: "Baby, ex, V STAR" **[D]** A6.
- Card detail renders `Tags` for subtypes (`Stage 2`, `ex`). **[O]** `dom/card-151-006.html`.

---

# 2. Collection marking — Have / Need / Duplicate

## 2.1 The completion-goal model (THE key behaviour)

**This is the single most important section.** The help-center article A2 describes an older two-bar main/master model. It was **replaced** on 2026-07-15 by a three-goal model. **[D/O]** C1, verbatim from `dom/changelog-post.html`:

> "The old 'Show All Missing' switch is gone. In its place you pick a completion goal that reframes the whole set view, so the Have / Need / Dupes tabs and their counts mean exactly what you're chasing:
> **Complete Set**: own each card in the main set, in any available variant.
> **Master Set**: own each card in the main set in every standard pack-pulled variant.
> **Grandmaster Set**: own everything in the Master Set, plus any additional card variants like promos, stamped cards, and special prints."

### Goal definitions, restated as computable rules

Let `S` = the set's card list. For card `c`, let `V(c)` = all variants, `P(c)` ⊆ `V(c)` = the **standard pack-pulled** variants, and `q(c,v)` = owned quantity.

| Goal | Required set of (card, variant) pairs | Complete when |
|---|---|---|
| **Complete Set** | for each `c ∈ S`, any one `v ∈ V(c)` | `∀c ∈ S : Σ_v q(c,v) ≥ 1` |
| **Master Set** | for each `c ∈ S`, every `v ∈ P(c)` | `∀c ∈ S, ∀v ∈ P(c) : q(c,v) ≥ 1` |
| **Grandmaster Set** | for each `c ∈ S`, every `v ∈ V(c)` | `∀c ∈ S, ∀v ∈ V(c) : q(c,v) ≥ 1` |

**[D]** goal wording from C1; **[I]** the formalisation.

**This forces a `tier` field on every variant.** You cannot compute Master vs Grandmaster without knowing which variants are "standard pack-pulled". **[I]** Proposed three-value tier:
- `standard` → `Normal`, `Holofoil`, `Reverse Holofoil`, `Poke Ball Pattern`, `Master Ball Pattern` (counts toward Master + Grandmaster)
- `special` → all `* Stamp` variants, `Jumbo`, retailer prints, promos (counts toward Grandmaster only)
- The `tier` must be data, not a hard-coded string match, because the variant vocabulary grows. **[I]**

### "Main set" and secret rares

- **[O]** `dom/set-151.html`: the set information bar reads `Cards: 165 + 42 Secret`, but the collection counter reads `0 / 207 Collected`. 165 + 42 = 207.
- **Therefore secret rares ARE part of the "main set" for progress purposes.** The Complete Set denominator is the full card list including secrets. **[O]** The `165` figure is only the *printed* denominator (card detail page title is `Charizard ex #006/165 151` **[O]** `styles/card-151-006.json`), used for display of card numbers, not for progress.
- **[I]** "main set" in pkmn.gg's goal wording = "every card row in this set entry", i.e. everything the set page lists. Secret rares are not excluded, not bonus, not a separate bar.

### Progress bars

**[D]** C1: "The top bar always shows Complete Set progress, so your headline number stays stable. The second bar follows your selected goal and turns purple when you're chasing a Grandmaster Set."

1. **Bar 1 (top) — always Complete Set.** Never changes with the goal selector. **[D]** C1.
2. **Bar 2 — follows the selected goal.** Colour changes: green/standard for Master, **purple** for Grandmaster. **[D]** C1. Older article A2 calls bar 1 "Main/Gold Progress" and bar 2 "Master Set/Green Progress" **[D]** A2 — consistent with gold top bar, green second bar, purple being the new Grandmaster state.
3. **[O]** `dom/set-151.html` renders exactly two percentage figures (`0%`, `0%`) next to two distinct bar components, plus a `LVL 0` chip and the `0 / 207 Collected ( 0 Total Cards)` counter. Confirms: two bars + a level chip + two counters.
4. Percentage = `owned_required_pairs / total_required_pairs × 100`, rounded to one decimal. **[O]** profile set rows show `25 /120 Collected · LVL 1 · 20.8%` — 25/120 = 20.833…% → `20.8%`, and `3 /122 → 2.5%` (2.459 → 2.5), `1 /295 → 0.3%` (0.339 → 0.3). One decimal, round-half-up. **[O]** `dom/profile-squalls.html`.
5. `( N Total Cards )` is the **sum of all quantities owned in the set**, distinct from the unique-cards numerator. **[O]** `dom/set-151.html`.

### Where the goal is chosen, and persistence

1. Set a **default goal in Account Settings**; every set page opens to it. **[D]** C1.
2. Switch goal **in place** on any set or list page. **[D]** C1.
3. **The in-place switch never rewrites the saved default.** **[D]** C1 verbatim: "that in-place switch never rewrites your saved default."
4. **[I]** Therefore the in-place goal is ephemeral view state (component state or a URL param), and the default is a user-settings row. See §5.4 for what is and isn't in the URL.

### Interaction between variant filters and the goal

**[D]** C1, verbatim:
> "Filter a set down to a specific printing and the ownership tabs narrow to just that printing. Turn on the Holofoil filter, tap Need, and you get exactly the Holofoils you're still missing."
> "When you filter a set to one or more specific variants, the completion goal is judged over just those variants. Filtering to Holofoil makes the set behave, for the Have / Need / Dupes tabs, as if Holo…" *(text truncated in capture)*
> "A useful consequence: when your filter lands on a single printing per card, the three goals all agree, because there is only one thing to own. The goal only changes the answer when you're looking acro…" *(truncated)*

Restated: **the active variant filter intersects `V(c)` before the goal is evaluated.** With filter `F`:
- Complete: `∀c : Σ_{v ∈ V(c)∩F} q(c,v) ≥ 1`
- Master: `∀c, ∀v ∈ P(c)∩F : q(c,v) ≥ 1`
- Grandmaster: `∀c, ∀v ∈ V(c)∩F : q(c,v) ≥ 1`

**[I]** and when `|V(c)∩F| = 1` for all `c`, all three collapse to the same predicate — which is exactly the "useful consequence" the post describes. This is a strong self-consistency check for our implementation.

### Under the hood

**[D]** C1: "The backend now tracks Grandmaster completion (owning every variant of every card in a set), updated live as you add and remove cards and reconciled by the nightly sweep, alongside the existing Maste…" *(truncated)*

**Clone requirement:** maintain denormalised per-(user, set, goal) progress counters, updated incrementally on every collection mutation, plus a nightly reconciliation job that recomputes from source. **[D]** for the pattern, **[I]** for our adoption of it. On a Pi this matters: recomputing Grandmaster progress across ~200 sets on every checkbox tap is not viable.

## 2.2 Have / Need / Dupes — semantics

The ownership tab strip is `Show All | Have | Need | Dupes`. **[O]** C2 verbatim in `dom/changelog.html`: "On lists, the Pokédex, and set pages, the Show All / Have / Need / Dupes tabs now stretch the full width when they stack on a phone, and the variant filter sits neatly beneath them."

Given the active goal `G` and the active variant filter `F`, for each card `c` define the goal-required variant set `R_G(c, F)`:

| Tab | Membership predicate | Tag |
|---|---|---|
| **Show All** | every card in scope | [O] |
| **Have** | every required pair for `c` is owned at qty ≥ 1 | [I] |
| **Need** | at least one required pair for `c` is owned at qty 0 | [I] |
| **Dupes** | at least one required pair for `c` is owned at qty ≥ 2 | [I] |

**[I]** on all three predicates. The changelog only states that the tabs "mean exactly what you're chasing" under the selected goal; it does not spell out per-tab predicates. This is the single largest inference in this document.

**Duplicate is a derived state, not a stored flag.** **[I]** Nothing in any source describes a separate "duplicate" boolean; the collection rows carry an integer quantity (**[O]** `1`, `2`, `3`, `7` observed in `dom/list-public.html` / `dom/profile-collection.html`), the activity log records "quantity change" (**[D]** A27), and lists are described as showing "how many copies you have" (**[D]** A9). Duplicate ⇒ `quantity > 1`.

**[I]** Under Complete Set, "duplicate" is ambiguous: is a card with Normal×1 + Holofoil×1 a dupe (two copies of one card) or not (two different things)? Our clone should follow the per-required-pair rule above — i.e. under Complete Set, a card is a dupe when `Σ_v q(c,v) ≥ 2` — because Complete Set's required unit is "the card in any variant". Under Master/Grandmaster the required unit is the pair, so the pair-level rule applies. Flag for user decision.

**Counts:** each tab carries a count badge; those counts must recompute when a card is checked. **[D]** C2: "Your Have / Need / Dupes counts and set va…" *(truncated — clearly "set value")* "…" update on check. Notably, C2 lists it as a fixed perf issue: "On large sets like Fusion Strike, checking or unchecking a card used to lag the whole page. Now only the card you touched updates, so it responds instantly."

## 2.3 Marking a card — step by step

**Flow A — from a set page (the primary flow)**

1. Navigate to `/series/{series}/{set}`. **[O]**
2. **[D]** A3: "check off the versions you have" from the set page; A2 confirms "Filter toggles: Have/Need/Dupes with variant checkboxes".
3. **[I]** The set grid tile carries a checkbox affordance for the card's **primary variant**. The primitives showcase includes a `Checkbox` primitive with `Unchecked` / `Disabled (checked)` states **[O]** `dom/primitives-showcase.html`.
4. Checking sets `quantity = 1` for that variant. **[I]**
5. Unchecking sets `quantity = 0`. **[I]** C2 says "checking or unchecking a card", so it is a toggle.
6. Only the touched card re-renders; tab counts and set value update. **[D]** C2.

**Flow B — from the card detail modal / page (quantities and non-primary variants)**

1. **[D]** A5: "Simply click on the card image to open the Card Details view of any card." Pro tip in A5: **clicking the card image opens the modal; clicking the card name navigates to the dedicated page.** This is a two-target tile — replicate it.
2. The Card Details view has tabs: `Card | Price | TCG | Private Notes | Graded`. **[O]** `dom/card-151-006.html`.
3. The `Card` tab renders the variant table `Variant | Market Price | Quantity`. **[O]**
4. Each variant row has a quantity control. Logged out it renders the string `Log In to Track Collection`. **[O]**
5. **[D]** A2: "Card detail modal for tracking quantities" and "you can track multiple quantities and additional variants through card details."
6. **[I]** The quantity control is a `− N +` stepper. The primitives showcase contains `IconButton` glyphs `＋` and `✕` **[O]** `dom/primitives-showcase.html`, consistent with a stepper, but the actual stepper markup is auth-gated and not in the capture. Direct numeric entry is unconfirmed.

**Flow C — from global search / Pokédex page**

- **[D]** A3 lists three tracking entry points: by set, via global search, and via the Pokédex. All three surface the same card tile and the same Card Details modal. **[I]** Same mutation path.

**Edge cases**

| Case | Behaviour | Tag |
|---|---|---|
| Marking a non-primary variant (e.g. Reverse Holofoil) | Advances Master/Grandmaster progress but **not** Complete Set progress if no other variant of that card is owned — wait, it *does*: Complete Set is "any available variant". Marking *any* variant satisfies Complete Set for that card. | [I] from C1 wording |
| Marking a base variant when a card has 5 variants | Complete Set +1; Master Set advances by 1 of `|P(c)|`; Grandmaster by 1 of `|V(c)|` | [I] |
| Card has exactly one variant | All three goals advance identically | [D] C1 ("when your filter lands on a single printing per card, the three goals all agree") |
| Quantity increased 1 → 2 | Card enters the Dupes tab; Complete/Master/Grandmaster percentages unchanged; `Total Cards` counter +1; collection value += variant price | [I] |
| Quantity decreased to 0 | Card leaves Have, enters Need | [I] |
| Graded copy added with "Also Add to Collection = Yes" | Adds **one card of that variant** to the collection | **[D]** A28 verbatim |
| Price missing for a variant | Renders `N/A`; card still checkable | **[O]** `dom/list-public.html` (`Radiant Charizard | N/A | 001`), `dom/pokedex-charizard.html` |
| TCGplayer mapping missing | **[D]** A33: "In some cases, we may not have TCGplayer information yet or the pricing data hasn't populated." |

## 2.4 Reset Collection

**[D]** A30. Account Settings → bottom of page → Reset Collection.

**Cleared:** all checked-off cards; activity log **and** total collection price history; graded cards; private notes.
**Preserved:** lists; decks; showcase/spotlight cards; profile customisations; account settings; Pro membership.

**[I]** Implication for our schema: `price_history` for the *user's collection value* is a user-owned table that must be truncated by reset, whereas *card market price history* is catalogue data and must not be. Keep them in separate tables.

## 2.5 Activity Log

**[D]** A27. Records every collection modification with: **card name, variant, set, quantity change, timestamp**. New cards get a yellow **NEW** tag. Reachable from the profile Activity tab or the activity icon in the avatar menu. Other users' activity is viewable from their profile.

**[O]** `dom/profile-squalls.html` confirms an `Activity` profile tab. **[O]** `dom/changelog.html` C3 records a bug fix: variant names in the activity log now render friendly names ("TCG Pocket" not "tcgPocket").

**[O]** Timestamps render as relative text with an absolute `title` attribute: `title="Jul 17, 2026 · 11:49 pm"` on elements displaying "3 days ago". Replicate this pattern (`dom/card-changelog.html`).

---

# 3. Set progress, set levels, and Trainer Level

## 3.1 Set page anatomy

**[O]** `dom/set-151.html`, top to bottom:

1. Full-bleed set background image + set logo.
2. `Shop` button (aria-label `Shop on TCGplayer`) and `Purchase Set` button.
3. Set symbol.
4. Collection counter block: `{owned} / {total} Collected`, `({totalQty} Total Cards)`, `LVL {n}` chip.
5. Progress bar 1 + `{pct}%`.
6. Progress bar 2 + `{pct}%`.
7. Set information bar: `Set Name | Series (link) | Release Date | Cards ({main} + {secret} Secret) | Most Expensive Card | Full Set Market Value`.
   **[D]** A2 calls this the "Set Information Bar displaying name, series, release date, card count, pricing".
8. Sort control strip: `Number | Name | Rarity | Price | Artist`.
9. View toggle: `Grid | Table | Binder` (icons `views-grid`, `views-table`, `views-binder`).
10. Card grid.
11. **[D]** A33: a `Purchase Missing Cards` button (not in the logged-out capture).
12. **[D]** C2 (auth-gated): `Show All | Have | Need | Dupes` tab strip with the variant filter beneath it.

## 3.2 Set Level (`LVL n`)

- **[D]** A22: sets have "a separate progression tier for individual card sets, ranging from Level 0, 1, 2, 3, 4, and Max." Six states: 0, 1, 2, 3, 4, Max.
- **[O]** observed pairs from `dom/profile-squalls.html`: `0/120 → LVL 0, 0%`; `1/295 → LVL 1, 0.3%`; `3/122 → LVL 1, 2.5%`; `25/120 → LVL 1, 20.8%`; `0/124 → LVL 0, 0%`.
- **[I]** Best fit: banded on Complete-Set percentage — `LVL 0` = 0%, `LVL 1` = 0<p<25%, `LVL 2` = 25–49%, `LVL 3` = 50–74%, `LVL 4` = 75–99%, `Max` = 100%. Consistent with all five observations, but the only evidence distinguishing LVL 1 from LVL 2 is that 20.8% is still LVL 1 — the upper boundary is unconstrained by the data. **Low confidence; see §14.**
- **[O]** The set-page level bar markup contains a track with **four child segments** (`dom/set-151.html`), which is consistent with a segmented bar showing four thresholds between LVL 0 and Max, i.e. 5 bands. Weak evidence.

## 3.3 Trainer Level (account level)

- **[D]** A22 verbatim: "Each unique card you collect, you'll see your yellow progress bars fill up. Once you collect 10 unique cards, you'll level up!"
- **[D]** home page: "Gain a Trainer Level for every 10 unique cards you collect." **[O]** `dom/home.html`.
- **Formula:** `trainer_level = floor(unique_cards / 10)`. **[I]** — whether level 1 starts at 0 or 10 uniques is not stated; A22's "Once you collect 10 unique cards, you'll level up" implies you start at some level and reach the next at 10, so `floor(u/10)` with a level-0 start, or `1 + floor(u/10)` with a level-1 start. Pick one and document it.
- **What "unique" means: [I]** — the profile shows **both** `Total Cards 31,952` and `Unique Cards 6,462` **[O]** `dom/profile-squalls.html`. `Unique Cards` is the levelling input. Whether "unique" counts distinct cards or distinct `(card, variant)` pairs is **not determinable** from any source. The 31,952 / 6,462 ratio (4.9 copies per unique) is consistent with either reading. See §14.
- **Unlocks:** nothing. No source describes Trainer Level gating any feature. It is pure vanity/progress. **[I]** — an `aria-label="user lvl"` element appears 9 times across the captures **[O]**, always adjacent to a username, i.e. it is a display badge.
- **[O]** Icon keys `progress-tl-progress-2` and `progress-tl-progress-7` appear in the captures — "tl" = Trainer Level, and the numeric suffix suggests a multi-stage badge artwork keyed to level tier.

---

# 4. Pokédex gamification

## 4.1 Capture

1. **[D]** A20 verbatim: "To put it simply, collect a card to catch the Pokémon here in your Pokédex! Level up your Pokémon by collecting cards featuring them."
2. Owning **≥1 card featuring that Pokémon** captures it. **[D]** A20: "Here you can see I've collected at least one card of all these Pokémon except for Smoochum."
3. Uncaptured Pokémon render in a distinct (silhouette/greyed) state. **[I]** — implied by "except for Smoochum" being visually distinguishable.

## 4.2 Scope: national dex, browsed by generation

- **[O]** `dom/pokedex.html` — generation tab strip `Gen I … Gen IX`, plus an `Animations` toggle (`aria-label="Animations"`).
- **[O]** `/pokedex` and `/pokedex/generation/1` render **content-identical bodies** — a byte diff of `dom/pokedex.html` vs `dom/pokedex-generation-1.html` yields exactly one difference, a stray `muted=""` attribute on the loading-splash `<video>`. So **Gen I is the default view of `/pokedex`**, not a separate landing page.
- **[O]** Entries are national-dex numbered `#001`–`#151` for Gen I, with gendered forms as separate entries (`Nidoran ♀ #029`, `Nidoran ♂ #032`).
- **[D]** home page: "From 0001 to 1000+, our Pokédex includes every Pokémon." **[O]** `dom/home.html`.
- **[D]** A20: "We also track your total Pokédex completion." **[I]** A single global completion figure, not per-generation, though per-generation views exist.

## 4.3 Which cards count for a Pokémon

**[O]** `dom/pokedex-charizard.html` — `Total Cards 237` for Charizard, and the list includes:
- plain `Charizard`
- owner-prefixed: `Blaine's Charizard`, `Lance's Charizard V`
- adjective-prefixed: `Dark Charizard`, `Radiant Charizard`, `Special Delivery Charizard`
- mechanic suffixes: `Charizard V`, `Charizard VMAX`, `Charizard VSTAR`, `Charizard ex`, `Charizard-EX`, `Charizard-GX`, `M Charizard-EX`, `Mega Charizard X ex`, `Mega Charizard Y ex`, `Charizard G`, `Charizard G LV.X`, `Charizard δ`
- **tag-team cards where Charizard is one of two Pokémon**: `Reshiram & Charizard-GX`, `Charizard & Braixen-GX`

**[I]** Therefore the card→Pokémon association is a **many-to-many join on species**, not a name-prefix match and not a 1:1 field. A tag-team card must appear on both species' pages. Our catalogue source (TCGdex) exposes `dexId` as an array — use it.

## 4.4 Pokémon page

**[O]** `dom/pokedex-charizard.html` fields: `Number (#0006)`, `Total Cards`, `Types (Fire, Flying — with type icons `type-fire`, `type-flying`)`, `Height (5' 7" / 1.7 m)`, `Total Market Value`.
Sort strip: `Number | Rarity | Price | Artist | Released` (no `Name` — all cards share the species name). View toggle `Grid | Table | Binder`. Search placeholder `Search Pokémon…`.
**[D]** A20: "Click into any Pokémon to view their dedicated Pokédex page. This lists all the cards for that Pokémon, with the ability to sort, search, and more."

## 4.5 Pokémon Level and Shinies

- **[D]** A20 verbatim: "The more you collect of a particular Pokémon, the more you'll increase their level. Depending on how many cards are available of the Pokémon will determine the difficulty of leveling up. Level up enough and you'll unlock the Shiny version!"
- **[D]** A20 worked example: "My Charizard is currently Level 2. I need to collect 9 more unique Charizard cards to level up to Level 3."
- **[D]** A21: "After you've collected enough cards featuring a Pokémon, you'll unlock the Shiny version of them in your personal Pokédex."
- **[D]** home page: "Capture enough to unlock the Shiny version of your Pokémon." **[O]** `dom/home.html`.

**Level input is UNIQUE cards of that Pokémon, not duplicate copies.** **[D]** A20 says "9 more **unique** Charizard cards".

> ⚠️ **The brief's premise "shinies via extra copies" is contradicted by the source.** Shinies come from *breadth* (unique cards featuring the Pokémon), not from *depth* (duplicate copies of one card). Build it as breadth.

- **Scaling:** thresholds scale with the Pokémon's card pool. **[D]** A20. **[I]** i.e. level bands are percentage-based over `Total Cards` for that species, mirroring set levels. With Charizard at 237 total cards and "9 more to reach Level 3", a 5-band model (0/20/40/60/80/100%) would put L3 at 95 cards — implying the user has 86. Not verifiable. **See §14.**
- Shiny unlock threshold is **not stated numerically in any source.** **[D]** A21 says only "enough". **See §14.**

## 4.6 Pokédex is free

**[D]** A20 verbatim: "The entire Pokédex feature is free for all members." Binder View *on* the Pokédex is Pro. **[D]** A8, A20.

## 4.7 Logged-out empty state

**[O]** `dom/pokedex.html`: *"Create an account to begin catching Pokémon here! Level up your Pokémon by collecting cards featuring them."*

---

# 5. Filtering, sorting, and search

## 5.1 Complete Advanced Search filter field list

**[O]** exact placeholder strings harvested from `dom/trydeckbuilder.html`, in DOM order:

**Row 1 (combobox, multi-select — each renders selected values as removable chips):**
1. `Card Type`
2. `Energy Type`
3. `Sub-Type`
4. `Set`

**Row 2:**
5. `Rarity`
6. `Weakness`
7. `Resistance`
8. `Retreat Cost`

**Row 3:**
9. `Hit Points`
10. `Attack Search...`
11. `Ability Search...`
12. `Evolves From Search...`

Plus the free-text field `Name or Number...` **[O]**.

**[D]** A6 additionally documents an **`Artist`** filter ("Artist (sowsow, Naoki Saito, etc.)") and "Attack Keywords". Artist has no placeholder in the deck-builder capture — **[I]** the deck builder ships a reduced field set; the site-wide Advanced Search adds Artist. C2 corroborates a wider set: "The rows of filter fields (Card Type, Rarity, Attack Search, and the rest)…".

**Documented example values [D]** A6:
- Card Type: "Pokémon, Trainer, Item"
- Energy Type: "Fire, Grass, etc."
- Sub-Type: "Baby, ex, V STAR, etc."
- Rarity: "Common, Promo, etc."
- Set: "151, Aquapolis, etc."
- Artist: "sowsow, Naoki Saito, etc."

**[I]** The combobox primitive is HeadlessUI (`role="combobox"`, `aria-autocomplete="list"`, chip container) **[O]** — meaning every filter is type-ahead + multi-select, not a plain `<select>`.

## 5.2 Ownership + variant filters (collection context)

- Tab strip `Show All | Have | Need | Dupes`. **[O]** C2.
- **Variant filter sits beneath the tab strip.** **[O]** C2 verbatim.
- **[D]** A2: "Filter toggles: Have/Need/Dupes with variant checkboxes" — so the variant filter is a multi-select checkbox row, not a dropdown.
- **[D]** A6: "toggles for separating card variants (showing different versions with distinct pricing)" — a **"separate variants"** toggle that explodes each card into one tile per variant. This is distinct from the variant *filter*.
- **[D]** A6: **"Collection Mode"** — "a Collection Mode for Pro users to display only owned cards".

## 5.3 Complete sort option lists (context-dependent)

| Context | Options, in DOM order | Tag |
|---|---|---|
| Set page | `Number, Name, Rarity, Price, Artist` | [O] `dom/set-151.html` |
| Pokémon page | `Number, Rarity, Price, Artist, Released` | [O] `dom/pokedex-charizard.html` |
| List detail page | `Custom, Number, Name, Rarity, Price, Artist, Released` | [O] `dom/list-public.html` |
| Deck builder search | `Best Match, Number, Name, Rarity, Price, Artist, Released` | [O] `dom/trydeckbuilder.html` |
| Profile → Collection tab | `Recent` (default), then Pro-gated: `Best Match, Number, Name, Rarity, Price, Artist, Released` | [O] `dom/profile-collection.html` |
| Global Advanced Search | `Price, Name, Release Date` | [D] A6 |

**Pro collection sorts, documented list [D]** A26:
- Most Recently Added **or** First Added
- Card Number
- Card Name A-Z **or** Z-A
- Card Rarity
- **Price of Main Variant**
- Card Artist
- Card Release Date

> `Price of Main Variant` is a modelling signal: each card has a designated **main/primary variant** whose price represents the card in list views. **[D]** A26. **[O]** corroborated — set grid tiles show one price per card with a `+N Variants` badge (`dom/set-151.html`).

Sort direction toggles: `Recent` ↔ first-added is described as clicking the same control to flip **[D]** A26 ("You can click the Recent sorter to see the very first card you cataloged"). Icons `ui-arrow-drop-up` / `ui-arrow-drop-down` appear 96× each **[O]** — every sort control is a bidirectional toggle.

**[D]** C2: sorting is instantaneous client-side reordering, must not stall on sets with hundreds of cards.

## 5.4 Composition and URL persistence

- Filters **compose as AND across fields**, **OR within a field**. **[I]** — A6 says "the ability to combine multiple filters for refined searches"; the multi-select chip UI implies OR within a field. Not explicitly documented.
- **URL persistence: filters and sorts are NOT in the URL.** **[O]** — a scan of every `href` and every query string across all 24 DOM captures yields only these params: `?tab=` (profile), `?redirect=` (auth), `?Printing=`/`?Condition=` (outbound TCGplayer), `?signature=` (image CDN), `?id=` (Play Store). No `sort=`, `view=`, `filter=`, `goal=`, `variant=` anywhere.
- **[I]** Therefore filter/sort/goal/view state is React component state, lost on reload and unshareable.
- **Divergence recommendation for our clone: put it in the URL.** Costs nothing, makes state shareable and back-button-correct, and is strictly better UX. Flagged in ROUTE-MAP.md.

## 5.5 Global card search

**[D]** A35. Search box at the top of every page; on mobile it collapses to a search icon next to the avatar. **[O]** placeholder `Search Cards...`, present in all 22 app-shell captures; the mobile variant is an icon-only button.

Accepted search terms **[D]** A35:
- **Card Name** — "Umbreon, Misty, Nest Ball"
- **Card Number** — "215, #215/203"
- **Set Name** — "Evolving Skies, Cyber Judge"
- **Combinations** — "Aerodactyl V 180 to get an exact match"

**[D]** A3 recommends `Card Name + Card Number`, e.g. `Lugia V 186`.
**[D]** C3: rarity terms are weighted in the query — searching `Shiny Raichu` or `lucario promos` surfaces rarity-matched cards first.

**[O]** An `advanced search` affordance (`aria-label="advanced search"`, icon `nav-sliders-horizontal`) sits inside the global search box on every page.

## 5.6 Card Preferences (catalogue scoping)

**[D]** A4. Three toggles, set during onboarding and editable in Account Settings:
1. **English Pokémon Cards**
2. **Japanese Pokémon Cards**
3. **Pokémon TCG Pocket Cards**

**[D]** A4 verbatim: "If you have English and Japanese enabled for example, you'll see both English and Japanese cards in the main navigation, card search, etc."

**[O]** The left nav renders three catalogue entries `English TCG | Japanese TCG | TCG Pocket` in every capture, and the profile/collection views carry an `English TCG` dropdown to switch catalogue. **[D]** A26: "Click the English TCG dropdown to switch to Japanese or Pocket."

**[I]** Catalogue is a hard partition: separate route trees (`/series`, `/jp/series`, `/tcg-pocket-en/series`), separate collection totals, separate progress. `dom/profile-squalls.html` shows `Total Cards` / `Unique Cards` under an `English TCG` selector, implying per-catalogue aggregates.

---

# 6. Lists

## 6.1 Three list types (not two)

| Type | Semantics | Tag |
|---|---|---|
| **Dynamic List** | "trackable lists and tied to your personal collection across the platform… it will have **checkboxes and progress bars**. If you check off a Charizard from a set view or search, you'd also see that Charizard checked off in your Dynamic List." | **[D]** A9 verbatim |
| **Static List** | "not trackable or tied to your personal collection… **it won't have checkboxes or progress bars**." Allows the *same card to appear multiple times as separate entries*. | **[D]** A10 verbatim |
| **Pokédex Binder** | A third, **Pro-only** list type. | **[O]** `dom/profile-lists.html` renders `National DEX!!!!! — Pokédex Binder - Public` and `Kanto DEX — Pokédex Binder - Public`; **[O]** `dom/pro.html` benefit "Pro Only List Types — Create unique list experiences designed for professional collectors including **Pokédex Binders** and more coming soon." |

> ⚠️ The brief and the help center both say "Dynamic vs Static". **There is a third type.** A Pokédex Binder is presumably a list whose membership is one slot per Pokémon species rather than per card — **[I]**, its exact behaviour is undocumented. See §14.

## 6.2 Dynamic list sync

1. A Dynamic List holds card references. **[D]** A9.
2. Quantity/ownership is **read through** from the collection, never stored on the list. **[D]** A9 — checking a card anywhere on the platform reflects into the list, and vice versa.
3. The list therefore shows **owned qty per row** — **[O]** `dom/list-public.html` renders leading quantities `0, 0, 0, 0, 3, 0, 0, 0, 7, 1` on a 10-card list belonging to a logged-out viewer, i.e. the **owner's** quantities are public data on a public list.
4. Progress bars are list-level: "what you own, what you're missing, and how many copies you have". **[D]** A9.
5. Pricing on a Dynamic List reflects only what you actually own. **[D]** A9: "a Dynamic List lets you see accurate pricing for what you actually have."

**Documented use cases [D]** A9: tracking progress toward a custom goal; investment portfolio; upgrade checklist ("Upgrade These to PSA 10"); inventory organisation ("All My Graded Cards", "My Reverse Holos").

## 6.3 Static list semantics

**[D]** A10: no checkboxes, no progress bars, not tied to the collection. Its distinguishing power is that **each copy is a separate row**: "If you're selling multiple copies of the same card, a Static List allows you to display each card separately."

**[I]** Schema consequence: a static list is an ordered bag of `(card_id, variant_id)` entries permitting duplicates and carrying their own row identity; a dynamic list is a **set** of `(card_id, variant_id)` keys with quantity read from the collection.

**Documented use cases [D]** A10: selling; public showcase; trade binder (remove rows as you trade); tournament deck proxies.

## 6.4 List detail page

**[O]** `dom/list-public.html`:
- Back link `My Lists`
- Title, then info bar `Created By (avatar + username, links to /u/…) | Created On | # of Cards | Full List Market Value`
- Description text
- Sort strip: `Custom | Number | Name | Rarity | Price | Artist | Released`
- View toggle: `Grid | Table | Binder`
- Rows: `qty | name | price | #number | variant`

`Custom` sort = the manual arrangement. **[D]** home page: "Sort, Filter, and **Arrange** your List any way you'd like" (`dom/home.html`). **[D]** C3 bug fix: "Dragging to reorder cards in your lists had stopped responding on phones and tablets. Touch dragging behaves like it used to." → drag-to-reorder, mouse and touch.

## 6.5 List operations

| Operation | Detail | Tag |
|---|---|---|
| Create | Type chosen at creation (Dynamic / Static / Pokédex Binder) | [D] A9/A10 + [O] |
| Add card | Via an "Add-to-List picker" modal reachable from any card | **[D]** C2 names it verbatim: "the Add-to-List picker"; also "Tapping a card you have already added no longer throws an error, and the checkmark on an added card is solid black again" |
| Remove | Yes (A10 trade-binder use case: "You can then remove cards from the list as you trade or sell them") | [D] A10 |
| Reorder | Drag, mouse + touch | [D] C3 |
| Favourite | ⭐ toggle. "Tap the ⭐ icon to favorite a list which will have it always show first both for you and those viewing your lists on your profile. If you have multiple lists favorited, the last edited will also filter to the top of your favorites." Default order is **last-edited descending**. | **[D]** A11 verbatim |
| Cover image | Open list → click a card image → three-dots menu → **Make Cover Card**. List settings offer **Art Focus** vs **Full Card** rendering of the cover. | **[D]** A12 |
| Visibility | Public / Private. `Dynamic List - Public`, `Static List - Public`, `Pokédex Binder - Public` labels render on the profile Lists tab. Home page: "Share your List with anybody or keep it locked down as **Private**." | **[O]** `dom/profile-lists.html`, `dom/home.html` |
| Bulk ops | **Not documented anywhere.** | — see §14 |

## 6.6 List limits (Pro-gated)

| | Free | Pro |
|---|---|---|
| Number of lists | **1** | Unlimited |
| Cards per list | **200** | **400** |
| Number of decks | **1** | Unlimited |

**[D]** A13 verbatim: "As a free user, you can create and manage one List of up to 200 cards. As a Pro Member, you unlock Unlimited Lists and increase each list's capacity from 200 total cards to 400."
**[D]** A14 + **[O]** `dom/pro.html` comparison table confirms `# of Lists: 1 List / Unlimited Lists`, `# of Decks: 1 Deck / Unlimited Decks`, `Cards Per List: 200 Cards / 400 Cards`.

**Our clone replicates all of it with no limits.** Note the limits so the UI copy doesn't accidentally ship an upsell.

## 6.7 Empty state

**[O]** `dom/lists.html`, logged out: **"No Lists Yet"** / *"Log in to create your first Pokémon TCG list."* / `[Log In]`.

---

# 7. Binder view

**Pro-gated on the real site.** **[D]** A8, **[O]** `dom/pro.html`.

1. **Where it works:** Sets, Lists, and Pokédex pages. **[D]** A8, A20, **[O]** `dom/pro.html`.
2. **Pocket layouts — SOURCES CONFLICT:**
   - **[D]** A8: "four binder configurations: **9-pocket, 12-pocket, 16-pocket, and 4-pocket**".
   - **[O]** `dom/pro.html` (twice, in the benefits grid and the comparison table): "View Sets, Lists, and Pokédex pages as a **9, 12, or 4-pocket** binder!"
   - **[I]** 16-pocket was likely removed, or the marketing copy is stale. Ship 4 / 9 / 12 and leave 16 behind a flag.
3. **Cards reposition automatically** when you change pocket size. **[D]** A8.
4. **Variant stacking toggle:** "Users can either stack variants like Reverse Holofoil **behind** the standard slot, or arrange each variant in **separate slots**." **[D]** A8. This is the binder-specific analogue of the "separate variants" search toggle (§5.2).
5. **Search-to-slot:** search by name or number and the binder will "bring you to the right page and highlight the slot". **[D]** A8. So search is a *navigation* action in binder view, not a filter.
6. **Drag to arrange:** "reorder your cards to replicate your IRL binder exactly". **[D]** A8. Touch drag supported. **[D]** C3.
7. **Stated purpose:** "prevents the frustration of miscounting slots" / "You'll know exactly which binder page and slot each card belongs in." **[D]** A8, **[O]** `dom/pro.html`.
8. **Pagination:** implied — "bring you to the right **page**", "which binder **page** and slot". **[I]** Pages of `pocket_size` cards, numbered from 1, rendered as a two-page spread or single page (undetermined; the screenshot at `screenshots/list-public--1440.png` is grid view, not binder).
9. **Ordering rule:** **[I]** default order = the page's active sort (set → card number; list → Custom/manual); manual drag overrides and persists per list. A set page has no user-owned ordering to persist, so **[I]** binder ordering on a set is derived from sort + variant-stacking only.

**Difference from Grid view:** grid is a responsive fluid-column flow with no fixed page boundary; binder is a fixed `rows × cols` page unit with slot identity, page numbers, empty slots rendered as placeholders, and drag-reorder. **[I]**

---

# 8. Deck builder

## 8.1 Deck creation and the format gate

1. **"When you create a deck, you'll be asked which Format the deck is."** **[D]** A15 verbatim.
2. **"Based on the format you choose, we'll only show cards allowed in that format to make your deck building life easier."** **[D]** A15 verbatim — **the format filters the card search pool**, it doesn't merely validate after the fact.
3. **[O]** `dom/trydeckbuilder.html` format tab strip: `Standard | Expanded | Gym Leader Challenge | Unlimited`.
4. **[D]** C3 bug note: the Unlimited format once "was coming back empty… caused by an issue with how decks with English Unlimited formats were being saved" — confirming format is a persisted enum on the deck row, and that the format→card-pool query is a real filter.
5. **[O]** the Create Deck flow is a modal ("The Create Deck window could clip its top row so you couldn't reach the first field. It now fits the screen and scrolls." — C3).

## 8.2 Deck builder layout

**[O]** `dom/trydeckbuilder.html`:
- Left/main: search bar, `Advanced Filters` collapsible (icon `ui-down-caret`, `aria-label="expand filter"`), sort strip `Best Match | Number | Name | Rarity | Price | Artist | Released`, results grid.
- Right rail (mobile: a yellow up-arrow drawer — **[D]** A18): `Format: {x}`, `Legal Status: {Legal|Not Legal}`, `{n} / 60 Cards`, `Deck Price: ${x}`, column headers `Name | Qty`, `Test Hand` button.
- **[O]** `aria-label="expand deck list"` exists → the deck list panel is collapsible.

**Empty states [O]:**
- Search: **"No Active Filters"** / *"Begin searching for cards by using the search bar or applying any filters!"*
- Logged out: **"Sign Up to Create Decks"** / *"Create a free account today to save your decks and much more!"*

## 8.3 Format rules

### Deck size
60 cards, all formats. **[O]** `0 / 60 Cards` in `dom/trydeckbuilder.html`; **[D]** gymleaderchallenge.com/rules for GLC ("60 card decks are built & 6 Prize Card games are played").

### Copy limit
**"Standard Format allows for a max of 4 cards of the same name, so we'll automatically ensure you don't go over max for the format rules."** **[D]** A16 verbatim (with pkmn.gg's own typo "sane name").
**[I]** The 4-copy cap keys on **card name**, not card id — so 4 total across all printings of "Nest Ball". Basic Energy is exempt (universal TCG rule; not stated by pkmn.gg but stated for GLC by the GLC rules).

### Per-format legality windows

| Format | Card pool | Tag |
|---|---|---|
| **Standard** | "only the most recent card sets, typically covering the last two to three years of expansions. The rotation happens annually." | **[D]** A15 verbatim |
| **Expanded** | "a much larger card pool, including sets from **Black & White onward**… still enforces a ban list" | **[D]** A15 verbatim |
| **Gym Leader Challenge** | see below | [D] A15 + gymleaderchallenge.com |
| **Unlimited** | "cards from **every** Pokémon TCG set ever released" | **[D]** A15 verbatim |

**[D]** A16 (rotation): "Depending on which rotation a format is in, certain cards may fall out of rotation, meaning they are no longer legal for a given format. We'll highlight any cards that are no longer legal during deck editing. Here you can see the Battle VIP Pass and Cross Switcher are no longer legal for Standard Format play."

⇒ **Legality is a per-set (and per-card, for bans) attribute with an effective date window.** A saved deck can become illegal when rotation happens, and the builder must **highlight the now-illegal cards in place** rather than silently removing them. **[D]** A16.

**[I]** Implementation: `set_legality(set_id, format, legal_from, legal_until)` + `card_ban(card_name, format, banned_from)`. Standard rotation is a yearly event that shifts `legal_from`; do not hard-code a regulation-mark letter list in the UI layer.

### GLC — full rules

**[D]** A15 (pkmn.gg's own description): "a fan-created format that focuses on singleton deck-building, meaning you can only have one copy of each card (except Basic Energy), and your deck must consist of only a single Pokémon type… With no rule box Pokémon allowed (like Pokémon V, GX, or EX), it emphasizes traditional evolution-based strategies."

**[D]** https://gymleaderchallenge.com/rules (verbatim):
- "Your deck can only contain one type (color) of Pokémon."
- "Only one of each card with the same name allowed in a deck, except for Basic Energy."
- "Cards with a Rule Box are not allowed."
- "ACE SPEC cards are not allowed."
- "Legal Cards: *Black & White* – onwards, and a short ban list"
- "60 card decks are built & 6 Prize Card games are played with the most current Pokemon TCG rules."

**[D]** (secondary, gymleaderchallenge.com/faq via search summary): Rule Box covers Pokémon V, EX, GX, BREAK, Radiant Pokémon, ACE SPEC, and Prism Star cards (including Prism Star Trainers and Energy). Cards that are one type and evolve into a different type cannot be played in the same deck.

⇒ Five independent GLC validators:
1. `deck_size == 60`
2. singleton on card name, **except Basic Energy** (unlimited)
3. all Pokémon share exactly one type — **including evolution-line type coherence** (a Grass Eevee line evolving into a Water Vaporeon is not legal in a Grass deck)
4. no card with a Rule Box; no ACE SPEC; no Prism Star
5. set ∈ Black & White onward; card ∉ GLC ban list

**[I]** "Type" here means the card's Energy type (colour), and it applies to Pokémon only — Trainers and Special Energy are typeless for this check. The GLC ban list must be a data table, refreshed manually; it is not published in a machine-readable form.

### Unlimited
No rotation, no restrictions beyond the base game rules. **[D]** A15: "mostly used for casual or fun games… house rules or restrictions are often applied" — i.e. pkmn.gg applies none. **[I]** Only deck size + 4-copy + basic-energy exemption apply.

## 8.4 Legality feedback UI

1. `Legal Status: Not Legal` renders live in the deck panel. **[O]** `dom/trydeckbuilder.html` shows `Not Legal` at 0/60 cards — i.e. an incomplete deck is Not Legal, so deck size is part of the predicate.
2. **"If your deck is displaying Not Legal for your selected format, you can click on the orange `Not Legal` information text to view why your deck isn't in legal status."** **[D]** A16 verbatim. ⇒ Not Legal is a clickable disclosure listing **all** failing rules, coloured orange.
3. The builder **prevents** exceeding the copy cap rather than flagging it after the fact ("we'll automatically ensure you don't go over max"). **[D]** A16.
4. Rotated-out cards are **highlighted in the deck list** during editing. **[D]** A16.

**[I]** So there are two distinct error surfaces: *hard prevention* (copy cap), and *soft highlight + disclosure* (rotation, bans, type violations, size).

## 8.5 Test Hand

**[O]** `Test Hand` button with icon `decks-hand`, present on both the builder rail and the saved-deck page.
**[D]** home page: "Test Hands quickly to see how your deck performs." (`dom/home.html`).
**[I]** Draws 7 random cards from the 60. Mulligan handling (redraw if no Basic Pokémon), prize-card simulation, and repeat-draw controls are **undocumented**. See §14.

## 8.6 Deck pricing and purchasing

1. "As you build your deck with the deck builder, the estimated price updates in **real-time**." **[D]** A17.
2. `Deck Price` renders in the builder rail and on the saved deck page. **[O]** `dom/trydeckbuilder.html` (`$0.00`), `dom/deck-public.html` (`$576.79`).
3. **`Purchase Deck`** → "buy all cards from TCGplayer. A confirmation popup will display the complete card list before finalizing." **[D]** A17, **[O]** button present in `dom/deck-public.html`.
4. **Collection Mode** on the purchase flow → "only purchase the missing cards needed to complete this deck". **[D]** A17.
5. **[I]** Deck price = Σ over cards of `qty × main-variant market price`, since deck lists are variant-agnostic.

## 8.7 Saved deck page

**[O]** `dom/deck-public.html`:
- Back link `My Decks` → `/decks`
- Title; info bar `Created By (avatar + link) | Format | Created | Updated (relative) | Deck Price`
- Action row: `Test Hand` · `Export to PTCGLive` · `Purchase Deck` · `Image` (icon `decks-image-generate`; two variants of the button exist — `aria-label="create image"` and `aria-label="download image"`, the latter in a Safari-specific wrapper)
- Sections: `Pokémon (17)`, `Trainer (35)`, `Energy (8)` with per-card quantity chips

**Deck cover image [D]** A18: enter Deck Editing → select a card from the deck list on the right (mobile: tap the yellow up arrow) → card details window → three-dots menu → make cover card. Deck Settings offers **Full Card** ("will show the entire card as your deck cover") vs **Art Focus** ("will zoom your cover card into the art portion of the card"). Default cover is grey.

**Favouriting [D]** A19: star icon; default order is last-edited descending; favourites pin to the top both in your own deck list and on your public profile; among favourites, last-edited wins.

## 8.8 PTCG Live import / export

**[O]** The button is labelled **`Export to PTCGLive`** (`aria-label="Export to PTCGLive"`, icon `decks-pc`) — one word, no space. **[D]** home page: "Export/Import with PTCGLive and one-click deck purchase."

**No pkmn.gg article documents the text grammar.** What follows is **[I]**, from the community-standard PTCGO/PTCGL clipboard format plus one corroborating **[O]** data point.

**[O] corroboration:** the card changelog carries a per-card field literally named **`TCGplayer Mass Entry`** whose value is `1 Goldeen [ME05] 13` / `1 Slowbro [ME05] 30` / `1 Vullaby [ME05] 49`. That is TCGplayer's Mass Entry grammar (`{qty} {name} [{setcode}] {number}`), **not** PTCGL's. Note the two are different and both are needed:
- **TCGplayer Mass Entry** (used by `Purchase Deck` / `Purchase Missing Cards`): `{qty} {name} [{setAbbrev}] {number}` — square brackets. **[O]**
- **PTCG Live** (used by `Export to PTCGLive`): `{qty} {name} {SETCODE} {number}` — no brackets. **[I]**

**Proposed PTCGL grammar [I]:**

```
decklist   := section+ total?
section    := header NEWLINE line+ NEWLINE?
header     := ("Pokémon" | "Trainer" | "Energy") ":" SP count
line       := count SP name SP setcode SP number
             | count SP name                     ; permitted for Trainers/Energy
total      := "Total Cards:" SP count
count      := [0-9]+
setcode    := [A-Z0-9]{2,8}                      ; e.g. OBF, PAF, SVI, SWSHALT
number     := [0-9]+ | [A-Z]+[0-9]+              ; e.g. 125, SWSH133, TG03
```

Example **[I]**:

```
Pokémon: 4
2 Charmander OBF 26
1 Charmeleon OBF 27
1 Charizard ex OBF 125

Trainer: 4
4 Rare Candy SVI 191

Energy: 1
9 Basic {R} Energy SVI 255

Total Cards: 60
```

**Import parser must tolerate [I]:** the `* ` line prefix emitted by some PTCGO exports; `Basic {R} Energy` brace notation for basic energies; PTCGL's in-game-exclusive promo codes (e.g. `SWSHALT 127` for a card that is really `BRS 132`); missing set/number on Trainer and Energy lines; a blank line between sections; and CRLF. Round-tripping a deck through import→export must be lossless for card identity even when the source used an alias set code — meaning we need a `ptcgl_alias(set_code, number) → card_id` table.

> **This grammar is the weakest-evidenced part of this spec.** Verify against a real PTCGL export before implementing. See §14.

---

# 9. Pricing

## 9.1 Source and default price

**[D]** A23 verbatim: "All card pricing on the pkmn.gg platform comes from **TCGplayer market prices**. When you see a price under a card, this is the **near mint market price of the raw, ungraded card**."
**[D]** A25: "If a card displays $5.00, this means the ungraded, near mint version of that card is worth $5.00 in the U.S. marketplace."
**[D]** A24: "TCGplayer market prices of the raw, near mint version of a card."

⇒ **Default displayed price = TCGplayer *Market* price, Near Mint, ungraded, USD, for the card's main variant.** Not Low, not Mid, not Market-of-all-conditions.

**Freshness:** **[O]** `dom/card-151-006.html` renders `Prices updated 15 hours ago`. **[D]** home page markets "same-day pricing".

## 9.2 Price history and trends

**[D]** A23:
1. Card Details → **`Price` tab** → history graph.
2. Range selector across the top: **`Last 30 Days | Last 3 Months | Last 6 Months | Last Year`**.
3. Below the graph: **absolute price change and percentage change for the selected period**.
4. Multi-variant: each variant is a series; **click a variant name to remove it from the graph**.

**[O]** `dom/pro.html` — **Collection Price Trends** is a Pro benefit: "Track price shifts for your collection. Sort by **24h, 7d, or 30d** and view by **percentage or price change**." Comparison table row: `Collection Trends — Only Full Market (free) / Full Market + Personalized (Pro)`.

⇒ Two distinct trend surfaces: per-card price-history windows (30d/3m/6m/1y) and per-collection movement windows (24h/7d/30d). **[D]/[O]**

**History retention is tier-gated [O]** `dom/pro.html`: `Total Collection History — 1 Year (free) / 3 Years (Pro)`, marketed as "3 Years of Total Collection Data".

## 9.3 Collection value

**[D]** A24:
- Auto-maintained; shown on the profile.
- Includes: **English and Japanese cards, special variants, total quantities, and graded card values**.
- **`Value History`** button → graph by time, with total Price Change and Percentage Change for the period.
- **Privacy control**: Account Settings has a setting for whether your total collection value is shown to others.

**[O]** `dom/profile-squalls.html`: `Total Estimated Collection Value $37,577.09` + `Value History` button (icon `profile-graph`) + a catalogue selector `English TCG` + `Total Cards 31,952` + `Unique Cards 6,462`.

**Calculation [I]:** `Σ over collection rows of quantity × variant_market_price`, with any graded entry's manually-entered value **overriding** the ungraded NM price for that copy (**[D]** A28: "The value you enter for your graded card will be added to your Total Estimated Collection Value and will **override** the default pricing of the ungraded, near mint version of the card").

**[I]** ⚠️ A24 says the total "includes English and Japanese cards" while the profile UI shows the value under an `English TCG` selector. Ambiguous whether the headline figure is per-catalogue or all-catalogue. See §14.

## 9.4 Currency

**[D]** A25:
- Account Settings → **`Currency Display`** dropdown → select → **Save**.
- Documented options: `GBP (£)`, `CAD ($)`, `CLP ($)`, `AUD ($)`, `EUR (€)`, `MXN ($)`, `JPY (¥)`, `CNY (¥)`, `INR (₹)`, "and more".
- **All prices are stored/sourced in USD and converted for display.** "Based on your selection, we'll automatically convert from USD ($) to your selected currency and display that throughout the platform."

⇒ **Store USD. Convert at render. Never store converted values.** **[D]**

**[I]** The FX rate source and refresh cadence are undocumented.

## 9.5 The global "disable pricing" toggle

**[D]** home page verbatim: **"If you wish, pricing can be disabled in your account settings."** (`dom/home.html`).

**[I]** No article covers it. Behaviour to implement: an account setting that suppresses every price string site-wide — card tiles, card detail variant table, set `Full Set Market Value` / `Most Expensive Card`, list `Full List Market Value`, deck `Deck Price`, profile `Total Estimated Collection Value`, Pokémon `Total Market Value`, price-sort options, the Price tab, the trends surfaces, and the stream-overlay price columns. Whether it hides or merely blurs, and whether price-based sorts disappear or grey out, is undetermined.

## 9.6 Outbound buy links

**TCGplayer [O]** — exact affiliate URL shape harvested from `dom/card-151-006.html`:

```
https://tcgplayer.pxf.io/c/4924654/1830156/21018?u=https://tcgplayer.com/product/502558?Printing=Holofoil&Condition=Near+Mint
```

⇒ per-**variant** product id, plus `Printing` and `Condition=Near Mint` defaults. **[D]** A33: "We default to Near Mint condition, but when adding cards to your cart, ensure you double check the condition, printing, etc."

**eBay [O]** — from `dom/card-151-006.html`:

```
https://www.ebay.com/sch/i.html?_nkw="charizard ex"+"151"+"6"&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339091777&customid=pkmnggsite&toolid=10001&mkevt=…
```

⇒ a **search** URL built from quoted `"{card name}" "{set name}" "{number}"`, not a product link. **[D]** A34: "Click the 'eBay' button under the variants list to see live listings."

**Our clone:** construct plain `tcgplayer.com/product/{id}?Printing=…&Condition=Near+Mint` and the eBay search URL, with **no affiliate parameters** (we are not an affiliate and it would be dishonest to inject someone else's).

## 9.7 Purchase Missing Cards (set-level)

**[D]** A33, step by step:
1. On a set page, click **`Purchase Missing Cards`**.
2. A modal confirms the full list of missing cards. **Default scope = "Any missing cards including Reverse Holofoil, Normal, etc. from the primary set."** You can narrow it (e.g. only Reverse Holofoils).
3. Click **`Add to Cart`** → opens **TCGplayer's Mass Entry form**, prepopulated.
4. On TCGplayer you choose printings and conditions.
5. Pro tip in the article: TCGplayer's **`Optimize`** button reduces cost.

**[I]** The modal's variant scope selector is the same variant-filter vocabulary as §5.2 and should reuse it. Step 3 is where the `TCGplayer Mass Entry` string per card (**[O]** §8.8) gets used.

---

# 10. Graded cards (Pro-gated)

**[D]** A28, complete flow:

1. Click a card → Card Details → **`Graded` tab** (on mobile you may need to swipe the tab menu left) → **`Add Graded Card`**.
2. **Grading companies** (exact list): `PSA`, `BGS`, `TAG`, `CGC`, `ARS`, `AGS`, `ACE`, `SGC`, `TGA`. Article invites requests for more.
3. Then select **Grade**, **Variant**, and **Condition**. Optional: **unique ID (cert #)** and **URL link**.
4. **`Also Add to Collection`** — Yes/No. "If 'Yes', this will add one card of this variant to your collection. Usually if you pull a card yourself and check it off before getting your graded version back, you'll leave as No."
5. **Pricing is manual.** "At this time, the value of the graded card must be entered manually. We plan on adding automatic PSA pricing… in the future."
6. The entered value **is added to Total Estimated Collection Value and overrides the ungraded NM price** for that card.
7. The Graded tab then displays: **Grading Company Logo, Grade Number & Condition, Variant, Cert #, Value, Link to Graded Card URL**.

**[O]** `dom/primitives-showcase.html` contains a `Select` primitive whose demo is literally `Grader: PSA / CGC / BGS`, confirming the field name is **Grader**.

**[I]** Schema: `graded_card(id, user_id, card_id, variant_id, grader, grade, condition, cert_number, url, value, also_in_collection)`. Multiple graded copies per card must be supported (the tab is a list).

---

# 11. Private Card Notes (Pro-gated)

**[D]** A29:
- Card Details → **`Private Notes` tab**.
- A note has a **label** plus up to **2,000 characters** of body.
- **Multiple notes per card** ("you can leave more than one note on a card").
- **Visible only to the creator.** "These notes can only be seen by the creator."
- Cleared by Reset Collection. **[D]** A30.

---

# 12. Profile and showcase

## 12.1 Profile anatomy

**[O]** `dom/profile-squalls.html`:
- Banner (Pro-only custom upload **[D]** A32), avatar, username, `Joined {Mon YYYY}`, `Friends {count}`, a second numeric badge (**[I]** Trainer Level or Pro badge — `aria-label="user lvl"` and `aria-label="pro member"` both appear).
- Tab strip: **`Profile | Collection | Insights | Activity | Lists | Decks | Friends`**.
- Bio (free text with emoji).
- `Total Estimated Collection Value` + `Value History` button.
- Catalogue selector (`English TCG`), `Total Cards`, `Unique Cards`, and a row of ~11 numeric figures (**[I]** a rarity or type breakdown chart — the label text is not in the DOM, only the numbers `760 450 786 491 777 650 490 312 164 637 21`).
- **Showcase card strip** — 4 cards observed (`Umbreon ex #217`, `Espeon ex #211`, `Flareon ex #202`, `Leafeon ex #200`).
- **Set progress cards**, newest-first, each rendering `{set name} | {release date} | {n}/{total} Collected | LVL {n} | {pct}%`.

## 12.2 Showcase cards

**[D]** A31 verbatim: "Free members can select up to **4** cards to showcase and Pro Members can showcase up to **8**."
**Flow [D]** A31: open any card's Card Details → **three-dots menu** → **`Add to Showcase`** → replace an existing card by clicking the **slot # buttons**.
**[O]** `dom/pro.html` comparison table: `# of Showcase Cards — 4 Cards / 8 Cards`.
**[D]** A30: showcase ("Spotlight") cards survive a collection reset.

## 12.3 Profile customisation

| Field | Free | Pro | Tag |
|---|---|---|---|
| Avatar | ✅ | ✅ | [D] home: "Customize your avatar, banner, bio, showcase cards, and more" |
| Bio | ✅ | ✅ | [O] |
| Banner | default | **custom upload** | **[D]** A32 |
| Showcase cards | 4 | 8 | **[D]** A31 |
| Pro badge | — | ✅ | [O] `dom/pro.html` |
| Username | ✅ | ✅ | [O] placeholder `username` in `dom/primitives-showcase.html` |

**Privacy [D]** A37: "You can customize your profile privacy in Account Settings. You can choose to have your profile **visible to all** or **only to approved friends**."
**Collection-value privacy [D]** A24: separate setting for whether the total value shows to others.

## 12.4 Friends

**[D]** A37:
1. Friends icon in the top avatar menu (mobile: tap avatar → friends).
2. **`Find a Friend`** tab → enter **pkmn.gg Username** → send Friend Request.
3. Pending requests show a **yellow notification dot** on the friends icon plus a notification button on your profile. Accept or decline.

**[D]** A38 — comparison surfaces:
- Browsing a profile shows their set progress and lets you "dive into their Haves, Needs, Dupes from this view".
- Card Details has a **`Friends` tab** listing which friends own that card, **including quantity and which variants they have**.

**[D]** A39: free members viewing another collection can see the most recent cards added and search for a specific card; **Pro** members can sort by price and apply advanced filters on *other people's* collections too.

**[I]** For our single-user clone: keep the profile/showcase/value model, drop friends entirely, or stub it. Note that the `Friends` tab on card details is a nice place to later show "which of my lists contain this card" instead.

---

# 13. Auth, empty/loading/error states, and misc

## 13.1 Auth

**[O]** `dom/auth-signin.html`:
- `Log In` heading; `Continue with Google` · `Continue with Discord` · `Continue with Apple`; `or`; email field (`placeholder="Email Address"`); *"If you created an account via email, enter it below and we will email your login link."*; `Send Magic Link`; `Need an Account? Sign Up Free`; `Just looking to browse? Go Back Home`; consent line: *"By logging in to pkmn.gg, I confirm that I have read and agree to the pkmn.gg Terms of Service, Privacy Policy, and to receive emails and updates."*

**[O]** `dom/auth-register.html`: identical except heading `Sign Up Free!`, `Already a Member? Sign In`, and *"By joining pkmn.gg…"*.

**[D]** A42: OAuth via Google / Discord / Apple, or **passwordless magic-link email** — "the platform uses a passwordless magic link email method to enable signup and signin without storing passwords on their servers". Discord sync unlocks Discord roles. Onboarding then "asks a few questions to personalize your experience" — **[I]** this is where Card Preferences (§5.6) and probably the default collection goal are captured.

**[O]** Post-auth redirect uses `?redirect=` — observed values `/auth/signin?redirect=/lists` and `/auth/signin?redirect=/pro`.

**Error state [D]** A43: the magic-link failure page shows a message; the documented cause is threaded email clients collapsing multiple magic-link emails — only the **latest** link works. Fallback copy: "We understand it's frustrating not being able to sign in but rest assured that your account and collection data is safe."

**[D]** A36: **stream overlays only work with Google or Discord login**, because OBS's browser layer must authenticate — magic link can't work there.

**[I] For our clone:** single-user, LAN-only. Replicate the *page layout* but not the auth mechanism. A single local credential (or no auth behind the reverse proxy) is correct here; keep the `?redirect=` pattern.

## 13.2 Empty states (all [O], from the captures)

| Surface | Copy |
|---|---|
| `/lists` logged out | **No Lists Yet** / "Log in to create your first Pokémon TCG list." / `[Log In]` |
| `/pokedex` logged out | "**Create an account** to begin catching Pokémon here! Level up your Pokémon by collecting cards featuring them." |
| `/trydeckbuilder` logged out | **Sign Up to Create Decks** / "Create a free account today to save your decks and much more!" |
| Deck-builder search, no query | **No Active Filters** / "Begin searching for cards by using the search bar or applying any filters!" |
| Another user's decks tab, empty | **No Public Decks** / "This user has not created any public decks yet." |
| Search with no matches | **No Results** / "No Pokémon match \"Pikachu\"" |
| Profile → Collection, free tier | "Unlock Advanced Filters and Sorting with [Pro]" |
| Card detail, logged out | "Log In to Track Collection" |
| Price unavailable | `N/A` in place of the price string |

The last two rows of that table come from `dom/primitives-showcase.html`, which exposes pkmn.gg's own **`EmptyStateMessage`** component with `title` + `body`. Build the same primitive.

## 13.3 Loading and error primitives

**[O]** `dom/primitives-showcase.html` enumerates the design-system primitives:
- `Button` — variants `default | primary | danger | ghost | dashed` × sizes `sm | md | lg` × `disabled`
- `IconButton` — `★`, `＋`, `✕`
- `Checkbox` — `Unchecked`, `Disabled (checked)`, plus an interactive "Toggle me"
- `TextInput` — states `Default | extraDark | Error | Required | Success | Available | Disabled`, with a `×` clear affordance (`aria-label="Clear input"`)
- `Select` — states `default | Disabled | Error`, with placeholder `Pick one`
- **`CardSkeleton`** ← the loading state for card tiles
- **`EmptyStateMessage`**
- **`ErrorBoundary`** — "Children render normally when nothing throws."
- `SvgIcon`
- **`Toast`** — "pinned bottom-right", example severity `Info: changes saved as a draft.`

**[D]** C2 describes the list-virtualisation behaviour: "Set pages, Pokémon pages, lists, and your collection pages now render the cards on screen and fill the rest in as you scroll, instead of building the entire list up front." ⇒ **virtualised/windowed grids with skeleton placeholders**, not eager full-list render. On a Pi this is mandatory, not optional.

**[O]** `Load More` / `Load more` buttons appear on `dom/profile-collection.html` and `dom/card-changelog.html` ⇒ paginated feeds coexist with virtualised grids.

## 13.4 Reporting flows

**[D]** A44:
- Missing **variant printing**: Card Details → more menu (`...`) → **`Report Missing Variant`**.
- Missing **other data** (whole sets, promos): avatar menu → **`Report Missing Data`**.
- Before reporting, check the card's existing variant list.
- English and Japanese only; other languages not accepted.

**[I]** For a single-user clone this becomes "queue a catalogue-correction note for the next sync" or is simply dropped.

## 13.5 Stream Tools (Pro-gated)

**[D]** A36 + **[O]** `dom/stream-tools.html`. Three overlays, each with `Open Overlay URL`, a catalogue selector (`English TCG | Japanese TCG | TCG Pocket`), and shared options `Rounded Corners` + `Background Opacity (None, 1–9, Full)`:

**1. Set Overlay** — recommended OBS size **450×450**. Options: `Set Logo`, `Cards Collected`, `Progress Bars`, `Master Set Progress Bar`. Preview renders `0 /207 Collected · LVL 0 · 0% · 0% · Powered By`. Live-updates as cards are checked from any device.

**2. Set Card List** — recommended OBS size **375×850**. Options: `Set Logo`, `Cards Collected`, `Card Price`, `Card Number`; `Cards to Display: All | Cards I Need | Cards I Have`; `Card Order: Number | Name | Highest Value | Lowest Value`; `Card Count: 10 | 15 | 20 | 25 | 50 | 100 | All`. Preview is a `Cards | No. | Price` table.

**3. Card Push Overlay** — recommended OBS size **500×800**. Options: `Card Only Mode`, `Include Card Details`, `Include Card Price`. Flow **[D]** A36: open a card from anywhere → actions menu → **`Push to Stream`** → card appears on the overlay; the same button becomes **`Clear from Stream`**.

**[D]** A36/**[O]**: "Copy the URL of your overlay and add it as a Browser layer in OBS/Streamlabs OBS. You will need to log in to your account through the Browser layer in OBS by clicking the Interact button to authorize…" and "Overlays will only work with Google or Discord login method."

**[I]** Architecturally this is a per-user signed overlay URL + a push channel (WebSocket/SSE). For our clone, LAN-only and single-user, a simple token-in-URL + SSE is sufficient. The brief lists this as low priority.

---

# 14. Pro-tier gating summary

Everything below is **Pro-gated on pkmn.gg**. **Our clone implements all of it, ungated** — this table exists so we don't accidentally ship upsell copy or build an artificial limit.

| Feature | Free | Pro | Source |
|---|---|---|---|
| # of Lists | 1 | Unlimited | [D] A13/A14, [O] pro.html |
| # of Decks | 1 | Unlimited | [D] A14, [O] pro.html |
| Cards per List | 200 | 400 | [D] A13, [O] pro.html |
| Collection Filters & Sorting | ❌ | ✅ | [D] A7, A26 |
| Collection Trends | Full Market only | Full Market + Personalized (24h/7d/30d, % or $) | [O] pro.html |
| Total Collection History | 1 Year | 3 Years | [O] pro.html |
| Binder View | ❌ | ✅ | [D] A8, [O] pro.html |
| Pro Only List Types (Pokédex Binder) | ❌ | ✅ | [O] pro.html, profile-lists.html |
| Custom Profile Banner | ❌ | ✅ | [D] A32 |
| Showcase Cards | 4 | 8 | [D] A31 |
| Private Card Notes | ❌ | ✅ | [D] A29 |
| Graded Cards | ❌ | ✅ | [D] A28 |
| Stream Tools | ❌ | ✅ | [D] A36 |
| Collection Mode in search | ❌ | ✅ | [D] A6 |
| Filtering/sorting *others'* collections | ❌ | ✅ | [D] A39 |
| Pro badge + Discord role | ❌ | ✅ | [O] pro.html |
| Early Access features | ❌ | ✅ | [O] pro.html |

**Explicitly free [D]:** the entire Pokédex (A20), viewing your own whole collection and searching it by name (A26), viewing others' recent cards + search (A39).

**Pricing (context only) [O]** `dom/pro.html`: $5/mo, or $48/yr ($4/mo, "SAVE 20%").

---

# 15. What I could NOT determine

Ranked by how much it will hurt if we guess wrong.

| # | Unknown | Why it matters | What would settle it |
|---|---|---|---|
| 1 | **Exact `Dupes` tab predicate** under each goal, especially Complete Set with mixed variants | Directly changes displayed counts | Authenticated set page with a known collection; or a screenshot of the Dupes tab with counts |
| 2 | **Which variants count as "standard pack-pulled"** (the Master/Grandmaster boundary) | The whole three-goal model hinges on this tier flag | Authenticated Master-Set progress on a set with a known stamped variant; or a pkmn.gg reply |
| 3 | **PTCGL export grammar**, verbatim | Import/export round-trip correctness | Copy a deck out of PTCG Live and paste it; or an authenticated pkmn.gg `Export to PTCGLive` output |
| 4 | **Vintage variant names** (`1st Edition`, `Shadowless`, …) — do they exist and how spelled | Base/Jungle/Fossil progress is wrong without them | Fetch `/series/base/base/004` while authenticated (403 to WebFetch); or check TCGdex's variant vocabulary and reconcile |
| 5 | **Shiny unlock threshold** (how many unique cards of a Pokémon) | The headline gamification payoff | Authenticated Pokédex page showing a shiny + its counter |
| 6 | **Pokémon level band formula** — 5 bands? scaled how? | Pokédex level display | A20 says Charizard L2 needs "9 more" of 237 total; one more data point at a different pool size resolves it |
| 7 | **Set level band boundaries** — LVL 1 confirmed at 0.3%–20.8%, upper bound unknown | Set LVL chip | Two more (pct, LVL) observations spanning 25–75% |
| 8 | **Trainer Level: does "unique" mean unique cards or unique (card,variant) pairs?** | Level number | One authenticated account with a known collection composition |
| 9 | **Pokédex Binder list type** — what a slot is, how membership works | It's a whole third list type | `dom/list-public.html` for a Pokédex Binder list (only Dynamic captured); the two examples on `profile-lists.html` are linkable |
| 10 | **Binder pocket sizes: is 16 real?** | Minor | A8 says 4/9/12/16; pro.html says 4/9/12. An authenticated binder view settles it |
| 11 | **Test Hand mechanics** — mulligan rule, prizes, redraw, does it enforce a Basic | Feature completeness | Authenticated deck page, click Test Hand |
| 12 | **The "disable pricing" toggle's exact blast radius** — hide vs blur, do price sorts disappear | Global UI switch | Account Settings screenshot; only the home-page one-liner documents it at all |
| 13 | **Whether collection value is per-catalogue or global** | Headline number on the profile | A24 says "English and Japanese"; the UI has an `English TCG` selector next to the figure |
| 14 | **List/deck bulk operations** (multi-select, bulk add/remove) | Ergonomics | No source mentions any; may simply not exist |
| 15 | **The 11-number breakdown row on the profile** (`760 450 786 …`) | Profile chart | Labels are not in the DOM text; the PNG at `screenshots/profile-squalls--1440.png` would show them |
| 16 | **Insights profile tab** — entirely undocumented, no article, no capture | A whole profile tab | `/u/squalls?tab=insights` capture |
| 17 | **GLC ban list contents** | Format validation | gymleaderchallenge.com/banlist — fetch it at build time and store as data |
| 18 | **Standard rotation's current legal-set window** (which regulation marks) | Format validation | Pokemon.com rotation announcement; must be refreshed annually regardless |
| 19 | **Quantity entry: stepper only, or direct numeric input?** | Ergonomics on large quantities | Authenticated card detail modal |
| 20 | **FX rate source and refresh cadence** for currency conversion | Minor; we may just ship USD | Not documented anywhere |

**Note on #4, #9, #11, #16, #19:** all of these are solvable with a single authenticated browsing session. This spec was built without one (per the no-browser constraint, and live pkmn.gg returns 403 to WebFetch). If the user is willing to log in and capture five specific pages, roughly half the open questions close at once.

---

# 16. Divergences I recommend for our clone

Deliberate departures, each with a reason. None of these change the visual language.

1. **Put filter / sort / view / goal state in the URL.** pkmn.gg does not **[O]**. It makes state shareable, back-button-correct, and bookmarkable at zero cost.
2. **Drop the Friends system.** Single user. Repurpose the card-detail `Friends` tab as **"In your lists"** — which of your lists contain this card.
3. **Ungate everything.** No Pro tier, no 200-card list cap, no 1-list limit, no 4-showcase cap. Keep the *layouts*, drop the upsells (`Unlock Advanced Filters and Sorting with Pro`, `Log In to Go Pro`).
4. **No affiliate parameters** on outbound TCGplayer/eBay links. Construct clean product/search URLs.
5. **Keep the nightly reconciliation sweep** **[D]** C1 — but on a Pi, run it as a low-priority cron with a per-set cursor so it can't monopolise the box.
6. **Store price history ourselves from our own syncs** (per the brief §3b). pkmn.gg's per-card windows are 30d/3m/6m/1y and its collection windows are 24h/7d/30d; our history starts empty and grows, so render "insufficient history" states gracefully for the first month.
7. **Make the variant `tier` a data column, seeded from TCGdex + a curated override table**, not a hard-coded name match. The Master/Grandmaster distinction depends on it and the vocabulary grows.
8. **Implement `Complete / Master / Grandmaster` (C1), not the older `main / master` (A2).** The changelog is 15 months newer than the help-center article and describes the shipped behaviour.
