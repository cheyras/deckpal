"""A second presence head for LC050, fitted on labelled video and phone frames.

    PY=~/deckpal-data/venvs/scanid/Scripts/python.exe
    $PY scripts/scan-bench/video/presence_head.py collect          # video frames' features (~25 min, cached)
    node --import tsx scripts/scan-bench/video/phone_frames.ts      # phone frames, as the engine preprocesses them
    $PY scripts/scan-bench/video/presence_head.py collect-phone    # their features
    $PY scripts/scan-bench/video/presence_head.py report           # shipped vs refit vs max(both), held out
    $PY scripts/scan-bench/video/presence_head.py export <dst.onnx> [--exclude <videoId>]

WHY. On the pack-opening videos the shipped head put only 31% of frames that
show a card over the gate's acquire threshold (0.8). Busy backgrounds out-vote
it, and the tracker never sees a quad the gate kept shut. The corner head's
quads were mostly fine.

WHY NOT JUST REPLACE IT. The first attempt refit the head on video frames
alone. It lost the case the scanner was built for: a sleeved card lying on a
wooden table, filmed by the owner's phone (phase 0b F028/F030/F032), fell from
hasObj ~1.0 to 0.07-0.19 (Astra's review of #317). Fitted on video and phone
frames together, one linear head still could not hold both: phone card frames
over 0.8 dropped from 98% to 92%. So the shipped head is KEPT, and a second
head is added beside it, reading the same 256-d pooled feature:

    has_obj = max(sigmoid(shipped Gemm), sigmoid(refit Gemm))

A frame the shipped head saw as a card stays one. A busy-background frame it
missed gets a second chance from a head trained on exactly those frames.

WHAT CHANGES IN THE MODEL. `export` keeps every original node and initializer
byte for byte. It renames the original Sigmoid's output and adds four things:
`head.has_obj_refit.weight` and `.bias`, a Gemm, a Sigmoid and a Max that
writes `has_obj`. The backbone and the corner head are untouched, so no quad
changes; only hasObj can, and only upwards. Run on an exported model, `export`
strips the previous refit first, so heads never stack.

THE REFIT. A class-balanced logistic regression (L2 0.01) on the pooled
features of:
- VIDEO frames. For every capturable ground-truth appearance (video-bench/gt),
  the frames at 25/50/75% of it are cards. One frame a second, inside the
  labelled window and at least 1 s from any appearance, is no-card. Each frame
  is the engine's square of the virtual phone (replay.ts: viewport ->
  960x1280 -> the centre 960), resized to 256 and fed BGR in [0,1]. Excluded:
  `Jx6nwWUXoDM` (no appearances) and `BZ01r0LNqxs` (a phone game's screen).
  WuheDPVq_Bo is aimed at its card table, as replay.ts --aim does.
- PHONE frames (phone_frames.ts). Phase 0b session 2's flagged frames and
  snapshots, labelled by triage.json's scene, and every lock and capture frame
  of the owner's three scanning sessions, all cards.

The videos are CC BY (cc-videos/license-check.txt). The refit weights are
derived from their frames, so `apps/web/public/scan-assets/SOURCES.md`
attributes them. The phone frames are the owner's and stay outside git.

How good it is was judged on video-bench replays through the shipping capture
policy, each video replayed under a model whose refit never saw that video
(`export --exclude`, then `LC050_MODEL=<that> replay.ts <video>`), and on the
phone frames, each group held out of its own refit (`report`).
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
PHONE_FEATS = DATA / "video-bench" / "phone-feats.npz"
PHONE_GROUPS = ("s2-flag", "s2-snap", "owner-1", "owner-2", "owner-3")
REFIT = "head.has_obj_refit"
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


def base_model():
    """MODEL with any refit head stripped: the original LC050 graph, whose
    `has_obj` output is the shipped head alone."""
    import onnx

    m = onnx.load(str(MODEL))
    g = m.graph
    if any(i.name.startswith(REFIT) for i in g.initializer):
        added = [n for n in g.node if n.name.startswith("/head/has_obj_refit/")]
        for n in added:
            g.node.remove(n)
        for i in [i for i in g.initializer if i.name.startswith(REFIT)]:
            g.initializer.remove(i)
        for n in g.node:  # the original Sigmoid writes has_obj again
            if n.name == "/Sigmoid":
                n.output[0] = "has_obj"
    return m


def _session():
    """The base model with the pooled feature as an extra output. Index 1 is
    the shipped head's has_obj."""
    import onnx
    import onnxruntime as ort

    m = base_model()
    m.graph.output.append(onnx.helper.make_tensor_value_info(FEAT, onnx.TensorProto.FLOAT, None))
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    return ort.InferenceSession(m.SerializeToString(), sess_options=so, providers=["CPUExecutionProvider"])


def collect_phone() -> None:
    """phone_frames.ts's tensors -> pooled features, shipped hasObj, label, group."""
    idx = json.loads((DATA / "video-bench" / "phone-index.json").read_text(encoding="utf8"))
    T = np.fromfile(DATA / "video-bench" / "phone-tensors.bin", np.float32).reshape(len(idx), 3, 256, 256)
    sess = _session()
    X, h = [], []
    for i in range(len(idx)):  # one at a time: the model's batch dimension is fixed at 1
        o = sess.run(None, {"img": T[i : i + 1]})
        X.append(np.ravel(o[-1]))
        h.append(float(np.ravel(o[1])[0]))
    np.savez(PHONE_FEATS, X=np.array(X), h=np.array(h), y=np.array([r["label"] for r in idx]),
             group=np.array([r["group"] for r in idx]), name=np.array([r["name"] for r in idx]))
    print(f"{len(idx)} phone frames -> {PHONE_FEATS}")


def collect() -> None:
    sess = _session()
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


def fit(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, float]:
    """Balanced logistic regression on standardised features, returned with the
    standardisation folded in: logit = X @ W + B."""
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    sw = np.where(y == 1, (y == 0).sum() / max(1, (y == 1).sum()), 1.0)
    for _ in range(3000):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        g = (p - y) * sw
        w -= 0.5 * (Z.T @ g / len(y) + L2 * w)
        b -= 0.5 * g.mean()
    # logit = sum(w * (x - mu) / sd) + b = x @ (w / sd) + (b - sum(w * mu / sd))
    return w / sd, float(b - np.sum(w * mu / sd))


def _sig(z: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-z))


def _load():
    """Video and phone frames together: X, y, shipped hasObj, group (videoId or phone group)."""
    v = np.load(FEATS, allow_pickle=True)
    X, y, h, g = [v["X"].astype(np.float64)], [v["y"].astype(np.float64)], [v["h"]], [v["vid"]]
    if PHONE_FEATS.exists():
        p = np.load(PHONE_FEATS, allow_pickle=True)
        X.append(p["X"].astype(np.float64)); y.append(p["y"].astype(np.float64)); h.append(p["h"]); g.append(p["group"])
    else:
        print(f"note: no phone frames ({PHONE_FEATS}); fitting on video alone")
    return np.concatenate(X), np.concatenate(y), np.concatenate(h), np.concatenate(g)


def report() -> None:
    X, y, h, grp = _load()
    out = np.zeros(len(y))
    for G in sorted(set(grp)):  # every video and every phone group held out of its own fit
        te = grp == G
        W, B = fit(X[~te], y[~te])
        out[te] = _sig(X[te] @ W + B)
    both = np.maximum(h, out)

    def row(name: str, m: np.ndarray) -> str:
        c, n = m & (y == 1), m & (y == 0)
        cell = lambda p: f"{np.mean(p[c] >= 0.8):5.1%} {np.mean(p[n] >= 0.8) if n.any() else float('nan'):5.1%}"
        return f"{name:13s} | {cell(h)} | {cell(out)} | {cell(both)}"

    print("share at or above the acquire threshold 0.8: card / no-card frames, each group held out")
    print(f"{'group':13s} | shipped      | refit        | max(both)")
    for G in sorted(set(grp)):
        print(row(G, grp == G))
    is_phone = np.isin(grp, PHONE_GROUPS)
    print(row("ALL VIDEO", ~is_phone))
    print(row("ALL PHONE", is_phone))


def export(dst: str, exclude: str) -> None:
    import onnx
    from onnx import helper, numpy_helper

    X, y, _h, grp = _load()
    keep = grp != exclude
    W, B = fit(X[keep], y[keep])
    m = base_model()
    g = m.graph
    # The original Sigmoid now writes an intermediate; a second Gemm + Sigmoid
    # read the same pooled feature, and Max(original, refit) writes has_obj.
    for n in g.node:
        if n.name == "/Sigmoid":
            n.output[0] = "/head/has_obj_refit/shipped"
    g.initializer.extend([
        numpy_helper.from_array(W.astype(np.float32).reshape(1, -1), f"{REFIT}.weight"),
        numpy_helper.from_array(np.array([B], np.float32), f"{REFIT}.bias"),
    ])
    g.node.extend([
        helper.make_node("Gemm", [FEAT, f"{REFIT}.weight", f"{REFIT}.bias"], ["/head/has_obj_refit/logit"],
                         name="/head/has_obj_refit/Gemm", alpha=1.0, beta=1.0, transB=1),
        helper.make_node("Sigmoid", ["/head/has_obj_refit/logit"], ["/head/has_obj_refit/prob"], name="/head/has_obj_refit/Sigmoid"),
        helper.make_node("Max", ["/head/has_obj_refit/shipped", "/head/has_obj_refit/prob"], ["has_obj"], name="/head/has_obj_refit/Max"),
    ])
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    p = _sig(X[keep] @ W + B)
    yk = y[keep]
    print(f"refit on {int(keep.sum())} frames{f' (without {exclude})' if exclude else ''}: "
          f"card>=0.8 {np.mean(p[yk == 1] >= 0.8):.1%}, no-card>=0.8 {np.mean(p[yk == 0] >= 0.8):.1%} (in-sample, refit alone)")
    print("sha256", hashlib.sha256(Path(dst).read_bytes()).hexdigest(), Path(dst).stat().st_size, "bytes")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("collect")
    sub.add_parser("collect-phone")
    sub.add_parser("report")
    e = sub.add_parser("export")
    e.add_argument("dst")
    e.add_argument("--exclude", default="", help="leave this video's (or phone group's) frames out of the refit")
    a = ap.parse_args()
    if a.cmd in ("report", "export") and not FEATS.exists():
        sys.exit(f"no features at {FEATS}: run `collect` first")
    if a.cmd == "collect":
        collect()
    elif a.cmd == "collect-phone":
        collect_phone()
    elif a.cmd == "report":
        report()
    else:
        export(a.dst, a.exclude)


if __name__ == "__main__":
    main()
