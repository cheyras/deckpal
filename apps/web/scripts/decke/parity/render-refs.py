"""Render the Blender reference frames the parity harness compares against.

Run INSIDE Blender, with `DeckPal_character_rig_v1.blend` open — either through
the Blender MCP or:

    blender -b "$BLEND" -P apps/web/scripts/decke/parity/render-refs.py -- --out <dir>

The renders are NOT committed. They are 15 MB of derived data and the `.blend`
is the authority for all of it, so this script is the artefact and the PNGs are
disposable. Regenerate them into `apps/web/scripts/decke/parity/ref/` and
`.../seq/` before running the sweeps.

WHAT IT TOUCHES, AND WHY THAT MATTERS: this writes `render.filepath` and
`scene.frame_current` and restores both in a `finally`. It must never save the
file. The blend is a live working document that the person who authored this
character has open, and a parity harness has no business modifying it.
"""
import os
import sys

import bpy

# --- the 14 single-frame states -------------------------------------------
# The first eight were chosen for expression coverage; the last six were added
# to cover states that had no reference at all, plus the two with the worst
# measured brow residual (`confused`, `travel_far`).
STILLS = [
    ("rest", 1),
    ("boot_pop", 35),
    ("thinking", 153),
    ("happy_peak", 298),
    ("sad_hold", 410),
    ("confused", 479),
    ("curious_hold", 716),
    ("alert_star", 1052),
    ("loading", 1608),
    ("card_stash_gape", 1834),
    ("card_present", 1994),
    ("point", 2085),
    ("travel_far", 2272),
    ("sleep", 2507),
]

# --- the 3 frame-by-frame clips -------------------------------------------
# A pose error shows up in a still; a TIMING error does not. These three are the
# most timing-sensitive clips in the playbook: a spin, a fast head shake, and the
# mouth cycling. `alert_dizzy` is the sharpest instrument of the three — any
# phase error in a rotation is immediately visible.
SEQUENCES = {
    "nod_yes": [826, 833, 840, 847, 854, 861],
    "alert_dizzy": [1369, 1379, 1389, 1399, 1409, 1419],
    "talk": [210, 218, 226, 234, 242, 250],
}


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_root = os.path.dirname(os.path.abspath(__file__))
    if "--out" in argv:
        out_root = argv[argv.index("--out") + 1]

    scn = bpy.context.scene
    r = scn.render
    saved_filepath = r.filepath
    saved_frame = scn.frame_current

    ref_dir = os.path.join(out_root, "ref")
    seq_dir = os.path.join(out_root, "seq")
    os.makedirs(ref_dir, exist_ok=True)
    os.makedirs(seq_dir, exist_ok=True)

    n = 0
    try:
        for tag, frame in STILLS:
            scn.frame_set(frame)
            r.filepath = os.path.join(ref_dir, "%s_%04d.png" % (tag, frame))
            bpy.ops.render.render(write_still=True)
            n += 1
        for tag, frames in SEQUENCES.items():
            for frame in frames:
                scn.frame_set(frame)
                r.filepath = os.path.join(seq_dir, "%s_%04d.png" % (tag, frame))
                bpy.ops.render.render(write_still=True)
                n += 1
    finally:
        r.filepath = saved_filepath
        scn.frame_set(saved_frame)

    print("rendered %d frames" % n)
    print("engine=%s res=%dx%d view_transform=%s"
          % (r.engine, r.resolution_x, r.resolution_y, scn.view_settings.view_transform))
    # The harness assumes 720x720 AgX. If either changes, every stored number in
    # PARITY.md is measured against a different instrument.
    assert (r.resolution_x, r.resolution_y) == (720, 720), "harness expects 720x720"
    assert scn.view_settings.view_transform == "AgX", "harness expects AgX"
    assert not bpy.data.is_dirty, "the .blend must not be left modified"


if __name__ == "__main__":
    main()
