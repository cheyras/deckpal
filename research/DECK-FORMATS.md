# DECK-FORMATS.md — deck legality and deck-list interchange, implementable spec

**Written:** 2026-07-24. **All lists and windows in this document are stated "as of" that date.**
**Scope:** everything the deck builder needs that is *not* pkmn.gg behaviour. For pkmn.gg's UI
behaviour see `research/BEHAVIOR-SPEC.md` §8; this document extends it and, where evidence
contradicts it, says so explicitly (see §0.3).

---

## 0. How to read this

### 0.1 Evidence tags

Same convention as `BEHAVIOR-SPEC.md`.

| Tag | Meaning |
|---|---|
| **[D]** documented | Stated by a primary source. URL given inline. Verbatim quotes in `"…"`. |
| **[O]** observed | Measured by me from real data (deck-list corpora, live API responses, site JS). The measurement and its sample size are given so you can re-run it. |
| **[I]** inferred | My reasoning from D/O. Not authoritative. |

A wrong **[D]** is worse than an honest **[I]**. Where I could not verify, §7 says so loudly.

### 0.2 Primary sources used

| # | Source | URL | Fetched |
|---|---|---|---|
| S1 | Play! Pokémon **TCG Tournament Handbook**, English, last revision **May 21, 2026** | https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-tcg-tournament-handbook-en.pdf | 2026-07-24 |
| S2 | **Pokémon TCG Banned Card List** (official) | https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list | 2026-07-24 |
| S3 | **2026 Standard Format Rotation Announcement**, published 2026-01-09 | https://www.pokemon.com/us/pokemon-news/2026-pokemon-tcg-standard-format-rotation-announcement | 2026-07-24 |
| S4 | **Mega Evolution—Perfect Order Banned List and Rule Changes Announcement**, 2026-03-12 | https://www.pokemon.com/us/play-pokemon/about/mega-evolution/mega-evolution-perfect-order-banned-list-and-rule-changes-announcement | 2026-07-24 |
| S5 | **Pokémon TCG Rulebook**, "LAST UPDATED: MARCH 2025" (Journey Together printing) | https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/rulebook/jtg_rulebook_en.pdf | 2026-07-24 |
| S6 | **Gym Leader Challenge — The Rules** | https://gymleaderchallenge.com/rules | 2026-07-24 |
| S7 | **Gym Leader Challenge — Ban List** | https://gymleaderchallenge.com/ban-list | 2026-07-24 |
| S8 | **Gym Leader Challenge — FAQ and Rulings** | https://gymleaderchallenge.com/faq | 2026-07-24 |
| S9 | **Gym Leader Challenge — Guide Overview** | https://gymleaderchallenge.com/overview | 2026-07-24 |
| S10 | **Limitless Docs — Decklist Submission** | https://docs.limitlesstcg.com/player/decklists | 2026-07-24 |
| S11 | **TCGplayer — Getting Started With Mass Entry** | https://help.tcgplayer.com/hc/en-us/articles/360055768913-Getting-Started-With-Mass-Entry | 2026-07-24 |
| S12 | Bulbapedia — Standard format (TCG) *(secondary, used only for pre-2026 rotation history)* | https://bulbapedia.bulbagarden.net/wiki/Standard_format_(TCG) | 2026-07-24 |

**Corpora and code read (evidence for [O] claims):**

| # | Artifact | Licence | What I did |
|---|---|---|---|
| C1 | `geekazoid-at/codes4tcg-decks` — **4,840** `deck.txt` files, PTCGL deck lists harvested from YouTube deck codes, 2022-06 → 2026-07 | **NONE** (all rights reserved) — read for measurement only, nothing vendored | Parsed all 4,840; statistics below |
| C2 | `JoseRivas1998/pokemon-decklists` — README states verbatim: *"They are in the `Export Deck` format in Pokemon TCG Live."* | **NONE** — quoted as provenance evidence only | Read 2 files verbatim |
| C3 | `IceMaD/ptcgl-decklist-parser` (PHP) — the only MIT-licensed PTCGL parser found | **MIT** | Read `src/`, `tests/data/decklist.fr.txt` |
| C4 | `limitlesstcg.com/build/assets/decklist-11f9e903.js` — Limitless's client-side "Copy to Clipboard" exporter | site asset, read only | Deobfuscated its set-code translation function |
| C5 | `api.tcgdex.net/v2/graphql` | data MIT | **7 requests total** (introspection ×1, sets ×1, cards ×5) |

> **Note on C1/C2 licensing.** Neither repo carries a licence, so we vendor nothing from them. The
> deck-list text they contain is a functional data format, not their creative work, and I quote a
> handful of lines as evidence of that format — the same posture [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) takes toward
> `Trust1509/pokecollect`. **Do not ship any file from these repos.**

### 0.3 Corrections to `BEHAVIOR-SPEC.md` §8

`BEHAVIOR-SPEC.md` flagged its PTCGL grammar as "the weakest-evidenced part of this spec." It was
right to. Corrections, all now evidence-backed:

| BEHAVIOR-SPEC §8.8 said | Actually |
|---|---|
| `Pokémon: 4` where 4 = total cards in the section | **The header count is the number of *distinct entries* (lines), not the sum of copies.** [O] §1.3 |
| `number := [0-9]+ \| [A-Z]+[0-9]+` (e.g. `SWSH133`, `TG03`) | Numbers are **always plain digits**. Sub-sets are encoded in the *set code* instead (`CRZ-GG 25`, `LOR-TG 12`). 0 non-numeric numbers in 127,545 card lines. [O] |
| `setcode := [A-Z0-9]{2,8}` | Hyphens occur and are load-bearing: `PR-SV`, `PR-SW`, `CRZ-GG`, `LOR-TG`. Also the literal word `Energy`. [O] |
| parser must tolerate a `* ` line prefix (PTCGO legacy) | 0 occurrences in 4,840 files. Harmless to tolerate; do not design for it. [O] |
| `Basic {R} Energy` brace notation — "tolerate" | It is the **normal, required** spelling for basic Energy. Not an edge case. [O] |
| ACE SPEC limit "changed over time" (task brief) | **No change found.** 1 per deck since Black & White. S5 Appendix 2 frames it as continuous. §3.5 |
| pkmn.gg's `Not Legal` predicate | unchanged — but see §5.5 for the validation-result shape that can render it |
| `Legal Status` at 0/60 is `Not Legal` | consistent with §3.1: deck size is part of the predicate |

`BEHAVIOR-SPEC.md` §8.3's *policy* conclusions (legality is per-set/per-card data with an effective
date window; do not hard-code a mark letter in the UI layer; highlight rather than delete rotated
cards) are all correct and are carried forward here.

---

# 1. The PTCG Live decklist grammar

## 1.1 Where it comes from, and the two producers

PTCG Live has an **Export** button in the deck manager that copies the list to the clipboard:

> **[D]** S10: *"You can export your decklist directly from PTCGL. Simply click the **Export** button
> in the deck manager and the list will be automatically copied to your clipboard."*

There is a **second, near-identical** producer in wide circulation — the Limitless deck builder /
decklist pages (S10: *"create your deck in the Limitless Deck Builder and export it with
Share > Copy as Text"*). The two differ in exactly one respect (the section-header count, §1.3),
which is why the format looks inconsistent when you sample it naively. **Our importer must accept
both; our exporter should emit the PTCGL shape.**

## 1.2 Formal grammar

Line-oriented, UTF-8, three sections in fixed order, one blank line between sections, one trailer.

```ebnf
decklist    = [ BOM ] , section , { blank , section } , [ blank , trailer ] , [ NL ] ;
section     = header , NL , cardline , { NL , cardline } ;
header      = label , [ SP ] , ":" , SP , count ;          (* count is ADVISORY - see 1.3 *)
label       = "Pokémon" | "Trainer" | "Energy" ;           (* localised; table in 1.6 *)
trailer     = "Total Cards" , [ SP ] , ":" , SP , count ;  (* = sum of all copies *)

cardline    = count , SP , name , SP , setcode , SP , number , [ SP , print ]   (* canonical *)
            | count , SP , name ;                          (* bare - Trainer/Energy only *)

count       = DIGIT , { DIGIT } ;
name        = ? any run of characters; may contain SP, ":", "'", "-", ".", "{", "}", digits ? ;
setcode     = UPPER , { UPPER | DIGIT } , [ "-" , UPPER , UPPER , [ UPPER ] ]
            | "Energy" ;                                   (* literal, for basic Energy *)
number      = DIGIT , { DIGIT } ;                          (* always plain digits *)
print       = "PH" ;                                       (* foil-treatment marker *)
blank       = NL , { SP } , NL ;
NL          = "\n" | "\r\n" ;
SP          = " " ;
```

**The name field is not left-parseable.** Names contain spaces, digits, colons
(`Technical Machine: Devolution`), apostrophes (`Boss's Orders`, `Lt. Surge's Strategy`), braces
(`Basic {R} Energy`), hyphens (`Porygon-Z`) and version numbers (`Pokégear 3.0`). **Parse each card
line right-to-left:**

```python
SETCODE = re.compile(r'^([A-Z][A-Z0-9]{0,7}(-[A-Z]{2,3})?|Energy)$')

def parse_card_line(line):
    t = line.strip().split(' ')
    qty  = int(t[0]); rest = t[1:]
    print_ = rest.pop() if rest and rest[-1] == 'PH' else None
    setcode = number = None
    if len(rest) >= 3 and rest[-1].isdigit() and SETCODE.match(rest[-2]):
        number  = rest.pop()
        setcode = rest.pop()
    return qty, ' '.join(rest), setcode, number, print_
```

Guard rails for that heuristic:
- Requiring `len(rest) >= 3` is what stops `2 Air Balloon` (a bare Trainer line) being mis-split.
  It also mis-handles the rare 2-token malformed shape `2 Bisharp ASC` (§1.5, case 9); resolve that
  one by looking the trailing token up in the set-alias table and only splitting if the remainder
  is a known card name.
- `.isdigit()` on the last token is safe because no name in the corpus ends with a bare integer
  token (`Pokégear 3.0` ends with `3.0`, which is not `isdigit()`).
- **Section headers must be tried before card lines**, but the two are unambiguous anyway: a header
  ends with `": " digits` and a card line never does (its trailing token is a number preceded by a
  set code, or `PH`, or a name word). `1 Technical Machine: Devolution PAR 177` does not match the
  header regex `^(.+):\s*(\d+)$` because nothing after the colon is `": " digits` at end-of-line.

## 1.3 The section-header count: distinct entries, not copies — resolved

`BEHAVIOR-SPEC.md` guessed "total cards in section." That is wrong for PTCGL.

**[O]** Over all **4,837** parseable files in C1:

| Header semantics | Files | Share |
|---|---|---|
| `header == number of lines in the section` | 3,688 | 76% |
| `header == sum of copies in the section` | 1,048 | 22% |
| neither (hand-edited lists) | 100 | 2% |
| both (degenerate: 1 copy each) | 1 | 0% |

To attribute the two shapes I used a **producer fingerprint**: the ` PH` suffix and the
`SWSHALT`/`SVALT`/`SMALT` pseudo-set codes are emitted *only* by PTCG Live — Limitless's exporter
(C4) has no foil data and S10 states Limitless cannot even resolve ALT codes.

| Sub-population | n | `lines` | `sum` |
|---|---|---|---|
| files containing a ` PH` line | 1,033 | **985 (95%)** | **0 (0%)** |
| files containing an ALT set code | 147 | **139 (95%)** | **0 (0%)** |
| files containing neither | 3,804 | 2,703 (71%) | 1,048 (28%) |

Zero PTCGL-fingerprinted files use sum-of-copies. Corroborated independently by C2, whose README
states its files are PTCG Live `Export Deck` output — and they use line counts.

I also verified the counterpart directly: Limitless's `decklist-11f9e903.js` builds its export from
the page's column heading, and the page renders `Pokémon (22) / Trainer (28) / Energy (10)` = 60,
i.e. **sum of copies** [O] C4 + `limitlesstcg.com/decks/list/28249`.

⇒ **Rules for us:**
1. **Importer: ignore all header counts.** They disagree between producers and are wrong in 2% of
   real files. Trust only the card lines. Use the trailer (present in 4,815/4,840 = 99.5% [O] —
   4,805 English `Total Cards:` plus 10 localised) as a *checksum* to warn on, never to reject.
2. **Exporter: emit the number of distinct entries**, to be byte-compatible with PTCG Live.
   Both PTCGL and Limitless ignore the value on import, so this is cosmetic — but it makes a
   round-trip diff clean.

## 1.4 Three real, verbatim exports

### Example A — modern Standard, from a repo that states it is PTCGL `Export Deck` output

Source: https://github.com/JoseRivas1998/pokemon-decklists/blob/main/charizard-ex.txt (C2)

```
Pokémon: 14
2 Pidgey MEW 16
1 Mimikyu PAL 97 PH
3 Charmander PAF 7
1 Rotom V LOR 58
2 Charmeleon PAF 8
2 Duskull SFA 18
1 Fezandipiti ex SFA 38
1 Budew PRE 4 PH
2 Pidgeotto MEW 17
1 Cleffa OBF 80
2 Pidgeot ex OBF 164
2 Dusclops SFA 19
3 Charizard ex OBF 125
2 Dusknoir SFA 20

Trainer: 12
1 Forest Seal Stone SIT 156
3 Nest Ball SVI 181
3 Boss's Orders PAL 172
1 Night Stretcher SSP 251
3 Iono PAL 185
3 Arven SVI 166
2 Super Rod PAL 188
1 Grand Tree SCR 136
2 Buddy-Buddy Poffin TEF 144
2 Ultra Ball SVI 196
2 Switch SVI 194
4 Rare Candy SVI 191

Energy: 3
4 Basic {R} Energy SVE 10
1 Basic {R} Energy SVALT 132
3 Basic {R} Energy SVE 10 PH

Total Cards: 60
```

Why this one: `PH` markers; `SVALT` (a PTCGL-only pseudo-set); the *same* card (`Basic {R} Energy
SVE 10`) on two lines differing only by `PH`; 14 Pokémon lines under a `Pokémon: 14` header whose
copies sum to 25.

### Example B — a deck-code redemption with an ALT code and a sub-set code

Source: https://github.com/geekazoid-at/codes4tcg-decks/blob/master/decks/tablemon/yt-2023-06-08-tablemon-JUyOQ8TWRo8/1/deck.txt (C1)

```
Pokémon: 10
1 Lumineon V BRS 40
2 Baxcalibur PAL 60
1 Articuno SIT 36
2 Bibarel CRZ-GG 25
3 Chien-Pao ex PAL 61
2 Origin Forme Palkia V ASR 39
2 Origin Forme Palkia VSTAR ASR 40
1 Radiant Greninja ASR 46
3 Frigibax PAL 57
2 Bidoof CRZ-GG 29

Trainer: 12
3 Ultra Ball SVI 196
4 Irida ASR 147
2 Escape Rope BST 125
2 Rare Candy SVI 191
1 Skaters' Park FST 242
2 Lost City LOR 161
1 Lost Vacuum CRZ 135
4 Battle VIP Pass FST 225
3 Iono PAL 185
4 Superior Energy Retrieval PAL 189
2 Nest Ball SVI 181
3 Boss's Orders SWSHALT 32

Energy: 1
10 Basic {W} Energy SVE 3

Total Cards: 60
```

Why this one: `CRZ-GG` (Crown Zenith Galarian Gallery sub-set) and `SWSHALT 32` — the exact ALT case
S10 warns about. Also `Radiant Greninja` and a name with an apostrophe (`Skaters' Park`).

### Example C — Expanded-legal list with three promo prefixes

Source: https://github.com/geekazoid-at/codes4tcg-decks/blob/master/decks/Strategic%20TCG/yt-2026-05-07-Strategic%20TCG-ax58T2gLahU/1/deck.txt (C1)

```
Pokémon: 6
4 Mimikyu CEC 245
1 Xurkitree-GX PR-SM 68
1 Girafarig LOT 94
1 Tapu Lele-GX HIF 163
1 Eldegoss V RCL 176
1 Snorlax SWSHALT 107

Trainer: 34
1 Rescue Stretcher BUS 165
4 Lillie's Poké Doll CEC 267
1 Cyllene ASR 183
1 Team Yell's Cheer BRS 149
1 Team Skull Grunt SUM 149
3 Fog Crystal CRE 227
1 Plumeria BUS 145
1 Lillie's Determination MEG 169
2 Steven's Resolve CES 165
1 Team Yell Grunt SSH 202
1 Professor's Research SSH 201
1 Bellelba & Brycen-Man CEC 186
1 Arven PAF 235
1 Rosa CEC 236
1 Channeler UNM 232
1 Path to the Peak ASR 213
1 Guzma HIF 153
1 Counter Catcher CIN 120
1 Hisuian Heavy Ball ASR 146
1 Big Parasol DAA 199
1 Marnie PR-SW 121
1 Penny PAF 239
1 Peonia CRE 196
1 Klara CRE 194
1 Gladion CIN 109
1 Faba LOT 208
2 Cynthia & Caitlin CEC 228
2 Lusamine UPR 153
1 Mars UPR 154
1 Xerosic's Machinations SFA 89
1 Bird Keeper SHF 66
2 Quick Ball SSH 216
1 Miss Fortune Sisters LOR 194
4 Lucky Egg SSH 167

Energy: 4
2 Recycle Energy UNM 257
1 Legacy Energy TWM 167
1 Basic {L} Energy GRI 168
1 Basic {P} Energy SUM 162
```
*(this file has no `Total Cards:` trailer — one of the 25/4,840 that omit it)*

Why this one: `PR-SM` and `PR-SW` promo prefixes; `Xurkitree-GX` (hyphen inside a name, immediately
before the set code — the case that breaks left-to-right parsers); ampersand names
(`Bellelba & Brycen-Man`, `Cynthia & Caitlin`); **basic Energy carrying a real set code**
(`GRI 168`, `SUM 162`) rather than `SVE`; and a missing trailer.

### Example D (bonus) — localisation and the `Energy` pseudo-set

Two more shapes worth having in your fixture set:

Source: https://github.com/IceMaD/ptcgl-decklist-parser/blob/main/tests/data/decklist.fr.txt (C3, MIT)
```
Pokémon : 9
...
Dresseur: 12
2 Techno Radar PAR 180 PH
2 Area Zero Underdepths SCR 131
2 Area Zero Underdepths SCR 174
...
Énergie : 3
7 Basic {L} Energy SVE 12
...
Total de cartes : 60
```
French labels; **space before the colon on two of three headers but not the third**; and
`Area Zero Underdepths` at 2+2 across two different prints — a live demonstration of the 4-copy
rule counting by name across printings (§3.2).

Source: https://github.com/JoseRivas1998/pokemon-decklists/blob/main/dragapult-dusknoir.txt (C2)
```
Energy: 2
3 Basic {P} Energy Energy 13
3 Basic {R} Energy Energy 10
```
The **literal set code `Energy`**. Confirmed as an intentional output of the Limitless exporter,
whose code contains a basic-Energy remap table producing exactly `` `Energy ${n}` `` [O] C4.

## 1.5 Edge-case catalogue

Measured over **127,696** card lines in **4,840** files (C1) — of which 127,545 are well-formed
`qty name SET num` — unless noted.

| # | Case | Real example | Frequency | What the importer must do |
|---|---|---|---|---|
| 1 | **`PH` print suffix** | `1 Mimikyu PAL 97 PH` | 3,018 lines; 1,033/4,840 files | Parse and **keep** it on the `deck_card` row for round-trip. Ignore it for card identity and legality. **[I]** it denotes the parallel/reverse-holo treatment; no official documentation of the token exists — I could not find one (§7). |
| 2 | **Basic Energy brace notation** | `4 Basic {R} Energy SVE 10` | **7,713** lines | `{G R W L P F D M Y}` = Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Fairy. Map to the 9 basic Energy card names. |
| 2b | **⚠ Braces are NOT a basic-Energy marker** | `2 Telepathic {P} Energy TEF 155`, `Rocky {F} Energy`, `Growing {G} Energy`, `Speed {L} Energy`, `Bubbly {W} Energy` | **175** lines | These are **Special** Energy and are capped at 4 copies. Detect "basic" from our catalogue, never from the brace (§3.3). |
| 2c | **Alternate basic-Energy spellings** | `8 Grass Energy MEE 1`, `2 Lightning Energy SVE 12`, `9 grass SVE 1` | **259** lines | Older/hand-edited lists drop the `Basic`/braces, sometimes lowercase. Resolve case-insensitively by `(set, number)` first; fall back to a type-name lookup. |
| 3 | **Set code `Energy`** | `3 Basic {P} Energy Energy 13` | rare, Limitless-origin | Treat `Energy` as a pseudo-set meaning "the basic Energy of the type in the name"; resolve by type, ignore the number. |
| 4 | **Bare name, no set/number** | `2 Air Balloon`, `2 Pokegear 3.0` | **12** lines | **Legal input.** S10: *"If you are trying to submit a Trainer or Energy card and your game is set to English, it's enough to remove the ALT code and number altogether, as the card can then be found by only its name."* Resolve by name; pick the print by our own policy (§1.7 step 5). |
| 5 | **ALT pseudo-sets** — `SWSHALT`, `SVALT`, `SMALT` | `3 Boss's Orders SWSHALT 32` | **262** lines | **[D]** S10: *"certain Promo variants use a in-game exclusive numbering system instead of their proper set code and number. E.g. Cosmo foil Boss's Orders from the Premium Tournament Collection is listed as `SWSHALT 127` instead of `BRS 132` (as printed on the card)."* No printed equivalent exists. Needs a hand-maintained `(altcode, number) → card` table, or fall back to name-only (case 4). S10 also warns: *"Don't try to edit the set code manually, as that could cause the card to be interpreted incorrectly!"* |
| 6 | **Promo prefixes** | `PR-SV`, `PR-SW`, `PR-SM` | **642** lines | Map to TCGdex `svp`, `swshp`, `smp`. Limitless's exporter translates its own `SVP`/`SP` to `PR-SV`/`PR-SW` [O] C4, so both producers agree. |
| 7 | **Sub-set codes** `{SET}-{GG\|TG\|RC}` | `2 Bibarel CRZ-GG 25`, `1 Boss's Orders LOR-TG 24` | **678** lines | Distinct TCGdex sets: `CRZ-GG`→`swsh12.5gg`, `LOR-TG`→`swsh11.5tg`, `SIT-TG`→`swsh12.5tg`, `BRS-TG`→`swsh9.5tg`, `ASR-TG`→`swsh10.5tg`, `CEL-CC`→`cel25cc`. Limitless generates these mechanically: `` number.match(/(RC|TG|GG)[0-9]{1,2}/) → `${set}-${num[0:2]} ${num[2:]}` `` [O] C4. |
| 8 | **Names containing a colon** | `1 Technical Machine: Devolution PAR 177` | **1,701** lines | Do not use `split(':')` anywhere. This is common, not exotic. |
| 9 | **Set code with no number** | `2 Bisharp ASC`, `4 Canari ASC` | **17** lines | Malformed. Resolve by name within the named set; if that fails, name-only. |
| 10 | **Non-English card names** | `4 Canari ASC` (French for Chatot) | rare | S10: *"if it is a Pokémon, or card in a different language, the proper set code and number are necessary!"* Match on `(set, number)` and ignore the name; if that fails, flag unresolved. |
| 11 | **Localised section labels** | `Dresseur: 12`, `Karten insgesamt: 60` | **10** files with a localised trailer | Table in §1.6. |
| 12 | **Missing `Total Cards:` trailer** | Example C | **25/4,840** (4,805 English + 10 localised have one) | Optional. Never require it. |
| 13 | **Header count disagrees with reality** | `Pokémon: 12` over 11 lines summing 18 | 100/4,840 | Ignore header counts entirely (§1.3). |
| 14 | **CRLF vs LF** | — | 0/4,840 in C1 (git-normalised); C3's MIT formatter emits `\r\n` | Split on `\r?\n`; strip each line. Emit `\n`. **[I]** the Windows PTCGL client almost certainly puts CRLF on the clipboard; the corpus cannot tell us because git normalised it. |
| 15 | **Trailing junk after the trailer** | C3's fixture ends `Random line at the end` | — | Collect unparsed lines into a `parse_warnings` list; never fail the whole import. |
| 16 | **Set codes that are not sets at all** | none found | — | **101** distinct set codes seen; all real (§1.7). |
| 17 | **Cards with no regulation mark / no set code on the printed card** | basic Energy from vintage sets | — | Not an import problem; a legality problem — see §2.6. |
| 18 | **Same name, two prints, two lines** | `2 Area Zero Underdepths SCR 131` + `2 … SCR 174` | common | Must **sum by card name** for the 4-copy rule (§3.2), while preserving both `deck_card` rows. |

**Explicitly *not* real, contrary to `BEHAVIOR-SPEC.md` §8.8:** zero non-numeric collector numbers,
zero `* ` line prefixes, zero `SWSH133`/`TG03`-style number tokens.

## 1.6 Localisation

**[O]** header labels across C1 + C3:

| Language | Pokémon | Trainer | Energy | Trailer | Files in C1 |
|---|---|---|---|---|---|
| English | `Pokémon` | `Trainer` | `Energy` | `Total Cards` | 4,805 |
| German | `Pokémon` | `Trainer` | `Energie` | `Karten insgesamt` | 8 |
| Portuguese | `Pokémon` | `Treinador` | `Energia` | `Total de cartas` | 2 |
| French | `Pokémon` | `Dresseur` | `Énergie` | `Total de cartes` | C3's MIT fixture |

Also seen once: `Trainer Cards: 22` (hand-written). Spanish/Italian labels are not in my sample.

⇒ **[I] Do not match on the label.** Match section headers with `^(.+?)\s*:\s*(\d+)\s*$` and assign
the section by **position** (1st = Pokémon, 2nd = Trainer, 3rd = Energy), falling back to a label
lookup table. Better still: derive each card's section from *our* catalogue (`card.category`) after
resolution and treat the file's sections as a hint only. `Basic {?} Energy` names are
language-independent, which helps.

## 1.7 The set-code mapping problem — and why TCGdex does not solve it

PTCGL writes `SVI 181`. TCGdex ids are `sv01-181`. You need a join.

### 1.7.1 TCGdex has a `Set.tcgOnline` field. It is abandoned.

**[O]** `{ sets { id name tcgOnline releaseDate cardCount { total official } } }` → 218 sets, of
which **118 carry a `tcgOnline` value**, and the newest one is **Crown Zenith Galarian Gallery
(2023-01-20)**. Every Scarlet & Violet and Mega Evolution set has `tcgOnline: null` — including
`sv01` (SVI), `sv02` (PAL), `sv03` (OBF), `sve` (SVE), `me01` (MEG). Worse, even in the covered era
it is patchy: `swsh11` (Lost Origin) is null while `swsh11.5tg` (its Trainer Gallery) carries `LOR`.

Measured against C1's real traffic: **`tcgOnline` resolves 12.3% of card lines (55 of 101 distinct
set codes).** It also collides — `RR`, `SHF`, `CEL`, `BRS`, `ASR` each map to two sets.

⇒ **Seed from it, do not depend on it.**

### 1.7.2 Recommended join strategy

A five-step ladder, degrading gracefully. Steps 1–3 are build-time (produce a vendored table);
steps 4–5 are import-time.

**Step 1 — vendored `ptcgl_set_alias` table, hand-reviewed, checked into the repo.**
This is the authority. Nothing at runtime may invent an entry.

**Step 2 — bulk-seed it mechanically.** Limitless publishes a set index at
`https://limitlesstcg.com/cards` — a 153-row HTML table of `(code, set name, release date, card
count)` whose codes are the PTCGL codes for every modern set. Join it to TCGdex `sets` on
normalised set name, falling back to `(releaseDate, cardCount.official)`.

**[O] I ran this join.** 141/153 matched by name, +1 by (date, count), 11 unmatched. Applied to C1's
real traffic it covers **96.8% of card lines (123,433 / 127,545)** with zero manual work.

**Step 3 — hand-curate the ~25 residual entries.** The misses are entirely predictable classes.
Here is the table, derived from TCGdex's own `sets` response [O]:

| PTCGL code | TCGdex set id | Class | Note |
|---|---|---|---|
| `MEW` | `sv03.5` | name mismatch | TCGdex names it `151` |
| `PR-SV` | `svp` | promo | `SVP Black Star Promos`, 225 cards |
| `PR-SW` | `swshp` | promo | `SWSH Black Star Promos`, 307 cards |
| `PR-SM` | `smp` | promo | `SM Black Star Promos`, 248 cards |
| `MEP` | `mep` | promo | **TCGdex has 0 cards in this set** — a live data gap |
| `SVE` | `sve` | Energy set | `Scarlet & Violet Energy`, 24 cards |
| `MEE` | `mee` | Energy set | `Mega Evolution Energy`, 8 cards |
| `CRZ-GG` | `swsh12.5gg` | sub-set | Galarian Gallery |
| `LOR-TG` | `swsh11.5tg` | sub-set | Trainer Gallery |
| `SIT-TG` | `swsh12.5tg` | sub-set | Trainer Gallery |
| `BRS-TG` | `swsh9.5tg` | sub-set | Trainer Gallery |
| `ASR-TG` | `swsh10.5tg` | sub-set | Trainer Gallery |
| `CEL-CC` | `cel25cc` | sub-set | Celebrations Classic Collection |
| `SHF` (Shiny Vault numbers) | `swsh4.5sv` | sub-set | Limitless offsets `SV001`→`74` for SHF, `+69` for HIF [O] C4 — invert this |
| `SWSHALT`, `SVALT`, `SMALT` | **none** | PTCGL-only | No printed set. Needs a per-`(code, number)` override table or name-only fallback (§1.5 case 5) |
| `SVOM`, `SVOD`, `MBD`, `MBG`, `MC`, `MCRI`, `SRC`, `TG` | **unresolved** | product pseudo-sets | 34 lines total in C1. Leave unmapped; name-only fallback. |

**Step 4 — resolve `(set_id, number)` numerically, never by string id.**
**[O] TCGdex `localId` zero-padding is inconsistent between sets**: `sv09-001`, but `swsh9-100` and
`sv03-125`. `SVI 181` is `sv01-181`; `JTG 1` is `sv09-001`. So:

```sql
WHERE card.set_id = :tcgdex_set_id AND CAST(card.local_id AS INTEGER) = CAST(:number AS INTEGER)
```
with a text fallback for non-numeric `localId` (`TG02`, `SV013`, `SWSH251`).

> **[O] Additional TCGdex gotcha:** the GraphQL `card(id: …)` singular resolver **prefix-matches**.
> `card(id:"sv09-1")` returns `sv09-100` (Lokix), not a 404 and not `sv09-001`. Always assert
> `returned.id == requested.id`, or use `cards(filters:{id:"sv09-"})` and filter locally.

**Step 5 — fallback ladder when the `(set, number)` join misses.** In order:
1. `(set, number)` exact → done.
2. `(name, set)` → if exactly one card in that set has the name, take it.
3. `(name)` alone → collect all prints; pick by policy: (a) a print the user **owns**, else (b) the
   print that is legal in the deck's format, else (c) the most recent print. Record
   `resolution: 'name_only'` on the row so the UI can badge it.
4. Nothing → keep the row as `unresolved` with the raw text preserved, count it toward the 60, and
   surface it as a validation warning. **Never drop a line silently.**

> **[O] Name-matching trap.** TCGdex disambiguates same-named cards with parenthetical suffixes that
> PTCGL does not use: TCGdex has `Boss's Orders (Lysandre)`, `Boss's Orders (Giovanni)` and
> `Boss's Orders`. PTCGL writes `Boss's Orders` for all of them. Strip a trailing
> `\s*\([^)]+\)$` before comparing — **but keep the original for display**, and be aware this also
> means the 4-copy rule must key on the *stripped* name (§3.2).

## 1.8 Export: what we emit

```
Pokémon: {distinct entries}          ← §1.3
{qty} {name} {SETCODE} {number}[ PH]
…
                                      ← one blank line
Trainer: {distinct entries}
…
                                      ← one blank line
Energy: {distinct entries}
…
                                      ← one blank line
Total Cards: {sum of all qty}
```
Rules: `\n` line endings (accept `\r\n` on input); `Pokémon` with the é; strip leading zeros from
the collector number (`002` → `2`); uppercase the set code; emit the *PTCGL* code from
`ptcgl_set_alias`, not the TCGdex id; re-emit the stored `PH` marker if the source had one; omit
set/number only for rows we could not resolve, emitting the bare-name form (§1.5 case 4). Order
within a section: **[I]** preserve the user's order; PTCGL's own ordering is not stable across
exports in the corpus and nothing depends on it.

## 1.9 TCGplayer Mass Entry — a *different* format we also support

**[D]** S11, verbatim: *"Mass Entry reads each line as a separate item and follows this format:
Quantity → Card Name → Set Code → Card Number Within Set. Ex. 1 Lightning Bolt #84 from Secret Lair
Drop is identified when you enter: `1 Lightning Bolt [SLD] 84`"* … *"Removing the card number will
tell Mass Entry that you don't mind which art you get, you just want it to be from a specific set.
Maybe you don't even mind which set the card's from — just the quantity and card name will work
fine, too."*

**[O]** `BEHAVIOR-SPEC.md` §8.8 records pkmn.gg's card changelog carrying a field literally named
`TCGplayer Mass Entry` whose value is `1 Goldeen [ME05] 13`.

```ebnf
massentry_line = count , SP , name , [ SP , "[" , setcode , "]" , [ SP , number ] ] ;
```

| | PTCG Live | TCGplayer Mass Entry |
|---|---|---|
| Set code delimiter | none — bare token | **square brackets** `[ME05]` |
| Set code vocabulary | PTCGL codes (`SVI`, `MEW`, `PR-SV`) | **TCGplayer** set abbreviations (`ME05`) — a *third* namespace |
| Number | required unless bare-name | optional |
| Sections | `Pokémon:` / `Trainer:` / `Energy:` required | none — flat list |
| Trailer | `Total Cards: n` | none |
| Foil marker | ` PH` | none (chosen in the UI's preferences panel) |
| Purpose | play the deck | **buy** the deck |

⇒ **Three set-code namespaces, not two:** PTCGL, TCGplayer, TCGdex. `ptcgl_set_alias` must therefore
carry a `tcgplayer_abbrev` column too (obtainable from TCGCSV's group data, which [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §7
already recommends as our price feed — its `groups` endpoint carries the abbreviation). Mass Entry
is what the `Purchase Deck` / `Purchase Missing Cards` buttons (`BEHAVIOR-SPEC.md` §8.6, §9.7)
generate; PTCGL export is what `Export to PTCGLive` generates. **Do not share a formatter.**

---

# 2. Format legality as data

Everything in this section is a **row in a table**, refreshed by a job, never a constant in code.

## 2.1 Standard

### 2.1.1 The mechanism: regulation marks

Standard legality is determined by a **letter printed on the card** (bottom-left of modern cards),
not by which set the card is from.

> **[D]** S3: *"A card's legality status is not based on which expansion it's from."* … *"players
> will need to refer to the regulation mark on the bottom of the card to see whether that card is
> legal for play."*

### 2.1.2 Current legal set — as of 2026-07-24

> **Standard legal regulation marks: `H`, `I`, `J`** (plus any future mark).

Two independent primary sources agree:

**[D]** S3 (published 2026-01-09): *"Cards with the 'G' regulation mark will no longer be legal for
play in the 2026 Standard format. Cards with 'H,' 'I,' and 'J' regulation marks will be legal to use
(as will any future regulation marks that may be released)."*

**[D]** S1 §4.1.1 "Legal Regulation Marks" table (handbook revision 2026-05-21):

| Legality date | Mark | Standard | Expanded |
|---|---|---|---|
| April 14, 2023 | G | | ✔ |
| April 5, 2024 | H | ✔ | ✔ |
| April 11, 2025 | I | ✔ | ✔ |
| March 6, 2026 | J | ✔ | ✔ |

(The "legality date" is when that mark *entered* the pool, not when it leaves.)

**Effective dates of the 2026 rotation [D] S3:**
- **In-person Play! Pokémon events: 2026-04-10**
- **Pokémon TCG Live: 2026-03-26** (two weeks earlier — the digital client always rotates first)

**Next rotation expected: approximately 2026-04-09 (second Friday of April 2027 is 2027-04-09), when
`H` should drop and `K` should be legal.** [I] from the pattern below. The announcement historically
lands in **January**. Put a calendar reminder for **2027-01-15** and treat any legality computed
after 2027-04-01 as stale until the announcement is read.

### 2.1.3 Rotation history

| Season | Standard floor mark | In-person effective | Source |
|---|---|---|---|
| 2021–23 | D | — | **[D-secondary]** S12 |
| 2023–24 | E | — | **[D-secondary]** S12 |
| 2024–25 | F | — | **[D-secondary]** S12 |
| 2025–26 | G | — | **[D-secondary]** S12 |
| 2026–27 | **H** | **2026-04-10** (PTCGL 2026-03-26) | **[D]** S3, S1 |

I could not re-fetch the 2023/2024/2025 announcement pages — pokemon.com's bot wall started
returning the interstitial mid-session (§7). The floor letters above come from Bulbapedia and are
consistent with S1's table; the exact per-year effective dates before 2026 are **unverified**.
They are also not needed: we only ever evaluate legality *as of today*.

### 2.1.4 Standard banned cards

> **[D]** S2, fetched 2026-07-24, verbatim: *"**Standard** — No cards are currently banned in the
> Standard format."*
>
> **[D]** S4 (2026-03-12): *"No cards were banned from the Standard format. It will be an extremely
> rare occurrence for cards to be banned from the Standard format."*

The table must still exist — it is simply empty today.

### 2.1.5 The reprint rule — the part everyone gets wrong

A card whose printed mark has rotated out is **still legal** if a functionally identical reprint
with a legal mark exists.

> **[D]** S1 §4.1.3: *"Cards that have previously existed in the format are occasionally reprinted
> in newer expansions. In these cases, any version of the card may be played if: The name of the new
> card is identical to that of the older card; All text printed on the new card is functionally
> identical to that of the older card."*
>
> **[D]** S3: *"Older reprints without regulation marks can still be used if a newer version with a
> legal regulation mark exists."*

S1 also gives the functional-identity test verbatim, which is worth pinning as a fixture:
> *"Copycat (CES, 127) and Copycat (TRR, 83) are functionally identical. Although the wording has
> been altered, the effect described remains unchanged."* … *"Rainbow Energy (CES, 151) and Rainbow
> Energy (TR, 17) are not functionally identical, as the former 'put[s] 1 damage counter' while the
> latter 'does 10 damage'."*

⇒ **This is exactly what `playable_fingerprint` ([Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §3 item 4) computes.** Implement
Standard legality as:

```
standard_legal(card) :=
      card.regulation_mark ∈ current_legal_marks
   OR ∃ c' : c'.playable_fingerprint == card.playable_fingerprint
             AND c'.regulation_mark ∈ current_legal_marks
```

**[O] Verified this is necessary, not theoretical.** `Ultra Ball SVI 196` = TCGdex `sv01-196`,
`regulationMark: "G"`, `legal.standard: false` — yet Ultra Ball is a Standard staple today, because
`me01-131 Ultra Ball` carries mark `I`. A validator that trusts TCGdex's per-print flag would
reject half the real decks in C1.

Precompute a `standard_legal_fingerprints` set once per sync; the per-card check is then a hash
lookup. Same shape for Expanded.

## 2.2 Expanded

**Card pool [D]** S1 §4.1.1 — Expanded is *enumerated*, not derived:
- Regulation marks **D, E, F, G, H, I, J** (D/E/F are Expanded-only; G is now Expanded-only).
- Every Black & White series expansion: *Black & White, Emerging Powers, Noble Victories, Next
  Destinies, Dark Explorers, Dragon Vault, Dragons Exalted, Boundaries Crossed, Plasma Storm, Plasma
  Freeze, Plasma Blast, Legendary Treasures*.
- Every XY series expansion: *Kalos Starter Set, XY, Flashfire, Furious Fists, Phantom Forces, Primal
  Clash, Double Crisis, Roaring Skies, Ancient Origins, BREAKthrough, BREAKpoint, Generations, Fates
  Collide, Steam Siege, Evolutions*.
- Every Sun & Moon series expansion: *Sun & Moon, Guardians Rising, Burning Shadows, Shining Legends,
  Crimson Invasion, Ultra Prism, Forbidden Light, Celestial Storm, Lost Thunder, Team Up, Dragon
  Majesty, Unbroken Bonds, Unified Minds, Hidden Fates, Cosmic Eclipse*.
- Additional releases: *McDonald's Collection 2011–2021, Black & White Trainer Kit, XY Trainer Kit
  (+ Bisharp & Wigglytuff, Latias & Latios, Pikachu Libre & Suicune), Sun & Moon Trainer Kit
  (Lycanroc & Alolan Raichu, Alolan Sandslash & Alolan Ninetales), Detective Pikachu*.
- "Black Star" promos: prefix **BW** `01+`, **XY** `01+`, **SM** `158+`.

⇒ Store as `format_set_allowance` rows, not as a `release_date >= 2011-04-25` predicate. The promo
rule is a `(prefix, min_number)` rule and needs its own row shape.

**Ban list [D]** S2, fetched 2026-07-24. **27 entries.** Reproduced in full because getting this
wrong silently breaks decks:

| Card | Set(s) and number(s) |
|---|---|
| Archeops | Black & White—Noble Victories, 67/101; Black & White—Dark Explorers, 110/108 |
| Chip-Chip Ice Axe | Sun & Moon—Unbroken Bonds, 165/214 |
| Delinquent | XY—BREAKpoint, 98/122, 98a/122, and 98b/122 |
| Duskull | Sun & Moon—Cosmic Eclipse, 83/236 |
| Flabébé | Sun & Moon—Forbidden Light, 83/131 |
| Flapple | Sword & Shield—Rebel Clash, 022/192; Sword & Shield—Shining Fates, SV013/SV122; Sword & Shield—Astral Radiance, TG02/TG30; Sword & Shield Promo, SWSH022 |
| Forest of Giant Plants | XY—Ancient Origins, 74/98 |
| Ghetsis | Black & White—Plasma Freeze, 101/116 and 115/116 |
| Hex Maniac | XY—Ancient Origins, 75/98 and 75a/98 |
| Island Challenge Amulet | Sun & Moon—Cosmic Eclipse, 194/236 and 265/236 |
| Jessie & James | Hidden Fates, 58/68 and 68/68 |
| Lt. Surge's Strategy | Sun & Moon—Unbroken Bonds, 178/214; Hidden Fates, 60/68 |
| Lysandre's Trump Card | XY—Phantom Forces, 99/119 and 118/119 |
| Marshadow | Shining Legends, 45/73; Black Star Promo, SM85 |
| Maxie's Hidden Ball Trick | XY—Primal Clash, 133/160 and 158/160 |
| **Medicham V** | Sword & Shield—Evolving Skies, 083/203, 185/203, and 186/203 — **added 2026-04-10** [D] S4 |
| Milotic | XY—Flashfire, 23/106 |
| Mismagius | Sun & Moon—Unbroken Bonds, 78/214 |
| Oranguru | Sun & Moon—Ultra Prism, 114/156 |
| Puzzle of Time | XY—BREAKpoint, 109/122 |
| Red Card | XY, 124/146; Generations, 71/83 |
| Reset Stamp | Sun & Moon—Unified Minds, 206/236, 206a/236, and 253/236 |
| Sableye | Black & White—Dark Explorers, 62/108 |
| Scoop Up Net | Sword & Shield—Rebel Clash, 165/192 and 207/192 |
| Shaymin-EX | XY—Roaring Skies, 77/108, 77a/108, and 106/108 |
| Unown | Sun & Moon—Lost Thunder, 90/214 |
| Unown | Sun & Moon—Lost Thunder, 91/214 |

**[I] Bans are print-scoped, not name-scoped.** The list names specific sets and numbers.
`Duskull SM—Cosmic Eclipse 83/236` is banned; `Duskull SFA 18` is not. `Unown LOT 90` and
`Unown LOT 91` are banned but other Unown are not. So `format_ban` rows carry
`(card_name, set_id NULL, local_ids TEXT[] NULL)` and match on the *print*, with a name-only row
type available for future bans that are worded name-wide. **This is the opposite of the 4-copy rule,
which is name-scoped.** Getting the two backwards is the most likely bug in this whole subsystem.

**Also note:** several banned entries list numbers that are *secret rares / alternate arts of the
same card* (`Ghetsis 101/116 and 115/116`). Our alias/variant model must map both to the ban.

## 2.3 Gym Leader Challenge (GLC)

A fan format; `gymleaderchallenge.com` is the authority and pkmn.gg supports it as a first-class
format tab (`BEHAVIOR-SPEC.md` §8.1).

### 2.3.1 The rules, verbatim

**[D]** S6, complete and verbatim:
> - *"Your deck can only contain one type (color) of Pokémon."*
> - *"Only one of each card with the same name allowed in a deck, except for Basic Energy."*
> - *"Cards with a Rule Box are not allowed."*
> - *"ACE SPEC cards are not allowed."*
> - *"Legal Cards: Black & White – onwards, and a short ban list"*
> - *"60 card decks are built & 6 Prize Card games are played with the most current Pokemon TCG rules."*

### 2.3.2 Rule Box — the exact definition

**[D]** S8, verbatim: *"What types of cards have a Rule Box? Cards with a Rule Box cannot be played
in GLC format. This includes Pokemon V, EX, GX, BREAK, Radiant Pokémon, ACE SPECs, and Prism Stars
(including Prism Star Trainer and Energy cards). **Ancient Trait Pokémon do not have a rule box.**"*

Note this covers `V`, `VMAX`, `VSTAR`, `V-UNION` (all are "Pokémon V"), both `EX` (XY-era, uppercase)
and `ex` (SV-era, lowercase), `GX`, `TAG TEAM-GX`, `BREAK`, `Radiant`, `ACE SPEC`, `Prism Star`.

### 2.3.3 Type coherence — the exact wording, including evolution lines

**[D]** S8, verbatim: *"What about Eeveelutions or Pokemon that evolve from Basics of a different
type? Following GLC's official rules, cards that are one type and evolve into a different type
cannot be played in the same deck, like Eevee."*

**[D]** S8, verbatim: *"Can I use Dual Type Pokemon? Dual Type Pokémon are allowed, as long as one of
their types matches your deck type. The card must physically be two types in order to play it in
either type of deck (e.g., Volcarona STS can be played in a Fire or Grass deck, but Gallade CEC can
only be played in a Psychic deck)."*

⇒ The type rule, precisely:
```
Let T = the deck's declared type.
For every Pokémon card p in the deck:
    require T ∈ p.types                       (dual-type cards satisfy this via either type)
For every ordered pair (a, b) where b.evolveFrom == a.name:
    if a is in the deck and b is in the deck: already covered by the rule above
    but ALSO: a card `a` may not be in the deck at all if the only reason to play it
    is to evolve into a card of a different type — i.e. the practical rule is that
    the whole evolution line you play must be single-typed.
Trainers and Special Energy are typeless and exempt.
Basic Energy of any type is permitted regardless of T:
```
**[D]** S8: *"Can I use more than one type of Basic Energy in my deck? Yes! Any number of any type of
Basic Energy may be played in your deck."*

**[I]** Implementation: since every Pokémon in the deck must already share `T`, the evolution rule is
*already implied* by the per-card check — an Eevee (Colorless) simply cannot be in a Water deck.
The FAQ wording exists to pre-empt the "but Vaporeon needs Eevee" argument. So one validator
suffices; do not build a separate graph walk. Emit a **helpful** message for the Eevee case though.

**Fairy is legal.** **[D]** S9, verbatim: *"While Fairy is not banned from Gym Leader Challenge, it
has been officially discontinued from the TCG."* The site's getting-started guide covers 10 types
(Grass, Fire, Water, Lightning, Psychic, Fighting, Colorless, Darkness, Metal, Dragon) and omits
Fairy for strategy reasons only. Our type picker must offer **11**.

### 2.3.4 Additional GLC rules found only in the FAQ

These are not in S6 and `BEHAVIOR-SPEC.md` does not have them. All **[D]** S8, verbatim:

1. **Same species, different name is fine.** *"You can only play one Pokemon of the same card name.
   … However, two of the same species of Pokémon can be played as long as their card name is
   different (e.g., Shining Genesect and Genesect, or Alolan Grimer and Grimer)."*
2. **A functional-reprint singleton group.** *"You may play one Boss's Orders OR Lysandre in your
   deck – not both. This is an official Pokémon TCG Official Ruling. Similarly, you may only play
   one of Professor's Research OR Professor Sycamore OR Professor Juniper per deck. **These are the
   only cards affected by this restriction.**"*
   ⇒ a `glc_exclusive_group` table with exactly two rows today:
   `{Boss's Orders, Lysandre}` and `{Professor's Research, Professor Sycamore, Professor Juniper}`.
   The FAQ explicitly closes the set ("these are the only cards"), so this will not grow silently.
3. **Standard/Expanded bans do not apply.** *"Gym Leader Challenge format has its own ban list…
   If a card isn't on this list, it's fair game —so feel free to play your Delinquent and Hex
   Maniac."* ⇒ never inherit ban rows between formats.
4. **"Not legal for tournament play" cards are excluded.** *"Cards like Zacian Lv. X, Dragapult
   Prime, Imakuni?'s Doduo, etc., are not legal in GLC."*
5. **Celebrations Classic Collection:** *"The Classic Collection cards are not permitted in GLC
   unless they are from Black & White or later and abide by the existing GLC rules. This means that
   only Reshiram and Zekrom are legal in GLC."* ⇒ two explicit allow-rows against set `cel25cc`.
6. **Pokémon TCG Classic:** *"For the most part, no… The exception is for cards that have been
   printed in this set as reprints of GLC-legal cards such as Ultra Ball, Super Rod, VS Seeker."*
   ⇒ fingerprint-based allow, same primitive as §2.1.5.
7. **Item cards that act as Pokémon are fine:** *"Robo Substitute, Unidentified Fossil, and Lillie's
   Pokédoll … are item cards, and are only treated as Pokémon when in play. They are all allowed in
   any type of deck."* ⇒ do **not** run the type check on `category == Trainer`.

### 2.3.5 GLC ban list — as of 2026-07-24

**[D]** S7, verbatim and complete. **13 entries.**

| Card | Print(s) | Effective |
|---|---|---|
| Lysandre's Trump Card | XY: Phantom Forces, 99/119 and 118/119 | Nov. 16, 2021 |
| Oranguru | SM: Ultra Prism, 114/156 | Nov. 16, 2021 |
| Forest of Giant Plants | XY: Ancient Origins, 74/98 | Jan. 10, 2022 |
| Chip-Chip Ice Axe | SM: Unbroken Bonds 165/214 | Jun. 8, 2022 |
| Hiker | SM: Celestial Storm 133/168, Hidden Fates SV85/SV94 | Jun. 8, 2022 |
| Kyogre | Shining Fates 021/072 | Nov. 11, 2022 |
| Pokémon Research Lab | SM: Unified Minds, 205/236 | Nov. 1, 2023 |
| Raikou | SWSH: Vivid Voltage 050/185 | Sep. 1, 2024 |
| Marshadow | Shining Legends 45/73, Promo SM85 | Sep. 1, 2024 |
| Duskull | SM-Cosmic Eclipse 83/236 | Sep. 1, 2024 |
| **Double Colorless Energy** | Shining Legends 69/73 **and all other versions** | Apr. 24, 2025 |
| Twin Energy | SWSH: Rebel Clash 174/192 and 209/192 | Apr. 24, 2025 |
| **Dimension Valley** | XY: Phantom Forces 93/119 | **Apr. 20, 2026** |

Footnote **[D]** S7: *"Gym Leader Challenge is always being monitored, and the ban list is subject to
change."*

Note **Double Colorless Energy** is worded *"and all other versions"* — a **name-scoped** ban, unlike
every other row. The `format_ban` shape must support both scopes (§2.2).

### 2.3.6 The GLC validator set

Refining `BEHAVIOR-SPEC.md` §8.3's five checks into eight:

1. `count(cards) == 60`
2. singleton by card name, **except Basic Energy** (unlimited copies, any types)
3. every Pokémon shares the declared type (dual-type satisfies via either type); Trainers, Special
   Energy and Pokémon-Tool-that-are-Items exempt
4. no Rule Box: `V/VMAX/VSTAR/V-UNION/EX/ex/GX/TAG TEAM-GX/BREAK/Radiant/Prism Star/ACE SPEC`
5. card pool: Black & White onward (reuse the Expanded `format_set_allowance` rows) **minus**
   GLC-specific carve-outs (§2.3.4 items 4–6)
6. card ∉ GLC ban list (§2.3.5)
7. at most one member of each `glc_exclusive_group` (§2.3.4 item 2)
8. at least one Basic Pokémon (§3.6 — a base-game rule, but GLC says *"with the most current Pokemon
   TCG rules"* so it applies)

## 2.4 Unlimited

**[D]** S1 §4.2: *"Unlimited decks may contain cards from any Pokémon Trading Card Game expansions
and promotional cards that have been released in the United States."*
**[D]** S1 §4.2.3: *"There are currently no banned cards in the Unlimited format."*
**[D]** S2: *"**Unlimited** — No cards are currently banned in the Unlimited format."*

So: deck size 60, ≤4 copies by name, Basic Energy exempt, at least one Basic Pokémon. Nothing else.

One nuance worth an info-level note in the UI, **[D]** S1 §4.2.2: *"Competitors may still include
those older versions of the card in their decks, provided that the wording of the most recent
version is used wherever that card is concerned."* — i.e. in Unlimited, an old print with different
text plays as the newest text. Not a legality check; a display note on the card.

## 2.5 Is TCGdex's legality data trustworthy? — verdict

**Yes for `regulationMark`. Yes-but-insufficient for `legal.standard` / `legal.expanded`. No for
`Set.tcgOnline`.**

**[O] Tests run 2026-07-24** (5 GraphQL card queries):

| Card | `regulationMark` | `legal.standard` | Correct? |
|---|---|---|---|
| `sv03-125` Charizard ex (OBF 125) | `G` | `false` | ✔ — G rotated out 2026-04-10 |
| `sv05-157` Prime Catcher (TEF 157) | `H` | `true` | ✔ |
| `me03-*` Perfect Order, 124 cards | `J`×118, `I`×6 | `true`×124 | ✔ |
| `sv10-*` Destined Rivals, 244 cards | `I`×236, `H`×6, `G`×2 | true/true/**false** | ✔ — G-marked reprints correctly flagged |
| `sv09-*` Journey Together, 190 cards | `I`×131, `H`×58, `G`×1 | true/true/**false** | ✔ |
| `bw1-1` Snivy | `null` | `false` (expanded `true`) | ✔ |

The mark→legality mapping is exactly `{H, I, J}` today — current, correct, and updated for a
rotation that happened **three months ago**. That is a good signal about TCGdex's maintenance.

**But `legal.standard` is per-print and therefore under-reports deck legality.** Proven above
(§2.1.5): `Ultra Ball sv01-196` is `standard: false` while the card is a Standard staple because
`me01-131 Ultra Ball` is mark `I`.

⇒ **Use TCGdex as follows:**

| Field | Use it as | Do not |
|---|---|---|
| `regulationMark` | the authoritative per-print mark | — |
| `legal.standard` / `legal.expanded` | a **cross-check** on our own mark→legality table; alert if they diverge | use it directly as the deck-legality predicate |
| `Set.tcgOnline` | a seed for ~12% of `ptcgl_set_alias` | rely on it (§1.7.1) |
| `suffix` | rule-box hints for `V / EX / ex / GX / TAG TEAM-GX` | assume it covers Radiant, Prism Star or ACE SPEC — **[O]** it does not (§3.5) |

**Caveat on `legal.expanded`:** every non-Standard card I sampled returned `expanded: true`,
including `bw1-1` and `sm9-114`. I did **not** test a card that is outside the Expanded pool (e.g. a
Diamond & Pearl card, or a banned card), so I cannot confirm TCGdex models the Expanded ban list or
the pre-BW boundary. **Assume it does not.** Build Expanded from S1's enumerated set list + S2's ban
list, and use TCGdex's flag only as a cheap sanity check.

## 2.6 The sync job — what we fetch, how often, and what breaks

**There is no machine-readable API for any of this.** Do not invent one. The design is:

> **Vendored JSON is the authority. Scrapers only ever propose a diff for human review.**
> A scraper that can silently write a ban list is a scraper that can silently delete every deck
> the user owns.

Repo layout:
```
data/formats/
  formats.json              # format defs, regulation-mark windows, deck-construction constants
  banlist-standard.json     # {} today
  banlist-expanded.json     # 27 rows
  banlist-glc.json          # 13 rows
  glc-rules.json            # rule-box classes, exclusive groups, carve-outs
  ptcgl-set-alias.json      # PTCGL <-> TCGdex <-> TCGplayer set codes
  _provenance.json          # per-file: source URL, fetched_at, sha256 of the source
```

| # | Job | Source | Shape | Cadence | On change | On shape change |
|---|---|---|---|---|---|---|
| J1 | **Banned cards** | S2 `www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list` | HTML: `<h2>` per format, one `<p>Name (<em>Set</em>, num; …)</p>` per card. **[O] parses cleanly** | **weekly**, Monday 04:10 | write a proposed diff to `data/formats/_pending/`, raise a UI banner "ban list changed — review" | if 0 formats or 0 `<p>` rows parse, **keep the vendored file**, log an error, alert |
| J2 | **Regulation marks** | S1 handbook PDF (stable URL), §4.1.1 table, via `pdftotext -layout` | fixed-width table; `^\s*(\w+ \d+, \d{4})\s+([A-J])\s+(✔?)\s+(✔?)` | **monthly**, plus a hard reminder on **2027-01-15** | propose diff; **never auto-apply a rotation** | PDF is 731 KB and revision-stamped ("LAST REVISION: May 21, 2026") — diff the stamp first and skip if unchanged |
| J3 | **Rotation announcement** | S3 pattern `pokemon.com/us/pokemon-news/{YEAR}-pokemon-tcg-standard-format-rotation-announcement` | HTML article | **monthly Jan–Apr** | notify only | **[O] pokemon.com bot-walls aggressively.** J1/J2/J3 all need full browser headers (`User-Agent`, `Accept`, `Accept-Language`, `Sec-Fetch-*`, `Upgrade-Insecure-Requests`); a bare curl UA gets an interstitial. Detect the string `Pardon Our Interruption` and treat it as a failure, not as an empty list |
| J4 | **GLC ban list** | S7 `gymleaderchallenge.com/ban-list` | Squarespace `<li>Name (Set, num) Effective Mon. D, YYYY</li>` | **weekly** | propose diff | Squarespace redesigns break selectors; assert ≥10 rows parse or fail loudly |
| J5 | **GLC rules + FAQ** | S6, S8, S9 | prose | **quarterly**, human reads the diff | manual | — |
| J6 | **Set alias table** | `limitlesstcg.com/cards` + TCGdex `sets` (§1.7.2) | HTML table + GraphQL | **monthly** and on any import miss | append proposals only; never rewrite an existing mapping | if the join rate drops below 90%, alert |
| J7 | **Card marks / legality cross-check** | TCGdex GraphQL, one query per set | JSON | rides the existing catalogue sync ([Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §3 item 8) | store `regulationMark`; diff `legal.standard` vs our computed value and log divergences | — |

**Failure posture for every job:** last-known-good vendored file wins. A failed sync must never
change a legality answer. Record `formats.checked_at`; if it is more than 30 days stale, the deck
builder shows a subtle "legality data last verified {date}" note rather than pretending certainty.

---

# 3. Deck construction rules

Exact wording, then the implementable form, then which formats it applies to.

## 3.1 Deck size

> **[D]** S1 §4: *"The deck must contain exactly 60 cards."*
> **[D]** S5: *"your deck must be exactly 60 cards; it can't be any more or less, even 59 or 61
> cards!"*
> **[D]** S6 (GLC): *"60 card decks are built."*

`count == 60` **exactly**, all four formats. **[O]** `BEHAVIOR-SPEC.md` records pkmn.gg showing
`Not Legal` at 0/60, so size is part of the predicate, not a separate progress indicator.

*(For completeness: Limited formats are 40 cards with no copy limit and 4 prizes — **[D]** S1 §5.
We do not support Limited; pkmn.gg does not either.)*

## 3.2 The 4-copy rule — by name, across printings

> **[D]** S1 §4: *"Decks may not contain more than 4 copies of a single card, **as defined by the
> card's English language translation**, except for Basic Energy cards."*
> **[D]** S5: *"except for Basic Energy, you can only have 4 cards with the same name in your deck.
> This means you can have only 4 cards called 'Pignite' in your deck, even if they all have
> different attacks."*

Name semantics, **[D]** S5, verbatim:
- *"An owner or form name in a Pokémon's name is part of the Pokémon's name: Meowth, Alolan Meowth,
  and Rocket's Meowth have different names"* — so you may run 4 of each.
- *"δ (Delta Species) is not part of a Pokémon's name. Aerodactyl and Aerodactyl δ (Delta Species)
  have the same name"*.
- *"If your deck has 1 each of Gengar, Gengar LV.43, Gengar LV. 44, and Gengar LV.X, you can't put
  any more cards named Gengar in your deck!"* — level suffixes are **not** part of the name.

Implementable:
```
for each distinct normalized_name n where n ∉ BASIC_ENERGY_NAMES:
    require sum(qty of every deck_card whose card resolves to name n) <= 4
```
`normalized_name` = the English name, with TCGdex's parenthetical disambiguators stripped
(§1.7 step 5), δ/LV. suffixes stripped, owner/form prefixes **kept**.

**[O] Live proof this must span prints:** Example D contains
`2 Area Zero Underdepths SCR 131` + `2 Area Zero Underdepths SCR 174` = 4. A per-print counter says
"2 and 2, fine"; a per-name counter says "exactly at the cap." Add a third copy of either and the
deck is illegal.

**Why the fingerprint matters here too:** [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §3 item 4 is right that
`playable_fingerprint` is the primitive — but note the two are *not* the same key.
Name-equality is the **legal** rule; fingerprint-equality is a **stricter** relation (same name AND
same text). Use **name** for the 4-copy cap and **fingerprint** for reprint-legality propagation and
for "can I build this from what I own." Do not conflate them.

Applies to: Standard, Expanded, Unlimited. GLC replaces it with 1 (§2.3).

## 3.3 The Basic Energy exemption

> **[D]** S1 §4, S5, S6 all state it. **[D]** S8 (GLC): *"Any number of any type of Basic Energy may
> be played in your deck."*

The exemption is for **Basic** Energy only — Special Energy (Double Turbo, Jet, Reversal, Luminous,
Legacy, Mist, Neo Upper, Team Rocket's, Prism, Recycle, …) is capped at 4 like any other card.
**[O]** C1 contains **86 distinct Special Energy names**.

Detection: `card.category == 'Energy' AND card.energyType == 'Basic'` in our catalogue (TCGdex
supplies `category` and `energyType`). **Never** infer it from the decklist text:
- **[O]** 175 lines are *Special* Energy whose names also contain braces —
  `Telepathic {P} Energy`, `Rocky {F} Energy`, `Growing {G} Energy`, `Speed {L} Energy`,
  `Bubbly {W} Energy`. A `\{[A-Z]\}` test would exempt all of them from the 4-copy cap. That is the
  single most dangerous false positive in this document.
- **[O]** 259 lines write basic Energy *without* braces (`Grass Energy MEE 1`, `9 grass SVE 1`).
- `Basic Darkness Energy` and `Darkness Energy` are both real printed names across eras.

Resolve the card first, then ask the catalogue.

## 3.4 At least one Basic Pokémon

> **[D]** S5: *"Finally, your deck must have at least one Basic Pokémon in it."*

`count(cards where category == 'Pokemon' AND stage == 'Basic') >= 1`. All formats. This is the rule
that makes the mulligan (§4) possible at all, and it is the one deck-construction rule
`BEHAVIOR-SPEC.md` §8.3 omits entirely.

## 3.5 ACE SPEC

> **[D]** S5 Appendix 2, verbatim: *"Originally introduced in the Black & White Series, ACE SPEC
> cards are so powerful that you can have only one in your deck. And that doesn't mean one of
> each—it means your deck can include **only one total ACE SPEC card**."*

`count(all cards where is_ace_spec) <= 1`. **Deck-wide, not per name.**

**On "how the limit changed over time":** I looked for a change and **found none**. The rule has been
1-per-deck since Black & White (2013) and S5 describes it as continuous. What *did* change is the
card types eligible: BW/XY-era ACE SPECs were Trainers only; the Scarlet & Violet reintroduction
(Paradox Rift, Nov 2023) added ACE SPEC **Special Energy** and **Pokémon Tools**. If someone has
told you the limit changed, ask them for a source — I could not find one. **[I]**

**⚠ Data gap: TCGdex does not expose an ACE SPEC flag.** **[O]** `sv05-157 Prime Catcher` — a
well-known ACE SPEC Item — returns `suffix: null`, `trainerType: "Item"`, and there is no other
field for it. `Card` exposes: `abilities, attacks, category, description, dexId, effect, energyType,
evolveFrom, hp, id, illustrator, image, item, legal, level, localId, name, rarity, regulationMark,
resistances, retreat, set, stage, suffix, trainerType, types, variants, variants_detailed, boosters,
weaknesses` — none of them says ACE SPEC.

⇒ **We must maintain `data/formats/ace-spec.json`** — a name list, roughly 40 cards across BW/XY and
SV eras, extended once per set. Seed it by scanning `rarity` (SV-era ACE SPECs all carry the
`ACE SPEC Rare` rarity — **[I]**, worth verifying against one set before relying on it) and by
scanning `effect`/`description` text for the literal string `ACE SPEC`. Treat both as *proposals*
for the vendored list, per §2.6.

Applies to: Standard, Expanded, Unlimited (limit 1). GLC: **banned outright** (§2.3.1).

## 3.6 Radiant Pokémon

> **[D]** S5 Appendix 7, verbatim: *"All Radiant Pokémon appear with their special Shiny coloration
> and have the Radiant Pokémon Rule, which says **you can't have more than 1 Radiant Pokémon in your
> deck**. A Radiant Pokémon is considered a Pokémon with a Rule Box. Note that 'Radiant' is part of
> the Pokémon's name, so your deck could include 4 Greninja and 1 Radiant Greninja. Radiant Pokémon
> are always Basic Pokémon and do not evolve from or into any other card."*

`count(all cards where name starts with 'Radiant ') <= 1`. **Deck-wide, not per name.**

**[O]** detection is safe from the name: TCGdex returns `Radiant Heatran`, `Radiant Greninja`,
`Radiant Hawlucha` in `swsh10` with `suffix: null` — the name prefix is the only signal, and the
rulebook explicitly blesses it ("'Radiant' is part of the Pokémon's name").

Note the interaction with §3.2: `4 Greninja + 1 Radiant Greninja` is legal because the names differ.

Applies to: Standard, Expanded, Unlimited (limit 1). GLC: **banned** as a Rule Box card.

## 3.7 Prism Star

> **[D]** S5 Appendix 16, verbatim: *"Prism Star cards (denoted by a ◇ symbol) are powerful cards
> that come with a restriction: **you can only have one copy of a Prism Star card in your deck**.
> Unlike ACE SPEC cards, you can include Prism Star cards with different names in your deck, so you
> could have one Giratina ◇, one Lunala ◇, one Cyrus ◇, and one Super Boost Energy ◇ in the same
> deck. They also have a unique rule—if a Prism Star card would go to the discard pile, you put it in
> the Lost Zone instead."*

`for each distinct prism-star name: count <= 1`. **Per name — the opposite of ACE SPEC and Radiant.**
This asymmetry is stated explicitly in the source and is exactly the kind of thing that gets
implemented wrong.

**[O]** detection: TCGdex encodes Prism Star as a **`◇` character at the end of the card name**
(`Celebi ◇`, `Xerneas ◇`, `Heat Factory ◇`, `Lusamine ◇` in `sm8`), not in `suffix`. Match
`name.endswith(' ◇')` (U+25C7 WHITE DIAMOND). Prism Star cards are Sun & Moon era, so they matter
for Expanded, Unlimited and GLC-exclusion only.

Applies to: Expanded, Unlimited (1 per name). Not in Standard (era). GLC: **banned** as Rule Box.

## 3.8 Rule summary by format

| Rule | Standard | Expanded | GLC | Unlimited |
|---|---|---|---|---|
| exactly 60 cards | ✔ | ✔ | ✔ | ✔ |
| ≥1 Basic Pokémon | ✔ | ✔ | ✔ | ✔ |
| copies of a name | ≤4 | ≤4 | **≤1** | ≤4 |
| Basic Energy exempt from the copy cap | ✔ | ✔ | ✔ | ✔ |
| ACE SPEC | ≤1 deck-wide | ≤1 deck-wide | **0 — banned** | ≤1 deck-wide |
| Radiant Pokémon | ≤1 deck-wide | ≤1 deck-wide | **0 — banned** | ≤1 deck-wide |
| Prism Star | n/a (era) | ≤1 **per name** | **0 — banned** | ≤1 per name |
| card pool | reg. mark ∈ {H,I,J} + reprint rule | reg. marks D–J + enumerated BW/XY/SM sets + promos | BW-onward, minus carve-outs | everything US-released |
| ban list | empty | 27 prints | 13 entries | empty |
| rule-box Pokémon | allowed | allowed | **banned** | allowed |
| single Pokémon type | — | — | **required** | — |
| exclusive groups (Boss's/Lysandre etc.) | — | — | **✔** | — |
| prizes | 6 | 6 | 6 | 6 |

---

# 4. Test hand / sample draw — what the game rules actually require

`BEHAVIOR-SPEC.md` §8.5 could not determine pkmn.gg's mechanics and correctly declined to guess.
Here is what the **rules** require, so we can build a correct simulator regardless.

## 4.1 Setup, verbatim

**[D]** S5, "Setting Up to Play":
> 1. *"Shake hands with your opponent."*
> 2. *"Flip a coin. The winner of the coin flip decides which player goes first."*
> 3. *"Shuffle your 60-card deck and draw the top 7 cards."*
> 4. *"Check to see if you have any Basic Pokémon in your hand."*
> 5. *"Put one of your Basic Pokémon face down as your Active Pokémon."*
> 6. *"Put up to 5 more Basic Pokémon face down on your Bench."*
> 7. *"Put the top 6 cards of your deck off to the side face down as your Prize cards."*
> 8. *"Both players flip their Active and Benched Pokémon face up and start the game!"*

⇒ **Opening hand = 7. Prizes = 6, taken *after* the hand is drawn and the board is set. Bench = up
to 5, so at most 6 Basics can be placed.**

Order matters for a faithful simulator: the 7 cards come off the top **before** the 6 prizes, so
prizes are drawn from the remaining 53.

## 4.2 The mulligan, verbatim

**[D]** S5, inline: *"If you don't have any Basic Pokémon, what do you do? First, reveal your hand to
your opponent and shuffle your hand back into your deck. Then, draw 7 more cards. If you still don't
have any Basic Pokémon, repeat. Each time your opponent shuffles their hand back into their deck
because they had no Basic Pokémon, you may draw an extra card!"*

**[D]** S5, "Full details of taking a mulligan":
> *"If both players have no Basic Pokémon in their opening hands: Both players reveal their hands,
> then just start over as normal."*
>
> *"If only one player has no Basic Pokémon in their opening hand: 1) That player announces that they
> have a mulligan, then waits until the other player has finished setting up to play. 2) Then, the
> player with no Basic Pokémon reveals their hand and shuffles it back into their deck. The player
> keeps doing this until they get an opening hand with a Basic Pokémon, then proceeds as normal.
> 3) Then, the player who did not have to start over may draw a card for each extra mulligan their
> opponent took. For example, if both players took 2 mulligans, and then Player A took 3 additional
> mulligans, Player B **may** draw up to 3 cards. If any of those cards are Basic Pokémon, they may
> be put onto the Bench. 4) Then, reveal all Active and Benched Pokémon, and begin the game."*

**[D]** S1 §7.4.1 (tournament rules) adds two constraints: *"These cards may be drawn only once
Competitor A has placed an Active Pokémon, and Competitor B must announce how many cards they will
draw before doing so."* and *"The Active Pokémon must remain unchanged."*

Precise consequences for the opponent:
- the opponent draws **one card per *extra* mulligan**, i.e. `max(0, myMulligans - theirMulligans)`;
- it is **optional** ("may draw up to");
- drawn Basics may go to the Bench, but the Active Pokémon is fixed.

**[D]** S1 §7.4.2 — the tournament escape hatch after **8** mulligans: shuffle, reveal from the top
until a Basic is found, set it aside, reshuffle, draw 6, add the Basic for a 7-card hand.

## 4.3 What we should build

**[I]**, but everything below follows mechanically from §4.1–4.2:

| Element | Behaviour |
|---|---|
| Draw | uniform shuffle of the 60 `deck_card` rows expanded by quantity; take 7 |
| Mulligan detection | `hand` contains no card with `category == 'Pokemon' AND stage == 'Basic'` |
| Auto-mulligan | redraw automatically, **counting and displaying** the mulligan count — this is the number the user actually wants to know |
| Prizes | after a keepable hand, deal 6 from the remaining 53; offer a "peek prizes" toggle (a solitaire aid, not a game rule) |
| Opponent draw | show `"your opponent would draw N extra cards"` where N = mulligan count. This is the single most useful output of a test hand and no prior-art project shows it |
| Safety valve | cap auto-mulligans at 8 and then surface S1 §7.4.2's procedure, so a 1-Basic deck does not spin forever |
| Statistics | **[I] recommended divergence:** run the draw 10,000 times headlessly and report P(mulligan), P(≥1 Basic), P(specific card in opening 7), P(dead-drawing a named combo). Cheap on a Pi, and strictly better than clicking "Test Hand" 40 times. pkmn.gg does not appear to do this. |
| Determinism | seed the RNG and put the seed in the URL, per `BEHAVIOR-SPEC.md` §16 item 1 — a shareable "this hand" link |

Note the simulator needs `stage == 'Basic'`, which TCGdex provides directly, **plus** the special
cases in §2.3.4 item 7 (Robo Substitute / Unidentified Fossil / Lillie's Poké Doll are **Items**,
not Basics — they may not be placed as an Active Pokémon and do **not** prevent a mulligan).

---

# 5. Data model

Postgres. Naming follows [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art)'s guidance (real Alembic migrations, keep the FKs, no
composite string keys).

## 5.1 Format definitions

```sql
CREATE TABLE format (
  id                     SERIAL PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,      -- 'standard' | 'expanded' | 'glc' | 'unlimited'
  name                   TEXT NOT NULL,             -- 'Gym Leader Challenge'
  short_name             TEXT NOT NULL,             -- 'GLC'
  deck_size              SMALLINT NOT NULL DEFAULT 60,
  max_copies_per_name    SMALLINT NOT NULL DEFAULT 4,   -- 1 for GLC
  basic_energy_exempt    BOOLEAN  NOT NULL DEFAULT TRUE,
  max_ace_spec           SMALLINT,                  -- 1; 0 for GLC
  max_radiant            SMALLINT,                  -- 1; 0 for GLC
  max_prism_star_per_name SMALLINT,                 -- 1; 0 for GLC
  require_basic_pokemon  BOOLEAN  NOT NULL DEFAULT TRUE,
  require_single_type    BOOLEAN  NOT NULL DEFAULT FALSE, -- GLC only
  forbid_rule_box        BOOLEAN  NOT NULL DEFAULT FALSE, -- GLC only
  prize_count            SMALLINT NOT NULL DEFAULT 6,
  pool_strategy          TEXT NOT NULL,             -- 'regulation_mark' | 'set_allowance' | 'all'
  sort_order             SMALLINT NOT NULL,
  is_active              BOOLEAN  NOT NULL DEFAULT TRUE,
  source_url             TEXT,
  data_checked_at        TIMESTAMPTZ NOT NULL
);
```
Every column above is a *knob* rather than a branch in code. `BEHAVIOR-SPEC.md` §8.3's warning —
"do not hard-code a regulation-mark letter list in the UI layer" — generalises: do not hard-code any
of these.

## 5.2 Regulation marks and set allowances

```sql
CREATE TABLE format_regulation_mark (
  format_id   INT  NOT NULL REFERENCES format(id) ON DELETE CASCADE,
  mark        CHAR(1) NOT NULL,       -- 'D' .. 'J'
  legal_from  DATE NOT NULL,          -- S1 'Legality Date'
  legal_until DATE,                   -- NULL = still legal; set on rotation
  PRIMARY KEY (format_id, mark)
);

-- Expanded's enumerated pre-mark sets, and GLC's carve-outs.
CREATE TABLE format_set_allowance (
  format_id   INT  NOT NULL REFERENCES format(id) ON DELETE CASCADE,
  set_id      TEXT NOT NULL REFERENCES card_set(id),
  mode        TEXT NOT NULL DEFAULT 'allow',   -- 'allow' | 'deny'
  legal_from  DATE,
  legal_until DATE,
  note        TEXT,                            -- 'Celebrations CC: only Reshiram & Zekrom'
  PRIMARY KEY (format_id, set_id)
);

-- 'Black Star Promo prefix BW 01+' style rules.
CREATE TABLE format_promo_allowance (
  format_id   INT  NOT NULL REFERENCES format(id) ON DELETE CASCADE,
  set_id      TEXT NOT NULL REFERENCES card_set(id),
  number_prefix TEXT NOT NULL,   -- 'SM'
  min_number  INT  NOT NULL,     -- 158
  PRIMARY KEY (format_id, set_id, number_prefix)
);
```

## 5.3 Ban lists and exclusive groups

```sql
CREATE TABLE format_ban (
  id           SERIAL PRIMARY KEY,
  format_id    INT  NOT NULL REFERENCES format(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL,        -- 'print' | 'name'  <-- BOTH exist; see 2.2 / 2.3.5
  card_name    TEXT NOT NULL,        -- normalised English name
  set_id       TEXT REFERENCES card_set(id),   -- NULL when scope='name'
  local_ids    TEXT[],               -- {'083','185','186'}; NULL = whole set
  banned_from  DATE NOT NULL,
  lifted_on    DATE,
  source_url   TEXT NOT NULL,
  source_text  TEXT NOT NULL,        -- the verbatim line, for the UI tooltip
  UNIQUE (format_id, card_name, set_id, banned_from)
);

-- GLC: 'one of Boss's Orders OR Lysandre', 'one of Professor's Research OR Sycamore OR Juniper'
CREATE TABLE format_exclusive_group (
  id         SERIAL PRIMARY KEY,
  format_id  INT NOT NULL REFERENCES format(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  max_total  SMALLINT NOT NULL DEFAULT 1,
  source_url TEXT NOT NULL
);
CREATE TABLE format_exclusive_group_member (
  group_id  INT  NOT NULL REFERENCES format_exclusive_group(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  PRIMARY KEY (group_id, card_name)
);
```

## 5.4 Cards, prints, set aliases

Assumes the card/variant model from `BEHAVIOR-SPEC.md` §1 and [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §1. Additions:

```sql
ALTER TABLE card ADD COLUMN regulation_mark      CHAR(1);
ALTER TABLE card ADD COLUMN playable_fingerprint CHAR(64);   -- PRIOR-ART §3 item 4
ALTER TABLE card ADD COLUMN normalized_name      TEXT NOT NULL; -- disambiguators stripped (§1.7)
ALTER TABLE card ADD COLUMN is_ace_spec          BOOLEAN NOT NULL DEFAULT FALSE; -- vendored, §3.5
ALTER TABLE card ADD COLUMN is_radiant           BOOLEAN GENERATED ALWAYS AS (name LIKE 'Radiant %') STORED;
ALTER TABLE card ADD COLUMN is_prism_star        BOOLEAN GENERATED ALWAYS AS (name LIKE '% ◇')      STORED;
ALTER TABLE card ADD COLUMN rule_box_kind        TEXT;  -- NULL|'V'|'VMAX'|'VSTAR'|'V-UNION'|'EX'|'ex'|'GX'|'TAG TEAM-GX'|'BREAK'|'RADIANT'|'PRISM'|'ACE_SPEC'
CREATE INDEX ON card (normalized_name);
CREATE INDEX ON card (playable_fingerprint);
CREATE INDEX ON card (regulation_mark);

CREATE TABLE ptcgl_set_alias (
  ptcgl_code       TEXT PRIMARY KEY,       -- 'SVI', 'CRZ-GG', 'PR-SV', 'SWSHALT', 'Energy'
  tcgdex_set_id    TEXT REFERENCES card_set(id),   -- NULL for unmappable pseudo-sets
  tcgplayer_abbrev TEXT,                   -- for Mass Entry (§1.9)
  kind             TEXT NOT NULL,          -- 'main'|'subset'|'promo'|'energy'|'alt'|'unmapped'
  number_offset    INT NOT NULL DEFAULT 0, -- SHF SV001 -> 74 etc. (§1.7.2)
  confidence       TEXT NOT NULL,          -- 'curated'|'auto_name'|'auto_datecount'
  source           TEXT NOT NULL,
  verified_at      DATE
);

-- PTCGL-only prints with no printed equivalent: (SWSHALT, 127) -> BRS 132
CREATE TABLE ptcgl_alt_print (
  ptcgl_code  TEXT NOT NULL,
  ptcgl_number TEXT NOT NULL,
  card_id     TEXT NOT NULL REFERENCES card(id),
  note        TEXT,
  PRIMARY KEY (ptcgl_code, ptcgl_number)
);
```

## 5.5 Deck and deck_card

```sql
CREATE TABLE deck (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  format_id     INT NOT NULL REFERENCES format(id),
  glc_type      TEXT,                    -- 'Water' | ... | 'Fairy'; NULL unless GLC
  cover_card_id TEXT REFERENCES card(id),
  cover_mode    TEXT NOT NULL DEFAULT 'full', -- 'full' | 'art'   (BEHAVIOR-SPEC §8.7)
  is_favorite   BOOLEAN NOT NULL DEFAULT FALSE,
  notes         TEXT,
  import_source TEXT,                    -- 'ptcgl' | 'massentry' | 'manual'
  import_raw    TEXT,                    -- the pasted text, verbatim, for lossless re-export
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deck_card (
  id            BIGSERIAL PRIMARY KEY,
  deck_id       INT NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  card_id       TEXT REFERENCES card(id),      -- NULL when unresolved
  variant_id    INT  REFERENCES card_variant(id),  -- print/foil; NULL = any
  quantity      SMALLINT NOT NULL CHECK (quantity > 0),
  section       TEXT NOT NULL,                 -- 'pokemon'|'trainer'|'energy' (derived, not trusted from input)
  sort_index    INT NOT NULL,
  -- interchange provenance, so import -> export is byte-stable
  src_set_code  TEXT,     -- 'SVI'
  src_number    TEXT,     -- '181'
  src_print     TEXT,     -- 'PH'
  src_name      TEXT,     -- raw name as written (may be non-English)
  resolution    TEXT NOT NULL DEFAULT 'exact', -- 'exact'|'name_in_set'|'name_only'|'alt_table'|'unresolved'
  UNIQUE (deck_id, card_id, variant_id, src_print)
);
CREATE INDEX ON deck_card (deck_id);
```

Two decisions worth calling out:

1. **`variant_id` is nullable and usually NULL.** Deck legality is variant-agnostic
   (`BEHAVIOR-SPEC.md` §8.6 item 5 reaches the same conclusion for pricing). We keep `src_print` so
   a `PH` round-trips, and `variant_id` only when the user deliberately pins a print — e.g. because
   that is the one they own.
2. **`import_raw` is kept forever.** It is a few hundred bytes and it is the only way to be honest
   when a later catalogue sync changes how a line resolves.

## 5.6 The validation result — rich enough for a clickable `Not Legal`

`BEHAVIOR-SPEC.md` §8.4: *"If your deck is displaying Not Legal for your selected format, you can
click on the orange `Not Legal` information text to view why your deck isn't in legal status."*
⇒ the validator must return **every** failing rule, with enough structure to highlight the offending
cards in place (§8.4 item 4: rotated-out cards are *highlighted in the deck list*).

Not a table — a computed value, cached in `deck_validation (deck_id PK, format_id, computed_at,
catalogue_version, result JSONB)` and invalidated on deck edit, format change, or a formats-data
sync.

```jsonc
{
  "format": "standard",
  "format_data_checked_at": "2026-07-24",
  "catalogue_version": "2026-07-24T03:11:00Z",
  "computed_at": "2026-07-24T18:02:11Z",
  "legal": false,
  "counts": { "total": 58, "pokemon": 15, "trainer": 35, "energy": 8,
              "distinct_names": 27, "unresolved": 1 },
  "violations": [
    {
      "code": "DECK_SIZE",
      "severity": "error",
      "rule": "A deck must contain exactly 60 cards.",
      "rule_source": "Play! Pokémon TCG Tournament Handbook §4",
      "rule_url": "https://www.pokemon.com/static-assets/.../play-pokemon-tcg-tournament-handbook-en.pdf",
      "message": "58 / 60 cards. Add 2.",
      "scope": "deck",
      "deck_card_ids": [],
      "card_ids": [],
      "delta": -2,
      "fixable": false
    },
    {
      "code": "COPY_LIMIT",
      "severity": "error",
      "rule": "No more than 4 copies of a card with the same name (Basic Energy exempt).",
      "message": "5 copies of \"Nest Ball\" across 2 printings.",
      "scope": "name",
      "subject": "Nest Ball",
      "deck_card_ids": [4412, 4419],
      "card_ids": ["sv01-181", "sv04.5-084"],
      "observed": 5, "allowed": 4,
      "fixable": true, "fix": { "action": "reduce", "to": 4 }
    },
    {
      "code": "NOT_IN_FORMAT",
      "severity": "error",
      "rule": "Standard is limited to regulation marks H, I and J.",
      "message": "Battle VIP Pass (FST 225) has regulation mark E and has no legal reprint.",
      "scope": "card",
      "deck_card_ids": [4431],
      "card_ids": ["swsh8-225"],
      "detail": { "regulation_mark": "E", "legal_marks": ["H","I","J"],
                  "reprint_checked": true, "fingerprint": "8d1c…" },
      "fixable": false
    },
    {
      "code": "BANNED",
      "severity": "error",
      "rule": "Banned in this format.",
      "message": "Medicham V (Sword & Shield—Evolving Skies, 083/203) is banned in Expanded as of 2026-04-10.",
      "scope": "card",
      "deck_card_ids": [], "card_ids": ["swsh7-083"],
      "detail": { "banned_from": "2026-04-10",
                  "source_url": "https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list" }
    },
    {
      "code": "UNRESOLVED_CARD",
      "severity": "warning",
      "rule": "Every card must resolve to a catalogue entry.",
      "message": "\"1 Snorlax SWSHALT 107\" — SWSHALT is a PTCG Live-only set code with no printed equivalent.",
      "scope": "deck_card",
      "deck_card_ids": [4440],
      "detail": { "src_set_code": "SWSHALT", "src_number": "107",
                  "suggestions": [{ "card_id": "swsh6-131", "confidence": 0.6 }] }
    }
  ],
  "warnings": [
    { "code": "TOTAL_MISMATCH", "message": "Imported file said 'Total Cards: 60' but 58 lines were parsed." },
    { "code": "STALE_FORMAT_DATA", "message": "Format legality data last verified 2026-07-24." }
  ]
}
```

**Violation code enumeration** (one per rule in §3 and §2 — the UI renders these in this order):

| code | severity | scope | formats |
|---|---|---|---|
| `DECK_SIZE` | error | deck | all |
| `NO_BASIC_POKEMON` | error | deck | all |
| `COPY_LIMIT` | error | name | Standard/Expanded/Unlimited |
| `SINGLETON` | error | name | GLC |
| `ACE_SPEC_LIMIT` | error | deck | Standard/Expanded/Unlimited |
| `ACE_SPEC_FORBIDDEN` | error | card | GLC |
| `RADIANT_LIMIT` | error | deck | Standard/Expanded/Unlimited |
| `PRISM_STAR_LIMIT` | error | name | Expanded/Unlimited |
| `RULE_BOX_FORBIDDEN` | error | card | GLC |
| `NOT_IN_FORMAT` | error | card | Standard/Expanded/GLC |
| `BANNED` | error | card | Standard/Expanded/GLC |
| `TYPE_MISMATCH` | error | card | GLC |
| `EXCLUSIVE_GROUP` | error | group | GLC |
| `NOT_TOURNAMENT_LEGAL` | error | card | GLC |
| `UNRESOLVED_CARD` | warning | deck_card | all |
| `TOTAL_MISMATCH` | warning | deck | all (import only) |
| `STALE_FORMAT_DATA` | warning | deck | all |

Rules for the validator implementation:
- **Always evaluate all rules.** No short-circuit. `BEHAVIOR-SPEC.md` §8.4 requires the disclosure to
  list *why*, plural.
- `legal == (no violation with severity 'error')`. Warnings never make a deck illegal.
- `deck_card_ids` and `card_ids` exist so the deck list can highlight in place rather than deleting —
  **[D]** `BEHAVIOR-SPEC.md` §8.4 item 4.
- The copy cap is the one rule pkmn.gg *prevents* rather than reports (**[D]** A16, "we'll
  automatically ensure you don't go over max"). Keep `COPY_LIMIT` in the validator anyway — imports
  and rotation-driven reprint changes can produce an over-cap deck that the UI never let you build.
- `rule_source` / `rule_url` on every violation is what makes the disclosure trustworthy instead of
  merely red.

## 5.7 Collection join — the differentiator

[Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §5(b): joining a decklist to the owned collection is *"the single largest genuine
differentiator available."* The shape it needs:

```sql
-- "can I build this deck?" — one row per deck_card
SELECT dc.id, dc.quantity,
       COALESCE(SUM(ci.quantity), 0) AS owned_any_print
FROM   deck_card dc
JOIN   card c        ON c.id = dc.card_id
LEFT   JOIN card c2  ON c2.playable_fingerprint = c.playable_fingerprint
LEFT   JOIN collection_item ci ON ci.card_id = c2.id
WHERE  dc.deck_id = :deck
GROUP  BY dc.id, dc.quantity;
```
`playable_fingerprint` — not `card_id`, not `normalized_name` — is the right join key here, because
"I own a different printing of this exact card" satisfies the slot, while "I own a different card
with the same name but different text" does not.

---

# 6. Build order

1. `ptcgl_set_alias` seeded by the §1.7.2 join (one afternoon; 96.8% coverage before any hand work).
2. PTCGL importer with the §1.2 right-to-left parser + the §1.7 five-step resolution ladder.
   **Fixture-drive it**: the four examples in §1.4 plus one file per row of §1.5's table.
3. `format` + `format_regulation_mark` + `format_ban`, vendored from §2's tables.
4. `playable_fingerprint` (port from pokecollector, AGPL-aware — [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) §3 item 4) and
   `standard_legal_fingerprints` / `expanded_legal_fingerprints` materialisation.
5. Validator returning the §5.6 shape, all rules, no short-circuit.
6. GLC: rule-box classification + type coherence + exclusive groups.
7. Exporter (§1.8) and Mass Entry formatter (§1.9).
8. Test hand (§4).
9. The sync jobs (§2.6) — last, because until then the vendored JSON is simply correct.

---

# 7. What I could NOT verify

Ranked by how much it hurts if I am wrong.

| # | Unknown | Impact | What would settle it |
|---|---|---|---|
| 1 | **The ` PH` suffix's official meaning.** 3,018 occurrences [O], always trailing, always alongside a valid set+number, and the same card appears with and without it on separate lines. Universally read as "parallel holo" (reverse holo). **No official or semi-official documentation of the token exists** — not in S10, not in any parser I read. | Low — we preserve it opaquely and ignore it for legality | One PTCG Live export of a deck with a known reverse-holo card |
| 2 | **Whether PTCGL puts CRLF on the clipboard.** C1 is git-normalised (0/4,840 CRLF); C3's MIT formatter emits CRLF deliberately. | Low — accept both, emit `\n` | One clipboard paste inspected with `cat -A` |
| 3 | **The header-count attribution.** I am confident (0/1,033 PH-bearing files use sum-of-copies) but I proved it by *fingerprint*, not by watching PTCGL export. If some third tool also emits `PH`, the attribution weakens. | Low — headers are advisory either way | One PTCGL export |
| 4 | **`SVOM`, `SVOD`, `MBD`, `MBG`, `MC`, `MCRI`, `SRC`, `TG` set codes.** 34 lines in C1; I could not identify the products | Very low | Manual lookup as they appear |
| 5 | **Whether TCGdex models the Expanded ban list or the pre-BW boundary.** Every non-Standard card I sampled returned `expanded: true`, including `bw1-1`. I did not test a pre-BW card or a banned card | Medium — but mitigated: we build Expanded from S1+S2 and never trust the flag | 2 more GraphQL queries (`dp1-*`, `xy5-133`) |
| 6 | **Rotation effective dates before 2026.** pokemon.com's bot wall began returning the "Pardon Our Interruption" interstitial partway through this session, so I could not re-fetch the 2023/2024/2025 announcements. Floors (D/E/F/G) come from Bulbapedia and are consistent with S1's table | Very low — we only evaluate legality as of today | Re-fetch with browser headers, or the Wayback Machine |
| 7 | **The ACE SPEC card list.** No field in TCGdex; my proposed seed (`rarity == 'ACE SPEC Rare'` + `effect` text scan) is **[I]** and untested | **High** — a missing ACE SPEC flag means we approve illegal decks | Query one SV-era set's `rarity` values and eyeball |
| 8 | **Whether a newer official rulebook than March 2025 exists.** `{meg,mep,mbd,por,mbg,blk,wht,dri}_rulebook_en.pdf` all return 200, but they are 40 MB each and I did not download another. The Mega Evolution era may have added deck-construction rules I have not captured | Medium | Download `por_rulebook_en.pdf`, diff its "Deck Building" section and appendix list against S5 |
| 9 | **`rule_box_kind` completeness.** TCGdex's `suffix` gave me `V, EX, ex, GX, TAG TEAM-GX, SP` across the sets I sampled; I never saw `VMAX`, `VSTAR` or `BREAK` as suffix values — in `swsh10` all 57 rule-box Pokémon came back as `suffix: 'V'` | Medium for GLC only | One query over a VMAX/VSTAR-heavy set checking `suffix` vs `name` |
| 10 | **GLC's "cards that say 'cannot be used in official tournaments'"** (Zacian Lv.X, Dragapult Prime, Imakuni?'s Doduo). No field marks these | Low — tiny card pool, hand-list it | Manual |
| 11 | **Spanish / Italian PTCGL section labels.** Not in my sample | Very low — §1.6's positional fallback handles it | One export in each language |
| 12 | **pkmn.gg's own Test Hand mechanics.** Still unknown (`BEHAVIOR-SPEC.md` §15 item 11). §4 specifies what the *rules* require, which is what we should build regardless | None — this is a deliberate divergence | An authenticated session |

**Cleanup:** the two clones used for this research
(`ptcgl-decklist-parser`, `codes4tcg-decks`) lived in the session scratchpad and have been removed.
Nothing was written outside this file.
