#!/usr/bin/env bash
# pokedex — restore a backup produced by scripts/backup.sh (BRIEF §5).
#
# Restores the pokedex database dump + (optionally) the image cache onto a
# possibly-FRESH Pi. Designed so the documented restore drill can target a
# throwaway scratch database and never endanger prod.
#
# Fresh-Pi assumptions:
#   - Postgres is installed and running, reachable as the `postgres` superuser
#     via local peer auth (i.e. `sudo -u postgres psql` works — same as this box).
#   - The repo is checked out; run this from anywhere.
#   - The `pokedex` login role may or may not exist. If absent it is created,
#     using (in order) --role-password, $PGPASSWORD, or the PGPASSWORD in .env.
#   - assets/sprites are NOT in the backup — re-fetch them with
#     scripts/fetch-sprites.sh after restore (reproducible, DECISIONS.md).
#
# Safety:
#   - Refuses to restore into a NON-EMPTY database without --force.
#   - --force uses pg_restore --clean --if-exists (drops objects, keeps the db).
#   - It NEVER drops a database. The drill drops its own scratch db itself.
#
# Usage:
#   scripts/restore.sh <backup_dir> [options]
# Options:
#   --db NAME           target database (default: pokedex)
#   --force             allow restoring into a non-empty database
#   --no-images         skip the image-cache untar (DB only — used by the drill)
#   --role-password PW  password to use if the pokedex role must be created
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TARGET_DB="pokedex"
FORCE=0
NO_IMAGES=0
ROLE_PW=""
BACKUP_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)            TARGET_DB="$2"; shift 2 ;;
    --force)         FORCE=1; shift ;;
    --no-images)     NO_IMAGES=1; shift ;;
    --role-password) ROLE_PW="$2"; shift 2 ;;
    -*)              echo "unknown option: $1" >&2; exit 2 ;;
    *)               BACKUP_ARG="$1"; shift ;;
  esac
done

if [[ -z "$BACKUP_ARG" ]]; then
  echo "usage: scripts/restore.sh <backup_dir> [--db NAME] [--force] [--no-images] [--role-password PW]" >&2
  exit 2
fi

# ── load .env (for IMAGE_CACHE_ROOT + PGPASSWORD fallback) ───────────────────
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    [[ -z "${!key:-}" ]] && export "$key=$val"
  done < "$REPO_ROOT/.env"
fi
IMAGE_CACHE_ROOT="${IMAGE_CACHE_ROOT:-$REPO_ROOT/cache}"

DUMP="$BACKUP_ARG/pokedex-db.dump"
IMG_TAR="$BACKUP_ARG/pokedex-images.tar"
[[ -f "$DUMP" ]] || { echo "ERROR: no pokedex-db.dump in '$BACKUP_ARG'." >&2; exit 1; }

psql_su() { sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"; }

echo "pokedex restore"
echo "  backup : $BACKUP_ARG"
echo "  target : database '$TARGET_DB'"

# ── 1. ensure the pokedex login role exists (fresh-Pi bootstrap) ─────────────
role_exists="$(psql_su -tAc "SELECT 1 FROM pg_roles WHERE rolname='pokedex'")"
if [[ "$role_exists" != "1" ]]; then
  PW="${ROLE_PW:-${PGPASSWORD:-}}"
  if [[ -z "$PW" ]]; then
    echo "ERROR: role 'pokedex' missing and no password given (--role-password / PGPASSWORD / .env)." >&2
    exit 1
  fi
  echo "  creating role 'pokedex'…"
  psql_su -c "CREATE ROLE pokedex LOGIN PASSWORD '$PW'"
fi

# ── 2. ensure the target database exists (owned by pokedex) ──────────────────
db_exists="$(psql_su -tAc "SELECT 1 FROM pg_database WHERE datname='$TARGET_DB'")"
if [[ "$db_exists" != "1" ]]; then
  echo "  creating database '$TARGET_DB' (owner pokedex)…"
  sudo -u postgres createdb -O pokedex "$TARGET_DB"
else
  # non-empty guard: count user tables in the public schema
  ntables="$(psql_su -d "$TARGET_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  if [[ "${ntables:-0}" -gt 0 && "$FORCE" -ne 1 ]]; then
    echo "ERROR: database '$TARGET_DB' already has $ntables tables. Refusing to clobber." >&2
    echo "       Re-run with --force to drop and replace its objects." >&2
    exit 1
  fi
fi

# ── 3. restore the dump ──────────────────────────────────────────────────────
echo "  pg_restore → $TARGET_DB…"
CLEAN_FLAGS=()
[[ "$FORCE" -eq 1 && "$db_exists" == "1" ]] && CLEAN_FLAGS=(--clean --if-exists)
# Feed the dump on stdin: this shell (invoking user) opens the file, so it works
# even though $HOME is mode 700 and the postgres user cannot traverse the path.
sudo -u postgres pg_restore --exit-on-error \
  "${CLEAN_FLAGS[@]}" -d "$TARGET_DB" < "$DUMP"

# ── 4. image cache ────────────────────────────────────────────────────────────
if [[ "$NO_IMAGES" -eq 1 ]]; then
  echo "  images : skipped (--no-images)"
elif [[ -f "$IMG_TAR" ]]; then
  echo "  images : untar → $IMAGE_CACHE_ROOT"
  mkdir -p "$IMAGE_CACHE_ROOT"
  tar -xf "$IMG_TAR" -C "$IMAGE_CACHE_ROOT"
else
  echo "  images : no archive in backup — re-warm with the image service / fetch-sprites.sh" >&2
fi

echo
echo "DONE. Restored into '$TARGET_DB'."
echo "Reminder: sprites are NOT in backups — run scripts/fetch-sprites.sh if this is a fresh Pi."
# The DB dump carries the image_asset manifest and the tar carries the bytes, so a full
# restore is self-consistent. A partial one (--no-images, or a backup with no image
# archive) is not — reconcile before trusting the cache.
echo "Next: rtk pnpm --filter pokedex-images manifest:check   # disk vs image_asset, non-zero on drift"
