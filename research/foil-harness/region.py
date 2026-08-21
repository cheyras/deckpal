"""
Where is the specular, relative to the card's known layout?

The strongest idea in the literature pass, and the one axis every absolute
statistic lacked. Bulbapedia's taxonomy: Reverse Holo foils the card BODY and
excludes the artwork; Holofoil foils the ARTWORK and not the body; Normal has
neither. So the ratio of specular activity in one region to the other is measured
WITHIN a single frame, on one object, under one illuminant, at one exposure and
one sensor gain. Illuminant colour, brightness, camera gain and the clear varnish
that coats BOTH printings are all common-mode and cancel in the ratio.

Also tests the report's claim against my own earlier reading of these frames — I
concluded from the Weedle footage that this era foils the whole card including
the art. One of us is wrong and the ratio will say which.

Two measures per region:
  · temporal — how much the region CHANGES between frames (a highlight sliding)
  · saturation excess — observed saturation above the catalog's, which under an
    achromatic illuminant is a physical bound a diffuse surface cannot exceed
"""
import json, os, glob
import cv2, numpy as np

DIR = "/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
W, H = 480, 660
ART = (0.055, 0.115, 0.945, 0.520)

spec = json.load(open(f"{DIR}/segments.json"))
LABEL = {}
for c in spec["clips"]:
    for s in c["segments"]:
        LABEL[s["id"]] = {**s, "light": c["light"]}

x0, y0, x1, y1 = int(ART[0]*W), int(ART[1]*H), int(ART[2]*W), int(ART[3]*H)
art = np.zeros((H, W), bool); art[y0:y1, x0:x1] = True
body = np.ones((H, W), bool)
b = int(0.05*W)
body[:b, :] = False; body[-b:, :] = False; body[:, :b] = False; body[:, -b:] = False
body[y0:y1, x0:x1] = False

CAT, FLAT, SATREF = {}, {}, {}
for n in ("Weedle", "Kakuna", "Ninetales"):
    im = cv2.resize(cv2.imread(f"{DIR}/catalog/{n}.webp"), (W, H), interpolation=cv2.INTER_AREA)
    CAT[n] = im
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    grad = cv2.GaussianBlur(cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, 3),
                                          cv2.Sobel(g, cv2.CV_32F, 0, 1, 3)), (0, 0), 3)
    FLAT[n] = grad < np.percentile(grad, 60)   # avoid ink edges: misregistration lives there
    f = im.astype(np.float32)
    mx, mn = f.max(2), f.min(2)
    SATREF[n] = np.where(mx > 0, (mx - mn)/np.maximum(mx, 1e-6), 0)

groups = {}
for p in sorted(glob.glob(f"{DIR}/reg/*.png")):
    groups.setdefault(os.path.basename(p).split("__")[0], []).append(p)

rows = []
for sid, paths in groups.items():
    meta = LABEL.get(sid)
    if not meta or len(paths) < 3:
        continue
    card = meta["card"]
    flat = FLAT[card]
    aM, bM = art & flat, body & flat
    prev = None
    dA, dB, exA, exB = [], [], [], []
    for p in sorted(paths):
        img = cv2.imread(p).astype(np.float32)
        ok = img.sum(2) > 0
        # WHITE BALANCE AGAINST THE REFERENCE. The catalog is effectively a colour
        # chart for this exact card, so the illuminant is a least-squares fit
        # rather than an unknown — which is what makes the saturation bound below
        # meaningful under a warm lamp.
        gains = []
        for ch in range(3):
            o = img[:, :, ch][ok].mean()
            a = CAT[card][:, :, ch].astype(np.float32)[ok].mean()
            gains.append(a / max(o, 1e-6))
        wb = img * np.array(gains, np.float32)
        mx, mn = wb.max(2), wb.min(2)
        sat = np.where(mx > 0, (mx - mn)/np.maximum(mx, 1e-6), 0)
        # One-sided: diffuse reflection under achromatic light cannot RAISE
        # saturation above the albedo's. Excess is spectrally-selective return.
        # Clipped pixels are excluded — glare bleaches, it does not inform.
        unclipped = (img.max(2) < 250) & ok
        # SIGNED, not clipped. Clipping at zero throws away the half of the
        # measurement that carries the signal: a foiled region is DESATURATED
        # relative to its own printed albedo, because an achromatic highlight is
        # being added to it. Rectifying that to zero left only the noise floor of
        # the unfoiled region to discriminate on.
        ex = sat - SATREF[card]
        if (aM & unclipped).sum() > 3000 and (bM & unclipped).sum() > 3000:
            exA.append(float(ex[aM & unclipped].mean()))
            exB.append(float(ex[bM & unclipped].mean()))
        L = np.log(np.maximum((img * np.array([0.0722, 0.7152, 0.2126], np.float32)).sum(2), 1.0))
        if prev is not None:
            v = prev[1] & ok
            d = L - prev[0]
            d = d - np.median(d[v])
            if (aM & v).sum() > 3000 and (bM & v).sum() > 3000:
                dA.append(float(d[aM & v].std()))
                dB.append(float(d[bM & v].std()))
        prev = (L, ok)
    if len(dA) < 2 or len(exA) < 2:
        continue
    mA, mB = float(np.mean(dA)), float(np.mean(dB))
    eA, eB = float(np.mean(exA)), float(np.mean(exB))
    rows.append({
        "id": sid, "card": card, "light": meta["light"], "variant": meta["variant"],
        "pairs": len(dA),
        "moveArt": mA, "moveBody": mB, "moveRatio": mB / max(mA, 1e-6),
        "exArt": eA, "exBody": eB, "exRatio": eB / max(eA, 1e-6),
        "exDiff": eB - eA,
    })

json.dump(rows, open(f"{DIR}/region.json", "w"), indent=2)
print(f"measured {len(rows)} segments\n")
print(f'{"card":10s}{"light":5s}{"variant":9s}{"mvArt":>7s}{"mvBody":>8s}{"mvRatio":>9s}{"exArt":>8s}{"exBody":>8s}{"exRatio":>9s}')
for r in sorted(rows, key=lambda x: (x["card"], x["light"], x["variant"])):
    print(f'{r["card"]:10s}{r["light"][:3]:5s}{r["variant"]:9s}'
          f'{r["moveArt"]:7.3f}{r["moveBody"]:8.3f}{r["moveRatio"]:9.3f}'
          f'{r["exArt"]:8.4f}{r["exBody"]:8.4f}{r["exRatio"]:9.3f}')
