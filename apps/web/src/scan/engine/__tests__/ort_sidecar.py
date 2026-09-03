#!/usr/bin/env python
"""Offline ORT runner for the engine's integration harness.

WHY A SIDECAR. The shipping engine runs LC050 through onnxruntime-web's
wasm-only bundle, which resolves its .wasm with `new URL(..., import.meta.url)`
and `fetch` -- a browser-only path that cannot be driven from node. The ONNX
GRAPH is what the harness needs to reproduce, not ORT's loader, so this script
runs the identical .onnx under python onnxruntime (the same interpreter phase 0a
used, p2-work/phase0a/.venv) and the TypeScript driver keeps ownership of every
byte of preprocessing.

Protocol, deliberately dumb so the TS side stays pure:
  argv: <model.onnx> <input.bin> <n> <out.json>
  input.bin : n * 3 * 256 * 256 float32, little-endian, exactly what
              preprocess.rgbaToBGRPlanar produced.
  out.json  : [{"points": [8 floats], "hasObj": float}, ...] in input order.
"""
import json
import sys

import numpy as np
import onnxruntime as ort

SZ = 256


def main() -> int:
    model, inp, n_s, out = sys.argv[1:5]
    n = int(n_s)
    x = np.fromfile(inp, dtype=np.float32).reshape(n, 3, SZ, SZ)
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    onames = [o.name for o in sess.get_outputs()]
    rows = []
    # One at a time: the shipping engine infers one frame per detect tick, and a
    # batched graph could legitimately differ (BN/pooling over the batch axis).
    for i in range(n):
        o = dict(zip(onames, sess.run(None, {in_name: x[i : i + 1]})))
        pts = np.ravel(o["points"]).astype(float).tolist()
        hob = float(np.ravel(o["has_obj"])[0])
        rows.append({"points": pts, "hasObj": hob})
    json.dump(rows, open(out, "w"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
