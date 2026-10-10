"""Score an identity model on the hand-verified queue crops.

    python scripts/scan-bench/score_queue.py --model <gallery spec> [--query-onnx int8.onnx] --gate 0.65,0.03

Truth is ~/deckpal-data/quad-queue/verify-truth.jsonl (each crop checked by eye:
kind card/negative/exclude, truth = the exact printing(s) it can be). Only
`card` rows whose truth is in the catalogue count; negatives are reported as
how often the gate names something confidently anyway.

  top-1 exact   the matcher's first answer is the printing
  top-1 name    ... or at least the right card name (a sibling printing)
  decisive      the gate would name top-1 without help
    exact       ... and it is the printing          (the auto-ID that counts)
    printing    ... it is the right name, wrong printing (confident and WRONG
                    for a collection: Base Set vs Base Set 2 is a price gap)
    wrong       ... it is another card altogether
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

Q = Path.home() / "deckpal-data" / "quad-queue"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="gallery spec (the fp32 ONNX or timm: name the gallery was embedded with)")
    ap.add_argument("--query-onnx", default=None)
    ap.add_argument("--gate", default="0.65,0.03", help="simMin,marginMin")
    ap.add_argument("--truth", default=str(Q / "verify-truth.jsonl"))
    ap.add_argument("--show", action="store_true", help="list every confident mistake")
    a = ap.parse_args()
    sim_min, margin_min = (float(x) for x in a.gate.split(","))
    g = np.load(E.BENCH / "embed" / E.model_tag(a.model) / "gallery.npz")
    gids, gv = [str(x) for x in g["ids"]], g["vecs"]
    known = set(gids)
    name_of = {c["cardId"]: c["name"].lower() for c in E.load_catalog()["cards"]}
    rows = [json.loads(l) for l in Path(a.truth).read_text(encoding="utf8").splitlines() if l.strip()]
    cards = [r for r in rows if r["kind"] == "card" and r["truth"] and any(t in known for t in r["truth"])]
    negs = [r for r in rows if r["kind"] == "negative"]
    emb = E.Embedder(a.model, a.query_onnx)
    V = E.embed_paths(emb, [Q / r["crop"] for r in cards + negs], E.CAPTURE_MARGIN, bs=32)
    S = V @ gv.T
    o = np.argsort(-S, axis=1)[:, :2]
    c = dict(n=len(cards), top1=0, top1name=0, dec=0, dec_exact=0, dec_printing=0, dec_wrong=0)
    mistakes = []
    for k, r in enumerate(cards):
        top = gids[o[k, 0]]
        s0, s1 = float(S[k, o[k, 0]]), float(S[k, o[k, 1]])
        exact = top in r["truth"]
        name = exact or name_of.get(top) in {name_of.get(t) for t in r["truth"]}
        c["top1"] += exact
        c["top1name"] += name
        if s0 >= sim_min and s0 - s1 >= margin_min:
            c["dec"] += 1
            c["dec_exact"] += exact
            c["dec_printing"] += name and not exact
            c["dec_wrong"] += not name
            if not exact:
                mistakes.append((r["crop"], top, r["truth"], round(s0, 3), round(s0 - s1, 3), "printing" if name else "WRONG"))
    neg_conf = 0
    for k in range(len(cards), len(cards) + len(negs)):
        s0, s1 = float(S[k, o[k, 0]]), float(S[k, o[k, 1]])
        neg_conf += s0 >= sim_min and s0 - s1 >= margin_min
    n = max(1, c["n"])
    d = max(1, c["dec"])
    print(f"{E.model_tag(a.model)}{' q=' + Path(a.query_onnx).stem if a.query_onnx else ''} gate {sim_min},{margin_min}")
    print(f"  cards {c['n']}: top-1 exact {c['top1'] / n:.1%}  top-1 name {c['top1name'] / n:.1%}")
    print(f"  decisive {c['dec']} ({c['dec'] / n:.1%}): exact {c['dec_exact']} ({c['dec_exact'] / n:.1%} of cards)  "
          f"wrong printing {c['dec_printing']} ({c['dec_printing'] / d:.1%} of decisive)  wrong card {c['dec_wrong']}")
    print(f"  negatives {len(negs)}: named confidently {neg_conf}")
    if a.show:
        for m in mistakes:
            print("   ", *m)


if __name__ == "__main__":
    main()
