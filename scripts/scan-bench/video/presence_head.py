"""Refit LC050's presence head (has_obj) on the labelled video frames.

    PY=~/deckpal-data/venvs/scanid/Scripts/python.exe
    $PY scripts/scan-bench/video/presence_head.py collect          # features of every labelled frame (~25 min, cached)
    $PY scripts/scan-bench/video/presence_head.py report           # shipped head vs refit, leave-one-video-out
    $PY scripts/scan-bench/video/presence_head.py export <dst.onnx> [--exclude <videoId>]

WHY. On the pack-opening videos the shipped head put only 31% of frames that
show a card over the gate's acquire threshold (0.8). Busy backgrounds out-vote
it, and the tracker never sees a quad the gate kept shut. The corner head's
quads were mostly fine. So only the presence head is refit, on frames
of the same videos: a logistic regression over the 256-d pooled feature that
feeds `head.has_obj.1` (a 256->1 Gemm, then the model's own sigmoid). Classes
are balanced, with L2 0.01.

WHAT CHANGES IN THE MODEL. `export` replaces exactly two initializers,
`head.has_obj.1.weight` and `.bias`, with the feature standardisation folded
in. The backbone and the corner head are byte-identical, so no quad changes:
only hasObj does.

THE FRAMES. For every capturable ground-truth appearance (video-bench/gt), the
frames at 25/50/75% of it are positives. Negatives are one frame a second,
inside the labelled window, at least 1 s away from any appearance. Each frame
is the engine's own square of the virtual phone (replay.ts: viewport ->
960x1280 -> the centre 960), resized to 256 and fed BGR in [0,1]. Excluded:
`Jx6nwWUXoDM` (no appearances) and `BZ01r0LNqxs` (a phone game's screen, not
the camera). WuheDPVq_Bo is aimed at its card table, as replay.ts --aim does.

The videos are CC BY (cc-videos/license-check.txt). The refit weights are
derived from their frames, so `apps/web/public/scan-assets/SOURCES.md`
attributes them.

How good it is was judged on video-bench replays through the shipping capture
policy, with each video replayed under a head refit WITHOUT that video
(`export --exclude`, then `LC050_MODEL=<that> replay.ts <video>`). The
frame-level `report` is a quicker, rougher view of the same split.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DATA = Path.home() / "deckpal-data"
RAW = DATA / "cc-videos" / "raw"
GT = DATA / "video-bench" / "gt"
FEATS = DATA / "video-bench" / "presence-feats.npz"
MODEL = REPO / "apps" / "web" / "public" / "scan-assets" / "lc050.onnx"
FEAT = "/head/has_obj/has_obj.0/pool/pool.1/Flatten_output_0"
SKIP = {"Jx6nwWUXoDM", "BZ01r0LNqxs"}
AIM = {"WuheDPVq_Bo": (770, 270, 810)}  # x0, y0, side in source px (replay.ts --aim)
L2 = 1e-2


def _ffmpeg() -> str:
    return (DATA / "cc-videos" / "ffmpeg-path.txt").read_text().strip()


def _even(n: float) -> int:
    return max(0, int(n // 2) * 2)


def _size(file: Path) -> tuple[int, int]:
    r = subprocess.run([_ffmpeg(), "-hide_banner", "-i", str(file)], capture_output=True, text=True)
    m = re.search(r"Stream #\S+.*Video:.*?\b(\d{2,5})x(\d{2,5})\b", r.stderr)
    w, h = int(m.group(1)), int(m.group(2))
    rot = re.search(r"rotation of (-?[\d.]+) degrees", r.stderr) or re.search(r"rotate\s*:\s*(-?\d+)", r.stderr)
    if rot and abs(round(float(rot.group(1)))) % 180 == 90:
        w, h = h, w
    return w, h


def engine_square(vid: str) -> tuple[float, float, float]:
    """The engine's square in SOURCE px (phone.ts phoneGeometry): a 3:4 viewport
    scaled to 960x1280, and its centre 960 rows (160..1120)."""
    if vid in AIM:
        return AIM[vid]
    w0, h0 = _size(RAW / f"{vid}.mp4")
    if w0 / h0 > 3 / 4:
        h, w = _even(h0), _even(h0 * 3 / 4)
    else:
        w, h = _even(w0), min(_even(w0 * 4 / 3), _even(h0))
    x, y, k = _even((w0 - w) / 2), _even((h0 - h) / 2), w / 960
    return x, y + 160 * k, 960 * k


def square(vid: str, t: float, x0: float, y0: float, s: float):
    """That square of the source frame at `t`, padded grey where it leaves the frame."""
    from PIL import Image

    file = RAW / f"{vid}.mp4"
    w, h = _size(file)
    r = subprocess.run([_ffmpeg(), "-v", "error", "-ss", f"{t:.3f}", "-i", str(file), "-frames:v", "1", "-an", "-sn",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], capture_output=True)
    a = np.frombuffer(r.stdout, np.uint8)
    assert a.size == w * h * 3, (vid, t, a.size, r.stderr[-300:])
    im = Image.fromarray(a.reshape(h, w, 3))
    canvas = Image.new("RGB", (round(s), round(s)), (128, 128, 128))
    bx0, by0, bx1, by1 = max(0, round(x0)), max(0, round(y0)), min(w, round(x0 + s)), min(h, round(y0 + s))
    canvas.paste(im.crop((bx0, by0, bx1, by1)), (bx0 - round(x0), by0 - round(y0)))
    return canvas


def tensor(img) -> np.ndarray:
    from PIL import Image

    im = img.convert("RGB").resize((256, 256), Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255.0
    return np.ascontiguousarray(a[:, :, ::-1].transpose(2, 0, 1))[None]  # BGR planar, as preprocess.ts


def collect() -> None:
    import onnx
    import onnxruntime as ort

    m = onnx.load(str(MODEL))
    m.graph.output.append(onnx.helper.make_tensor_value_info(FEAT, onnx.TensorProto.FLOAT, None))
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    sess = ort.InferenceSession(m.SerializeToString(), sess_options=so, providers=["CPUExecutionProvider"])
    X, y, h, vids = [], [], [], []
    for gp in sorted(GT.glob("*.json")):
        vid = gp.stem
        if vid in SKIP:
            continue
        gt = json.loads(gp.read_text(encoding="utf8"))
        apps = gt["appearances"]
        x0, y0, s = engine_square(vid)
        pos = [round(a["start"] + q * (a["end"] - a["start"]), 3) for a in apps if a.get("capturable") for q in (0.25, 0.5, 0.75)]
        lo, hi = gt.get("window", [0, max(a["end"] for a in apps) + 5])
        neg = [t for t in np.arange(max(1.0, lo), hi - 1, 1.0)
               if all(not (a["start"] - 1.0 <= t <= a["end"] + 1.0) for a in apps)]
        for lab, ts in ((1, pos), (0, neg)):
            for t in ts:
                o = sess.run(None, {"img": tensor(square(vid, float(t), x0, y0, s))})
                X.append(np.ravel(o[-1]))
                h.append(float(np.ravel(o[1])[0]))
                y.append(lab)
                vids.append(vid)
        print(f"{vid}: {len(pos)} card frames, {len(neg)} no-card", flush=True)
    np.savez(FEATS, X=np.array(X), y=np.array(y), h=np.array(h), vid=np.array(vids))
    print(f"-> {FEATS}")


def fit(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, float, np.ndarray, np.ndarray]:
    """Balanced logistic regression on standardised features: (w, b, mu, sd)."""
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    sw = np.where(y == 1, (y == 0).sum() / max(1, (y == 1).sum()), 1.0)
    for _ in range(3000):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        g = (p - y) * sw
        w -= 0.5 * (Z.T @ g / len(y) + L2 * w)
        b -= 0.5 * g.mean()
    return w, b, mu, sd


def _load():
    d = np.load(FEATS, allow_pickle=True)
    return d["X"].astype(np.float64), d["y"].astype(np.float64), d["h"], d["vid"]


def report() -> None:
    X, y, h, vids = _load()
    print(f"frames {len(y)} ({int(y.sum())} card)  — share at or above the acquire threshold 0.8")
    print(f"{'video':13s} | shipped: card  no-card | refit, video held out: card  no-card")
    tot = np.zeros(4)
    for v in sorted(set(vids)):
        te = vids == v
        w, b, mu, sd = fit(X[~te], y[~te])
        p = 1 / (1 + np.exp(-(((X[te] - mu) / sd) @ w + b)))
        yt, ht = y[te], h[te]
        r = [((ht >= 0.8) & (yt == 1)).sum(), ((ht >= 0.8) & (yt == 0)).sum(), ((p >= 0.8) & (yt == 1)).sum(), ((p >= 0.8) & (yt == 0)).sum()]
        tot += r
        n1, n0 = max(1, (yt == 1).sum()), max(1, (yt == 0).sum())
        print(f"{v:13s} |  {r[0] / n1:6.1%} {r[1] / n0:6.1%}          |  {r[2] / n1:6.1%} {r[3] / n0:6.1%}")
    n1, n0 = (y == 1).sum(), (y == 0).sum()
    print(f"{'ALL':13s} |  {tot[0] / n1:6.1%} {tot[1] / n0:6.1%}          |  {tot[2] / n1:6.1%} {tot[3] / n0:6.1%}")


def export(dst: str, exclude: str) -> None:
    import onnx
    from onnx import numpy_helper

    X, y, _h, vids = _load()
    keep = vids != exclude
    w, b, mu, sd = fit(X[keep], y[keep])
    # logit = sum(w * (x - mu) / sd) + b = x @ (w / sd) + (b - sum(w * mu / sd))
    W, B = (w / sd).astype(np.float32), np.float32(b - np.sum(w * mu / sd))
    m = onnx.load(str(MODEL))
    init = {i.name: i for i in m.graph.initializer}
    wi, bi = init["head.has_obj.1.weight"], init["head.has_obj.1.bias"]
    wi.CopyFrom(numpy_helper.from_array(W.reshape(numpy_helper.to_array(wi).shape), wi.name))
    bi.CopyFrom(numpy_helper.from_array(np.array([B], np.float32).reshape(numpy_helper.to_array(bi).shape), bi.name))
    onnx.save(m, dst)
    p = 1 / (1 + np.exp(-(X[keep] @ W.astype(np.float64) + float(B))))
    yk = y[keep]
    print(f"fit on {int(keep.sum())} frames{f' (without {exclude})' if exclude else ''}: "
          f"card>=0.8 {np.mean(p[yk == 1] >= 0.8):.1%}, no-card>=0.8 {np.mean(p[yk == 0] >= 0.8):.1%} (in-sample)")
    print("sha256", hashlib.sha256(Path(dst).read_bytes()).hexdigest(), Path(dst).stat().st_size, "bytes")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("collect")
    sub.add_parser("report")
    e = sub.add_parser("export")
    e.add_argument("dst")
    e.add_argument("--exclude", default="", help="leave this video's frames out of the fit")
    a = ap.parse_args()
    if a.cmd != "collect" and not FEATS.exists():
        sys.exit(f"no features at {FEATS}: run `collect` first")
    if Path(getattr(a, "dst", "x")).resolve() == MODEL.resolve():
        # The source of the features IS the shipped model; refitting from a
        # model whose head was already refit would still work (the pooled
        # feature is upstream of the head), but say what is happening.
        print("note: writing over the shipped model in place")
    {"collect": collect, "report": report}.get(a.cmd, lambda: export(a.dst, a.exclude))()


if __name__ == "__main__":
    main()
