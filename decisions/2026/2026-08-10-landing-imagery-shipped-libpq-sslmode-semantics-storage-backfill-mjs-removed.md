---
date: "2026-08-10"
title: "Landing imagery shipped, libpq `sslmode` semantics, `storage-backfill.mjs` removed"
decided_by: "Chey (via agent), single session covering three independent items."
areas: ["images"]
supersedes: []
---
## 2026-08-10 — Landing imagery shipped, libpq `sslmode` semantics, `storage-backfill.mjs` removed
**Decided by:** Chey (via agent), single session covering three independent items.

**Decision 1 — the marketing art is live, and these are the picks.** The 18 raw
`bfl/flux-2-pro` candidates in `.marketing-raw/` (generated 2026-08-10 through the
Vercel AI Gateway, $0.83, *not* to be regenerated) were reviewed at full size and one
per asset recorded in `.marketing-raw/picks.json`: `hero-bg` cand-2, `texture-grid`
cand-3, `og-image` cand-3, and cand-2 for all three accents. `optimize` + `manifest`
produced 23 derivatives + `MANIFEST.json` under `apps/web/public/marketing/`
(hero 2560/1600/960 avif+webp, accents 800/400 avif+webp, texture 1600/800,
`og-image-1200.jpg`). Largest asset is `hero-bg-2560.avif` at 212 KB; the whole set is
~800 KB and the bytes a 1440px visitor actually downloads are 87 KB (hero) + 3×~3.5 KB
(accents) + 3.8 KB (texture).

**Why those picks.** Same criteria as the hero: dark enough that white text needs no
extra scrim, reads as product atmosphere rather than stock photography, no literal
cards or text, survives its crops, and cohesive as a *set*. `texture-grid` cand-3 was
the only candidate that is genuinely flat and focal-point-free — cand-1 is a
photographed slate slab and cand-2 has grunge blotches that the mirror-fold would
repeat as a visible checkerboard. `og-image` cand-3 and the hero share the same
rounded-rectangle plane language (cand-1's glass shards and cand-2's triangles do
not) and keep the middle-left calm for the platform's title overlay.
`accent-discovery` cand-3 was rejected purely on set cohesion: its flat gold wedge is
by far the largest saturated mass in the six and would out-shout the two accents
beside it.

**Two traps found while wiring it up.**
1. `.vercelignore` carries blanket `*.webp` / `*.avif` rules (for the image cache).
   The Vercel CLI feeds that file to the `ignore` package, so **every optimised
   marketing asset was being dropped from the upload** — a deploy would have 404'd
   silently into the CSS gradient fallbacks with a green build. Fixed with the same
   negation pair `.gitignore` already carries, and verified by running the real
   `ignore` matcher over both versions of the file.
2. `.gitignore` negations were verified by `git check-ignore` **exit code**, not its
   printed rule: a matching negation still prints a rule, so the text is ambiguous
   and only the exit status (1 = not ignored) is a proof.

**Verified visually,** not just built: Playwright at 1440 and 390, plus a
reduced-motion pass. Zero console errors, zero failed requests, correct
format/width negotiation in every case (1440 → `hero-bg-1600.avif`, 390 →
`hero-bg-960.avif`, accents → `-400.avif`), hero `loading=eager` +
`fetchpriority=high`, accents `loading=lazy`. An A/B with the hero `<picture>`
hidden confirms the art earns its bytes: without it the hero is a flat charcoal
field whose most prominent feature is the 58px wireframe grid; with it there is
directional depth on the right and the grid recedes. Layout is byte-identical
either way (every marketing `<img>` is `absolute inset-0 h-full w-full` inside an
already-sized parent), so there is no CLS in either direction. Landing.tsx needed
no changes — the `<picture>` markup already matched the manifest exactly.

*Caveat worth knowing:* the hero is composited at `opacity .34` +
`mix-blend-luminosity`, which desaturates the art's amber to grey. The gold that
makes the raw candidate attractive does not reach the page; the warmth you see comes
from the CSS mesh underneath. That is the existing design treatment and was
deliberately left alone.

**Decision 2 — `packages/db/src/pool.ts` implements libpq's `sslmode`, not pg's.**
`makePool` set no `ssl` option, so pg's own env reader ran, and pg maps
`prefer`/`require`/`verify-ca`/`verify-full` *all* to `ssl: true` — a bare
`tls.connect()` with full chain and hostname verification. The exact command
DEPLOYMENT.md tells open-core deployers to run against Supabase therefore died with
`self-signed certificate in certificate chain`. `pool.ts` now derives `ssl` itself and
matches libpq: unset/`disable` → no TLS; `allow`/`prefer` → encrypt, do not verify;
`require` → encrypt, verify only if `PGSSLROOTCERT` is supplied (libpq's documented
upgrade-to-verify-ca nuance); `verify-ca` → verify the chain but not the hostname;
`verify-full` → verify both; pg's own `no-verify` still honoured. An unrecognised
value now **throws** — pg's behaviour was to fall through to *no encryption at all*,
so a typo'd `PGSSLMODE` silently downgraded a production connection to plaintext.

**Why not just tell operators to set `no-verify`.** It is a pg-only spelling that
appears in no Postgres documentation, and it would have meant DEPLOYMENT.md
documenting a workaround for a library quirk instead of the connection semantics
every Postgres operator already knows.

**Proven, all four paths:** cloud Supabase with `PGSSLMODE=require` → `0 pending, 28
total` (previously fatal); local `pokedex` with no `sslmode` → connects, unchanged;
`no-verify` → still works; `verify-full` → still **rejects** the Supabase chain,
confirming nothing was weakened for verifying users. DEPLOYMENT.md §2 was rewritten to
match reality on a second count as well: it told operators to export
`SUPABASE_DB_URL`, which no code reads — the runner takes discrete `PG*` variables.

**Decision 3 — `scripts/storage-backfill.mjs` deleted.** It bypassed the B1
provenance choke point (`packages/storage/src/put-asset.ts`), so it could not write
`image_object` rows and produced exactly the "objects with no row" defect that
`manifest:check --object-store` reports. `pnpm --filter deckpal-images
storage:backfill` fully supersedes it and is verified. The DEPLOYMENT.md callout and
the `manifestCheck.ts` diagnostic no longer name a file that does not exist; both now
describe the failure mode (any direct upload) and point only at the supported command.
The earlier entries in this file that reference the script are history and were left
as written.

**Implications:** `pool.ts` is shared production connection code for every TS app in
the workspace (API, sync, MCP, images, migrations) — a change to `sslOptionFromEnv`
changes how all of them reach Postgres. Marketing bytes are the one exception to the
blanket `*.webp`/`*.avif` ignores in **two** files now; adding a marketing asset in a
new format means adding a negation to both `.gitignore` and `.vercelignore` or it will
be invisible in production. Regenerating the imagery costs real money — the picks and
the rationale above exist so nobody pays twice for the same decision.

