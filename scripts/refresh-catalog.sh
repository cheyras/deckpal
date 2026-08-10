#!/usr/bin/env bash
#
# refresh-catalog.sh — pull the current TCGdex compiled catalog and import it.
#
# The catalog is a point-in-time extract. Promos and Trainer Gallery subsets keep
# being added to sets that already shipped, so a snapshot silently rots: issue #21
# ("I have a 087 Binacle that I can't add") was a 2.5-week-old extract missing 222
# cards across 10 sets. Nothing refreshes this automatically today — the `catalog`
# entry in apps/sync/src/index.ts is still a logging stub — so this script is the
# supported way to do it until that job is real.
#
# Contract B3 — NEVER run the TCGdex API server. It statically imports all 18
# languages' cards.json per cluster worker (measured 6.4x JSON->object expansion)
# and will OOM the box. We only ever `docker create` a container to copy files out
# of; it is never started, and it is removed on exit.
#
# Contract B8 — the importer is idempotent. Re-running this is a no-op beyond
# whatever upstream actually changed, and it never deletes user-owned data.
#
# Usage:
#   scripts/refresh-catalog.sh                 # extract + import against .env
#   ENV_FILE=.env.cloud scripts/refresh-catalog.sh   # ...against the cloud DB
#   SKIP_IMPORT=1 scripts/refresh-catalog.sh   # extract only, then diff by hand
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$REPO_ROOT/data/catalog/en"
ENV_FILE="${ENV_FILE:-.env}"
IMAGE="tcgdex/server:edge"
CONTAINER="deckscout-catalog-extract-$$"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> pulling $IMAGE"
docker pull "$IMAGE"
echo "    image built: $(docker image inspect "$IMAGE" --format '{{.Created}}')"

# `create`, never `run`/`start` — see B3 above. The container exists only as a
# filesystem to copy out of.
echo "==> extracting compiled JSON (docker create + docker cp; server never runs)"
docker create --name "$CONTAINER" "$IMAGE" >/dev/null

STAGING="$(mktemp -d)"
docker cp "$CONTAINER:/usr/src/app/generated/en" "$STAGING/" >/dev/null
for f in cards.json sets.json series.json; do
  test -s "$STAGING/en/$f" || { echo "!! $f missing or empty in the image" >&2; exit 1; }
done

# Report the delta before overwriting, so a surprising diff is visible rather than
# discovered later in the UI.
if [ -f "$DATA_DIR/cards.json" ]; then
  node -e '
    const [oldP, newP] = process.argv.slice(1);
    const o = require(oldP), n = require(newP);
    const oi = new Set(o.map(c => c.id)), ni = new Set(n.map(c => c.id));
    const added = n.filter(c => !oi.has(c.id)), gone = o.filter(c => !ni.has(c.id));
    console.log(`    cards: ${o.length} -> ${n.length}  (+${added.length} new, ${gone.length} no longer published)`);
    const bySet = {};
    for (const c of added) bySet[c.set.id] = (bySet[c.set.id] || 0) + 1;
    for (const [s, k] of Object.entries(bySet).sort((a, b) => b[1] - a[1])) console.log(`      +${k} ${s}`);
    if (gone.length) console.log(`    NOTE: ids that vanished are usually an upstream set-id rename; the importer re-keys those in place.`);
  ' "$DATA_DIR/cards.json" "$STAGING/en/cards.json"
fi

mkdir -p "$DATA_DIR"
cp -f "$STAGING/en/cards.json" "$STAGING/en/sets.json" "$STAGING/en/series.json" "$DATA_DIR/"
rm -rf "$STAGING"
echo "==> catalog JSON refreshed at $DATA_DIR"

if [ "${SKIP_IMPORT:-0}" = "1" ]; then
  echo "==> SKIP_IMPORT=1, stopping before the DB import"
  exit 0
fi

cd "$REPO_ROOT"

# An env FILE is how a human runs this; the scheduled refresh
# (.github/workflows/catalog-refresh.yml) has no such file and exports PG* from
# repository secrets instead. Sourcing is therefore best-effort — but the
# credentials are not: an unset PGHOST silently means 127.0.0.1, which on a CI
# runner is a confusing connection refused rather than "you forgot a secret".
if [ -f "$REPO_ROOT/$ENV_FILE" ]; then
  echo "==> importing with $ENV_FILE"
  set -a && . "./$ENV_FILE" && set +a
else
  echo "==> $ENV_FILE not present; importing with the ambient environment"
fi
missing=""
for v in PGHOST PGDATABASE PGUSER PGPASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "!! refusing to import: no database credentials —$missing unset, and no $ENV_FILE to read them from" >&2
  exit 1
fi
echo "    target: $PGUSER@$PGHOST:${PGPORT:-5432}/$PGDATABASE"

pnpm --filter deckscout-sync import:catalog

cat <<'EOF'

==> done. Two things worth checking after a refresh:
    * If the summary reports renamedSets > 0, the cached card art for those sets
      still sits under the OLD set id and will serve placeholders until it is
      re-keyed or re-warmed (apps/images).
    * Brand-new cards have no art until the warmers run, and upstream often
      publishes a promo's data before its image.
EOF
