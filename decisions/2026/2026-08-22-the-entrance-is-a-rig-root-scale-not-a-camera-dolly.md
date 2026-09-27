---
date: "2026-08-22"
title: "The entrance is a rig-root scale, not a camera dolly"
decided_by: "Claude."
areas: ["scanner"]
supersedes: []
---
## 2026-08-22 — The entrance is a rig-root scale, not a camera dolly
**Decided by:** Claude.
**Decision:** "grows from nothing" is a uniform scale on `DeckE_Root` with a pivot
correction, so he grows about his centre. `setCharacterHeight` is not used for it.

**Why:** that function dollies the CAMERA, with the height in the denominator —
asking it to grow him from nothing asks the camera to travel to infinity, and at
exactly zero the distance is not a number. A dolly can zoom; it cannot make him
small.

**Implications:** nothing below the root has to know — riders and the eye socket
premultiply their parent's inverse world matrix so the factor cancels, the eye
shader works in object space, `look.ts` solves a ratio. What does have to know is
anything measuring him in the world: `screenRect` and the beacon. Minimum scale is
1e-3, because those inverse-world solves are singular at exactly zero.

