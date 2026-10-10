"""Propose identities for the cut-out card crops with the identity matcher.

    # the fine-tuned model (its gallery is built by PR #288's embed.py)
    python scripts/scan-bench/label_cards.py \\
        --model <deckpal-card-b32-v1.fp32.onnx> --query-onnx <deckpal-card-b32-v1.int8.onnx>
    # the shipped zero-shot CLIP (gallery from `embed.py gallery`, on main today)
    python scripts/scan-bench/label_cards.py --model-id clip-vit-b32-openai \\
        --model timm:vit_base_patch32_clip_224.openai --query-onnx <clip int8.onnx>

For every crop in ~/deckpal-data/quad-queue/cards.jsonl (extract_cards.py): the
production-pairing embedding (int8 query x fp32 gallery), top-10 with
similarities, and a tier:

  decisive   the shipped gate (THRESHOLDS for the model) would name top-1
  plausible  top-1 is showable (>= simFloor) but not decisive: same-art reprints,
             glare, small crops: the rows a human must look at
  junk       below the floor: not a card, a back, a frame, another game

Writes cards-labelled.jsonl beside cards.jsonl (override the directory with
SCAN_QUEUE_DIR; the gallery is read from SCAN_BENCH_DIR, see embed.py).

NOTHING HERE IS GROUND TRUTH. `decisive` rows are pseudo-labels and the rest
are review candidates. On the hand-verified 300-crop sample (2026-10-10), 17 of
149 `decisive` card rows (about 11%) were wrong, almost all the wrong printing of
a vintage card reprinted with the same art (Base Set vs Base Set 2, Legendary
Collection, Celebrations Classic Collection), which the image embedding cannot
separate; the set symbol and number strip can. Verify by eye before any of it
becomes a benchmark label or training data.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import embed as E  # noqa: E402

Q = Path(os.environ.get("SCAN_QUEUE_DIR", Path.home() / "deckpal-data" / "quad-queue"))
# (simMin, marginMin, simFloor): copies of THRESHOLDS in
# packages/matching/src/confidence.ts, main tier only. `deckpal-card-b32-v1`
# is the fine-tuned model from PR #288; `clip-vit-b32-openai` is shipped.
GATES = {"deckpal-card-b32-v1": (0.65, 0.03, 0.45), "clip-vit-b32-openai": (0.74, 0.02, 0.55)}


def gallery_tag(spec: str) -> str:
    """The embed/<tag>/ directory the gallery was written to. An .onnx file is
    tagged by its stem, as PR #288's embed.model_tag does; main's model_tag only
    knows timm:/.pt specs, so the .onnx case is handled here for both."""
    return Path(spec).stem if spec.endswith(".onnx") else E.model_tag(spec)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="the model spec the gallery was embedded with (an fp32 .onnx, or timm:...)")
    ap.add_argument("--query-onnx", required=True, help="the ONNX the crops are embedded with (the int8 production pairing)")
    ap.add_argument("--model-id", default="deckpal-card-b32-v1", choices=sorted(GATES), help="which gate to tier with")
    a = ap.parse_args()
    sim_min, margin_min, floor = GATES[a.model_id]
    gallery = E.BENCH / "embed" / gallery_tag(a.model) / "gallery.npz"
    if not gallery.exists():
        raise SystemExit(f"no gallery at {gallery}: build it with `embed.py gallery --model {a.model}` first")
    g = np.load(gallery)
    gids, gv = g["ids"], g["vecs"]
    cat = E.load_catalog()
    name_of = {c["cardId"]: c["name"] for c in cat["cards"]}
    rows = [json.loads(l) for l in (Q / "cards.jsonl").read_text(encoding="utf8").splitlines() if l.strip()]
    emb = E.Embedder("x", a.query_onnx)
    vecs = E.embed_paths(emb, [Q / r["crop"] for r in rows], E.CAPTURE_MARGIN, bs=32)
    S = vecs @ gv.T
    order = np.argsort(-S, axis=1)[:, :10]
    counts = {"decisive": 0, "plausible": 0, "junk": 0}
    out = []
    for i, r in enumerate(rows):
        top = [str(gids[j]) for j in order[i]]
        sims = [round(float(S[i, j]), 4) for j in order[i]]
        margin = sims[0] - sims[1]
        tier = "decisive" if sims[0] >= sim_min and margin >= margin_min else ("plausible" if sims[0] >= floor else "junk")
        counts[tier] += 1
        out.append({**r, "tier": tier, "top": top, "sims": sims, "margin": round(margin, 4),
                    "topName": name_of.get(top[0])})
    (Q / "cards-labelled.jsonl").write_text("\n".join(json.dumps(o) for o in out) + "\n")
    print(f"{len(out)} crops: {counts}")


if __name__ == "__main__":
    main()
