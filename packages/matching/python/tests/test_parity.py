"""The Python half of the cross-runtime bit-parity contract.

    python -m pytest packages/matching/python/tests/test_parity.py
    # or, with no pytest installed:
    python packages/matching/python/tests/test_parity.py

Both halves check the SAME committed digest (`fixtures/parity-golden.json`),
written by the TypeScript generator. That direction is deliberate: the browser
is where a mismatch is unfixable after the fact — a catalog can be re-embedded,
a phone in someone's hand cannot — so TypeScript defines the golden and Python
is held to it.
"""

import hashlib
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from deckpal_matching.input_spec import (  # noqa: E402
    EMBED_SPEC_VERSION,
    embed_input,
    pack_f32,
)

GOLDEN_PATH = os.path.join(HERE, "..", "..", "fixtures", "parity-golden.json")


def synthetic_rgba(seed: int, width: int, height: int) -> bytearray:
    """Mirror of `src/__tests__/fixtures.ts`. Same LCG, same constants, same
    top-byte extraction — see that file for why it is generated rather than
    committed as an image."""
    out = bytearray(width * height * 4)
    s = seed & 0xFFFFFFFF
    for i in range(width * height):
        o = i * 4
        for c in range(3):
            s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
            out[o + c] = s >> 24
        out[o + 3] = 255
    return out


def load_golden():
    with open(GOLDEN_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def test_spec_version_matches_golden():
    assert load_golden()["specVersion"] == EMBED_SPEC_VERSION


def test_parity_against_committed_golden():
    golden = load_golden()
    for case in golden["cases"]:
        data = synthetic_rgba(case["seed"], case["width"], case["height"])
        values = embed_input(
            data, case["width"], case["height"], margin_frac=case["marginFrac"]
        )
        assert len(values) == case["length"], case["name"]
        assert [float(v) for v in values[:8]] == case["first8"], case["name"]
        assert [float(v) for v in values[-8:]] == case["last8"], case["name"]
        digest = hashlib.sha256(pack_f32(values)).hexdigest()
        assert digest == case["sha256"], (
            "%s: python produced %s, golden says %s — the two implementations "
            "have drifted; do not embed a catalog until they agree"
            % (case["name"], digest, case["sha256"])
        )


def test_numpy_fast_path_agrees_with_the_reference():
    """The catalog job uses the vectorised path; this is what licenses it.

    Not bit-exact by construction (numpy reassociates its reductions), so the
    bar is float32's own resolution rather than equality — an implementation
    that is 1e-7 away is a fine catalog embedder and would be an unacceptable
    definition of the spec.
    """
    try:
        import numpy as np
    except ImportError:  # pragma: no cover - environment without numpy
        return
    from deckpal_matching.input_spec import embed_input_numpy

    w, h = 61, 85
    data = synthetic_rgba(11, w, h)
    ref = embed_input(data, w, h, margin_frac=0.05)
    fast = embed_input_numpy(data, w, h, margin_frac=0.05).reshape(-1)
    assert len(ref) == len(fast)
    worst = max(abs(a - float(b)) for a, b in zip(ref, fast))
    assert worst < 1e-5, "numpy path drifted from the reference by %g" % worst


def test_numpy_fast_path_is_actually_fast():
    """A correctness test cannot catch this one, and a real run nearly did not.

    The vectorised path was first written as a single four-index `np.einsum`.
    It is exactly correct, it passes every assertion above, and on a real
    245x337 catalogue render it took **21.1 seconds per image** — 38 hours for
    the 6,464-image spike gallery, and rather longer for the 23,546-row
    catalogue this exists to embed. The parity fixture is 61x85, small enough
    that the difference did not show.

    So the bound is checked at a REALISTIC size, and it is deliberately loose:
    the fixed implementation is ~4 ms and this fails at 500, so it cannot flake
    on a slow or loaded machine and cannot miss a return to the naive
    contraction.
    """
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        return
    import time

    from deckpal_matching.input_spec import embed_input_numpy

    w, h = 245, 337
    data = synthetic_rgba(5, w, h)  # a bytearray: numpy reads it as a buffer
    embed_input_numpy(data, w, h)  # warm any BLAS init out of the measurement
    t0 = time.perf_counter()
    embed_input_numpy(data, w, h)
    ms = (time.perf_counter() - t0) * 1000
    assert ms < 500, (
        "embed_input_numpy took %.0f ms for one 245x337 image. The reference "
        "implementation is ~4 ms; a naive einsum contraction is ~21,000. Check "
        "that the box filter is still two tensordot calls." % ms
    )


def test_js_math_round_semantics():
    """`round_half_away` must be JavaScript's Math.round, not Python's round.

    Python's round(2.5) is 2 and JavaScript's Math.round(2.5) is 3. That one
    difference moves the crop origin by a pixel, which is a different tensor —
    and it would show up as an unexplained accuracy loss in production long
    before anyone suspected the rounding mode.
    """
    from deckpal_matching.input_spec import round_half_away

    assert round_half_away(0.5) == 1
    assert round_half_away(2.5) == 3
    assert round_half_away(-0.5) == 0
    assert round_half_away(21.818181818181817) == 22


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok   %s" % name)
            except AssertionError as exc:
                failures += 1
                print("FAIL %s: %s" % (name, exc))
    print("%d failure(s)" % failures)
    sys.exit(1 if failures else 0)
