---
date: "2026-11-25"
title: "Scanner auto-capture waits for a sharp frame"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-11-25 — Scanner auto-capture waits for a sharp frame
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** An automatic capture now fires only on a sharp frame of the locked card.
- **The measure:** the engine reports `EngineState.sharpness`, the Laplacian variance of the luma in the middle of the locked quad on the working image (`engine/sharpness.ts`).
- **The rule** (`ui/focusGate.ts`), checked on every lock tick through `decideAutoCapture`:
  - A tick fires when it scores at least 300 and at least 0.7 of the track's sharpest tick in the last 2 s.
  - Once the track has been locked 1.2 s, a tick within 0.85 of that best fires anyway. A low-texture card, such as a basic energy or a card behind a hazy toploader, is still taken, on its best frame.
- **What the reader sees:** while the gate holds, the hint reads "Hold still — focusing…".
- **What is not gated:** manual captures. A tick with no measurement never holds.
- **Telemetry:** lock and capture events now record `sharpness` and `focusWait`, so the floor can be re-measured from the field.

**Why:** In the owner's 2026-11-25 session on deckpal.app, 5 of 17 auto-captures were blurred, and none of the five identified. The old policy asked only that the lock was steady, and steady is not sharp: the camera hunts focus after a card arrives, and a hand still drifts.
- **Measured in this space** (canonical 416 frame, quad shrunk 20%): the five blurred captures scored 101–259 and the twelve sharp ones 375–1403. Every blurred one waits under the gate and every sharp one fires at once.
- **Jitter does not separate them.** A blurred Azurill had 5.9 px of jitter, which points to focus blur rather than motion.
- **One case shows the gain directly.** A Hypno captured blurred at 155 was captured sharp at 508 by the same track 0.85 s later.
- **Why not one fixed threshold on the captured crop:** on earlier live captures a fixed threshold would have refused 10 crops, 6 of which identified fine. Sharpness depends on the card and the sleeve, so the gate is relative to the card's own best frame, with a timeout.

**Implications:**
- **Speed:** a sharp card fires on the same tick as before. A blurred or still-focusing card waits for focus, up to 1.2 s.
- **Calibration:** the floor comes from one session, and drawImage's downscale may score frames somewhat differently from the offline measure. The recorded `sharpness` is how the next session re-measures it.
- **Not fixed here:** a card held so close that it extends past the detector's square still locks onto its inner frame (1 of 17 that session).
