"""Choose the vector gate (simMin, marginMin) for a model from the benchmark.

    python scripts/scan-bench/calibrate.py --tag <embed tag>

Reads embed/<tag>/score.json (written by `embed.py score`) and, for every gate on
a grid, reports what the VECTOR ALONE would claim on real crops:

  coverage   decisive AND top-1 is a right printing, over cards
  wrong      decisive AND top-1 is not a right printing, over decisive claims
  negs       decisive on a non-card / card back

A printing that shares the right card's ART but not its number counts as WRONG
here, as it does everywhere in this benchmark: the gate is a claim about the
card, and the printing is the ladder's (OCR's) job when the art cannot say.

The recommendation is the gate with the most coverage at zero wrong and zero
negatives, then moved to the MIDPOINT between the strongest wrong claim it
excludes and the weakest right claim it keeps, the same rule the shipped
thresholds used (packages/matching/src/confidence.ts). It is checked for
stability by leaving each dataset out in turn.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

BENCH = Path(os.environ.get("SCAN_BENCH_DIR", Path.home() / "deckpal-data" / "scan-bench"))


def load(tag: str, which: str):
    rows = json.loads((BENCH / "embed" / tag / "score.json").read_text())[which]
    cards = [r for r in rows if r["kind"] == "card" and r["truth"]]
    negs = [r for r in rows if r["kind"] in ("negative", "card-back")]
    return cards, negs


def gate_stats(cards, negs, sim_min, margin_min):
    dec = [r for r in cards if r["sims"][0] >= sim_min and r["margin"] >= margin_min]
    right = sum(1 for r in dec if r["top1Correct"])
    neg = sum(1 for r in negs if r["sims"][0] >= sim_min and r["margin"] >= margin_min)
    return len(dec), right, neg


def best_gate(cards, negs):
    best = None
    for s in [x / 1000 for x in range(500, 961, 5)]:
        for m in [x / 1000 for x in range(0, 201, 2)]:
            n, right, neg = gate_stats(cards, negs, s, m)
            if n - right == 0 and neg == 0 and (best is None or right > best[2]):
                best = (s, m, right)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--which", default="crop", choices=["crop", "full"])
    a = ap.parse_args()
    cards, negs = load(a.tag, a.which)
    n = len(cards)
    print(f"{a.tag} [{a.which}]: {n} cards, {len(negs)} negatives/backs")
    right_sims = sorted(r["sims"][0] for r in cards if r["top1Correct"])
    wrong = [r for r in cards if not r["top1Correct"]]
    print(f"top-1 right {len(right_sims)}/{n}; wrong top-1s: {len(wrong)} "
          f"(sim max {max((r['sims'][0] for r in wrong), default=0):.3f}, "
          f"margin max {max((r['margin'] for r in wrong), default=0):.3f})")
    print(f"negatives: sim max {max((r['sims'][0] for r in negs), default=0):.3f}, "
          f"margin max {max((r['margin'] for r in negs), default=0):.3f}")
    b = best_gate(cards, negs)
    if not b:
        print("no zero-error gate exists on this data")
        return
    s, m, right = b
    # Midpoints: for each knob, between the strongest excluded error and the
    # weakest kept right answer on that knob, holding the other knob.
    errs = [r for r in cards if not r["top1Correct"]] + negs
    kept_right = [r for r in cards if r["top1Correct"] and r["sims"][0] >= s and r["margin"] >= m]
    e_sim = max((r["sims"][0] for r in errs if r["margin"] >= m and r["sims"][0] < s), default=None)
    e_mar = max((r["margin"] for r in errs if r["sims"][0] >= s and r["margin"] < m), default=None)
    k_sim = min(r["sims"][0] for r in kept_right)
    k_mar = min(r["margin"] for r in kept_right)
    sim_mid = round((e_sim + k_sim) / 2, 3) if e_sim is not None else s
    mar_mid = round((e_mar + k_mar) / 2, 3) if e_mar is not None else m
    for label, (ss, mm) in {"edge": (s, m), "midpoint": (sim_mid, mar_mid)}.items():
        dn, dr, dneg = gate_stats(cards, negs, ss, mm)
        print(f"  {label:9s} simMin {ss:.3f} marginMin {mm:.3f}: coverage {dr}/{n} ({dr / n:.1%}), "
              f"wrong {dn - dr}/{dn}, negs {dneg}")
    # stability: leave each dataset out, refit, apply to the held-out one
    ds = sorted({r["dataset"] for r in cards})
    print("  leave-one-dataset-out (gate fitted without it, applied to it):")
    for d in ds:
        tr_c = [r for r in cards if r["dataset"] != d]
        tr_n = [r for r in negs if r["dataset"] != d]
        g = best_gate(tr_c, tr_n)
        te_c = [r for r in cards if r["dataset"] == d]
        te_n = [r for r in negs if r["dataset"] == d]
        if not g:
            print(f"    {d:26s} no zero-error gate without it")
            continue
        dn, dr, dneg = gate_stats(te_c, te_n, g[0], g[1])
        print(f"    {d:26s} gate ({g[0]:.3f}, {g[1]:.3f}) -> coverage {dr}/{len(te_c)}, wrong {dn - dr}, negs {dneg}")


if __name__ == "__main__":
    main()
