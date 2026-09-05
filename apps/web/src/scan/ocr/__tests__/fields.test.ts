// Run: node --import tsx --test src/scan/ocr/__tests__/*.test.ts
//
// THE FIELD EXTRACTOR, AGAINST REAL RECOGNISER OUTPUT.
//
// Every `name`/`strip` array below is verbatim from
// `roadmap/plans/card-scanner-redesign/p2-work/ocr/bakeoff/results.json` — what
// the recogniser actually returned for one crop, one config, one resolution, in
// the run REPORT.md's tables are computed from. Nothing here is invented text,
// which is the point: an extractor tested against text a human imagined an OCR
// engine might produce is tested against a much politer engine than the real
// one. `DRIN`, `ODRIO`, `EvolvesfromTeamRocket'sPupitar`, `Item TRAINER` and
// `116/182 neversecretepo` are all things this pipeline has really seen.
//
// `truth` is the card the crop is of (from `manifest.json`, resolved live from
// TCGdex when the bakeoff ran). `want` is what the extractor must return. They
// are SEPARATE COLUMNS ON PURPOSE: where they differ, the difference is the
// measured behaviour of the pipeline and the comment on the case says which
// kind of difference it is. A test that only asserted `want === truth` could
// only ever contain the 76 % of cases that work.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  cleanNameLine,
  eliminatedByDenominator,
  extractFields,
  levenshtein,
  normaliseBadge,
  resolveSetCode,
} from '../fields'
import { PRINTED_SETS } from '../codes'

interface Case {
  id: string
  truth: { name: string; number: string; denominator: string | null; setCode: string | null }
  name: string[]
  strip: string[]
  want: { name: string | null; number: string | null; denominator: string | null; setCode: string | null }
}

/**
 * 32 recorded reads. The first 21 are the SHIPPED recipe (`paddle-roi-3x`) on
 * every native 480×670 crop that exists — REPORT.md §0 establishes those 21 are
 * the entire population of real rectified crops, not a sample of it. The other
 * 11 are deliberately chosen failure shapes: the engine that lost, the config
 * that was rejected, and the resolution §2.1 calls hazardous.
 */
const CASES: Case[] = [
  {
    id: "paddle-roi-3x 480x670 m01_t18s_A3b-100",
    truth: { name: "Misty's Gyarados", number: "049", denominator: "182", setCode: "DRI" },
    name: ["STAGET 180", "Misty's Gyarados HP"],
    strip: ["4x2 resistance", "GOSSAN Onceitappears,itg", "enrageduntilitdem", "DR049/182★", "02035Aoke"],
    want: { name: "Misty's Gyarados", number: "049", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m02_t35s_A2-012",
    truth: { name: "Buizel", number: "057", denominator: "182", setCode: "DRI" },
    name: ["鸡"],
    strip: ["线057/182"],
    want: { name: null, number: "057", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 480x670 m03_t43s_B2-225",
    truth: { name: "Snover", number: "059", denominator: "182", setCode: "DRI" },
    name: ["BASIC", "Snover 90"],
    strip: ["miyp fomokoruKomfro", "R059/182", "62925o"],
    want: { name: "Snover", number: "059", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 480x670 m04_t50s_ex8-90",
    truth: { name: "Abomasnow", number: "060", denominator: "182", setCode: "DRI" },
    name: ["LLAU"],
    strip: ["Nlus.kamonabe", "DRIE060/182", "02025Pokemon/Nintendo/Creatures"],
    want: { name: "LLAU", number: "060", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m06_t67s_sv04.5-162",
    truth: { name: "Barraskewda", number: "063", denominator: "182", setCode: "DRI" },
    name: ["Barraskewda H130"],
    strip: ["口063/182"],
    want: { name: "Barraskewda", number: "063", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 480x670 m07_t81s_A4-064",
    truth: { name: "Steven's Carbink", number: "086", denominator: "182", setCode: "DRI" },
    name: [],
    strip: ["×2", "DRIEN 086/182"],
    want: { name: null, number: "086", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m08_t92s_swsh2-77",
    truth: { name: "Team Rocket's Orbeetle", number: "089", denominator: "182", setCode: "DRI" },
    name: ["STAGE2", "Team Rocket's Orbeetle HP 130", "Evolvesfrom Team Rocket'sDottler"],
    strip: ["Itemitspsych", "lus.Shin Nagasowg what'sarou", "DRIEN089/182 inc", "02825Pekemon/Nintendo/Creatures/"],
    want: { name: "Team Rocket's Orbeetle", number: "089", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m11_t118s_A2-028",
    truth: { name: "Team Rocket's Tyranitar", number: "096", denominator: "182", setCode: "DRI" },
    name: ["STAGC2 Tyranitar 180", "Team Rocket's HP", "EvolvesfromTeamRocket'sPupitar"],
    strip: ["llu.Ryuta Fuse", "DRI096/182★", "020251"],
    want: { name: "Team Rocket's", number: "096", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m12_t131s_bw11-RC21",
    truth: { name: "Cynthia's Gabite", number: "103", denominator: "182", setCode: "DRI" },
    name: ["STAGE1 100", "Cynthia's Gabite HP", "Evolvesfrom Cynthia'sGible"],
    strip: ["weaknessx2 resistance", "Inrare cas", "Nus.Teiro Abiu Medicine conta", "DRIEN 103/182 willmake", "02oz5Pcadmon/Nintenda/Creaturei/"],
    want: { name: "Cynthia's Gabite", number: "103", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m13_t157s_bw4-35",
    truth: { name: "Team Rocket's Nidorina", number: "115", denominator: "182", setCode: "DRI" },
    name: ["STAGET", "Team Rocket's Nidorina 90", "HP", "Evolves from Team Rocket'sNidoran"],
    strip: ["×2 resistance", "weakness", "Ifthegro", "will", "illus.Toigo Kosei", "DRIEN 115/182", "0205Pokemon/Nintendo/ Creature"],
    want: { name: "Team Rocket's Nidorina", number: "115", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m14_t172s_ex13-34",
    truth: { name: "Team Rocket's Nidoqueen", number: "116", denominator: "182", setCode: "DRI" },
    name: ["STAGE2", "Team Rocket's Nidoqueen HP 170", "Evolvesfrom Team Rocket'sNidorina"],
    strip: ["weakness ×2 resistance", "Mlus.hncl Itpacifiesoffsprin", "DRIEN between the spin", "116/182 neversecretepo", "0z025Pokbmon/Ninitende/Creuture/GA"],
    want: { name: "Team Rocket's Nidoqueen", number: "116", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 480x670 m15_t181s_swsh11-078",
    truth: { name: "Team Rocket's Koffing", number: "125", denominator: "182", setCode: "DRI" },
    name: ["Team Rocket's Koffing H70"],
    strip: ["eakneux2 resistance", "toviegasishekd", "a125/182 bodh soit"],
    want: { name: "Team Rocket's Koffing", number: "125", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 480x670 m16_t188s_swsh7-80",
    truth: { name: "Team Rocket's Murkrow", number: "127", denominator: "182", setCode: "DRI" },
    name: ["Team Rockets Murkrow 80"],
    strip: ["x2 resistance -30", "Fearedandloathedb", "misfortunet", "127/182"],
    want: { name: "Team Rockets Murkrow", number: "127", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 480x670 m17_t203s_neo4-106",
    truth: { name: "Team Rocket's Murkrow", number: "127", denominator: "182", setCode: "DRI" },
    name: ["BASIC", "Team Rocket's Murkrow HP80"],
    strip: ["weakness x2 resistance -30", "livn.Mugf Homedo Fearedandloathed", "misfortune", "DRIE127/182", "TNE"],
    want: { name: "Team Rocket's Murkrow", number: "127", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m18_t229s_dpp-DP55",
    truth: { name: "Steven's Metang", number: "144", denominator: "182", setCode: "DRI" },
    name: ["Steven's Metang", "HP 100", "beenBelduo"],
    strip: ["us.Anesaki Dynamic ftisformedbytwoBeld", "DRIN144/182 brainsare linked,a", "O2o2sPokdrhan/Nintendo/Creature/GAM"],
    want: { name: "Steven's Metang", number: "144", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m20_t235s_sv03-009",
    truth: { name: "Team Rocket's Porygon", number: "153", denominator: "182", setCode: "DRI" },
    name: ["BASIC Team Rocket's Porygon NP60"],
    strip: ["weaknessx2 resistance", "itisanartif", "Bus.Oswaldo KATO", "breathe,ped", "DRIE 153/182 to"],
    want: { name: "Team Rocket's Porygon", number: "153", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m21_t250s_sv03.5-017",
    truth: { name: "Arven's Sandwich", number: "161", denominator: "182", setCode: "DRI" },
    name: ["ltem TRAINER", "Arven's Sandwich"],
    strip: ["You mayplay any nun", "U.AYUMI ODASHIMA your turn.", "DRIEN 161/182", "C2oz5Pekemson/Nintendo/ Oreatures/G"],
    want: { name: "Arven's Sandwich", number: "161", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m22_t262s_hgss3-30",
    truth: { name: "Cynthia's Power Weight", number: "162", denominator: "182", setCode: "DRI" },
    name: ["Pokemon Tool TRAINER", "Cynthia's Power Weight"],
    strip: ["You may attach any numb", "Pokemon during yourt", "lllus. Studio Bora Inc.", "Pokemon Tool to each Po", "DRIEN 162/182", "Ozoz5Pokemen/Nintendo/Creatures/GAl"],
    want: { name: "Cynthia's Power Weight", number: "162", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m23_t334s_swsh8-216",
    truth: { name: "Spikemuth Gym", number: "169", denominator: "182", setCode: "DRI" },
    name: ["TRAINER", "Spikemuth Gym"],
    strip: ["Hun.AYUMU ODASHIAU", "ODRIO 169/182"],
    want: { name: "Spikemuth Gym", number: "169", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m24_t346s_swsh9-147",
    truth: { name: "Team Rocket's Giovanni", number: "174", denominator: "182", setCode: "DRI" },
    name: ["Supporter TRAINER", "Team Rocket's Giovanni"],
    strip: ["u.ckogi You may play only", "your turn.", "ODRIN 174/182", "o2o25Pokemon/Nintendo/Creatuaret/GA"],
    want: { name: "Team Rocket's Giovanni", number: "174", denominator: "182", setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 480x670 m25_t359s_sv01-170",
    truth: { name: "Team Rocket's Great Ball", number: "175", denominator: "182", setCode: "DRI" },
    name: ["Item TRAINER", "Team Rocket's Great Ball"],
    strip: ["You may play any nt", "your turn.", "175/182"],
    want: { name: "Team Rocket's Great Ball", number: "175", denominator: "182", setCode: null },
  },

  // ── THE ENGINE THAT LOST (REPORT.md §7) ───────────────────────────────────
  // Tesseract.js, given the same crops, the same ROIs and the same 3× upscale.
  // These are here because the extractor's job is not only to read a good
  // recognition — it is to not INVENT a field out of a bad one, and Tesseract is
  // the only source of genuinely bad recognitions this project has recorded.
  {
    id: "tess-roi 480x670 m01_t18s_A3b-100",
    truth: { name: "Misty's Gyarados", number: "049", denominator: "182", setCode: "DRI" },
    name: ["#5 wiys Gyarados 180 @"],
    strip: ["1              La ROE ied is GOSSAN HERS Ep    ©2073 Pokemon ! B                 Z  a   8 AEC"],
    want: { name: "5 wiys Gyarados 180 @", number: null, denominator: null, setCode: null },
  },
  {
    id: "tess-roi 480x670 m02_t35s_A2-012",
    truth: { name: "Buizel", number: "057", denominator: "182", setCode: "DRI" },
    name: ["A 1                                   2 _-"],
    strip: ["pr               PP   Ra    - 0 wap                      ; fi      GUESS Vindmns | Worandn, | sammom | wh"],
    // A FALSE ACCEPT, PINNED DELIBERATELY. Nothing legible was read, no number
    // and so no denominator, and a window of the noise landed within edit
    // distance 1 of `SVI`. With no denominator there is nothing to cross-check
    // against — REPORT.md §4.2's rules 3 and 4 are both conditioned on having
    // read one — so this is the shape of hole that remains after every gate.
    //
    // It is not closed by inference, on purpose, and the API's own resolver
    // marks the same decision (`printedSetCode.ts`: the converse rule "no
    // denominator was read, so eliminate every set that prints one" is
    // explicitly NOT applied). Promos and energy print a code with no
    // denominator (CROSSWALK §3.2/§3.3), so that rule would throw away correct
    // reads to fix a case only the losing engine produces. What actually
    // contains it is downstream: rung 1 of the ladder is badge AND number, so a
    // badge with no number resolves nothing.
    want: { name: null, number: null, denominator: null, setCode: "SVI" },
  },
  {
    id: "tess-roi 480x670 m20_t235s_sv03-009",
    truth: { name: "Team Rocket's Porygon", number: "153", denominator: "182", setCode: "DRI" },
    name: ["< WN 3 = t       -                            ket Ss          I     :         |                               0               NP      0          )"],
    strip: ["weakness @ x 2 | resistance               4 tisanarun  Ee. Ov       KARO,                        breathe, peo VE 153/182 @                         0 QI Pehbemon | Mstende | Castres | &"],
    // THE ONE PAIR THE DENOMINATOR CANNOT SEPARATE. `DRI` and `PAR` both print
    // `/182` (CROSSWALK §2.5), so the cross-check that resolves 18 of the 19
    // confusable code pairs has nothing to say about this one, and a window of
    // `KARO,` reaches `PAR` before anything reaches `DRI`. The truth is `DRI`.
    //
    // Pinned rather than fixed. §4.1's measurement is "18 of 19", not 19 of 19,
    // and this is the nineteenth — no post-processing rule available to this
    // module can distinguish them, because the printed evidence genuinely does
    // not. The narrowing that follows is what absorbs it: rung 1 hands the API a
    // set plus a number, and a wrong set with a right number produces a
    // candidate the phash priors do not corroborate.
    want: { name: "WN 3 t - ket Ss I : 0 NP 0", number: "153", denominator: "182", setCode: "PAR" },
  },
  {
    id: "tess-roi 480x670 m14_t172s_ex13-34",
    truth: { name: "Team Rocket's Nidoqueen", number: "116", denominator: "182", setCode: "DRI" },
    name: ["\\ ~~, Team Rockets Nidoqueen   w 170 OF (¢f / 4 /   4 / y     -          X    ww!"],
    strip: ["weakness ©) % 2 | resistance         — EE ———— I  1a 1  s  1st  r Ws. hncl                Ij  hes ofisprin Detween the spin 0 Dilia  116/182 *          neversecrete poi er 3        OI0IS Pohtmon I Nintendo / Creatures | GAY"],
    want: { name: "Team Rockets Nidoqueen w 170 OF f 4 4 y - X ww", number: "116", denominator: "182", setCode: "DRI" },
  },

  // ── THE CONFIG THAT WAS REJECTED (REPORT.md §3.2) ─────────────────────────
  // 2× instead of 3×: the number falls 100 % → 86 % and the name 76 % → 52 %.
  // These three rows are what that costs in practice, and two of them are
  // failures the extractor is REQUIRED to pass through rather than repair.
  {
    id: "paddle-roi-2x 480x670 m06_t67s_sv04.5-162",
    truth: { name: "Barraskewda", number: "063", denominator: "182", setCode: "DRI" },
    name: ["Barraskewda HP130"],
    strip: ["口 0G3/8"],
    // `口 0G3/8` — the badge glyph became a CJK box, `06` became `0G`, and the
    // 3-digit denominator lost two digits. `3/8` is a legal `NNN/NNN`, so the
    // extractor reports `3` and `8` and is right to: there is no local rule that
    // distinguishes a badly-read number from a real low one (`sve-003` of 8
    // would print exactly this). The denominator then eliminates every printed
    // set — none prints `/8` — and `setCode` is null, which is the gate doing
    // its job on a read it could not otherwise have doubted.
    want: { name: "Barraskewda", number: "3", denominator: "8", setCode: null },
  },
  {
    id: "paddle-roi-2x 480x670 m15_t181s_swsh11-078",
    truth: { name: "Team Rocket's Koffing", number: "125", denominator: "182", setCode: "DRI" },
    name: ["Team Rocket's Koffing #70"],
    strip: ["weaknen x2 resistance", "toxiegasisheld", "Da12S/182 bod, soit"],
    want: { name: "Team Rocket's Koffing 70", number: null, denominator: null, setCode: null },
  },
  {
    id: "paddle-roi-2x 480x670 m11_t118s_A2-028",
    truth: { name: "Team Rocket's Tyranitar", number: "096", denominator: "182", setCode: "DRI" },
    name: ["TAGC Team Rocket's Tyranitar 180", "HP", "EvolvesfromTeam Rocket'sPupitan"],
    strip: ["ll.Ryuta Fuse", "DR096/182★"],
    // `EvolvesfromTeam Rocket'sPupitan` — REPORT.md §3.5 rule 2, the de-spaced
    // furniture match. Were the evolution line not recognised as furniture it
    // would out-letter the title and the name would come back as a different
    // Pokémon's. `TAGC` is a misread of the `TAG` type badge that survives
    // because the furniture list matches whole words; it costs four characters
    // of a fuzzy name lookup and is left rather than papered over with a rule
    // nothing measured.
    want: { name: "TAGC Team Rocket's Tyranitar", number: "096", denominator: "182", setCode: "DRI" },
  },

  // ── THE RESOLUTION §2.1 CALLS HAZARDOUS ───────────────────────────────────
  // 229×320 is the telemetry downscale. It reads the number 0 % of the time on
  // PRISTINE input and the configs that read the most numbers read most of them
  // WRONG. These rows exist so that "never OCR the 229×320 crop" (REPORT.md
  // §9.4, enforced at `index.ts`'s `readCard`) has evidence attached to it
  // rather than being folklore.
  {
    id: "paddle-roi-3x 229x320 c_t242s_sv04-055",
    truth: { name: "Dondozo", number: "055", denominator: "182", setCode: "PAR" },
    name: ["BASR Squawkabilly 70*"],
    strip: ["153/182"],
    // A CONFIDENTLY WRONG NUMBER, and the whole argument for §9.4 in one row.
    // The card is `sv04-055` Dondozo. The strip read `153/182` — a clean,
    // well-formed, entirely fictional collector number, for a set whose
    // denominator is 182 so the cross-check has no objection. The name line is a
    // different card's name. NOTHING in this module can catch this, because
    // there is nothing wrong with what was read; the input was hazardous. The
    // only defence is not feeding it in, which is why `readCard` takes the
    // rectified 480×670 crop and says so.
    want: { name: "BASR Squawkabilly 70", number: "153", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 229x320 c_t176s_sm2-6",
    truth: { name: "Phantump", number: "6", denominator: "145", setCode: null },
    name: ["Team Rocket's Golbat 80"],
    strip: ["muinL-JU", "ANANCARA", "21/182"],
    want: { name: "Team Rocket's Golbat", number: "21", denominator: "182", setCode: null },
  },
  {
    id: "paddle-roi-3x 229x320 m22_t262s_hgss3-30",
    truth: { name: "Cynthia's Power Weight", number: "162", denominator: "182", setCode: "DRI" },
    name: ["Pakemon Tool TRAINER", "Cynthia's Power Weight"],
    strip: ["Pomon drirg yor", "1627182"],
    // RIGHT FOR THE WRONG REASON, and pinned as such. `1627182` has no
    // separator glyph at all, so no `NNN/NNN` matched and there is no
    // denominator to cross-check against — and the badge pool falls back to the
    // first strip line, `Pomon drirg yor`, whose de-spaced form contains `DRI`.
    // The card really is `DRI`. It is a coincidence, and reading it as evidence
    // that the badge rule works at 229×320 would be exactly backwards.
    want: { name: "Cynthia's Power Weight", number: null, denominator: null, setCode: "DRI" },
  },
  {
    id: "paddle-roi-3x 229x320 m02_t35s_A2-012",
    truth: { name: "Buizel", number: "057", denominator: "182", setCode: "DRI" },
    name: [],
    strip: [],
    want: { name: null, number: null, denominator: null, setCode: null },
  },
]

describe('extractFields — recorded recogniser output', () => {
  for (const c of CASES) {
    it(c.id, () => {
      const got = extractFields([
        { roi: 'name', lines: c.name },
        { roi: 'strip', lines: c.strip },
      ])
      assert.deepEqual(got, c.want)
    })
  }

  it('reproduces REPORT.md §1.1 on the shipped recipe: 21/21 number pairs, 0 wrong', () => {
    // The 21 native crops, scored the way §1.1 scores them. This is the test
    // that fails if a "harmless tidy-up" of the extractor quietly costs the
    // headline number — and the number is the whole reason this lane exists.
    const shipped = CASES.filter((c) => c.id.startsWith('paddle-roi-3x 480x670'))
    assert.equal(shipped.length, 21, 'the native-resolution population is 21 crops')

    let numberPairs = 0
    let badgeResolved = 0
    let badgeWrong = 0
    let namesExact = 0
    for (const c of shipped) {
      const got = extractFields([
        { roi: 'name', lines: c.name },
        { roi: 'strip', lines: c.strip },
      ])
      const num = got.number == null ? null : String(Number.parseInt(got.number, 10))
      const truthNum = String(Number.parseInt(c.truth.number, 10))
      if (num === truthNum && got.denominator === c.truth.denominator) numberPairs++
      if (got.setCode != null) {
        if (got.setCode === c.truth.setCode) badgeResolved++
        else badgeWrong++
      }
      if (got.name === c.truth.name) namesExact++
    }
    assert.equal(numberPairs, 21, 'number + denominator: §1.1 says 100 %')
    assert.equal(badgeResolved, 14, 'vocabulary-resolved badge: §1.1 says 67 % of 21')
    assert.equal(badgeWrong, 0, '§1.2: the failure mode is silence, not lies')
    assert.equal(namesExact, 16, 'exact name: §1.1 says 76 % of 21')
  })
})

describe('the badge rules — REPORT.md §4.2', () => {
  it('resolves every observed misread of one DRI card', () => {
    // §4.2's own list, verbatim: "Observed reads for a DRI card: DRI, DRIE,
    // DRIN, DR, DRN, ODRIO, DDRIN". Every one must land on DRI — that is what
    // turns 33 % raw into 67 % resolved.
    for (const read of ['DRI', 'DRIE', 'DRIN', 'DRN', 'ODRIO', 'DDRIN']) {
      assert.equal(resolveSetCode([read], '182'), 'DRI', read)
    }
  })

  it('a fragment SHORTER than a code resolves from the pooled line, not alone', () => {
    // `DR` is on §4.2's observed list and does NOT resolve on its own: the
    // window scan needs a window of the code's own length and a two-character
    // string has none. That is the reference matcher's behaviour too, and it is
    // pinned rather than "fixed" by also comparing whole short strings — which
    // would make every two-character scrap in the pool a candidate for a
    // one-edit match against 29 codes.
    assert.equal(resolveSetCode(['DR'], '182'), null)
    // It does not need to resolve alone. The pool always carries the whole strip
    // line as well as the fragment left of the number (`extractFields`), and the
    // crop that produced `DR` produced this line too — where `0` maps to `O` and
    // the window `DRO` is one edit from `DRI`.
    assert.equal(resolveSetCode(['DR', 'DR049/182★'], '182'), 'DRI')
  })

  it('scans every window, not just the prefix', () => {
    // The badge arrives glued to the number and to whatever the recogniser
    // swallowed either side of it. A prefix test gets the first of these only.
    assert.equal(resolveSetCode(['DRIEN089/182 inc'], '182'), 'DRI')
    assert.equal(resolveSetCode(['ODRIO 169/182'], '182'), 'DRI')
    assert.equal(resolveSetCode(['DR049/182★'], '182'), 'DRI')
  })

  it('maps the four digit-for-letter confusions', () => {
    // 0→O 1→I 5→S 8→B, and nothing else: the badge is known to be letters, so
    // every digit in it is a misread. The number beside it is known to be
    // digits and is parsed by a rule that never sees this function.
    assert.equal(normaliseBadge('DR1'), 'DRI')
    assert.equal(normaliseBadge('5VI'), 'SVI')
    assert.equal(normaliseBadge('8LK'), 'BLK')
    assert.equal(normaliseBadge('P0R'), 'POR')
    // The language subscript is dropped, however it arrives glued on.
    assert.equal(normaliseBadge('DRIEN'), 'DRI')
    assert.equal(normaliseBadge('sv i-en'), 'SVI')
  })

  it('THE PRINTS-NO-DENOMINATOR ELIMINATION — the bakeoff’s one false accept', () => {
    // REPORT.md §4.2, the bug found and fixed mid-run. The pooled badge text for
    // an sv10-116 crop was `116/182 neversecretepo`; SVE had been EXEMPTED from
    // the cross-check on the reasoning that a set printing no denominator has
    // nothing to compare, and it matched that flavour text. Backwards —
    // CROSSWALK §4.1: for those four sets the ABSENCE of a denominator is itself
    // the discriminator, so a denominator having been read rules them out.
    assert.equal(resolveSetCode(['116/182 neversecretepo'], '182'), null)
    for (const code of ['SVE', 'SVP', 'MEE', 'MEP']) {
      assert.equal(eliminatedByDenominator(code, 182), true, `${code} prints no denominator`)
      // ...and is still reachable when none was read, which is what those four
      // sets actually print.
      assert.equal(eliminatedByDenominator(code, null), false, code)
      assert.equal(resolveSetCode([code], null), code, code)
    }
  })

  it('rejects a code whose denominator disagrees — a hard reject, not a tie-break', () => {
    // SVI prints /198. Read beside a /182 it is not a weak candidate, it is an
    // impossible one (CROSSWALK §4.1).
    assert.equal(resolveSetCode(['SVI 014/198'], '198'), 'SVI')
    assert.equal(resolveSetCode(['SVI'], '182'), null)
    assert.equal(resolveSetCode(['PAF'], '91'), 'PAF')
    // And the same rule RESCUES a misread, which is the half that is easy to
    // forget it does: `PAF` beside a `/193` is impossible, `PAL` prints /193 and
    // is one edit away, so the denominator does not merely veto — it selects.
    // (The API's own resolver documents the same behaviour with `SVE` + /198.)
    assert.equal(resolveSetCode(['PAF'], '193'), 'PAL')
  })

  it('stops at edit distance 1', () => {
    assert.equal(resolveSetCode(['DXI'], '182'), 'DRI') // one substitution
    assert.equal(resolveSetCode(['XXI'], '182'), null) // two
    assert.equal(resolveSetCode(['QQQ'], null), null)
  })

  it('returns null on a tie between two codes rather than picking by table order', () => {
    // The one addition to the bakeoff's matcher — see `resolveSetCode`'s header
    // for the 428-row measurement of what it costs and what it buys. PAF (/91)
    // and PAL (/193) differ by one character, so a read one edit from each, with
    // no denominator to separate them, is not an answer.
    assert.equal(resolveSetCode(['PAX'], null), null)
    // Give it the denominator and one of the two is eliminated outright, so the
    // survivor is unambiguous again.
    assert.equal(resolveSetCode(['PAX'], '91'), 'PAF')
    assert.equal(resolveSetCode(['PAX'], '193'), 'PAL')
  })

  it('never answers from an empty or unreadable pool', () => {
    assert.equal(resolveSetCode([], '182'), null)
    assert.equal(resolveSetCode([null, undefined, '', '   ', '★'], '182'), null)
  })
})

describe('the name rules — REPORT.md §3.5', () => {
  it('does NOT pick the topmost line', () => {
    // "on every Trainer card the topmost line is `Item TRAINER`". Fixing this
    // alone moved the name from 24 % to 76 %.
    const furniture = [
      'Item TRAINER',
      'Supporter TRAINER',
      'Pokemon Tool TRAINER',
      'ltem TRAINER',
      'TRAINER',
      'BASIC',
      'STAGE2',
      'STAGET',
    ]
    for (const f of furniture) {
      const got = extractFields([
        { roi: 'name', lines: [f, "Team Rocket's Giovanni"] },
        { roi: 'strip', lines: [] },
      ])
      assert.equal(got.name, "Team Rocket's Giovanni", f)
    }
  })

  it('matches furniture against a DE-SPACED form', () => {
    // "The recogniser routinely returns `EvolvesfromTeamRocket'sPupitar`,
    // defeating any \bEvolves\s+from\b test." Left in, the evolution line is a
    // longer run of letters than the title and would win the selection.
    const got = extractFields([
      { roi: 'name', lines: ["EvolvesfromTeamRocket'sPupitar", "Team Rocket's Tyranitar"] },
      { roi: 'strip', lines: [] },
    ])
    assert.equal(got.name, "Team Rocket's Tyranitar")
    assert.equal(cleanNameLine("EvolvesfromTeamRocket'sPupitar"), null)
    assert.equal(cleanNameLine("Evolves from Team Rocket'sNidoran"), null)
  })

  it('strips the HP block and the misreads of it this run recorded', () => {
    assert.equal(cleanNameLine('Misty’s Gyarados HP 180'), 'Misty’s Gyarados')
    assert.equal(cleanNameLine('Barraskewda H130'), 'Barraskewda')
    assert.equal(cleanNameLine("Team Rocket's Porygon NP60"), "Team Rocket's Porygon")
    assert.equal(cleanNameLine("Team Rocket's Koffing H70"), "Team Rocket's Koffing")
    assert.equal(cleanNameLine('Snover 90'), 'Snover')
  })

  it('drops the illustrator credit, in the misread spellings that carry a space', () => {
    const credits = ['Illus. Studio Bora Inc.', 'lllus. Studio Bora', 'llus. Ryuta Fuse', 'iius. AYUMU ODASHIMA']
    for (const line of credits) assert.equal(cleanNameLine(line), null, line)
  })

  it('does NOT drop a credit whose separator was swallowed — and does not need to', () => {
    // The pattern requires whitespace after the `Illus.`, so the glued forms
    // this run recorded (`Nus.Teiro Abiu`, `livs.Mugf Homedo`, `us.Anesaki
    // Dynamic`) survive it. Pinned rather than widened, because every one of
    // them was read off the BOTTOM STRIP — the illustrator credit is printed
    // there, so the name pass never sees it, and loosening the pattern to `\.?`
    // would let it eat a real title beginning with `Us` or `Nus`.
    assert.equal(cleanNameLine('Nus.Teiro Abiu'), 'Nus.Teiro Abiu')
    // And the selection rule is the backstop even if one did appear there: the
    // title is chosen by LETTER COUNT, so a credit has to out-letter the card's
    // own name to win, which this one does not.
    const got = extractFields([
      { roi: 'name', lines: ['Nus.Teiro Abiu', "Cynthia's Gabite"] },
      { roi: 'strip', lines: [] },
    ])
    assert.equal(got.name, "Cynthia's Gabite")
  })

  it('a line that is nothing but furniture is not a name', () => {
    for (const line of ['TRAINER', 'Item', 'Supporter', 'BASIC', 'STAGE 1', 'Pokemon Tool', 'Energy']) {
      assert.equal(cleanNameLine(line), null, line)
    }
    // Two letters is a rarity glyph or an energy symbol, not a card name.
    assert.equal(cleanNameLine('AB'), null)
    assert.equal(cleanNameLine('Abr'), 'Abr')
  })
})

describe('the number pair', () => {
  it('accepts the separators the recogniser really returns for a slash', () => {
    for (const sep of ['/', '／', '|', 'l', '¡', 'i']) {
      const got = extractFields([
        { roi: 'name', lines: [] },
        { roi: 'strip', lines: [`DRIEN 049${sep}182`] },
      ])
      assert.deepEqual([got.number, got.denominator], ['049', '182'], sep)
    }
  })

  it('does not read a copyright year as a collector number', () => {
    // `02025Pokemon/Nintendo/Creatures` is on almost every strip in the corpus.
    // The lookarounds are what stop a four-digit run from being read as a pair.
    const got = extractFields([
      { roi: 'name', lines: [] },
      { roi: 'strip', lines: ['02025Pokemon/Nintendo/Creatures'] },
    ])
    assert.equal(got.number, null)
    assert.equal(got.denominator, null)
  })

  it('keeps the zero padding as printed', () => {
    const got = extractFields([{ roi: 'name', lines: [] }, { roi: 'strip', lines: ['049/182'] }])
    assert.equal(got.number, '049')
  })

  it('reads no bare number when there is no denominator', () => {
    // Deliberate, and it costs promos (CROSSWALK §3.2). A lone 1-3 digit run off
    // the bottom strip is also what the copyright line, the rarity glyph and
    // half the flavour text look like.
    const got = extractFields([
      { roi: 'name', lines: [] },
      { roi: 'strip', lines: ['SVP EN 001', 'illus. someone'] },
    ])
    assert.equal(got.number, null)
  })
})

describe('the 29-code table — CROSSWALK §2.5', () => {
  it('has 29 rows, with no duplicate code and no duplicate set id', () => {
    assert.equal(PRINTED_SETS.length, 29)
    assert.equal(new Set(PRINTED_SETS.map((s) => s.code)).size, 29)
    assert.equal(new Set(PRINTED_SETS.map((s) => s.setId)).size, 29)
  })

  it('carries null for exactly the four sets that print no denominator', () => {
    const none = PRINTED_SETS.filter((s) => s.denominator === null).map((s) => s.code)
    assert.deepEqual([...none].sort(), ['MEE', 'MEP', 'SVE', 'SVP'])
  })

  it('agrees with the crosswalk on the numbers a lookup joins on', () => {
    const byCode = new Map(PRINTED_SETS.map((s) => [s.code, s]))
    assert.equal(byCode.get('DRI')?.denominator, 182)
    assert.equal(byCode.get('DRI')?.setId, 'sv10')
    assert.equal(byCode.get('PAR')?.denominator, 182) // shares DRI's — §4.1's 19th pair
    assert.equal(byCode.get('SVI')?.denominator, 198)
    assert.equal(byCode.get('MEW')?.setId, 'sv03.5')
    assert.equal(byCode.get('MCD23')?.denominator, 15)
  })
})

describe('levenshtein', () => {
  it('is the plain edit distance', () => {
    assert.equal(levenshtein('DRI', 'DRI'), 0)
    assert.equal(levenshtein('DRN', 'DRI'), 1)
    assert.equal(levenshtein('DR', 'DRI'), 1)
    assert.equal(levenshtein('', 'DRI'), 3)
    assert.equal(levenshtein('DRI', ''), 3)
    assert.equal(levenshtein('PAF', 'PAL'), 1)
  })
})
