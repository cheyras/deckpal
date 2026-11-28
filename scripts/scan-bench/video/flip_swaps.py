"""Swap recall on the stack-flip videos: is a new card taken soon after it locks?

    python scripts/scan-bench/video/flip_swaps.py --run runs/<name> [videoId ...]

For each capturable ground-truth appearance AFTER the first one in its video
(every one is a swap: the previous card slid off, this one shown), and that the
replay ever LOCKED inside (frames.jsonl `locked`), counts whether a fired
capture (captures.jsonl, not suppressed) lands within --within seconds of the
appearance's first lock. The design's bar (DESIGN.md §5.3, video-bench-flip):
>= 95 % of swaps where the card ever locks. Pure bookkeeping over a replay's own
outputs; no identification, no network.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

VB = Path.home() / "deckpal-data" / "video-bench"
FLIP = ["46OLXH5-aLQ", "8nqqNrDo3CE", "ARAWSwYFz2I", "Gc9d5_87odU", "QOWR1q_Vaek"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="*")
    ap.add_argument("--run", required=True)
    ap.add_argument("--within", type=float, default=2.0)
    a = ap.parse_args()
    tot_sw = tot_hit = tot_el = tot_elhit = 0
    for vid in a.videos or FLIP:
        gt = json.loads((VB / "gt" / f"{vid}.json").read_text(encoding="utf8"))
        root = VB / a.run / vid
        frames = [json.loads(l) for l in (root / "frames.jsonl").read_text(encoding="utf8").splitlines() if l.strip()]
        caps = [json.loads(l) for l in (root / "captures.jsonl").read_text(encoding="utf8").splitlines() if l.strip()]
        fired = [c["t"] for c in caps if not c.get("suppressed")]
        apps = [x for x in gt["appearances"] if x.get("capturable")]
        lo, hi = gt.get("window", [0, 1e9])
        apps = [x for x in apps if x["start"] >= lo and x["end"] <= hi]
        sw = hit = el = elhit = 0
        for x in apps[1:]:
            inside = [f for f in frames if f.get("locked") is not None and x["start"] <= f["t"] <= x["end"]]
            if not inside:
                continue
            sw += 1
            first = inside[0]["t"]
            took = any(first - 0.01 <= t <= first + a.within for t in fired)
            hit += took
            # The policy's own share: locks the size gate did not hold (`far`
            # is footage that cannot come closer when told to; a phone can).
            near = [f["t"] for f in inside if f.get("event") != "far"]
            if near:
                el += 1
                elhit += any(near[0] - 0.01 <= t <= near[0] + a.within for t in fired)
        tot_sw += sw
        tot_hit += hit
        tot_el += el
        tot_elhit += elhit
        print(f"{vid:13s} swaps that locked {sw:3d} | taken within {a.within:.1f} s {hit:3d} ({(100 * hit / sw) if sw else 0:.0f}%) | not held for size {el:3d}, taken {elhit:3d} ({(100 * elhit / el) if el else 0:.0f}%)")
    print(f"{'ALL':13s} swaps that locked {tot_sw:3d} | taken within {a.within:.1f} s {tot_hit:3d} ({(100 * tot_hit / tot_sw) if tot_sw else 0:.0f}%) | not held for size {tot_el:3d}, taken {tot_elhit:3d} ({(100 * tot_elhit / tot_el) if tot_el else 0:.0f}%)")


if __name__ == "__main__":
    main()
