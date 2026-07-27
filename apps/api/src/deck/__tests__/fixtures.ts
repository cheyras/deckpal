/**
 * Real PTCG Live decklist fixtures, verbatim from DECK-FORMATS §1.4 (which sourced
 * them from public decklist corpora, quoted as format evidence — see the §0.2 note
 * on licensing; nothing is vendored, these are format samples). Plus hand-built
 * CardFacts for the deterministic validation cases.
 */
import type { CardFacts, PokemonType } from '../types.js';

// Example A — modern Standard, stated PTCGL `Export Deck` output. PH markers, SVALT, dup-by-PH.
export const EXAMPLE_A = `Pokémon: 14
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
`;

// Example B — deck-code redemption with an ALT code and a sub-set code (CRZ-GG, SWSHALT).
export const EXAMPLE_B = `Pokémon: 10
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
`;

// Example C — Expanded-legal list with three promo prefixes (PR-SM, PR-SW), no trailer.
export const EXAMPLE_C = `Pokémon: 6
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
`;

// ── Hand-built CardFacts helpers for deterministic validation cases ────────────

let synthId = 1;
export function mkCard(p: Partial<CardFacts> & { name: string; category: CardFacts['category'] }): CardFacts {
  const name = p.name;
  return {
    id: p.id ?? synthId++,
    tcgdexId: p.tcgdexId ?? `synth-${name}`,
    setTcgdexId: p.setTcgdexId ?? 'sv09',
    localId: p.localId ?? '1',
    localIdNumeric: p.localIdNumeric ?? 1,
    name,
    normalizedName: p.normalizedName ?? name.toLowerCase().replace(/’/g, "'"),
    category: p.category,
    stage: p.stage ?? (p.category === 'Pokemon' ? 'Basic' : null),
    suffix: p.suffix ?? null,
    trainerType: p.trainerType ?? (p.category === 'Trainer' ? 'Item' : null),
    energyType: p.energyType ?? (p.category === 'Energy' ? 'Normal' : null),
    hp: p.hp ?? (p.category === 'Pokemon' ? 60 : null),
    retreat: p.retreat ?? null,
    regulationMark: p.regulationMark ?? null,
    evolveFrom: p.evolveFrom ?? null,
    types: (p.types ?? []) as PokemonType[],
    releasedOn: p.releasedOn ?? '2025-03-28',
  };
}
