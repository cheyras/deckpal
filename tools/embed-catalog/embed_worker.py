"""The embedding half of tools/embed-catalog.

Reads one image path per line on stdin, writes one JSON object per line on
stdout: {"path": ..., "vector": [...]} or {"path": ..., "error": ...}.

WHY PYTHON AND NOT THE NODE JOB THAT DRIVES IT
----------------------------------------------
The vectors the phone will be compared against have to be produced by the
parity-tested input spec, and the only implementation of that spec with a
committed bit-exact golden on this side of the wire is
`packages/matching/python/deckpal_matching/input_spec.py`. Reimplementing the
resampler in Node for the sake of a single-language job would create a THIRD
implementation of the one thing this design exists to keep singular.

So the split is by what each side is actually the authority on: Node owns the
database contract (resumability, batched upserts, one pooled connection —
contracts B2 and B8), Python owns the tensor. They speak JSON lines, which
costs one process and no shared state.

REQUIREMENTS (checked here, loudly, rather than assumed by the caller):
    pip install onnxruntime numpy pillow
plus the exported model at the path given by --model.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "packages", "matching", "python"))


def fail(message: str) -> "None":
    """Exit non-zero with a sentence that names the fix.

    A worker that dies with an ImportError traceback tells the operator that
    something is missing; it does not tell them which pip install to run, and
    the driver process on the other side of the pipe can only report that the
    child exited.
    """
    print(json.dumps({"fatal": message}), flush=True)
    sys.exit(2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="path to the exported .onnx")
    ap.add_argument("--margin", type=float, default=0.0,
                    help="capture margin to crop off; 0 for catalog renders")
    ap.add_argument("--threads", type=int, default=0,
                    help="ORT intra-op threads; 0 lets ORT choose")
    args = ap.parse_args()

    try:
        import numpy as np
        import onnxruntime as ort
        from PIL import Image
    except ImportError as exc:
        fail(
            "embed_worker needs onnxruntime, numpy and pillow: "
            "`pip install onnxruntime numpy pillow` (%s)" % exc
        )
        return

    try:
        from deckpal_matching.input_spec import (
            EMBED_SIZE,
            embed_input_numpy,
            embed_stamp,
        )
    except ImportError as exc:
        fail("could not import packages/matching/python/deckpal_matching: %s" % exc)
        return

    if not os.path.exists(args.model):
        fail(
            "model not found at %s. Export it first (see tools/embed-catalog/README.md) "
            "— this job will not silently embed with a different checkpoint." % args.model
        )
        return

    so = ort.SessionOptions()
    if args.threads:
        so.intra_op_num_threads = args.threads
    sess = ort.InferenceSession(args.model, so, providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    # Announce readiness with the stamp the driver will store, so a mismatch
    # between what the job thinks it is writing and what the API will query is
    # caught before a single row is inserted rather than after 23,546.
    print(json.dumps({"ready": True, "stamp": embed_stamp(), "size": EMBED_SIZE}), flush=True)

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            im = Image.open(path).convert("RGBA")
            rgba = np.asarray(im, dtype=np.uint8).reshape(-1)
            x = embed_input_numpy(rgba, im.width, im.height, margin_frac=args.margin)
            out = sess.run(None, {input_name: x[None]})[0][0].astype("float64")
            n = float((out * out).sum()) ** 0.5
            if n == 0:
                raise ValueError("model returned a zero vector")
            print(
                json.dumps({"path": path, "vector": [float(v / n) for v in out]}),
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001 - one bad file must not kill the run
            print(json.dumps({"path": path, "error": "%s: %s" % (type(exc).__name__, exc)}), flush=True)


if __name__ == "__main__":
    main()
