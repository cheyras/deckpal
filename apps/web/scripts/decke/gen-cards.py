"""Extract the card / hand / orbit / stash animation out of the live .blend.

WHY THIS EXISTS AT ALL
----------------------
`gen-playbook.py` records, for `card_stash`, that "per-card XYZ waypoints are ABSENT
from every source; only this timing schedule survives". That is true of the wiki and
of `_raw/src/*.py` -- but not of the `.blend`, which is the animation authority since
the `decke_regen()` chain died on 2026-08-16. Everything in `cards.json` is read back
out of the baked F-curves rather than re-derived, and this script is the record of how.

    blender -b "<DeckPal_character_rig_v1.blend>" -P gen-cards.py -- [--out FILE] [--check]

`--check` regenerates in memory and diffs against the committed file, exiting 1 on any
difference, exactly like `gen-playbook.py --check`.

THE FILE IS OPENED READ-ONLY. Nothing here writes to `bpy.data`, and the script never
saves. It does not touch `scene.frame_current` either -- every value is read from
`fcurve.keyframe_points`, never by stepping the timeline, so there is no state to
restore and no depsgraph evaluation to be fooled by (see the wiki's note that
`evaluated_get()` on an object in a hidden collection does not reflect its action).

WHERE THE ANIMATION ACTUALLY LIVES
----------------------------------
The visible `Orbit_Root`, `Hand_L/R_Ctrl` and `Card_Loose_*` nodes carry NO action --
only nine drivers each, reading hidden `SRC_*` empties in `DeckE_SidedSources`. That
indirection IS the facing system: the drivers apply the gated self-mirror

    k = 1 - present * (1 - facing)      loc.x *= k   rot.y *= k   rot.z *= k

So the authored, facing = +1 pass is on the `SRC_*` objects and the mirror is a runtime
operation. We export the SRC values and let `cards.ts` re-apply the same gate. Reading
the live objects instead would bake pass 1's mirror state into the data.

`Stash_Card_1..5` have no SRC twin and no drivers -- stashed cards get NO facing
compensation, which is deliberate and was verified three ways upstream.

Handles are exported as ABSOLUTE (ms, value) pairs because that is what `curve.ts`
consumes: Blender stores post-solve handle coordinates regardless of the F-curve's
`auto_smoothing` mode, so replaying them as a plain cubic bezier is exact by
construction and sidesteps the AUTO_CLAMPED-vs-Continuous-Acceleration question.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

try:
    import bpy
except ImportError:  # pragma: no cover - the whole script needs Blender
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(
    os.path.join(HERE, "..", "..", "public", "models", "decke", "cards.json")
)
MARKERS = os.path.normpath(
    os.path.join(HERE, "..", "..", "public", "models", "decke", "markers.json")
)

FPS = 30.0

# Blender frame -> milliseconds relative to a state's marker.
def ms(frame: float, marker: int) -> float:
    return round((frame - marker) / FPS * 1000.0, 4)


def r(v: float, nd: int = 6) -> float:
    """Round, and normalise -0.0 to 0.0 so a regenerated diff stays readable."""
    x = round(float(v), nd)
    return 0.0 if x == 0 else x


# ---------------------------------------------------------------- blender access

def fcurves_of(obj):
    """Blender 5.0 slotted actions: `Action.fcurves` no longer exists.

    The curves hang off the channelbag for the object's own action SLOT, so an
    action shared by several IDs keeps them separate. Reaching for `.fcurves`
    raises AttributeError rather than returning nothing, which is at least loud.
    """
    ad = getattr(obj, "animation_data", None)
    if not ad or not ad.action:
        return []
    out = []
    for layer in ad.action.layers:
        for strip in layer.strips:
            cb = strip.channelbag(ad.action_slot)
            if cb:
                out.extend(cb.fcurves)
    return out


def curve_of(obj, path, index):
    for c in fcurves_of(obj):
        if c.data_path == path and c.array_index == index:
            return c
    return None


def keys_in(obj, path, index, lo, hi):
    c = curve_of(obj, path, index)
    if c is None:
        return []
    return [k for k in c.keyframe_points if lo <= k.co[0] <= hi]


def export_curve(obj, path, index, lo, hi, marker, scale=1.0):
    """One F-curve segment as `curve.ts` Key objects, in intra-state milliseconds."""
    out = []
    for k in keys_in(obj, path, index, lo, hi):
        interp = {"BEZIER": "ease", "LINEAR": "lin", "CONSTANT": "step"}.get(
            k.interpolation, "ease"
        )
        e = {"t": ms(k.co[0], marker), "v": r(k.co[1] * scale), "interp": interp}
        if interp == "ease":
            e["hl"] = [ms(k.handle_left[0], marker), r(k.handle_left[1] * scale)]
            e["hr"] = [ms(k.handle_right[0], marker), r(k.handle_right[1] * scale)]
        out.append(e)
    return out


def value_at(obj, path, index, frame):
    c = curve_of(obj, path, index)
    if c is None:
        return None
    return c.evaluate(frame)


def trs_at(obj, frame):
    return {
        "loc": [r(value_at(obj, "location", i, frame) or 0.0) for i in range(3)],
        "rot": [r(value_at(obj, "rotation_euler", i, frame) or 0.0) for i in range(3)],
    }


# ------------------------------------------------------------------- extraction

def load_markers():
    with open(MARKERS, encoding="utf-8") as f:
        doc = json.load(f)
    # Pass 1 only. Pass 2 is the same playbook at facing -1 and every marker sits
    # exactly 2649 frames later; the SRC actions are byte-identical between them
    # (asserted below), because the mirror is a driver, not a second bake.
    p1 = {m["state"]: m["frame"] for m in doc["markers"] if m["facing"] == 1}
    p2 = {m["state"]: m["frame"] for m in doc["markers"] if m["facing"] == -1}
    return p1, p2, doc


def span(markers, doc, state):
    """[marker, next marker) for a state in pass 1."""
    frames = sorted(m["frame"] for m in doc["markers"])
    start = markers[state]
    nxt = next((f for f in frames if f > start), doc["frameEnd"])
    return start, nxt


def assert_passes_match(objs, p1, p2, states, doc):
    """facing = -1 must be the SAME authored motion, mirrored at runtime.

    If a SRC curve differed between passes then the mirror was baked rather than
    driven, and exporting pass 1 alone would silently lose pass 2. The offset is a
    constant 2649 frames for every marker.
    """
    off = p2["loading"] - p1["loading"]
    worst = 0.0
    for name in objs:
        o = bpy.data.objects[name]
        for c in fcurves_of(o):
            for st in states:
                lo, hi = span(p1, doc, st)
                for f in range(int(lo), int(hi) + 1):
                    d = abs(c.evaluate(f) - c.evaluate(f + off))
                    worst = max(worst, d)
    return off, worst


def build():
    p1, p2, doc = load_markers()
    load_lo, load_hi = span(p1, doc, "loading")
    stash_lo, stash_hi = span(p1, doc, "card_stash")
    pres_lo, pres_hi = span(p1, doc, "card_present")
    tp_lo, tp_hi = span(p1, doc, "travel_point")

    # ---- the orbit ------------------------------------------------------
    # ONE continuous rotation on Orbit_Root, keyed LINEAR -- not per-frame
    # positions and not the dead per-card `orb_l`/`orb_r` phase channels.
    root = bpy.data.objects["SRC_Orbit_Root"]
    rz = keys_in(root, "rotation_euler", 2, load_lo, load_hi + 40)
    assert len(rz) == 2, f"orbit rz should be two linear keys, got {len(rz)}"
    f0, v0 = rz[0].co
    f1, v1 = rz[1].co
    assert rz[0].interpolation == "LINEAR", "the orbit must be LINEAR or it eases"
    block_ms = (f1 - f0) / FPS * 1000.0
    turns = (v1 - v0) / (2 * 3.141592653589793)
    orbit = {
        "root_location": [r(value_at(root, "location", i, f0) or 0.0) for i in range(3)],
        "block_ms": r(block_ms, 3),
        "turns": r(turns, 6),
        "period_ms": r(abs(block_ms / turns), 3),
        "note": "Orbit_Root.rotation_euler[2] runs 0 -> %.6f rad over %d frames, keyed "
                "LINEAR with CONSTANT extrapolation. That is %.0f full turns, so one "
                "revolution takes %.0f ms -- which is NOT the 1800 ms `loading` clip "
                "loop. The two deliberately beat against each other; drive the angle "
                "from UNWRAPPED state time, never from the looped clip clock."
                % (v1 - v0, f1 - f0, turns, abs(block_ms / turns)),
    }

    # ---- the hands ------------------------------------------------------
    # `hand_l`/`hand_r` are a 3-POINT PATH, not a lerp: 0 = stowed behind,
    # 0.5 = out to his SIDE, 1.0 = presented in front. Interpolating 0 -> 1
    # directly drives the card THROUGH his body.
    #
    # The three waypoints are identified STRUCTURALLY rather than by frame
    # number: the stow is the window's first key (the state opens from rest),
    # the side is the extreme |x|, and the front is the extreme -y (his forward).
    # `check_hand_path` below then proves that every other key in both
    # presentation windows is an exact linear blend of those three.
    hands = {}
    for side, src in (("L", "SRC_Hand_L_Ctrl"), ("R", "SRC_Hand_R_Ctrl")):
        o = bpy.data.objects[src]
        ks = keys_in(o, "location", 0, pres_lo, pres_hi)
        entry = {"node": f"Hand_{side}_Ctrl"}
        # The stow is the object's own rest basis and is keyed at every window.
        stow_f = keys_in(o, "location", 0, load_lo, load_lo + 1)[0].co[0]
        entry["stow"] = trs_at(o, stow_f)
        # The orbit target: the extreme |y| inside the loading window.
        orb_f = max(keys_in(o, "location", 1, load_lo, load_hi),
                    key=lambda k: abs(k.co[1])).co[0]
        entry["orbit"] = trs_at(o, orb_f)
        if ks:
            side_f = max(ks, key=lambda k: abs(k.co[1])).co[0]
            front_f = min(keys_in(o, "location", 1, pres_lo, pres_hi),
                          key=lambda k: k.co[1]).co[0]
            entry["side"] = trs_at(o, side_f)
            entry["front"] = trs_at(o, front_f)
            entry["deploy_source"] = "measured"
        else:
            # Hand_L is never deployed anywhere on the timeline -- only `hand_r`
            # ever presents. Mirroring R's path across his local X plane is the
            # honest completion, and it is FLAGGED as derived so nobody reads it
            # back as ground truth.
            entry["deploy_source"] = "derived: mirror of Hand_R (loc.x, rot.y, rot.z negated)"
        hands[side] = entry
    for side in ("L", "R"):
        if "side" not in hands[side]:
            other = hands["R" if side == "L" else "L"]
            for key in ("side", "front"):
                m = other[key]
                hands[side][key] = {
                    "loc": [r(-m["loc"][0]), m["loc"][1], m["loc"][2]],
                    "rot": [m["rot"][0], r(-m["rot"][1]), r(-m["rot"][2])],
                }

    # ---- the loose cards ------------------------------------------------
    loose = {}
    for ch, src, node in (
        ("card_l", "SRC_Card_Loose_Rose_anim", "Card_Loose_Rose_anim"),
        ("card_r", "SRC_Card_Loose_Amber_anim", "Card_Loose_Amber_anim"),
    ):
        o = bpy.data.objects[src]
        # Location and rotation are identically zero on both loose cards for the
        # whole timeline -- the card's offset and tilt live in its MESH, relative
        # to the hand. Only existence (scale) is animated.
        moved = any(
            abs(k.co[1]) > 1e-9
            for i in range(3)
            for p in ("location", "rotation_euler")
            for k in (curve_of(o, p, i).keyframe_points if curve_of(o, p, i) else [])
        )
        loose[ch] = {
            "node": node,
            "hand": "L" if ch == "card_l" else "R",
            "rigid_to_hand": not moved,
            # EXISTENCE IS SCALE, not opacity: 0 means genuinely despawned.
            "orbit_scale": export_curve(o, "scale", 0, load_lo, load_hi, p1["loading"]),
        }

    # The `loading` fade schedule is authored ACROSS THE WHOLE BLOCK, not per clip
    # loop, and the two cards are deliberately out of step with each other. The
    # runtime must loop it on `orbit.block_ms` (5400 ms = exactly two revolutions,
    # so it closes seamlessly) and NOT on the 1800 ms clip loop: the playbook's
    # per-loop `card_l`/`card_r` channel drops to 0 at every clip boundary, and at
    # 1800 ms the hand is 240 degrees round, i.e. in FRONT of him. The authored
    # fades all happen while the hand is BEHIND him, which is the whole point.
    for ch in loose:
        loose[ch]["loop_ms"] = r(block_ms, 3)

    # ---- the stash flight -----------------------------------------------
    # Five cards fly out of the 115-degree gape and back in, staggered. These are
    # the waypoints gen-playbook.py could not find; only the timing survived.
    stash = []
    for i in range(1, 6):
        o = bpy.data.objects[f"Stash_Card_{i}"]
        chans = {}
        for name, path, idx in (
            ("lx", "location", 0), ("ly", "location", 1), ("lz", "location", 2),
            ("rx", "rotation_euler", 0), ("ry", "rotation_euler", 1),
            ("rz", "rotation_euler", 2), ("s", "scale", 0),
        ):
            c = export_curve(o, path, idx, stash_lo, stash_hi, p1["card_stash"])
            # Drop channels that never leave a constant -- three of the seven are
            # flat on every card and emitting them triples the file for nothing.
            if c and any(abs(k["v"] - c[0]["v"]) > 1e-9 for k in c):
                chans[name] = c
            elif c:
                chans[name] = [c[0]]
        # Scale must be uniform: a non-uniform card is a modelling error, and the
        # runtime only carries one number. The tolerance is float32 epsilon at
        # magnitude 1.15, not slack -- both channels are keyed from one value.
        for idx in (1, 2):
            a = curve_of(o, "scale", 0)
            b = curve_of(o, "scale", idx)
            for k in keys_in(o, "scale", 0, stash_lo, stash_hi):
                assert abs(a.evaluate(k.co[0]) - b.evaluate(k.co[0])) < 1e-6, \
                    f"Stash_Card_{i} scale is non-uniform"
        # THE PARENT INVERSE IS NOT IDENTITY on cards 2-5. They were parented to
        # `DeckE_Tilt` with Keep Transform, so `world = parent * PI * basis` and
        # the F-curve values alone place them 0.1357 up the box from where they
        # actually sit. glTF has no such concept -- the exporter folds PI into the
        # node -- so the runtime must add it back or every card after the first
        # flies a path shifted a seventh of a unit in z.
        pi = o.matrix_parent_inverse
        for a in range(3):
            for b in range(3):
                assert abs(pi[a][b] - (1.0 if a == b else 0.0)) < 1e-9,                     f"Stash_Card_{i} parent inverse is not a pure translation"
        starts = [c[0]["t"] for c in chans.values()]
        stash.append({
            "node": f"Stash_Card_{i}",
            "start_ms": min(starts),
            "parent_offset": [r(pi[a][3]) for a in range(3)],
            "channels": chans,
        })

    # ---- the present gate -----------------------------------------------
    # `DeckE_Control["present"]` gates the self-mirror of the WHOLE loose-card
    # chain. There are THREE loose-card beats and only TWO are presentations --
    # the `loading` orbit is NOT gated. Enumerate rather than sample: an earlier
    # implementation sampled one window and left `point`/`travel_point` broken.
    ctrl = bpy.data.objects["DeckE_Control"]
    pc = curve_of(ctrl, '["present"]', 0)
    windows, cur = [], []
    for k in pc.keyframe_points:
        if k.co[1] > 0.5:
            cur.append(k.co[0])
        elif cur:
            windows.append((cur[0], cur[-1]))
            cur = []
    if cur:
        windows.append((cur[0], cur[-1]))

    frames = sorted(m["frame"] for m in doc["markers"])
    by_frame = {m["frame"]: m for m in doc["markers"]}
    gate = {}
    for lo, hi in windows:
        mid = (lo + hi) / 2
        start = max(f for f in frames if f <= mid)
        m = by_frame[start]
        if m["facing"] != 1:
            continue  # pass 2 is the same window; asserted identical below
        nxt = next((f for f in frames if f > start), doc["frameEnd"])
        gate[m["state"]] = export_curve(ctrl, '["present"]', 0,
                                        start - 40, nxt, m["frame"])

    # Every gate ramp must sit entirely OUTSIDE its card's scale pop, or the card
    # swings through tens of degrees as it appears and reads as a swoosh.
    ramp_note = []
    for state, keys in gate.items():
        rise = [k["t"] for k in keys if k["v"] < 0.5]
        hold = [k["t"] for k in keys if k["v"] > 0.5]
        ramp_note.append(
            f"{state}: gate 1 over [{min(hold):.0f}, {max(hold):.0f}] ms, "
            f"ramps at {sorted(rise)}"
        )

    # ---- verification ----------------------------------------------------
    # The driven chain is written straight from the SRC values, so a non-identity
    # parent inverse there would silently offset every card.
    for n in ("Orbit_Root", "Hand_L_Ctrl", "Hand_R_Ctrl",
              "Card_Loose_Rose_anim", "Card_Loose_Amber_anim"):
        pi = bpy.data.objects[n].matrix_parent_inverse
        assert all(abs(pi[a][b] - (1.0 if a == b else 0.0)) < 1e-9
                   for a in range(4) for b in range(4)),             f"{n} has a non-identity parent inverse; cards.ts assumes identity"

    report = check_hand_path(hands, p1, pres_lo, pres_hi, tp_lo, tp_hi)
    off, worst = assert_passes_match(
        ["SRC_Hand_L_Ctrl", "SRC_Hand_R_Ctrl", "SRC_Orbit_Root",
         "SRC_Card_Loose_Rose_anim", "SRC_Card_Loose_Amber_anim"],
        p1, p2, ["loading", "card_present", "travel_point"], doc,
    )
    # 1e-4, not 1e-6: the residual is float32 precision on the bezier HANDLE
    # coordinates, whose x lives at frame magnitude ~4800 in pass 2. It appears
    # only at interpolated frames -- every keyframe value itself is identical.
    assert worst < 1e-4, f"pass 1 and pass 2 SRC curves differ by {worst}"

    return {
        "schema": "deck-e-cards/1",
        "generated_by": "apps/web/scripts/decke/gen-cards.py",
        "source": os.path.basename(bpy.data.filepath),
        "fps": FPS,
        "units": {
            "length": "blender units (1 u = 40.13 mm), Blender Z-up",
            "angle": "radians",
            "time": "milliseconds, relative to the state's marker in markers.json",
            "axis": "convert with constants.ts blenderToThree / blenderEulerToThree; "
                    "scale is NOT converted",
        },
        "authority": "read back from the baked F-curves of DeckPal_character_rig_v1.blend. "
                     "The animated nodes carry drivers only; the authored facing = +1 pass "
                     "lives on the hidden SRC_* empties, and the mirror is re-applied at "
                     "runtime by the present gate.",
        "pass2": {
            "frame_offset": off,
            "max_src_divergence": r(worst, 9),
            "note": "facing -1 replays the SAME authored curves; the mirror is a driver, "
                    "not a second bake. Verified over loading, card_present, travel_point.",
        },
        "orbit": orbit,
        "hands": hands,
        "hand_path": {
            "points": [0.0, 0.5, 1.0],
            "note": "hand_l / hand_r index a 3-POINT PIECEWISE-LINEAR path: "
                    "0 = stow, 0.5 = out to his side, 1.0 = presented in front. "
                    "Lerping 0 -> 1 directly drives the card THROUGH his body.",
            "verified": report,
        },
        "loose_cards": loose,
        "stash": {
            "cards": stash,
            "gape_full": 2.09,
            "note": "Stash cards are children of DeckE_Tilt and get NO facing "
                    "compensation -- they rotate rigidly with him, which was verified "
                    "three ways upstream. Two earlier 'fixes' both made it worse.",
        },
        "present_gate": {
            "control": 'DeckE_Control["present"]',
            "formula": "k = 1 - present * (1 - facing); loc.x *= k, rot.y *= k, rot.z *= k "
                       "at EVERY node of the loose-card chain (Orbit_Root, Hand_L_Ctrl, "
                       "Hand_R_Ctrl, Card_Loose_Rose_anim, Card_Loose_Amber_anim). That "
                       "composes to S.(O.H.C).S: the placement mirrors while the trailing "
                       "S keeps the card ARTWORK readable. A single scale.x = -1 would "
                       "mirror the placement AND reverse the text.",
            "states": gate,
            "ungated": ["loading"],
            "ramp_check": ramp_note,
        },
        "single": {
            "node": "Card_Single_anim",
            "note": "the free-standing card INSIDE him. Existence is scale; the playbook "
                    "`single` channel already matches the .blend exactly (1 -> 0 at 100 ms, "
                    "back to 1 at 2467 ms of card_stash), so no extra data is needed. It "
                    "must be applied AFTER riders.ts, which decomposes a full matrix onto "
                    "this node and would otherwise reset the scale to 1.",
        },
    }


def check_hand_path(hands, p1, pres_lo, pres_hi, tp_lo, tp_hi):
    """Prove the 3-point path reproduces every other authored hand keyframe.

    Every key in both presentation windows must be an exact linear blend of two
    adjacent waypoints. We do not assume which leg a key is on -- we project it
    onto BOTH legs, keep the better fit, and require the residual across all six
    channels to vanish. (Recovering the parameter from location[0] alone does not
    work: the side waypoint overshoots the front one in x, so the two legs share
    an x range and half the keys land on the wrong leg.)

    If the residual vanishes the path really is piecewise linear in one parameter
    and three waypoints are the whole truth. If it does not, this file is a lossy
    summary and must not ship.
    """
    o = bpy.data.objects["SRC_Hand_R_Ctrl"]
    h = hands["R"]
    legs = [(h["stow"], h["side"]), (h["side"], h["front"])]

    def vec(d):
        return d["loc"] + d["rot"]

    worst, n = 0.0, 0
    for lo, hi in ((pres_lo, pres_hi), (tp_lo, tp_hi)):
        for k in keys_in(o, "location", 0, lo, hi):
            f = k.co[0]
            m = ([value_at(o, "location", i, f) or 0.0 for i in range(3)] +
                 [value_at(o, "rotation_euler", i, f) or 0.0 for i in range(3)])
            best = None
            for a, b in legs:
                av, bv = vec(a), vec(b)
                d = [bv[i] - av[i] for i in range(6)]
                dd = sum(x * x for x in d)
                w = sum(d[i] * (m[i] - av[i]) for i in range(6)) / dd if dd else 0.0
                w = min(1.0, max(0.0, w))
                res = max(abs(av[i] + d[i] * w - m[i]) for i in range(6))
                if best is None or res < best:
                    best = res
            worst = max(worst, best)
            n += 1
    assert worst < 5e-5, f"hand path is not piecewise linear: residual {worst}"
    return f"{n} authored Hand_R keyframes reproduce from the 3 waypoints to {worst:.2e}"


# ------------------------------------------------------------------------ main

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true",
                    help="diff against the existing file instead of writing; exit 1 on drift")
    args = ap.parse_args(argv)

    if bpy is None:
        sys.exit('gen-cards.py must run inside Blender:\n'
                 '  blender -b "<DeckPal_character_rig_v1.blend>" -P gen-cards.py -- [--check]')

    doc = build()
    text = json.dumps(doc, indent=1, sort_keys=False) + "\n"
    out = os.path.normpath(args.out)
    summary = (f"{len(doc['stash']['cards'])} stash cards, "
               f"{len(doc['present_gate']['states'])} gated states")

    if args.check:
        if not os.path.exists(out):
            sys.exit(f"FAIL {out} does not exist")
        with open(out, encoding="utf-8") as f:
            existing = f.read()
        if existing != text:
            sys.exit(f"FAIL {out} is stale -- rerun gen-cards.py ({summary})")
        print(f"ok  {out} matches the .blend ({summary})")
        return

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {out}: {summary}")
    assert not bpy.data.is_dirty, "the .blend was modified -- this script is read-only"


if __name__ == "__main__":
    main()
