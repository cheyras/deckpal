"""lc050.onnx -> a TRAINABLE PyTorch module, and proof it is the same function.

    python convert.py            # parity on session 2 (+ random tensors), CPU and CUDA
    python convert.py --grad     # also: which parameters receive gradient

HOW. onnx2torch turns the ONNX graph into a torch.fx GraphModule node for
node. That alone is NOT trainable as LC050 was trained, and three things are
fixed up here:

  1. Only Conv and Gemm weights come out as nn.Parameters (445,561 floats).
     Every other learned tensor -- the transformer decoders' MatMul weights and
     biases, all LayerNorm scales/shifts (LayerNorm is decomposed into
     ReduceMean/Sub/Pow/Sqrt/Div/Mul/Add in this export), the learned query
     and the positional embeddings -- arrives as a frozen BUFFER, i.e. about
     60% of the model would silently never update. promote_initializers()
     turns every float graph initializer into a Parameter. (Every float
     Constant node in this graph is a scalar -- eps, 2.0 for Pow, the attention
     scale, hard-sigmoid's 3/6 -- and those stay constants.)
  2. The export de-duplicated 6 initializers whose values happened to be equal
     (decoder_block.4's norm2 and out-proj biases, one 64x64 weight shared by
     three layers: nn.TransformerDecoder deep-copies one layer, and those
     tensors had never moved from their shared init). onnx2torch already
     gives every consumer its own buffer, so after promotion they are
     independent parameters again, as they were upstream.
  3. has_obj is post-sigmoid. For BCE-with-logits (and AMP safety) the module
     also returns the sigmoid's input, tapped from the fx graph, so training
     never takes log() of a saturated probability.
  4. BATCH 1 IS BAKED IN. The 2023 export traced nn.MultiheadAttention with
     N=1 and froze it into constants: 150 attention Reshapes ([L, N*heads, 16],
     [L*N, 64], [L, N, 64] with N=1) and 6 Expands (the learned query and the
     five pos_embs, expand(-1, N, -1) with N=1). make_batchable() rewrites
     exactly those (-1 for the N-carrying dim; the Expand target built from
     Shape(img)), and refuses to run if any of them is not the pattern it
     expects. Same function at batch 1, a real batch dimension for training,
     and plain torch.autocast works (it does NOT under torch.func.vmap, which
     was the first approach: conv bias dtype mismatch). The parity below
     checks batch 1 against the original ONNX and a batch against per-sample.

BatchNorm is folded into the convs and there is no dropout in the export, so
train() and eval() compute the same function -- fine-tuning runs without BN,
which is usually a feature at this data size (no batch-statistics drift).
"""
from __future__ import annotations

import argparse
import hashlib
import warnings
from pathlib import Path
from typing import Optional

import numpy as np

from common import LC050 as LC050_ONNX

warnings.filterwarnings("ignore", message=".*non-tuple sequence for multidimensional indexing.*")

import torch  # noqa: E402
from torch import fx, nn  # noqa: E402


def sha256(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _origin_of(gm: fx.GraphModule, node: fx.Node) -> str:
    """The first named (non-Identity) module consuming a get_attr node -> its ONNX path."""
    frontier = list(node.users)
    while frontier:
        u = frontier.pop(0)
        if u.op == "call_module" and not u.target.startswith("Identity_"):
            return u.target
        frontier.extend(u.users)
    return "?"


def group_of(origin: str) -> str:
    """backbone | presence (has_obj head) | decoder (query, decoders, point_reg)."""
    if origin.startswith("backbone"):
        return "backbone"
    if origin.startswith("head/has_obj"):
        return "presence"
    return "decoder"


def promote_initializers(gm: fx.GraphModule) -> dict[str, str]:
    """Turn every floating-point graph initializer buffer into an nn.Parameter.
    Returns {parameter name: consuming ONNX module path}."""
    origins: dict[str, str] = {}
    container = gm.get_submodule("initializers")
    for node in gm.graph.nodes:
        if node.op != "get_attr" or not node.target.startswith("initializers."):
            continue
        short = node.target.split(".", 1)[1]
        buf = container._buffers.get(short)
        if buf is None or not torch.is_floating_point(buf):
            continue
        del container._buffers[short]
        container.register_parameter(short, nn.Parameter(buf.detach().clone()))
        origins[node.target] = _origin_of(gm, node)
    return origins


def tap_presence_logit(gm: fx.GraphModule) -> None:
    """Make the graph return (points, has_obj, has_obj_logit)."""
    out = next(n for n in gm.graph.nodes if n.op == "output")
    points, has_obj = out.args[0][:2]
    assert has_obj.op == "call_module" and isinstance(gm.get_submodule(has_obj.target), nn.Sigmoid), "has_obj is not a Sigmoid output"
    out.args = ((points, has_obj, has_obj.args[0]),)
    gm.graph.lint()
    gm.recompile()


def make_batchable(model):
    """Point 4: free the batch dimension the export froze at 1. Returns a new ModelProto."""
    import collections

    import onnx
    from onnx import helper, numpy_helper

    m = onnx.ModelProto()
    m.CopyFrom(model)
    g = m.graph
    consts = {n.output[0]: n for n in g.node if n.op_type == "Constant"}
    producer = {o: n for n in g.node for o in n.output}
    added, changed = [], collections.Counter()

    def const(name, values):
        added.append(helper.make_node("Constant", [], [name], value=numpy_helper.from_array(np.array(values, np.int64))))
        return name

    for n in g.node:
        if n.op_type != "Reshape" or not ("/self_attn/" in n.name or "/multihead_attn/" in n.name):
            continue
        c = consts.get(n.input[1])
        if c is None:
            raise RuntimeError(f"{n.name}: attention Reshape with a non-constant shape -- not the 2023 export")
        s = [int(v) for v in numpy_helper.to_array(c.attribute[0].t)]
        if len(s) == 3 and s[1] == 4 and s[2] == 16:  # [L, N*heads, head_dim], N=1
            new = [s[0], -1, 16]
        elif s == [1, 64]:  # [L*N, E], L=N=1
            new = [-1, 64]
        elif s == [1, 1, 64]:  # [L, N, E], L=N=1
            new = [1, -1, 64]
        else:
            raise RuntimeError(f"{n.name}: unexpected attention Reshape {s}")
        n.input[1] = const(f"{n.input[1]}__batchable", new)
        changed["attention Reshape"] += 1

    img = g.input[0].name
    added += [
        helper.make_node("Shape", [img], ["__qt_img_shape"]),
        helper.make_node("Slice", ["__qt_img_shape", const("__qt_zero", [0]), const("__qt_one", [1])], ["__qt_N"]),
        helper.make_node("Concat", ["__qt_one", "__qt_N", "__qt_one"], ["__qt_1N1"], axis=0),
    ]
    for n in g.node:
        if n.op_type != "Expand":
            continue
        w = producer.get(n.input[1])
        k = numpy_helper.to_array(consts[w.input[2]].attribute[0].t).tolist() if w is not None and w.op_type == "Where" else None
        if k != [-1, 1, -1]:
            raise RuntimeError(f"{n.name}: unexpected Expand target {k}")
        n.input[1] = "__qt_1N1"  # expand(-1, N, -1) == broadcast to [1, N, 1]
        changed["Expand"] += 1
    if changed["attention Reshape"] != 150 or changed["Expand"] != 6:
        raise RuntimeError(f"make_batchable expected 150 Reshapes + 6 Expands, rewrote {dict(changed)}")

    nodes = added + list(g.node)
    # drop the now-dead constant/Where chains so nothing unused reaches onnx2torch
    outputs = {o.name for o in g.output}
    while True:
        used = {i for n in nodes for i in n.input} | outputs
        keep = [n for n in nodes if any(o in used for o in n.output)]
        if len(keep) == len(nodes):
            break
        nodes = keep
    del g.node[:]
    g.node.extend(nodes)
    for v in list(g.input) + list(g.output):
        v.type.tensor_type.shape.dim[0].ClearField("dim_value")
        v.type.tensor_type.shape.dim[0].dim_param = "N"
    onnx.checker.check_model(m)
    return m


class LC050(nn.Module):
    """The converted LC050. forward(img) -> (points [B,8], has_obj [B,1], has_obj_logit [B,1]).

    Any batch size (make_batchable); the exported ONNX is re-pinned to batch 1
    to match the shipping contract."""

    def __init__(self, gm: fx.GraphModule, origins: dict[str, str], source_sha256: str):
        super().__init__()
        self.graph = gm
        self.source_sha256 = source_sha256
        self._origins = origins

    def forward(self, img: torch.Tensor):
        return self.graph(img)

    def param_groups(self) -> dict[str, list[tuple[str, nn.Parameter]]]:
        groups: dict[str, list] = {"backbone": [], "presence": [], "decoder": []}
        for name, p in self.named_parameters():
            inner = name.split(".", 1)[1]  # strip 'graph.'
            if inner.startswith("initializers."):
                origin = self._origins.get(inner, "?")
            else:
                origin = inner.rsplit(".", 1)[0]  # module path
            groups[group_of(origin)].append((name, p))
        return groups


class ExportView(nn.Module):
    """(points, has_obj) only -- the shipping output contract."""

    def __init__(self, m: LC050):
        super().__init__()
        self.m = m

    def forward(self, img):
        points, has_obj, _ = self.m(img)
        return points, has_obj


def build_model(onnx_path=LC050_ONNX) -> LC050:
    import onnx
    from onnx2torch import convert

    # A ModelProto, not a path: onnx2torch's path branch writes a NamedTemporaryFile
    # beside the model and re-opens it, which Windows refuses (PermissionError).
    gm = convert(make_batchable(onnx.load(str(onnx_path))), attach_onnx_mapping=True)
    origins = promote_initializers(gm)
    tap_presence_logit(gm)
    return LC050(gm, origins, sha256(onnx_path))


def load_checkpoint(path, onnx_path=LC050_ONNX, map_location="cpu") -> tuple[LC050, dict]:
    ck = torch.load(path, map_location=map_location, weights_only=False)
    m = build_model(onnx_path)
    if ck.get("source_sha256") and ck["source_sha256"] != m.source_sha256:
        raise ValueError(f"checkpoint was trained from a different ONNX ({ck['source_sha256'][:12]} != {m.source_sha256[:12]})")
    m.load_state_dict(ck["model"])
    return m, ck


# ---------------------------------------------------------------------------
# parity
# ---------------------------------------------------------------------------


def parity_inputs(limit: Optional[int] = None) -> list[tuple[str, np.ndarray]]:
    """Real model inputs: every session-2 fixture frame through BOTH pipelines
    (v3 canonical resize as the corpus is, v2 letterbox as the harness replays),
    plus a few random and constant tensors for the edges."""
    import preprocess as P
    from fixtures import list_flag_frames

    xs = []
    for f in list_flag_frames():
        if f["gt"] is None and f["scene"] != "none":
            continue
        img = P.load_rgba(f["png"])
        canon, _ = P.canonical_frame(img, "area")
        xs.append((f"{f['name']}/v3", P.model_input_from_square(canon, "area")))
        t = P.inference_transform(img.shape[1], img.shape[0])
        xs.append((f"{f['name']}/v2", P.to_nchw(P.rgba_to_bgr_planar(P.smooth_letterbox_rgba(img, t, "area")))))
    rng = np.random.default_rng(0)
    for i in range(4):
        xs.append((f"random{i}", rng.random((1, 3, 256, 256), dtype=np.float32)))
    xs.append(("zeros", np.zeros((1, 3, 256, 256), np.float32)))
    xs.append(("ones", np.ones((1, 3, 256, 256), np.float32)))
    return xs[:limit] if limit else xs


def run_parity(m: nn.Module, onnx_path, xs, device: str) -> dict:
    """max |torch - onnxruntime| per output over xs, fp32 (TF32 off)."""
    import preprocess as P

    ref = P.OrtModel(onnx_path)
    m = m.to(device).eval()
    worst = {"points": 0.0, "has_obj": 0.0, "points_real": 0.0, "has_obj_real": 0.0, "logit_vs_sigmoid": 0.0}
    with torch.no_grad():
        for name, x in xs:
            r = ref.run_raw(x)
            pts, obj, logit = m(torch.from_numpy(x).to(device))
            dp = float(np.abs(pts.cpu().numpy() - r["points"]).max())
            do = float(np.abs(obj.cpu().numpy() - r["has_obj"]).max())
            worst["points"] = max(worst["points"], dp)
            worst["has_obj"] = max(worst["has_obj"], do)
            if "/" in name:  # a real session-2 frame
                worst["points_real"] = max(worst["points_real"], dp)
                worst["has_obj_real"] = max(worst["has_obj_real"], do)
            worst["logit_vs_sigmoid"] = max(worst["logit_vs_sigmoid"], float((torch.sigmoid(logit) - obj).abs().max()))
    return worst


def gradient_report(m: LC050, device: str) -> dict:
    """One backward pass through a loss on both outputs: which parameters get gradient."""
    m = m.to(device).train()
    x = torch.rand(4, 3, 256, 256, device=device)
    pts, _, logit = m(x)
    (pts.square().mean() + nn.functional.binary_cross_entropy_with_logits(logit, torch.ones_like(logit))).backward()
    out = {}
    for g, items in m.param_groups().items():
        none = [n for n, p in items if p.grad is None]
        zero = [n for n, p in items if p.grad is not None and float(p.grad.abs().max()) == 0.0]
        out[g] = {"tensors": len(items), "floats": sum(p.numel() for _, p in items), "no_grad": len(none), "zero_grad": len(zero), "zero_grad_names": zero[:8]}
    m.zero_grad(set_to_none=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--onnx", default=str(LC050_ONNX))
    ap.add_argument("--grad", action="store_true")
    a = ap.parse_args()
    import onnx

    m = build_model(a.onnx)
    src = onnx.load(a.onnx)
    n_onnx = sum(int(np.prod(i.dims)) for i in src.graph.initializer)
    n_params = sum(p.numel() for p in m.parameters())
    n_float_bufs = sum(b.numel() for b in m.buffers() if torch.is_floating_point(b) and b.numel() > 1)
    groups = m.param_groups()
    print(f"converted {a.onnx}")
    print(f"  ONNX learned floats {n_onnx:,}; trainable after promotion {n_params:,} "
          f"(+{n_params - n_onnx:,} = the 6 de-duplicated initializers given back to each consumer)")
    print(f"  float buffers left with >1 element: {n_float_bufs} (must be 0 -- nothing learned stays frozen)")
    print("  groups: " + ", ".join(f"{g} {sum(p.numel() for _, p in v):,} floats in {len(v)} tensors" for g, v in groups.items()))
    ok = n_float_bufs == 0 and n_params >= n_onnx

    xs = parity_inputs()
    print(f"parity vs onnxruntime on {len(xs)} inputs ({sum(1 for n, _ in xs if '/' in n)} real session-2 tensors, v3 + v2):")
    res = {"cpu": run_parity(m, a.onnx, xs, "cpu")}
    if torch.cuda.is_available():
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cuda.matmul.allow_tf32 = False
        res["cuda fp32"] = run_parity(m, a.onnx, xs, "cuda")
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cuda.matmul.allow_tf32 = True
        res["cuda tf32 (info)"] = run_parity(m, a.onnx, xs, "cuda")
    for k, v in res.items():
        flag = "" if "info" in k else ("  PASS" if max(v["points"], v["has_obj"]) < 1e-4 else "  FAIL")
        print(f"  {k:17s} max|d| all inputs: points {v['points']:.3g}  has_obj {v['has_obj']:.3g} | real frames: points {v['points_real']:.3g}  has_obj {v['has_obj_real']:.3g} | sigmoid(logit)-has_obj {v['logit_vs_sigmoid']:.3g}{flag}")
        if "info" not in k:
            ok &= max(v["points"], v["has_obj"]) < 1e-4
    # A batch == the same frames one at a time (make_batchable), on real frames.
    if torch.cuda.is_available():
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cuda.matmul.allow_tf32 = False
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    real = torch.from_numpy(np.concatenate([x for n, x in xs if "/" in n][:32])).to(dev)
    with torch.no_grad():
        bp, bo, _ = m.to(dev)(real)
        loop = [m(real[i : i + 1]) for i in range(real.shape[0])]
    vb = max(float((bp - torch.cat([l[0] for l in loop])).abs().max()), float((bo - torch.cat([l[1] for l in loop])).abs().max()))
    print(f"  batched (B={real.shape[0]}) vs one-at-a-time, {dev} fp32: max|d| {vb:.3g}{'  PASS' if vb < 1e-5 else '  FAIL'}")
    ok &= vb < 1e-5
    if a.grad:
        print("gradient reach (one backward on points + presence losses):")
        for g, r in gradient_report(m, "cuda" if torch.cuda.is_available() else "cpu").items():
            print(f"  {g:9s} {r['tensors']:3d} tensors {r['floats']:>9,} floats; no grad {r['no_grad']}; exactly-zero grad {r['zero_grad']} {r['zero_grad_names'] if r['zero_grad'] else ''}")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
