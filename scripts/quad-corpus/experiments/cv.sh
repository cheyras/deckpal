#!/usr/bin/env bash
# Check C: leave-one-session-out cross-validation of a fine-tune, so every card
# is a test card once and the noisy 29-card test split stops deciding things.
#
# For each labelling day D (the session), train on every OTHER day and test on D.
# The config is fixed in advance (the pilot's: 60 epochs, lr 1e-4, aug full) and
# the LAST checkpoint is exported, never one picked by test score, so the test
# day never influences the model. The 2-row day (2026-09-09) is too small to be
# a test fold and always trains.
#
#   bash scripts/quad-corpus/experiments/cv.sh            (from the worktree root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="${QUAD_CORPUS_DIR:-$HOME/deckpal-data/quad-corpus}"
CV="$(dirname "$SRC")/quad-cv"
PY="$ROOT/tools/quad-train/.venv/Scripts/python.exe"
DAYS=(2026-09-11 2026-09-15 2026-09-27)
EPOCHS="${EPOCHS:-60}"
TAG="${TAG:-cv}"

for D in "${DAYS[@]}"; do
  F="$CV/fold-$D"
  mkdir -p "$F/raw"
  cp "$SRC/manifest.jsonl" "$F/manifest.jsonl"
  for p in "$SRC"/raw/*.png; do [ -e "$F/raw/$(basename "$p")" ] || ln "$p" "$F/raw/$(basename "$p")" 2>/dev/null || cp "$p" "$F/raw/"; done
  (cd "$ROOT" && node --import tsx scripts/quad-corpus/experiments/cv-split.ts "$F" "$D")
done

for D in "${DAYS[@]}"; do
  F="$CV/fold-$D"
  RUN="$TAG-$D"
  [ -f "$ROOT/tools/quad-train/runs/$RUN/last.pt" ] || (cd "$ROOT/tools/quad-train" && "$PY" train.py --manifest "$F" --epochs "$EPOCHS" --batch-size 32 --lr 1e-4 --aug full \
      --num-workers 4 --val-on train --run "$RUN" ${TRAIN_EXTRA:-} > "runs-$RUN.log" 2>&1 || { tail -20 "runs-$RUN.log"; exit 1; })
  [ -f "$ROOT/tools/quad-train/cache/export/$RUN.onnx" ] || (cd "$ROOT/tools/quad-train" && "$PY" export.py --checkpoint "runs/$RUN/last.pt" > "export-$RUN.log" 2>&1 || true)
  (cd "$ROOT" && node --import tsx scripts/quad-corpus/eval.ts --corpus "$F" --split test --out "$F/eval-base" > "$F/eval-base.log" 2>&1) || { tail -5 "$F/eval-base.log"; exit 1; }
  (cd "$ROOT" && node --import tsx scripts/quad-corpus/eval.ts --corpus "$F" --split test --model "tools/quad-train/cache/export/$RUN.onnx" --out "$F/eval-$TAG" > "$F/eval-$TAG.log" 2>&1) || { tail -5 "$F/eval-$TAG.log"; exit 1; }
  echo "fold $D done"
done
