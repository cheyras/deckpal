"""
Separate the residual field into shading and specular, and measure their RATIO.

Dividing by the catalog removed the artwork, and across-lighting accuracy still
fell to 10/17 — because the residual's magnitude is then set by the illumination
GEOMETRY. A small directional source lays a strong smooth gradient across the
card; broad diffuse light lays almost none. The foil term was riding on top of a
base that moved further than it did.

But the two live at different spatial scales. Shading is smooth and global;
a specular glint is localised. So blur the residual to estimate the shading, take
what is left as the specular part, and report their RATIO — which cancels the
overall strength of the illumination, the thing that was moving.
"""
import json, os, glob
import cv2
import numpy as np

DIR = "/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
CARD_W, CARD_H = 480, 660
spec = json.load(open(f"{DIR}/segments.json"))
LABEL = {}
for c in spec["clips"]:
    for s in c["segments"]:
        LABEL[s["id"]] = {**s, "light": c["light"]}

def to_linear(u8):
    c = u8.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

CAT = {}
for n in ("Weedle", "Kakuna", "Ninetales"):
    im = cv2.imread(f"{DIR}/catalog/{n}.webp", cv2.IMREAD_COLOR)
    CAT[n] = cv2.resize(im, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)

wl = np.array([0.0722, 0.7152, 0.2126], np.float32)
rows = []
for path in sorted(glob.glob(f"{DIR}/reg/*.png")):
    base = os.path.basename(path)
    sid = base.split("__")[0]
    meta = LABEL.get(sid)
    if not meta:
        continue
    w = cv2.imread(path, cv2.IMREAD_COLOR)
    oL = (to_linear(w) * wl).sum(2)
    aL = (to_linear(CAT[meta["card"]]) * wl).sum(2)
    valid = (aL > 0.02) & (oL > 0.002) & (w.sum(2) > 0)
    if valid.sum() < 40000:
        continue
    logR = np.where(valid, np.log(np.maximum(oL, 1e-6) / np.maximum(aL, 1e-6)), 0).astype(np.float32)
    m = np.float32(valid)

    row = {"id": sid, "card": meta["card"], "light": meta["light"], "variant": meta["variant"]}
    for tag, sigma in (("s16", 16), ("s40", 40), ("s90", 90)):
        # Blur signal and mask together so invalid pixels do not drag the estimate.
        num = cv2.GaussianBlur(logR * m, (0, 0), sigma)
        den = cv2.GaussianBlur(m, (0, 0), sigma)
        low = num / np.maximum(den, 1e-3)
        high = (logR - low)[valid]
        lowv = low[valid]
        hs = float(high.std())
        ls = float(lowv.std())
        row[f"hi_{tag}"] = hs
        row[f"ratio_{tag}"] = hs / max(ls, 1e-3)      # specular relative to shading
        # Specular is ONE-SIDED: it only ever adds light. Shading and noise are
        # symmetric, so a positive tail is the part that cannot be either.
        row[f"skew_{tag}"] = float(((high / max(hs, 1e-6)) ** 3).mean())
        row[f"tail_{tag}"] = float((high > 2.0 * hs).mean())
    rows.append(row)

json.dump(rows, open(f"{DIR}/scale.json", "w"), indent=2)
print(f"measured {len(rows)}")
