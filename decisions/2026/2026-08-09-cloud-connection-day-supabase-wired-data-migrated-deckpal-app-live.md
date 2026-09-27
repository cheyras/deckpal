---
date: "2026-08-09"
title: "Cloud connection day: Supabase wired, data migrated, deckpal.app live"
decided_by: "user + agents."
areas: ["decks"]
supersedes: []
---
## 2026-08-09 — Cloud connection day: Supabase wired, data migrated, deckpal.app live
**Decided by:** user + agents.
**Decision:** Full cloud deployment completed in a single session — Supabase project
wired end-to-end, owner data migrated, and deckpal.app domain live.

**What landed:**
- **Migrations 001-024 on Supabase:** all applied, including RLS (021), bug_report
  (022-023), and card_variant_source_pkmn (024). Buckets and RLS verified.
- **Owner data migrated:** migrate-to-cloud.mjs ran against the live Supabase DB.
  Catalog (290k rows) + per-user tables (1,787 rows) copied with integrity verified
  bit-for-bit. One singleton gap discovered and healed: the Supabase signup trigger
  pre-created bare user_profile/user_settings rows, so the migration's ON CONFLICT
  DO NOTHING silently lost display_name and joined_on. Fixed by changing singletons
  to ON CONFLICT ... DO UPDATE of business columns.
- **ES256/JWKS auth finding + fix:** Supabase signs JWTs with HS256 by default but
  the auth middleware expected RS256/JWKS. Fixed to use the shared JWT secret for
  HS256 verification.
- **Vercel deploy:** three build fixes required — TS7 builder crash (added prebuild
  step), .vercelignore anchoring (paths needed leading /), dynamic API base path
  (environment variable).
- **Login reload-loop root cause:** the auth callback was redirecting to / which
  re-triggered the auth guard; fixed by redirecting to the intended destination.
- **deckpal.app wired:** domain configured, Supabase auth URLs updated to use the
  custom domain.
- **Bug reporter live** with private mapping (user identity stored in DB, not in
  the public GitHub issue).
- **Open-signups decision:** signups enabled for now; custom SMTP before real public
  launch (Supabase rate-limits email on shared infra).

**Follow-ups remaining:**
- Custom SMTP on Supabase before real signups (avoids rate limits).
- Vercel-GitHub login connection for automatic deploys on push.
- MCP server (Wave 3) needs per-user auth model for cloud.
- Image corpus migration to Supabase Storage (~1.9 GB, needs paid tier).

**Implications:** The project is now live at deckpal.app with multi-user auth.
Self-host path remains fully supported (SUPABASE_MODE unset skips 021+).

