"""Export a fine-tuned identity embedding to the two ONNX files production needs.

    python tools/scan-embed/export.py --run r1 [--ckpt best.pt] --name deckpal-card-b32-v1

Writes ~/deckpal-data/scan-embed/export/<name>/:
  <name>.fp32.onnx   the catalogue side (tools/embed-catalog embeds the gallery with it)
  <name>.int8.onnx   the query side (the API's SCAN_EMBED_MODEL_PATH; dynamic int8,
                     the same quantisation the shipped clip-vit-b32-openai uses, so
                     ORT-web's wasm build runs it exactly as it runs today's)
  manifest.json      sha256 + size of both, the checkpoint's eval, and the
                     fp32/int8 agreement measured here

The I/O contract is the shipped one: input `pixel_values` [N,3,224,224] float32
in the input-spec's normalisation, output `features` [N,768]. The output is
L2-normalised inside the graph; the API normalises again, which is idempotent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from train import Embedder, RUNS  # noqa: E402

OUT = Path(os.environ.get("SCAN_EMBED_EXPORT", Path.home() / "deckpal-data" / "scan-embed" / "export"))


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--ckpt", default="best.pt")
    ap.add_argument("--name", required=True)
    a = ap.parse_args()

    ck = torch.load(RUNS / a.run / a.ckpt, map_location="cpu", weights_only=False)
    args = ck["args"]
    model = Embedder(args["model"], args.get("dim_out") or None)
    model.load_state_dict(ck["model"])
    model.backbone.set_grad_checkpointing(False) if hasattr(model.backbone, "set_grad_checkpointing") else None
    model.eval()

    out = OUT / a.name
    out.mkdir(parents=True, exist_ok=True)
    fp32 = out / f"{a.name}.fp32.onnx"
    int8 = out / f"{a.name}.int8.onnx"
    x = torch.zeros(1, 3, args["size"], args["size"])
    torch.onnx.export(
        model, (x,), str(fp32), input_names=["pixel_values"], output_names=["features"],
        dynamic_axes={"pixel_values": {0: "batch"}, "features": {0: "batch"}},
        opset_version=17, do_constant_folding=True, dynamo=False,
    )

    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)

    # Agreement: torch vs fp32 ONNX vs int8 ONNX on random and on real-looking input.
    import onnxruntime as ort

    rng = np.random.default_rng(0)
    xb = rng.normal(0, 1, (8, 3, args["size"], args["size"])).astype(np.float32)
    with torch.no_grad():
        ref = model(torch.from_numpy(xb)).numpy()
    s32 = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    s8 = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    o32 = s32.run(None, {"pixel_values": xb})[0]
    o8 = s8.run(None, {"pixel_values": xb})[0]
    norm = lambda v: v / np.linalg.norm(v, axis=1, keepdims=True)  # noqa: E731
    cos32 = float((norm(ref) * norm(o32)).sum(1).min())
    cos8 = float((norm(ref) * norm(o8)).sum(1).min())

    manifest = {
        "name": a.name,
        "run": a.run,
        "checkpoint": a.ckpt,
        "backbone": args["model"],
        "trainEval": ck.get("eval"),
        "dims": int(o32.shape[1]),
        "minCosine": {"torch_vs_fp32": cos32, "torch_vs_int8": cos8},
        "files": {
            p.name: {"sha256": sha256(p), "bytes": p.stat().st_size} for p in (fp32, int8)
        },
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
