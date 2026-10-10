"""Build the reprint-family table the scanner's printing guard reads.

    python scripts/scan-bench/same_art.py          # once per catalogue change: ~1 h, writes same-art.json
    python scripts/scan-bench/art_families.py      # writes apps/api/src/scan/data/art-families.json

A FAMILY is a set of same-name printings that show the same picture: either
same_art.py found their images agree under one near-identity homography (art-
band ORB inliers >= --art-min, corner shift <= --max-shift — colour-blind, so a
colour-cast scan of a 1st Edition Base Set card still matches its Base Set 2
reprint), or their 9x8 dHash is within --dhash bits. Families are the
transitive closure of those pairs.

What the scanner does with it (apps/api/src/scan/artFamilies.ts): no image
signal — the hash or the embedding — may name ONE printing of a family on its
own, because none of them can see the difference (a set symbol and a number a
few pixels tall). Only a printed key the OCR read can.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BENCH = Path(os.environ.get("SCAN_BENCH_DIR", Path.home() / "deckpal-data" / "scan-bench"))
sys.path.insert(0, str(HERE))
import embed as E  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--same-art", default=str(BENCH / "same-art.json"))
    ap.add_argument("--art-min", type=int, default=80)
    ap.add_argument("--max-shift", type=float, default=0.15)
    ap.add_argument("--dhash", type=int, default=6)
    ap.add_argument("--out", default=str(REPO / "apps" / "api" / "src" / "scan" / "data" / "art-families.json"))
    a = ap.parse_args()
    cards = E.load_catalog()["cards"]
    name = {c["cardId"]: c["name"].lower() for c in cards}
    ph = json.loads((BENCH / "phash-index.json").read_text())
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        parent[find(x)] = find(y)

    pairs = json.loads(Path(a.same_art).read_text())["pairs"]
    n_art = 0
    for x, y, _inl, art, shift in pairs:
        if art >= a.art_min and shift <= a.max_shift and name.get(x) == name.get(y) and x in name:
            union(x, y)
            n_art += 1
    by_name = defaultdict(list)
    for c in cards:
        by_name[name[c["cardId"]]].append(c["cardId"])
    n_hash = 0
    for ids in by_name.values():
        hs = [(i, int(ph[i], 16)) for i in ids if i in ph]
        for i in range(len(hs)):
            for j in range(i + 1, len(hs)):
                if bin(hs[i][1] ^ hs[j][1]).count("1") <= a.dhash:
                    union(hs[i][0], hs[j][0])
                    n_hash += 1
    groups = defaultdict(set)
    for k in list(parent):
        groups[find(k)].add(k)
    families = sorted(sorted(g) for g in groups.values() if len(g) > 1)
    out = {
        "as_of": datetime.date.today().isoformat(),
        "method": (f"same-name printings joined when same_art.py's art-band ORB inliers >= {a.art_min} with corner "
                   f"shift <= {a.max_shift}, or 9x8 dHash <= {a.dhash}; transitive closure. "
                   f"scripts/scan-bench/art_families.py"),
        "cards": sum(len(f) for f in families),
        "families": families,
    }
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf8")
    print(f"{n_art} image pairs + {n_hash} hash pairs -> {len(families)} families, {out['cards']} cards -> {a.out}")


if __name__ == "__main__":
    main()
