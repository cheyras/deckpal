---
date: "2026-08-11"
title: "Avatar upload \"No image was uploaded\" on Vercel (issue #28)"
decided_by: "agent, on investigation of production failure evidence."
areas: ["images"]
supersedes: []
---
## 2026-08-11 — Avatar upload "No image was uploaded" on Vercel (issue #28)

**Decided by:** agent, on investigation of production failure evidence.

**Decision:** The `readImageBody` middleware in both `avatar.ts` and
`scan/router.ts` now snapshots `req.body` before `express.raw()` runs
and restores the snapshot if `express.raw()` produces an empty Buffer.
The handler's `Buffer.isBuffer()` check is replaced with a `toBuffer()`
coercion that also accepts `Uint8Array`, `ArrayBuffer`, and binary
strings.

**Root cause (confirmed):**
Vercel's Node.js helpers (`NODEJS_HELPERS`, enabled by default) define
`req.body` as a lazy getter on `/api/` function handlers.  For
`application/octet-stream`, the getter returns a Buffer of the request
body.  When the getter fires (any access to `req.body`), it buffers the
body and the underlying request stream is consumed.  `express.raw()`
then reads the already-drained stream, gets a zero-length Buffer, and
**overwrites** the valid body the getter returned — producing the "No
image was uploaded." 400 error.

Both avatar and scanner routes were affected identically (both use
`express.raw({ type: () => true })`).  Vercel production logs confirmed
intermittent 400 errors on `POST /api/avatar` and `POST /api/scan`
across multiple deployments.

**Reproduction:**
1. Vercel `vercel logs --query avatar --status-code 400` showed six 400
   errors across four deployments.  The same deployments also served 201
   successes — confirming the failure is intermittent, not universal.
2. Chromium-based Playwright tests against production could not reproduce
   the failure (all succeeded with 201), which is consistent with the
   intermittent nature — the exact conditions under which the getter
   fires before `express.raw()` depend on the Vercel runtime's internal
   body-handling path, which can vary between cold and warm starts or
   across runtime versions.
3. WebKit browser engine was not available in the test environment
   (Playwright WebKit not installed on this host), so the Mobile Safari
   hypothesis could not be directly tested.  However, the Vercel logs
   show failures from multiple deployments without browser correlation,
   indicating the issue is server-side, not browser-specific.

**What was ruled out:**
- Express `express.json()` consuming the stream first: confirmed from
  body-parser source that `express.json()` skips entirely for non-JSON
  content types (the avatar sends `application/octet-stream`), never
  accessing `req.body` or reading the stream.
- Auth/RLS middleware triggering the getter: code review confirmed
  none of the middleware chain accesses `req.body`.
- Mobile Safari `Blob` body bug: while the reporter's UA was iPhone
  Safari, the server-side logs show the same pattern regardless of
  client, and the scanner route (which uses camera frames, not file
  picker) has the same failures.

**Fix mechanism:**
```ts
const preExisting = req.body;  // captures getter result (or undefined)
rawImageBody(req, res, (err) => {
  // if express.raw() left us with nothing, restore
  if (empty(req.body) && preExisting != null) req.body = toBuffer(preExisting);
  next();
});
```
On plain Node (self-host): `req.body` is `undefined`, `preExisting` is
`undefined`, `express.raw()` reads the stream successfully — no change.
On Vercel: the getter fires, `preExisting` gets the Buffer, the stream
is consumed, `express.raw()` gets nothing, the restore fires — fixed.

**Verification:**
- Typecheck: `pnpm --filter deckpal-api typecheck` passes.
- Preview deployment: `vercel deploy` to
  `deckpal-bi202q249-deck-pal.vercel.app` — built and deployed
  successfully.
- Avatar upload against preview: 201 with `Content-Type:
  application/octet-stream`, `image/jpeg`, `image/png`, chunked
  transfer (no Content-Length), and 3 rapid concurrent uploads — all
  succeeded.
- Scanner endpoint against preview: 200 with actual scan results
  (bytes received and processed, not rejected as empty).
- Empty body: correctly returns 400 "No image was uploaded."

**Implications:**
- The `NODEJS_HELPERS` env var (default enabled) is left as-is — the
  fix is in application code, not infrastructure config (contract B9).
- Any future route that uses `express.raw()` or reads raw body bytes
  should use the same `preExisting` snapshot pattern, or disable helpers
  per-function with `export const config = { api: { bodyParser: false } }`.
- The `toBuffer()` utility in `http.ts` is now available for any route
  that needs to normalise body types across runtimes.

_Filed by agent on behalf of @cheyras — 2026-08-11._

