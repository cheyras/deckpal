"""A port of the shipping scan-engine preprocessing, and the exact way back.

Sources, all in apps/web/src/scan/engine/:
  preprocess.ts  MODEL_SIZE, PAD_VALUE, computeLetterbox, modelNormToFrame,
                 frameToModelNorm, modelPointsToQuad, letterboxRGBA,
                 rgbaToBGRPlanar
  index.ts       INFERENCE_RECT, inferenceTransform        (pipeline v2)
  frame.ts       CANONICAL_SIZE, squareCrop, canonical<->stream,
                 modelPointsToCanonicalQuad                 (pipeline v3)

TWO PIPELINES, AND WHICH ONE TRAINING USES
-----------------------------------------
v3 (live since 2026-09-04, what the labeler corpus is): the stream's centre
square is resampled to the 416x416 CANONICAL frame, and the model input is a
PLAIN RESIZE of that square to 256 (index.ts drawModelInput). No letterbox, no
padding, so a model fraction IS a canonical fraction: canonical px = p * 416.
Manifest corners are canonical fractions, which makes them model targets as-is.

v2 (INFERENCE_RECT): the whole non-square frame letterboxed into 256 with
PAD_VALUE bars, mapped back with modelPointsToQuad. Superseded; kept because the
phase-0b corpus (session2, 480x640) was collected under it and the offline
harness replays it. For a SQUARE frame the v2 transform has scale 256/416 and
zero padding, i.e. it IS the v3 resize -- parity_preprocess.py proves the two
inverse maps agree.

WHAT IS EXACT AND WHAT IS NOT
-----------------------------
Exact (bit-for-bit against the TypeScript, see parity_preprocess.py): all the
geometry (JS Math.round semantics included), the nearest-neighbour reference
letterbox (letterboxRGBA), and the BGR-planar /255 conversion.

NOT portable: the resampler. The browser downscales with canvas drawImage
(smooth, engine-specific: Chrome/Skia vs Safari/CoreGraphics), the offline
harness substitutes sharp lanczos3, and Python substitutes OpenCV. None of the
three is the others. parity_preprocess.py measures the gap in pixels and in
model-output corners instead of pretending it is zero.

Image convention: an RGBA image is a (H, W, 4) uint8 numpy array, exactly the
byte layout of canvas ImageData.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Iterable, Optional, Sequence

import numpy as np

# preprocess.ts
MODEL_SIZE = 256
PAD_VALUE = 128
# frame.ts
CANONICAL_SIZE = 416
# index.ts (pipeline v2): the whole frame
INFERENCE_RECT = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}

Point = list  # [x, y]


# ---------------------------------------------------------------------------
# JavaScript number semantics
# ---------------------------------------------------------------------------


def js_round(v: float) -> int:
    """ECMAScript Math.round: round half toward +infinity.

    NOT Python's round() (banker's rounding: round(2.5) == 2, Math.round(2.5)
    == 3) and NOT floor(v + 0.5), which is wrong for 0.49999999999999994 (the
    addition itself rounds up to 1.0)."""
    r = math.floor(v)
    return int(r + 1) if v - r >= 0.5 else int(r)


def js_int32(v: float) -> int:
    """`v | 0` -- ToInt32 truncation. Only ever applied to frame dimensions
    (positive and far below 2**31), where it is plain truncation."""
    return int(math.trunc(v))


# ---------------------------------------------------------------------------
# preprocess.ts -- letterbox geometry and the way back
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LetterboxTransform:
    """preprocess.ts LetterboxTransform. crop is in FRAME px, integer-aligned."""

    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int
    size: int
    scale: float
    padX: float
    padY: float

    def to_ts(self) -> dict:
        """The same object shape the TypeScript returns, for parity checks."""
        return {
            "crop": {"x": self.crop_x, "y": self.crop_y, "w": self.crop_w, "h": self.crop_h},
            "size": self.size,
            "scale": self.scale,
            "padX": self.padX,
            "padY": self.padY,
        }


def _clamp_int(v: float, lo: int, hi: int) -> int:
    r = js_round(v)
    return lo if r < lo else hi if r > hi else r


def compute_letterbox(frame_w: int, frame_h: int, rect: dict = INFERENCE_RECT, size: int = MODEL_SIZE) -> LetterboxTransform:
    """preprocess.ts computeLetterbox. `rect` is in FRACTIONS of the frame."""
    x = _clamp_int(rect["x"] * frame_w, 0, max(0, frame_w - 1))
    y = _clamp_int(rect["y"] * frame_h, 0, max(0, frame_h - 1))
    w = max(1, min(_clamp_int(rect["w"] * frame_w, 1, frame_w), frame_w - x))
    h = max(1, min(_clamp_int(rect["h"] * frame_h, 1, frame_h), frame_h - y))
    scale = min(size / w, size / h)
    return LetterboxTransform(
        crop_x=x, crop_y=y, crop_w=w, crop_h=h, size=size, scale=scale,
        padX=(size - w * scale) / 2, padY=(size - h * scale) / 2,
    )


def inference_transform(frame_w: int, frame_h: int) -> LetterboxTransform:
    """index.ts inferenceTransform (pipeline v2): the whole frame, letterboxed."""
    return compute_letterbox(frame_w, frame_h, INFERENCE_RECT)


def model_norm_to_frame(t: LetterboxTransform, nx: float, ny: float) -> Point:
    """preprocess.ts modelNormToFrame: normalised model space [0,1] -> frame px."""
    return [
        (nx * t.size - t.padX) / t.scale + t.crop_x,
        (ny * t.size - t.padY) / t.scale + t.crop_y,
    ]


def frame_to_model_norm(t: LetterboxTransform, fx: float, fy: float) -> Point:
    """preprocess.ts frameToModelNorm: exact inverse of model_norm_to_frame."""
    return [
        ((fx - t.crop_x) * t.scale + t.padX) / t.size,
        ((fy - t.crop_y) * t.scale + t.padY) / t.size,
    ]


def model_points_to_quad(t: LetterboxTransform, points: Sequence[float]) -> Optional[list]:
    """preprocess.ts modelPointsToQuad: LC050's flat `points` -> frame-px quad."""
    if len(points) < 8:
        return None
    q = []
    for i in range(4):
        p = model_norm_to_frame(t, float(points[i * 2]), float(points[i * 2 + 1]))
        if not (math.isfinite(p[0]) and math.isfinite(p[1])):
            return None
        q.append(p)
    return q


def letterbox_rgba(src: np.ndarray, t: LetterboxTransform) -> np.ndarray:
    """preprocess.ts letterboxRGBA: the pure nearest-neighbour reference letterbox.

    Pixel-centre convention and the float operation order are the TypeScript's
    exactly ((o + 0.5 - pad) / scale + crop, then floor), so the sampled source
    index is bit-identical. Vectorised: rows and columns are independent."""
    H, W = src.shape[:2]
    size = t.size
    cx, cy, cw, ch = t.crop_x, t.crop_y, t.crop_w, t.crop_h
    o = np.arange(size, dtype=np.float64)
    iy = np.floor((o + 0.5 - t.padY) / t.scale + cy).astype(np.int64)
    ix = np.floor((o + 0.5 - t.padX) / t.scale + cx).astype(np.int64)
    row_in = (iy >= cy) & (iy < cy + ch) & (iy >= 0) & (iy < H)
    col_in = (ix >= cx) & (ix < cx + cw) & (ix >= 0) & (ix < W)
    out = np.full((size, size, 4), PAD_VALUE, dtype=np.uint8)
    out[..., 3] = 255
    inside = row_in[:, None] & col_in[None, :]
    yy = np.clip(iy, 0, H - 1)[:, None].repeat(size, 1)
    xx = np.clip(ix, 0, W - 1)[None, :].repeat(size, 0)
    out[inside, :3] = src[yy[inside], xx[inside], :3]
    return out


def rgba_to_bgr_planar(img: np.ndarray) -> np.ndarray:
    """preprocess.ts rgbaToBGRPlanar: RGBA -> flat float32 [B-plane, G-plane, R-plane], /255.

    NO mean/std. The phase-0b session-1 failure was an ImageNet-normalised tensor
    (saturated has_obj, incoherent quads); the model wants plain /255, BGR.
    JS divides in float64 then stores into a Float32Array (round-to-nearest);
    float64 division then astype(float32) is the same two roundings."""
    h, w = img.shape[:2]
    d = img.reshape(h * w, img.shape[2]).astype(np.float64)
    out = np.empty(3 * h * w, dtype=np.float32)
    out[: h * w] = (d[:, 2] / 255).astype(np.float32)  # B -> ch0
    out[h * w : 2 * h * w] = (d[:, 1] / 255).astype(np.float32)  # G -> ch1
    out[2 * h * w :] = (d[:, 0] / 255).astype(np.float32)  # R -> ch2
    return out


def to_nchw(planar: np.ndarray, size: int = MODEL_SIZE) -> np.ndarray:
    """Flat planar tensor -> the 1x3xSxS NCHW array model.ts hands ORT."""
    return planar.reshape(1, 3, size, size)


# ---------------------------------------------------------------------------
# frame.ts -- the canonical square (pipeline v3)
# ---------------------------------------------------------------------------


def square_crop(stream_w: int, stream_h: int) -> dict:
    """frame.ts squareCrop: the stream's centre square, in STREAM px."""
    size = max(1, min(js_int32(stream_w), js_int32(stream_h)))
    return {"x": js_round((stream_w - size) / 2), "y": js_round((stream_h - size) / 2), "size": size}


def canonical_to_stream(p: Sequence[float], crop: dict) -> Point:
    s = crop["size"] / CANONICAL_SIZE
    return [crop["x"] + p[0] * s, crop["y"] + p[1] * s]


def stream_to_canonical(p: Sequence[float], crop: dict) -> Point:
    s = crop["size"] / CANONICAL_SIZE
    return [(p[0] - crop["x"]) / s, (p[1] - crop["y"]) / s]


def stream_quad_to_canonical(q: Iterable[Sequence[float]], crop: dict) -> list:
    return [stream_to_canonical(p, crop) for p in q]


def canonical_quad_to_stream(q: Iterable[Sequence[float]], crop: dict) -> list:
    return [canonical_to_stream(p, crop) for p in q]


def model_points_to_canonical_quad(points: Sequence[float]) -> Optional[list]:
    """frame.ts modelPointsToCanonicalQuad: a model fraction IS a canonical fraction."""
    if points is None or len(points) < 8:
        return None
    out = []
    for i in range(4):
        x = float(points[i * 2]) * CANONICAL_SIZE
        y = float(points[i * 2 + 1]) * CANONICAL_SIZE
        if not (math.isfinite(x) and math.isfinite(y)):
            return None
        out.append([x, y])
    return out


# ---------------------------------------------------------------------------
# resampling -- the one substitution (see module docstring)
# ---------------------------------------------------------------------------

RESAMPLERS = ("area", "linear", "cubic", "lanczos")


def resize_rgba(img: np.ndarray, w: int, h: int, method: str = "area") -> np.ndarray:
    """Smooth resample standing in for canvas drawImage. `area` (box filter) is
    the default because it is alias-free on downscale, which is what a smoothed
    drawImage of a camera frame looks like; the parity script measures it
    against the harness's sharp lanczos3."""
    import cv2

    interp = {
        "area": cv2.INTER_AREA,
        "linear": cv2.INTER_LINEAR,
        "cubic": cv2.INTER_CUBIC,
        "lanczos": cv2.INTER_LANCZOS4,
        "nearest": cv2.INTER_NEAREST,
    }[method]
    if img.shape[1] == w and img.shape[0] == h:
        return img.copy()
    return cv2.resize(img, (w, h), interpolation=interp)


def smooth_letterbox_rgba(src: np.ndarray, t: LetterboxTransform, method: str = "area") -> np.ndarray:
    """drawLetterbox as the offline harness's engineInput performs it: a
    PAD_VALUE canvas plus ONE smooth resize of the crop, pasted at the rounded
    pad offset. Geometry identical to the harness; only the resampler differs."""
    dw = max(1, js_round(t.crop_w * t.scale))
    dh = max(1, js_round(t.crop_h * t.scale))
    crop = src[t.crop_y : t.crop_y + t.crop_h, t.crop_x : t.crop_x + t.crop_w]
    inner = resize_rgba(crop, dw, dh, method)
    out = np.full((t.size, t.size, 4), PAD_VALUE, dtype=np.uint8)
    out[..., 3] = 255
    left, top = js_round(t.padX), js_round(t.padY)
    out[top : top + dh, left : left + dw, :3] = inner[..., :3]
    return out


def canonical_frame(stream: np.ndarray, method: str = "area") -> tuple[np.ndarray, dict]:
    """The 416 canonical square a stream frame becomes (workingFrame.ts /
    index.ts grabWork): centre square, resampled. Returns (canonical, crop)."""
    c = square_crop(stream.shape[1], stream.shape[0])
    sq = stream[c["y"] : c["y"] + c["size"], c["x"] : c["x"] + c["size"]]
    return resize_rgba(sq, CANONICAL_SIZE, CANONICAL_SIZE, method), c


def model_input_from_square(square: np.ndarray, method: str = "area") -> np.ndarray:
    """Pipeline v3 model input: a plain resize of a square (the canonical frame,
    or a stream's centre square) to MODEL_SIZE, then BGR planar /255.
    Returns the 1x3x256x256 float32 array."""
    assert square.shape[0] == square.shape[1], "v3 input must be square"
    small = resize_rgba(square, MODEL_SIZE, MODEL_SIZE, method)
    return to_nchw(rgba_to_bgr_planar(small))


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def load_rgba(path) -> np.ndarray:
    """Decode an image to straight RGBA uint8 (what sharp().ensureAlpha().raw() gives)."""
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(path)
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2RGBA)
    if img.shape[2] == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGBA)
    return cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)


def save_rgba(path, img: np.ndarray) -> None:
    import cv2

    cv2.imwrite(str(path), cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA))


class OrtModel:
    """LC050 (or an exported fine-tune) under python onnxruntime, CPU, one frame
    per run -- the same discipline as ort_sidecar.py and model.ts."""

    def __init__(self, path):
        import onnxruntime as ort

        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name
        self.output_names = [o.name for o in self.sess.get_outputs()]

    def run(self, x: np.ndarray) -> tuple[np.ndarray, float]:
        o = dict(zip(self.output_names, self.sess.run(None, {self.input_name: x})))
        return np.ravel(o["points"]).astype(np.float64), float(np.ravel(o["has_obj"])[0])

    def run_raw(self, x: np.ndarray) -> dict:
        return dict(zip(self.output_names, self.sess.run(None, {self.input_name: x})))
