# DeckScout — Backup, Restore & Export

Covers BRIEF §5 (data ownership / backup-restore / portability). Everything here
is **CLI + scripts** — no service, no API endpoint. Three scripts:

| Script | What it does |
|---|---|
| `scripts/backup.sh` | one-command backup: `pg_dump` of the **`deckscout` DB only** + tar of the image cache, into a timestamped dir outside the repo |
| `scripts/restore.sh` | restore a backup onto a (possibly fresh) Pi — role + DB bootstrap, `pg_restore`, image untar |
| `scripts/export.mjs` | export the user's collection / lists / decks to CSV + a full JSON, and each deck to PTCG Live text |

## What is and isn't backed up

Backed up (the only non-reproducible state on this box):
1. **The `deckscout` database** — dumped with `pg_dump --format=custom` (compressed).
   One database only. **Never** the whole cluster, never other co-hosted databases.
2. **The WebP image cache** (`cache/images`, ~1.9 GB) — plain `tar` (WebP is
   already compressed, so gzip would burn CPU for ~nothing).

Deliberately **not** backed up because it is reproducible:
- `assets/sprites/` — re-fetched by `scripts/fetch-sprites.sh` (DECISIONS.md
  2026-07-24: sprites are fetched, never committed, never backed up).
- The git repo (already in git / Gitea).
- The card image cache can also be re-warmed from TCGdex if a backup predates it,
  but backing it up avoids a ~2 h re-warm on restore.

Backups land in **`~/deckscout-backups/<YYYYmmdd-HHMMSS>/`** — outside the repo, so
nothing backup-shaped is ever committable. `backup.sh` refuses to write inside the
repo. `deckscout-backups/` and `deckscout-exports/` are also gitignored defensively.

## Prerequisites (this box, already true)

- Postgres 17.9 on the host; `sudo -u postgres psql` works (peer auth, NOPASSWD).
- `$HOME` is mode `700`, so the `postgres` user cannot traverse into it. Both
  scripts therefore stream the dump through the **invoking user's** shell
  (`pg_dump … > file`, `pg_restore … < file`) rather than passing a `--file`
  path the `postgres` process would have to open itself.

---

## 1. Backup

```bash
scripts/backup.sh
```

Produces `deckscout-db.dump`, `deckscout-images.tar`, and `manifest.txt` (sizes,
sha256s, live row counts, git commit) in a fresh timestamped dir. Idempotent and
safe to run from cron — each run is a new dir; old dirs are pruned to the last
`DECKSCOUT_BACKUP_KEEP` (default 7).

Env knobs:
- `DECKSCOUT_BACKUP_DIR` — where backups go (default `~/deckscout-backups`).
- `DECKSCOUT_BACKUP_KEEP` — how many timestamped dirs to keep (default 7; `0` = all).

Sizes today: DB dump ≈ **5 MB**, image tar ≈ **1.9 GB** → **~1.9 GB per backup**.
With `KEEP=7` that is ≈ **13 GB** worst case, comfortably inside the Pi's ~62 GB
free. The DB dump is the part that matters and is tiny; if disk gets tight, drop
`KEEP` or exclude the image tar (it is re-warmable).

## 2. Schedule (recommendation)

**Recommended: a `cron` entry for the invoking user**, because it exactly matches
an existing pattern on this box — the user crontab already runs
`fuel/deploy/reconcile-cron.sh` nightly at 03:00, and `sudo -u postgres` runs
passwordless there. The `deckscout-sync` pm2 process runs node-cron for *catalog +
price* syncs, but adding a shell-level DB+file backup to it would mean editing app
code; a crontab line keeps backup concerns out of the app.

Add to `crontab -e` (runs 04:15 daily, after the nightly price sync, before the box wakes):

```cron
# deckscout nightly backup (DB dump + image cache), keep last 7
15 4 * * * DECKSCOUT_BACKUP_KEEP=7 /home/cheyras/pokedex/scripts/backup.sh >> /home/cheyras/.local/state/deckscout/backup.log 2>&1
```

```bash
mkdir -p ~/.local/state/deckscout   # first time, for the log
```

**Alternative: a systemd timer** (the box also uses these, e.g. `jff-weekly.timer`).
Equivalent and fine — create `deckscout-backup.service` (`Type=oneshot`,
`ExecStart=/home/cheyras/pokedex/scripts/backup.sh`) + `deckscout-backup.timer`
(`OnCalendar=*-*-* 04:15:00`, `Persistent=true`). Pick one, not both.

---

## 3. Restore

```bash
scripts/restore.sh <backup_dir> [--db NAME] [--force] [--no-images] [--role-password PW]
```

- Ensures the `deckscout` login role exists (creates it on a fresh Pi using
  `--role-password`, else `$PGPASSWORD`, else the `PGPASSWORD` in `.env`).
- Creates the target DB (default `deckscout`) owned by `deckscout` if absent.
- **Refuses to restore into a non-empty DB without `--force`** (guards prod).
  `--force` runs `pg_restore --clean --if-exists`. The script never *drops* a DB.
- Untars the image cache to `IMAGE_CACHE_ROOT` unless `--no-images`.

### Fresh-Pi restore drill (documented, the real procedure)

On a brand-new Pi after `git clone` + `pnpm install` + `pnpm build`:

```bash
# 0. Postgres 17 installed and running; you can `sudo -u postgres psql`.
# 1. Copy a backup dir over (scp/rsync from ~/deckscout-backups/<ts>).
# 2. Ensure .env exists (it carries the deckscout role password) OR pass --role-password.
# 3. Restore DB + images into prod:
scripts/restore.sh /path/to/<ts>
# 4. Migrations are already in the dump — no `pnpm migrate` needed.
# 5. Re-fetch sprites (NOT in the backup):
scripts/fetch-sprites.sh
# 6. Start services (pm2) per deploy/DEPLOY.md and hit the health endpoint.
```

### Proving restore works **without endangering prod** (scratch drill)

This is the safe drill that was actually run and verified. It restores into a
**throwaway** database, compares row counts to prod, then drops it. Prod is never
touched.

```bash
BK=~/deckscout-backups/<ts>

# restore the dump into a scratch DB (DB only)
scripts/restore.sh "$BK" --db deckscout_restore_test --no-images

# compare counts prod vs scratch
for t in card card_variant collection_item card_list list_item deck deck_card price_current app_user; do
  p=$(sudo -u postgres psql -d deckscout              -tAc "select count(*) from $t")
  r=$(sudo -u postgres psql -d deckscout_restore_test -tAc "select count(*) from $t")
  [ "$p" = "$r" ] && echo "  $t  $p == $r  MATCH" || echo "  $t  $p != $r  MISMATCH"
done

# clean up — the drill drops its own scratch DB
sudo -u postgres dropdb deckscout_restore_test
```

Verified counts (2026-07-27): card 23444, card_variant 40004, price_current 53827,
collection_item 5, list_item 8, deck_card 27, card_list 1, deck 1, app_user 1 —
all MATCH, scratch DB dropped, prod (`deckscout`) untouched.

---

## 4. Export / portability

```bash
node scripts/export.mjs [--out DIR] [--user ID|username]
```

Read-only, parameterised SQL, one pooled connection. Default output
`~/deckscout-exports/<ts>/`. Produces:

- `collection.csv` — one row per collection item (card, set, variant, tier,
  quantity, condition, USD/EUR market price in minor units, timestamps).
- `lists.csv` — one row per list item across all lists.
- `decks.csv` — one row per deck card across all decks.
- `deck-<name>-<id>.ptcgl.txt` — each deck as **PTCG Live** text. This reuses the
  API's `serializePtcgl` (`apps/api/src/deck/ptcgl.ts`, via its compiled output) —
  the grammar is not reimplemented. Set codes come from the deck engine's vendored
  `ptcgl-set-alias.json` (the DB alias table is currently empty).
- `deckscout-export.json` — **full JSON** of everything user-owned: profile,
  settings, showcase, collection (+ event log), graded cards, notes, lists (+
  items + binder placements), decks (+ cards), Pokédex capture state, per-set
  progress, and collection value history. Catalog tables are global and excluded
  by design.

Exports contain user data → kept outside the repo and gitignored.

> The compiled outputs `packages/db/dist` and `apps/api/dist/deck/ptcgl.js` must
> exist (`pnpm build`). On the deployed box they always do — pm2 runs `dist`.
