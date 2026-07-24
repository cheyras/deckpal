#!/usr/bin/env bash
# fetch-sprites.sh — fetch Pokémon sprites from PokeAPI/sprites into the LOCAL asset cache.
#
# Sprites are Nintendo/Creatures/GAME FREAK assets and are NEVER committed to this repo
# (DECISIONS.md 2026-07-24 "Sprites are fetched, never committed"). This script ships the
# *recipe*: a pinned commit SHA + a sparse-checkout of exactly the subset we use.
#
# Subset (DEX-DATA.md §C.2, Option A + Option B), National Dex 1..1025, normal + shiny:
#   sprites/pokemon/{n}.png                          96x96 pixel art   -> dex grid tiles
#   sprites/pokemon/shiny/{n}.png                    96x96 shiny
#   sprites/pokemon/other/official-artwork/{n}.png   475x475 full art  -> species detail / capture card
#   sprites/pokemon/other/official-artwork/shiny/{n}.png
# ~4,100 files, ~260 MB apparent / ~270 MB on ext4. Alternate-form ids (>=10001) come along in the
# same dirs and are harmless (we only ever request 1..1025 by filename).
#
# Usage:
#   scripts/fetch-sprites.sh            # full subset into assets/sprites/  (the ~270 MB fetch)
#   scripts/fetch-sprites.sh --smoke    # fetch ~10 sprites only, to prove the pipeline works
#   SPRITES_DEST=/path scripts/fetch-sprites.sh
#
# Be polite to GitHub: this is a single blobless sparse clone (or a handful of raw GETs in --smoke),
# not a crawl.
set -euo pipefail

# ── pinned upstream (bump deliberately; record the SHA in git when you do) ────
SPRITES_REPO="https://github.com/PokeAPI/sprites.git"
SPRITES_SHA="bf4c47ac82c33b330e33d98b8882d1cedb2f53e7"   # PokeAPI/sprites master @ 2026-07-24

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${SPRITES_DEST:-$REPO_ROOT/assets/sprites}"
MODE="${1:-full}"

RAW="https://raw.githubusercontent.com/PokeAPI/sprites/${SPRITES_SHA}/sprites/pokemon"

echo "[fetch-sprites] pinned SHA: ${SPRITES_SHA}"
echo "[fetch-sprites] destination: ${DEST}"

if [[ "$MODE" == "--smoke" ]]; then
  # Prove the recipe works without pulling 270 MB: fetch a handful of well-known dex numbers,
  # both styles, normal + shiny. Bulbasaur, Charizard, Pikachu, Mewtwo, Terapagos(1024).
  mkdir -p "$DEST/pokemon/shiny" "$DEST/pokemon/other/official-artwork/shiny"
  count=0
  for n in 1 6 25 150 1024; do
    curl -sfL "$RAW/${n}.png"       -o "$DEST/pokemon/${n}.png"       && count=$((count+1))
    curl -sfL "$RAW/shiny/${n}.png" -o "$DEST/pokemon/shiny/${n}.png" && count=$((count+1))
  done
  # prove the official-artwork path resolves too (normal + shiny for Charizard)
  curl -sfL "$RAW/other/official-artwork/6.png"       -o "$DEST/pokemon/other/official-artwork/6.png"       && count=$((count+1))
  curl -sfL "$RAW/other/official-artwork/shiny/6.png" -o "$DEST/pokemon/other/official-artwork/shiny/6.png" && count=$((count+1))
  echo "[fetch-sprites] smoke fetch complete: ${count} files"
  exit 0
fi

# ── full subset via a sparse, blobless checkout pinned to the SHA ─────────────
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --filter=blob:none --no-checkout --sparse "$SPRITES_REPO" "$WORK"
git -C "$WORK" sparse-checkout set --no-cone \
  '/sprites/pokemon/*.png' \
  '/sprites/pokemon/shiny/*.png' \
  '/sprites/pokemon/other/official-artwork/*.png' \
  '/sprites/pokemon/other/official-artwork/shiny/*.png'
git -C "$WORK" checkout "$SPRITES_SHA"

mkdir -p "$DEST"
# Copy only the subset dirs into the cache (drop the .git history — we keep the recipe, not the repo).
cp -r "$WORK/sprites/pokemon" "$DEST/"
echo "[fetch-sprites] full subset copied to ${DEST}/pokemon"
find "$DEST/pokemon" -name '*.png' | wc -l | xargs echo "[fetch-sprites] png files:"
