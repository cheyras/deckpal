"""Build the reprint-family table the scanner's printing guard reads.

    python scripts/scan-bench/same_art.py          # once per catalogue change: ~1 h, writes same-art.json
    python scripts/scan-bench/same_art.py --foil-only   # just the foil pass on an existing same-art.json (~4 min)
    python scripts/scan-bench/art_families.py      # writes apps/api/src/scan/data/art-families.json

A FAMILY is a set of same-name printings that show the same picture: either
same_art.py found their images agree under one near-identity homography (art-
band ORB inliers >= --art-min, corner shift <= --max-shift — colour-blind, so a
colour-cast scan of a 1st Edition Base Set card still matches its Base Set 2
reprint), or their 9x8 dHash is within --dhash bits, or — the FOIL rule, for a
holo and a non-holo printing of one picture whose foil scrambles the art band —
same_art.py's foil pass found the frame lined up (>= 150 inliers, shift <=
0.05), one contiguous shared figure covering >= --figure-min of the inner art
window, the frame colours agreeing (>= --frame-colour-min) and the figure in the
same colours (>= --figure-colour-min). Families are the transitive closure of
those pairs.

The foil rule's thresholds were set by eye on 2026-10-10 (decision file
"...names-the-card-not-the-printing-re.md", addendum): every pair it adds was
looked at and shows one picture, and every different picture seen that got
past the colour gates scored a figure of 0.21 or less. Two kinds of pair it deliberately leaves out:
- Rainbow, gold and shiny recolours of a full art (same line art, other
  colours): the colour gates. The ORB rule above still joins some of those.
- Basic Energy cards: an energy symbol and a light beam on a gradient match
  across different designs (Generations' striped backgrounds, a Celebi
  silhouette), so the foil rule skips category Energy.

What the scanner does with it (apps/api/src/scan/artFamilies.ts): no image
signal — the hash or the embedding — may name ONE printing of a family on its
own, because none of them can see the difference (a set symbol and a number a
few pixels tall). Only a printed key the OCR read can.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BENCH = Path(os.environ.get("SCAN_BENCH_DIR", Path.home() / "deckpal-data" / "scan-bench"))
sys.path.insert(0, str(HERE))
import embed as E  # noqa: E402


REPRINT_SETS = {"base4": ["base1", "base2"], "lc": ["base1", "base2", "base3", "base5"], "xy12": ["base1"]}
WITHIN_SET_HOLO = ["base2", "base3", "base5"]


def _close(a: str, b: str) -> bool:
    """Same folded name, allowing one or two edits (Imposter / Impostor)."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 2:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--same-art", default=str(BENCH / "same-art.json"))
    ap.add_argument("--art-min", type=int, default=80)
    ap.add_argument("--max-shift", type=float, default=0.15)
    ap.add_argument("--dhash", type=int, default=6)
    ap.add_argument("--art-floor", type=int, default=10,
                    help="a measured pair with fewer art-band inliers than this (and no shared figure) is different pictures: the dHash rule may not join it")
    ap.add_argument("--figure-min", type=float, default=0.24)
    ap.add_argument("--frame-colour-min", type=float, default=0.6)
    ap.add_argument("--figure-colour-min", type=float, default=0.3)
    ap.add_argument("--out", default=str(REPO / "apps" / "api" / "src" / "scan" / "data" / "art-families.json"))
    a = ap.parse_args()
    cards = E.load_catalog()["cards"]
    name = {c["cardId"]: c["name"].lower() for c in cards}
    energy = {c["cardId"] for c in cards if c.get("category") == "Energy"}
    ph = json.loads((BENCH / "phash-index.json").read_text())
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        parent[find(x)] = find(y)

    same_art = json.loads(Path(a.same_art).read_text())
    if "foilPass" not in same_art:
        raise SystemExit(f"{a.same_art} has no foil-pass columns: run same_art.py --foil-only first")
    n_art = n_foil = 0
    # Pairs the image comparison MEASURED and found to be different pictures:
    # the frames line up (a row exists, so >= the pass's inlier floor) but the
    # art band barely agrees, and the foil pass (where it ran) found no shared
    # figure. The dHash rule below must not join these — a 9x8 hash of two
    # cards in one frame style agrees on the frame (PR #294 re-review: Lapras
    # swsh1-48/swshp-SWSH051, Emboar bw1-20/bw4-100, Chansey bw5-80/xy4-80…).
    measured_different = set()
    for row in same_art["pairs"]:
        x, y, _inl, art, _shift = row[:5]
        if art < a.art_floor and (len(row) < 8 or row[5] < a.figure_min):
            measured_different.add((x, y))
            measured_different.add((y, x))
    for row in same_art["pairs"]:
        x, y, _inl, art, shift = row[:5]
        if name.get(x) != name.get(y) or x not in name:
            continue
        if art >= a.art_min and shift <= a.max_shift:
            union(x, y)
            n_art += 1
        elif (len(row) >= 8 and row[5] >= a.figure_min and row[6] >= a.frame_colour_min
              and row[7] >= a.figure_colour_min and x not in energy and y not in energy):
            union(x, y)
            n_foil += 1
    by_name = defaultdict(list)
    for c in cards:
        by_name[name[c["cardId"]]].append(c["cardId"])
    n_hash = n_vetoed = 0
    for ids in by_name.values():
        hs = [(i, int(ph[i], 16)) for i in ids if i in ph]
        for i in range(len(hs)):
            for j in range(i + 1, len(hs)):
                if bin(hs[i][1] ^ hs[j][1]).count("1") <= a.dhash:
                    x, y = hs[i][0], hs[j][0]
                    # Energies keep the hash rule: their pictures are a symbol on
                    # a gradient, which the art band cannot judge either way.
                    if (x, y) in measured_different and x not in energy and y not in energy:
                        n_vetoed += 1
                        continue
                    union(x, y)
                    n_hash += 1
    # KNOWN REPRINT SETS. Some sets are reprints by definition, and the image
    # tests miss pairs whose catalogue scans differ too much (Base Set Magneton
    # vs its Base Set 2 reprint: 6 art-band inliers, dHash 12 — two foil scans).
    # Joining too much only turns an answer into a question, so these rules join
    # by name within the sets a reprint set draws from:
    #   Base Set 2 reprints Base Set and Jungle; Legendary Collection reprints
    #   Base Set, Jungle, Fossil and Team Rocket; Evolutions reprints Base Set's
    #   art in a new frame (the vector confuses them); and Jungle, Fossil and
    #   Team Rocket print each holo again as a non-holo in the same set.
    by_set_name = defaultdict(list)
    set_of = {c["cardId"]: c["setId"] for c in cards}
    for c in cards:
        by_set_name[(c["setId"], name[c["cardId"]])].append(c["cardId"])
    n_rule = 0
    for reprint, sources in REPRINT_SETS.items():
        for (sid, nm), ids in list(by_set_name.items()):
            if sid != reprint:
                continue
            for src in sources:
                for y in by_set_name.get((src, nm), []):
                    for x in ids:
                        union(x, y)
                        n_rule += 1
    for sid in WITHIN_SET_HOLO:
        for (s, nm), ids in by_set_name.items():
            if s == sid and len(ids) > 1 and not any(i in energy for i in ids):
                for y in ids[1:]:
                    union(ids[0], y)
                    n_rule += 1
    # Celebrations Classic Collection: no catalogue art, so no image test can
    # see it — but each card reprints the card with its name and collector
    # number (cel25cc-originals.json, from the approved host's file names).
    cc = json.loads((HERE / "cel25cc-originals.json").read_text(encoding="utf8"))["cards"]
    num = {c["cardId"]: c.get("number") for c in cards}
    fold = lambda s: "".join(ch for ch in s.lower() if ch.isalnum())
    n_cc = 0
    for ccid, o in cc.items():
        if ccid not in name:
            continue
        hits = [c["cardId"] for c in cards
                if not c["cardId"].startswith("cel25") and str(num.get(c["cardId"]) or "").lstrip("0") == str(o["originalNumber"])
                and _close(fold(c["name"]), fold(o["name"]))]
        for y in hits:
            union(ccid, y)
            n_cc += 1
    rules_txt = ", ".join(k + "<-" + "/".join(v) for k, v in REPRINT_SETS.items())
    holo_txt = "/".join(WITHIN_SET_HOLO)
    groups = defaultdict(set)
    for k in list(parent):
        groups[find(k)].add(k)
    families = sorted(sorted(g) for g in groups.values() if len(g) > 1)
    out = {
        "as_of": datetime.date.today().isoformat(),
        "method": (f"same-name printings joined when same_art.py's art-band ORB inliers >= {a.art_min} with corner "
                   f"shift <= {a.max_shift}; or 9x8 dHash <= {a.dhash}; or (foil pass, holo vs non-holo) frame "
                   f"aligned with >= 150 inliers and shift <= 0.05, shared figure >= {a.figure_min}, frame colour "
                   f">= {a.frame_colour_min}, figure colour >= {a.figure_colour_min}, not an Energy card; "
                   f"dHash joins vetoed where the image comparison measured different pictures (art inliers < {a.art_floor}, no shared figure; Energy exempt); "
                   f"plus known reprint sets joined by name ({rules_txt}; holo/non-holo within {holo_txt}) "
                   f"and Celebrations Classic Collection to its originals by name and number; "
                   f"transitive closure. scripts/scan-bench/art_families.py"),
        "cards": sum(len(f) for f in families),
        "families": families,
    }
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf8")
    print(f"{n_art} image pairs + {n_foil} foil pairs + {n_hash} hash pairs ({n_vetoed} hash joins vetoed) + {n_rule} reprint-set joins + {n_cc} Celebrations joins -> {len(families)} families, "
          f"{out['cards']} cards -> {a.out}")


if __name__ == "__main__":
    main()
