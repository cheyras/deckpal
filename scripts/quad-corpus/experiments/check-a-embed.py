"""CHECK A, step 2: embed the crops check-a.ts built, and retrieve them.

    <phase0a venv python> scripts/quad-corpus/experiments/check-a-embed.py

* The model is the PRODUCTION identity checkpoint: the int8 clip-vit-b32-openai
  whose sha256 scripts/fetch-embed-model.mjs pins (MODEL_SHA256). The digest is
  re-checked here and the run refuses any other file.
* Query tensors are exactly what packages/matching embedInput() produced in
  check-a.ts (marginFrac = CAPTURE_MARGIN), read from the .f32 dumps.
* The gallery is the 6,464 catalogue renders the shipped thresholds were
  calibrated on (p2-work/embed-spike/gallery), embedded the way
  tools/embed-catalog/embed_worker.py does it: Pillow RGBA ->
  deckpal_matching.embed_input_numpy(margin 0) -> model -> L2.
Writes embed.json (self-similarities + retrieval per row) to the work dir.
"""
import hashlib
import json
import os
import sys

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "packages", "matching", "python"))
from deckpal_matching.input_spec import EMBED_SIZE, embed_input_numpy  # noqa: E402

CORPUS = os.environ.get("QUAD_CORPUS_DIR", os.path.join(os.path.expanduser("~"), "deckpal-data", "quad-corpus"))
WORK = os.path.join(CORPUS, "check-a-work")
MODEL = os.environ.get(
    "CHECK_A_EMBED_MODEL",
    "E:/users/cheyr/deckpal-wt/scan-harness/apps/api/assets/embed/clip-vit-b32-openai.onnx",
)
MODEL_SHA256 = "871a5a900b284ce0c1e5615fd43bf5c24828f003545df2a1a193947131421759"  # fetch-embed-model.mjs
GALLERY = "E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/embed-spike/gallery"
SIM_MIN, MARGIN_MIN, SIM_FLOOR = 0.74, 0.02, 0.55  # confidence.ts, clip-vit-b32-openai
BATCH = 32


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_session():
    digest = sha256(MODEL)
    if digest != MODEL_SHA256:
        sys.exit("model digest %s is not production's %s" % (digest, MODEL_SHA256))
    sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
    return sess, sess.get_inputs()[0].name


def run(sess, name, x):
    """x: (n, 3, 224, 224) float32 -> (n, 768) L2-normalised float64."""
    outs = []
    for i in range(0, len(x), BATCH):
        b = x[i : i + BATCH]
        try:
            o = sess.run(None, {name: b})[0]
        except Exception:  # a fixed-batch export: fall back to one at a time
            o = np.concatenate([sess.run(None, {name: b[j : j + 1]})[0] for j in range(len(b))])
        outs.append(o.astype(np.float64))
    e = np.concatenate(outs)
    return e / np.linalg.norm(e, axis=1, keepdims=True)


def gallery_embeddings(sess, name):
    cache = os.path.join(WORK, "gallery-emb.npz")
    files = sorted(f for f in os.listdir(GALLERY) if f.endswith(".webp"))
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=False)
        if list(z["ids"]) == [f[:-5] for f in files]:
            return list(z["ids"]), z["emb"]
    embs = []
    for i in range(0, len(files), BATCH):
        xs = []
        for f in files[i : i + BATCH]:
            im = Image.open(os.path.join(GALLERY, f)).convert("RGBA")
            rgba = np.asarray(im, dtype=np.uint8).reshape(-1)
            xs.append(embed_input_numpy(rgba, im.width, im.height, margin_frac=0.0))
        embs.append(run(sess, name, np.stack(xs)))
        if (i // BATCH) % 20 == 0:
            print("  gallery %d/%d" % (min(i + BATCH, len(files)), len(files)), flush=True)
    emb = np.concatenate(embs)
    ids = [f[:-5] for f in files]
    np.savez(cache, ids=np.array(ids), emb=emb)
    return ids, emb


def retrieve(q, gallery, ids, k=5):
    sims = q @ gallery.T
    order = np.argsort(-sims, axis=1)[:, :k]
    out = []
    for r in range(len(q)):
        top = [(ids[j], float(sims[r, j])) for j in order[r]]
        s1, s2 = top[0][1], top[1][1]
        margin = s1 - s2
        if s1 < SIM_FLOOR:
            level = "none"
        elif s1 >= SIM_MIN and margin >= MARGIN_MIN:
            level = "confident"
        else:
            level = "uncertain"
        out.append({"top": top, "sim": s1, "margin": margin, "level": level})
    return out


def main():
    geo = json.load(open(os.path.join(WORK, "geometry.json")))
    n = len(geo["rows"])
    variants = geo["meta"]["variants"]
    sess, name = make_session()
    print("model ok (%s), input %s" % (MODEL_SHA256[:12], name), flush=True)

    per = 3 * EMBED_SIZE * EMBED_SIZE
    E = {}
    for v in variants:
        x = np.fromfile(os.path.join(WORK, "tensors-%s.f32" % v), dtype=np.float32)
        assert x.size == n * per, (v, x.size)
        E[v] = run(sess, name, x.reshape(n, 3, EMBED_SIZE, EMBED_SIZE))
        print("  embedded %s" % v, flush=True)
    np.savez(os.path.join(WORK, "query-emb.npz"), **E)

    ids, gal = gallery_embeddings(sess, name)
    print("gallery %d x %d" % gal.shape, flush=True)

    self_sim = {v: np.sum(E["H"] * E[v], axis=1).tolist() for v in variants if v != "H"}
    # A baseline for scale: the human crops of DIFFERENT cards against each other.
    HH = E["H"] @ E["H"].T
    iu = np.triu_indices(n, 1)
    retr = {v: retrieve(E[v], gal, ids) for v in variants}
    json.dump(
        {
            "meta": {"model": MODEL, "sha256": MODEL_SHA256, "gallery": GALLERY, "gallerySize": len(ids),
                     "thresholds": {"simMin": SIM_MIN, "marginMin": MARGIN_MIN, "simFloor": SIM_FLOOR}},
            "selfSim": self_sim,
            "interCard": HH[iu].tolist(),
            "retrieval": retr,
        },
        open(os.path.join(WORK, "embed.json"), "w"),
    )
    print("wrote embed.json")


if __name__ == "__main__":
    main()
