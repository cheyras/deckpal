"""
Does the card's appearance CHANGE in a spatially structured way as it tilts?

This is the one test registration makes possible and nothing before could do.
Every previous feature described a single frame, and a single frame's appearance
is set by the illumination as much as by the print — which is exactly why none of
them survived a change of light.

A difference between two frames of the SAME card under the SAME light cancels the
illumination. What is left is what changed: the hand moved, so a view-dependent
surface redistributes its highlight across the card, and a matte surface does not.
Global exposure drift is removed by subtracting the median, so what remains is
spatial structure.

Registration error shows up at ALBEDO EDGES, so the measurement is confined to
flat regions of the artwork — where a mis-registration of a pixel or two changes
almost nothing and a moving specular lobe still changes a lot.
"""
import json, os, glob, re
import cv2, numpy as np

DIR = "/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
CARD_W, CARD_H = 480, 660
spec = json.load(open(f"{DIR}/segments.json"))
LABEL = {}
for c in spec["clips"]:
    for s in c["segments"]:
        LABEL[s["id"]] = {**s, "light": c["light"]}

CAT_FLAT = {}
for n in ("Weedle", "Kakuna", "Ninetales"):
    im = cv2.imread(f"{DIR}/catalog/{n}.webp", cv2.IMREAD_COLOR)
    im = cv2.resize(im, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    grad = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, 3), cv2.Sobel(g, cv2.CV_32F, 0, 1, 3))
    grad = cv2.GaussianBlur(grad, (0, 0), 3)
    CAT_FLAT[n] = (grad < np.percentile(grad, 55),      # flat artwork: specular shows here
                   grad > np.percentile(grad, 88))       # sharp edges: motion/misregistration shows here

groups = {}
for p in sorted(glob.glob(f"{DIR}/reg/*.png")):
    sid = os.path.basename(p).split("__")[0]
    groups.setdefault(sid, []).append(p)

rows = []
for sid, paths in groups.items():
    meta = LABEL.get(sid)
    if not meta or len(paths) < 3:
        continue
    flat, edge = CAT_FLAT[meta["card"]]
    prev = None
    ds = []
    for p in sorted(paths):
        img = cv2.imread(p, cv2.IMREAD_COLOR).astype(np.float32)
        L = (img * np.array([0.0722, 0.7152, 0.2126], np.float32)).sum(2)
        ok = (img.sum(2) > 0)
        cur = (np.log(np.maximum(L, 1.0)), ok)
        if prev is not None:
            base = prev[1] & cur[1]
            vf, ve = base & flat, base & edge
            if vf.sum() > 20000 and ve.sum() > 6000:
                dif = cur[0] - prev[0]
                dif = dif - np.median(dif[base])   # remove global exposure/gain drift
                ds.append((dif[vf], dif[ve]))
        prev = cur
    if len(ds) < 2:
        continue
    sd  = [float(f.std()) for f, e in ds]
    esd = [float(e.std()) for f, e in ds]
    # Flat-region change RELATIVE to edge change. Both scale with how far the
    # hand moved and with registration slop; only the flat one is inflated by a
    # highlight sliding across the card.
    rel = [float(f.std() / max(e.std(), 1e-6)) for f, e in ds]
    p95 = [float(np.percentile(np.abs(f), 95)) for f, e in ds]
    rows.append({
        "id": sid, "card": meta["card"], "light": meta["light"], "variant": meta["variant"],
        "pairs": len(ds),
        "moveSd": float(np.mean(sd)),
        "edgeSd": float(np.mean(esd)),
        "relSd": float(np.mean(rel)),        # the motion-normalised one
        "relMax": float(np.max(rel)),
        "moveP95": float(np.mean(p95)),
    })

json.dump(rows, open(f"{DIR}/motion.json", "w"), indent=2)
print(f"measured {len(rows)} segments")
for r in sorted(rows, key=lambda x: (x["card"], x["light"], x["variant"])):
    print(f'  {r["card"]:10s}{r["light"][:3]} {r["variant"]:8s}pairs={r["pairs"]:2d}  '
          f'moveSd={r["moveSd"]:.3f}  edgeSd={r["edgeSd"]:.3f}  relSd={r["relSd"]:.3f}')
