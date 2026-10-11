#!/usr/bin/env python
"""LC050 as a long-lived process, for the video replay (replay.ts).

WHY NOT ort_sidecar.py AS-IS. That script (apps/web/src/scan/engine/__tests__/
ort_sidecar.py) is one subprocess per batch, reading and writing temp files, and
session creation dominates its cost. A video is thousands of detect ticks, and
the replay wants them in small batches (it has to keep each batch's full-res
frames in memory until the causal pass over them is done), so this keeps ONE
session open and speaks over pipes instead. Everything else is that sidecar's
contract, unchanged:

  * the TypeScript side owns every byte of preprocessing — this receives exactly
    what preprocess.rgbaToBGRPlanar produced and nothing here touches pixels;
  * frames are inferred ONE AT A TIME even inside a batch, because the shipping
    engine infers one frame per detect tick and a batched graph could
    legitimately differ (BN/pooling over the batch axis) — ort_sidecar.py:35.

Protocol (stdin binary, stdout text):
  in : uint32 LE n, then n * 3 * 256 * 256 float32 LE. n == 0 means exit.
  out: one JSON line per batch: [{"points": [8 floats], "hasObj": float}, ...]

  argv: <model.onnx>
"""
import json
import os
import sys

import numpy as np
import onnxruntime as ort

SZ = 256
PER = 3 * SZ * SZ * 4  # bytes per tensor


def read_exact(stream, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            raise EOFError(f"stdin closed after {len(buf)}/{n} bytes")
        buf.extend(chunk)
    return bytes(buf)


def main() -> int:
    model = sys.argv[1]
    so = ort.SessionOptions()
    # Threads are a speed knob only; the graph and its outputs do not depend on
    # them. Left at ORT's default unless the caller pins it.
    threads = os.environ.get("LC050_THREADS")
    if threads:
        so.intra_op_num_threads = int(threads)
    sess = ort.InferenceSession(model, sess_options=so, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    onames = [o.name for o in sess.get_outputs()]
    stdin = sys.stdin.buffer
    stdout = sys.stdout
    while True:
        n = int.from_bytes(read_exact(stdin, 4), "little")
        if n == 0:
            return 0
        x = np.frombuffer(read_exact(stdin, n * PER), dtype=np.float32).reshape(n, 3, SZ, SZ)
        rows = []
        for i in range(n):
            o = dict(zip(onames, sess.run(None, {in_name: x[i : i + 1]})))
            rows.append(
                {
                    "points": np.ravel(o["points"]).astype(float).tolist(),
                    "hasObj": float(np.ravel(o["has_obj"])[0]),
                }
            )
        stdout.write(json.dumps(rows) + "\n")
        stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())
