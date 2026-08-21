"""
Locate the glyphs from the reference; measure the halo in the photograph.

Two earlier attempts each failed for one reason, and both reasons are fixed here.

Attempt 1 found the glyphs in the PHOTOGRAPH by thresholding dark pixels, so
dilating them landed on their own antialiased edges — which are mid-bright on any
printing. The control caught it: the catalog, which is by definition the normal
print, scored higher than real normals.

Attempt 2 compared absolute brightness against the reference, so it moved with
exposure — dim-light frames sat 90-120 levels below the catalog even after gain
matching, because a phone in a dark room does not simply scale, it reshapes the
tone curve.

So: take the glyph positions from the REFERENCE, where they are noise-free and
independent of how this particular photograph turned out. Then ask a question
entirely inside the photograph — is the ring just outside the ink brighter than
the body around it? A white keyline says yes. Ink printed straight onto the body
says no. Exposure, white balance and gain cancel because both terms come from the
same patch of the same frame.
"""
import json, os, glob
import cv2, numpy as np

DIR = "/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
W, H = 480, 660
X0, X1 = int(0.020*W), int(0.430*W)
Y0, Y1 = int(0.850*H), int(0.995*H)

spec = json.load(open(f"{DIR}/segments.json"))
LABEL = {}
for c in spec["clips"]:
    for s in c["segments"]:
        LABEL[s["id"]] = {**s, "light": c["light"]}

# Glyph / ring / body masks, derived ONCE per card from the reference print.
MASKS = {}
for n in ("Weedle", "Kakuna", "Ninetales"):
    ref = cv2.resize(cv2.imread(f"{DIR}/catalog/{n}.webp"), (W, H), interpolation=cv2.INTER_AREA)
    V = cv2.cvtColor(ref[Y0:Y1, X0:X1], cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32)
    glyph = V < np.median(V) * 0.60
    k = np.ones((3, 3), np.uint8)
    g1 = cv2.dilate(glyph.astype(np.uint8), k, iterations=1) > 0
    g3 = cv2.dilate(glyph.astype(np.uint8), k, iterations=3) > 0
    ring = g3 & (~g1)                     # a band OUTSIDE the ink, skipping its own edge
    body = ~cv2.dilate(glyph.astype(np.uint8), k, iterations=5).astype(bool)
    MASKS[n] = (glyph, ring, body)

def measure(img, card):
    ok = img.sum(2) > 0
    if ok.sum() < 40000:
        return None
    glyph, ring, body = MASKS[card]
    p = img[Y0:Y1, X0:X1]
    m = ok[Y0:Y1, X0:X1]
    hsv = cv2.cvtColor(p, cv2.COLOR_BGR2HSV).astype(np.float32)
    V, S = hsv[:, :, 2], hsv[:, :, 1] / 255.0
    r, b = ring & m, body & m
    if r.sum() < 60 or b.sum() < 200:
        return None
    return {
        # The whole measurement: ring brightness over body brightness, both from
        # this frame. >1 means something bright sits between the ink and the body.
        "halo": float(V[r].mean() / max(V[b].mean(), 1e-6)),
        # A keyline is white, so it should also be LESS saturated than the body.
        "haloDesat": float(S[b].mean() - S[r].mean()),
    }

groups = {}
for p in sorted(glob.glob(f"{DIR}/reg/*.png")):
    groups.setdefault(os.path.basename(p).split("__")[0], []).append(p)

rows = []
for sid, paths in sorted(groups.items()):
    meta = LABEL.get(sid)
    if not meta:
        continue
    vals = [m for m in (measure(cv2.imread(p), meta["card"]) for p in paths) if m]
    if len(vals) < 2:
        continue
    rows.append({"id": sid, "card": meta["card"], "light": meta["light"], "variant": meta["variant"],
                 "n": len(vals), **{k: float(np.median([v[k] for v in vals])) for k in vals[0]}})
json.dump(rows, open(f"{DIR}/stroke3.json", "w"), indent=2)

print("control — the catalog IS the normal print:")
for n in MASKS:
    ref = cv2.resize(cv2.imread(f"{DIR}/catalog/{n}.webp"), (W, H), interpolation=cv2.INTER_AREA)
    m = measure(ref, n)
    print(f'  {n:10s} halo={m["halo"]:.3f}  haloDesat={m["haloDesat"]:+.3f}')

print(f'\n{"card":10s}{"light":5s}{"variant":9s}{"n":>3s}{"halo":>8s}{"haloDesat":>11s}')
for r in sorted(rows, key=lambda x: (x["card"], x["light"], x["variant"])):
    print(f'{r["card"]:10s}{r["light"][:3]:5s}{r["variant"]:9s}{r["n"]:3d}{r["halo"]:8.3f}{r["haloDesat"]:+11.3f}')
