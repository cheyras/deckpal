"""Find same-name printings whose card IMAGES are near-identical, whatever the scan.

    python tools/scan-embed/same_art.py            # writes ~/deckpal-data/scan-bench/same-art.json

The training's art groups (train.py `art_groups`) were "same name and dHash
within 6 bits". dHash on a 9x8 grid is at the mercy of the scan: the catalogue's
Base Set images are 1st Edition scans with a colour cast and a different crop,
so Base Set Gust of Wind and its Base Set 2 reprint land 13 bits apart, the
loss treats them as NEGATIVES, and the model learns to separate them by scan
colour — which a real unlimited card under warm light does not have. On the
owner's verified photos that was 16 of 149 confident answers naming the wrong
printing (Base Set read as Base Set 2 / Legendary Collection).

Here two printings are "the same picture" when ORB features on CLAHE-equalised
luma agree under ONE near-identity homography: many RANSAC inliers, the warp
moves no corner more than `--max-shift` of the width. Equalisation and luma
take the colour cast out; RANSAC takes the crop out. The inliers are also
counted inside the ART BAND (rows 10-55% of the card) because two different
Trainer artworks share a frame and a rules text that alone produce ~60-100
inliers; reprints of one artwork produce several hundred, most of them in the art.

Every same-name pair is measured and written (a, b, inliers, artInliers, shift)
so the threshold is a choice made downstream, not baked in here.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import cv2
import numpy as np

BENCH = Path(os.environ.get("SCAN_BENCH_DIR", Path.home() / "deckpal-data" / "scan-bench"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "scan-bench"))
import embed as E  # noqa: E402

W, H = 300, 418
ART_Y0, ART_Y1 = 0.10 * H, 0.55 * H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(BENCH / "same-art.json"))
    ap.add_argument("--features", type=int, default=1500)
    ap.add_argument("--min-keep", type=int, default=40, help="only write pairs with at least this many inliers")
    a = ap.parse_args()
    cards = E.load_catalog()["cards"]
    by_name = defaultdict(list)
    for c in cards:
        by_name[c["name"].lower()].append(c)
    orb = cv2.ORB_create(a.features)
    clahe = cv2.createCLAHE(2.0, (8, 8))
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    corners = np.float32([[0, 0], [W, 0], [W, H], [0, H]]).reshape(-1, 1, 2)

    def feat(c):
        p = E.art_path(c.get("low"))
        if not p or not p.exists():
            return None
        im = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_GRAYSCALE)
        if im is None:
            return None
        im = clahe.apply(cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA))
        k, d = orb.detectAndCompute(im, None)
        return (np.float32([x.pt for x in k]), d) if d is not None and len(k) >= 8 else None

    def compare(fa, fb):
        (pa, da), (pb, db) = fa, fb
        m = [x for x, y in (p for p in bf.knnMatch(da, db, k=2) if len(p) == 2) if x.distance < 0.8 * y.distance]
        if len(m) < 8:
            return 0, 0, 99.0
        A = pa[[x.queryIdx for x in m]]
        B = pb[[x.trainIdx for x in m]]
        Hm, mask = cv2.findHomography(A, B, cv2.RANSAC, 5.0)
        if Hm is None:
            return 0, 0, 99.0
        inl = mask.ravel().astype(bool)
        art = inl & (A[:, 1] >= ART_Y0) & (A[:, 1] <= ART_Y1)
        shift = float(np.abs(cv2.perspectiveTransform(corners, Hm) - corners).max() / W)
        return int(inl.sum()), int(art.sum()), round(shift, 3)

    out = []
    groups = [g for g in by_name.values() if len(g) > 1]
    total = sum(len(g) * (len(g) - 1) // 2 for g in groups)
    print(f"{len(groups)} names with >1 printing, {total} pairs")
    t0 = time.time()
    done = 0
    for g in groups:
        fs = [feat(c) for c in g]
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                done += 1
                if fs[i] is None or fs[j] is None:
                    continue
                inl, art, shift = compare(fs[i], fs[j])
                if inl >= a.min_keep:
                    out.append([g[i]["cardId"], g[j]["cardId"], inl, art, shift])
        if done and done % 5000 < len(g) * len(g):
            print(f"  {done}/{total} pairs ({time.time() - t0:.0f}s)", flush=True)
    Path(a.out).write_text(json.dumps({"W": W, "H": H, "artBand": [0.10, 0.55], "pairs": out}))
    print(f"wrote {len(out)} pairs -> {a.out} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
