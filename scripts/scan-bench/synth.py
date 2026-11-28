"""Synthesise camera-like scanner captures from catalogue art, for a SEPARATE
bench root (never the real-crop datasets; see README "Synthetic captures").

    $PY -I scripts/scan-bench/synth.py <art-dir> <bench-root> <dataset> [--variants 8] [--seed 1]

`<art-dir>` holds high-resolution catalogue art named `<cardId>.webp` (the
600x825 `high.webp`, not the bench's 245x337 `low.webp`, which no OCR can read).
Each card gets `--variants` captures at the scanner's geometry (480x670, the
quad expanded by rectify.ts's 5% CAPTURE_MARGIN), with the quad detector's
corner error, exposure, a colour cast, a light gradient, sometimes glare,
defocus or motion blur, sensor noise and JPEG q85. The last quarter of each
card's variants are HARD (smaller in frame, more blur, more glare), which is
where a real strip stops reading.

Writes <bench-root>/datasets/<dataset>/crops/*.jpg and manifest.jsonl in the
bench's manifest shape: kind "card", truth [cardId], source "synthetic".

What it does not model: holo foil, sleeves and toploaders, fingers, the
quad landing INSIDE the card (which pushes the strip off the crop's bottom
edge on real captures). Read its numbers as a repro of a mechanism, never as
an accuracy estimate.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np

W, H = 480, 670
MARGIN = 0.05


def background(rng: random.Random) -> np.ndarray:
    base = np.array([rng.uniform(90, 160)] * 3, dtype=np.float32)
    base += np.array([rng.uniform(-8, 8), rng.uniform(-8, 8), rng.uniform(-8, 8)], dtype=np.float32)
    nrng = np.random.default_rng(rng.randrange(1 << 30))
    tex = nrng.normal(0, rng.uniform(8, 22), (H // 4, W // 4, 1)).astype(np.float32)
    tex = cv2.resize(tex, (W, H), interpolation=cv2.INTER_CUBIC)[..., None]
    return np.clip(base[None, None, :] + tex, 0, 255)


def synth(art: np.ndarray, rng: random.Random, hard: bool) -> np.ndarray:
    # 1. The card's height in the camera frame before the warp.
    card_h = rng.uniform(430, 700) if not hard else rng.uniform(360, 520)
    scale = card_h / art.shape[0]
    small = cv2.resize(art, (max(8, int(art.shape[1] * scale)), max(8, int(card_h))), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    # 2. Where it lands in the crop: the quad plus the 5% margin, each corner off
    #    by the detector's error.
    inner_w, inner_h = W / (1 + 2 * MARGIN), H / (1 + 2 * MARGIN)
    x0, y0 = (W - inner_w) / 2, (H - inner_h) / 2
    err = 0.025 if not hard else 0.045
    dst = []
    for cx, cy in ((x0, y0), (x0 + inner_w, y0), (x0 + inner_w, y0 + inner_h), (x0, y0 + inner_h)):
        dst.append((cx + rng.uniform(-err, err) * inner_w, cy + rng.uniform(-err, err) * inner_h))
    src = np.float32([(0, 0), (sw, 0), (sw, sh), (0, sh)])
    M = cv2.getPerspectiveTransform(src, np.float32(dst))
    bg = background(rng)
    warped = cv2.warpPerspective(small.astype(np.float32), M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
    mask = cv2.warpPerspective(np.ones((sh, sw), np.float32), M, (W, H), flags=cv2.INTER_LINEAR)[..., None]
    img = warped * mask + bg * (1 - mask)
    # 3. Light.
    img *= rng.uniform(0.72, 1.08)
    img *= np.array([rng.uniform(0.9, 1.08), rng.uniform(0.95, 1.03), rng.uniform(0.86, 1.06)], np.float32)[None, None, :]
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    ang = rng.uniform(0, 2 * np.pi)
    img *= (1 + ((gx / W - 0.5) * np.cos(ang) + (gy / H - 0.5) * np.sin(ang)) * rng.uniform(0, 0.35))[..., None]
    if rng.random() < (0.35 if not hard else 0.6):
        cx, cy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(60, 220)
        img += (np.exp(-(((gx - cx) ** 2 + (gy - cy) ** 2) / (2 * r * r))) * rng.uniform(40, 140))[..., None]
    # 4. Optics and sensor.
    img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 1.2) if not hard else rng.uniform(1.0, 1.8))
    if rng.random() < 0.3:
        k = rng.choice([3, 5])
        kern = np.zeros((k, k), np.float32)
        kern[k // 2, :] = 1.0 / k
        kern = cv2.warpAffine(kern, cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), rng.uniform(0, 180), 1), (k, k))
        img = cv2.filter2D(img, -1, kern / max(float(kern.sum()), 1e-6))
    img += np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(1.5, 5.0), img.shape).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art_dir")
    ap.add_argument("bench_root")
    ap.add_argument("dataset")
    ap.add_argument("--variants", type=int, default=8)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    out = Path(a.bench_root) / "datasets" / a.dataset
    (out / "crops").mkdir(parents=True, exist_ok=True)
    rows = []
    for f in sorted(Path(a.art_dir).glob("*.webp")):
        card_id = f.stem
        art = cv2.imread(str(f), cv2.IMREAD_COLOR)
        for v in range(a.variants):
            rng = random.Random(f"{a.seed}:{card_id}:{v}")
            hard = v >= a.variants * 3 // 4
            name = f"{card_id}_{v:02d}.jpg"
            cv2.imwrite(str(out / "crops" / name), synth(art, rng, hard), [cv2.IMWRITE_JPEG_QUALITY, 85])
            rows.append(dict(
                id=f"{a.dataset}:{card_id}:{v}", dataset=a.dataset, crop=f"crops/{name}", cropFull=f"crops/{name}",
                w=W, h=H, capturedAt=None, source="synthetic", truth=[card_id], kind="card",
                physicalId=f"{a.dataset}:{card_id}", issues=(["blur"] if hard else []),
                notes="synthetic capture from catalogue art (synth.py)", prov="synth.py", truthConfidence="high"))
    (out / "manifest.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")
    print(f"{len(rows)} crops -> {out}")


if __name__ == "__main__":
    main()
