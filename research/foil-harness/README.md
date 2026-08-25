# foil-harness — script inventory

The measurement harness behind `research/FOIL-DETECTION.md`, copied verbatim
from the capture session's scratchpad. Rounds and attempts below refer to that
document's sections. Every script hardcodes the capture session's `DIR`/`SRC`
paths, which no longer exist — re-point them before rerunning anything.

| File | Round | What it is |
|---|---|---|
| `extract.mjs` | 1 | Clips → labelled frames, cropped to the card's region (first extraction pass). |
| `cardcrop.mjs` | 1 | Card-interior crop, added after the first measurement pass scored at chance on ~40%-background frames. |
| `measure.mjs` | 1 | First feature pass (specCov/blowout/topSat/contrast/hf) at live-scanner and photo resolutions. |
| `extract_full.mjs` | 1 | Clips → labelled 1080 px frames, no crop (cropping broke corner detection) — pipeline step 1. |
| `rectify.mjs` | 1 | First corner-detect + homography warp to 320×448 card space; Otsu-on-luminance card detection (merged card/hand/table into one blob). |
| `rectify2.mjs` | 1 | The rectifier that worked — Sobel-energy texture field instead of brightness; 131/146 frames — pipeline step 2. |
| `measure2.mjs` | 1 | Features in canonical card space, within-pair AUC + leave-one-pair-out — pipeline step 3. |
| `features-rectified.json` | 1 | Per-frame measurements (corrLS/meanSat/specFrac/hf/p99) on the rectified frames — the data behind the round-1 feature tables. Its measuring script was not among the files copied. |
| `register.py` | 2 | SIFT + RANSAC registration against the catalog image (139/146 frames), then dividing the artwork out. |
| `corrls.py` | 2 | corrLS re-measured on registered card-only pixels — the 9/17 correction of round 1's headline. |
| `motion.py` | 2 | Temporal change between frames of the same segment (moveSd, and relSd = flat ÷ edge). |
| `scale.py` | 2 | Scale separation of the residual into shading vs specular (the twelve-feature, best-11/17 dead end). |
| `masks.py` | 3 | Body/art region masks from the modern layout, drawn on the catalog images. |
| `region.py` | 3 | Body-vs-art measurement within one frame (moveRatio, exBody, exArt, exDiff). |
| `satviz.py` | 3 | Per-pixel saturation-shift visualisation confirming the layout reading. |
| `stroke.py` | 4, attempt 1 | Keyline via threshold-and-dilate in the photograph — failed; the catalog control scored higher than real normals. |
| `stroke2.py` | 4, attempt 2 | Keyline as a direct A/B against the registered catalog print — failed on exposure. |
| `stroke3.py` | 4, attempt 3 | Glyph positions from the reference, halo measured within the photograph (haloDesat) — the working measurement. |
