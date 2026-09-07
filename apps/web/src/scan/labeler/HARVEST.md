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
