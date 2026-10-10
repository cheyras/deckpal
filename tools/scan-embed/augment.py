"""Turn clean catalogue art into something that looks like the scanner's crop.

The scanner's input to the identity model is a phone photo of a physical card,
perspective-corrected from a detected quad that is typically a few percent off
(median mean corner error 3.4% of the diagonal on the labelled corpus, check A),
widened by the 5% capture margin, JPEG'd at q85 at 480x670. On top of that the
field crops show fingers on 35 of 112, washed-out glare on 25, truncation on 13,
blur on 9 (scan-telemetry/analysis, judged by eye). Every transform below is one
of those, at roughly the strength the field shows; none of them invents a failure
the field does not have.

`synth_capture(art, rng)` -> HxWx3 uint8 at the capture size (480x670).
"""
from __future__ import annotations

import math

import cv2
import numpy as np

# Synthesised at HALF the capture size: the model sees 224x224, so a 480x670
# synthesis spends 4x the CPU on pixels the squash throws away, and on this
# machine the augmentation, not the GPU, is the training bottleneck. Pixel-sized
# parameters below are scaled by S so their effect matches the full-size crop.
CAP_W, CAP_H = 240, 335
S = CAP_W / 480
MARGIN = 0.05  # rectify.ts CAPTURE_MARGIN: the card spans the middle 1/(1+2m) of each axis


def _bg(rng: np.random.Generator, others: list[np.ndarray] | None) -> np.ndarray:
    k = rng.random()
    if k < 0.35:  # flat-ish table / mat
        c = rng.integers(0, 256, 3)
        img = np.empty((CAP_H, CAP_W, 3), np.float32)
        img[:] = c
        img += rng.normal(0, rng.uniform(2, 12), img.shape)
    elif k < 0.6:  # gradient lighting across a surface
        c0, c1 = rng.integers(0, 256, 3), rng.integers(0, 256, 3)
        t = np.linspace(0, 1, CAP_H)[:, None, None] if rng.random() < 0.5 else np.linspace(0, 1, CAP_W)[None, :, None]
        img = (c0 * (1 - t) + c1 * t).astype(np.float32) * np.ones((CAP_H, CAP_W, 1), np.float32)
        img += rng.normal(0, 6, img.shape)
    elif k < 0.85 and others:  # other cards on the table (clutter)
        o = others[rng.integers(len(others))]
        img = cv2.resize(o, (CAP_W, CAP_H)).astype(np.float32)
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 3) * S)
    else:  # coarse texture (wood, fabric)
        small = rng.integers(0, 256, (rng.integers(4, 24), rng.integers(4, 24), 3)).astype(np.float32)
        img = cv2.resize(small, (CAP_W, CAP_H), interpolation=cv2.INTER_CUBIC)
        img += rng.normal(0, 8, img.shape)
    return np.clip(img, 0, 255)


def _place(art: np.ndarray, bg: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Warp the card onto the capture frame where an imperfect quad would put it."""
    s = 1 / (1 + 2 * MARGIN)
    x0, x1 = (1 - s) / 2 * CAP_W, (1 + s) / 2 * CAP_W
    y0, y1 = (1 - s) / 2 * CAP_H, (1 + s) / 2 * CAP_H
    dst = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float32)
    # global misregistration: shift, scale, small rotation
    cx, cy = CAP_W / 2, CAP_H / 2
    sc = rng.normal(1.0, 0.035)
    th = math.radians(rng.normal(0, 1.5))
    sh = rng.normal(0, 0.02, 2) * [CAP_W, CAP_H]
    R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    dst = ((dst - [cx, cy]) @ R.T) * sc + [cx, cy] + sh
    # per-corner detector error (the dominant term: ~3% of the diagonal)
    diag = math.hypot(CAP_W, CAP_H)
    dst += rng.normal(0, rng.uniform(0.004, 0.022) * diag, (4, 2))
    h, w = art.shape[:2]
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    warped = cv2.warpPerspective(art.astype(np.float32), M, (CAP_W, CAP_H), flags=cv2.INTER_LINEAR)
    mask = cv2.warpPerspective(np.ones((h, w), np.float32), M, (CAP_W, CAP_H), flags=cv2.INTER_LINEAR)[..., None]
    return warped * mask + bg * (1 - mask)


def _photometric(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    img = img / 255.0
    img = img * rng.uniform(0.7, 1.25) + rng.uniform(-0.08, 0.08)  # exposure
    m = img.mean()
    img = (img - m) * rng.uniform(0.7, 1.25) + m  # contrast
    img = np.clip(img, 0, 1) ** rng.uniform(0.75, 1.35)  # gamma
    temp = rng.normal(0, 0.06)
    img *= np.array([1 + temp, 1 + rng.normal(0, 0.02), 1 - temp])  # white balance (RGB)
    grey = img.mean(axis=2, keepdims=True)
    img = grey + (img - grey) * rng.uniform(0.6, 1.3)  # saturation
    return np.clip(img, 0, 1) * 255


def _glare(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    yy, xx = np.mgrid[0:CAP_H, 0:CAP_W].astype(np.float32)
    for _ in range(rng.integers(1, 4)):
        cx, cy = rng.uniform(0, CAP_W), rng.uniform(0, CAP_H)
        sx, sy = rng.uniform(0.04, 0.35) * CAP_W, rng.uniform(0.03, 0.25) * CAP_H
        a = rng.uniform(0, math.pi)
        X = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)
        Y = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
        blob = np.exp(-(X**2 / (2 * sx**2) + Y**2 / (2 * sy**2)))
        img = img + blob[..., None] * rng.uniform(60, 255)
    return np.clip(img, 0, 255)


def _washout(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    t = np.linspace(0, 1, CAP_W)[None, :, None] if rng.random() < 0.5 else np.linspace(0, 1, CAP_H)[:, None, None]
    if rng.random() < 0.5:
        t = 1 - t
    a = rng.uniform(0.25, 0.7) * t
    return img * (1 - a) + 255 * a


def _holo(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    yy, xx = np.mgrid[0:CAP_H, 0:CAP_W].astype(np.float32)
    f = rng.uniform(0.01, 0.05)
    ph = (xx * math.cos(rng.uniform(0, math.pi)) + yy * math.sin(rng.uniform(0, math.pi))) * f
    rainbow = np.stack([np.sin(ph), np.sin(ph + 2.1), np.sin(ph + 4.2)], -1) * 0.5 + 0.5
    a = rng.uniform(0.04, 0.14)
    return img * (1 - a) + rainbow * 255 * a


def _finger(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    skin = np.array([rng.uniform(150, 235), rng.uniform(100, 190), rng.uniform(80, 165)])
    mask = np.zeros((CAP_H, CAP_W), np.float32)
    edge = rng.integers(4)
    L = rng.uniform(0.08, 0.3)
    if edge == 0:
        c = (int(rng.uniform(0, CAP_W)), 0)
    elif edge == 1:
        c = (int(rng.uniform(0, CAP_W)), CAP_H)
    elif edge == 2:
        c = (0, int(rng.uniform(0, CAP_H)))
    else:
        c = (CAP_W, int(rng.uniform(0, CAP_H)))
    ax = (int(rng.uniform(0.06, 0.12) * CAP_W), int(L * CAP_H))
    cv2.ellipse(mask, c, ax if edge < 2 else ax[::-1], rng.uniform(-30, 30), 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), 4 * S)[..., None]
    shade = (skin * rng.uniform(0.7, 1.05)) + rng.normal(0, 4, (CAP_H, CAP_W, 3))
    return img * (1 - mask) + shade * mask


def _shadow(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    yy, xx = np.mgrid[0:CAP_H, 0:CAP_W].astype(np.float32)
    a = rng.uniform(0, 2 * math.pi)
    d = (xx - CAP_W / 2) * math.cos(a) + (yy - CAP_H / 2) * math.sin(a) - rng.uniform(-150, 150) * S
    m = 1 / (1 + np.exp(-d / (rng.uniform(10, 60) * S)))
    return img * (1 - m[..., None] * rng.uniform(0.1, 0.45))


def _blur(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    if rng.random() < 0.7:
        return cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 2.2) * S)
    k = max(3, int(rng.integers(5, 17) * S) | 1)
    kern = np.zeros((k, k), np.float32)
    kern[k // 2, :] = 1 / k
    M = cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), rng.uniform(0, 180), 1)
    kern = cv2.warpAffine(kern, M, (k, k))
    kern /= max(kern.sum(), 1e-6)
    return cv2.filter2D(img, -1, kern)


def synth_capture(art: np.ndarray, rng: np.random.Generator, others: list[np.ndarray] | None = None,
                  strength: float = 1.0) -> np.ndarray:
    """One synthetic scanner crop of `art` (RGB uint8)."""
    big = cv2.resize(art, (int(CAP_W / (1 + 2 * MARGIN)), int(CAP_H / (1 + 2 * MARGIN))), interpolation=cv2.INTER_CUBIC)
    img = _place(big, _bg(rng, others), rng)
    p = lambda x: rng.random() < x * strength  # noqa: E731
    img = _photometric(img, rng)
    if p(0.10):
        img = _washout(img, rng)
    if p(0.35):
        img = _glare(img, rng)
    if p(0.2):
        img = _holo(img, rng)
    if p(0.3):
        img = _shadow(img, rng)
    if p(0.3):
        img = _finger(img, rng)
    if p(0.45):
        img = _blur(img, rng)
    if p(0.4):  # resolution loss: phone far away, or a telemetry-sized crop
        f = rng.uniform(0.3, 0.7)
        small = cv2.resize(img, (int(CAP_W * f), int(CAP_H * f)), interpolation=cv2.INTER_AREA)
        img = cv2.resize(small, (CAP_W, CAP_H), interpolation=cv2.INTER_LINEAR)
    img = img + rng.normal(0, rng.uniform(0, 6), img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    q = int(rng.integers(40, 96))
    ok, enc = cv2.imencode(".jpg", img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)[..., ::-1].copy()
