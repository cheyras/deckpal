"""Score a video replay against hand-made ground truth.

    python scripts/scan-bench/video/score_video.py [--run <dir name>] [videoId ...]

For each video with ground truth (video-bench/gt/<id>.json) and a replay
(video-bench/<run>/<id>/captures.jsonl, or video-bench/<id>/ for the default
run), every fired capture is identified with the identity matcher (production
pairing: int8 query x fp32 gallery, the model's own gate) and matched to the
ground-truth appearance it falls in by time.

Per video and overall:
  capture recall   capturable appearances with >= 1 capture
  auto-ID recall   capturable appearances with a capture named CONFIDENTLY and RIGHT
  duplicates       extra captures inside one appearance
  stray captures   captures outside every appearance (packs, code cards, end screens)
  confident wrong  captures named confidently as the wrong card (the number to keep at 0)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import embed as E  # noqa: E402

VB = Path.home() / "deckpal-data" / "video-bench"
EXP = Path.home() / "deckpal-data" / "scan-embed" / "export" / "deckpal-card-b32-v1"
GATE = (0.65, 0.03)
WIDE = (0.45, 0.12)  # confidence.ts THRESHOLDS['deckpal-card-b32-v1'].wide (PR #288)
LAG_S = 0.6   # a capture may land a little after the card's last fully-shown frame
LEAD_S = 0.25


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="*")
    ap.add_argument("--run", default="", help="sub-directory of video-bench holding the replay (default: the top level)")
    ap.add_argument("--no-wide", action="store_true", help="score with the main gate tier only")
    ap.add_argument("--show-wrong", action="store_true", help="list each confident-wrong capture with the appearances around it")
    a = ap.parse_args()
    gts = {p.stem: json.loads(p.read_text(encoding="utf8")) for p in (VB / "gt").glob("*.json")}
    vids = a.videos or sorted(gts)
    root = VB / a.run if a.run else VB
    g = np.load(E.BENCH / "embed" / "deckpal-card-b32-v1.fp32" / "gallery.npz")
    gids, gv = g["ids"], g["vecs"]
    emb = E.Embedder("x", str(EXP / "deckpal-card-b32-v1.int8.onnx"))
    tot = dict(cap=0, capt=0, auto=0, dup=0, stray=0, wrong=0, captures=0)
    rows_out = []
    for vid in vids:
        cj = root / vid / "captures.jsonl"
        if vid not in gts or not cj.exists():
            continue
        gt = gts[vid]
        caps = [json.loads(l) for l in cj.read_text(encoding="utf8").splitlines() if l.strip()]
        caps = [c for c in caps if not c.get("suppressed")]
        if caps:
            # one at a time: dynamic int8 quantizes per batch, production embeds one capture
            V = np.concatenate([emb(E.preprocess(root / vid / c["file"], E.CAPTURE_MARGIN)[None]) for c in caps])
            S = V @ gv.T
            o = np.argsort(-S, 1)[:, :2]
            for k, c in enumerate(caps):
                s0, s1 = float(S[k, o[k, 0]]), float(S[k, o[k, 1]])
                c["pred"] = str(gids[o[k, 0]])
                c["confident"] = (s0 >= GATE[0] and s0 - s1 >= GATE[1]) or (not a.no_wide and s0 >= WIDE[0] and s0 - s1 >= WIDE[1])
                c["sim"] = round(s0, 3)
        apps = gt["appearances"]
        hits = {i: [] for i in range(len(apps))}
        stray = []
        for c in caps:
            idx = [i for i, ap_ in enumerate(apps) if ap_["start"] - LEAD_S <= c["t"] <= ap_["end"] + LAG_S]
            if not idx:
                stray.append(c)
                continue
            # The card being shown: one the capture was identified AS if its window
            # holds the capture (the slack windows overlap at a fast flip, so the
            # next card's first frames sit in the previous card's lag), else one
            # whose own window holds it, else the nearest.
            ok_of = lambda i: set(([apps[i]["cardId"]] if apps[i].get("cardId") else []) + (apps[i].get("candidates") or []))
            named = [i for i in idx if c.get("pred") in ok_of(i)]
            inside = [i for i in idx if apps[i]["start"] <= c["t"] <= apps[i]["end"]]
            pool = named or inside or idx
            i = min(pool, key=lambda i: abs((apps[i]["start"] + apps[i]["end"]) / 2 - c["t"]))
            hits[i].append(c)
        v = dict(cap=0, capt=0, auto=0, dup=0, stray=len(stray), wrong=0, captures=len(caps))
        for i, ap_ in enumerate(apps):
            ok_ids = set(([ap_["cardId"]] if ap_.get("cardId") else []) + (ap_.get("candidates") or []))
            hs = hits[i]
            if ap_.get("capturable"):
                v["cap"] += 1
                if hs:
                    v["capt"] += 1
                if any(h.get("confident") and h["pred"] in ok_ids for h in hs):
                    v["auto"] += 1
            v["dup"] += max(0, len(hs) - 1)
            bad = [h for h in hs if h.get("confident") and ok_ids and h["pred"] not in ok_ids]
            v["wrong"] += len(bad)
            if a.show_wrong:
                near = {x.get("cardId") or "/".join(x.get("candidates") or []) for x in apps if abs(x["start"] - ap_["start"]) < 4}
                for h in bad:
                    print(f"  WRONG {vid} t={h['t']} {h['file']} pred {h['pred']} sim {h['sim']} | scored against {sorted(ok_ids)} "
                          f"[{ap_['start']}-{ap_['end']}] | pred among nearby cards: {h['pred'] in near}")
        v["wrong"] += sum(1 for c in stray if c.get("confident"))
        for k in tot:
            tot[k] += v[k]
        rows_out.append((vid, v))
        print(f"{vid:13s} capturable {v['cap']:3d} | captured {v['capt']:3d} ({v['capt'] / max(1, v['cap']):.0%}) "
              f"| auto-ID {v['auto']:3d} ({v['auto'] / max(1, v['cap']):.0%}) | captures {v['captures']:3d} "
              f"dup {v['dup']:2d} stray {v['stray']:2d} | confident-wrong {v['wrong']}")
    print(f"{'ALL':13s} capturable {tot['cap']:3d} | captured {tot['capt']:3d} ({tot['capt'] / max(1, tot['cap']):.0%}) "
          f"| auto-ID {tot['auto']:3d} ({tot['auto'] / max(1, tot['cap']):.0%}) | captures {tot['captures']:3d} "
          f"dup {tot['dup']:2d} stray {tot['stray']:2d} | confident-wrong {tot['wrong']}")


if __name__ == "__main__":
    main()
