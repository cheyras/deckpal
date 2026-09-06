// Run: node --import tsx --test src/scan/ocr/__tests__/*.test.ts
//
// THE ESCALATION RUNG — the 2026-09-06 owner ruling, under test.
//
// "Full-card OCR is an ESCALATION rung — runs ONLY when the two-ROI pass returns
// name=null AND number=null. Zero cost on the happy path."
//
// Two halves, and they fail in opposite directions.
//
//   THE TRIGGER must be conservative about WHEN IT RUNS. An escalation that
//   fires when it should not costs ~1-1.5 s on the owner's iPhone (137 ms of
//   detection plus 38-48 ms for each of 15-25 lines, per the probe) — and it
//   costs it IN FRONT OF THE FIRST `/scan/resolve` POST, because `Scan.tsx`'s
//   race awaits the read before it calls `resolveWithOcr`. So the first suite
//   drives the SHIPPING `readFields` against a stub session and asserts the full
//   crop is never even PREPARED on a read that found something. Not "not read" —
//   not prepared: the crop is a thunk precisely so the canvas work is skipped
//   too.
//
//   THE RE-EXTRACTION must be conservative about WHAT IT CLAIMS. It runs the
//   field rules over a whole card instead of two 17 %-tall bands, which is four
//   times the text and all of it competing, so the second suite replays every
//   recorded `paddle-full` read — all 21 native 480×670 crops, which REPORT.md
//   §0 establishes is the entire population of real rectified crops and not a
//   sample of it — and pins the number, the denominator and the badge against
//   the truth. The property is REPORT.md §1.2's, restated for this rung: **the
//   failure mode is silence, not lies.**
//
// ── WHAT THE RECORDED ROWS CANNOT TEST, AND WHERE IT IS TESTED INSTEAD ──────
//
// `results.json` stores each pass's output as TEXT. The escalation also needs
// each line's height fraction — that is how it stops "most letters left after
// the furniture" from picking the longest line of attack text as the card name
// (see `escalate.ts`, and note that the naive version does exactly that on 21 of
// 21 recorded rows) — and the recorded rows carry no geometry to give it. So the
// replay places every recorded line BELOW the name band, which isolates the
// three key columns exactly as REPORT.md's `paddle-full` row measures them, and
// the band is driven separately in 'the name band' with geometry written down in
// the test.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  extractFullCropFields,
  MAX_BODY_LINES,
  MAX_BODY_LINE_CHARS,
  normaliseBodyLines,
  shouldEscalate,
} from '../escalate'
import { readFields, type FullCropInput, type OcrRead, type RoiInput } from '../pipeline'
import { makeRaster, type Raster } from '../raster'
import { ROIS } from '../rois'
import type { OcrSession } from '../session'

// ── A SESSION THAT SAYS EXACTLY WHAT THE TEST TELLS IT TO ──────────────────
//
// `OcrSession` is two `run(input, dims) => { data, dims }` graphs plus a key
// list, so a stub is a stub: no ONNX, no WASM, no 15.6 MB download. Driving the
// REAL `readFields` through one is the point — the property under test is
// control flow, and control flow is what a value-based test cannot see. An
// escalation that ran on EVERY capture would still return correct fields and
// would still pass every assertion in the other three suites.

/** The toy alphabet the fake recogniser emits over. Index 0 is CTC blank, so
 *  class k ≥ 1 is `keys[k - 1]` — `ctc.ts`'s convention, reproduced here rather
 *  than worked around. */
const KEYS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.,\'-+*'.split(''),
  ' ',
]

/** CTC logits that decode to exactly `text`. A blank is inserted between equal
 *  neighbours, which is the rule that stops `ll` collapsing to `l`. */
function ctcFor(text: string): { data: Float32Array; dims: number[] } {
  const classes: number[] = []
  let prev = -1
  for (const ch of text) {
    const k = KEYS.indexOf(ch) + 1
    // A character outside the toy alphabet would silently decode to something
    // else. Fail loudly: a fixture that does not say what it looks like is worse
    // than no fixture.
    if (k === 0) throw new Error(`the test alphabet has no ${JSON.stringify(ch)}`)
    if (k === prev) classes.push(0)
    classes.push(k)
    prev = k
  }
  const c = KEYS.length + 1
  const data = new Float32Array(classes.length * c)
  // 1.0 on the winner clears `MIN_LINE_CONFIDENCE` (0.5) by a mile, deliberately:
  // a line dropped for low confidence would look exactly like a line the
  // pipeline chose not to read, and this suite is about the latter.
  classes.forEach((k, i) => {
    data[i * c + k] = 1
  })
  return { data, dims: [1, classes.length, c] }
}

/** One placed line of a fake card: its text and its midline as a fraction of the
 *  CARD (not of the padded raster — the pad is what `drawn` divides out). */
interface FakeLine {
  text: string
  y: number
}

const RASTER_W = 224
/** Wide and short: a text line. Anything squarer trips `detectBoxes`'
 *  degenerate-sliver gate or `MIN_REC_WIDTH` on the way to the recogniser. */
const LINE_W = 200
const LINE_H = 8
/** The card's own height inside the raster, and the letterbox around it. The pad
 *  is DELIBERATELY BIGGER than the one pixel a real 480×670 crop gets, so a
 *  version of the pipeline that forgot to subtract `drawn.y` would compute
 *  different fractions and this suite would fail rather than pass by luck. */
const CARD_H = 480
const PAD_Y = 16
const RASTER_H = CARD_H + PAD_Y * 2

/** A DB probability map with one filled rectangle per line. */
function probMap(lines: readonly FakeLine[], w: number, h: number, padY: number, cardH: number): Float32Array {
  const data = new Float32Array(w * h)
  for (const line of lines) {
    const mid = Math.round(padY + line.y * cardH)
    for (let y = mid - LINE_H / 2; y < mid + LINE_H / 2; y++) {
      if (y < 0 || y >= h) continue
      for (let x = 4; x < 4 + LINE_W && x < w; x++) data[y * w + x] = 1
    }
  }
  return data
}

/** ROI passes do not care where a line sat — the band already filtered it — so
 *  their fixtures are plain strings, stacked far enough apart that
 *  `groupIntoLines` keeps them separate. */
function stack(texts: readonly string[]): FakeLine[] {
  return texts.map((text, i) => ({ text, y: 0.08 + i * 0.09 }))
}

interface StubPlan {
  /** What each ROI pass hands back, in the order the passes run. */
  roi: string[][]
  /** What the full-card pass hands back, with geometry. */
  full: FakeLine[]
}

interface Stub {
  session: OcrSession
  /** How many times the full crop was PREPARED. This counter IS the ruling. */
  prepared: () => number
  fullCrop: () => FullCropInput | null
}

function makeStub(plan: StubPlan, override?: () => FullCropInput | null): Stub {
  const passes: FakeLine[][] = [...plan.roi.map(stack), plan.full]
  let queue: string[] = []
  let prepared = 0
  const session: OcrSession = {
    keys: KEYS,
    loadMs: 0,
    det: {
      async run(_input, dims) {
        const h = Number(dims[dims.length - 2])
        const w = Number(dims[dims.length - 1])
        const lines = passes.shift() ?? []
        // Reading order is top-to-bottom, which is the order `detectBoxes`
        // discovers components in and the order `groupIntoLines` sorts to.
        queue = [...lines].sort((a, b) => a.y - b.y).map((l) => l.text)
        return { data: probMap(lines, w, h, PAD_Y, CARD_H), dims: [1, 1, h, w] }
      },
    },
    rec: {
      async run() {
        return ctcFor(queue.shift() ?? '')
      },
    },
  }
  return {
    session,
    prepared: () => prepared,
    fullCrop:
      override ??
      (() => {
        prepared++
        return { raster: raster(), drawn: { x: 0, y: PAD_Y, w: RASTER_W, h: CARD_H } }
      }),
  }
}

function raster(): Raster {
  return makeRaster(RASTER_W, RASTER_H)
}

function roiInputs(): RoiInput[] {
  return [
    { roi: 'name', raster: raster() },
    { roi: 'strip', raster: raster() },
  ]
}

async function readWith(plan: StubPlan, override?: () => FullCropInput | null): Promise<{ read: OcrRead; stub: Stub }> {
  const stub = makeStub(plan, override)
  const read = await readFields(stub.session, roiInputs(), stub.fullCrop)
  return { read, stub }
}

// ── the trigger ────────────────────────────────────────────────────────────

describe('the escalation trigger', () => {
  it('is name AND number, and nothing else', () => {
    assert.equal(shouldEscalate({ name: null, number: null, denominator: null, setCode: null }), true)
    // A number alone is rung 3, which resolves 21/21 crops to a candidate set;
    // a name alone is rung 4's other half. Neither is nothing to go on.
    assert.equal(shouldEscalate({ name: null, number: '161', denominator: null, setCode: null }), false)
    assert.equal(shouldEscalate({ name: 'Murkrow', number: null, denominator: null, setCode: null }), false)
    // And these two are deliberately NOT in the test. A denominator or a badge
    // without a number is not a key — CROSSWALK §7.3's rung 1 is badge+number —
    // so a read carrying only those still has nothing to resolve on and still
    // escalates.
    assert.equal(shouldEscalate({ name: null, number: null, denominator: '182', setCode: 'DRI' }), true)
  })

  it('DOES NOT PREPARE THE FULL CROP when the strip band read a number', async () => {
    const { read, stub } = await readWith({
      roi: [['Team Rockets Murkrow 80'], ['DRI 127/182']],
      full: [{ text: 'never read', y: 0.1 }],
    })
    assert.equal(stub.prepared(), 0, 'the happy path paid for an escalation')
    assert.equal(read.pass, 'roi')
    assert.equal(read.number, '127')
    assert.equal(read.bodyLines, undefined)
  })

  it('does not prepare it when only the NAME came back either', async () => {
    const { read, stub } = await readWith({
      roi: [['Team Rockets Murkrow 80'], []],
      full: [{ text: 'never read', y: 0.1 }],
    })
    assert.equal(stub.prepared(), 0)
    assert.equal(read.pass, 'roi')
    assert.equal(read.name, 'Team Rockets Murkrow')
  })

  it('runs it ONCE when both bands came back empty', async () => {
    const { read, stub } = await readWith({
      roi: [[], []],
      full: [
        { text: 'Arvens Sandwich', y: 0.06 },
        { text: 'DRIN 161/182', y: 0.9 },
      ],
    })
    assert.equal(stub.prepared(), 1)
    assert.equal(read.pass, 'escalated')
  })

  it('is not reachable at all when no full crop was offered', async () => {
    // `readFields` is also called from the node replay harness, which has ROI
    // rasters and no canvas. No thunk, no rung, and the ROI answer stands.
    const stub = makeStub({ roi: [[], []], full: [] })
    const read = await readFields(stub.session, roiInputs())
    assert.equal(read.pass, 'roi')
  })
})

describe('the escalation, once it runs', () => {
  it('RESCUES THE KEY THE BANDS MISSED — and then nothing new goes on the wire', async () => {
    // The toploader case: the quad took in the sleeve, so the bands landed on
    // plastic and the card sat inset and smaller inside its own crop. Every line
    // is still there.
    const { read } = await readWith({
      roi: [[], []],
      full: [
        { text: 'Cynthias Gabite 100', y: 0.09 },
        { text: 'Dragonslice 40', y: 0.5 },
        { text: 'DRIEN 103/182 willmakeawearybodyfeelinvigorated', y: 0.88 },
      ],
    })
    assert.equal(read.pass, 'escalated')
    assert.equal(read.number, '103')
    assert.equal(read.denominator, '182')
    assert.equal(read.setCode, 'DRI')
    assert.equal(read.name, 'Cynthias Gabite')
    assert.equal(read.bodyLines, undefined, 'a rescued key must not also ship prose')
  })

  it('falls through to bodyLines when there is still no key', async () => {
    const { read } = await readWith({
      roi: [[], []],
      full: [
        { text: 'Ability Rocket Brain', y: 0.4 },
        { text: 'Once during your turn you may move a damage counter', y: 0.5 },
        { text: '4-2', y: 0.62 },
      ],
    })
    assert.equal(read.pass, 'escalated')
    assert.equal(read.number, null)
    assert.equal(read.name, null)
    assert.deepEqual(read.bodyLines, [
      'Ability Rocket Brain',
      'Once during your turn you may move a damage counter',
    ])
  })

  it('keeps the ROI answer when the crop could not be prepared', async () => {
    // A browser with no 2D context throws in `capture.ts`. That is a reason to
    // have no escalation, never a reason to lose the read.
    for (const thunk of [
      () => null,
      () => {
        throw new Error('this browser could not prepare the OCR crop')
      },
    ] as (() => FullCropInput | null)[]) {
      const { read } = await readWith({ roi: [[], []], full: [] }, thunk)
      assert.equal(read.pass, 'roi')
      assert.equal(read.bodyLines, undefined)
    }
  })

  it('reports a read that found nothing anywhere as escalated and empty', async () => {
    const { read } = await readWith({ roi: [[], []], full: [] })
    assert.equal(read.pass, 'escalated')
    assert.equal(read.name, null)
    assert.equal(read.number, null)
    assert.equal(read.bodyLines, undefined, 'an empty array on the wire would be a claim')
  })
})

// ── the replay ─────────────────────────────────────────────────────────────

interface RecordedCase {
  id: string
  /** The card, from `manifest.json` — resolved live from TCGdex when the bakeoff
   *  ran. */
  truth: { number: string; denominator: string; setCode: string }
  /** Verbatim from `results.json`, config `paddle-full`, res `480x670`. */
  lines: string[]
  /** What the escalation's re-extraction must return. SEPARATE FROM `truth` on
   *  purpose: where they differ the difference is measured behaviour, and the
   *  comment on the suite says which kind. */
  want: { number: string | null; denominator: string | null; setCode: string | null }
}

const RECORDED: RecordedCase[] = [
  {
    id: "m01_t18s_A3b-100",
    truth: { number: "049", denominator: "182", setCode: "DRI" },
    lines: [
      "TAG",
      "Misty's Gyarados 180C",
      "Splashing Panic 70x",
      "Discard the top 7 cards of your deck,and this attack does",
      "70 damage for each Misty's Pokemon that you discarded",
      "in this way.",
      "* Waterfall 120",
      "4x2 retreat ***水",
      "GOSSAN Onceitappears,toesonarampage.reman",
      "DRI049/182★ enraged until it demofishes everything around it.",
      "/GAMEFEAN",
    ],
    want: { number: "049", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m02_t35s_A2-012",
    truth: { number: "057", denominator: "182", setCode: "DRI" },
    lines: [
      "Tail Whap 10",
      "Wave Splash 30",
      "4x2",
      "线057/182",
    ],
    want: { number: "057", denominator: "182", setCode: null },
  },
  {
    id: "m03_t43s_B2-225",
    truth: { number: "059", denominator: "182", setCode: "DRI" },
    lines: [
      "BASIC",
      "Snover 90",
      "** Light Punch 20",
      "** lcicle 50",
      "siness ×2 reat 水**",
      "Duringcoldseasons,itmigratesto th",
      "fomokaru Komfyo ntain'slowerreaches.ltretumstothe",
      "059/1820 ed summit in the spring",
      "ZEs/ GAME FRLA",
    ],
    want: { number: null, denominator: null, setCode: null },
  },
  {
    id: "m04_t50s_ex8-90",
    truth: { number: "060", denominator: "182", setCode: "DRI" },
    lines: [
      "NO.0460 Frost Tre Pokemon HT.73WT:298.7bs",
      "*水水 Lunge Out",
      "90",
      "Frozen Wood 120+",
      "If this Pokemon has 2 or more  Energy attached,this",
      "attack does 120 more damage.",
      "weaknessx2 resistance retreat ****",
      "llus.kamonabe It livesaquietlifeonmountains thatare",
      "perpetuallycoveredinsnow.lthide",
      "DRIE060/182 itsefbwhippingupblizzads",
      "02025PokemnNintendo/CreturesGAMEFREAK",
    ],
    want: { number: "060", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m06_t67s_sv04.5-162",
    truth: { number: "063", denominator: "182", setCode: "DRI" },
    lines: [
      "Barraskewda 130",
      "Sharp Fin 40",
      "3G Dive 60",
      "Flip a coin.lf heads,during your opponents next tun",
      "prevent all damage from and effects of attacks done to this",
      "Pokemon.",
      "x2 Felitan retreat 小",
      "itpinit tailnstoleaptom thewate",
      "063/182 thenvicioinhy bites downonWingull",
      "e tothowatersuface",
    ],
    want: { number: "063", denominator: "182", setCode: null },
  },
  {
    id: "m07_t81s_A4-064",
    truth: { number: "086", denominator: "182", setCode: "DRI" },
    lines: [
      "Ability Stone Palace",
      "As long as this Pokemon is on your Bench,all of your",
      "Steven's Pokemon take 30 less damage from attacks from",
      "your opponent's Pokemon (after applying Weakness and",
      "Resistance). The effect of Stone Palace doesn't stack.",
      "80",
      "四** Magical Shot",
      "retreat **",
      "×2",
      "Ithas sleptunderground forhundreds of",
      "onsofyearssinceitbirtht'soccasionll",
      "found during the excavation of ca",
      "DRIEN 086/182",
      "doICretres/GAME FREAK",
    ],
    want: { number: "086", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m08_t92s_swsh2-77",
    truth: { number: "089", denominator: "182", setCode: "DRI" },
    lines: [
      "STAGE2",
      "Team Rocket's Orbeetle 130",
      "oosfoo",
      "AbilityRocket Brain",
      "often as you like during your turn,you may move",
      "ge counter from I of your Team Rocket's Pokemon",
      "her ofyour Pokemon.",
      "Psychic 40+",
      "ack does 40more damage for each Energy attached",
      "our opponent's Active Pokemon.",
      "x2 resistance -30 retreat**",
      "us.Shin Nagasowa ltemits psychicenergytoobserve and study",
      "what'saroundit-andwhat'sarounditcan",
      "DRIN089/182 include thingsover sixmilesaway",
      "02025 Pok /Nintendo/Creatures/GAMEFREAx",
    ],
    want: { number: "089", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m11_t118s_A2-028",
    truth: { number: "096", denominator: "182", setCode: "DRI" },
    lines: [
      "STAGE2 Team Rocket's Tyranitar 180",
      "EvolvesfromTeam Rocket'sPupitar",
      "NO.0248A 000H.6",
      "Ability Sand Stream",
      "During Pokemon Checkup.if this Pokemon is in the Active",
      "Spot,put 2 damage counters on each of your opponent's",
      "Basic Pokemon.",
      "***Demolition Tackle 180",
      "Discard an Energy from your opponent's Active Pokemon.",
      "0x2 ***",
      "llun.Ryuta Fuse",
      "DRI096/182★",
      "TGAEFRLAX",
    ],
    want: { number: "096", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m12_t131s_bw11-RC21",
    truth: { number: "103", denominator: "182", setCode: "DRI" },
    lines: [
      "STAGE1 Cynthia's Gabite 100",
      "Evolvesfrom.Cynthia'sGible",
      "NO.0444 CavePokemon-HT:47 WL1235D",
      "Ability Champion's Call",
      "Once during your turn,you may search your deck for a",
      "Cynthias Pokemon,reveal it,and put it into your hand.",
      "Then,shuffle your deck.",
      "Dragonslice 40",
      "weakness x2 resistance retreat 本",
      "Inrarecases,itmolts and shedsitsscales.",
      "llusTairgAkitu Medicine containing its scalesasaningredient",
      "DRIEN 103/182 willmakeawearybodyfeelinvigorated",
      "02025 Pote enda/Creatures/GAMEFREAK",
    ],
    want: { number: "103", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m13_t157s_bw4-35",
    truth: { number: "115", denominator: "182", setCode: "DRI" },
    lines: [
      "STAGET",
      "Team Rocket's Nidorina H90O",
      "Evolvesfrom TeamRocket's Nidoran",
      "Dark Awakening",
      "Choose up to 2 of your  Pokemon.For each of those",
      "Pokemon,search your deck for a card that evolves from",
      "that Pokemon and put it onto that Pokemon to evolve it.",
      "Then, shuffle your deck.",
      "50",
      "CC Scratch",
      "retreat **",
      "weaknessx2 resistance",
      "Ifthe groupisthreatenedthesePokemon",
      "willband together toassault enemies",
      "Illus.Toiga Kosai with a chorus of ultrasonicwaves.",
      "DRIE115/182 GAMEFREAN",
    ],
    want: { number: "115", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m14_t172s_ex13-34",
    truth: { number: "116", denominator: "182", setCode: "DRI" },
    lines: [
      "TAGE",
      "Team Rocket's Nidoqueen HP170",
      "Evolvesfrom Team Rocket'sNidorina",
      "00031-D",
      "Love Impact 60+",
      "If a Pokemon that has “Nidoking” in its name is on your",
      "Bench. this attack does 120 more damage.",
      "Mega Kick 130",
      "weaknesx2 resistance retreat***",
      "llus.hnel It pacifiesofispring byplacing themin thegap",
      "DRIE116/182 between the spines onitsback.Thespineswill",
      "never secrete poison whileyoung arepresent.",
      "FOEHtVE/GAMEFREAK",
    ],
    want: { number: "116", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m15_t181s_swsh11-078",
    truth: { number: "125", denominator: "182", setCode: "DRI" },
    lines: [
      "Team Rocket's Koffing 70",
      "Abiley Smog Signals",
      "If this Pokemon is in the Aetive Spot and is damaged by an",
      "attack from your opponent's Pokemon (even if this Pokemon",
      "is Knocked Out,search your deck for up to 2 Pokemon that",
      "have Koffingin their name and put them onto your Bench.",
      "Then, shuffle your deck",
      "Leaking Gas 30",
      "aknex2 resistance retreat ",
      "Toviegasisheldwithin itsthinballoon-shaped",
      "DNE125/182 bodh,soitcan cause massive explosions.",
      "CAMEPEAN",
    ],
    want: { number: "125", denominator: "182", setCode: null },
  },
  {
    id: "m16_t188s_swsh7-80",
    truth: { number: "127", denominator: "182", setCode: "DRI" },
    lines: [
      "Team Rockets Murkrow #80",
      "Deceit",
      "Search your deck for a Supporter card,reveal it,and ut",
      "it into your hand.Then,shuffle your deck.",
      "水 Torment 30",
      "Choose I of your opponent's Active Pokemon's attacks.",
      "Duringyour opponent's next turn,that Pokemon can't use",
      "that attack.",
      "x2 resistance -30 retreat *",
      "oda Feared and loathed bymany.itisbelieved tobring",
      "Moi He misfortune toall those whoseeitat night.",
      "127/182",
    ],
    want: { number: "127", denominator: "182", setCode: null },
  },
  {
    id: "m17_t203s_neo4-106",
    truth: { number: "127", denominator: "182", setCode: "DRI" },
    lines: [
      "am Rocket's Murkrow P80",
      "Deceit",
      "Search your deck for a Supporter card,reveal it,and put",
      "it into your hand. Then,shuffle your deck.",
      "U* Torment 30",
      "Choose I of your opponent's Active Pokemon's attacks.",
      "During your opponent's next turn,that Pokemon can't use",
      "that attack.",
      "kness ×2 resistance -30 retreat",
      "Iivn.Mugi Homedo Fearedand loathedbymam.its beleved tobring",
      "DR127/182 misfortune toallthosewhoseeitat night",
      "do/Cretures/GAMEFREAK",
    ],
    want: { number: "127", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m18_t229s_dpp-DP55",
    truth: { number: "144", denominator: "182", setCode: "DRI" },
    lines: [
      "Steven's Metang 100",
      "Metal Slash 70",
      "During your next turn, this Pokemon can't attack.",
      "eaknessx2 resistance -30 retreat**",
      "usAnesaki Dynamic ftisformedbytwoBeldumjoining together.Its two",
      "DRN144/182 brainsarelinkedamplfyingitpsychicower.",
      "02025Pon/intend/Cretu/GAMEFREAK",
    ],
    want: { number: "144", denominator: "182", setCode: null },
  },
  {
    id: "m20_t235s_sv03-009",
    truth: { number: "153", denominator: "182", setCode: "DRI" },
    lines: [
      "Team Rocket's Porygon NP60",
      "Hacking",
      "Discard a card from your hand.lf you do,your opponent",
      "discards a card from their hand.",
      "weakness x2 resistance retreat ",
      "llus.OswaldeKATO Itisan artificial Pokemon.Sinceit doesn",
      "breathepeopleareexcited byitspotential",
      "DIN153/182 tobe useful in any environment.",
      "FGAMEFHLAK",
    ],
    want: { number: "153", denominator: "182", setCode: null },
  },
  {
    id: "m21_t250s_sv03.5-017",
    truth: { number: "161", denominator: "182", setCode: "DRI" },
    lines: [
      "Item TRAINER",
      "Arven's Sandwich",
      "Heal 30 damage from yourActive Pokemon.lf thatPokemon",
      "is an Arven's Pokemon,heal 1o0 damage from it instead.",
      "You may play any number of Item cards during",
      "us.AYUMI ODASHIMA your turn.",
      "DRIN161/182",
      "02025Polkimon/Nintendo./ Creatures/ GAME FREAK",
    ],
    want: { number: "161", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m22_t262s_hgss3-30",
    truth: { number: "162", denominator: "182", setCode: "DRI" },
    lines: [
      "Pokemon Tool TRAINER",
      "Cynthia's Power Weight",
      "The Cynthia'sPokemon this card is attached togets+70 HP.",
      "You may attachany number of Pokemon Tools to your",
      "llus. Studio Bora Inc. Pokemon during your tun.You may atach only",
      "Pokemon Tool to each Pokemonand it stays attached",
      "DRIEN 162/182",
      "02025 Pokem cn /Nintendo/Creatures/GAME FREAK",
    ],
    want: { number: "162", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m23_t334s_swsh8-216",
    truth: { number: "169", denominator: "182", setCode: "DRI" },
    lines: [
      "TRAINER",
      "pikemuth Gym",
      "Once duringeach layerstun,that playermay search their",
      "deck for a Marnies Pokemon,reveal it,and put it into their",
      "hand.Then,that player shuffles their deck.",
      "my Ply onlyI Stad Su ard dungyourtuPnex ",
      "AciveSponddicaditerSdmcmes",
      "Hlun.AYUM OOASHINA ontep",
      "DR169/182",
      "do/CreresGAMEFREAK",
    ],
    want: { number: "169", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m24_t346s_swsh9-147",
    truth: { number: "174", denominator: "182", setCode: "DRI" },
    lines: [
      "Supportei TRAINER",
      "Team Rocket's Giovanni",
      "SwitchyourActive TeamRocket'sPokemon with Iof your",
      "Benched Team Rocket'sPokemon.lf you do,switch inI of",
      "your opponent's Benched Pokemon to the Active Spot.",
      "us.ckog You may play only I Supporter card during",
      "DRI174/182 your turn.",
      "02025 Pol do/CreatureL/ GAMEFREAK",
    ],
    want: { number: "174", denominator: "182", setCode: "DRI" },
  },
  {
    id: "m25_t359s_sv01-170",
    truth: { number: "175", denominator: "182", setCode: "DRI" },
    lines: [
      "ltem TRAINER",
      "Team Rocket's Great Ball",
      "Flipa coin.Ifheads,searchyour deckfor an Evolution Team",
      "Rocket's Pokemon,reveal it,and put it into your hand. f",
      "tails,searchyour deck fora Basic Team Rocket'sPokemon",
      "reveal it,andput it intoyour hand.Then,shuffleyour deck",
      "You may play any number of ltem cards duning",
      "your tun.",
      "ORI175/182",
    ],
    want: { number: "175", denominator: "182", setCode: "DRI" },
  },
]

/** Below the name band — see this file's header. The recorded rows carry no
 *  geometry, so the replay asserts the three columns that do not need any. */
const BELOW_THE_BAND = 0.5

describe('the full-crop re-extraction, over every recorded paddle-full read', () => {
  it('replays all 21 native crops', () => {
    // REPORT.md §0: the 25 report flags are the only artefacts in the owner's
    // session carrying `rectifyToJpeg` output, and 21 of them are real cards
    // with truth. This is that population, not a sample of it.
    assert.equal(RECORDED.length, 21)
  })

  for (const c of RECORDED) {
    it(`${c.id} reads what it read`, () => {
      const got = extractFullCropFields(c.lines.map((text) => ({ text, y: BELOW_THE_BAND })))
      assert.equal(got.number, c.want.number)
      assert.equal(got.denominator, c.want.denominator)
      assert.equal(got.setCode, c.want.setCode)
    })
  }

  it('NEVER READS A FIELD WRONG — the property, not the rate', () => {
    // REPORT.md §1.2 for the shipped recipe, and the condition on which this
    // rung was allowed to exist at all: a missing field falls down the ladder,
    // a wrong one poisons it.
    let wrong = 0
    for (const c of RECORDED) {
      const got = extractFullCropFields(c.lines.map((text) => ({ text, y: BELOW_THE_BAND })))
      if (got.number !== null && got.number !== c.truth.number) wrong++
      if (got.denominator !== null && got.denominator !== c.truth.denominator) wrong++
      if (got.setCode !== null && got.setCode !== c.truth.setCode) wrong++
    }
    assert.equal(wrong, 0)
  })

  it('reproduces the rates REPORT.md publishes for this config', () => {
    const reads = RECORDED.map((c) => extractFullCropFields(c.lines.map((text) => ({ text, y: BELOW_THE_BAND }))))
    // §1's `paddle-full` row: number 95 % (20/21), num+denom 95 %, badge vocab
    // 71 % — that last one measured over the 21 rows INCLUDING the badge this
    // rung deliberately drops, which is the next test.
    assert.equal(reads.filter((r) => r.number).length, 20)
    assert.equal(reads.filter((r) => r.number && r.denominator).length, 20)
    assert.equal(reads.filter((r) => r.setCode).length, 14)
  })

  it('DROPS THE BADGE WHEN THERE IS NO NUMBER — REPORT.md §1s one wrong read for this config', () => {
    // `m03_t43s_B2-225`. Its number line came back as `059/1820 ed summit in the
    // spring`, and `NUMBER_PAIR`'s trailing lookaround refuses `059/1820`
    // because a four-digit run is a copyright year, not a pair. With no number
    // line, `extractFields` falls back to the first strip line as the badge
    // source — over a band that is the illustrator credit, over a whole card it
    // is the card's TOP line — and the window scan reached `ASC` off flavour
    // text. That is the `badge WRONG 1` in the `paddle-full` row, and it is the
    // one thing this rung does that `fields.ts` does not.
    const m03 = RECORDED.find((c) => c.id === 'm03_t43s_B2-225')
    assert.ok(m03)
    const got = extractFullCropFields(m03.lines.map((text) => ({ text, y: BELOW_THE_BAND })))
    assert.equal(got.number, null)
    assert.equal(got.setCode, null)
  })
})

// ── the name band ──────────────────────────────────────────────────────────

describe('the name band', () => {
  /** Every recorded card's real prose, so the counter-example is not one a test
   *  author imagined an OCR engine might produce. */
  const CARD = [
    { text: 'STAGE2', y: 0.03 },
    { text: 'Team Rockets Orbeetle 130', y: 0.08 },
    { text: 'Ability Rocket Brain', y: 0.42 },
    { text: 'often as you like during your turn you may move a damage counter', y: 0.5 },
    { text: 'DRIN 089/182', y: 0.93 },
  ]

  it('takes the title out of the band and leaves the attack text alone', () => {
    const got = extractFullCropFields(CARD)
    assert.equal(got.name, 'Team Rockets Orbeetle')
    assert.equal(got.number, '089')
  })

  it('WOULD OTHERWISE PICK THE LONGEST LINE OF BODY TEXT', () => {
    // The measured failure this band exists to stop: run the same rules with no
    // positional filter — every line a name candidate — and "most letters left
    // after the furniture" takes the attack text, on 21 of 21 recorded rows.
    // Reproduced here by moving one line into the band.
    const got = extractFullCropFields(
      CARD.map((l) => (l.text.startsWith('often as you like') ? { ...l, y: 0.15 } : l)),
    )
    assert.equal(got.name, 'often as you like during your turn you may move a damage counter')
  })

  it('is exactly ROIS.name, and silent below it', () => {
    // An inset card whose title has been pushed past the band reads as NO NAME.
    // Deliberate: the number carries the rescue when it is there, and when it is
    // not, the title travels in `bodyLines` as text rather than as a claim.
    const justInside = extractFullCropFields([{ text: 'Stevens Metang 100', y: ROIS.name.y1 - 0.001 }])
    const justOutside = extractFullCropFields([{ text: 'Stevens Metang 100', y: ROIS.name.y1 }])
    assert.equal(justInside.name, 'Stevens Metang')
    assert.equal(justOutside.name, null)
  })

  it('still applies every furniture rule inside the band', () => {
    // `fields.cleanNameLine` is not bypassed — the band decides which lines are
    // candidates, not what a candidate means.
    assert.equal(
      extractFullCropFields([
        { text: 'Item TRAINER', y: 0.04 },
        { text: 'Arvens Sandwich', y: 0.1 },
      ]).name,
      'Arvens Sandwich',
    )
    assert.equal(
      extractFullCropFields([
        { text: 'STAGE1 Cynthias Gabite 100', y: 0.04 },
        { text: 'Evolvesfrom Cynthias Gible', y: 0.1 },
      ]).name,
      'Cynthias Gabite',
    )
  })
})

// ── the payload ────────────────────────────────────────────────────────────

describe('normaliseBodyLines', () => {
  it('keeps the card prose a family-text rung could use', () => {
    assert.deepEqual(
      normaliseBodyLines([
        'Ability Rocket Brain',
        'often as you like during your turn,you may move',
        'It emits psychicenergytoobserve and study',
      ]),
      [
        'Ability Rocket Brain',
        'often as you like during your turn,you may move',
        'It emits psychicenergytoobserve and study',
      ],
    )
  })

  it('drops pure digits, short scraps and empty lines', () => {
    // All four are verbatim from recorded full-crop reads.
    assert.deepEqual(normaliseBodyLines(['90', '4x2', 'TAG', '   ', '']), [])
  })

  it('DROPS ENERGY-SYMBOL SOUP, by ratio and not by a glyph list', () => {
    // The recogniser returns the type symbols as CJK, stars and box-drawing and
    // the set of things it has returned for them is open-ended, so the rule is a
    // letter RATIO. Every line in this test is verbatim from a recorded
    // full-crop read.
    assert.deepEqual(normaliseBodyLines(['*水水', '线057/182', '**', '4x2']), [])
    // And where the ratio actually draws its line: a row that is mostly WORDS
    // survives whatever symbols are stuck to it. That is deliberate — what these
    // lines mean is the server's decision, and a bar high enough to catch the
    // retreat row also catches `* Waterfall 120`, which is an attack name and
    // exactly the sort of phrase a family-text rung matches on. `escalate.ts`
    // carries the measured ratios.
    assert.deepEqual(
      normaliseBodyLines(['4x2 retreat ***水', '* Waterfall 120', 'weaknessx2 resistance retreat ****']),
      ['4x2 retreat ***水', '* Waterfall 120', 'weaknessx2 resistance retreat ****'],
    )
  })

  it('collapses whitespace so one line is one line', () => {
    assert.deepEqual(normaliseBodyLines(['  If this  Pokemon has 2 or more\tEnergy attached  ']), [
      'If this Pokemon has 2 or more Energy attached',
    ])
  })

  it('caps the count, taking the TOP of the card', () => {
    const many = Array.from({ length: 40 }, (_, i) => `line number ${i} of the card`)
    const got = normaliseBodyLines(many)
    assert.equal(got.length, MAX_BODY_LINES)
    // Top-first: the ability and attack text is what identifies a print, and the
    // copyright line at the bottom is what does not.
    assert.equal(got[0], 'line number 0 of the card')
    assert.equal(got[MAX_BODY_LINES - 1], `line number ${MAX_BODY_LINES - 1} of the card`)
  })

  it('caps the length of each line', () => {
    const long = `${'a'.repeat(200)} tail`
    const [got] = normaliseBodyLines([long])
    assert.equal(got.length, MAX_BODY_LINE_CHARS)
    assert.equal(got, 'a'.repeat(MAX_BODY_LINE_CHARS))
  })

  it('caps AFTER filtering, so junk cannot crowd out prose', () => {
    const junk = Array.from({ length: 30 }, () => '4x2')
    const got = normaliseBodyLines([...junk, 'Search your deck for a Supporter card, reveal it'])
    assert.deepEqual(got, ['Search your deck for a Supporter card, reveal it'])
  })
})
