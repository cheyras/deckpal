"""Phase-0b session 2 as a labeller-format corpus, so every test exercises the
SAME manifest code path the owner's corpus will.

    python fixtures.py            # (re)build cache/session2/{manifest.jsonl, raw/*.png}

Session 2 is 87 probe-flag frames from 2026-09-02: 480x640 camera frames
collected under pipeline v2, with
  gt.json      19 hand-labelled card quads, in FRAME px (F000.. naming)
  triage.json  a scene class per frame: card (58) / none (26) / card2 (3)

This converts each usable frame to what harvest.mjs writes for a pipeline-v3
label: the stream's CENTRE SQUARE (frame.ts squareCrop, via preprocess.py)
resampled to the 416 canonical PNG, corners as canonical FRACTIONS
(frame.ts streamQuadToCanonical / 416). Frame naming and ordering follow
offline-harness.ts listFlagFrames exactly (probe-flag rows sorted by elapsed),
so F024 here is F024 there.

  positives: the 19 frames with a gt.json quad  -> verdict 'face-unknown(v1)'
             (session 2 never recorded front/back)
  negatives: the 26 scene == 'none' frames      -> verdict 'negative', no_card
  skipped:   39 'card' frames with no hand label (an unlabelled card is not a
             negative) and the 3 'card2' frames (two cards: no single truth)

One honest wrinkle: a 480x640 frame's centre square is rows 80..560, and 7 of
the 19 cards reach past it, so a corner or two sits outside [0,1] (worst: F059
at 1.104). The live product rarely produces such a frame -- the user aims
inside the square they can see (index.ts DEFAULT_LOCK_ASPECT_TOL notes the same
clipping). All 7 stay inside the labeller's own drag clamp [-0.15, 1.15], so
they are kept, exactly as a corpus row with a corner just off-frame would be;
anything past the clamp would be dropped by dataset.py's validation.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import preprocess as P
from common import CACHE, SESSION2

NOT_A_FRAME = {"list.json", "features.json", "triage.json", "gt.json", "gt_scores.json", "offline.json"}


def list_flag_frames(session2: Path = SESSION2) -> list[dict]:
    """offline-harness.ts listFlagFrames, plus the triage scene."""
    gt = json.loads((session2 / "gt.json").read_text())
    triage = json.loads((session2 / "triage.json").read_text())["flags"]
    metas = []
    for f in sorted(os.listdir(session2)):
        if not f.endswith(".json") or f in NOT_A_FRAME:
            continue
        m = json.loads((session2 / f).read_text())
        if not isinstance(m, dict) or m.get("type") != "probe-flag":
            continue
        metas.append((f[:-5], m))
    metas.sort(key=lambda im: im[1]["elapsed"])  # stable, like Array.prototype.sort
    out = []
    for i, (fid, m) in enumerate(metas):
        name = f"F{i:03d}"
        g = gt.get(name)
        out.append(
            {
                "id": fid,
                "name": name,
                "elapsed": m["elapsed"],
                "width": m["dims"]["width"],
                "height": m["dims"]["height"],
                "png": session2 / f"{fid}.png",
                "liveHasObj": (m.get("telemetry") or {}).get("hasObj", 0.0),
                "gt": [[float(p[0]), float(p[1])] for p in g] if g else None,
                "scene": (triage.get(name) or [None])[0],
                "triage": triage.get(name),
            }
        )
    return out


def poly_area(q) -> float:
    a = 0.0
    for i in range(4):
        x1, y1 = q[i]
        x2, y2 = q[(i + 1) % 4]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def build_session2(out: Path = CACHE / "session2", resampler: str = "area", session2: Path = SESSION2) -> Path:
    from dataset import assign_dup_groups  # local import: dataset imports torch

    if out.exists():
        shutil.rmtree(out)
    (out / "raw").mkdir(parents=True)
    rows = []
    for f in list_flag_frames(session2):
        if f["gt"] is not None:
            verdict, reason = "face-unknown(v1)", None
        elif f["scene"] == "none":
            verdict, reason = "negative", "no_card"
        else:
            continue
        rgba = P.load_rgba(f["png"])
        assert rgba.shape[1] == f["width"] and rgba.shape[0] == f["height"], f["name"]
        canon, crop = P.canonical_frame(rgba, resampler)
        rid = int(f["id"])
        P.save_rgba(out / "raw" / f"{rid}.png", canon)
        corners = None
        fill = None
        if f["gt"] is not None:
            cq = P.stream_quad_to_canonical(f["gt"], crop)
            corners = [[x / P.CANONICAL_SIZE, y / P.CANONICAL_SIZE] for x, y in cq]
            fill = poly_area(corners)
        rows.append(
            {
                "id": rid,
                "png": f"raw/{rid}.png",
                "day": datetime.fromtimestamp(rid / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
                "schema": None,
                "source": "camera",
                "verdict": verdict,
                "reason": reason,
                "corners": corners,
                "topLeftIndex": None,
                "fill": fill,
                "seededFrom": None,
                "seedFallback": None,
                "hasObj": f["liveHasObj"],
                "stream": {"width": f["width"], "height": f["height"]},
                "mirrorPadded": False,
                # fixture-only provenance, ignored by the loader
                "fixture": "phase0b-session2",
                "name": f["name"],
                "crop": crop,
            }
        )
    assign_dup_groups(rows, out)
    with open(out / "manifest.jsonl", "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=CACHE / "session2")
    ap.add_argument("--resampler", default="area", choices=P.RESAMPLERS)
    a = ap.parse_args()
    out = build_session2(a.out, a.resampler)
    rows = [json.loads(l) for l in open(out / "manifest.jsonl")]
    pos = [r for r in rows if r["corners"]]
    outside = [r["name"] for r in pos if any(not (-0.15 <= v <= 1.15) for p in r["corners"] for v in p)]
    print(f"session2 -> {out}: {len(rows)} rows, {len(pos)} positives, {len(rows) - len(pos)} negatives")
    print(f"  positives with a corner past the [-0.15,1.15] clamp (dropped at load): {outside or 'none'}")
    print(f"  dupGroups: {len(set(r['dupGroup'] for r in rows))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
