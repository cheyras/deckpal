"""Does a second gate tier (lower similarity, bigger margin) stay error-free?

    python scripts/scan-bench/gate_sweep.py [--video-run runs/g06-up]

Pools three independent real sets for one model (production pairing: int8
query x fp32 gallery):

  bench   the 267 benchmark crops (datasets/*/manifest.jsonl, truth audited)
  queue   the hand-verified owner quad crops (quad-queue/verify-truth.jsonl)
  video   a replay's fired captures inside capturable ground-truth appearances,
          plus its stray captures as negatives (video-bench/gt)

and prints, for each candidate gate, what it names confidently: exact-right,
wrong printing (right name), wrong card, and negatives named. A gate is
"(simMin, marginMin)"; a two-tier gate is decisive if EITHER tier passes.
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

EXP = Path.home() / "deckpal-data" / "scan-embed" / "export" / "deckpal-card-b32-v1"
Q = Path.home() / "deckpal-data" / "quad-queue"
VB = Path.home() / "deckpal-data" / "video-bench"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(EXP / "deckpal-card-b32-v1.fp32.onnx"))
    ap.add_argument("--query-onnx", default=str(EXP / "deckpal-card-b32-v1.int8.onnx"))
    ap.add_argument("--video-run", default="runs/g06-up")
    a = ap.parse_args()
    g = np.load(E.BENCH / "embed" / E.model_tag(a.model) / "gallery.npz")
    gids, gv = [str(x) for x in g["ids"]], g["vecs"]
    known = set(gids)
    name_of = {c["cardId"]: c["name"].lower() for c in E.load_catalog()["cards"]}
    emb = E.Embedder(a.model, a.query_onnx)

    items = []  # (set, path, truth list or None for a negative)
    for r in E.load_rows():
        if r.get("kind") == "card" and r.get("truth") and any(t in known for t in r["truth"]):
            items.append(("bench", E.crop_path(r, False), r["truth"]))
        elif r.get("kind") == "card" and r.get("truth"):
            items.append(("bench", E.crop_path(r, False), "absent"))
        elif r.get("kind") in ("negative", "not-a-card", "back"):
            items.append(("bench", E.crop_path(r, False), None))
    for l in (Q / "verify-truth.jsonl").read_text(encoding="utf8").splitlines():
        if not l.strip():
            continue
        r = json.loads(l)
        if r["kind"] == "card" and r["truth"] and any(t in known for t in r["truth"]):
            items.append(("queue", Q / r["crop"], r["truth"]))
        elif r["kind"] == "card" and r["truth"]:
            items.append(("queue", Q / r["crop"], "absent"))
        elif r["kind"] == "negative":
            items.append(("queue", Q / r["crop"], None))
    run = VB / a.video_run
    for gp in sorted((VB / "gt").glob("*.json")):
        cj = run / gp.stem / "captures.jsonl"
        if not cj.exists():
            continue
        apps = json.loads(gp.read_text(encoding="utf8"))["appearances"]
        for l in cj.read_text(encoding="utf8").splitlines():
            if not l.strip():
                continue
            c = json.loads(l)
            if c.get("suppressed") or c.get("superseded"):
                continue
            inside = [x for x in apps if x["start"] - 0.25 <= c["t"] <= x["end"] + 0.6]
            if not inside:
                items.append(("video", run / gp.stem / c["file"], None))
                continue
            truth = sorted({t for x in inside for t in ([x["cardId"]] if x.get("cardId") else []) + (x.get("candidates") or [])})
            if truth and any(t in known for t in truth):
                # a capture in an overlap window may be either card: both are truth
                items.append(("video", run / gp.stem / c["file"], truth))

    # bs=1: dynamic int8 quantizes activations PER BATCH, and production embeds one capture at a time
    V = E.embed_paths(emb, [p for _, p, _ in items], E.CAPTURE_MARGIN, bs=1)
    S = V @ gv.T
    o = np.argsort(-S, axis=1)[:, :2]
    rows = []
    for k, (src, p, truth) in enumerate(items):
        s0, s1 = float(S[k, o[k, 0]]), float(S[k, o[k, 1]])
        top = gids[o[k, 0]]
        if truth is None:
            kind = "neg"
        elif truth == "absent":
            kind = "absent"
        elif top in truth:
            kind = "exact"
        elif name_of.get(top) in {name_of.get(t) for t in truth}:
            kind = "printing"
        else:
            kind = "wrong"
        rows.append((src, s0, s0 - s1, kind, str(p), top, truth))

    gates = {
        "ship 0.65/0.03": [(0.65, 0.03)],
        "+ 0.55/0.08": [(0.65, 0.03), (0.55, 0.08)],
        "+ 0.50/0.10": [(0.65, 0.03), (0.50, 0.10)],
        "+ 0.45/0.10": [(0.65, 0.03), (0.45, 0.10)],
        "+ 0.45/0.12": [(0.65, 0.03), (0.45, 0.12)],
        "+ 0.40/0.15": [(0.65, 0.03), (0.40, 0.15)],
    }
    for name, tiers in gates.items():
        line = [f"{name:16s}"]
        for src in ("bench", "queue", "video"):
            rs = [r for r in rows if r[0] == src]
            cards = [r for r in rs if r[3] not in ("neg", "absent")]
            dec = [r for r in rs if any(r[1] >= s and r[2] >= m for s, m in tiers)]
            c = {k: sum(1 for r in dec if r[3] == k) for k in ("exact", "printing", "wrong", "neg", "absent")}
            n_abs = sum(1 for r in rs if r[3] == "absent")
            line.append(f"{src} {c['exact']}/{len(cards)} ({c['exact'] / max(1, len(cards)):.0%}) pr {c['printing']} wr {c['wrong']} neg {c['neg']} absent {c['absent']}/{n_abs}")
        print(" | ".join(line))
    print("\nconfident non-exact answers under the widest tier, ranked by margin:")
    for r in sorted(rows, key=lambda r: -r[2]):
        if r[3] != "exact" and r[1] >= 0.40 and r[2] >= 0.08:
            print(f"  {r[0]:5s} {r[3]:8s} sim {r[1]:.3f} margin {r[2]:.3f} top {r[5]} truth {r[6]} {Path(r[4]).name}")


if __name__ == "__main__":
    main()
