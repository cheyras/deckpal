"""Embed the catalogue (gallery) and the benchmark crops (queries) with one model,
then score retrieval against ground truth.

    python scripts/scan-bench/embed.py gallery  --model timm:vit_base_patch32_clip_224.openai
    python scripts/scan-bench/embed.py queries  --model ... [--query-onnx int8.onnx]
    python scripts/scan-bench/embed.py score    --model ...

Preprocessing is the SHIPPED spec, `deckpal_matching.input_spec.embed_input_numpy`
(bit-exact with the TypeScript the server runs): catalogue art at margin 0, scanner
crops at the capture margin 0.05. A `timm:` model runs in torch on the GPU, which is
what the production gallery was built from (fp32); `--query-onnx` embeds the
queries with an ONNX file instead, e.g. the int8 model production queries with.

Outputs go to ~/deckpal-data/scan-bench/embed/<model-tag>/.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")  # this machine's commit charge is tight

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "packages" / "matching" / "python"))
from deckpal_matching.input_spec import embed_input_numpy  # noqa: E402

BENCH = Path(os.environ.get("SCAN_BENCH_DIR", Path.home() / "deckpal-data" / "scan-bench"))
CAPTURE_MARGIN = 0.05
# Queries are embedded ONE AT A TIME, as production embeds a capture. Dynamic int8
# (the shipped query quantisation) picks its activation scale per batch, so a
# crop embedded beside 31 others gets a slightly different vector than the same
# crop alone — enough to move a similarity by a few thousandths and a borderline
# capture across the gate. The fp32 gallery batches freely (no per-batch scale).
QUERY_BS = 1


def model_tag(spec: str) -> str:
    if spec.endswith(".onnx"):
        return Path(spec).stem
    return spec.replace("timm:", "").replace("/", "_").replace(":", "_")


def load_catalog():
    cat = json.loads((BENCH / "catalog.json").read_text(encoding="utf8"))
    return cat


def art_path(low: str | None) -> Path | None:
    import re

    m = re.search(r"images/en/([^/]+)/([^/]+)/([^/]+)/low\.webp$", low or "")
    return BENCH / "art" / "images" / "en" / m[1] / m[2] / f"{m[3]}.low.webp" if m else None


def preprocess(path: Path, margin: float) -> np.ndarray:
    im = Image.open(path).convert("RGBA")
    rgba = np.asarray(im, dtype=np.uint8).reshape(-1)
    return embed_input_numpy(rgba, im.width, im.height, margin_frac=margin)


class Embedder:
    def __init__(self, spec: str, onnx_path: str | None = None):
        self.onnx = None
        if onnx_path:
            import onnxruntime as ort

            self.onnx = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
            self.inp = self.onnx.get_inputs()[0].name
            return
        import torch
        import timm

        self.torch = torch
        self.dev = "cuda" if torch.cuda.is_available() else "cpu"
        if spec.endswith(".onnx"):
            import onnxruntime as ort

            self.onnx = ort.InferenceSession(spec, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            self.inp = self.onnx.get_inputs()[0].name
            return
        if spec.startswith("timm:"):
            self.model = timm.create_model(spec[5:], pretrained=True, num_classes=0).eval().to(self.dev)
        elif spec.endswith(".pt"):
            self.model = torch.jit.load(spec, map_location=self.dev).eval()
        else:
            raise SystemExit(f"unknown model spec {spec}")

    def __call__(self, batch: np.ndarray) -> np.ndarray:
        if self.onnx is not None:
            out = self.onnx.run(None, {self.inp: batch})[0]
        else:
            with self.torch.no_grad():
                out = self.model(self.torch.from_numpy(batch).to(self.dev)).float().cpu().numpy()
        out = out.astype(np.float64)
        out /= np.linalg.norm(out, axis=1, keepdims=True)
        return out.astype(np.float32)


def embed_paths(emb: Embedder, paths: list[Path], margin: float, bs: int = 64) -> np.ndarray:
    vecs = []
    t0 = time.time()
    for i in range(0, len(paths), bs):
        batch = np.stack([preprocess(p, margin) for p in paths[i : i + bs]])
        vecs.append(emb(batch))
        if (i // bs) % 50 == 0:
            print(f"  {i + len(batch)}/{len(paths)} ({time.time() - t0:.0f}s)", flush=True)
    return np.concatenate(vecs)


def cmd_gallery(a):
    out = BENCH / "embed" / model_tag(a.model)
    out.mkdir(parents=True, exist_ok=True)
    cat = load_catalog()
    rows = [(c["cardId"], art_path(c["low"])) for c in cat["cards"]]
    rows = [(i, p) for i, p in rows if p and p.exists()]
    print(f"gallery: {len(rows)} cards with art")
    vecs = embed_paths(Embedder(a.model), [p for _, p in rows], 0.0)
    np.savez(out / "gallery.npz", ids=np.array([i for i, _ in rows]), vecs=vecs)
    print(f"-> {out / 'gallery.npz'}")


def cmd_gallery_pocket(a):
    """The digital-only Pocket series, as distractors (scripts/scan-bench/pocket.mjs)."""
    out = BENCH / "embed" / model_tag(a.model)
    paths = sorted((BENCH / "art-pocket").glob("*.low.webp"))
    vecs = embed_paths(Embedder(a.model), paths, 0.0)
    np.savez(out / "gallery-pocket.npz", ids=np.array(["pocket:" + p.name.split(".")[0] for p in paths]), vecs=vecs)
    print(f"-> {out / 'gallery-pocket.npz'} ({len(paths)})")


def load_rows():
    rows = []
    for d in sorted((BENCH / "datasets").iterdir()):
        mf = d / "manifest.jsonl"
        if not mf.exists():
            continue
        for line in mf.read_text(encoding="utf8").splitlines():
            if line.strip():
                r = json.loads(line)
                r["_dir"] = d
                rows.append(r)
    return rows


def crop_path(r, full: bool) -> Path:
    rel = r.get("cropFull") if full and r.get("cropFull") else r["crop"]
    return r["_dir"] / rel


def query_dir(a) -> Path:
    """embed/<gallery tag>[-q_<query model>][<--tag-suffix>]: one query run's vectors."""
    return BENCH / "embed" / (model_tag(a.model) + ("-q_" + Path(a.query_onnx).stem if a.query_onnx else "") + a.tag_suffix)


def cmd_queries(a):
    out = query_dir(a)
    out.mkdir(parents=True, exist_ok=True)
    rows = [r for r in load_rows() if r["kind"] != "exclude"]
    emb = Embedder(a.model, a.query_onnx)
    for full in (False, True):
        sel = [r for r in rows if (not full) or r.get("cropFull")]
        if not sel:
            continue
        vecs = embed_paths(emb, [crop_path(r, full) for r in sel], CAPTURE_MARGIN, bs=QUERY_BS)
        tag = "full" if full else "crop"
        np.savez(out / f"queries-{tag}.npz", ids=np.array([r["id"] for r in sel]), vecs=vecs)
        print(f"-> {out / f'queries-{tag}.npz'} ({len(sel)})")


def cmd_score(a):
    qdir = query_dir(a)
    g = np.load(BENCH / "embed" / model_tag(a.model) / "gallery.npz")
    gids, gv = g["ids"], g["vecs"]
    if a.with_pocket:
        p = np.load(BENCH / "embed" / model_tag(a.model) / "gallery-pocket.npz")
        gids, gv = np.concatenate([gids, p["ids"]]), np.concatenate([gv, p["vecs"]])
        print(f"gallery + {len(p['ids'])} Pocket distractors")
    rows = {r["id"]: r for r in load_rows()}
    cat = load_catalog()
    name_of = {c["cardId"]: c["name"] for c in cat["cards"]}
    sim_min, margin_min, floor = a.sim_min, a.margin_min, 0.55
    report = {}
    for tag in ("crop", "full"):
        f = qdir / f"queries-{tag}.npz"
        if not f.exists():
            continue
        q = np.load(f)
        S = q["vecs"] @ gv.T
        order = np.argsort(-S, axis=1)[:, :25]
        per = []
        for qi, rid in enumerate(q["ids"]):
            r = rows[str(rid)]
            top = [str(gids[j]) for j in order[qi]]
            sims = [float(S[qi, j]) for j in order[qi]]
            truth = set(r.get("truth") or [])
            # margin to the best DIFFERENT card (what fuse.ts reads: top-1 minus top-2)
            margin = sims[0] - sims[1]
            # margin to the best candidate with a DIFFERENT NAME (same-art reprints excluded)
            nm = name_of.get(top[0])
            diff_name = next((s for c, s in zip(top[1:], sims[1:]) if name_of.get(c) != nm), sims[-1])
            rank = next((k for k, c in enumerate(top) if c in truth), None)
            decisive = sims[0] >= sim_min and margin >= margin_min
            per.append(
                dict(id=str(rid), dataset=r["dataset"], kind=r["kind"], truth=sorted(truth), top=top[:5], sims=sims[:5],
                     rank=rank, margin=margin, nameMargin=sims[0] - diff_name, decisive=decisive,
                     top1Correct=top[0] in truth, nameCorrect=bool(truth) and nm in {name_of.get(t) for t in truth})
            )
        report[tag] = per
        # What bench.ts feeds the ladder as `vectorMatches`: top-25 per row.
        (qdir / f"topk-{tag}.json").write_text(json.dumps({
            str(rid): [{"cardId": str(gids[j]), "similarity": round(float(S[qi, j]), 6)} for j in order[qi]]
            for qi, rid in enumerate(q["ids"])
        }))
        cards = [p for p in per if p["kind"] == "card" and p["truth"]]
        negs = [p for p in per if p["kind"] in ("negative", "card-back")]
        n = len(cards)
        if not n:
            continue
        top1 = sum(p["top1Correct"] for p in cards)
        top5 = sum(p["rank"] is not None and p["rank"] < 5 for p in cards)
        name1 = sum(p["nameCorrect"] for p in cards)
        dec = [p for p in cards if p["decisive"]]
        dec_ok = sum(p["top1Correct"] for p in dec)
        print(f"\n== {tag} crops: {n} cards, {len(negs)} negatives/backs ==")
        print(f"top-1 card {top1}/{n} ({top1 / n:.1%})  top-5 {top5}/{n} ({top5 / n:.1%})  top-1 NAME {name1}/{n} ({name1 / n:.1%})")
        print(f"gate (sim>={sim_min}, margin>={margin_min}): confident {len(dec)}/{n} ({len(dec) / n:.1%}), "
              f"correct {dec_ok}/{len(dec) or 1} ({dec_ok / max(1, len(dec)):.1%}); negatives confident {sum(p['decisive'] for p in negs)}/{len(negs)}")
        by_ds = {}
        for p in cards:
            d = by_ds.setdefault(p["dataset"], [0, 0, 0, 0])
            d[0] += 1
            d[1] += p["top1Correct"]
            d[2] += p["decisive"]
            d[3] += p["decisive"] and p["top1Correct"]
        for ds, (m, t1, dc, dcok) in sorted(by_ds.items()):
            print(f"   {ds:28s} n={m:3d} top-1 {t1 / m:5.1%}  confident {dc / m:5.1%} (correct {dcok}/{dc})")
    (qdir / "score.json").write_text(json.dumps(report, indent=1))
    print(f"\n-> {qdir / 'score.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gallery", "gallery-pocket", "queries", "score"])
    ap.add_argument("--with-pocket", action="store_true")
    ap.add_argument("--tag-suffix", default="", help="appended to the query run's directory name (queries/score), e.g. --tag-suffix=-bs1")
    ap.add_argument("--model", default="timm:vit_base_patch32_clip_224.openai")
    ap.add_argument("--query-onnx", default=None)
    ap.add_argument("--sim-min", type=float, default=0.74)
    ap.add_argument("--margin-min", type=float, default=0.02)
    a = ap.parse_args()
    {"gallery": cmd_gallery, "gallery-pocket": cmd_gallery_pocket, "queries": cmd_queries, "score": cmd_score}[a.cmd](a)


if __name__ == "__main__":
    main()
