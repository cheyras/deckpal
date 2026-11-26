---
date: "2026-11-25"
title: "Scanner reads printed fields with a vision model on the server"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml", "ai"]
supersedes: []
---
## 2026-11-25 — Scanner reads printed fields with a vision model on the server
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Every scanner capture's printed fields (name, collector number, set size, set code) are now read on the server by a vision model. The resolve ladder takes those reads over device OCR, under a stricter rule for keys the model read.
- **The route:** `POST /api/scan/read` (`apps/api/src/scan/readCard.ts`).
  - It sends Claude Sonnet 5.5 the capture's crop through the AI Gateway, with the prompt the benchmark measured, byte for byte.
  - It returns the ladder's `fields`.
  - `SCAN_READ_MODEL` picks the model, and `off` turns the route into a 404. It is metered at 60 reads a minute per user.
- **The client** (`scan/ui/serverRead.ts`) asks at the shutter, beside the image vector.
  - It never throws, gives up after 7.5 s, and latches a 404 for the session.
  - The server's read wins over the device's. The device read (owner-only) is the fallback.
  - The resolve body carries `readSource: 'vlm'`.
- **The ladder** (`resolve.ts` `holdTheModelsKeys`, applied when `readSource` is `'vlm'`):
  - An answer a model-read key decided stops being confident when the read name does not agree with it, or when the image vector is decisive for another card that does not share its picture.
  - Answers the picture decided (`vector`, `corroborated`) are not held for a misread number.
- **The benchmark** has `--ocr vlm:<replies>`, which parses with the shipped `parseCardRead`.

**Why:** The owner asked for the last round of scanner work to be the one that makes most cards confidently right, noting that models are better now.
- **The gap:** the printed key separates printings, and only the owner's phone ever read it, through a 15.6 MB on-device OCR lane that reads a 480×670 number strip poorly.
- **Benchmark:** the scan benchmark (261 real cards, fresh indexes, the real ladder):

| Printed fields from | Confident and right | Confident and wrong |
|---|---|---|
| Device OCR | 218 (83.5%) | 0 |
| Gemini 3.6 Flash read (with the hold) | 225 (86.2%) | 4 |
| Claude Sonnet 5.5 read (with the hold) | 237 (90.8%) | 1 |
| Sonnet, full-resolution crops only | 94 of 101 | 1 |

- **The owner's 2026-11-25 session** (17 me06 captures): 16 confident and right, 0 wrong. With the index stale, as production had it, the vision read still names 8 of 17 with 0 wrong, against 4 for device OCR.
- **Why the hold exists:** a model reads a damaged strip into a plausible key where OCR leaves it out.
  - Without the hold, Sonnet's reads gave 4 confident-wrong answers, among them `PAR` for an sv10 Arcanine and `022/198` for Dolliv `022/182`.
  - The first version also held on a misread number. It cost 52 right answers, all name-plus-picture answers on blurred crops, so it was narrowed to key-decided answers.
- **Haiku 5.5:** about 40× cheaper, but its reads gave 13 confident-wrong answers before the hold, and the zoomed number strip did not help any model.

**Implications:**
- **Cost and latency:** about $0.003 and 1.5–2.5 s a read. It runs in parallel with the vector (2–5 s), so a capture waits no longer.
- **Retesting:** changing the prompt, the model or the parser changes the scanner. Re-run the benchmark with `--ocr vlm:` first.
- **The number strip is still small:** at 480×670 the model reads the name right about 95% of the time and the number 78–82%. Identical-art reprints, which only the number separates, are the largest remaining miss class. Higher capture resolution is the lever for them.
