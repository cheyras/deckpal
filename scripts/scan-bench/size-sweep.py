"""How far away can a card be and still read? The same card, captured as the
scanner would capture it at several distances.

  py size-sweep.py            -> ~/deckpal-data/size-sweep/<size>/<id>.jpg + rows.json
  node --import tsx scripts/scan-bench/size-sweep.ts   (reads them, scores the OCR)

The cards are the labeler queue's card photos (`label-assist` suggestions:
corners and top-left on the owner's own photos, `~/deckpal-data/labeler`),
taken only where the photo holds the card at more pixels than the largest
distance simulated, so every size is a downscale of real detail.

The scanner's geometry (every camera capture on record is a 960x1280 stream):
the detector sees the 960 px centre square, and a capture is warped from that
full-resolution square to 480x670 with a 5% margin (`rectify.ts`
CAPTURE_MARGIN), bilinear, then JPEG 0.85 (`CAPTURE_QUALITY`). The OCR reads
that JPEG. A size here is the card's LONG side as a fraction of the square's
side, the number the size gate uses.

What this cannot simulate is the camera itself at distance: sensor noise,
autofocus hunting and hand shake grow as the card shrinks, and a clean
downscale of a still photo has none of them. So these curves are the best a
given size can do; the real floor sits a little above wherever they bend.
"""
import json
import os
import sys

import cv2
import numpy as np

D = os.path.expanduser("~/deckpal-data")
SUG = os.path.join(D, "labeler", "suggestions-queue.json")
RAW = os.path.join(D, "quad-queue", "raw")
OUT = os.path.join(D, "size-sweep")
SQUARE = 960
SIZES = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70, 0.80]
MARGIN = 0.05
W, H = 480, 670
JPEG_Q = 85


def ordered(corners, tl):
    """TL, TR, BR, BL (clockwise on screen) starting at the labelled top-left."""
    p = np.roll(np.asarray(corners, np.float64), -tl, 0)
    x, y = p[:, 0], p[:, 1]
    signed = np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)
    if signed < 0:  # counter-clockwise: TL, BL, BR, TR
        p = p[[0, 3, 2, 1]]
    return p


def long_side(q):
    d = lambda a, b: float(np.linalg.norm(q[a] - q[b]))
    return max((d(0, 3) + d(1, 2)) / 2, (d(0, 1) + d(2, 3)) / 2)


def main():
    sug = json.load(open(SUG))
    need = max(SIZES) * SQUARE * 1.02
    rows = []
    skipped = {"not a card": 0, "no photo": 0, "too small in photo": 0}
    for sid, s in sug.items():
        if s.get("verdict") != "card" or not s.get("corners"):
            skipped["not a card"] += 1
            continue
        path = os.path.join(RAW, f"{sid}.jpg")
        img = cv2.imread(path)  # applies EXIF orientation, as sharp().rotate() does
        if img is None:
            skipped["no photo"] += 1
            continue
        ph, pw = img.shape[:2]
        crop = s.get("crop") or {"x": round((pw - min(pw, ph)) / 2), "y": round((ph - min(pw, ph)) / 2), "size": min(pw, ph)}
        q = np.array([[crop["x"] + cx * crop["size"], crop["y"] + cy * crop["size"]] for cx, cy in s["corners"]])
        q = ordered(q, int(s.get("topLeftIndex") or 0))
        L = long_side(q)
        if L < need:
            skipped["too small in photo"] += 1
            continue
        # Work on a padded box around the card so each resize is cheap.
        e = (q.mean(0) + (q - q.mean(0)) * 1.4)
        x0, y0 = np.floor(np.maximum(e.min(0), 0)).astype(int)
        x1, y1 = np.ceil(np.minimum(e.max(0), [pw, ph])).astype(int)
        box = img[y0:y1, x0:x1]
        qb = q - [x0, y0]
        for size in SIZES:
            k = size * SQUARE / L
            small = cv2.resize(box, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
            qs = qb * k
            c = qs.mean(0)
            src = (c + (qs - c) * (1 + 2 * MARGIN)).astype(np.float32)
            dst = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32)
            M = cv2.getPerspectiveTransform(src, dst)
            out = cv2.warpPerspective(small, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            d = os.path.join(OUT, f"{size:.2f}")
            os.makedirs(d, exist_ok=True)
            cv2.imwrite(os.path.join(d, f"{sid}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
        rows.append({"id": sid, "nativeLongSide": round(L), "confidence": s.get("confidence")})
    json.dump({"sizes": SIZES, "square": SQUARE, "rows": rows}, open(os.path.join(OUT, "rows.json"), "w"), indent=1)
    print(len(rows), "cards;", skipped)


if __name__ == "__main__":
    sys.exit(main())
