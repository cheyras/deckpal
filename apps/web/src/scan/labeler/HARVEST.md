# Harvesting the quad corpus

How a training run pulls the labels this tool writes, and what it must check
before trusting them. Written 2026-09-07, against `labelSchema` 2.

The authority for every field is `types.ts` — this file is the reading order and
the traps, not a second copy of the schema.

---

## 1. Where the rows are

Everything goes through one endpoint, `/dev/scan-flags`
(`apps/api/src/dev/scanFlags.ts`), and each label is **two objects sharing one
id**, where the id is the epoch-ms capture time:

| call | gives you |
|---|---|
| `GET /dev/scan-flags?limit=5000` | the listing — `{ id, files, size, uploadedAt, comment }`, newest first |
| `GET /dev/scan-flags/{id}.json` | **the label** — the meta object this tool posted |
| `GET /dev/scan-flags/{id}.png` | **the frame** — the canonical square, `dims` px, exactly what the label's `corners` are fractions of |

Owner-gated on production, open on preview deployments and self-host. Sign in as
the QA account (`.qa-account`), not the owner's — `AGENTS.md` B12.

### The bucket is shared. Filter first.

`/dev/scan-flags` also holds the scan harness's live-camera flags and the
product scanner's per-capture reports. They are all frame+annotation records and
they are not labels.

```
rows.filter(r => r.type === 'quad-label')
```

### The listing cap is real

`?limit=` clamps to **1..5000**, defaulting to 1000. The listing call sees every
key under the prefix either way — the cap bounds the response, not the scan — so
`?limit=5000` is what a harvest wants. Round 9 measured 2 166 rows spanning six
days against that cap, so there is headroom, but a harvest that finds exactly
5 000 rows has hit the ceiling and is missing older ones. Check for that before
concluding the corpus is small.

---

## 2. Read the version before anything else

```
const schema = row.labelSchema ?? 1     // types.ts labelSchemaOf()
```

**A missing `labelSchema` IS version 1.** The field did not exist on 2026-09-04.
Defaulting a missing value to the current number silently claims orientation and
face data that is not in the row.

### Mixing v1 and v2 — the corpus is meant to be mixed, not chosen between

| field | v1 (2026-09-04) | v2 (2026-09-06 →) |
|---|---|---|
| `corners`, `dims`, `source`, `savedAt` | yes | yes |
| `invalidReason` | 3 reasons | **9 reasons** |
| `topLeftIndex` / `seededTopLeftIndex` | absent | on every positive |
| `face` | absent | on every positive |

**The v1 mapping** (`types.ts` `LEGACY_REASON_MAP` / `migrateLegacyReason`, total
over the v1 union by construction):

- `multiple_cards` → `multiple_no_clear_foreground` — same rule, renamed from
  describing the frame to describing the verdict. Approximate.
- `too_blurry` → `too_blurry` — unchanged.
- `no_card` → `no_card` — **same name, narrower meaning.** v1 had nowhere to put
  a card-like non-card, so v1 `no_card` rows are a MIXTURE of empty frames and
  envelopes/labels/screens. **Do not mine v1 rows for the `not_a_card`
  hard-negative class** — that class starts at schema 2 and has no v1
  population.

**Absence means UNKNOWN, never a default.**
- No `topLeftIndex` → the orientation head skips the row. It is still a perfect
  quad-regression example.
- No `face` → the face head skips the row. **Never read a missing face as
  `front`**: a v1 labeler could not say "back", and the owner's own sessions
  contain three backs saved as plain positives. Defaulting them would feed a
  small corpus a handful of confidently wrong labels, which is the one thing it
  cannot absorb.

---

## 3. The 2026-09-07 additions, and the rows that predate them

Still `labelSchema: 2` — these add provenance, not meaning, so the version does
not move and no reader breaks. But they are **absent on the six schema-2 rows
recorded 2026-09-06**, and absence is again UNKNOWN.

| field | what it is for |
|---|---|
| `stream: {width,height}` | the camera stream's or uploaded photo's own resolution |
| `crop: {x,y,size}` | the centre square taken from it (`engine/frame.ts` `squareCrop`) |
| `pipeline.hasObj` | the raw presence head for this frame, ungated |
| `pipeline.seedAcquireThreshold` | what `hasObj` was judged against at labelling time |
| `pipeline.seedFallback` | why a `default` row fell back |
| `pipeline.seedMs` | wall time of the seed, diagnostic only |

### `stream` + `crop` are the inverse map back to the photo

`dims` is **always the canonical square** (416x416), so before these fields every
row looked like a 416x416 photo and a 12 MP phone frame was indistinguishable
from a webcam grab. With them, a normalized corner maps back to a source pixel
using the shipping function, not a re-derivation:

```ts
import { CANONICAL_SIZE, canonicalToStream } from '../engine/frame'
const px = canonicalToStream([nx * CANONICAL_SIZE, ny * CANONICAL_SIZE], row.crop)
```

Use it to weight by real detail, and to go back to the original photo when the
416px PNG is not enough.

### `seedFallback` — the field that makes `seededFrom` readable

`seededFrom: 'default'` means two opposite things and until 2026-09-07 the row
could not say which:

- `'no_object'` — **the model ran and said no.** Real signal about a real frame.
  A row that is `no_object` AND carries a human positive quad is a recorded
  detector MISS, which is the most valuable row in the set.
- `'no_quad'` — presence opened but the corner output was not four finite
  points. Rare; a model fault.
- `'unavailable'` — **the detector never ran here.** Assets failed, the budget
  expired, the canvas could not be read. Says nothing about the frame. Never
  mine it as a miss.

> **Every `seededFrom: 'default'` row recorded before 2026-09-07 is
> `'unavailable'` in fact and carries no field saying so.** Rounds 9, 9b and 9c
> established that the old canvas-`captureStream` transport never delivered a
> frame to the engine, so the detector had not run once — on any row, on any
> device. Treat a `default` row with no `seedFallback` as UNKNOWN, and in
> particular:
>
> **`seededTopLeftIndex` on a pre-2026-09-07 row is the geometric rule applied
> to the centred fallback rectangle, not to a detector quad.** The
> `topLeftIndex !== seededTopLeftIndex` rate over those rows measures nothing
> about `rectify.ts`'s orientation residual. Only rows with
> `seededFrom: 'detector'` count toward that number.

---

## 4. What a training run should assert before using a row

```
type === 'quad-label'
labelSchema ?? 1                            // branch, never default forward
corners === null  XOR  corners.length === 4 // the union's discriminant
corners  -> topLeftIndex, seededTopLeftIndex, face all present (v2)
corners === null -> invalidReason present, no anchor, no face
pipeline.pipelineVersion === 3              // canonical square; a 1 or 2 row
                                            // means something else by "corners"
pipeline.canonicalSize === dims.width === dims.height
every corner within [-0.15, 1.15]           // the editor's own drag clamp
the {id}.png exists and is dims.width square
```

`pipelineVersion` is the one that silently ruins a run: version 3 corners are
canonical-square fractions; versions 1 and 2 were stream-relative and mean a
different thing. Branch on it, do not assume it.

---

## 5. Two facts about the seed worth knowing before you read the quads

Measured 2026-09-07 on a local production build, headless Chrome.

**The detector's proposal is genuinely good when the card has margin, and
genuinely an interior rectangle when it does not.** On a fixture where the card
filled ~84% of the canonical square, `hasObj` was 0.990 and the seeded quad was
the card's lower TEXT PANEL — not its outer boundary. On the same card
re-composited to 46% of the frame, `hasObj` was 0.999 and the quad hugged the
outer edge (IoU 0.93 against a measured truth). This is exactly the
margin-sensitivity `engine/index.ts` `INFERENCE_RECT` documents for LC050, and
it is the reason the reader is dragging corners at all. A corpus of corrections
against tight framings is the point, not a defect.

**A `seededFrom: 'detector'` row is a recorded agreement or disagreement with
production; a `default` row is neither.** When counting how often the geometric
anchor rule is wrong, filter to `seededFrom === 'detector'` first.

---

## 6. Where each gate sits, and why

Added 2026-09-08 with `too_obscured` and `too_bent`, in answer to the owner's
question: *at what point is it genuinely too blurry — just blurry enough that
OCR fails, or only when the artwork is illegible?*

### The rule that decides every one of them

**A rejection is a claim about the QUAD, not about the scan.** A negative row
is `corners: null`, and what it trains is a detector that emits nothing for
frames like this one. So the gate on every `unquaddable` class is the same
question — *can a human confidently place the four corners?* — and the specific
tag only says which obstacle stopped them.

That is why "blurry enough that OCR fails" is the WRONG line. OCR, the pHash
and the CLIP embedding all read the card's INTERIOR. The detector reads its
BOUNDARY. A frame whose artwork is mush but whose dark border is still a crisp
line is a frame the detector should absolutely quad, and is one of the more
valuable positives in the corpus, because it teaches the boundary task
independently of the identification task.

### The asymmetry that makes the rule worth stating

The two errors do not cost the same:

| error | what it teaches | recoverable? |
|---|---|---|
| Rejected a frame that was quaddable | the detector to give up on frames like it | **No.** Nothing downstream can act on a quad that was never emitted. |
| Quadded a frame that turns out unidentifiable | nothing wrong — the boundary label was true | **Yes.** The identifier returns no match, the reader moves the card, the next frame lands. |

So the tie-break is fixed: **when in doubt, place the corners.**

### The gates

| class | the gate | not the gate |
|---|---|---|
| `too_blurry` | The edge has smeared into a gradient wider than you can resolve a corner within — place each corner twice and see if you land in the same spot. Roughly: worse than ±1–2% of the card's short edge (±4–8 px on the 416 canonical). | "OCR would fail." `refineQuadChecked` snaps to a gradient field; if the gradient still has a ridge, refinement works and the frame is a positive. |
| `too_obscured` | **A corner you cannot see**, or an edge with more than about a third of its length hidden — you need enough edge left to fit a line through. | "I can no longer tell which card this is." That is the identifier's question. Fingers across the artwork with four corners clear is a positive. |
| `too_bent` | Sight the straight line joining two adjacent corners; if the card's edge visibly bows off it (say, past ~2% of the long edge), a four-corner quad has stopped describing the card. | Any curve at all. A gentle bow is the normal state of a card in a hand, its edges still read straight, and the detector must not learn to fear it. |
| `too_far` | The card no longer occupies enough of the frame for the corners to be distinct pixels rather than one blob. Below roughly a quarter of the frame's width, the rectified crop is pure upscaling. | "It looks small." |
| `too_oblique` | The far edge has foreshortened so hard you are guessing where the two far corners are. | A visible perspective. The quad is four independent points precisely so it can carry perspective — that is the case it is FOR. |
| `too_dark` / `glare_washout` | The border has been crushed into the background (dark) or blown into the highlight (glare) along enough of its length that a corner is a guess. | The artwork being hard to read. |

### `too_obscured` is deliberately not two tags

A thumb has two quite different effects, and only one of them is a rejection:

* **over a corner** — unquaddable, because the model at inference has to *see*
  that corner. A human can infer it from the other three and the fixed 63:88
  aspect; labelling that inference teaches the detector to hallucinate corners
  under occlusions, which is the precise failure you would then have to unlearn.
* **over the middle** — perfectly quaddable, and a positive.

The second case may well be unidentifiable, which is a real product problem —
but it belongs to a future *identifiability* head, not to this one. Folding it
in here would put `corners: null` on frames whose corners are plainly visible.

### `too_bent` is the one class where good corners still mean no

Every other rejection is "the corners are unavailable". This one can have four
crisp corners and still be right, and the reason is `rectify.ts`: the homography
it solves from four points is exact **only for a plane**. A bowed card yields a
warped crop from perfect corners, and — more to the point here — the ground
truth itself becomes ill-defined, since the card's boundary is no longer the
quadrilateral joining its corners.

Watch the counts. If `too_bent` stays rare, it is doing its job as a
severe-curl class. If it starts collecting a large share of hand-held frames,
the gate has drifted toward "any curve" and the corpus is being taught to refuse
the normal case.

### These two classes have no v1 or v2 population

Like `not_a_card` before them, they start here. A harvest must not back-fill
them from older rows — a labeler without the button cannot have meant it, and
`LEGACY_REASON_MAP` can only ever produce the three names it knows.
