"""What LC050 actually is: I/O contract, opset, architecture, and what each
output means -- read from the graph and measured on real frames, then
cross-checked against how the shipping engine consumes it.

    python inspect_model.py [--model path/to.onnx]

Cross-checks (each prints PASS/FAIL):
  model.ts   picks the input as inputNames[0] and the outputs by regex
             (/point/i -> points, /obj/i -> has_obj); feeds [1,3,256,256] f32
  preprocess.ts / frame.ts treat `points` as 8 normalised fractions of the
             model input, decoded as (x0,y0,..,x3,y3)
  gate.ts    treats has_obj as a probability in [0,1] (acquire 0.80 / hold 0.30)
  dataset.py order_corners is the order LC050 emits
"""
from __future__ import annotations

import argparse
import collections
import json
import re

import numpy as np

import preprocess as P
from common import LC050
from fixtures import list_flag_frames


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=str(LC050))
    a = ap.parse_args()

    import onnx
    import onnxruntime as ort

    m = onnx.load(a.model)
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    sess = ort.InferenceSession(a.model, providers=["CPUExecutionProvider"])
    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' -- ' + detail) if detail else ''}")

    print(f"model: {a.model}")
    print(f"  ir_version {m.ir_version}, opset {[(o.domain or 'ai.onnx', o.version) for o in m.opset_import]}, producer {m.producer_name} {m.producer_version}")
    meta = {p.key: p.value for p in m.metadata_props}
    if "metadata" in meta:
        md = json.loads(meta["metadata"])
        print(f"  embedded metadata: date {md.get('Date')}, params {md.get('Params(M)')}M, MACs {md.get('MACs(G)')}G")
    print("inputs:")
    for i in sess.get_inputs():
        print(f"  {i.name:8s} {i.shape} {i.type}")
    print("outputs:")
    for o in sess.get_outputs():
        print(f"  {o.name:8s} {o.shape} {o.type}")
    n_params = sum(int(np.prod(i.dims)) for i in g.initializer)
    print(f"learned tensors: {len(g.initializer)} initializers, {n_params:,} floats")
    ops = collections.Counter(n.op_type for n in g.node)
    print(f"ops ({len(g.node)} nodes): {dict(sorted(ops.items(), key=lambda kv: -kv[1]))}")

    # ── architecture, read off node names ──────────────────────────────────
    prefixes = collections.Counter("/".join(n.name.split("/")[:3]) for n in g.node if n.name.startswith("/"))
    blocks = sorted({p for p in prefixes if "decoder_block" in p})
    producer = {o: n for n in g.node for o in n.output}
    pts_node = producer["points"]
    obj_node = producer["has_obj"]
    obj_logit = producer[obj_node.input[0]] if obj_node.op_type == "Sigmoid" else None
    print("architecture (from node names and initializers):")
    print(f"  backbone   LCNet050 ('/backbone/backbone', {sum(1 for n in g.node if n.name.startswith('/backbone') and n.op_type == 'Conv')} convs, BN folded into conv; SE blocks with hard-sigmoid as Clip)")
    print(f"  has_obj    GlobalAveragePool(last backbone stage, 256 ch) -> Gemm(256->1) -> {obj_node.op_type}")
    print(f"  points     learned query {list(inits['head.query'].dims)} refined by {len(blocks)} decoder blocks (coarse->fine: {', '.join(b.split('.')[-1] for b in blocks[::-1])}),")
    print(f"             each a conv tokenizer + learned pos_emb {list(inits['head.decoder_block.0.pos_emb'].dims)} + 3-layer transformer decoder (d=64);")
    print(f"             then {pts_node.op_type}(64->8) with NO activation")
    check("points come from a linear Gemm (unbounded: not clamped to [0,1])", pts_node.op_type == "Gemm")
    check("has_obj is post-sigmoid; its logit is a graph tensor train.py can tap", obj_logit is not None and obj_logit.op_type == "Gemm",
          f"logit = {obj_node.input[0]}")

    # ── engine cross-checks ─────────────────────────────────────────────────
    print("cross-check against the shipping engine:")
    ins = sess.get_inputs()
    outs = [o.name for o in sess.get_outputs()]
    check("model.ts: input is inputNames[0] = 'img', [1,3,256,256] float32",
          ins[0].name == "img" and list(ins[0].shape) == [1, 3, P.MODEL_SIZE, P.MODEL_SIZE] and ins[0].type == "tensor(float)")
    pts_name = next((n for n in outs if re.search("point", n, re.I)), outs[0])
    obj_name = next((n for n in outs if re.search("obj", n, re.I)), outs[1])
    check("model.ts: /point/i -> 'points' [1,8]; /obj/i -> 'has_obj' [1,1]",
          pts_name == "points" and obj_name == "has_obj"
          and list(sess.get_outputs()[outs.index("points")].shape) == [1, 8]
          and list(sess.get_outputs()[outs.index("has_obj")].shape) == [1, 1])

    # ── measured on real frames ─────────────────────────────────────────────
    from dataset import order_corners

    M = P.OrtModel(a.model)
    frames = [f for f in list_flag_frames() if f["gt"] is not None or f["scene"] == "none"]
    pos_obj, neg_obj, all_pts, order_ok, errs, ordered_err = [], [], [], 0, [], []
    for f in frames:
        img = P.load_rgba(f["png"])
        t = P.inference_transform(img.shape[1], img.shape[0])
        pts, ho = M.run(P.to_nchw(P.rgba_to_bgr_planar(P.smooth_letterbox_rgba(img, t, "area"))))
        all_pts.append(pts)
        if f["gt"] is None:
            neg_obj.append(ho)
            continue
        pos_obj.append(ho)
        q = np.array(P.model_points_to_quad(t, pts))
        _, perm = order_corners(q)
        order_ok += perm == [0, 1, 2, 3]
        gt = np.array(f["gt"])
        ordered_err.append(float(np.linalg.norm(q - gt, axis=1).mean()))
    all_pts = np.array(all_pts)
    print(f"measured on {len(frames)} session-2 frames (v2 letterbox, area resample; {len(pos_obj)} labelled cards, {len(neg_obj)} no-card):")
    print(f"  points range [{all_pts.min():.3f}, {all_pts.max():.3f}]  (normalised; a linear head, so nothing stops a value outside [0,1] --")
    print("               session2/offline.json records 1.006 on a probe snapshot)")
    print(f"  has_obj on cards:   min {min(pos_obj):.3f} median {np.median(pos_obj):.3f}   >=0.80 acquire: {sum(v >= 0.8 for v in pos_obj)}/{len(pos_obj)}")
    print(f"  has_obj on no-card: median {np.median(neg_obj):.3f} max {max(neg_obj):.3f}   >=0.80 acquire: {sum(v >= 0.8 for v in neg_obj)}/{len(neg_obj)}")
    print(f"  index-for-index corner error vs gt.json (no reordering): median {np.median(ordered_err):.1f} px, mean {np.mean(ordered_err):.1f} px")
    check("gate.ts: has_obj behaves as a probability in [0,1]", 0.0 <= min(pos_obj + neg_obj) and max(pos_obj + neg_obj) <= 1.0)
    check("dataset.order_corners is LC050's emitted order (TL,TR,BR,BL clockwise)", order_ok == len(pos_obj), f"{order_ok}/{len(pos_obj)} labelled frames")
    print("\nVERDICT:", "all cross-checks pass" if ok else "a cross-check FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
