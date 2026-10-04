"""Composite real card art onto the blank card faces of a generated photo.

The scene generator (scripts/gen-landing-photos.mjs) is told to leave every
readable card as a plain white face. That white face is a light probe: it has
been lit, tinted, shadowed, defocused and grained by the same "camera" as the
rest of the photo. So for each card we

  1. find the face and fit its four edges (or take a quad from the spec),
  2. estimate the face colour F (what pure white looks like at each pixel) by
     smoothing the face and extending it past its edges,
  3. estimate the matte a (how much of each pixel is face rather than mat) from
     the face colour and an inpainted background,
  4. warp the art into the quad with supersampling, blur it to the face's own
     edge sharpness, light it by multiplying with F,
  5. write   out = scene + a * (art * F - F).

Step 5 keeps everything the scene had on top of the face: grain (scene - F is
noise), mixed edge pixels, fingers and other occluders (a is 0 there), and
the subtle sleeve sheen that the smoothing left in F.

    python composite.py detect scene.png debug.png quads.json
    python composite.py compose spec.json
    python composite.py quads spec.json      # draw the quads only (spec "debug")

spec.json:
    {
      "scene": "path.png", "out": "path.png", "debug": "optional.png",
      "print": {"contrast": 0.93, "saturation": 0.92, "lift": 0.02},
      "retouch": [{"rect": [x0, y0, x1, y1], "mode": "bright"}],   # paint out pseudo-text
      "protect": [{"ellipse": [cx, cy, rx, ry]}, {"poly": [[x, y], ...]}],   # never painted
      "protect_skin": {"sat": 0.13},                                       # hands holding cards
      "cards": [
        {"art": "cards/me05-038.webp", "detect": 3, "rot": 0},
        {"art": "...", "quad": [[x, y], [x, y], [x, y], [x, y]], "z": 2, "blur": 1.2}
      ]
    }

Quads are TL, TR, BR, BL of the card as printed. `rot` (quarter turns,
clockwise) re-assigns corners when detection guessed the wrong top edge. `z`
orders overlapping cards; a card is clipped by every quad in front of it.
"""

from __future__ import annotations

import json
import math
import os
import sys

import cv2
import numpy as np

SS = 4  # supersampling factor for the warp


# ---------------------------------------------------------------- io helpers

def load_rgb(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit(f"cannot read {path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        img = img[:, :, :3]
    return img.astype(np.float32) / 255.0


def load_art(path: str) -> np.ndarray:
    """Card art as opaque float BGR. Transparent rounded corners are filled
    with the neighbouring border colour so the SCENE's own corner shape (via
    the matte) decides the silhouette, not the scan's."""
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit(f"cannot read {path}")
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3]
        bgr = img[:, :, :3].copy()
        hole = (alpha < 250).astype(np.uint8) * 255
        if hole.any():
            bgr = cv2.inpaint(bgr, hole, 6, cv2.INPAINT_TELEA)
        img = bgr
    return img.astype(np.float32) / 255.0


def save(path: str, img: np.ndarray) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    cv2.imwrite(path, np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8))


def luma(img: np.ndarray) -> np.ndarray:
    return img[:, :, 0] * 0.114 + img[:, :, 1] * 0.587 + img[:, :, 2] * 0.299


# ---------------------------------------------------------------- detection

def white_mask(scene: np.ndarray, cfg: dict) -> np.ndarray:
    hi = scene.max(axis=2)
    lo = scene.min(axis=2)
    sat = (hi - lo) / np.maximum(hi, 1e-4)
    L = luma(scene)
    # Local reference: a face is much brighter than its neighbourhood.
    local = cv2.GaussianBlur(L, (0, 0), cfg.get("local_sigma", 40))
    m = (L > cfg.get("min_luma", 0.42)) & (sat < cfg.get("max_sat", 0.38)) & (L > local * cfg.get("local_ratio", 1.15))
    m = m.astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # The local-contrast test drops the middle of a big face (its surround is
    # itself), so fill every enclosed hole that is bright enough to be face.
    bright = ((L > cfg.get("min_luma", 0.42)) & (sat < cfg.get("max_sat", 0.38))).astype(np.uint8) * 255
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(m)
    cv2.drawContours(filled, contours, -1, 255, -1)
    return np.maximum(m, filled & bright)


def order_quad(pts: np.ndarray) -> np.ndarray:
    """Clockwise in image space, starting from the corner whose following edge
    (TL->TR) has the highest midpoint, i.e. the card's top faces image-up."""
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]  # clockwise on screen (y down)
    best, best_y = 0, 1e9
    for i in range(4):
        mid_y = (pts[i, 1] + pts[(i + 1) % 4, 1]) / 2
        if mid_y < best_y:
            best, best_y = i, mid_y
    return np.roll(pts, -best, axis=0)


def line_intersect(l1, l2):
    (vx1, vy1, x1, y1), (vx2, vy2, x2, y2) = l1, l2
    a = np.array([[vx1, -vx2], [vy1, -vy2]], dtype=np.float64)
    b = np.array([x2 - x1, y2 - y1], dtype=np.float64)
    if abs(np.linalg.det(a)) < 1e-9:
        return None
    t = np.linalg.solve(a, b)[0]
    return np.array([x1 + t * vx1, y1 + t * vy1])


def refine_quad(contour: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Fit a line to each side, ignoring the rounded corners, and intersect."""
    pts = contour.reshape(-1, 2).astype(np.float64)
    lines = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        ab = b - a
        L = np.linalg.norm(ab)
        if L < 4:
            return quad
        u = ab / L
        n = np.array([-u[1], u[0]])
        rel = pts - a
        t = rel @ u
        d = np.abs(rel @ n)
        sel = (t > 0.15 * L) & (t < 0.85 * L) & (d < max(3.0, 0.04 * L))
        if sel.sum() < 6:
            return quad
        vx, vy, x0, y0 = cv2.fitLine(pts[sel].astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lines.append((vx, vy, x0, y0))
    out = []
    for i in range(4):
        p = line_intersect(lines[(i - 1) % 4], lines[i])
        if p is None:
            return quad
        out.append(p)
    out = np.array(out)
    if np.abs(out - quad).max() > 0.15 * np.linalg.norm(quad[1] - quad[0]) + 6:
        return quad
    return out


def detect(scene: np.ndarray, cfg: dict) -> list[dict]:
    m = white_mask(scene, cfg)
    h, w = m.shape
    min_area = cfg.get("min_area", (w * h) * 0.0012)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    found = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        hull = cv2.convexHull(cnt)
        peri = cv2.arcLength(hull, True)
        approx = None
        for eps in np.linspace(0.01, 0.08, 15):
            ap = cv2.approxPolyDP(hull, eps * peri, True)
            if len(ap) == 4:
                approx = ap.reshape(4, 2).astype(np.float64)
                break
        if approx is None:
            continue
        fill = area / max(cv2.contourArea(approx.astype(np.float32)), 1)
        quad = order_quad(refine_quad(cnt, order_quad(approx)))
        found.append({"quad": quad.round(2).tolist(), "area": float(area), "fill": round(float(fill), 3)})
    found.sort(key=lambda f: (np.mean([p[1] for p in f["quad"]]) // 80, np.mean([p[0] for p in f["quad"]])))
    return found


def draw_debug(scene: np.ndarray, quads: list, labels: list[str]) -> np.ndarray:
    dbg = (np.clip(scene, 0, 1) * 255).astype(np.uint8).copy()
    scale = max(1, dbg.shape[1] // 1400)
    for q, lab in zip(quads, labels):
        q = np.array(q, dtype=np.float64)
        cv2.polylines(dbg, [q.round().astype(np.int32)], True, (0, 0, 255), 2 * scale, cv2.LINE_AA)
        cv2.circle(dbg, tuple(q[0].round().astype(int)), 6 * scale, (0, 255, 0), -1, cv2.LINE_AA)  # TL
        cv2.circle(dbg, tuple(q[1].round().astype(int)), 6 * scale, (255, 160, 0), -1, cv2.LINE_AA)  # TR
        c = q.mean(axis=0).round().astype(int)
        cv2.putText(dbg, lab, (int(c[0]) - 14 * scale, int(c[1]) + 10 * scale), cv2.FONT_HERSHEY_SIMPLEX, 1.1 * scale, (0, 0, 0), 6 * scale, cv2.LINE_AA)
        cv2.putText(dbg, lab, (int(c[0]) - 14 * scale, int(c[1]) + 10 * scale), cv2.FONT_HERSHEY_SIMPLEX, 1.1 * scale, (0, 255, 255), 2 * scale, cv2.LINE_AA)
    return dbg.astype(np.float32) / 255.0


# ---------------------------------------------------------------- grids + snapping

def grid_cell_quad(grid: dict, row: int, col: int) -> np.ndarray:
    """Quad of one face in a regular block of faces (a binder page, a row of
    toploaders) whose OUTER corners are known: the block is mapped through
    its own homography, so perspective is exact for a planar block."""
    rows, cols = grid.get("rows", 3), grid.get("cols", 3)
    gap = grid.get("gap", 0.1)
    gx, gy = (gap, gap) if not isinstance(gap, list) else gap
    W = cols + (cols - 1) * gx
    Hh = rows + (rows - 1) * gy
    u0 = col * (1 + gx) / W
    u1 = (col * (1 + gx) + 1) / W
    v0 = row * (1 + gy) / Hh
    v1 = (row * (1 + gy) + 1) / Hh
    src = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(src, np.array(grid["corners"], dtype=np.float32))
    pts = np.array([[[u0, v0], [u1, v0], [u1, v1], [u0, v1]]], dtype=np.float32)
    return cv2.perspectiveTransform(pts, H)[0].astype(np.float64)


def snap_quad(L: np.ndarray, quad: np.ndarray, radius: float) -> np.ndarray:
    """Move each side of an approximate quad onto the face's real edge: the
    strongest bright-inside / darker-outside step within `radius` along the
    side's outward normal, then a robust line fit and corner intersection."""
    Ls = cv2.GaussianBlur(L, (0, 0), 1.0)
    h, w = Ls.shape
    c = quad.mean(axis=0)
    lines = []
    steps = np.arange(-radius, radius + 0.5, 0.5)
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        ab = b - a
        Ln = np.linalg.norm(ab)
        u = ab / max(Ln, 1e-6)
        n = np.array([-u[1], u[0]])
        if np.dot((a + b) / 2 - c, n) < 0:
            n = -n  # outward
        pts = []
        for t in np.linspace(0.14, 0.86, 28):
            p = a + ab * t
            xs = p[0] + n[0] * steps
            ys = p[1] + n[1] * steps
            if xs.min() < 1 or ys.min() < 1 or xs.max() > w - 2 or ys.max() > h - 2:
                continue
            prof = cv2.remap(Ls, xs.astype(np.float32)[None, :], ys.astype(np.float32)[None, :], cv2.INTER_LINEAR)[0]
            grad = -np.gradient(prof)  # positive where it gets darker going out
            score = grad * np.exp(-(steps ** 2) / (2 * (radius * 0.6) ** 2))
            k = int(np.argmax(score))
            if grad[k] < 0.01:
                continue
            pts.append(p + n * steps[k])
        if len(pts) < 6:
            lines.append(None)
            continue
        vx, vy, x0, y0 = cv2.fitLine(np.array(pts, np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lines.append((vx, vy, x0, y0))
    out = quad.copy()
    for i in range(4):
        l1, l2 = lines[(i - 1) % 4], lines[i]
        if l1 is None or l2 is None:
            continue
        p = line_intersect(l1, l2)
        if p is not None and np.linalg.norm(p - quad[i]) < radius * 2.5:
            out[i] = p
    return out


# ---------------------------------------------------------------- compositing

def offset_quad(quad, px: float) -> np.ndarray:
    """Move every side of a convex quad outward by `px` pixels (inward if negative)."""
    q = np.array(quad, dtype=np.float64)
    if not px:
        return q
    c = q.mean(axis=0)
    lines = []
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        u = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        n = np.array([-u[1], u[0]])
        if np.dot((a + b) / 2 - c, n) < 0:
            n = -n
        p0 = a + n * px
        lines.append((u[0], u[1], p0[0], p0[1]))
    out = []
    for i in range(4):
        p = line_intersect(lines[(i - 1) % 4], lines[i])
        out.append(q[i] if p is None else p)
    return np.array(out)


def quad_mask(shape, quad, grow: float = 0.0) -> np.ndarray:
    """Anti-aliased fill of a quad, optionally offset outward by `grow` px."""
    q = offset_quad(quad, grow)
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [(q * 16).round().astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    return m.astype(np.float32) / 255.0


def extend_field(field: np.ndarray, support: np.ndarray, sigma: float) -> np.ndarray:
    """Normalised-convolution fill: smooth `field` inside `support` and carry
    it outward so it is defined across the whole quad and its edge band."""
    s = support.astype(np.float32)
    if s.sum() < 1:
        return field.copy()
    mean = (field * s[:, :, None]).sum(axis=(0, 1)) / s.sum()
    out = np.empty_like(field)
    for k in range(field.shape[2]):
        # Coarse to fine: each wider pass fills where the narrower one has no
        # support, and the support-wide mean backs up the widest.
        acc = np.full(field.shape[:2], mean[k], np.float32)
        for sg in (sigma * 27, sigma * 9, sigma * 3, sigma):
            num = cv2.GaussianBlur(field[:, :, k] * s, (0, 0), sg)
            den = cv2.GaussianBlur(s, (0, 0), sg)
            est = num / np.maximum(den, 1e-6)
            wgt = np.clip(den / 0.08, 0, 1)
            acc = est * wgt + acc * (1 - wgt)
        out[:, :, k] = acc
    return out


def print_look(art: np.ndarray, cfg: dict) -> np.ndarray:
    """Scans are brighter and more saturated than ink on card stock."""
    c = cfg.get("contrast", 0.93)
    s = cfg.get("saturation", 0.92)
    lift = cfg.get("lift", 0.02)
    g = luma(art)[:, :, None]
    art = g + (art - g) * s
    art = (art - 0.5) * c + 0.5 + lift
    return np.clip(art, 0, 1)


def warp_art(art: np.ndarray, quad, rot: int, roi) -> np.ndarray:
    x0, y0, x1, y1 = roi
    q = (np.array(quad, dtype=np.float64) - [x0, y0]) * SS
    q = np.roll(q, rot % 4, axis=0)  # rot quarter turns: which scene corner is the art's TL
    dst_w = np.linalg.norm(q[1] - q[0])
    ah, aw = art.shape[:2]
    # Prefilter heavy minification so the supersampled warp does not alias.
    if dst_w < aw * 0.7:
        f = max(dst_w / aw, 0.05)
        art = cv2.resize(art, (max(8, int(aw * f)), max(8, int(ah * f))), interpolation=cv2.INTER_AREA)
        ah, aw = art.shape[:2]
    src = np.array([[0, 0], [aw, 0], [aw, ah], [0, ah]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(src, q.astype(np.float32))
    W, Hh = (x1 - x0) * SS, (y1 - y0) * SS
    big = cv2.warpPerspective(art, H, (W, Hh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return cv2.resize(big, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)


def estimate_sigma(a: np.ndarray, band: np.ndarray) -> float:
    """Edge blur from the matte: a blurred step of height 1 has peak gradient
    1/(sigma*sqrt(2*pi)). `band` limits the measurement to the quad's own edge."""
    gx = cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3) / 8
    g = np.hypot(gx, gy)
    sel = (a > 0.3) & (a < 0.7) & (band > 0)
    if sel.sum() < 20:
        return 0.6
    # Peak gradient per edge pixel: dilate g locally then sample on the band.
    # Clutter beside an edge (a sleeve rim, a box wall) only ever softens the
    # measured step, so trust the sharper end of the distribution.
    peak = cv2.dilate(g, np.ones((3, 3), np.uint8))[sel]
    gm = float(np.percentile(peak, 80))
    return float(np.clip(1.0 / (math.sqrt(2 * math.pi) * max(gm, 1e-3)), 0.4, 8.0))


def edge_band(shape, quad, px: float) -> np.ndarray:
    return (quad_mask(shape, quad, grow=px) > 0.5) & (quad_mask(shape, quad, grow=-px) < 0.5)


def skin_mask(scene: np.ndarray, cfg: dict) -> np.ndarray:
    """Hands holding cards: warm, clearly saturated regions, kept only as
    large connected blobs, holes filled (a nail highlight is white and
    neutral), lightly feathered. A warm shadow on a white face is far less
    saturated than skin, so it stays card."""
    sm = cv2.GaussianBlur(scene, (0, 0), cfg.get("blur", 2.0))
    b, g, r = sm[:, :, 0], sm[:, :, 1], sm[:, :, 2]
    hi, lo = sm.max(axis=2), sm.min(axis=2)
    sat = (hi - lo) / np.maximum(hi, 1e-4)
    m = ((sat > cfg.get("sat", 0.13)) & (r >= g) & (g >= b * 0.95)).astype(np.uint8) * 255
    if cfg.get("roi"):
        x0, y0, x1, y1 = cfg["roi"]
        roi = np.zeros_like(m)
        roi[y0:y1, x0:x1] = 255
        m &= roi
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= cfg.get("min_area", 20000):
            keep[lab == i] = 255
    # Fill only small holes: a card held between thumb and fingers is a big
    # hole and must stay card.
    filled = keep.copy()
    contours, hier = cv2.findContours(keep, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is not None:
        for i, h in enumerate(hier[0]):
            if h[3] >= 0 and cv2.contourArea(contours[i]) < cfg.get("max_hole", 4000):
                cv2.drawContours(filled, contours, i, 255, -1)
    if cfg.get("grow"):
        k = int(cfg["grow"]) * 2 + 1
        filled = cv2.dilate(filled, np.ones((k, k), np.uint8))
    return cv2.GaussianBlur(filled.astype(np.float32) / 255.0, (0, 0), cfg.get("feather", 1.2))


def retouch(scene: np.ndarray, items: list) -> np.ndarray:
    """Paint out generated pseudo-text and logo marks before compositing.
    Each item is a rect; "bright" masks only marks lighter than the rect's
    median (light lettering on a dark mat border), "dark" the reverse,
    "rect" the whole rect. Masked pixels are inpainted from their surround."""
    img = (np.clip(scene, 0, 1) * 255).astype(np.uint8)
    L = luma(scene)
    mask = np.zeros(L.shape, np.uint8)
    for it in items:
        x0, y0, x1, y1 = it["rect"]
        sub = L[y0:y1, x0:x1]
        mode = it.get("mode", "bright")
        delta = it.get("delta", 0.05)
        if mode == "rect":
            m = np.ones_like(sub, np.uint8)
        elif mode == "dark":
            m = (sub < np.median(sub) - delta).astype(np.uint8)
        else:
            m = (sub > np.median(sub) + delta).astype(np.uint8)
        mask[y0:y1, x0:x1] |= m * 255
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    out = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA).astype(np.float32) / 255.0
    # Inpainting is smooth; give it back the scene's grain so it does not read as a smudge.
    noise = scene - cv2.GaussianBlur(scene, (0, 0), 1.2)
    rng = np.random.default_rng(7)
    shift = np.roll(noise, (int(rng.integers(20, 40)), int(rng.integers(20, 40))), axis=(0, 1))
    m3 = (cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), 2))[:, :, None]
    return out * m3 + scene * (1 - m3) + shift * m3


def compose(spec_path: str, quads_only: bool = False) -> None:
    spec = json.load(open(spec_path, encoding="utf8"))
    base = os.path.dirname(os.path.abspath(spec_path))
    rel = lambda p: p if os.path.isabs(p) else os.path.join(base, p)

    scene = load_rgb(rel(spec["scene"]))
    if spec.get("retouch"):
        scene = retouch(scene, spec["retouch"])
    H, W = scene.shape[:2]
    det_cfg = spec.get("detect_cfg", {})
    detected = None
    cards = spec["cards"]
    grids = spec.get("grids", {})
    Lfull = luma(scene)
    for c in cards:
        if "grid" in c:
            c["quad"] = grid_cell_quad(grids[c["grid"]], *c["cell"]).tolist()
        elif "quad" not in c:
            if detected is None:
                detected = detect(scene, det_cfg)
            c["quad"] = detected[c["detect"]]["quad"]
        if c.get("snap"):
            c["quad"] = snap_quad(Lfull, np.array(c["quad"], dtype=np.float64), float(c["snap"])).tolist()

    if quads_only:
        dbg = draw_debug(scene, [c["quad"] for c in cards], [str(i) for i in range(len(cards))])
        save(rel(spec.get("debug", "quads-debug.png")), dbg)
        print(json.dumps([[[round(x, 1), round(y, 1)] for x, y in c["quad"]] for c in cards]))
        return

    wm = white_mask(scene, det_cfg).astype(np.float32) / 255.0
    out = scene.copy()
    # Regions no card may paint over (a highlight on a thumbnail that is as
    # white and neutral as a card face, say).
    protect = np.zeros((H, W), np.float32)
    for pr in spec.get("protect", []):
        m = np.zeros((H, W), np.uint8)
        if "ellipse" in pr:
            cx, cy, rx, ry = pr["ellipse"]
            cv2.ellipse(m, (int(cx), int(cy)), (int(rx), int(ry)), pr.get("angle", 0), 0, 360, 255, -1, cv2.LINE_AA)
        else:
            cv2.fillPoly(m, [np.array(pr["poly"], np.int32)], 255, cv2.LINE_AA)
        protect = np.maximum(protect, m.astype(np.float32) / 255.0)
    if spec.get("protect_skin"):
        protect = np.maximum(protect, skin_mask(scene, spec["protect_skin"]))
    print_cfg = spec.get("print", {})
    report = []

    order = sorted(range(len(cards)), key=lambda i: cards[i].get("z", 0))
    for i in order:
        c = cards[i]
        quad = np.array(c["quad"], dtype=np.float64)
        diag = np.linalg.norm(quad[0] - quad[2])
        pad = int(max(12, diag * 0.12))
        x0 = int(max(0, math.floor(quad[:, 0].min()) - pad))
        y0 = int(max(0, math.floor(quad[:, 1].min()) - pad))
        x1 = int(min(W, math.ceil(quad[:, 0].max()) + pad))
        y1 = int(min(H, math.ceil(quad[:, 1].max()) + pad))
        roi = (x0, y0, x1, y1)
        sc = scene[y0:y1, x0:x1]
        qm = quad_mask(scene.shape, quad)[y0:y1, x0:x1]

        # Cards in front clip this one.
        front = np.zeros_like(qm)
        for j in order:
            if cards[j].get("z", 0) > c.get("z", 0):
                front = np.maximum(front, quad_mask(scene.shape, cards[j]["quad"], grow=0.5)[y0:y1, x0:x1])

        # Face support: white pixels well inside the quad, not under a front card.
        inner = cv2.erode((qm > 0.99).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
        support = (wm[y0:y1, x0:x1] > 0.5) * inner * (front < 0.01)
        if c.get("support") == "quad":
            support = inner * (front < 0.01)
        if support.sum() < 30:
            print(f"card {i}: no visible face, skipped", file=sys.stderr)
            continue

        sig = c.get("light_sigma", max(1.5, diag * 0.006))
        F = extend_field(sc, support, sig)
        Ls, LF = luma(sc), luma(F)

        def matte_edge(reach: float):
            # Background (mat / sleeve edge) beyond the blurred edge, carried
            # inward so it is a smooth "what the face is lying on".
            outside = 1 - (quad_mask(scene.shape, quad, grow=reach)[y0:y1, x0:x1] > 0.01).astype(np.float32)
            B = extend_field(sc, outside, max(4.0, diag * 0.02))
            LB = luma(B)
            # The classic two-colour matte, observed = a*F + (1-a)*B.
            return np.clip((Ls - LB) / np.maximum(LF - LB, 0.05), 0, 1)

        reach0 = max(6.0, diag * 0.02)
        a_edge = matte_edge(reach0)
        sigma_guess = c.get("blur")
        if sigma_guess is None:
            band = edge_band(scene.shape, quad, max(4.0, diag * 0.02))[y0:y1, x0:x1]
            sigma_guess = estimate_sigma(a_edge, band)
        if 3 + 3 * sigma_guess > reach0:
            a_edge = matte_edge(3 + 3 * sigma_guess)
        qm_grow = quad_mask(scene.shape, quad, grow=c.get("grow", 1.0 + 2.5 * sigma_guess))[y0:y1, x0:x1]

        # Interior: anything clearly darker than the face's own white is an
        # occluder (a finger, a counter, a card edge) and keeps the scene.
        w = Ls / np.maximum(LF, 1e-3)
        a_int = np.clip((w - c.get("occluder_lo", 0.62)) / c.get("occluder_span", 0.28), 0, 1)
        k = int(max(3, round(sigma_guess * 2.5 + 3))) | 1
        interior = cv2.erode((qm > 0.99).astype(np.uint8), np.ones((k, k), np.uint8)).astype(np.float32)
        interior = cv2.GaussianBlur(interior, (0, 0), max(sigma_guess, 0.8))
        a = interior * a_int + (1 - interior) * a_edge
        if c.get("occluder_sat") is not None:
            # Skin and other coloured occluders: the face and sleeves are
            # neutral, so anything clearly saturated stays scene.
            hi, lo = sc.max(axis=2), sc.min(axis=2)
            sat = (hi - lo) / np.maximum(hi, 1e-4)
            a = a * np.clip((c["occluder_sat"] - sat) / 0.04, 0, 1)
        a = a * qm_grow * (1 - front) * (1 - protect[y0:y1, x0:x1])
        if c.get("matte_floor") is not None:
            a = np.maximum(a, (qm > 0.99) * (1 - front) * c["matte_floor"])

        sigma = c.get("blur")
        if sigma is None:
            sigma = sigma_guess
        art = print_look(load_art(rel(c["art"])), {**print_cfg, **c.get("print", {})})
        warped = warp_art(art, quad, c.get("rot", 0), roi)
        extra = math.sqrt(max(sigma * sigma - 0.55 * 0.55, 0))
        if extra > 0.05:
            warped = cv2.GaussianBlur(warped, (0, 0), extra)
        lit = warped * F * c.get("gain", 1.0)

        sheen = c.get("sheen", 0.0)
        if sheen:
            yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0].astype(np.float32)
            u = (xx - (quad[0, 0] - x0)) / max(x1 - x0, 1) + (yy - (quad[0, 1] - y0)) / max(y1 - y0, 1)
            band = np.exp(-((u - c.get("sheen_at", 0.75)) ** 2) / 0.02)
            lit = lit + (sheen * band)[:, :, None] * LF[:, :, None]

        region = out[y0:y1, x0:x1]
        region += a[:, :, None] * (lit - F)
        out[y0:y1, x0:x1] = region
        report.append({"card": i, "art": c["art"], "sigma": round(sigma, 2), "face_luma": round(float(np.median(LF[support > 0])), 3)})

    save(rel(spec["out"]), out)
    if spec.get("debug"):
        save(rel(spec["debug"]), draw_debug(out, [c["quad"] for c in cards], [str(i) for i in range(len(cards))]))
    print(json.dumps(report, indent=1))


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "detect":
        scene = load_rgb(sys.argv[2])
        cfg = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
        found = detect(scene, cfg)
        save(sys.argv[3], draw_debug(scene, [f["quad"] for f in found], [str(i) for i in range(len(found))]))
        json.dump(found, open(sys.argv[4], "w"), indent=1)
        for i, f in enumerate(found):
            print(i, f["fill"], int(f["area"]), [[round(x), round(y)] for x, y in f["quad"]])
    elif cmd == "compose":
        compose(sys.argv[2])
    elif cmd == "quads":
        compose(sys.argv[2], quads_only=True)
    elif cmd == "mask":
        scene = load_rgb(sys.argv[2])
        cfg = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        save(sys.argv[3], white_mask(scene, cfg).astype(np.float32) / 255.0)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
