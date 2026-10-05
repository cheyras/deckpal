"""Export a fine-tuned checkpoint to an ONNX file model.ts loads UNCHANGED.

    python export.py --checkpoint runs/r1/best.pt --out cache/export/r1.onnx
    python export.py --pristine --out cache/export/pristine.onnx   # the untouched LC050, round-tripped

THE CONTRACT (what model.ts / preprocess.ts / gate.ts depend on), checked
against apps/web/public/scan-assets/lc050.onnx, exit 1 on any mismatch:
  input   'img'      float32 [1,3,256,256]
  outputs 'points'   float32 [1,8]   (model.ts finds it by /point/i)
          'has_obj'  float32 [1,1]   (by /obj/i), still post-sigmoid
  opset ai.onnx 16, IR version 8 -- the same as the shipped file
  op types: a SUBSET of the shipped file's, so nothing the wasm-only ORT
            bundle has not already executed on the owner's phone

HOW. torch.onnx.export (TorchScript exporter, opset 16) of the converted graph
at batch 1, then onnxscript's optimizer folds the constant shape arithmetic
back out (make_batchable's Shape/Slice/Concat and -1 reshapes are constants
again at a fixed input size, and the 535 Identity/Cast/Split nodes the
exporter emits fold away), then the I/O shapes are re-pinned to the shipped
file's exactly (the exporter names the batch dim of `points` symbolically).

THREE CHECKS:
  1. parity      torch fp32 vs the exported ONNX under onnxruntime, per output,
                 on every session-2 input (target < 1e-4)
  2. contract    names / shapes / dtypes / opset / IR / op-type subset
  3. shipping    ts/contract_ts.mts runs the exported file through the engine's
                 OWN TypeScript preprocessing, mapping, presence gate and shape
                 checks on session 2, next to the shipped lc050.onnx, and every
                 drawn quad must be finite and convex
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")

import torch  # noqa: E402

import preprocess as P  # noqa: E402
from common import CACHE, LC050 as LC050_ONNX, REPO, TSX  # noqa: E402
from convert import ExportView, build_model, load_checkpoint, parity_inputs  # noqa: E402
from fixtures import list_flag_frames  # noqa: E402


def io_signature(model) -> dict:
    def sig(vs):
        return {v.name: (v.type.tensor_type.elem_type, [d.dim_value if d.HasField("dim_value") else d.dim_param for d in v.type.tensor_type.shape.dim]) for v in vs}

    return {"inputs": sig(model.graph.input), "outputs": sig(model.graph.output)}


def export_onnx(model, out: Path, ref_path=LC050_ONNX, provenance: dict | None = None) -> Path:
    import onnx
    import onnxscript.optimizer

    ref = onnx.load(str(ref_path))
    opset = next(o.version for o in ref.opset_import if o.domain in ("", "ai.onnx"))
    out.parent.mkdir(parents=True, exist_ok=True)
    raw = out.with_name(out.stem + ".raw.onnx")
    view = ExportView(model.cpu().eval())
    torch.onnx.export(view, (torch.zeros(1, 3, P.MODEL_SIZE, P.MODEL_SIZE),), str(raw), input_names=["img"], output_names=["points", "has_obj"],
                      opset_version=opset, dynamo=False, do_constant_folding=True)
    m = onnxscript.optimizer.optimize(onnx.load(str(raw)))
    raw.unlink()
    # re-pin the I/O to the shipped file's exact shapes
    ref_sig = io_signature(ref)
    for v in list(m.graph.input) + list(m.graph.output):
        kind = "inputs" if v in m.graph.input else "outputs"
        _, dims = ref_sig[kind][v.name]
        for d, val in zip(v.type.tensor_type.shape.dim, dims):
            d.Clear()
            d.dim_value = val
    m.ir_version = ref.ir_version
    meta = {p.key: p.value for p in m.metadata_props}
    meta["quad-train"] = json.dumps({"exported": time.strftime("%Y-%m-%d %H:%M:%S"), "source_sha256": model.source_sha256, **(provenance or {})}, default=str)
    del m.metadata_props[:]
    for k, v in meta.items():
        m.metadata_props.add(key=k, value=v)
    onnx.checker.check_model(m, full_check=True)
    onnx.save(m, str(out))
    return out


def contract(exported: Path, ref_path=LC050_ONNX) -> list[str]:
    import onnx
    import onnxruntime as ort

    ref, got = onnx.load(str(ref_path)), onnx.load(str(exported))
    problems = []
    if io_signature(ref) != io_signature(got):
        problems.append(f"I/O signature differs: {io_signature(got)} vs {io_signature(ref)}")
    if [(o.domain or "", o.version) for o in ref.opset_import] != [(o.domain or "", o.version) for o in got.opset_import]:
        problems.append(f"opset differs: {list(got.opset_import)} vs {list(ref.opset_import)}")
    if ref.ir_version != got.ir_version:
        problems.append(f"IR version {got.ir_version} vs {ref.ir_version}")
    new_ops = {n.op_type for n in got.graph.node} - {n.op_type for n in ref.graph.node}
    if new_ops:
        problems.append(f"op types not in the shipped model: {sorted(new_ops)}")
    s = ort.InferenceSession(str(exported), providers=["CPUExecutionProvider"])
    if [(i.name, i.shape, i.type) for i in s.get_inputs()] != [("img", [1, 3, 256, 256], "tensor(float)")]:
        problems.append(f"ORT sees inputs {[(i.name, i.shape, i.type) for i in s.get_inputs()]}")
    if [(o.name, o.shape, o.type) for o in s.get_outputs()] != [("points", [1, 8], "tensor(float)"), ("has_obj", [1, 1], "tensor(float)")]:
        problems.append(f"ORT sees outputs {[(o.name, o.shape, o.type) for o in s.get_outputs()]}")
    return problems


def parity(model, exported: Path, xs) -> dict:
    ref = P.OrtModel(exported)
    shipped = P.OrtModel(LC050_ONNX)
    model = model.cpu().eval()
    w = {"points": 0.0, "has_obj": 0.0, "vs_shipped_points": 0.0, "vs_shipped_has_obj": 0.0}
    with torch.no_grad():
        for _, x in xs:
            r = ref.run_raw(x)
            p, o, _ = model(torch.from_numpy(x))
            w["points"] = max(w["points"], float(np.abs(p.numpy() - r["points"]).max()))
            w["has_obj"] = max(w["has_obj"], float(np.abs(o.numpy() - r["has_obj"]).max()))
            s = shipped.run_raw(x)
            w["vs_shipped_points"] = max(w["vs_shipped_points"], float(np.abs(s["points"] - r["points"]).max()))
            w["vs_shipped_has_obj"] = max(w["vs_shipped_has_obj"], float(np.abs(s["has_obj"] - r["has_obj"]).max()))
    return w


def shipping_contract(exported: Path, out_dir: Path) -> dict:
    """Run exported and shipped models through ts/contract_ts.mts; compare."""
    frames = [f for f in list_flag_frames() if f["gt"] is not None or f["scene"] == "none"]
    job = out_dir / "contract_job.json"
    job.write_text(json.dumps({"frames": [{"name": f["name"], "png": str(f["png"]), "w": f["width"], "h": f["height"]} for f in frames]}))
    res = {}
    for tag, path in (("exported", exported), ("shipped", LC050_ONNX)):
        o = out_dir / f"contract_{tag}.json"
        r = subprocess.run([str(TSX), "tools/quad-train/ts/contract_ts.mts", str(Path(path).resolve()), str(job), str(o)], cwd=REPO, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"contract_ts.mts failed:\n{r.stdout}\n{r.stderr}")
        res[tag] = {d["name"]: d for d in json.loads(o.read_text())}
    gt = {f["name"]: f for f in frames}
    summary = {}
    for tag in res:
        cards = [n for n in res[tag] if gt[n]["gt"] is not None]
        negs = [n for n in res[tag] if gt[n]["gt"] is None]
        s = {}
        for pipe in ("v2", "v3"):
            errs = []
            for n in cards:
                q = res[tag][n][pipe]["quad"]
                g = np.array(gt[n]["gt"], float)
                if pipe == "v3":
                    g = np.array(P.stream_quad_to_canonical(g, res[tag][n]["canonicalCrop"]))
                errs.append(float(np.linalg.norm(np.array(q) - g, axis=1).mean()) if q else float("inf"))
            d = [res[tag][n][pipe] for n in cards]
            dn = [res[tag][n][pipe] for n in negs]
            s[pipe] = {
                "finite": sum(x["finite"] for x in d + dn),
                "frames": len(d) + len(dn),
                "cards_gate_open": sum(x["gateOpen"] for x in d),
                "cards_convex": sum(x["convex"] for x in d),
                "cards_card_shaped": sum(x["cardShaped"] and x["singleCard"] for x in d),
                "negatives_gate_open": sum(x["gateOpen"] for x in dn),
                "corner_px_median": float(np.median(errs)),
                "corner_px_mean": float(np.mean(errs)),
                "n_cards": len(d),
                "n_neg": len(dn),
                "drawn_nonconvex": sum(1 for x in d + dn if x["gateOpen"] and not x["convex"]),
            }
        summary[tag] = s
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--checkpoint", type=Path)
    g.add_argument("--pristine", action="store_true", help="export the converted, untrained LC050 (proves the exporter)")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()

    if a.pristine:
        model, prov = build_model(), {"checkpoint": None, "note": "pristine LC050 round-trip"}
        out = a.out or CACHE / "export" / "pristine.onnx"
    else:
        model, ck = load_checkpoint(a.checkpoint)
        prov = {"checkpoint": str(a.checkpoint), "epoch": ck.get("epoch"), "step": ck.get("step"), "metrics": ck.get("metrics")}
        out = a.out or CACHE / "export" / (a.checkpoint.parent.name + ".onnx")
    export_onnx(model, out, provenance=prov)
    import onnx

    m = onnx.load(str(out))
    print(f"exported {out} ({out.stat().st_size:,} bytes, {len(m.graph.node)} nodes; shipped lc050.onnx is {LC050_ONNX.stat().st_size:,} bytes)")
    ok = True

    problems = contract(out)
    print("contract vs lc050.onnx: " + ("PASS (names, shapes, dtypes, opset 16, IR 8, op types a subset)" if not problems else "FAIL"))
    for p in problems:
        print(f"  - {p}")
    ok &= not problems

    xs = parity_inputs()
    w = parity(model, out, xs)
    pp = max(w["points"], w["has_obj"]) < 1e-4
    print(f"export parity, torch fp32 vs exported ONNX on {len(xs)} inputs: max|d| points {w['points']:.3g}, has_obj {w['has_obj']:.3g}  {'PASS' if pp else 'FAIL'}")
    print(f"  (exported vs shipped lc050.onnx: points {w['vs_shipped_points']:.3g}, has_obj {w['vs_shipped_has_obj']:.3g} -- ~0 for --pristine, the fine-tune's effect otherwise)")
    ok &= pp

    s = shipping_contract(out, out.parent)
    print("shipping contract (engine TypeScript preprocessing + mapping + gate, session 2):")
    for tag, d in s.items():
        for pipe, r in d.items():
            print(f"  {tag:8s} {pipe}: finite {r['finite']}/{r['frames']}  cards: gate-open {r['cards_gate_open']}/{r['n_cards']} convex {r['cards_convex']}/{r['n_cards']} "
                  f"card-shaped {r['cards_card_shaped']}/{r['n_cards']}  corner px median {r['corner_px_median']:.2f} mean {r['corner_px_mean']:.2f}  "
                  f"negatives gate-open {r['negatives_gate_open']}/{r['n_neg']}  drawn non-convex {r['drawn_nonconvex']}")
    sane = all(r["finite"] == r["frames"] and r["drawn_nonconvex"] == 0 for r in s["exported"].values())
    print("  sane quads from the exported model (all finite, none drawn non-convex): " + ("PASS" if sane else "FAIL"))
    ok &= sane
    (out.parent / f"{out.stem}.report.json").write_text(json.dumps({"contract": problems, "parity": w, "shipping": s}, indent=1))
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
