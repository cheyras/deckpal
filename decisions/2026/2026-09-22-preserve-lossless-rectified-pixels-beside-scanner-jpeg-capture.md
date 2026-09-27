---
date: "2026-09-22"
title: "Preserve lossless rectified pixels beside scanner JPEG capture"
decided_by: "DeckPal Todoist implementation worker on behalf of @cheyras"
areas: ["scanner"]
supersedes: []
---
## 2026-09-22 — Preserve lossless rectified pixels beside scanner JPEG capture

**Decided by:** DeckPal Todoist implementation worker on behalf of @cheyras

**Decision:** A scanner capture now exposes an ephemeral typed RGBA buffer, with its width and height, alongside the unchanged JPEG, canonical quad, and track id. One shared path rectifies the retained observed frame once using the existing canonical-to-crop mapping, 5% margin, per-game card aspect, 480 px width, bilinear sampling, and JPEG quality; it retains those pixels before encoding, while `rectifyToJpeg` remains a compatibility wrapper over the same path.

**Why:** A future validated foil classifier needs lossless rectified colour data. Decoding the identity JPEG would introduce chroma loss and make classification depend on compression rather than the observed frame.

**Implications:** The raw buffer is in-memory only and is not added to feed entries, storage, telemetry, or network requests. Identity behavior, detect cadence, and single-variant UI behavior are unchanged. Task 6hJWCpj6FhjPQGFP remains partial: no production foil classifier exists, and no classifier accuracy or threshold is claimed until one is validated against real data.

