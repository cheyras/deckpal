"""Parity: the Python preprocessing port against the shipping TypeScript.

    python parity_preprocess.py          # 19 labelled + 6 negative session-2 frames
    python parity_preprocess.py --all    # all 45 fixture frames

A mismatch here silently ruins training -- the model learns a mapping the
product never applies -- so this is the check that matters most. It writes a
job file, runs ts/dump_ts.mts under the worktree's tsx (the engine's OWN exports
plus the offline harness's sharp + ORT sidecar), and compares.

EXACT checks (must be bit-identical, exit 1 otherwise):
  geometry   computeLetterbox / inferenceTransform / modelPointsToQuad /
             modelNormToFrame / frameToModelNorm / modelPointsToCanonicalQuad /
             squareCrop / streamQuadToCanonical / canonicalToStream, over frame
             sizes and rects chosen to land on JS Math.round's .5 cases
  decode     cv2 vs sharp PNG decode of every frame, byte for byte
  letterbox  preprocess.letterbox_rgba vs letterboxRGBA (nearest reference)
  tensor     rgba_to_bgr_planar vs rgbaToBGRPlanar, float32 bit patterns,
             on the TS's own RGBA and on RGBA that Python resampled
  mapping    model_points_to_quad on the harness's model outputs vs the TS quads

MEASURED (reported, not gated -- the resampler cannot be ported, see
preprocess.py):
  pixels     OpenCV area/linear/cubic/lanczos vs the harness's sharp lanczos3
  corners    full Python pipeline vs full harness pipeline through LC050:
             corner distance in frame px, and has_obj delta
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import preprocess as P
from common import CACHE, LC050, REPO, TSX
from fixtures import list_flag_frames

GEOMETRY = [
    # (w, h, rect or None for inferenceTransform)
    (480, 640, None),
    (640, 480, None),
    (416, 416, None),
    (1080, 1920, None),
    (1920, 1080, None),
    (4032, 3024, None),
    (333, 517, None),
    (1, 1, None),
    (480, 640, {"x": 0.14, "y": 0.1, "w": 0.72, "h": 0.8}),
    (401, 333, {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}),  # 200.5 / 166.5: JS rounds up, Python's round() would not
    (403, 641, {"x": 0.1234, "y": 0.0567, "w": 0.7777, "h": 0.8888}),
    (480, 640, {"x": -0.1, "y": 0.9, "w": 0.5, "h": 0.5}),  # clamps
    (480, 640, {"x": 0.5, "y": 0.5, "w": 2.0, "h": 2.0}),
    (5, 3, {"x": 0.1, "y": 0.5, "w": 0.3, "h": 0.5}),  # 0.5 / 1.5 rounding
]
STREAMS = [(480, 640), (640, 480), (1080, 1920), (1921, 1080), (3024, 4032), (417, 416), (1, 7)]


def _points(n: int = 30) -> list[list[float]]:
    rng = np.random.default_rng(20261004)
    pts = rng.uniform(-0.2, 1.2, (n, 8)).tolist()
    pts.append([0, 0, 1, 0, 1, 1, 0, 1])
    pts.append([0.5] * 8)
    pts.append([1 / 3, 2 / 3, 0.1, 0.7, 0.123456789, 0.987654321, 1e-9, 1 - 1e-9])
    return pts


def run_ts(job: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    jp = out / "job.json"
    jp.write_text(json.dumps(job))
    if not TSX.exists():
        sys.exit(f"tsx not found at {TSX}: run `pnpm --config.verify-deps-before-run=false install` at the repo root")
    r = subprocess.run([str(TSX), "tools/quad-train/ts/dump_ts.mts", str(jp), str(out)], cwd=REPO, capture_output=True, text=True, shell=False)
    if r.returncode != 0:
        sys.exit(f"dump_ts.mts failed:\n{r.stdout}\n{r.stderr}")
    print(r.stdout.strip())


def rd(path: Path, dtype, shape=None) -> np.ndarray:
    a = np.fromfile(path, dtype=dtype)
    return a.reshape(shape) if shape else a


def maxdiff(a, b) -> float:
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    return float(np.max(np.abs(a - b))) if a.size else 0.0


def corner_dists(a, b) -> np.ndarray:
    return np.linalg.norm(np.asarray(a, float) - np.asarray(b, float), axis=1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="all 45 fixture frames (default: 19 labelled + 6 negatives)")
    ap.add_argument("--out", type=Path, default=CACHE / "parity" / "preprocess")
    a = ap.parse_args()

    frames = [f for f in list_flag_frames() if f["gt"] is not None or f["scene"] == "none"]
    if not a.all:
        frames = [f for f in frames if f["gt"] is not None] + [f for f in frames if f["gt"] is None][:6]

    # Python-resampled RGBA for the tensor-conversion check
    a.out.mkdir(parents=True, exist_ok=True)
    rgba_jobs = []
    for f in frames[:5]:
        img = P.load_rgba(f["png"])
        t = P.inference_transform(img.shape[1], img.shape[0])
        lb = P.smooth_letterbox_rgba(img, t, "area")
        fn = a.out / f"{f['name']}.py_area.rgba"
        lb.tofile(fn)
        rgba_jobs.append({"name": f"{f['name']}.py_area", "file": str(fn), "w": 256, "h": 256})

    points = _points()
    stream_quad = [[10.5, 20.25], [400.0, 15.0], [410.0, 600.0], [3.0, 590.5]]
    job = {
        "geometry": [{"w": w, "h": h, "rect": r} for w, h, r in GEOMETRY],
        "points": points,
        "streams": [{"w": w, "h": h, "quad": stream_quad} for w, h in STREAMS],
        "frames": [{"name": f["name"], "png": str(f["png"]), "w": f["width"], "h": f["height"]} for f in frames],
        "rgba": rgba_jobs,
        "runModel": True,
    }
    run_ts(job, a.out)
    geo = json.loads((a.out / "geometry.json").read_text())
    model = json.loads((a.out / "model.json").read_text())

    exact: dict[str, float] = {}
    fails: list[str] = []

    def gate(name: str, v: float) -> None:
        exact[name] = max(exact.get(name, 0.0), v)
        if v != 0.0:
            fails.append(f"{name}: {v}")

    # ── geometry ────────────────────────────────────────────────────────────
    assert geo["constants"]["MODEL_SIZE"] == P.MODEL_SIZE and geo["constants"]["PAD_VALUE"] == P.PAD_VALUE
    assert geo["constants"]["CANONICAL_SIZE"] == P.CANONICAL_SIZE and geo["constants"]["INFERENCE_RECT"] == P.INFERENCE_RECT
    for (w, h, rect), g in zip(GEOMETRY, geo["letterbox"]):
        t = P.compute_letterbox(w, h, rect) if rect else P.inference_transform(w, h)
        mine = t.to_ts()
        if mine != g["t"]:
            fails.append(f"letterbox {w}x{h} {rect}: py {mine} ts {g['t']}")
            exact["letterbox transform"] = float("inf")
        else:
            exact.setdefault("letterbox transform", 0.0)
        for p, m in zip(points, g["mapped"]):
            q = P.model_points_to_quad(t, p)
            gate("modelPointsToQuad", maxdiff(q, m["quad"]))
            gate("modelNormToFrame", maxdiff(P.model_norm_to_frame(t, p[0], p[1]), m["norm0"]))
            gate("frameToModelNorm", maxdiff([P.frame_to_model_norm(t, x, y) for x, y in q], m["back"]))
    for p, cq in zip(points, geo["canonical"]):
        gate("modelPointsToCanonicalQuad", maxdiff(P.model_points_to_canonical_quad(p), cq))
    for (w, h), s in zip(STREAMS, geo["squares"]):
        c = P.square_crop(w, h)
        if c != s["crop"]:
            fails.append(f"squareCrop {w}x{h}: py {c} ts {s['crop']}")
            exact["squareCrop"] = float("inf")
        else:
            exact.setdefault("squareCrop", 0.0)
        gate("streamQuadToCanonical", maxdiff(P.stream_quad_to_canonical(stream_quad, c), s["toCanonical"]))
        gate("canonicalToStream", maxdiff(P.canonical_quad_to_stream(stream_quad, c), s["toStream"]))
    # the JS-rounding trap, demonstrated rather than assumed
    trap = P.compute_letterbox(401, 333, {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5})
    assert (trap.crop_x, trap.crop_y) == (201, 167) and round(200.5) == 200, "JS Math.round trap not exercised"

    # ── pixels ──────────────────────────────────────────────────────────────
    resample = {m: [] for m in P.RESAMPLERS}
    resample_v3 = {m: [] for m in P.RESAMPLERS}
    per_frame = []
    ort_m = P.OrtModel(LC050)
    for f, me, mv in zip(frames, model["engine"], model["v3"]):
        n = f["name"]
        W, H = f["width"], f["height"]
        dec_ts = rd(a.out / f"{n}.decoded.rgba", np.uint8, (H, W, 4))
        img = P.load_rgba(f["png"])
        gate("decode (cv2 vs sharp), uint8", maxdiff(img, dec_ts))
        t = P.inference_transform(W, H)
        near_ts = rd(a.out / f"{n}.nearest.rgba", np.uint8, (256, 256, 4))
        near_py = P.letterbox_rgba(img, t)
        gate("letterboxRGBA (nearest), uint8", maxdiff(near_py, near_ts))
        gate("rgbaToBGRPlanar on nearest, float32", maxdiff(P.rgba_to_bgr_planar(near_py), rd(a.out / f"{n}.nearest.f32", np.float32)))
        eng_ts = rd(a.out / f"{n}.engine.rgba", np.uint8, (256, 256, 4))
        eng_f32 = rd(a.out / f"{n}.engine.f32", np.float32)
        py_f32 = P.rgba_to_bgr_planar(eng_ts)
        if not np.array_equal(py_f32.view(np.uint32), eng_f32.view(np.uint32)):
            fails.append(f"{n}: rgbaToBGRPlanar bit pattern differs")
        gate("rgbaToBGRPlanar on harness RGBA, float32", maxdiff(py_f32, eng_f32))
        for m in P.RESAMPLERS:
            d = np.abs(P.smooth_letterbox_rgba(img, t, m)[..., :3].astype(int) - eng_ts[..., :3].astype(int))
            resample[m].append((float(d.mean()), int(d.max())))
            c = P.square_crop(W, H)
            sq = img[c["y"] : c["y"] + c["size"], c["x"] : c["x"] + c["size"]]
            v3_py = P.resize_rgba(sq, 256, 256, m)
            v3_ts = rd(a.out / f"{n}.v3.rgba", np.uint8, (256, 256, 4))
            d3 = np.abs(v3_py[..., :3].astype(int) - v3_ts[..., :3].astype(int))
            resample_v3[m].append((float(d3.mean()), int(d3.max())))

        # ── model: identical tensor -> identical answer, then the resampler's effect
        x_ts = P.to_nchw(eng_f32)
        pts_py, ho_py = ort_m.run(x_ts)
        q_ts = me["quad"]
        gate("modelPointsToQuad on harness outputs", maxdiff(P.model_points_to_quad(t, me["points"]), q_ts))
        ort_pts = maxdiff(pts_py, me["points"])
        ort_ho = abs(ho_py - me["hasObj"])
        row = {"name": n, "gt": f["gt"] is not None, "ort_points_vs_sidecar": ort_pts, "ort_hasobj_vs_sidecar": ort_ho}
        for m in ("area", "lanczos"):
            xp = P.to_nchw(P.rgba_to_bgr_planar(P.smooth_letterbox_rgba(img, t, m)))
            pp, hp = ort_m.run(xp)
            qp = P.model_points_to_quad(t, pp)
            row[f"v2_{m}_corner_px_max"] = float(corner_dists(qp, q_ts).max())
            row[f"v2_{m}_hasobj_delta"] = abs(hp - me["hasObj"])
            c = P.square_crop(W, H)
            sq = img[c["y"] : c["y"] + c["size"], c["x"] : c["x"] + c["size"]]
            pv, hv = ort_m.run(P.model_input_from_square(sq, m))
            row[f"v3_{m}_corner_px_max"] = float(corner_dists(P.model_points_to_canonical_quad(pv), mv["quad"]).max())
            row[f"v3_{m}_hasobj_delta"] = abs(hv - mv["hasObj"])
        per_frame.append(row)

    # tensor conversion of Python-resampled RGBA, done by the TS
    for j in rgba_jobs:
        ts = rd(a.out / f"{j['name']}.f32", np.float32)
        py = P.rgba_to_bgr_planar(rd(Path(j["file"]), np.uint8, (256, 256, 4)))
        if not np.array_equal(py.view(np.uint32), ts.view(np.uint32)):
            fails.append(f"{j['name']}: rgbaToBGRPlanar bit pattern differs")
        gate("rgbaToBGRPlanar on Python RGBA, float32", maxdiff(py, ts))

    # v2 transform of a square frame IS the v3 resize
    t416 = P.inference_transform(416, 416)
    v2v3 = max(maxdiff(P.model_points_to_quad(t416, p), P.model_points_to_canonical_quad(p)) for p in points)

    def summ(key):
        # Corner positions only mean something on a labelled card; on an empty
        # frame the corners are unconstrained and the engine never reads them.
        rows = [r for r in per_frame if r["gt"]] if "corner" in key else per_frame
        v = np.array([r[key] for r in rows])
        return {"n": len(rows), "mean": float(v.mean()), "median": float(np.median(v)), "max": float(v.max())}

    report = {
        "frames": len(frames),
        "exact": exact,
        "exact_failures": fails,
        "v2_square_equals_v3_resize_maxdiff_px": v2v3,
        "ort_python_vs_harness_sidecar": {"points_max": max(r["ort_points_vs_sidecar"] for r in per_frame), "hasobj_max": max(r["ort_hasobj_vs_sidecar"] for r in per_frame)},
        "resampler_vs_sharp_lanczos3_uint8": {
            "v2_letterbox": {m: {"mean": float(np.mean([x[0] for x in v])), "max": int(max(x[1] for x in v))} for m, v in resample.items()},
            "v3_square": {m: {"mean": float(np.mean([x[0] for x in v])), "max": int(max(x[1] for x in v))} for m, v in resample_v3.items()},
        },
        "resampler_effect_through_lc050": {k: summ(k) for k in per_frame[0] if k.startswith(("v2_", "v3_"))},
        "per_frame": per_frame,
    }
    (a.out / "report.json").write_text(json.dumps(report, indent=1))

    print(f"\nPREPROCESS PARITY over {len(frames)} session-2 frames ({sum(f['gt'] is not None for f in frames)} labelled)")
    print("exact checks (max abs diff, must be 0):")
    for k, v in exact.items():
        print(f"  {k:45s} {v}")
    print(f"  v2 transform on a 416 square vs v3 resize     {v2v3:.3g} px (float rounding only)")
    o = report["ort_python_vs_harness_sidecar"]
    print(f"python ORT vs harness sidecar on identical tensors: points {o['points_max']:.3g}, has_obj {o['hasobj_max']:.3g}")
    print("resampler vs harness sharp lanczos3 (uint8 mean / max):")
    for k, d in report["resampler_vs_sharp_lanczos3_uint8"].items():
        print("  " + k + ": " + ", ".join(f"{m} {s['mean']:.2f}/{s['max']}" for m, s in d.items()))
    print("resampler effect through LC050 vs harness (worst corner px per labelled frame; has_obj delta, all frames):")
    for k, s in report["resampler_effect_through_lc050"].items():
        print(f"  {k:28s} n={s['n']:2d}  median {s['median']:.3f}  mean {s['mean']:.3f}  max {s['max']:.3f}")
    if fails:
        print("\nFAIL:\n  " + "\n  ".join(fails[:20]))
        return 1
    print("\nPASS: every deterministic stage is bit-identical to the TypeScript.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
