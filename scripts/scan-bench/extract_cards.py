"""Cut individual cards out of multi-card photos (binder pages, walls, cases).

    python scripts/scan-bench/extract_cards.py [--limit N] [--sheet]

The labeler queue's uploads are mostly whole-collection photos, not single-card
scans. This proposes card-shaped quadrilaterals (edge map -> contours -> 4-point
approximation with the 63:88 aspect, either orientation), rectifies each from
the ORIGINAL photo at the scanner's capture geometry (480x670 + 5% margin), and
writes them as candidate crops. Whether a candidate IS a card, and which, is
decided downstream by the identity matcher and by eye; this only proposes.

Reads ~/deckpal-data/quad-queue/raw/*.jpg (from queue-pull.mjs), writes
~/deckpal-data/quad-queue/cards/<photo>-<n>.jpg and cards.jsonl. Override the
directory with SCAN_QUEUE_DIR. The crops are the owner's cards: they stay there,
outside git.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import cv2
import numpy as np

def queue_dir() -> Path:
    """SCAN_QUEUE_DIR (outside the repo) or ~/deckpal-data/quad-queue.

    The check compares REAL paths (symlinks and junctions resolved by
    os.path.realpath) case-folded with os.path.normcase, so neither a junction
    nor a different-case spelling of the checkout on Windows gets past it."""
    q = Path(os.environ.get("SCAN_QUEUE_DIR") or Path.home() / "deckpal-data" / "quad-queue").resolve()
    real = lambda p: os.path.normcase(os.path.realpath(p))
    repo, target = real(Path(__file__).resolve().parents[2]), real(q)
    if target == repo or target.startswith(repo + os.sep):
        raise SystemExit(f"SCAN_QUEUE_DIR resolves inside the repo ({q}); the owner's photos must stay outside git")
    return q


Q = queue_dir()
CARD = 88 / 63
CAP_W, CAP_H, MARGIN = 480, 670, 0.05


def order(pts: np.ndarray) -> np.ndarray:
    """TL, TR, BR, BL for a portrait card; a landscape quad is rotated so its long
    side runs vertically (the card is assumed upright either way round)."""
    c = pts.mean(0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    p = pts[np.argsort(ang)]  # clockwise from -pi (left)
    # start at the point with the smallest x+y (top-left)
    k = int(np.argmin(p.sum(1)))
    p = np.roll(p, -k, 0)
    w = np.linalg.norm(p[1] - p[0])
    h = np.linalg.norm(p[3] - p[0])
    if w > h:  # landscape: rotate so the long side is vertical
        p = np.roll(p, -1, 0)
    return p.astype(np.float32)


def expand(q: np.ndarray, m: float) -> np.ndarray:
    c = q.mean(0)
    return (c + (q - c) * (1 + 2 * m)).astype(np.float32)


def candidates(img: np.ndarray) -> list[np.ndarray]:
    h, w = img.shape[:2]
    scale = 1600 / max(h, w) if max(h, w) > 1600 else 1.0
    small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    grey = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    grey = cv2.GaussianBlur(grey, (5, 5), 0)
    edges = cv2.Canny(grey, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    area_img = small.shape[0] * small.shape[1]
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < area_img * 0.004 or a > area_img * 0.9:
            continue
        peri = cv2.arcLength(c, True)
        ap = cv2.approxPolyDP(c, 0.03 * peri, True)
        if len(ap) != 4 or not cv2.isContourConvex(ap):
            continue
        q = ap.reshape(4, 2).astype(np.float32) / scale
        o = order(q)
        w_ = (np.linalg.norm(o[1] - o[0]) + np.linalg.norm(o[2] - o[3])) / 2
        h_ = (np.linalg.norm(o[3] - o[0]) + np.linalg.norm(o[2] - o[1])) / 2
        if w_ < 60 or h_ < 80:
            continue
        r = h_ / max(w_, 1e-6)
        if not (CARD * 0.85 <= r <= CARD * 1.15):
            continue
        out.append(o)
    # A binder page or a pocket grid is itself roughly 63:88. A candidate that
    # CONTAINS two or more other candidates is such a page, not a card: drop it.
    # (Centre-distance de-duplication used to keep the page and drop the cards
    # whose centres sat near its centre — a whole middle row of a 3x3 page.)
    #
    # De-duplicate FIRST, by overlap: a card and its own sleeve or inner border
    # overlap ~0.85, neighbouring cards barely at all; keep the larger. Only then
    # count containment, over DISTINCT regions — one card's art box can yield
    # several near-identical contours, and counting those would reject the card
    # itself as a "page" (Astra review of #298).
    out.sort(key=lambda q: -cv2.contourArea(q))
    kept: list[np.ndarray] = []
    for q in out:
        if all(_iou(q, k) < 0.5 for k in kept):
            kept.append(q)
    return [q for q in kept if sum(1 for o in kept if o is not q and _contains(q, o)) < 2]


def _poly(q: np.ndarray) -> np.ndarray:
    return q.reshape(-1, 1, 2).astype(np.float32)


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    inter, _ = cv2.intersectConvexConvex(_poly(a), _poly(b))
    union = cv2.contourArea(_poly(a)) + cv2.contourArea(_poly(b)) - inter
    return float(inter / union) if union > 0 else 0.0


def _contains(outer: np.ndarray, inner: np.ndarray) -> bool:
    """`inner` lies (almost) wholly inside `outer`, and is much smaller."""
    inter, _ = cv2.intersectConvexConvex(_poly(outer), _poly(inner))
    a_in = cv2.contourArea(_poly(inner))
    return a_in > 0 and inter / a_in > 0.9 and a_in < 0.5 * cv2.contourArea(_poly(outer))


def rectify(img: np.ndarray, q: np.ndarray) -> np.ndarray:
    dst = np.array([[0, 0], [CAP_W, 0], [CAP_W, CAP_H], [0, CAP_H]], np.float32)
    M = cv2.getPerspectiveTransform(expand(q, MARGIN), dst)
    return cv2.warpPerspective(img, M, (CAP_W, CAP_H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="only the first N photos (0 = all)")
    ap.add_argument("--sheet", action="store_true", help="also write cards-sample.jpg, a contact sheet of the first 36 crops")
    a = ap.parse_args()
    out = Q / "cards"
    out.mkdir(parents=True, exist_ok=True)
    files = sorted((Q / "raw").glob("*.jpg"))
    if a.limit:
        files = files[: a.limit]
    rows = []
    for f in files:
        bgr = cv2.imread(str(f))
        if bgr is None:
            print(f"  unreadable, skipped: {f.name}")
            continue
        img = bgr[..., ::-1]
        for n, q in enumerate(candidates(img)):
            crop = rectify(img, q)
            name = f"{f.stem}-{n}.jpg"
            cv2.imwrite(str(out / name), crop[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 85])
            side = float(np.linalg.norm(q[3] - q[0]))
            rows.append({"crop": f"cards/{name}", "photo": f.name, "n": n, "quad": q.round(1).tolist(), "cardPx": round(side)})
    (Q / "cards.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    print(f"{len(files)} photos -> {len(rows)} candidate card crops -> {out}")
    if a.sheet and rows:
        tiles = []
        for r in rows[:36]:
            im = cv2.imread(str(Q / r["crop"]))
            tiles.append(cv2.resize(im, (160, 223)))
        while len(tiles) % 9:
            tiles.append(np.zeros((223, 160, 3), np.uint8))
        sheet = np.vstack([np.hstack(tiles[i : i + 9]) for i in range(0, len(tiles), 9)])
        cv2.imwrite(str(Q / "cards-sample.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 80])


if __name__ == "__main__":
    main()
