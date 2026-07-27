#!/usr/bin/env bash
# pokedex — one-command backup (BRIEF §5, DECISIONS.md 2026-07-24).
#
# Backs up EXACTLY two things, the only non-reproducible state on this box:
#   1. the `pokedex` Postgres database  (pg_dump, custom/compressed format)
#   2. the on-disk WebP image cache      (tar of cache/images)
#
# It does NOT back up:
#   - the whole Postgres cluster or openbrain/brain2db (dumps ONE database)
#   - assets/sprites  (re-fetchable via scripts/fetch-sprites.sh — reproducible)
#   - the git repo    (already in git/Gitea)
#
# Output lands OUTSIDE the repo (default ~/pokedex-backups), in a timestamped
# dir, so nothing backup-shaped is ever committed. Idempotent + safe to cron:
# every run makes a fresh dir and prunes to the last N (POKEDEX_BACKUP_KEEP).
#
# Usage:   scripts/backup.sh
# Env:     POKEDEX_BACKUP_DIR   (default ~/pokedex-backups)
#          POKEDEX_BACKUP_KEEP  (default 7; 0 = keep everything)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── load .env for IMAGE_CACHE_ROOT / PGDATABASE (no override of a set env) ────
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    [[ -z "${!key:-}" ]] && export "$key=$val"
  done < "$REPO_ROOT/.env"
fi

PGDATABASE="${PGDATABASE:-pokedex}"
IMAGE_CACHE_ROOT="${IMAGE_CACHE_ROOT:-$REPO_ROOT/cache}"
IMAGES_DIR="$IMAGE_CACHE_ROOT/images"
BACKUP_DIR="${POKEDEX_BACKUP_DIR:-$HOME/pokedex-backups}"
KEEP="${POKEDEX_BACKUP_KEEP:-7}"

# Refuse to write backups inside the repo (they must never be committable).
case "$BACKUP_DIR" in
  "$REPO_ROOT"|"$REPO_ROOT"/*)
    echo "ERROR: POKEDEX_BACKUP_DIR ($BACKUP_DIR) is inside the repo. Choose a path outside $REPO_ROOT." >&2
    exit 1 ;;
esac

# Hard stop: only ever dump the pokedex database.
if [[ "$PGDATABASE" != "pokedex" ]]; then
  echo "ERROR: refusing to run — PGDATABASE is '$PGDATABASE', expected 'pokedex'." >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$TS"
mkdir -p "$DEST"

DUMP="$DEST/pokedex-db.dump"
IMG_TAR="$DEST/pokedex-images.tar"
MANIFEST="$DEST/manifest.txt"

echo "pokedex backup → $DEST"

# ── 1. database dump (custom format, compressed, ONE database) ───────────────
echo "  [1/2] pg_dump $PGDATABASE (custom format)…"
# Redirect via THIS shell (runs as the invoking user) so the file lands in a
# 700 $HOME the postgres user cannot traverse. pg_dump -Fc writes to stdout.
sudo -u postgres pg_dump --format=custom --compress=6 "$PGDATABASE" > "$DUMP"

# ── 2. image cache archive (WebP is already compressed → plain tar, fast) ─────
if [[ -d "$IMAGES_DIR" ]]; then
  echo "  [2/2] tar image cache ($IMAGES_DIR)…"
  tar -cf "$IMG_TAR" -C "$IMAGE_CACHE_ROOT" images
else
  echo "  [2/2] WARN: image cache dir '$IMAGES_DIR' not found — skipping (re-warmable)." >&2
fi

# ── manifest: what's inside, how big, and checksums for restore verification ──
DB_SIZE_HUMAN="$(sudo -u postgres psql -tAc "SELECT pg_size_pretty(pg_database_size('$PGDATABASE'))")"
COUNTS="$(sudo -u postgres psql -d "$PGDATABASE" -tA -F '=' -c "
  SELECT 'card',           count(*) FROM card         UNION ALL
  SELECT 'card_variant',   count(*) FROM card_variant UNION ALL
  SELECT 'collection_item',count(*) FROM collection_item UNION ALL
  SELECT 'card_list',      count(*) FROM card_list    UNION ALL
  SELECT 'list_item',      count(*) FROM list_item    UNION ALL
  SELECT 'deck',           count(*) FROM deck         UNION ALL
  SELECT 'deck_card',      count(*) FROM deck_card    UNION ALL
  SELECT 'price_current',  count(*) FROM price_current;")"

{
  echo "pokedex backup manifest"
  echo "created_at   : $(date -Is)"
  echo "database     : $PGDATABASE (live size $DB_SIZE_HUMAN)"
  echo "pg_dump      : $(pg_dump --version)"
  echo "git_commit   : $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "image_cache  : $IMAGES_DIR"
  echo
  echo "row counts (live, at backup time):"
  echo "$COUNTS" | sed 's/^/  /'
  echo
  echo "files:"
  for f in "$DUMP" "$IMG_TAR"; do
    [[ -f "$f" ]] || continue
    printf '  %-24s %10s  sha256=%s\n' "$(basename "$f")" \
      "$(du -h "$f" | cut -f1)" "$(sha256sum "$f" | cut -d' ' -f1)"
  done
} > "$MANIFEST"

# ── retention: keep the last N timestamped dirs ──────────────────────────────
if [[ "$KEEP" -gt 0 ]]; then
  mapfile -t all < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
    -regextype posix-extended -regex '.*/[0-9]{8}-[0-9]{6}' | sort)
  n=${#all[@]}
  if (( n > KEEP )); then
    for ((i=0; i<n-KEEP; i++)); do
      echo "  prune old backup: ${all[i]}"
      rm -rf "${all[i]}"
    done
  fi
fi

echo
echo "DONE. Contents of $DEST:"
ls -lh "$DEST"
echo
echo "Total this backup: $(du -sh "$DEST" | cut -f1)"
