"""The embed input spec, in Python — the OTHER half of the parity contract.

`packages/matching/src/input-spec.ts` is the specification and this file is its
mirror. Read that file's header for WHY the spec looks like this; what follows
is only what is peculiar to this side of it.

WHY THIS EXISTS AT ALL. Catalog vectors are produced off-line, and the only
serious off-line embedding stacks are Python's. A live scan is embedded in the
browser by the TypeScript module. If those two disagree by so much as a rounding
mode, every cosine between them is measuring the disagreement rather than the
card. So they are held to a BIT-EXACT contract: both compute the same tensor for
the same synthetic input and both check it against one committed digest
(`fixtures/parity-golden.json`), which is what `tests/test_parity.py` and
`src/__tests__/parity.test.ts` each assert. If you change one implementation and
not the other, two test suites fail and neither of them is subtle about it.

WHY IT IS PURE PYTHON AND NOT NUMPY. numpy's reductions are free to reassociate
and to use pairwise summation, which is numerically BETTER and therefore not
what JavaScript's left-to-right accumulation produces. The loop below is
deliberately naive so that the float64 operation order matches the TypeScript
statement for statement. It is not the fast path — `embed_input_numpy` is, and
`tests/test_parity.py` checks that the fast path agrees with this one before
trusting it.
"""

from __future__ import annotations

import math
import struct
from typing import Sequence, Tuple

# Mirrors of the TypeScript constants. Kept as literals rather than read from
# the .ts at runtime: a build step that parsed TypeScript to configure a Python
# job would be a new failure mode, and `tests/test_parity.py` already fails
# loudly if the two drift, which is the property actually wanted.
EMBED_SPEC_VERSION = 1
EMBED_SIZE = 224
EMBED_MEAN: Tuple[float, float, float] = (0.48145466, 0.4578275, 0.40821073)
EMBED_STD: Tuple[float, float, float] = (0.26862954, 0.26130258, 0.27577711)
EMBED_MODEL_ID = "clip-vit-b32-openai"


def card_rect(width: int, height: int, margin_frac: float = 0.0):
    """The source rectangle the model sees, after the capture margin is removed."""
    if margin_frac <= 0:
        return (0, 0, width, height)
    fx = round_half_away(width * margin_frac / (1 + 2 * margin_frac))
    fy = round_half_away(height * margin_frac / (1 + 2 * margin_frac))
    w = max(1, width - 2 * fx)
    h = max(1, height - 2 * fy)
    return (min(fx, width - 1), min(fy, height - 1), w, h)


def round_half_away(x: float) -> int:
    """JavaScript's `Math.round`, which is NOT Python's `round`.

    `Math.round(0.5)` is 1 and `Math.round(2.5)` is 3; Python's `round` is
    banker's rounding and answers 0 and 2. `math.floor(x + 0.5)` is the exact
    rule JavaScript specifies (including for negatives, where it rounds toward
    +Infinity, which `round(abs)` would get wrong). This is a one-pixel
    difference in the crop origin — which is to say, a completely different
    tensor, found the only way such things ever are: by the parity test.
    """
    return math.floor(x + 0.5)


def embed_input(
    data: Sequence[int],
    width: int,
    height: int,
    margin_frac: float = 0.0,
    size: int = EMBED_SIZE,
) -> list:
    """Row-major RGBA bytes -> a flat list of 3*size*size float32-rounded values,
    planar RGB, in the same order the TypeScript writes them.

    The returned values have already been passed through float32 rounding, so
    `pack_f32` of this list is byte-identical to the TypeScript Float32Array.
    """
    rx, ry, rw, rh = card_rect(width, height, margin_frac)
    plane = size * size
    out = [0.0] * (3 * plane)

    for oy in range(size):
        y0 = (oy * rh) / size + ry
        y1 = ((oy + 1) * rh) / size + ry
        iy0 = math.floor(y0)
        iy1 = max(iy0 + 1, math.ceil(y1))
        for ox in range(size):
            x0 = (ox * rw) / size + rx
            x1 = ((ox + 1) * rw) / size + rx
            ix0 = math.floor(x0)
            ix1 = max(ix0 + 1, math.ceil(x1))
            ar = 0.0
            ag = 0.0
            ab = 0.0
            wsum = 0.0
            for iy in range(iy0, iy1):
                wy = min(iy + 1, y1) - max(iy, y0)
                if wy <= 0:
                    continue
                row = iy * width
                for ix in range(ix0, ix1):
                    wx = min(ix + 1, x1) - max(ix, x0)
                    if wx <= 0:
                        continue
                    w = wy * wx
                    o = (row + ix) * 4
                    ar += w * data[o]
                    ag += w * data[o + 1]
                    ab += w * data[o + 2]
                    wsum += w
            o = oy * size + ox
            out[o] = f32(((ar / wsum) / 255 - EMBED_MEAN[0]) / EMBED_STD[0])
            out[plane + o] = f32(((ag / wsum) / 255 - EMBED_MEAN[1]) / EMBED_STD[1])
            out[2 * plane + o] = f32(((ab / wsum) / 255 - EMBED_MEAN[2]) / EMBED_STD[2])
    return out


def f32(x: float) -> float:
    """Round a float64 to the nearest float32 and back, exactly as assigning
    into a JavaScript Float32Array does."""
    return struct.unpack("<f", struct.pack("<f", x))[0]


def pack_f32(values: Sequence[float]) -> bytes:
    """Little-endian float32 bytes — the same bytes a Float32Array's buffer
    holds on every platform this runs on, which is what the golden digest is
    taken over."""
    return struct.pack("<%df" % len(values), *values)


def l2_normalize(v: Sequence[float]) -> list:
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n > 0 else list(v)


def embed_stamp(model_id: str = EMBED_MODEL_ID) -> str:
    return "e%d:%s" % (EMBED_SPEC_VERSION, model_id)


def embed_input_numpy(rgba, width: int, height: int, margin_frac: float = 0.0,
                      size: int = EMBED_SIZE):
    """The fast path for the catalog job: the same spec, vectorised.

    NOT the reference. `tests/test_parity.py` checks it against `embed_input`
    within a tolerance that is float32's own resolution, and the catalog job
    refuses to run if that check has not passed — a resampler that is 1e-7 off
    is fine for a cosine and is NOT fine to define the spec with, because two
    such implementations can drift in opposite directions.
    """
    import numpy as np

    rx, ry, rw, rh = card_rect(width, height, margin_frac)
    img = np.asarray(rgba, dtype=np.float64).reshape(height, width, 4)[
        ry : ry + rh, rx : rx + rw, :3
    ]
    # Exact box filter via per-axis overlap weight matrices: W_y (size x rh) and
    # W_x (rw x size), each row summing to the covered span. Same arithmetic as
    # the reference, associated differently — hence "not the reference".
    wy = _overlap_weights(rh, size)  # (size, rh)
    wx = _overlap_weights(rw, size).T  # (rw, size)
    acc = np.einsum("os,shc,ht->otc", wy, img, wx)
    denom = (wy.sum(axis=1)[:, None] * wx.sum(axis=0)[None, :])[:, :, None]
    mean = np.array(EMBED_MEAN, dtype=np.float64)
    std = np.array(EMBED_STD, dtype=np.float64)
    px = ((acc / denom) / 255.0 - mean) / std
    return np.ascontiguousarray(px.transpose(2, 0, 1), dtype=np.float32)


def _overlap_weights(src_len: int, out_len: int):
    """out_len x src_len matrix of per-source-pixel overlap for a box resize."""
    import numpy as np

    w = np.zeros((out_len, src_len), dtype=np.float64)
    for o in range(out_len):
        a = (o * src_len) / out_len
        b = ((o + 1) * src_len) / out_len
        i0 = math.floor(a)
        i1 = max(i0 + 1, math.ceil(b))
        for i in range(i0, min(i1, src_len)):
            w[o, i] = min(i + 1, b) - max(i, a)
    return w
