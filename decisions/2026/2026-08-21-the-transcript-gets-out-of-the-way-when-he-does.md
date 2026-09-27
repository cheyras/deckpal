---
date: "2026-08-21"
title: "The transcript gets out of the way when he does"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — The transcript gets out of the way when he does
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** while Deck-E is out on the page running a UI tool, the chat panel
collapses to a bar showing the last thing the READER said, and his own words
move to a speech bubble anchored beside him. `DeckE.screenRect()` is new, and is
what the bubble is positioned against.

**Why the reader's line and not his.** The panel is minimised precisely because
the page underneath is the point — so the one thing worth keeping on screen is
the question that explains why he is moving. His answer belongs next to the
thing he is answering with.

**No scrim and no scroll lock while minimised.** Both exist to make the overlay
the only thing that matters, and while he is showing you something on the page
the opposite is true. The lock in particular has to go: he may be driving the
page under himself, and a locked body would fight that.

**`screenRect()` is deliberately approximate.** It projects his anchor and the
top of the reference body and takes `BODY_W` as the width. That is not his
silhouette — measured, the real thing is about 2.4x taller once bolts, lid and
the deformation field are counted — and knowing it exactly would mean a bounds
computation over every mesh, every frame, to move one bubble a few pixels. A
bubble placed against a slightly small box sits slightly closer to him than
intended, which is not a defect anyone can see.

**Polled at 8 Hz, not bound to the render loop.** Re-rendering React sixty times
a second to move a bubble is how a 3D character starts feeling expensive; the
engine's own dev page polls its readouts at 5 Hz for the same reason.

**Verified end to end on the real `DECKE_VERCEL_AI_GATEWAY_KEY`** now that
credits are attached. Five adversarial turns: correct states including
`frustrated` aimed at scalpers rather than the user, no command syntax in any
visible text, and the injection probe refused. The duplicate-reply bug is
confirmed fixed by the `spoke && moved` stop condition — a stale test harness
still carrying `stepCountIs(3)` alone reproduced it, and matching the harness to
the handler removed it.

---

