"""CHECK A, step 3: merge geometry + embeddings, aggregate, and draw sheets.

    <phase0a venv python> scripts/quad-corpus/experiments/check-a-report.py

Reads the work dir that check-a.ts and check-a-embed.py filled, prints the
summary tables, writes <corpus>/check-a/results.json and the side-by-side
sheets (human crop | detector crop, with the source frame and both quads) for
the 12 worst and 6 typical rows.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

CORPUS = os.environ.get("QUAD_CORPUS_DIR", os.path.join(os.path.expanduser("~"), "deckpal-data", "quad-corpus"))
WORK = os.path.join(CORPUS, "check-a-work")
# Outside the repo, like the corpus: the sheets show the owner's photos.
OUTDIR = os.path.join(CORPUS, "check-a")

BANDS = [("near-perfect", 0, 1.5), ("minor", 1.5, 4.0), ("visibly distorted", 4.0, 1e9)]
SIM_MIN, MARGIN_MIN = 0.74, 0.02  # confidence.ts, clip-vit-b32-openai
HEIGHT_BUCKETS = [("<60%", 0, 0.6), ("60-70%", 0.6, 0.7), ("70-80%", 0.7, 0.8), ("80-90%", 0.8, 0.9), (">=90%", 0.9, 9)]


def band(x):
    for name, lo, hi in BANDS:
        if lo <= x < hi:
            return name
    return "?"


def hbucket(h):
    for name, lo, hi in HEIGHT_BUCKETS:
        if lo <= h < hi:
            return name
    return "?"


def q(a, p):
    a = sorted(a)
    return a[min(len(a) - 1, int(p * len(a)))] if a else float("nan")


def dist(name, a, fmt="%.3f"):
    if not a:
        return "%-30s n=0" % name
    return ("%-30s n=%-3d p10 " + fmt + "  med " + fmt + "  mean " + fmt + "  p90 " + fmt + "  min " + fmt + "  max " + fmt) % (
        name, len(a), q(a, 0.1), q(a, 0.5), float(np.mean(a)), q(a, 0.9), min(a), max(a))


def share_below(a, t):
    return "%d/%d (%.0f%%)" % (sum(1 for x in a if x < t), len(a), 100.0 * sum(1 for x in a if x < t) / max(1, len(a)))


def align(gt, qd):
    """qd's corners re-ordered to best match gt's (best of the 8 cyclic orders
    and windings — the same rule as offline-harness.cornerDeltas)."""
    best, bs = None, 1e18
    for flip in (False, True):
        b = [qd[0], qd[3], qd[2], qd[1]] if flip else list(qd)
        for r in range(4):
            c = [b[(i + r) % 4] for i in range(4)]
            s = sum(np.hypot(*(np.array(gt[i]) - np.array(c[i]))) for i in range(4))
            if s < bs:
                best, bs = c, s
    return np.array(best, dtype=np.float64)


def framing_vs_shape(gt, qd):
    """Split the corner error into FRAMING (the best 2-D similarity: shift,
    scale, rotation — the crop is the right shape, just tighter/looser/offset)
    and SHAPE (what is left after it: keystone, shear, aspect — the crop's
    contents are warped). Umeyama least-squares fit, gt -> detector."""
    X = np.array(gt, dtype=np.float64)
    Y = align(gt, qd)
    mx, my = X.mean(0), Y.mean(0)
    Xc, Yc = X - mx, Y - my
    U, Sg, Vt = np.linalg.svd(Yc.T @ Xc)
    d = np.sign(np.linalg.det(U @ Vt))
    D = np.diag([1, d])
    Rm = U @ D @ Vt
    s = (Sg * np.diag(D)).sum() / (Xc ** 2).sum()
    t = my - s * Rm @ mx
    fit = (s * (Rm @ X.T)).T + t
    res = np.hypot(*(fit - Y).T)
    diag = (np.hypot(*(X[0] - X[2])) + np.hypot(*(X[1] - X[3]))) / 2
    return {
        "shapeMeanPct": float(res.mean() / diag * 100),
        "shapeMaxPct": float(res.max() / diag * 100),
        "shiftPct": float(np.hypot(*(Y.mean(0) - X.mean(0))) / diag * 100),
        "scalePct": float((s - 1) * 100),
        "rotDeg": float(np.degrees(np.arctan2(Rm[1, 0], Rm[0, 0]))),
    }


def main():
    geo = json.load(open(os.path.join(WORK, "geometry.json")))
    emb = json.load(open(os.path.join(WORK, "embed.json")))
    Z = np.load(os.path.join(WORK, "query-emb.npz"))
    rows = geo["rows"]
    n = len(rows)
    S = emb["selfSim"]
    R = emb["retrieval"]
    jpeg_pair = np.sum(Z["HJ"] * Z["DRJ"], axis=1)

    merged = []
    for i, r in enumerate(rows):
        g, gu = r["geoRefined"], r["geoRaw"]
        m = {
            "id": r["id"], "face": r["face"], "source": r["source"], "seededFrom": r["seededFrom"],
            "heightFrac": r["heightFrac"], "heightBucket": hbucket(r["heightFrac"]),
            "hasObj": r["hasObj"], "gatedMiss": not r["gateOpen"],
            "cls": r["evalCls"], "ungatedCls": r["ungatedCls"], "humanOrientOk": r["humanOrientOk"],
            "meanErrPct": g["meanErrPct"], "maxErrPct": g["maxErrPct"],
            "residualMeanPct": g["residualMeanPct"], "residualMaxPct": g["residualMaxPct"],
            "bandMax": band(g["maxErrPct"]), "bandMean": band(g["meanErrPct"]),
            "raw": {"meanErrPct": gu["meanErrPct"], "maxErrPct": gu["maxErrPct"],
                    "residualMeanPct": gu["residualMeanPct"], "residualMaxPct": gu["residualMaxPct"],
                    "rotation": gu["rotation"]},
            "rotation": g["rotation"],
            "cosDR": S["DR"][i], "cosDU": S["DU"][i], "cosJpegPair": float(jpeg_pair[i]),
            "cosHJ": S["HJ"][i], "cosHLR": S["HLR"][i], "cosHMR": S["HMR"][i],
            "cosP": {k: S[k][i] for k in ("P1", "P2", "P4", "P8")},
            "perturbGeo": r["perturbGeo"],
            "retr": {v: R[v][i] for v in R},
            "decomp": framing_vs_shape(r["gt"], r["refined"]),
        }
        merged.append(m)
    truth = json.load(open(os.path.join(OUTDIR, "truth-by-eye.json")))

    L = []
    P = L.append
    P("CHECK A: detector crop vs human crop, %d labelled positives (%d front, %d back)" % (
        n, sum(m["face"] == "front" for m in merged), sum(m["face"] == "back" for m in merged)))
    P("crop %dx%d, margin %.2f, refined detector quad (the product path) unless noted" % (
        geo["meta"]["crop"]["width"], geo["meta"]["crop"]["height"], geo["meta"]["captureMargin"]))
    P("")
    P("== GEOMETRY (% of the human quad's diagonal; residual = % of card diagonal in the crop) ==")
    for key, label in (("meanErrPct", "mean corner err"), ("maxErrPct", "max corner err"),
                       ("residualMeanPct", "residual warp, mean over card"), ("residualMaxPct", "residual warp, max over card")):
        P(dist(label + " (refined)", [m[key] for m in merged], "%.2f"))
        P(dist(label + " (unrefined)", [m["raw"][key] for m in merged], "%.2f"))
    P("")
    for basis in ("bandMax", "bandMean"):
        c = {b[0]: 0 for b in BANDS}
        for m in merged:
            c[m[basis]] += 1
        P("bands by %s: %s" % ("MAX corner err" if basis == "bandMax" else "MEAN corner err",
                                "  ".join("%s %d (%.0f%%)" % (k, v, 100.0 * v / n) for k, v in c.items())))
    P("framing vs shape (refined; similarity fit human -> detector):")
    P(dist("  framing: centre shift % diag", [m["decomp"]["shiftPct"] for m in merged], "%.2f"))
    P(dist("  framing: |scale change| %", [abs(m["decomp"]["scalePct"]) for m in merged], "%.2f"))
    P(dist("  framing: scale change % (signed)", [m["decomp"]["scalePct"] for m in merged], "%+.2f"))
    P(dist("  framing: |rotation| deg", [abs(m["decomp"]["rotDeg"]) for m in merged], "%.2f"))
    P(dist("  SHAPE residual, mean % diag", [m["decomp"]["shapeMeanPct"] for m in merged], "%.2f"))
    P(dist("  SHAPE residual, max % diag", [m["decomp"]["shapeMaxPct"] for m in merged], "%.2f"))
    for basis in ("shapeMaxPct",):
        c = {b[0]: 0 for b in BANDS}
        for m in merged:
            c[band(m["decomp"][basis])] += 1
        P("  bands by SHAPE max residual: %s" % "  ".join("%s %d (%.0f%%)" % (k, v, 100.0 * v / n) for k, v in c.items()))
    rs = np.corrcoef([m["decomp"]["shapeMeanPct"] for m in merged], [m["cosDR"] for m in merged])[0, 1]
    rf = np.corrcoef([m["decomp"]["shiftPct"] + abs(m["decomp"]["scalePct"]) for m in merged], [m["cosDR"] for m in merged])[0, 1]
    P("  Pearson with cos: shape %.2f, framing (shift+|scale|) %.2f" % (rs, rf))
    P("orientation: detector crop rotated vs human crop on %d rows (refined), %d (unrefined)" % (
        sum(m["rotation"] != 0 for m in merged), sum(m["raw"]["rotation"] != 0 for m in merged)))
    P("orientation: product orders the HUMAN quad off the labelled top-left on %d rows (sideways/upside-down cards: rotated crop even with perfect corners): %s" % (
        sum(not m["humanOrientOk"] for m in merged), ", ".join("%s(%s)" % (m["id"], m["source"]) for m in merged if not m["humanOrientOk"])))
    P("")

    P("== EMBEDDING SELF-SIMILARITY cos(embed(human crop), embed(X)) ==")
    cos = [m["cosDR"] for m in merged]
    P(dist("detector refined (product)", cos))
    P(dist("detector unrefined", [m["cosDU"] for m in merged]))
    P(dist("both JPEG q85 (HJ vs DRJ)", [m["cosJpegPair"] for m in merged]))
    P("  share of product crops below 0.95: %s   below 0.90: %s   below 0.85: %s" % (
        share_below(cos, 0.95), share_below(cos, 0.90), share_below(cos, 0.85)))
    P("  reference floors (same human quad, nuisance only):")
    P(dist("    JPEG q85 round trip", [m["cosHJ"] for m in merged]))
    P(dist("    3/4-res source (312 px)", [m["cosHMR"] for m in merged]))
    P(dist("    half-res source (208 px)", [m["cosHLR"] for m in merged]))
    P("  reference dose-response (human quad, every corner moved k% of diagonal, random direction):")
    for k in ("P1", "P2", "P4", "P8"):
        P(dist("    %s%% corner jitter" % k[1:], [m["cosP"][k] for m in merged]))
    P(dist("  DIFFERENT cards' human crops", emb["interCard"]))
    P("")

    P("== BY CARD HEIGHT (bbox long side / 416) ==")
    hdr = "%-8s %3s  %-10s %-10s %-10s %-10s %-10s  %-8s %-8s %s"
    P(hdr % ("bucket", "n", "meanErr%", "maxErr%", "resid%", "cos med", "cos p10", "<0.95", "<0.90", "bands(max) np/minor/dist"))

    def group_line(label, ms):
        if not ms:
            return "%-8s   0" % label
        c = [sum(m["bandMax"] == b[0] for m in ms) for b in BANDS]
        return "%-8s %3d  %-10.2f %-10.2f %-10.2f %-10.3f %-10.3f  %-8s %-8s %d/%d/%d" % (
            label, len(ms), q([m["meanErrPct"] for m in ms], 0.5), q([m["maxErrPct"] for m in ms], 0.5),
            q([m["residualMeanPct"] for m in ms], 0.5), q([m["cosDR"] for m in ms], 0.5), q([m["cosDR"] for m in ms], 0.1),
            sum(m["cosDR"] < 0.95 for m in ms), sum(m["cosDR"] < 0.90 for m in ms), c[0], c[1], c[2])

    for name, _, _ in HEIGHT_BUCKETS:
        ms = [m for m in merged if m["heightBucket"] == name]
        if ms:
            P(group_line(name, ms))
    P("(medians; meanErr/maxErr/resid in %, cos = self-similarity of the product crop)")
    P("")
    P("== BY DETECTOR CLASS (eval cls; a gated miss is scored on its ungated quad) ==")
    P(hdr % ("class", "n", "meanErr%", "maxErr%", "resid%", "cos med", "cos p10", "<0.95", "<0.90", "bands(max) np/minor/dist"))
    for c in ("perimeter", "partial-overhang", "partial-inset", "miss"):
        P(group_line(c[:8], [m for m in merged if m["cls"] == c]))
    misses = [m for m in merged if m["gatedMiss"]]
    P("gated misses (%d): ungated class %s" % (len(misses), {k: sum(m["ungatedCls"] == k for m in misses) for k in set(m["ungatedCls"] for m in misses)}))
    P("")
    P("== BY SOURCE ==")
    for s in ("camera", "upload"):
        P(group_line(s[:8], [m for m in merged if m["source"] == s]))
    P("")

    P("== BANDS vs SELF-SIMILARITY (is 1.5/4% of diagonal the right cut?) ==")
    for basis in ("maxErrPct", "meanErrPct"):
        for cuts in ([1.5, 4.0], [2.0, 5.0], [3.0, 6.0]):
            parts = []
            edges = [0] + cuts + [1e9]
            for a, b in zip(edges[:-1], edges[1:]):
                ms = [m for m in merged if a <= m[basis] < b]
                parts.append("[%g,%s) n=%d cos med %.3f p10 %.3f" % (a, "inf" if b > 1e8 else "%g" % b, len(ms),
                             q([m["cosDR"] for m in ms], 0.5), q([m["cosDR"] for m in ms], 0.1)))
            P("  %-10s %s" % (basis, " | ".join(parts)))
    rc = np.corrcoef([m["residualMeanPct"] for m in merged], [m["cosDR"] for m in merged])[0, 1]
    P("  Pearson(residual mean %%, cos) = %.2f" % rc)
    P("")

    P("== RETRIEVAL against the 6,464-card calibration gallery (simMin 0.74, marginMin 0.02) ==")
    fronts = [m for m in merged if m["face"] == "front"]
    for v in R:
        lv = {k: sum(m["retr"][v]["level"] == k for m in fronts) for k in ("confident", "uncertain", "none")}
        P("  %-4s fronts: %s   top-1 sim med %.3f   margin med %.4f" % (
            v, lv, q([m["retr"][v]["sim"] for m in fronts], 0.5), q([m["retr"][v]["margin"] for m in fronts], 0.5)))
    hc = [m for m in fronts if m["retr"]["H"]["level"] == "confident"]
    same = [m for m in hc if m["retr"]["DR"]["top"][0][0] == m["retr"]["H"]["top"][0][0]]
    stillc = [m for m in same if m["retr"]["DR"]["level"] == "confident"]
    P("  human crop CONFIDENT on %d fronts; detector crop: same top-1 on %d, same top-1 AND confident on %d" % (len(hc), len(same), len(stillc)))
    agree = sum(m["retr"]["DR"]["top"][0][0] == m["retr"]["H"]["top"][0][0] for m in fronts)
    P("  top-1 agreement human vs detector crop, all fronts: %d/%d" % (agree, len(fronts)))
    agree_jpg = sum(m["retr"]["HJ"]["top"][0][0] == m["retr"]["H"]["top"][0][0] for m in fronts)
    agree_lr = sum(m["retr"]["HLR"]["top"][0][0] == m["retr"]["H"]["top"][0][0] for m in fronts)
    P("  (floors) top-1 agreement human vs human-JPEG %d/%d, human vs human-half-res %d/%d" % (agree_jpg, len(fronts), agree_lr, len(fronts)))
    dsim = [m["retr"]["DR"]["sim"] - m["retr"]["H"]["sim"] for m in fronts]
    P(dist("  delta top-1 sim (DR - H)", dsim, "%+.4f"))
    dsame = [m["retr"]["DR"]["top"][0][1] - m["retr"]["H"]["top"][0][1] for m in fronts
             if m["retr"]["DR"]["top"][0][0] == m["retr"]["H"]["top"][0][0]]
    P(dist("  delta sim, same top-1 card", dsame, "%+.4f"))
    gained = [m for m in fronts if m["retr"]["H"]["level"] != "confident" and m["retr"]["DR"]["level"] == "confident"]
    lost = [m for m in hc if not (m["retr"]["DR"]["level"] == "confident" and m["retr"]["DR"]["top"][0][0] == m["retr"]["H"]["top"][0][0])]
    P("  confident -> not (or different card) with detector crop: %d  %s" % (len(lost), [(m["id"], m["cls"], round(m["cosDR"], 3), m["retr"]["H"]["top"][0][0], m["retr"]["DR"]["top"][0][0], m["retr"]["DR"]["level"]) for m in lost]))
    P("  not confident -> confident with detector crop: %d  %s" % (len(gained), [(m["id"], m["retr"]["H"]["top"][0][0], m["retr"]["DR"]["top"][0][0]) for m in gained]))
    P("")
    P("== IDENTIFICATION DOSE-RESPONSE, on the %d fronts whose HUMAN crop is confident ==" % len(hc))
    P("   (sim to the human crop's top-1 card, and whether X still names it confidently)")
    gz = np.load(os.path.join(WORK, "gallery-emb.npz"), allow_pickle=False)
    gidx = {g: k for k, g in enumerate(gz["ids"])}
    gemb = gz["emb"]
    hc_idx = [k for k, m in enumerate(merged) if m in hc]
    for v in ("HJ", "HMR", "HLR", "P1", "P2", "P4", "P8", "DR", "DU", "DRJ"):
        kept = sum(merged[k]["retr"][v]["level"] == "confident" and merged[k]["retr"][v]["top"][0][0] == merged[k]["retr"]["H"]["top"][0][0] for k in hc_idx)
        same = sum(merged[k]["retr"][v]["top"][0][0] == merged[k]["retr"]["H"]["top"][0][0] for k in hc_idx)
        ds = [float(Z[v][k] @ gemb[gidx[merged[k]["retr"]["H"]["top"][0][0]]]) - merged[k]["retr"]["H"]["sim"] for k in hc_idx]
        P("  %-4s kept confident+same %2d/%d   same top-1 %2d/%d   d(sim to that card) med %+.4f p10 %+.4f" % (
            v, kept, len(hc), same, len(hc), q(ds, 0.5), q(ds, 0.1)))
    P("  human-confident fronts by detector class, kept by the product crop:")
    for c in ("perimeter", "partial-overhang", "partial-inset", "miss"):
        ms = [m for m in hc if m["cls"] == c]
        k = sum(m["retr"]["DR"]["level"] == "confident" and m["retr"]["DR"]["top"][0][0] == m["retr"]["H"]["top"][0][0] for m in ms)
        P("    %-17s %d/%d" % (c, k, len(ms)))
    for name, lo, hi in BANDS:
        ms = [m for m in hc if lo <= m["meanErrPct"] < hi]
        k = sum(m["retr"]["DR"]["level"] == "confident" and m["retr"]["DR"]["top"][0][0] == m["retr"]["H"]["top"][0][0] for m in ms)
        P("    mean err %-17s %d/%d" % (name, k, len(ms)))
    P("  human-confident sim headroom over simMin: med %.3f; margin headroom over marginMin: med %.4f" % (
        q([m["retr"]["H"]["sim"] - SIM_MIN for m in hc], 0.5), q([m["retr"]["H"]["margin"] - MARGIN_MIN for m in hc], 0.5)))
    P("")

    P("== IDENTIFICATION, VERIFIED BY EYE (<corpus>/check-a/truth-by-eye.json) ==")
    ht = truth["humanTop1"]
    vc = {k: sum(1 for v in ht.values() if v == k) for k in ("correct", "ambiguous", "wrong")}
    P("  human-crop 'confident' verdicts: %s  (the wrong ones are cards absent from the 36-set gallery)" % vc)
    ok_idx = [k for k, m in enumerate(merged) if ht.get(m["id"]) == "correct"]
    P("  on the %d verified-CORRECT human identifications, does X still name that card confidently?" % len(ok_idx))
    for v in ("HJ", "HMR", "HLR", "P1", "P2", "P4", "P8", "DR", "DU", "DRJ"):
        kept = [k for k in ok_idx if merged[k]["retr"][v]["level"] == "confident" and merged[k]["retr"][v]["top"][0][0] == merged[k]["retr"]["H"]["top"][0][0]]
        wrongc = [k for k in ok_idx if merged[k]["retr"][v]["level"] == "confident" and merged[k]["retr"][v]["top"][0][0] != merged[k]["retr"]["H"]["top"][0][0]]
        ds = [float(Z[v][k] @ gemb[gidx[merged[k]["retr"]["H"]["top"][0][0]]]) - merged[k]["retr"]["H"]["sim"] for k in ok_idx]
        dm = [merged[k]["retr"][v]["margin"] - merged[k]["retr"]["H"]["margin"] for k in ok_idx]
        P("  %-4s kept %2d/%d  confidently-wrong %d   d(sim to the right card) med %+.4f p10 %+.4f   d(margin) med %+.4f" % (
            v, len(kept), len(ok_idx), len(wrongc), q(ds, 0.5), q(ds, 0.1), q(dm, 0.5)))
    lost_ok = [merged[k] for k in ok_idx if not (merged[k]["retr"]["DR"]["level"] == "confident" and merged[k]["retr"]["DR"]["top"][0][0] == merged[k]["retr"]["H"]["top"][0][0])]
    P("  the product crop loses: %s" % [(m["id"], m["cls"], "%.1f%%" % m["meanErrPct"], "shape %.1f%%" % m["decomp"]["shapeMaxPct"], round(m["cosDR"], 3), m["retr"]["DR"]["level"]) for m in lost_ok])
    kept_ok = [merged[k] for k in ok_idx if merged[k] not in lost_ok]
    P("  mean corner err of kept vs lost: kept med %.1f%%, lost med %.1f%%; cos kept med %.3f, lost med %.3f" % (
        q([m["meanErrPct"] for m in kept_ok], 0.5), q([m["meanErrPct"] for m in lost_ok], 0.5),
        q([m["cosDR"] for m in kept_ok], 0.5), q([m["cosDR"] for m in lost_ok], 0.5)))
    wr_idx = [k for k, m in enumerate(merged) if ht.get(m["id"]) == "wrong"]
    dw = truth["detectorOnlyConfidentTop1"]
    fa_dr = sum(1 for k in wr_idx if merged[k]["retr"]["DR"]["level"] == "confident") + sum(1 for v in dw.values() if v == "wrong")
    ok_dr = len(ok_idx) - len(lost_ok) + sum(1 for v in dw.values() if v == "correct")
    P("  confident & correct: human crop %d, product crop %d.   confident & WRONG (false accept): human crop %d, product crop %d" % (
        len(ok_idx), ok_dr, len(wr_idx), fa_dr))
    P("")

    # Contact sheet of every changed identification, for checking by eye.
    changed = lost + gained
    if changed:
        tw, th = 150, 209
        gal_dir = emb["meta"]["gallery"]
        cs = Image.new("RGB", (4 * (tw + 6) + 6, len(changed) * (th + 30) + 30), (24, 24, 24))
        cd = ImageDraw.Draw(cs)
        try:
            sfont = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
        except OSError:
            sfont = ImageFont.load_default()
        cd.text((6, 8), "human crop | detector crop | catalog top-1 (human) | catalog top-1 (detector)", fill=(235, 235, 235), font=sfont)
        for k, m in enumerate(changed):
            y = 30 + k * (th + 30)
            tiles = [os.path.join(WORK, "crops", "%s-H.png" % m["id"]), os.path.join(WORK, "crops", "%s-DR.png" % m["id"]),
                     os.path.join(gal_dir, m["retr"]["H"]["top"][0][0] + ".webp"), os.path.join(gal_dir, m["retr"]["DR"]["top"][0][0] + ".webp")]
            for j, f in enumerate(tiles):
                cs.paste(Image.open(f).convert("RGB").resize((tw, th), Image.LANCZOS), (6 + j * (tw + 6), y))
            cd.text((6, y + th + 2), "%s %s cos %.3f | H %s %.3f %s | D %s %.3f %s" % (
                m["id"], m["cls"], m["cosDR"], m["retr"]["H"]["top"][0][0], m["retr"]["H"]["sim"], m["retr"]["H"]["level"][:4],
                m["retr"]["DR"]["top"][0][0], m["retr"]["DR"]["sim"], m["retr"]["DR"]["level"][:4]), fill=(235, 235, 235), font=sfont)
        os.makedirs(OUTDIR, exist_ok=True)
        cs.save(os.path.join(OUTDIR, "changed-identifications.png"))
    print("\n".join(L))

    os.makedirs(OUTDIR, exist_ok=True)
    # ---- sheets ----
    worst = sorted(merged, key=lambda m: m["cosDR"])[:12]
    med = q([m["meanErrPct"] for m in merged], 0.5)
    pool = [m for m in merged if m not in worst]
    typical = sorted(pool, key=lambda m: abs(m["meanErrPct"] - med))[:6]
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 17)
    except OSError:
        font = ImageFont.load_default()
    gl = {m["id"]: r for m, r in zip(merged, rows)}
    written = []
    for tag, group in (("worst", worst), ("typical", typical)):
        for rank, m in enumerate(group, 1):
            r = gl[m["id"]]
            src = Image.open(os.path.join(CORPUS, "raw", "%s.png" % m["id"])).convert("RGB")
            d = ImageDraw.Draw(src)
            for quad, col in ((r["gt"], (0, 230, 0)), (r["refined"], (255, 40, 40))):
                pts = [tuple(p) for p in quad] + [tuple(quad[0])]
                d.line(pts, fill=col, width=2)
            src = src.resize((670, 670), Image.LANCZOS)
            h = Image.open(os.path.join(WORK, "crops", "%s-H.png" % m["id"])).convert("RGB")
            dd = Image.open(os.path.join(WORK, "crops", "%s-DR.png" % m["id"])).convert("RGB")
            W = 670 + 480 + 480 + 40
            sheet = Image.new("RGB", (W, 670 + 112), (24, 24, 24))
            sheet.paste(src, (0, 112))
            sheet.paste(h, (670 + 20, 112))
            sheet.paste(dd, (670 + 480 + 40, 112))
            t = ImageDraw.Draw(sheet)
            rh, rd = m["retr"]["H"], m["retr"]["DR"]
            lines = [
                "%s #%d  id %s  %s/%s  cls %s%s  card height %.0f%% of frame" % (
                    tag.upper(), rank, m["id"], m["face"], m["source"], m["cls"],
                    " (ungated: %s)" % m["ungatedCls"] if m["gatedMiss"] else "", 100 * m["heightFrac"]),
                "corner err mean %.1f%% / max %.1f%% of diag | framing: shift %.1f%% scale %+.1f%% | SHAPE max %.1f%% | warp mean %.1f%% | cos %.3f" % (
                    m["meanErrPct"], m["maxErrPct"], m["decomp"]["shiftPct"], m["decomp"]["scalePct"], m["decomp"]["shapeMaxPct"],
                    m["residualMeanPct"], m["cosDR"]),
                "retrieval  human: %s %.3f m%.3f %s   detector: %s %.3f m%.3f %s" % (
                    rh["top"][0][0], rh["sim"], rh["margin"], rh["level"], rd["top"][0][0], rd["sim"], rd["margin"], rd["level"]),
                "source (green = human quad, red = detector quad)          | human crop (product rectify)    | detector crop (product rectify)",
            ]
            for k, s in enumerate(lines):
                t.text((10, 6 + 26 * k), s, fill=(235, 235, 235), font=font)
            fn = os.path.join(OUTDIR, "%s-%02d-%s.png" % (tag, rank, m["id"]))
            sheet.save(fn)
            written.append(fn)
    json.dump({"meta": {"geometry": geo["meta"], "embed": emb["meta"], "bands": BANDS,
                        "worst": [m["id"] for m in worst], "typical": [m["id"] for m in typical]},
               "summary": L, "rows": merged}, open(os.path.join(OUTDIR, "results.json"), "w"), indent=1)
    print("sheets: %d written to %s" % (len(written), OUTDIR))


if __name__ == "__main__":
    main()
