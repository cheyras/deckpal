"""Shared paths and small helpers for the quad-train tools.

Every path here can be overridden by an environment variable, so the tools run
from any checkout. The defaults are this machine's layout (see README.md).
"""
from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

# The shipping checkpoint. model.ts loads exactly this file.
LC050 = Path(os.environ.get("LC050_ONNX", REPO / "apps/web/public/scan-assets/lc050.onnx"))

# Phase-0b session 2: 87 probe-flag frames (480x640 camera, pipeline v2), 19 of
# them hand-labelled in gt.json, scene classes in triage.json. The only labelled
# real frames available without the owner's corpus. Untracked, main checkout.
SESSION2 = Path(
    os.environ.get(
        "SESSION2_DIR",
        "E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/phase0b/session2",
    )
)

# Where scripts/quad-corpus/harvest.mjs writes the owner's corpus. Read only by
# dataset.py / train.py when the owner points them at it.
CORPUS_DIR = Path(os.environ.get("QUAD_CORPUS_DIR", Path.home() / "deckpal-data" / "quad-corpus"))

# Gitignored scratch: fixture manifests, parity dumps, runs, checkpoints.
CACHE = Path(os.environ.get("QUAD_TRAIN_CACHE", HERE / "cache"))
RUNS = Path(os.environ.get("QUAD_TRAIN_RUNS", HERE / "runs"))

# The worktree's tsx (pnpm install at the repo root provides it).
TSX = REPO / "node_modules" / ".bin" / ("tsx.CMD" if os.name == "nt" else "tsx")


def device(prefer: str = "cuda"):
    import torch

    if prefer == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")
