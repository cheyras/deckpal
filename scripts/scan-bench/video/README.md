# scripts/scan-bench/video — a video file as the scanner's camera

One question: **pointed at a continuous stream, what does the shipping scanner
auto-capture?** Which frame fires, which locks are swallowed as duplicates,
which cards never fire at all, and whether the crop that does fire is one the
identification bench can read.

The replay runs the engine's per-frame path and Scan.tsx's auto-capture
policy over a video, offline, and writes the 480x670 crops the device would
have POSTed. It does **no identification**. Feed `captures/` to
`scripts/scan-bench/bench.ts` for that.

## Scoring a replay against ground truth

`score_video.py` identifies every fired capture with the identity matcher
(production pairing, the model's gate including the wide tier) and matches it
by time to hand-made ground truth in `~/deckpal-data/video-bench/gt/<id>.json`
(appearances with `start`/`end`, `cardId` or `candidates`, `capturable`):

```bash
python scripts/scan-bench/video/score_video.py --run runs/<name> [--show-wrong]
```

It prints capture recall, auto-ID recall (confident and right), duplicate
captures inside one appearance, stray captures outside every appearance, and
confident-wrong captures (the number that must stay 0).

Only captures inside the ground truth's `window` are scored. A replay usually
runs the whole video, and nobody has looked at what a capture outside the
labelled stretch shows. A capture taken while two cards are on screen at once,
so that both appearances' own windows hold it, is right if it names either card.

## Running

```bash
# Inputs: ~/deckpal-data/cc-videos/raw/<id>.mp4. A path to any video also works.
node --import tsx scripts/scan-bench/video/replay.ts JP-MdK4Kr00 RLULfTjTFSs 46OLXH5-aLQ
node --import tsx scripts/scan-bench/video/replay.ts clip.mp4 --start 10 --end 40
```

| flag | default | meaning |
|---|---|---|
| `--fps` | 8 | detect cadence (field telemetry `perf.hz` ≈ 8.1) |
| `--busy-ms` | 500 | how long a capture holds `captureBusyRef` (see Deviations) |
| `--lock-ticks` | shipping `DEFAULT_LOCK_TICKS` | the lock dwell, to replay another value |
| `--no-rearm` | off | replay the policy without the look re-arm (`scan/ui/rearm.ts`) |
| `--batch` | 16 | LC050 frames per sidecar call |
| `--timeline-every` | fps | ticks between timeline tiles (1 per second by default) |
| `--out` | `~/deckpal-data/video-bench` | output root |

Environment: `PY` (default `~/deckpal-data/venvs/scanid/Scripts/python.exe`,
which needs numpy + onnxruntime), `FFMPEG` (default: the path in
`~/deckpal-data/cc-videos/ffmpeg-path.txt`, then `ffmpeg` on PATH),
`DECKPAL_DATA`, and `LC050_THREADS` to pin ORT's threads. The sidecar always
runs with `OPENBLAS_NUM_THREADS=1`. A 60-80 s short takes 10-15 s of wall time.

## Outputs, per video, under `<out>/<videoId>/`

| file | what |
|---|---|
| `captures/<t>.jpg` | every FIRED capture: 480x670, 5% margin, JPEG q85. `<t>` is video seconds |
| `suppressed/<t>-<reason>-trk<id>.jpg` | the first suppressed lock of each track for each reason, warped the same way, so you can judge by eye whether the suppression refused a duplicate or a new card |
| `captures.jsonl` | one row per fired capture (`suppressed: false`) and per suppressed lock episode (`"region"` / `"busy"`): `t`, frame index `i`, `trackId`, `trackAge`, `quad` (canonical 416), `quadStream` (960x1280 stream), `quadSource` (video px), `hasObj`, `gateOpen`, `saturation`, `aspect`, `parallel` (the straddle ratio), `motionPx`, `sharpness`, `regionCount`, `regionsExpired`, and for suppressed rows `trackFiredAt` |
| `frames.jsonl` | one row per detect tick: `hasObj`, `gate`, `obs` (the gated, refined quad) with `obsWhy` when the tracker's reticle filter would refuse it, `sat`, `stable` tracks (`id`, `age`, coasting `c`, `q`, `mot`, and `why` when the track is not lock-eligible), `pending`, `locked`, `regions`, and `event` (`fire` / `refractory` / `busy` / `region` / `capture-failed`) |
| `contact.png` | the fired captures, timestamped, with sharpness/motion/saturation under each |
| `contact-suppressed.png` | the suppressed crops |
| `timeline.png` | the canonical frame once a second, with the reticle (grey), the observation (yellow), stable tracks (green; dark green while coasting) and the lock (red). A red border means a capture fired since the previous tile, orange means only suppressions happened |
| `summary.json` | the counts below, the tick funnel and blocker histograms, and the geometry |

Counts in `summary.json` and on the console:

- **lockTicks**: ticks where the engine reported a lock.
- **lockedTracks**: distinct track ids that reached a lock.
- **captures**: fired captures.
- **regionSuppressedTracks**: locked tracks that never fired because a live
  captured region covered them. That is the duplicate suppression working, or
  its fast-swap cost (see below).
- **busyDeferredTracks**: locks that arrived inside the busy window. At 8 Hz a
  new track can't lock before age 5 (625 ms), so this is almost always 0.
- **funnel**: gate open > observed > in reticle > stable > lock-eligible >
  locked, in ticks, with the reasons each step lost ticks to (`blockers`).

`sharpness` is the variance of the 3x3 Laplacian over the card interior (10%
inset) of the lossless crop. Below ~50 is visibly smeared, and sharp card print
scores several hundred. Compare it within one video: source resolution moves it
a lot. `motionPx` is the mean corner movement of the locked track's raw
observation since its previous observation, in canonical 416 px. It includes
the detector's own corner noise, which is roughly 2-10 px on a still card.

## What is the product and what is not

Every decision is made by an imported shipping module, never by a copy of its
rules:

| stage | shipping code |
|---|---|
| presence gate | `engine/gate.ts` `createPresenceGate` (0.80 / 0.30) |
| refinement, card signature | `engine/refine.ts` `gradientField`, `refineQuadChecked`, `quadMeanSaturation` |
| tracker | `engine/tracker.ts` `createTracker` |
| lock (dwell, aspect, straddle, saturation) | `engine/index.ts` `createLockPolicy` |
| reticle, canonical square | `engine/frame.ts` `reticleForAspect`, `squareCrop`, `modelPointsToCanonicalQuad`, `canonicalQuadToCrop` |
| duplicate regions | `scan/ui/regions.ts` `createCapturedRegions` |
| a card's look, the look re-arm | `engine/look.ts` `cardLook`, `captureLook`; `scan/ui/rearm.ts` `createLookRearm` |
| rectification | `engine/rectify.ts` `expandQuad(CAPTURE_MARGIN)` + `rectifyImageData` at `cardRectSize()` |
| model tensor | `engine/preprocess.ts` `rgbaToBGRPlanar` |

The glue is mirrored, because it lives inside a canvas closure and a React
effect that node can't run. `session.ts` cites the lines for each piece:
index.ts `tick()` (619-736), `capture()` (799-840), and Scan.tsx's auto-capture
effect (1237-1306) and `runCapture` (1197-1232).

### The virtual phone (`phone.ts`)

The engine only reads the **centre square of the camera stream**. So the video
is first made to look like the stream the owner's phone delivers. Every
telemetry record with a `stream` field says 960x1280, which comes from
camera.ts:41's 1280x960 request rotated to portrait. Each frame goes through:

1. the largest centred 3:4 portrait crop of the video frame;
2. a lanczos resize of that crop to 960x1280;
3. `squareCrop(960, 1280)`, the engine's own function, which gives the centre
   960x960. That square is the capture buffer, as `grabCaptureFrame` holds it.

From the square, the model input (256) and the refiner's working image (416)
are smooth downscales, as `drawModelInput` and `grabWork` make them.

## Deviations, each one precise

1. **Pixels.** ffmpeg decodes and does the viewport crop and resize. sharp
   (lanczos3) stands in for canvas `drawImage` for the 256 and 416 downscales,
   the same substitution `__tests__/offline-harness.ts` makes. The browser's
   resampler differs, so there are sub-pixel differences in model input.
2. **Model.** LC050 (`apps/web/public/scan-assets/lc050.onnx`) runs under
   python onnxruntime in a long-lived process (`lc050_stream.py`), one frame per
   `run()` call as `ort_sidecar.py` does, instead of under onnxruntime-web WASM.
   It's the same graph. ORT-web's loader is the only thing not covered.
3. **JPEG.** sharp's libjpeg at quality 85 replaces the browser's
   `convertToBlob({ quality: 0.85 })`. `check-a.ts` makes the same substitution.
4. **Clock.** Detect ticks happen at exactly `i / fps` of video time. The
   device's ticks are a 120 ms floor plus "previous tick finished" on rAF
   (index.ts:738-757), which measures 7.5-8.1 Hz with jitter. The regions'
   `Date.now()` (Scan.tsx:416, :424) is replaced by tick time. Region timing
   (5 s departure, 1.5 s bridge) is therefore quantised to 125 ms.
5. **Capture frame.** The capture warps the tick's own frame with the tracked
   track's `raw ?? quad`. That is what `capture()` does via its double-buffered
   `capRead`. On the device the effect runs a few ms after the emit, and no
   other tick can land in that window, so the frame is the same one.
6. **Busy window.** `captureBusyRef` is browser timing. It covers `capture()`
   plus `handleCaptured` up to `markArrived()`: one frame, the 300 ms courier
   and the 90 ms bump (motion.ts), about 500 ms in all. Identify, OCR and the
   embed are detached (Scan.tsx:991-1006) and don't count. `--busy-ms` changes
   the window.
7. **Region note timing.** `noteCapture` runs after `capture()` resolves on the
   device, tens of ms after the tick. Here it runs at the tick. No tick can fall
   in between, so no decision differs.
8. **Not modelled.** The `step === 'scan'` / `binExpanded` gates (assumed
   scanning throughout), manual Capture, Discard-and-retake (which releases a
   refractory hold), the lock recorder's 2 s throttle (not a decision), and the
   identity race (detached from capture).
9. **Nobody aims the phone.** The virtual phone is fixed to the video's centre.
   A card the creator holds off-centre, or so close that it overfills the
   square, is a card a real user would have re-aimed or backed away from. Most
   shorts are 608x1080, so the 960 square carries only 608 px of real detail.
   Captures are softer than a phone's, and blur comes from the source's own
   30 fps exposure.

## Reading a run

- **No locks at all for stretches**: check the `timeline.png` hasObj values. A
  card that fills the whole square has no outer boundary in view, and LC050's
  presence head reads it as nothing (hasObj ≈ 0).
- **A new card that never fired**: look in `contact-suppressed.png` for a
  `region` row. Then trace `frames.jsonl` around it. If the previous track died
  and the new one was born less than 1.5 s later on the same spot, that is the
  REGION_BRIDGE_MS re-anchor adopting the new card. Each adoption refreshes the
  region, so a fast flip-through chains it from card to card.
- **A blurred capture**: compare `motionPx` at the fire with the same track's
  later `mot` in `frames.jsonl`. The capture fires on the first lock tick (track
  age 5, 0.625 s after acquisition). The refractory then holds for as long as
  the track lives, so a sharper frame a second later never replaces it.
