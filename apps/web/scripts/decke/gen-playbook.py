"""Regenerate the Deck-E runtime playbook from the character wiki's normative sources.

The character lives in a separate repo-less working directory:
    C:/Users/cheyr/Documents/DeckPal Character/wiki/_raw/src/

Those files are IMMUTABLE by that wiki's own rules (`_raw/` is never edited), so this
generator lives here instead of patching the upstream `gen_playbook.py`. It fixes four
things that upstream generator gets wrong or omits as of 2026-08-17:

  1. Upstream reads `FL.PROFILE_HOP` / `PROFILE_FAR_OUT` / `PROFILE_FAR_BACK`. Those
     Catmull-Rom profile tables were DELETED when the flight timing became a simulated
     runtime controller, so upstream now dies with AttributeError and `playbook.json`
     has not been regenerated since 2026-08-16. Four states are stale in that file
     (`thinking`, `point`, `travel_point`, `travel_far`).
  2. Upstream drops `overlay`, `spin`, `vibrate_hz` and the `mod` profile name, so the
     L2 overlay layer and the alert vibrate rate are invisible in the JSON.
  3. Upstream records the symbol atlas as a 4x2 grid. It is 5x2, 2560x1024.
  4. `alert_scribble` emits two beats at t_ms=500 (one `ease` from the base skeleton,
     one injected `step`). Blender tolerates coincident keys; a JS interpolant divides
     by zero on the zero-length segment. We keep the `step` variant.

Everything numeric still comes from the upstream Python. Nothing is hand-entered here.

    python gen-playbook.py [--src DIR] [--out FILE] [--check]

`--check` regenerates in memory and diffs against the existing output, exiting 1 on any
difference, so CI can assert the committed playbook matches the sources.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

DEFAULT_SRC = r"C:/Users/cheyr/Documents/DeckPal Character/wiki/_raw/src"
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "public", "models", "decke", "playbook.json",
)

# Channels the generator forces to a fixed interpolation regardless of the beat's own
# `ease` tag. Both are cases where a stepped neighbour would otherwise freeze a channel
# that must keep moving: the dizzy spiral would stop mid-vibrate, and the loading orbit
# would gain a euler-wrap hiccup.
LINEAR_CHANNELS = {"alert_dizzy": ["sym_spin"]}


def load_sources(src: str):
    src = os.path.abspath(src)
    if not os.path.isdir(src):
        sys.exit(f"source directory not found: {src}")
    sys.path.insert(0, src)
    import decke_states as S      # noqa: E402
    import decke_proc as PR       # noqa: E402
    import decke_idle as ID       # noqa: E402
    import decke_flight as FL     # noqa: E402
    return S, PR, ID, FL


def delta(pose, rest):
    """Beats are stored as deltas from REST -- only what the beat actually changes.

    Rounded to 4dp because the generator emits floats from trig and full binary
    precision makes a regenerated diff unreadable without a single pose having moved.
    """
    d = {}
    for k, v in pose.items():
        r = rest.get(k, 0)
        if isinstance(v, float) and isinstance(r, (int, float)):
            if abs(v - r) < 1e-9:
                continue
            d[k] = round(v, 4)
        elif v != r:
            d[k] = v
    return d


def dedupe_beats(beats, state_name):
    """Collapse beats sharing a t_ms, preferring `step`.

    Only `alert_scribble` currently trips this, at t_ms=500, where the injected
    scribble-frame beat lands on top of the base skeleton's reel-settle beat. The
    `step` variant carries the `sym_frame` semantics for the following segment.
    """
    out, dropped = [], 0
    for b in beats:
        if out and out[-1]["t_ms"] == b["t_ms"]:
            keep = b if b["ease"] == "step" else out[-1]
            merged = dict(out[-1]["pose"])
            merged.update(b["pose"])
            out[-1] = {"t_ms": b["t_ms"], "ease": keep["ease"], "pose": merged}
            dropped += 1
            continue
        out.append(b)
    if dropped:
        print(f"  {state_name}: merged {dropped} coincident beat(s)")
    return out


def _non_resting(S, which):
    """States whose first (or last) beat is not the rest pose.

    Returns {state: [channels]} so a consumer can tell a whole-body departure
    (travel_far ends mid-flight) from a cosmetic one (alert_dizzy leaves
    `sym_spin` wound up while the glyph is off-screen).
    """
    out = {}
    for name in S.PLAYBOOK:
        beats = S.STATES[name]["beats"]
        pose = beats[0][1] if which == "start" else beats[-1][1]
        d = delta(pose, S.REST)
        # `delta` decides membership on the UNROUNDED value but emits a rounded
        # one, so a channel sitting at 4e-5 is listed while the value that ships
        # is -0.0. Filter on what is actually emitted, or this list disagrees
        # with the file it describes (travel_far's `bend` did exactly that).
        chans = sorted(k for k, v in d.items() if v != 0)
        if chans:
            out[name] = chans
    return out


def build(S, PR, ID, FL):
    states = {}
    for name in S.PLAYBOOK:
        st = S.STATES[name]
        is_alert = bool(st.get("sym")) and name.startswith("alert")
        mod_key = "alert" if is_alert else st.get("mod", "idle")
        mod = PR.ALERT_MOD if is_alert else PR.STATE_MOD.get(mod_key, (1.0, 1.0, 1.0))

        beats = [
            {
                "t_ms": b[0],
                "ease": b[2] if len(b) > 2 else st.get("ease", "ease"),
                "pose": delta(b[1], S.REST),
            }
            for b in st["beats"]
        ]
        beats = dedupe_beats(beats, name)

        entry = {
            "kind": "clip",
            "symbol": st.get("sym"),
            "duration_ms": st["beats"][-1][0],
            # The profile NAME is retained as well as the resolved triple: six states
            # point at a profile that is not their own name (listening->curious,
            # nod_yes/shake_no/card_present->idle, card_stash->happy, card_show->curious),
            # and that indirection is invisible once resolved.
            "mod": mod_key,
            "modulation": {
                "float_amp": mod[0], "float_rate": mod[1], "blink_rate": mod[2],
            },
            "beats": beats,
        }
        if st.get("loop"):        entry["loop"] = True
        if st.get("orbit"):       entry["orbit"] = True
        if st.get("overlay"):     entry["overlay"] = True
        if st.get("spin"):        entry["spin"] = True
        if st.get("vibrate_hz"):  entry["vibrate_hz"] = st["vibrate_hz"]
        if name in PR.GAZE_LOCK:  entry["gaze_lock"] = True
        if name in LINEAR_CHANNELS:
            entry["linear_channels"] = LINEAR_CHANNELS[name]
        if name in S.FLIGHT_SPANS:
            entry["flight_spans_ms"] = S.FLIGHT_SPANS[name]
        states[name] = entry

    return {
        "schema": "deck-e-playbook/3",
        "generated_by": "apps/web/scripts/decke/gen-playbook.py",
        "fps": S.FPS,
        "units": {
            "length": "blender units (1 u = 40.13 mm)",
            "angle": "degrees",
            "time": "milliseconds",
            "axis": "Blender Z-up. Convert to three.js Y-up: pos x->x, y->-z, z->y; "
                    "rot rx->rx, ry->-rz, rz->ry. Scale is NOT converted.",
        },
        "transition": {
            "blend_ms": S.BLEND_MS,
            "policy": "hub-and-spoke via rest",
            "idle_beat_ms": S.IDLE_BEAT_MS,
            "snap_states": ["confused", "frustrated", "embarrassed"],
            "snap_reason": "stepped-interpolation clips turn to mush when crossfaded",
            "snap_note": "`thinking` is listed as a snap state upstream but was rebuilt "
                         "on 2026-08-17 as a spring rock with zero step beats; the stated "
                         "reason no longer applies to it.",
            # Computed from the beats, not hand-listed -- a hand-listed version
            # was already wrong (it missed `boot`, which STARTS away from rest by
            # design, and the two alert states whose symbol channels never return
            # to zero). The runtime needs both halves: hub-and-spoke blending
            # assumes a clip begins and ends at rest, and each exception has to
            # be blended explicitly instead.
            "non_resting_start": _non_resting(S, "start"),
            "non_resting_end": _non_resting(S, "end"),
            "non_resting_note": "`boot` starts squashed and shut by design. The "
                                "`sym_spin`/`sym_frame` residue on alert_dizzy and "
                                "alert_scribble is harmless -- the glyph is parked "
                                "off-screen once `alert` returns to 0 -- but it is "
                                "real and must not be asserted away.",
        },
        "rest_pose": dict(S.REST),
        "gaze_lock": sorted(PR.GAZE_LOCK),
        "step_rates_hz": {"sharp": S.STEP_HZ_SHARP, "slow": S.STEP_HZ_SLOW},
        "procedural": {
            "idle_float": {
                "base_hz": ID.F0, "ratios": list(ID.R), "weights": list(ID.W),
                "amplitude": dict(ID.AMP), "phase": {k: list(v) for k, v in ID.PHI.items()},
                "note": "irrational frequency ratios so the hover never visibly repeats. "
                        "t is SECONDS. Rate multiplies a separately integrated clock -- "
                        "never scale t, or the phase jumps on every state entry.",
            },
            "prng": {"algorithm": "lehmer/park-miller",
                     "a": PR._A, "m": PR._M, "seed": PR.SEED},
            "blink": {"close_ms": PR.BLINK_CLOSE_MS, "hold_ms": PR.BLINK_HOLD_MS,
                      "open_ms": PR.BLINK_OPEN_MS,
                      "interval_s": [PR.BLINK_MIN_S, PR.BLINK_MAX_S],
                      "double_p": PR.DOUBLE_BLINK_P, "double_gap_ms": PR.DOUBLE_GAP_MS,
                      "first_offset_s": [0.6, 2.0],
                      "lower_lid_ratio": 0.75,
                      "compose": "max",
                      "compose_note": "lower_lid_ratio and the max rule are stated in "
                                      "wiki/procedural/blink.md but are ABSENT from "
                                      "decke_proc.py -- design intent, not measured."},
            "gaze_flit": {"interval_s": [PR.FLIT_MIN_S, PR.FLIT_MAX_S],
                          "amp_x": PR.FLIT_AMP_X, "amp_z": PR.FLIT_AMP_Z,
                          "move_ms": PR.FLIT_MOVE_MS, "first_offset_s": [0.3, 1.0]},
            "glance_away": {"interval_s": [PR.GLANCE_MIN_S, PR.GLANCE_MAX_S],
                            "hold_ms": list(PR.GLANCE_HOLD_MS),
                            "amp_x": list(PR.GLANCE_AMP_X),
                            "amp_z": list(PR.GLANCE_AMP_Z),
                            "first_offset_s": [4.0, 9.0],
                            "note": "blink-masked; suppressed entirely in gaze_lock "
                                    "states. Flits still run there."},
        },
        "flight": {
            "note": "Timing is a simulated runtime controller, NOT a baked curve. The "
                    "PROFILE_* Catmull-Rom tables the wiki describes no longer exist.",
            "stations": {"HOME": list(FL.HOME), "NEAR": list(FL.NEAR), "FAR": list(FL.FAR)},
            "far_apparent_scale": FL.FAR_DIST_SCALE,
            "lean_model": "theta = LEAD_ACC*accel + LEAD_SPD*speed, clamped to LEAD_MAX. "
                          "acceleration-driven, per theta=arctan(a/g). braking leans BACK.",
            "lead_acc_deg": FL.LEAD_ACC, "lead_spd_deg": FL.LEAD_SPD,
            "lead_max_deg": FL.LEAD_MAX, "yaw_max_deg": FL.YAW_MAX,
            "curve_gain": FL.CURVE_GAIN, "whip_gain": FL.WHIP_GAIN,
            "whip_lag_ms": FL.WHIP_LAG_MS, "curve_clamp": FL.CURVE_CLAMP,
            "twist_gain": FL.TWIST_GAIN,
            "stretch": FL.STRETCH, "squash_ant": FL.SQUASH_ANT,
            "squash_land": FL.SQUASH_LAND, "pivot_cruise": FL.PIVOT_CRUISE,
            "controller": {
                "cruise_upf": FL.CRUISE_UPF, "acc_frames": FL.ACC_FRAMES,
                "dec_frames": FL.DEC_FRAMES, "antic_arc": FL.ANTIC_ARC,
                "antic_frames": FL.ANTIC_FRAMES, "ref_path": FL.REF_PATH,
                "settle_eps": FL.SETTLE_EPS, "pos_eps": FL.POS_EPS,
                "smooth_taps": FL.SMOOTH_TAPS,
                "overshoot_frac": FL.OVERSHOOT_FRAC, "overshoot_max": FL.OVERSHOOT_MAX,
                "screen_mix": FL.SCREEN_MIX,
                "metric": "cumulative NDC screen distance + SCREEN_MIX * world distance. "
                          "cruise/antic/overshoot/eps are ALL in this camera-dependent "
                          "dimensionless metric -- not world units, not pixels. Re-derive "
                          "against the live camera.",
                "fixed_step": "the integrator has no dt: a_acc/a_dec are per-frame^2 and "
                              "the eps values are per-frame. Bake at a fixed 30Hz step, "
                              "then interpolate for playback. Do NOT drive from rAF.",
            },
            "lid": {"cruise": FL.LID_CRUISE, "max": FL.LID_MAX,
                    "drag_gain": FL.LID_DRAG_GAIN, "lag_ms": FL.LID_LAG_MS,
                    "landing_ceilings": [[0.880, 0.015], [0.925, 0.075], [0.965, 0.030]]},
            "loop": {"enabled": False,
                     "radius": FL.LOOP_RADIUS, "ease": FL.LOOP_EASE,
                     "disabled_note": "decke_states passes loop=False on both far legs. "
                                      "The flourish was cut: the roll threw his face "
                                      "around a 1.6u circle, the tangent swept through "
                                      "vertical where the yaw model is degenerate, and "
                                      "the circle was ~1 body height so he overlapped "
                                      "his own path.",
                     "roll_channel": "DeckE_Roll, AXIS_ANGLE. NEVER the euler channels: a "
                                     "360 turn crosses euler's gimbal singularity."},
            "durations_ms": {
                "hop": [S.HOP_OUT_MS, S.HOP_HOLD_MS, S.HOP_BACK_MS],
                "far": [S.FAR_OUT_MS, S.FAR_HOLD_MS, S.FAR_BACK_MS]},
        },
        "symbol_atlas": {
            "file": "assets/symbol_sdf_atlas.png",
            "grid": [5, 2], "pixels": [2560, 1024], "cell_px": 512,
            "encoding": "signed distance field, 0.5 = edge. RED is the primary glyph, "
                        "GREEN a second pass drawn over it. For every symbol except the "
                        "spinner R == G so the second layer is a no-op.",
            "clip_note": "in-cell clipping is REQUIRED -- without a test that the sampled "
                         "UV lies inside [0,1]^2 of the chosen cell, points outside the "
                         "glyph sample the neighbouring cell and bleed the wrong symbol.",
            "sizes": dict(S.SYMBOL_SIZE),
            "spinner_deg_per_s": S.SPINNER_DEG_PER_S,
            "spin_deg_per_s": S.SPIN_DEG_PER_S,
            "scribble_hz": S.SCRIBBLE_HZ,
            "spin_phase_deg": {"L": 0, "R": 180},
        },
        "orbit": {"radius": S.ORBIT_R, "height": S.ORBIT_Z},
        "card_stash": {"stage_ms": list(S.STASH_STAGE_MS),
                       "stagger_ms": S.STASH_STAGGER_MS,
                       "fade_ms": S.STASH_FADE_MS,
                       "gape_full": S.GAPE_FULL,
                       "note": "per-card XYZ waypoints are ABSENT from every source; "
                               "only this timing schedule survives."},
        "states": states,
        "order": list(S.PLAYBOOK),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true",
                    help="diff against the existing file instead of writing; exit 1 on drift")
    args = ap.parse_args()

    S, PR, ID, FL = load_sources(args.src)
    doc = build(S, PR, ID, FL)
    text = json.dumps(doc, indent=1, sort_keys=False) + "\n"

    out = os.path.normpath(args.out)
    nb = sum(len(s["beats"]) for s in doc["states"].values())
    summary = f"{len(doc['states'])} states, {nb} beats"

    if args.check:
        if not os.path.exists(out):
            sys.exit(f"FAIL {out} does not exist")
        with open(out, encoding="utf-8") as f:
            existing = f.read()
        if existing != text:
            sys.exit(f"FAIL {out} is stale -- rerun gen-playbook.py ({summary})")
        print(f"ok  {out} matches sources ({summary})")
        return

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {out}: {summary}")


if __name__ == "__main__":
    main()
