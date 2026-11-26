---
date: "2026-11-25"
title: "Scanner calls no AI APIs: the vision-model read is removed"
decided_by: "Chey"
areas: ["scanner", "ai"]
supersedes: ["2026-11-25-scanner-reads-printed-fields-with-a-vision-model-on-the-server"]
---
## 2026-11-25 — Scanner calls no AI APIs: the vision-model read is removed
**Decided by:** Chey

**Decision:** The scanner does not call any AI API. `POST /api/scan/read` and the client's call to it (PR #390) are removed, along with the ladder's `readSource: 'vlm'` hold, `SCAN_READ_MODEL`, and the benchmark's `--ocr vlm:` mode. The scanner identifies cards with what it runs itself: the dHash and image-vector indexes, the resolve ladder, and the device OCR.

**Why:** The owner's standing ruling is that the scanner must work without spending AI credits. Earlier it was put as "cloud vision model strictly a safety net", and the owner restated it after #390 shipped. #390 sent every capture to Claude Sonnet 5.5 through the AI Gateway, about $0.003 a scan, on the reading that "models are better now" was permission. It was not, and nobody asked.

**What it cost to remove:** little.
- **Today's field session** (17 Delta Reign captures, replayed with fresh indexes): 16 confident and right, 0 wrong, with the device OCR, the same as with Sonnet's reads.
- **The 261-card benchmark:** 218 right and 0 wrong with device OCR, against 237 right and 1 wrong with Sonnet. Most of that gap is the old 229×320 telemetry crops, which production no longer produces.

The changes that made the step change call no AI: index freshness (#388) and the focus gate (#389).

**Implications:**
- **No cost per scan:** the scanner's only per-scan costs are the dHash and vector queries it already ran.
- **Printed keys still come from device OCR only,** which is owner-only on production. Making it reach every reader, or reading the number better without a model (higher capture resolution), are the levers that remain.
- **The CodeQL fix stays:** the regex rewrite in `resolve.ts` that shipped in the same squash is kept.
