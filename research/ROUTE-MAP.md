# ROUTE-MAP.md — pkmn.gg URL / IA structure, and what DeckPal should mirror

**Companion to** `BEHAVIOR-SPEC.md`. Same evidence tags:

| Tag | Meaning |
|---|---|
| **[O]** | Observed — appears as a `url`/`route` field in `/home/cheyras/pokedex/research/pkmn-gg/styles/*.json`, or as an `href` inside `/home/cheyras/pokedex/research/pkmn-gg/dom/*.html`. |
| **[D]** | Documented in a pkmn.gg help-center article (URL in `BEHAVIOR-SPEC.md` §source table). |
| **[I]** | Inferred. Not confirmed to exist. |

The raw pkmn.gg captures behind **[O]** were deliberately not committed (they
lived at `~/pokedex/research/pkmn-gg/` on the capture machine), so **[O]** means
observed at capture time, not re-checkable from this repo.

**Method.** Every `url` field from the 24 style captures was extracted, plus every `href` attribute from the 24 DOM captures (≈600 distinct internal links after de-duplication). Query strings were extracted separately by scanning for `[?&]param=` across all captures — the **complete** set of param names found anywhere is: `tab`, `redirect`, `Printing`, `Condition`, `signature`, `_nkw`, `id`. Nothing else. That negative result drives several recommendations below.

---

## 1. Route table

### 1.1 Marketing / public

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/` | Home / landing | Hero + 5 feature sections (Collect·Track·Level Up, Deck Builder, Lists, Pokédex, Community, Price Tracking), each with 3 bullets + CTA. Title: *"The Best Pokémon Card Tracker and Deck Builder \| pkmn.gg"* **[O]** `styles/home.json` | none **[O]** | **Diverge** — single-user app has no marketing funnel. Make `/` the dashboard (Trainer Level, collection value, recent activity, set progress). |
| `/pro` | Pro Membership | Pricing cards ($5/mo, $48/yr), 17-benefit grid, Free-vs-Pro comparison table, FAQ accordion **[O]** `styles/pro.json` | none | **Drop** — no tiers. Retain as `research/` reference only; its comparison table is the definitive Pro-gating list. |
| `/trydeckbuilder` | Public deck-builder demo | Full deck builder, logged-out. Format tabs, Advanced Filters, deck rail **[O]** `styles/trydeckbuilder.json` | none | **Drop** — `/decks/new` covers it. |
| `/stream-tools` | Stream Tools config | 3 overlay configurators with `Open Overlay URL` **[O]** `styles/stream-tools.json` | none | **Mirror 1:1** if/when overlays ship (brief §2 "later phases"). |
| `/changelog` | Developer Changelog index | Post feed, newest first, author + date + excerpt **[O]** `styles/changelog.json` | none | **Diverge** — replace with `/about` or drop. Not a user-facing need on a personal instance. |
| `/changelog/{post-slug}` | Changelog post | Full post. Observed slugs: `collection-goals`, `layout-and-filter-fixes-across-the-site`, `search-decks-and-activity-fixes`, `faster-first-paint-steadier-sessions`, `pokedex-search-and-friends` **[O]** | none | **Drop.** |
| `/card-changelog` | Card Changelog | Paginated feed of catalogue edits: `{catalogue} · {series} · {set} · #{number} · {card name}`, the changed field (`Variants`, `Artist`, `Subtypes`, `TCGplayer Mass Entry`), `before → after`, editor note, relative timestamp, `Load more` **[O]** `styles/card-changelog.json` | none | **Mirror, repurposed** → `/sync-log`. Our equivalent is "what changed in the last TCGdex/TCGCSV sync". Genuinely useful for debugging a self-hosted catalogue. |
| `/privacy` | Privacy Policy | Legal **[O]** href in footer | none | **Drop.** |
| `/tos` | Terms of Service | Legal **[O]** href in footer | none | **Drop.** |
| `/primitives-showcase` | Design-system storybook | Live gallery of `Button`, `IconButton`, `Checkbox`, `TextInput`, `Select`, `CardSkeleton`, `EmptyStateMessage`, `ErrorBoundary`, `SvgIcon`, `Toast` **[O]** `styles/primitives-showcase.json` | none | **Mirror 1:1.** An unlinked internal route. Build the same page — it is the cheapest possible way to keep our design system honest against [UI Spec](https://github.com/cheyras/deckpal/wiki/UI-Spec). |

### 1.2 Auth

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/auth/signin` | Sign In | Google / Discord / Apple buttons, `or`, email field, `Send Magic Link` **[O]** `styles/auth-signin.json` | `redirect={path}` — observed `?redirect=/lists`, `?redirect=/pro` **[O]** | **Mirror the layout, diverge on mechanism.** Single local credential (or proxy-level auth). Keep `?redirect=`. |
| `/auth/register` | Sign Up | Same, heading `Sign Up Free!` **[O]** `styles/auth-register.json` | `redirect` **[I]** | **Drop** — single user, seeded at first run. |
| *(magic-link callback)* | — | — | — | **Not observed.** A43 documents the failure page but not its route. **[I]** likely `/auth/callback?token=…`. |
| *(onboarding)* | Card Preferences + questions | **[D]** A42: "asks a few questions to personalize your experience" | — | **Not observed.** **[I]** likely `/onboarding` or a post-register modal. Mirror as a **first-run wizard**: catalogue toggles (§5.6) + default completion goal (§2.1). |

### 1.3 Catalogue — English TCG (the primary hierarchy)

**Shape: `/series` → `/series/{series}` → `/series/{series}/{set}` → `/series/{series}/{set}/{number}`.** Four levels, no `/sets` or `/cards` segment. **[O]**

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/series` | All Series | Series cards with name + first-release date. 18 entries observed **[O]** `dom/series.html`: `mega-evolution, scarlet-violet, sword-shield, sun-moon, xy, black-white, heartgold-soulsilver, platinum, diamond-pearl, pop, np, ex, e-card, neo, gym, base, other`, plus a `Collections` pseudo-series | none **[O]** | **Mirror 1:1.** |
| `/series/{series-slug}` | Series → Sets | Set cards: logo, name, release date. Ordered newest-first **[O]** `dom/series-scarlet-violet.html` | none **[O]** | **Mirror 1:1.** Add `?goal=` per §3. |
| `/series/{series-slug}/{set-slug}` | Set page | Background, logo, `Shop`/`Purchase Set`, symbol, `{n}/{total} Collected`, `({q} Total Cards)`, `LVL n`, 2 progress bars, info bar (`Set Name / Series / Release Date / Cards {m} + {s} Secret / Most Expensive Card / Full Set Market Value`), sort strip `Number Name Rarity Price Artist`, view toggle `Grid Table Binder`, card grid. Auth adds `Show All / Have / Need / Dupes` + variant filter + `Purchase Missing Cards` **[O]** `styles/set-151.json`, **[D]** A2/A33/C1/C2 | none **[O]** | **Mirror path 1:1, diverge on state** — add `?goal=`, `?own=`, `?variant=`, `?sort=`, `?dir=`, `?view=`, `?q=`. See §3. |
| `/series/{series-slug}/{set-slug}/{number}` | Card detail page | Header `{name} #{number}/{setMainCount}`, tabs `Card \| Price \| TCG \| Private Notes \| Graded` (+ `Friends` **[D]** A38), variant table `Variant \| Market Price \| Quantity`, attacks, `Type / HP / Weaknesses / Retreat Cost / Evolves from / Evolves to / Illustrated By / National Pokédex # / Tags / Release Date / Rarity` **[O]** `styles/card-151-006.json` | none **[O]** | **Mirror 1:1**, minus `Friends`. Add `?tab=` — see §3. |
| `/collections` | Collections index | Special-set index: Prize Pack Series 1–8, Holiday Calendar 2022–2025, Trick or Trade BOOster Bundle 2022–2024. Each with name, date, blurb, `View` **[O]** `styles/collections.json` | none | **Mirror 1:1.** It is reachable both directly and as the last card on `/series`. Whether its children live at `/collections/{slug}` or `/series/other/{slug}` is **not observed** — no child href was captured. **[I]** likely `/series/other/{slug}`, since `/series/other/...` cards exist (e.g. `/series/other/legendary-collection/003`, `/series/other/mcdonalds-collection-2025/001`, `/series/other/pokemon-tcg-classic-charizard/003`). |

**Slug conventions [O]:**
- Series slugs are kebab-case English names: `scarlet-violet`, `black-white`, `heartgold-soulsilver`, `e-card`, `diamond-pearl`, `mega-evolution`.
- Set slugs likewise: `151`, `prismatic-evolutions`, `scarlet-violet-black-star-promos`, `scarlet-violet-energy-2023` (for the display name *"Scarlet & Violet: Energy (2023)"*), `wizards-black-star-promos`, `me-black-star-promos`.
- **The `{number}` segment is the raw collector number, not normalised.** All of these are real, from the same site: `006`, `13`, `004`, `DP045`, `SM109`, `SM158`, `SWSH133`, `SWSH262`, `TG003`, `XY017`, `RC005`, `SV049`, `#SV107`. Zero-padding is inconsistent (`/151/006` vs `/pitch-black/13`). **[O]**
- ⚠️ **Do not build a route that assumes 3-digit zero-padded numeric.** Store the collector number as an opaque string and slugify it once (uppercase, strip `/`, strip `#`).

### 1.4 Catalogue — Japanese TCG

| Path pattern | Page name | Query params | Mirror? |
|---|---|---|---|
| `/jp/series` | All JP series | none | **[I]** — not directly observed, inferred from the child routes below and the `Japanese TCG` nav item. |
| `/jp/series/{series}` | JP series → sets | none | **[I]** |
| `/jp/series/{series}/{set}` | JP set page | none | **[I]** |
| `/jp/series/{series}/{set}/{number}` | JP card detail | none | **[O]** — ~90 distinct hrefs captured, e.g. `/jp/series/scarlet-violet/pokemon-card-151/006`, `/jp/series/original/expansion-pack/021`, `/jp/series/gym/challenge-from-the-darkness/032`, `/jp/series/e-card/base-expansion-pack/071`, `/jp/series/web/pokemon-web/042`, `/jp/series/vs/pokemon-vs/097`, `/jp/series/pcg/miracle-crystal/032`, `/jp/series/adv/adv-promos/054` |

**JP-only series slugs observed [O]:** `original`, `web`, `vs`, `adv`, `pcg`, `mega-evolution`, plus JP variants of the shared eras. JP set slugs are romanised English translations: `pokemon-card-151`, `ruler-of-the-black-flame`, `shiny-treasure-ex`, `to-have-seen-the-battle-rainbow`, `intense-fight-in-the-destroyed-sky`, `garchomp-vs-charizard-sp-deck-kit-charizard`.

**Mirror? — Defer.** The brief scopes us to "Base Set → current Scarlet & Violet era". Reserve the `/jp/` prefix in the router now so adding it later is not a breaking IA change, but do not sync the JP catalogue in phase 1 (it roughly doubles the image cache, and we have no SSD — see Part B constraint #1).

### 1.5 Catalogue — Pokémon TCG Pocket

| Path pattern | Page name | Query params | Mirror? |
|---|---|---|---|
| `/tcg-pocket-en/series/{series}/{set}/{number}` | Pocket card detail | none | **[O]** — e.g. `/tcg-pocket-en/series/series-a/genetic-apex/035`, `/tcg-pocket-en/series/series-b/mega-shine/111`, `/tcg-pocket-en/series/series-a/deluxe-pack-ex/361` |
| `/tcg-pocket-en/series[/{series}[/{set}]]` | Pocket index / series / set | none | **[I]** |
| `/tcg-pocket-jp/...` | Japanese Pocket | — | **[I]** — the `-en` suffix strongly implies a `-jp` sibling. Never observed. |

**Mirror? — Drop.** TCG Pocket is a separate digital game, out of scope for a physical-collection tracker, and TCGdex's Pocket coverage/pricing is not part of the brief's data plan. Note the three-catalogue partition (`English TCG / Japanese TCG / TCG Pocket`) is a **first-class nav concept** **[O]** — every capture's sidebar lists all three — so build the catalogue dimension into the schema even if only one is populated.

### 1.6 Pokédex

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/pokedex` | Pokédex | Gen tab strip `Gen I…Gen IX`, `Animations` toggle, species grid `{name} #{nnn}`. **Content-identical to `/pokedex/generation/1`** — a byte diff yields one incidental attribute difference **[O]** — so Gen I is the default view | none | **Mirror 1:1.** |
| `/pokedex/generation/{1-9}` | Pokédex by generation | Same shell, that generation's species **[O]** `styles/pokedex-generation-1.json` | none | **Mirror 1:1.** |
| `/pokedex/{pokemon-slug}` | Pokémon page | `#{0006}`, `Total Cards`, `Types` (+ type icons), `Height` (imperial / metric), `Total Market Value`, sort strip `Number Rarity Price Artist Released`, view toggle `Grid Table Binder`, search `Search Pokémon…`, every card featuring that species **[O]** `styles/pokedex-charizard.json` | none | **Mirror 1:1**, add state params (§3). |

**Slug convention [O]:** lowercase, punctuation stripped, gendered forms suffixed — `charizard`, `mr-mime`, `farfetchd` (apostrophe dropped), `nidoran-f`, `nidoran-m`. 151 Gen-I slugs captured; the pattern generalises.

**Card→species is many-to-many [O]** — `dom/pokedex-charizard.html` lists `Reshiram & Charizard-GX` and `Charizard & Braixen-GX`, so those cards appear on two species pages. See `BEHAVIOR-SPEC.md` §4.3.

### 1.7 Lists

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/lists` | My Lists | Owner's list grid, favourites pinned, then last-edited desc. Logged out: empty state **No Lists Yet** **[O]** `styles/lists.json`, **[D]** A11 | none | **Mirror 1:1.** |
| `/lists/{uuid}` | List detail | Back link `My Lists`, title, info bar `Created By / Created On / # of Cards / Full List Market Value`, description, sort strip `Custom Number Name Rarity Price Artist Released`, view toggle `Grid Table Binder`, rows `qty · name · price · #number · variant` **[O]** `styles/list-public.json` (`a4b83244-bdb5-4222-877e-1d8a31f8af93`) | none | **Mirror path 1:1**, add state params. |
| `/lists/new` | Create list | Type picker (Dynamic / Static / Pokédex Binder) + name + description + visibility | — | **[I]** — not observed; the create flow is a modal **[D]** C3 describes a modal "Create Deck window", so lists likely match. Our clone: modal, no route. |

**Identifier: opaque UUIDv4, not a slug.** **[O]** Consequence: list titles are free-text (`!My Wishlist 2026 - July` starts with `!` to sort first **[O]** `dom/profile-lists.html`) and need no uniqueness or slugification. **Mirror this** — it is the right call.

### 1.8 Decks

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/decks` | My Decks | Deck grid, favourites pinned, last-edited desc **[O]** (back-link target from the deck page), **[D]** A19 | none | **Mirror 1:1.** |
| `/decks/{uuid}` | Deck detail | Back `My Decks`, title, info bar `Created By / Format / Created / Updated / Deck Price`, actions `Test Hand · Export to PTCGLive · Purchase Deck · Image`, sections `Pokémon (n) / Trainer (n) / Energy (n)` **[O]** `styles/deck-public.json` (`1aaff8f6-1bbc-45fe-802e-a0b708e1019d`) | none | **Mirror 1:1.** |
| `/decks/{uuid}/edit` | Deck builder (editing) | Search + Advanced Filters + results, deck rail with `Format`, `Legal Status`, `n/60 Cards`, `Deck Price`, `Name \| Qty`, `Test Hand` | — | **[I]** — an editing mode exists **[D]** A18 ("enter Deck Editing mode"), but its URL is not observed. It may be in-place state on `/decks/{uuid}`. **Diverge: use `/decks/{uuid}/edit`** so edit state is linkable and the back button works. |

Same UUID convention as lists. **[O]**

### 1.9 Profile

| Path pattern | Page name | Renders | Query params | Mirror? |
|---|---|---|---|---|
| `/u/{username}` | Profile (default tab) | Banner, avatar, username, `Joined`, `Friends {n}`, level badge, tab strip, bio, `Total Estimated Collection Value` + `Value History`, catalogue selector, `Total Cards` / `Unique Cards`, breakdown figures, showcase cards, per-set progress cards **[O]** `styles/profile-squalls.json` | `tab` | **Mirror the page. Diverge on the path** → `/profile`. Single user; `/u/{username}` is a multi-tenant artefact. |
| `/u/{username}?tab=collection` | Collection tab | `Recent` sorter + Pro-gated `Best Match / Number / Name / Rarity / Price / Artist / Released`, rows `qty · name · price · #number · variant`, `Load More`, Pro upsell banner **[O]** `styles/profile-collection.json` | `tab=collection` | **Mirror as `/collection`** — promote to a top-level route; it is the app's most-used screen, not a profile sub-tab. |
| `/u/{username}?tab=lists` | Lists tab | List cards showing `{title}` / `{Type} - {Visibility}` / `{description}` / `View`. Types seen: `Dynamic List - Public`, `Static List - Public`, `Pokédex Binder - Public` **[O]** `styles/profile-lists.json` | `tab=lists` | **Mirror**, but `/lists` already covers it. |
| `/u/{username}?tab=insights` | Insights tab | **Unknown — never captured, no article.** | `tab=insights` | **[I]** — tab exists in the strip **[O]**. Likely portfolio analytics (top movers, rarity/type breakdown, duplicates), matching pokecollector's feature set. Build it, design it ourselves. |
| `/u/{username}?tab=activity` | Activity tab | Feed: card name, variant, set, quantity change, timestamp; yellow `NEW` tag **[D]** A27 | `tab=activity` | **Mirror as `/activity`.** |
| `/u/{username}?tab=decks` | Decks tab | Deck cards, favourites first **[D]** A19, A41 | `tab=decks` **[I]** | Covered by `/decks`. |
| `/u/{username}?tab=friends` | Friends tab | Friends list + `Find a Friend` **[D]** A37 | `tab=friends` **[I]** | **Drop.** Single user. |

**[O]** `?tab=collection` and `?tab=lists` are directly confirmed by the capture URLs; `insights`, `activity`, `decks`, `friends` are **[I]** from the tab labels rendered in `dom/profile-squalls.html`.

**[O]** Note the tabs are **client-side buttons, not anchors** — no `?tab=` href appears anywhere in the DOM. They push the query param via the router. Our clone should render real `<a href>` so middle-click and copy-link work.

### 1.10 Not-observed routes that must exist

| Path | Why we know it exists | Tag |
|---|---|---|
| Account Settings | Referenced by **8 articles**: default completion goal (C1), card preferences (A4), currency display (A25), profile privacy (A37), collection-value privacy (A24), custom banner (A32), reset collection (A30), disable pricing (home page), `Manage Plan` (pro FAQ). Never captured. **[I]** `/settings` or `/account`. | [D] existence, [I] path |
| Advanced Search results | **[D]** A6 documents a site-wide advanced search distinct from the deck-builder one. **[I]** `/search?q=…` — the global search box has id `paging-global` and an `advanced search` affordance **[O]**, but no results route was captured. | [D]/[I] |
| Stream overlay endpoints | **[O]** `Open Overlay URL` buttons exist on `/stream-tools`; the generated URLs are per-user and signed and were not in the DOM. **[I]** something like `overlay.pkmn.gg/{type}/{token}`. | [I] |
| Set-level "collection view of another user" | **[D]** A39: "you can see their set progress and click into a set to see the cards they have, need, dupes". **[I]** either `/series/.../{set}?user={username}` or the set page reads a profile context. | [I] |

### 1.11 External hosts (for the asset pipeline)

| Host / pattern | Purpose | Tag |
|---|---|---|
| `site.pkmn.gg/images/sets/logos/{setcode}.webp` | Set logo | [O] `dom/set-151.html` → `sv3pt5.webp` |
| `site.pkmn.gg/images/sets/symbols/{setcode}.webp` | Set symbol | [O] |
| `site.pkmn.gg/images/sets/backgrounds/{setcode}.webp` | Set page hero background | [O] |
| `users.pkmn.gg/avatars/{hash}/{ts}-{rand}.png` | User avatars | [O] `dom/deck-public.html` |
| `articles.pkmn.gg/help-center` · `/help-center-category/{slug}` · `/help-topic/{slug}` | Help centre (Webflow) | [O]/[D] |
| `merch.pkmn.gg` | Merch store | [O] nav |
| `tcgplayer.pxf.io/c/{aff}/{x}/{y}?u={encoded tcgplayer url}` | Affiliate-wrapped buy link | [O] `dom/card-151-006.html` |
| `tcgplayer.com/product/{productId}?Printing={variant}&Condition=Near+Mint` | Underlying product URL | [O] |
| `ebay.com/sch/i.html?_nkw="{name}"+"{set}"+"{number}"&campid=…` | eBay **search** (not product) | [O] |
| `discord.gg/ZFvfVjdvBz`, `twitch.tv/pkmndotgg`, `x.com/pkmndotgg`, `youtube.com/@pkmndotgg`, `instagram.com/pkmndotgg`, `tiktok.com/@pkmndotgg`, `facebook.com/pkmndotgg`, `play.google.com/store/apps/details?id=gg.pkmn.app`, `mailto:hello@pkmn.gg` | Social / app / contact | [O] footer + nav |

**Our clone:** set logos/symbols/backgrounds come from TCGdex; card art from TCGdex; both proxied through a local size-capped cache (brief §3a). Serve them from a single local route — **[I]** proposed `/img/{kind}/{id}` — so the cache is one code path. Note pkmn.gg uses **`.webp` for set chrome**; do the same, it matters on a microSD budget.

---

## 2. IA hierarchy at a glance

```
/                              dashboard (we diverge from marketing)
├─ /series                     English TCG catalogue root
│  └─ /{series}                e.g. scarlet-violet
│     └─ /{set}                e.g. 151          ← progress, goals, Have/Need/Dupes
│        └─ /{number}          e.g. 006          ← card detail, variants, price, notes, graded
├─ /collections                special-set index (Prize Packs, Holiday Calendars, Trick or Trade)
├─ /jp/series/...              Japanese catalogue     [reserve, don't build yet]
├─ /tcg-pocket-en/series/...   TCG Pocket catalogue   [out of scope]
├─ /pokedex                    == /pokedex/generation/1
│  ├─ /generation/{1..9}
│  └─ /{pokemon}               species page
├─ /lists ─ /{uuid}
├─ /decks ─ /{uuid} [─ /edit]
├─ /collection                 (we promote from /u/{name}?tab=collection)
├─ /activity                   (we promote from ?tab=activity)
├─ /insights                   (we promote from ?tab=insights)
├─ /profile                    (we collapse /u/{username})
├─ /settings                   account settings          [inferred on pkmn.gg]
├─ /search                     advanced search results   [inferred on pkmn.gg]
├─ /sync-log                   (our /card-changelog equivalent)
├─ /primitives-showcase        design-system storybook
└─ /auth/signin [?redirect=]
```

Depth is capped at 4 segments and every level is a real, linkable page. **Mirror this shape exactly** — it is well-designed, it maps cleanly onto TCGdex's `series → set → card` model, and it keeps card URLs human-readable and guessable.

---

## 3. The one significant IA divergence: put view state in the URL

**Finding [O]:** across all 24 captures, no filter, sort, view-mode, ownership-tab, variant-filter, completion-goal, or card-detail-tab value appears in any URL. The only app-level param in the entire site is `?tab=` on the profile.

**Consequence on pkmn.gg:** you cannot link someone to "151, Master Set goal, Need tab, Holofoil only, sorted by price". Reloading loses your position. The back button doesn't undo a filter.

**Recommendation:** mirror every *path* 1:1, and add a small, stable query vocabulary. Zero cost, strictly better, and invisible to the visual design.

| Param | Applies to | Values | Default |
|---|---|---|---|
| `goal` | set, list | `complete` \| `master` \| `grandmaster` | user's saved default **[D]** C1 |
| `own` | set, list, pokédex, pokémon | `all` \| `have` \| `need` \| `dupes` | `all` |
| `variant` | set, list, pokédex, pokémon | repeatable slug, e.g. `?variant=holofoil&variant=reverse-holofoil` | none (= all) |
| `sort` | set, list, pokémon, collection, deck search | `number` \| `name` \| `rarity` \| `price` \| `artist` \| `released` \| `recent` \| `custom` \| `best-match` | context default (§5.3 of BEHAVIOR-SPEC) |
| `dir` | same | `asc` \| `desc` | context default |
| `view` | set, list, pokémon | `grid` \| `table` \| `binder` | `grid` |
| `pocket` | when `view=binder` | `4` \| `9` \| `12` | `9` |
| `stack` | when `view=binder` | `1` \| `0` (stack variants behind the base slot) **[D]** A8 | `1` |
| `page` | when `view=binder` | integer ≥ 1 | `1` |
| `q` | any page with a search box | free text | empty |
| `tab` | card detail | `card` \| `price` \| `tcg` \| `notes` \| `graded` | `card` |
| `tab` | profile | `collection` \| `insights` \| `activity` \| `lists` \| `decks` | (mirrors pkmn.gg **[O]**) |

**Rule:** omit a param when it equals the default, so clean URLs stay clean. **Rule:** the in-place `goal` switch writes `?goal=` and **must not** write the saved default — that is explicit pkmn.gg behaviour **[D]** C1 and the correct semantics.

---

## 4. Mirror / diverge summary

**Mirror 1:1 (12 route families):**
`/series`, `/series/{series}`, `/series/{series}/{set}`, `/series/{series}/{set}/{number}`, `/collections`, `/pokedex`, `/pokedex/generation/{n}`, `/pokedex/{pokemon}`, `/lists`, `/lists/{uuid}`, `/decks`, `/decks/{uuid}`, `/primitives-showcase`.

**Mirror the page, change the path (5):**
`/u/{username}` → `/profile` · `?tab=collection` → `/collection` · `?tab=activity` → `/activity` · `?tab=insights` → `/insights` · `/card-changelog` → `/sync-log`.

**Diverge (3):**
`/` marketing → dashboard · deck edit as an explicit `/decks/{uuid}/edit` · view state in the URL (§3).

**Drop (9):**
`/pro`, `/trydeckbuilder`, `/auth/register`, `/changelog`, `/changelog/{slug}`, `/privacy`, `/tos`, `?tab=friends`, the whole `/tcg-pocket-en/` tree.

**Reserve, build later (2):**
`/jp/series/...` (image-cache budget: no SSD) · `/stream-tools` + overlay endpoints (brief marks low priority).

**Must design ourselves — no pkmn.gg reference exists (4):**
`/settings`, `/search`, `/insights`, the first-run onboarding wizard.

---

## 5. Route-map gaps

| Gap | Impact | How to close |
|---|---|---|
| Account Settings route + full field list | 8 documented features live there; we're designing it blind | One authenticated screenshot of `/settings` |
| Advanced Search results route + result-page layout | The site's most-used search surface is entirely unobserved | Authenticated `/search?q=charizard` capture, or a logged-out attempt at the same |
| `?tab=insights` content | A whole profile tab | Authenticated `/u/squalls?tab=insights` capture |
| `/collections/{slug}` vs `/series/other/{slug}` for special sets | Affects the catalogue import's set→series assignment | Click any `View` button on `/collections` and record the resulting URL |
| Whether `/jp/series` and `/tcg-pocket-en/series` index pages exist at those exact paths | Only leaf card URLs were captured | Two HEAD requests |
| Binder-view URL/pagination — does the binder page number appear anywhere | Deep-linking to a binder page | Authenticated binder view; A8's "bring you to the right page" implies page identity exists |
| Stream overlay URL shape | Needed only if we build overlays | Authenticated `/stream-tools` → `Open Overlay URL` |
| Magic-link callback route | Not needed for our clone (single local auth) | — |

**Note:** live pkmn.gg returns **HTTP 403 to WebFetch** for app routes (verified against `/series/base/base/004` and `/changelog/collection-goals`), and this task was run under a no-browser constraint. Every gap above is closable in one short authenticated browsing session by the agent that owns browser work.
