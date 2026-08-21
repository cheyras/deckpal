"""
Where is this card whiter than its own NORMAL printing?

The keyline is ink, and the catalog image is the normal print of the same card,
registered to the same grid. So the question needs no model of what a keyline
looks like and no threshold tuned on glyph antialiasing — which is what defeated
the first attempt, and which the control exposed: the catalog scored HIGHER than
real normals, because dilating dark glyphs finds their antialiased edges whatever
printing they are on.

Asked as a direct A/B instead: count pixels in the lower-left tag block that are
markedly brighter AND markedly less saturated than the same pixel of the normal
print. A normal card matches its reference and scores near zero. A reverse holo
has white stroke where the reference has coloured body.
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

CAT = {}
for n in ("Weedle", "Kakuna", "Ninetales"):
    CAT[n] = cv2.resize(cv2.imread(f"{DIR}/catalog/{n}.webp"), (W, H), interpolation=cv2.INTER_AREA)

def hsv(bgr):
    x = cv2.cvtColor(bgr.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
    return x[:, :, 2], x[:, :, 1] / 255.0

def measure(img, card):
    ok = img.sum(2) > 0
    if ok.sum() < 40000:
        return None
    ref = CAT[card]
    # White-balance and expose-match against the reference over the whole card.
    gains = [ref[:, :, c].astype(np.float32)[ok].mean() / max(img[:, :, c].astype(np.float32)[ok].mean(), 1e-6)
             for c in range(3)]
    wb = np.clip(img.astype(np.float32) * np.array(gains, np.float32), 0, 255)
    Vo, So = hsv(wb[Y0:Y1, X0:X1])
    Vr, Sr = hsv(ref[Y0:Y1, X0:X1])
    m = ok[Y0:Y1, X0:X1]
    if m.sum() < 500:
        return None
    # Whiter than the normal print: brighter AND less saturated at the same pixel.
    whiter = (Vo > Vr * 1.18) & (So < Sr - 0.12) & m
    return {
        "whiterFrac": float(whiter.sum() / max(m.sum(), 1)),
        "dV": float((Vo[m] - Vr[m]).mean()),
        "dS": float((So[m] - Sr[m]).mean()),
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
                 "n": len(vals),
                 **{k: float(np.median([v[k] for v in vals])) for k in vals[0]}})
json.dump(rows, open(f"{DIR}/stroke2.json", "w"), indent=2)

print("control — catalog against itself (must be ~0):")
for n in CAT:
    print(f'  {n:10s} whiterFrac={measure(CAT[n], n)["whiterFrac"]:.4f}')

print(f'\n{"card":10s}{"light":5s}{"variant":9s}{"n":>3s}{"whiterFrac":>12s}{"dV":>8s}{"dS":>8s}')
for r in sorted(rows, key=lambda x: (x["card"], x["variant"], x["light"])):
    print(f'{r["card"]:10s}{r["light"][:3]:5s}{r["variant"]:9s}{r["n"]:3d}'
          f'{r["whiterFrac"]:12.4f}{r["dV"]:8.1f}{r["dS"]:8.3f}')
