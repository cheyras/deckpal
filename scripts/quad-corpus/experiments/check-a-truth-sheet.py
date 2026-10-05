"""CHECK A, helper: a contact sheet for verifying identifications BY EYE.

    <phase0a venv python> scripts/quad-corpus/experiments/check-a-truth-sheet.py [variant]

For every front whose crop under `variant` (default H) is CONFIDENT against the
calibration gallery, tiles [human crop | gallery top-1 | detector crop |
detector top-1]. The verdicts read off it are recorded by hand in
<corpus>/check-a/truth-by-eye.json, which check-a-report.py reads.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

CORPUS = os.environ.get("QUAD_CORPUS_DIR", os.path.join(os.path.expanduser("~"), "deckpal-data", "quad-corpus"))
WORK = os.path.join(CORPUS, "check-a-work")
OUT = os.path.join(WORK, "view")


def main():
    v = sys.argv[1] if len(sys.argv) > 1 else "H"
    geo = json.load(open(os.path.join(WORK, "geometry.json")))
    emb = json.load(open(os.path.join(WORK, "embed.json")))
    R = emb["retrieval"]
    gal = emb["meta"]["gallery"]
    rows = [(i, r) for i, r in enumerate(geo["rows"]) if r["face"] == "front" and R[v][i]["level"] == "confident"]
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
    tw, th = 150, 209
    os.makedirs(OUT, exist_ok=True)
    for c in range(0, len(rows), 6):
        chunk = rows[c : c + 6]
        cs = Image.new("RGB", (4 * (tw + 6) + 6, len(chunk) * (th + 24)), (24, 24, 24))
        d = ImageDraw.Draw(cs)
        for k, (i, r) in enumerate(chunk):
            y = k * (th + 24)
            h1 = R["H"][i]["top"][0][0]
            d1 = R["DR"][i]["top"][0][0]
            tiles = [os.path.join(WORK, "crops", "%s-H.png" % r["id"]), os.path.join(gal, h1 + ".webp"),
                     os.path.join(WORK, "crops", "%s-DR.png" % r["id"]), os.path.join(gal, d1 + ".webp")]
            for j, f in enumerate(tiles):
                cs.paste(Image.open(f).convert("RGB").resize((tw, th), Image.LANCZOS), (6 + j * (tw + 6), y))
            d.text((6, y + th + 3), "%s | H %s %.3f %s | D %s %.3f %s" % (
                r["id"], h1, R["H"][i]["sim"], R["H"][i]["level"][:4], d1, R["DR"][i]["sim"], R["DR"][i]["level"][:4]),
                fill=(235, 235, 235), font=font)
        cs.save(os.path.join(OUT, "truth-%s-%02d.png" % (v, c)))
    print("%d confident %s fronts -> %s" % (len(rows), v, OUT))


if __name__ == "__main__":
    main()
