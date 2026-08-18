"""Ground-truth fixture for the procedural layers, from the UPSTREAM Python.

Like `gen-field-fixture.py`, this EXECUTES `decke_idle.py` / `decke_proc.py`
rather than re-implementing them, so the TypeScript is compared against the real
source. Neither module imports `mathutils`, so no shim is needed here.

The PRNG sequence is included because the whole reproducibility argument for
blink and gaze rests on Blender and the browser drawing the SAME numbers in the
SAME order. If the draw order drifts, the schedules diverge and nothing else
will tell you.

    python gen-proc-fixture.py [--src DIR] [--out FILE]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

DEFAULT_SRC = r"C:/Users/cheyr/Documents/DeckPal Character/wiki/_raw/src"
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "proc-fixture.json"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    if not os.path.isdir(src):
        sys.exit(f"source directory not found: {src}")
    sys.path.insert(0, src)
    import decke_idle as ID   # noqa: E402
    import decke_proc as PR   # noqa: E402

    # --- idle float: sample every channel over a couple of base periods -------
    times = [i * 0.05 for i in range(0, 160)]  # 0 .. 7.95 s
    idle = {c: [ID.idle(c, t) for t in times] for c in ID.CHANNELS}

    # --- PRNG: the raw sequence, which everything stochastic depends on -------
    rng = PR.Rng()
    prng_seq = [rng.next() for _ in range(64)]

    # --- blink curve: sampled across and past the whole 220 ms envelope -------
    blink_ms = [t * 2.5 for t in range(0, 110)]  # 0 .. 272.5 ms
    blink_curve = [PR.blink_curve(t) for t in blink_ms]

    # --- schedules: reproduced with a freshly seeded generator each time ------
    blink_sched = PR.blink_schedule(120.0, PR.Rng())
    flit_sched = PR.flit_schedule(120.0, PR.Rng())
    glance_sched = PR.glance_schedule(120.0, PR.Rng())

    doc = {
        "note": "Ground truth produced by executing wiki/_raw/src/decke_idle.py and "
                "decke_proc.py. Idle position is blender units, rotation DEGREES, "
                "t in SECONDS. Blink curve t is MILLISECONDS from blink start.",
        "idle": {
            "f0": ID.F0, "ratios": list(ID.R), "weights": list(ID.W),
            "amp": dict(ID.AMP), "phi": {k: list(v) for k, v in ID.PHI.items()},
            "times": times, "values": idle,
        },
        "prng": {"seed": PR.SEED, "a": PR._A, "m": PR._M, "sequence": prng_seq},
        "blink": {
            "close_ms": PR.BLINK_CLOSE_MS, "hold_ms": PR.BLINK_HOLD_MS,
            "open_ms": PR.BLINK_OPEN_MS,
            "curve_t_ms": blink_ms, "curve": blink_curve,
            "schedule_120s": blink_sched,
        },
        "flit": {
            "amp_x": PR.FLIT_AMP_X, "amp_z": PR.FLIT_AMP_Z,
            "move_ms": PR.FLIT_MOVE_MS,
            "schedule_120s": [list(x) for x in flit_sched],
        },
        "glance": {
            "amp_x": list(PR.GLANCE_AMP_X), "amp_z": list(PR.GLANCE_AMP_Z),
            "hold_ms": list(PR.GLANCE_HOLD_MS),
            "schedule_120s": [list(x) for x in glance_sched],
        },
        "state_mod": {k: list(v) for k, v in PR.STATE_MOD.items()},
        "alert_mod": list(PR.ALERT_MOD),
        "gaze_lock": sorted(PR.GAZE_LOCK),
    }

    out = os.path.normpath(args.out)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print(f"wrote {out}: {len(times)} idle samples, {len(prng_seq)} prng draws, "
          f"{len(blink_sched)} blinks, {len(flit_sched)} flits, "
          f"{len(glance_sched)} glances over 120 s")


if __name__ == "__main__":
    main()
