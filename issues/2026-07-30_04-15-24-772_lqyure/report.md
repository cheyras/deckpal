---
id: 2026-07-30_04-15-24-772_lqyure
status: resolved
resolvedAt: 2026-07-31T21:30:00.000Z
resolution: Measured root causes — dHash had zero rotation tolerance (4deg tilt = 40% top-1 while still confidently locking wrong cards) and the client cropped exactly to the guide box so tilted cards lost edges at capture. Fixed with a unified index+query hash pipeline (dhash8v2) + ~33 geometric probe candidates (rotations, keystones, zoom) server-side, 14% capture margin client-side, CONFIDENT_MAX 12 to 9 (junk frames now rejected). Benchmark on 150 cards x 10 degradation scenes through live POST /scan — mean top-1 73% to 95% (rot4 40 to 93, rot8 6 to 95, combined-photo 56 to 88); full 22,770-card re-index; scanner UI verified in browser incl fake-camera E2E auto-locking a rotated off-center card.
createdAt: 2026-07-30T04:15:24.772Z
page: /pokedex/scan
viewport: 428x524
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: (none)
---

Card scanner is inconsistent. Sometimes it hits the nail on the head and returns the exact correct card. But the majority of the time it’s way off.

Additionally, it’s really finicky about placement in the frame, making it fairly hard to use.
