"""Emit a numeric fixture for the deformation field, by running the UPSTREAM code.

The point of this script is that it does NOT re-implement `decke_field.py`. It
imports the real file and executes it, so the fixture is ground truth rather than
a second transcription that could repeat the same mistake as the TypeScript port.

`decke_field.py` imports `mathutils`, which only exists inside Blender. Rather
than run Blender, we inject a minimal shim providing exactly the surface the
field code touches: Vector construction/indexing/arithmetic/normalized/dot/cross
and Matrix construction/to_4x4/translation. If the upstream file ever starts
using more of mathutils, this shim will raise rather than silently return
something plausible.

    python gen-field-fixture.py [--src DIR] [--out FILE]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import types

DEFAULT_SRC = r"C:/Users/cheyr/Documents/DeckPal Character/wiki/_raw/src"
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "field-fixture.json"
)


class Vector:
    __slots__ = ("_v",)

    def __init__(self, v=(0.0, 0.0, 0.0)):
        self._v = [float(v[0]), float(v[1]), float(v[2])]

    # indexing / attribute access
    def __getitem__(self, i):
        return self._v[i]

    def __setitem__(self, i, val):
        self._v[i] = float(val)

    @property
    def x(self):
        return self._v[0]

    @property
    def y(self):
        return self._v[1]

    @property
    def z(self):
        return self._v[2]

    # arithmetic
    def __add__(self, o):
        return Vector([a + b for a, b in zip(self._v, o._v)])

    def __sub__(self, o):
        return Vector([a - b for a, b in zip(self._v, o._v)])

    def __mul__(self, s):
        return Vector([a * s for a in self._v])

    __rmul__ = __mul__

    def __truediv__(self, s):
        return Vector([a / s for a in self._v])

    def __neg__(self):
        return Vector([-a for a in self._v])

    def dot(self, o):
        return sum(a * b for a, b in zip(self._v, o._v))

    def cross(self, o):
        a, b = self._v, o._v
        return Vector((a[1] * b[2] - a[2] * b[1],
                       a[2] * b[0] - a[0] * b[2],
                       a[0] * b[1] - a[1] * b[0]))

    @property
    def length(self):
        return math.sqrt(self.dot(self))

    def normalized(self):
        n = self.length
        return Vector([a / n for a in self._v]) if n else Vector()

    def to_list(self):
        return list(self._v)

    def __repr__(self):
        return f"Vector({self._v})"


class Matrix:
    """Row-major 3x3 or 4x4, matching mathutils' constructor semantics."""

    __slots__ = ("rows",)

    def __init__(self, rows=None):
        if rows is None:
            rows = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
        self.rows = [list(map(float, r)) for r in rows]

    def to_4x4(self):
        if len(self.rows) == 4:
            return Matrix([r[:] for r in self.rows])
        m = [[0.0] * 4 for _ in range(4)]
        for i in range(3):
            for j in range(3):
                m[i][j] = self.rows[i][j]
        m[3][3] = 1.0
        return Matrix(m)

    @property
    def translation(self):
        return Vector((self.rows[0][3], self.rows[1][3], self.rows[2][3]))

    @translation.setter
    def translation(self, v):
        self.rows[0][3] = v[0]
        self.rows[1][3] = v[1]
        self.rows[2][3] = v[2]

    def to_list(self):
        return [r[:] for r in self.rows]


def install_mathutils_shim():
    mod = types.ModuleType("mathutils")
    mod.Vector = Vector
    mod.Matrix = Matrix
    sys.modules["mathutils"] = mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    install_mathutils_shim()
    src = os.path.abspath(args.src)
    if not os.path.isdir(src):
        sys.exit(f"source directory not found: {src}")
    sys.path.insert(0, src)
    import decke_field as F  # noqa: E402

    # Probe points chosen to exercise the field where it actually matters:
    # the origin (identity), the hinge, eye height, the top and bottom of the
    # body, and off-axis points where bend/lean/twist interact.
    points = [
        [0.0, 0.0, 0.0],
        [0.0, 0.575, 1.88],       # HINGE_REST
        [0.393, -1.15, 1.533],    # right eye centre, front panel
        [-0.393, -1.15, 1.533],   # left eye centre
        [0.875, 0.575, 2.4],      # top corner
        [-0.875, -0.575, 0.0],    # bottom corner
        [0.5, 0.3, 1.2],
        [-0.2, -0.4, 2.0],
        [0.0, 0.0, 2.4],
        [0.13, -0.07, 0.42],
    ]

    # Angle triples in DEGREES: identity, each axis alone in both directions,
    # the authored maxima, and combined poses including past-spec extremes.
    angles = [
        [0.0, 0.0, 0.0],
        [18.0, 0.0, 0.0],
        [-18.0, 0.0, 0.0],
        [0.0, 15.0, 0.0],
        [0.0, -15.0, 0.0],
        [0.0, 0.0, 12.0],
        [0.0, 0.0, -12.0],
        [12.0, 10.0, 8.0],
        [-7.5, 4.25, -3.125],
        [30.0, 25.0, 20.0],
        [40.0, 30.0, 25.0],
        [1e-10, 0.0, 0.0],        # the T -> 0 guard
        [0.0, 1e-10, 0.0],
    ]

    cases = []
    for p in points:
        for a in angles:
            pos = F.field(Vector(p), a[0], a[1], a[2])
            mat = F.field_matrix(Vector(p), a[0], a[1], a[2])
            cases.append({
                "p": p,
                "angles": a,
                "field": pos.to_list(),
                "matrix": mat.to_list(),   # row-major 4x4
            })

    doc = {
        "note": "Ground truth produced by executing wiki/_raw/src/decke_field.py "
                "under a minimal mathutils shim. Blender frame: Z-up, degrees, "
                "blender units. `matrix` is ROW-MAJOR.",
        "H": F.H,
        "EPS": F.EPS,
        "hinge_rest": F.HINGE_REST.to_list(),
        "max": {k: [v[0], v[1]] for k, v in F.MAX.items()},
        "cases": cases,
    }

    out = os.path.normpath(args.out)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print(f"wrote {out}: {len(cases)} cases "
          f"({len(points)} points x {len(angles)} angle triples)")


if __name__ == "__main__":
    main()
