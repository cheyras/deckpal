---
id: 2026-07-29_04-21-08-968_9vi2is
status: resolved
resolvedAt: 2026-07-29T07:36:47.169Z
resolution: Scanner reworked: (1) accuracy — root-caused as background-margin (whole-frame dHash sampled background); added query-side background-trim min-combined ranking (phash.ts/router.ts), background-margin recognition 0%→100% in a 44-card eval, indexed cards self-match at distance 0; (2) reindexed the newly-warmed energy/promo/etc cards (coverage 22,475/23,444) so they're now recognizable (verified mee-001, mep-010 → distance 0); (3) UX — rebuilt Scan.tsx as an embedded live rear-camera with a card-shaped alignment guide that auto-triggers on a stable confident match (no shutter), graceful upload fallback when camera/secure-context unavailable. Note: live-camera auto-capture needs on-device confirmation via the HTTPS URL (getUserMedia needs a secure context); ~969 residue cards still lack art so aren't scannable yet.
createdAt: 2026-07-29T04:21:08.968Z
page: /pokedex/scan
viewport: 401x451
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: (none)
---

A few things with the card scanner for stuff it doesn’t work at all. It doesn’t recognize any of the cards I’ve tried and it gives me pretty nonsensical. You know closest guesses they they don’t actually make any sense besides that the experience just isn’t good like I would actually like it to feel like a scanner where the camera view is just embedded in the page, and as soon as a card is aligned, it just kind of triggers and shows the result rather than like clicking the take a picture or upload buttons yeah I just have it feel like an actual scanner if we can
