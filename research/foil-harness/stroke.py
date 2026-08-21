"""
The white keyline around the lower-left tags.

Owner-observed, and visible by eye in the footage: in the current era the reverse
holo printing puts a white stroke around the illustrator credit, the regulation
mark, the set code and the collector number. The normal printing does not.

This is INK, not optics. It is printed into the card's albedo, so unlike every
signal chased so far it does not depend on the light, the angle, the hand moving,
or a specular highlight existing at all. One frame is enough.

Measured as a RATIO of two things inside the same small patch — the brightness
immediately around the glyphs versus the brightness of the surrounding body —
so exposure, white balance and sensor gain cancel exactly as they do in the
region-contrast measure, but without needing any tilt.
"""
import json, os, glob
import cv2, numpy as np

DIR = "/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
W, H = 480, 660
# The lower-left info block: illustrator credit, regulation mark, set code, number.
X0, X1 = int(0.020*W), int(0.400*W)
Y0, Y1 = int(0.855*H), int(0.990*H)

spec = json.load(open(f"{DIR}/segments.json"))
LABEL = {}
for c in spec["clips"]:
    for s in c["segments"]:
        LABEL[s["id"]] = {**s, "light": c["light"]}

def measure(bgr):
    patch = bgr[Y0:Y1, X0:X1].astype(np.float32)
    if patch.size == 0:
        return None
    hsv = cv2.cvtColor(patch.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
    V = hsv[:, :, 2]
    S = hsv[:, :, 1] / 255.0
    if V.max() < 20:
        return None
    body = float(np.median(V))
    glyph = V < body * 0.62                      # the dark ink
    if glyph.sum() < 40:
        return None
    k = np.ones((3, 3), np.uint8)
    ring = (cv2.dilate(glyph.astype(np.uint8), k, iterations=2) > 0) & (~glyph)
    if ring.sum() < 40:
        return None
    bg = (~glyph) & (~ring)
    if bg.sum() < 200:
        return None
    return {
        # Brightness just outside the ink, relative to the surrounding body.
        # A white keyline lifts it; plain body ink leaves it at the body level.
        "haloRatio": float(V[ring].mean() / max(V[bg].mean(), 1e-6)),
        # A keyline is white: bright AND desaturated. The body is a saturated
        # colour, so this is nearly zero when there is no stroke.
        "whiteFrac": float(((V > body * 1.10) & (S < 0.35))[ring].mean()),
        "haloSat":   float(S[ring].mean() / max(S[bg].mean(), 1e-6)),
    }

groups = {}
for p in sorted(glob.glob(f"{DIR}/reg/*.png")):
    groups.setdefault(os.path.basename(p).split("__")[0], []).append(p)

rows = []
for sid, paths in sorted(groups.items()):
    meta = LABEL.get(sid)
    if not meta:
        continue
    vals = [m for m in (measure(cv2.imread(p)) for p in paths) if m]
    if len(vals) < 2:
        continue
    rows.append({"id": sid, "card": meta["card"], "light": meta["light"],
                 "variant": meta["variant"], "n": len(vals),
                 **{k: float(np.median([v[k] for v in vals])) for k in vals[0]}})

json.dump(rows, open(f"{DIR}/stroke.json", "w"), indent=2)

# Sanity check: the catalog image is the NORMAL printing, so it must look normal.
print("catalog (normal printing) — control:")
for n in ("Weedle", "Kakuna", "Ninetales"):
    im = cv2.resize(cv2.imread(f"{DIR}/catalog/{n}.webp"), (W, H), interpolation=cv2.INTER_AREA)
    m = measure(im)
    print(f'  {n:10s} haloRatio={m["haloRatio"]:.3f}  whiteFrac={m["whiteFrac"]:.3f}  haloSat={m["haloSat"]:.3f}')

print(f'\n{"card":10s}{"light":5s}{"variant":9s}{"n":>3s}{"haloRatio":>11s}{"whiteFrac":>11s}{"haloSat":>9s}')
for r in sorted(rows, key=lambda x: (x["card"], x["variant"], x["light"])):
    print(f'{r["card"]:10s}{r["light"][:3]:5s}{r["variant"]:9s}{r["n"]:3d}'
          f'{r["haloRatio"]:11.3f}{r["whiteFrac"]:11.3f}{r["haloSat"]:9.3f}')
