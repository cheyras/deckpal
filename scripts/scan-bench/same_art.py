"""Find same-name printings whose card IMAGES are near-identical, whatever the scan.

    python scripts/scan-bench/same_art.py            # writes ~/deckpal-data/scan-bench/same-art.json (~1 h)
    python scripts/scan-bench/same_art.py --foil-only   # reruns only the foil pass (below) on it (~4 min)

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

THE FOIL PASS (`--foil-only` reruns just this on an existing same-art.json, a
few minutes instead of the hour): a holo and a non-holo printing of one picture
in the SAME set (Jungle and Fossil #1-16 against #17-32, Team Rocket, the e-Card
holos, Neo Discovery...) share frame, text and figure, but the holo foil
scrambles the art features — Fossil Dragonite holo/non-holo: 447 inliers, only
47 in the art band. The whole-card count cannot stand in for it: frame and rules
text alone give alt arts and shiny versions hundreds of inliers. So for every
pair whose frame already lines up (inliers >= 150, shift <= 0.05) the pass
re-estimates that homography, lays B over A, and asks two questions of the ART:

  figure        does one picture's figure sit where the other's does? 24-px
                windows (stride 8) over the inner art window (rows 14-46%,
                cols 13-87%, clear of the art border and the dex strip),
                compared by NCC on lightly blurred CLAHE luma; a window
                matches when both sides have texture and NCC > 0.5. The value
                is the LARGEST 4-connected blob of matching windows, as a
                share of all windows: a shared figure is one contiguous blob,
                while a redrawn picture of the same Pokemon matches in
                scattered windows. Foil and a repainted background never match
                and are simply not counted.
  frameColour   min over a* and b* of the NCC of a 20x28 Lab grid outside the
                art band: same-set holo/non-holo printings share their frame
                colours (any global cast cancels in the NCC); a rainbow, gold
                or shiny recolour of a full art does not.
  figureColour  correlation of the a*/b* means of the matching windows: the
                same figure in the same colours, not the same line art
                recoloured.

They are appended to each measured row as columns 6-8; the thresholds live in
art_families.py.
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
sys.path.insert(0, str(Path(__file__).resolve().parent))
import embed as E  # noqa: E402

W, H = 300, 418
ART_Y0, ART_Y1 = 0.10 * H, 0.55 * H
COLUMNS = ["a", "b", "inliers", "artInliers", "shift", "figure", "frameColour", "figureColour"]

# The foil pass (module docstring). Which pairs it measures:
FOIL_MIN_INLIERS, FOIL_MAX_SHIFT = 150, 0.05
# The inner art window the figure is compared in, and the windows.
FIG_Y0, FIG_Y1, FIG_X0, FIG_X1 = int(0.14 * H), int(0.46 * H), int(0.13 * W), int(0.87 * W)
WIN, STRIDE, BLUR, TEXTURE_STD, WIN_NCC = 24, 8, 1.5, 6.0, 0.5
# The frame-colour grid, and the art band it leaves out (cell centres).
GRID_W, GRID_H = 20, 28
GRID_ART = (0.10, 0.55, 0.06, 0.94)


def _ncc(x: np.ndarray, y: np.ndarray) -> float:
    x = x - x.mean()
    y = y - y.mean()
    d = np.sqrt((x * x).sum() * (y * y).sum())
    return float((x * y).sum() / d) if d > 0 else 0.0


def foil_pass(path: Path, features: int) -> None:
    """Append figure / frameColour / figureColour to every pair whose frame lines up."""
    data = json.loads(path.read_text())
    cards = {c["cardId"]: c for c in E.load_catalog()["cards"]}
    orb = cv2.ORB_create(features)
    clahe = cv2.createCLAHE(2.0, (8, 8))
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    cache: dict[str, tuple | None] = {}

    def load(cid: str):
        if cid not in cache:
            p = E.art_path(cards[cid].get("low")) if cid in cards else None
            bgr = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR) if p and p.exists() else None
            if bgr is None:
                cache[cid] = None
            else:
                bgr = cv2.resize(bgr, (W, H), interpolation=cv2.INTER_AREA)
                g = clahe.apply(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
                k, d = orb.detectAndCompute(g, None)
                cache[cid] = (bgr, g, np.float32([x.pt for x in k]), d) if d is not None and len(k) >= 8 else None
            if len(cache) > 400:
                cache.pop(next(iter(cache)))
        return cache[cid]

    yy, xx = np.mgrid[0:GRID_H, 0:GRID_W]
    yc, xc = (yy + 0.5) / GRID_H, (xx + 0.5) / GRID_W
    frame_cells = ~((yc >= GRID_ART[0]) & (yc <= GRID_ART[1]) & (xc >= GRID_ART[2]) & (xc <= GRID_ART[3]))

    def measure(fa, fb):
        (bgr_a, g_a, pa, da), (bgr_b, _, pb, db) = fa, fb
        m = [x for x, y in (p for p in bf.knnMatch(da, db, k=2) if len(p) == 2) if x.distance < 0.8 * y.distance]
        if len(m) < 8:
            return None
        hm, _ = cv2.findHomography(pa[[x.queryIdx for x in m]], pb[[x.trainIdx for x in m]], cv2.RANSAC, 5.0)
        if hm is None:
            return None
        warped = cv2.warpPerspective(bgr_b, hm, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                     borderMode=cv2.BORDER_REPLICATE)
        g_b = clahe.apply(cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY))
        lab_a, lab_b = cv2.cvtColor(bgr_a, cv2.COLOR_BGR2LAB), cv2.cvtColor(warped, cv2.COLOR_BGR2LAB)
        # figure: windows over the inner art window
        ra = cv2.GaussianBlur(g_a[FIG_Y0:FIG_Y1, FIG_X0:FIG_X1].astype(np.float32), (0, 0), BLUR)
        rb = cv2.GaussianBlur(g_b[FIG_Y0:FIG_Y1, FIG_X0:FIG_X1].astype(np.float32), (0, 0), BLUR)
        la = lab_a[FIG_Y0:FIG_Y1, FIG_X0:FIG_X1].astype(np.float32)
        lb = lab_b[FIG_Y0:FIG_Y1, FIG_X0:FIG_X1].astype(np.float32)
        ys = list(range(0, ra.shape[0] - WIN + 1, STRIDE))
        xs = list(range(0, ra.shape[1] - WIN + 1, STRIDE))
        hit = np.zeros((len(ys), len(xs)), np.uint8)
        ab_a, ab_b = [], []
        for i, y in enumerate(ys):
            for j, x in enumerate(xs):
                wa, wb = ra[y:y + WIN, x:x + WIN], rb[y:y + WIN, x:x + WIN]
                if wa.std() >= TEXTURE_STD and wb.std() >= TEXTURE_STD and _ncc(wa, wb) > WIN_NCC:
                    hit[i, j] = 1
                    ab_a.append(la[y:y + WIN, x:x + WIN, 1:].reshape(-1, 2).mean(0))
                    ab_b.append(lb[y:y + WIN, x:x + WIN, 1:].reshape(-1, 2).mean(0))
        n, _, stats, _ = cv2.connectedComponentsWithStats(hit, connectivity=4)
        figure = (int(stats[1:, cv2.CC_STAT_AREA].max()) if n > 1 else 0) / hit.size
        # figureColour: the matching windows' chroma, A against B
        if len(ab_a) >= 4:
            xa = np.array(ab_a) - np.mean(ab_a, 0)
            xb = np.array(ab_b) - np.mean(ab_b, 0)
            fig_colour = float((xa * xb).sum() / np.sqrt((xa * xa).sum() * (xb * xb).sum() + 1e-9))
        else:
            fig_colour = 0.0
        # frameColour: the Lab grid outside the art band
        ga = cv2.resize(lab_a, (GRID_W, GRID_H), interpolation=cv2.INTER_AREA).astype(np.float32)
        gb = cv2.resize(lab_b, (GRID_W, GRID_H), interpolation=cv2.INTER_AREA).astype(np.float32)
        frame = min(_ncc(ga[..., c][frame_cells], gb[..., c][frame_cells]) for c in (1, 2))
        return round(figure, 3), round(frame, 3), round(fig_colour, 3)

    t0 = time.time()
    todo = [r for r in data["pairs"] if r[2] >= FOIL_MIN_INLIERS and r[4] <= FOIL_MAX_SHIFT]
    for r in data["pairs"]:
        del r[5:]
    done = 0
    for r in todo:
        fa, fb = load(r[0]), load(r[1])
        got = measure(fa, fb) if fa is not None and fb is not None else None
        if got is not None:
            r.extend(got)
            done += 1
    data["columns"] = COLUMNS
    data["foilPass"] = {"minInliers": FOIL_MIN_INLIERS, "maxShift": FOIL_MAX_SHIFT,
                        "figureWindow": [0.14, 0.46, 0.13, 0.87], "win": WIN, "stride": STRIDE,
                        "blur": BLUR, "textureStd": TEXTURE_STD, "winNcc": WIN_NCC,
                        "grid": [GRID_W, GRID_H], "gridArt": list(GRID_ART)}
    path.write_text(json.dumps(data))
    print(f"foil pass: {done}/{len(todo)} pairs measured ({time.time() - t0:.0f}s) -> {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(BENCH / "same-art.json"))
    ap.add_argument("--features", type=int, default=1500)
    ap.add_argument("--min-keep", type=int, default=40, help="only write pairs with at least this many inliers")
    ap.add_argument("--foil-only", action="store_true", help="only (re)run the foil pass on an existing --out")
    a = ap.parse_args()
    if a.foil_only:
        foil_pass(Path(a.out), a.features)
        return
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
    foil_pass(Path(a.out), a.features)


if __name__ == "__main__":
    main()
