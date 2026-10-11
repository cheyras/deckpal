---
date: "2026-10-10"
title: "Scanner detector: the second look (off by default), and an aimed virtual phone for the video bench"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner detector: the second look (off by default), and an aimed virtual phone for the video bench
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Two additions, neither of which changes what ships today.
- **The second look** (`engine/second-look.ts`, `EngineOptions.secondLook`, default OFF via `index.DEFAULT_SECOND_LOOK`). When a tick's `has_obj` is below acquire and its quad is centred in the reticle, the engine runs LC050 again on a square crop around that quad (1.3x its larger extent, cut from the tick's own full-res frame). It keeps the crop's `has_obj` only when that is higher and the crop found the same rectangle (IoU >= 0.5). The quad always stays the first look's.
- **An aimed virtual phone** for the video replay (`scripts/scan-bench/video`, `--aim x,y,side`). It places the engine square on a chosen source square for a whole run, instead of the frame's centre. `--second-look` replays the engine option through the same module.

**Why:**
- **WuheDPVq_Bo was a framing artifact first.** LC050's `has_obj` was ~0 on 45 of its 49 capturable cards. The creator holds every card low and right in a landscape frame. In 18 of 23 measurable appearances the card's bottom edge is below the centred square, which the engine reads. A card with an edge out of view reads as no card. Aimed at the card (`--aim 770,270,810`, same scale), auto-ID goes from 3 to 13 of 49 with nothing else changed. JP-MdK4Kr00 is not fixable this way: its cards overfill the square and run off the source frame's right edge.
- **What remains is the presence head reading the background.** `has_obj` is a global average pool over the backbone, then one linear layer. It never sees the decoder, so a busy far scene out-votes a card the corner head has found correctly. On the aimed Wuhe frames with a card-shaped quad:
  - as the engine sees them, 32% reach acquire;
  - with the card pasted on flat grey, white or dark, 100% do;
  - with everything beyond 30% of the card blurred, 94% do.
  - Brightness, contrast and blur change nothing. Card size is not the cause either: the card is 0.6-0.73 of the square's height, the phase-0b median.
- **Why the crop's presence and not its quad.** A tight crop makes LC050 return interior rectangles (index.ts `INFERENCE_RECT`). On the bench, taking the crop's quad as well fired captures on text panels and moved captures onto worse frames: aimed-Wuhe auto-ID went 13 -> 13. Keeping the first quad took it to 20.
- **Measured on the 7-video bench** (192 capturable appearances; score_video.py):
  - as replayed, auto-ID 37 -> 41 and captured 60 -> 67;
  - with Wuhe aimed, auto-ID 47 -> 57 and captured 71 -> 87;
  - stray captures +3, duplicates +4, confident-wrong 0 -> 0.
  - Videos that already worked are unchanged or better; none got worse.
- **Why it is off.** It costs a second inference on 76% of ticks (33-96% per video), because most low-presence ticks are empty scenes. Nobody has timed two LC050 runs per tick on the owner's phone.

**Implications:**
- Turning `secondLook` on needs a device test that the detect tick still holds ~8 Hz, and a field test that the extra duplicates and strays are acceptable.
- The cheaper fix is retraining **only** the presence head, a Linear(256->1) that never feeds the corners, so no quad can change. A linear probe on LC050's own pooled features, leave-one-video-out over the 7 videos, took card frames at acquire from 45.8% to 85.9%. False acquires on no-card frames went from 8.9% to 4.9%. It needs presence labels only, no corners, which the video GT windows already give. It should be validated on videos it was not fitted on before it replaces anything.
- Every replay of a creator who frames cards off-centre should state its aim. GT marked `capturable` assumes a phone pointed at the card.
