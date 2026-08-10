#!/usr/bin/env bash
#
# set-logo-contrast.sh — find set logos that are illegible on the dark UI surface.
#
# Many TCG set logos are inked for white cardboard packaging: black text, black
# outlines, no light stroke. Dropped onto our #15181f surfaces those strokes are
# very nearly the background colour and simply vanish (issue #16 — the Pokémon
# Organized Play logo reads as a floating Poké Ball with no wordmark).
#
# This script measures that, once, offline, and regenerates
# apps/web/src/lib/setLogoContrast.ts. Nothing measures images at request time.
#
# The metric is "orphaned dark ink":
#
#   1. Trim + normalise each logo to a fixed 64px height so the numbers do not
#      depend on the source asset's resolution.
#   2. Composite it onto the surface colour and mark every pixel whose *colour*
#      distance from that surface (max channel delta) clears LEGIBLE_PCT. Colour
#      distance, not luminance: pure red is dark but reads perfectly against a
#      desaturated near-black, and a luminance test wrongly condemns every
#      red/magenta wordmark (Team Rocket, Lost Origin, EX Hidden Legends).
#   3. Dilate that legible mask by DILATE_PX. Dark ink hugging bright ink is not
#      a legibility problem — it is an outline, and the mark still reads. Only
#      dark ink that is *far from anything visible* actually disappears.
#   4. illegibleFraction = (ink outside the dilated legible mask) / (all ink).
#
# Sets at or above THRESHOLD get a light plate behind the logo in the UI.
#
# Usage:
#   scripts/set-logo-contrast.sh            # rewrite the generated TS module
#   scripts/set-logo-contrast.sh --report   # print every set's score, write nothing
#
# Requires ImageMagick 7 (`magick`) and a populated logo cache.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${IMAGE_CACHE_ROOT:-$ROOT/cache}/sets"
OUT="$ROOT/apps/web/src/lib/setLogoContrast.ts"

# Keep in step with --color-surface-primary / --color-surface-tertiary in theme.css.
# Set cards sit on surface-tertiary (#282d38); the page behind them is #15181f.
# Measure against the *lighter* of the two so we do not over-flag.
SURFACE="#282d38"
LEGIBLE_PCT=27   # max-channel distance from SURFACE that counts as visible
DILATE_PX=2      # ~3% of the normalised 64px height
THRESHOLD=0.25   # illegible-ink fraction at which a logo needs a light plate

command -v magick >/dev/null || { echo "set-logo-contrast: ImageMagick 7 (magick) not found" >&2; exit 1; }
[ -d "$CACHE" ] || { echo "set-logo-contrast: no logo cache at $CACHE" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

scores="$tmp/scores.txt"
: > "$scores"

for dir in "$CACHE"/*/; do
  id="$(basename "$dir")"
  logo="$dir/logo.webp"
  [ -f "$logo" ] || continue

  norm="$tmp/norm.png"
  magick "$logo" -trim +repage -resize x64 -background none -alpha set "$norm" 2>/dev/null || continue

  ink=$(magick "$norm" -alpha extract -threshold 50% -format "%[fx:mean]" info: 2>/dev/null || echo 0)
  # Skip degenerate/empty assets rather than reporting a meaningless ratio.
  awk -v v="$ink" 'BEGIN{exit !(v>0.001)}' || continue

  magick "$norm" -background "$SURFACE" -alpha remove -alpha off -write mpr:comp +delete mpr:comp \
    \( +clone -fill "$SURFACE" -colorize 100% \) -compose Difference -composite \
    -grayscale Brightness -threshold "${LEGIBLE_PCT}%" -morphology Dilate "Disk:${DILATE_PX}" \
    "$tmp/legible.png" 2>/dev/null

  illegible=$(magick "$norm" -alpha extract -threshold 50% \
    \( "$tmp/legible.png" -negate \) -compose Multiply -composite \
    -format "%[fx:mean]" info: 2>/dev/null || echo 0)

  awk -v id="$id" -v i="$illegible" -v k="$ink" 'BEGIN{printf "%s %.4f\n", id, i/k}' >> "$scores"
done

sort -k2,2rn -o "$scores" "$scores"

if [ "${1:-}" = "--report" ]; then
  awk -v t="$THRESHOLD" '{printf "%-10s %.3f%s\n", $1, $2, ($2>=t ? "  <- light plate" : "")}' "$scores"
  exit 0
fi

flagged=$(awk -v t="$THRESHOLD" '$2>=t{print $1}' "$scores" | sort)
count=$(printf '%s\n' "$flagged" | grep -c . || true)
total=$(wc -l < "$scores")

{
  echo "// GENERATED FILE — do not edit by hand."
  echo "// Regenerate with: scripts/set-logo-contrast.sh"
  echo "//"
  echo "// Set logos whose ink largely disappears against our dark surfaces (issue #16)."
  echo "// These are logos inked for white packaging: black wordmarks and outlines with"
  echo "// no light stroke. The UI puts a light plate behind them (see <SetLogo>) so the"
  echo "// whole mark reads; every other logo renders bare, as before."
  echo "//"
  echo "// Metric: fraction of the logo's ink that is both far in colour from the surface"
  echo "// backdrop and not adjacent to any ink that is legible on it. See the script for"
  echo "// the full rationale. Measured against ${SURFACE} at a normalised 64px height;"
  echo "// flagged at >= ${THRESHOLD}. ${count} of ${total} measured logos are flagged."
  echo ""
  echo "const LIGHT_PLATE_SET_IDS: ReadonlySet<string> = new Set(["
  printf '%s\n' "$flagged" | grep . | sed "s/.*/  '&',/"
  echo "])"
  echo ""
  echo "/** True when this set's logo needs a light plate behind it to stay legible. */"
  echo "export function setLogoNeedsLightPlate(setId: string | null | undefined): boolean {"
  echo "  return !!setId && LIGHT_PLATE_SET_IDS.has(setId)"
  echo "}"
} > "$OUT"

echo "set-logo-contrast: ${count}/${total} logos flagged -> $OUT"
