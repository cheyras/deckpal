"""
Register each frame to the catalog card, then divide the artwork out.

Hand-rolled registration failed three times, and each failure looked like a
different bug: a blob threshold that grabbed the sleeve, a similarity search
whose range could not reach the answer, then coordinate descent that settled into
a local optimum because card art is repetitive enough (rows of text, a border,
a frame) that a partial overlap scores well. All three were the same mistake —
trying to find a projective transform without correspondences.

SIFT + RANSAC finds correspondences and rejects the ones that disagree, which is
what makes it robust to the hand, the sleeve glare and the background. It is also
the standard answer, and the earlier attempts were reinventing it badly.

What we do once registered:

    O = A·S·L + R·L         albedo × shading × illuminant, plus specular
    O / A = L·(S + R/A)

Dividing by the catalog removes the ARTWORK, which is the term that beat the
previous approach — Kakuna's bright sunset dominated every statistic and swamped
the foil effect across lighting. What survives is shading plus specular, and the
specular term is amplified wherever the albedo is dark, which bright art cannot
imitate.
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


def to_linear(img_u8):
    c = img_u8.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


sift = cv2.SIFT_create(nfeatures=3000)
bf = cv2.BFMatcher()

CAT, CAT_KP = {}, {}
for name in ("Weedle", "Kakuna", "Ninetales"):
    im = cv2.imread(f"{DIR}/catalog/{name}.webp", cv2.IMREAD_COLOR)
    im = cv2.resize(im, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)
    CAT[name] = im
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    CAT_KP[name] = sift.detectAndCompute(g, None)

rows, failed = [], 0
files = sorted(glob.glob(f"{DIR}/full/*.png"))
for path in files:
    base = os.path.basename(path)
    sid = base.split("__")[0]
    meta = LABEL.get(sid)
    if not meta or meta["card"] not in CAT:
        continue

    frame = cv2.imread(path, cv2.IMREAD_COLOR)
    fg = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    kp2, des2 = sift.detectAndCompute(fg, None)
    kp1, des1 = CAT_KP[meta["card"]]
    if des2 is None or len(kp2) < 20:
        failed += 1
        continue

    good = []
    for m, n in bf.knnMatch(des1, des2, k=2):
        if m.distance < 0.75 * n.distance:   # Lowe's ratio test
            good.append(m)
    if len(good) < 15:
        failed += 1
        continue

    src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if H is None:
        failed += 1
        continue
    inliers = int(mask.sum())
    if inliers < 15:
        failed += 1
        continue

    # Frame -> card space. `H` maps catalog into the frame, so its inverse warps
    # the frame back onto the catalog's own grid.
    warped = cv2.warpPerspective(frame, np.linalg.inv(H), (CARD_W, CARD_H))
    cv2.imwrite(f"{DIR}/reg/{base}", warped)

    obs = to_linear(warped)
    alb = to_linear(CAT[meta["card"]])
    wl = np.array([0.0722, 0.7152, 0.2126], np.float32)  # BGR
    oL = (obs * wl).sum(2)
    aL = (alb * wl).sum(2)

    # Where the warp had no source pixel, or the albedo is too dark to divide by.
    valid = (aL > 0.02) & (oL > 0.002) & (warped.sum(2) > 0)
    if valid.sum() < 40000:
        failed += 1
        continue

    logR = np.log(oL[valid] / aL[valid])
    invA = -np.log(aL[valid])
    mx = warped.max(2).astype(np.float32)
    mn = warped.min(2).astype(np.float32)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)[valid]

    rows.append({
        "id": sid, "card": meta["card"], "light": meta["light"],
        "variant": meta["variant"], "sleeve": meta.get("sleeve"),
        "inliers": inliers, "n": int(valid.sum()),
        # How structured the residual field is once the art is gone.
        "ratioSd": float(logR.std()),
        # Specular blows up where albedo is dark; diffuse shading does not.
        "darkGain": float(np.corrcoef(logR, invA)[0, 1]),
        # The bright tail of the residual.
        "ratioSpread": float(np.percentile(logR, 98) - np.percentile(logR, 50)),
        # Achromatic where the residual is high.
        "ratioCorrLS": float(np.corrcoef(logR, sat)[0, 1]),
    })

os.makedirs(f"{DIR}/reg", exist_ok=True)
json.dump(rows, open(f"{DIR}/register.json", "w"), indent=2)
print(f"registered {len(rows)}/{len(files)}  (failed {failed})")
by = {}
for r in rows:
    by.setdefault(f'{r["card"]}|{r["light"]}|{r["variant"]}', []).append(r["inliers"])
for k in sorted(by):
    v = by[k]
    print(f"  {k:36s} n={len(v):2d}  inliers {sum(v)/len(v):.0f}")
