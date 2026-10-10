"""Fine-tune the scanner's identity embedding on the catalogue itself.

    python tools/scan-embed/train.py --run r1 [--model vit_base_patch32_clip_224.openai]
                                     [--epochs 20] [--batch 256] [--lr 2e-5]

The shipped embedding is CLIP used zero-shot: a general photo model that has
never been asked to tell one Pokémon card from another, matched against clean
catalogue renders. This trains it for exactly that job. Every catalogue card is
its own class; each step pairs a synthetic scanner capture of a card
(`augment.synth_capture`) with the card's clean render and pulls the two
together against every other card in the batch (symmetric InfoNCE).

THE BATCH IS BUILT FROM NAME FAMILIES, on purpose. A random batch of 256 out of
20k cards almost never holds two Pikachus, so the loss would never have to learn
the difference between printings, which is the difference the scanner most often
gets wrong. Batches are filled a family at a time (up to `--per-family` printings
of one name), so the hard negatives are always in the room.

SAME-ART REPRINTS ARE NOT NEGATIVES. Two printings with identical artwork (an
Ultra Ball reprinted in another set) differ only in a set badge and a number a
few pixels tall at 224 px. Asking the model to push them apart teaches it noise.
They are grouped (same name AND dHash within `--art-dist` bits) and masked out of
each other's negatives; the printing between them is OCR's job (the set code and
number), which is where the ladder already looks.

Validation is the real benchmark, never trained on: top-1 on the 256 real crops
under ~/deckpal-data/scan-bench/datasets, by card and by art group.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset, Sampler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from augment import synth_capture  # noqa: E402

BENCH = Path(os.environ.get("SCAN_BENCH_DIR", Path.home() / "deckpal-data" / "scan-bench"))
RUNS = Path(os.environ.get("SCAN_EMBED_RUNS", Path.home() / "deckpal-data" / "scan-embed" / "runs"))
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)
MARGIN = 0.05


def art_path(low):
    import re

    m = re.search(r"images/en/([^/]+)/([^/]+)/([^/]+)/low\.webp$", low or "")
    return BENCH / "art" / "images" / "en" / m[1] / m[2] / f"{m[3]}.low.webp" if m else None


def to_u8(img: np.ndarray, margin: float, size: int) -> np.ndarray:
    """Crop the capture margin and box-filter squash to size x size, as uint8 HWC.
    The DataLoader ships these (4x smaller than float32 CHW: on this machine the
    shared-memory batches hit the Windows commit limit) and `normalize` finishes
    the spec on the GPU."""
    h, w = img.shape[:2]
    if margin > 0:
        fx = int(math.floor(w * margin / (1 + 2 * margin) + 0.5))
        fy = int(math.floor(h * margin / (1 + 2 * margin) + 0.5))
        img = img[fy : h - fy, fx : w - fx]
    return cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)


_MEAN_T = _STD_T = None


def normalize(x_u8: torch.Tensor) -> torch.Tensor:
    """uint8 NHWC on the device -> the spec's float NCHW."""
    global _MEAN_T, _STD_T
    if _MEAN_T is None or _MEAN_T.device != x_u8.device:
        _MEAN_T = torch.tensor(MEAN, device=x_u8.device).view(1, 3, 1, 1)
        _STD_T = torch.tensor(STD, device=x_u8.device).view(1, 3, 1, 1)
    x = x_u8.permute(0, 3, 1, 2).float() / 255.0
    return (x - _MEAN_T) / _STD_T


def to_input(img: np.ndarray, margin: float, size: int) -> np.ndarray:
    """The shipped spec's geometry (crop the capture margin, box-filter squash to
    size x size, CLIP mean/std, CHW). cv2's INTER_AREA is the box filter; it is
    not bit-exact with `input_spec`, which only the evaluation needs to be."""
    h, w = img.shape[:2]
    if margin > 0:
        fx = int(math.floor(w * margin / (1 + 2 * margin) + 0.5))
        fy = int(math.floor(h * margin / (1 + 2 * margin) + 0.5))
        img = img[fy : h - fy, fx : w - fx]
    x = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    return ((x - MEAN) / STD).transpose(2, 0, 1).copy()


def load_catalog():
    cat = json.loads((BENCH / "catalog.json").read_text(encoding="utf8"))
    cards = [c for c in cat["cards"] if art_path(c["low"]) and art_path(c["low"]).exists()]
    return cat, cards


def art_groups(cards, max_dist: int):
    """card index -> art-group id: same name and dHash within max_dist bits."""
    ph = json.loads((BENCH / "phash-index.json").read_text())
    by_name = defaultdict(list)
    for i, c in enumerate(cards):
        by_name[c["name"].lower()].append(i)
    group = list(range(len(cards)))

    def find(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    for idxs in by_name.values():
        hs = [int(ph.get(cards[i]["cardId"], "0"), 16) for i in idxs]
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                if bin(hs[a] ^ hs[b]).count("1") <= max_dist:
                    group[find(idxs[a])] = find(idxs[b])
    return [find(i) for i in range(len(cards))], by_name


class CardSet(Dataset):
    def __init__(self, cards, size, seed=0):
        self.cards = cards
        self.size = size
        self.seed = seed
        self._cache = {}

    def art(self, i):
        a = self._cache.get(i)
        if a is None:
            a = np.asarray(Image.open(art_path(self.cards[i]["low"])).convert("RGB"))
            if len(self._cache) < 200:
                self._cache[i] = a
        return a

    def __len__(self):
        return len(self.cards)

    def __getitem__(self, i):
        rng = np.random.default_rng((self.seed * 1_000_003 + i * 7919 + random.getrandbits(31)) & 0xFFFFFFFF)
        art = self.art(i)
        others = [self.art(int(rng.integers(len(self.cards))))] if rng.random() < 0.5 else None
        q = synth_capture(art, rng, others)
        return torch.from_numpy(to_u8(q, MARGIN, self.size)), torch.from_numpy(to_u8(art, 0.0, self.size)), i


class FamilyBatches(Sampler):
    """Yield index lists that fill a batch a name family at a time."""

    def __init__(self, by_name_idx, batch, per_family, n_batches, seed=0):
        self.fams = [v for v in by_name_idx.values()]
        self.batch, self.per, self.n, self.seed = batch, per_family, n_batches, seed

    def __len__(self):
        return self.n

    def __iter__(self):
        rng = random.Random(self.seed + int(time.time()))
        for _ in range(self.n):
            out, seen = [], set()
            while len(out) < self.batch:
                fam = self.fams[rng.randrange(len(self.fams))]
                for i in rng.sample(fam, min(len(fam), self.per)):
                    if i not in seen and len(out) < self.batch:
                        seen.add(i)
                        out.append(i)
            yield out


class Embedder(torch.nn.Module):
    def __init__(self, name, dim_out=None):
        super().__init__()
        import timm

        self.backbone = timm.create_model(name, pretrained=True, num_classes=0)
        # Activations are most of the memory at batch 256 x 2 views, and this
        # machine's GPU is shared with the desktop: recompute them in backward.
        if hasattr(self.backbone, "set_grad_checkpointing"):
            self.backbone.set_grad_checkpointing(True)
        self.proj = None
        if dim_out:
            self.proj = torch.nn.Linear(self.backbone.num_features, dim_out, bias=False)

    def forward(self, x):
        f = self.backbone(x)
        if self.proj is not None:
            f = self.proj(f)
        return F.normalize(f.float(), dim=-1)


def real_eval(model, size, device, gallery_vecs, gallery_ids, name_of, group_of_id):
    """Top-1 on the real benchmark crops (crop + full-res variants)."""
    rows = []
    for d in sorted((BENCH / "datasets").iterdir()):
        mf = d / "manifest.jsonl"
        if mf.exists():
            for line in mf.read_text(encoding="utf8").splitlines():
                if line.strip():
                    r = json.loads(line)
                    if r["kind"] == "card" and r["truth"]:
                        rows.append((d, r))
    xs = []
    for d, r in rows:
        rel = r.get("cropFull") or r["crop"]
        xs.append(to_input(np.asarray(Image.open(d / rel).convert("RGB")), MARGIN, size))
    model.eval()
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
        q = torch.cat([model(torch.from_numpy(np.stack(xs[i : i + 64])).to(device)) for i in range(0, len(xs), 64)])
    S = q.float() @ gallery_vecs.T
    top2 = S.topk(2, dim=1)
    ok = ok_group = ok_name = 0
    margins = []
    for k, (d, r) in enumerate(rows):
        top = gallery_ids[top2.indices[k, 0].item()]
        truth = set(r["truth"])
        ok += top in truth
        ok_group += group_of_id.get(top) in {group_of_id.get(t) for t in truth}
        ok_name += name_of.get(top) in {name_of.get(t) for t in truth}
        margins.append((top2.values[k, 0] - top2.values[k, 1]).item())
    n = len(rows)
    return dict(n=n, top1=ok / n, top1_artgroup=ok_group / n, top1_name=ok_name / n, margin_med=float(np.median(margins)))


def embed_gallery(model, cards, size, device, bs=256):
    model.eval()
    vecs = []
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
        for i in range(0, len(cards), bs):
            x = np.stack([to_input(np.asarray(Image.open(art_path(c["low"])).convert("RGB")), 0.0, size) for c in cards[i : i + bs]])
            vecs.append(model(torch.from_numpy(x).to(device)).float())
    return torch.cat(vecs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--model", default="vit_base_patch32_clip_224.openai")
    ap.add_argument("--size", type=int, default=224)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--per-family", type=int, default=4)
    ap.add_argument("--art-dist", type=int, default=6)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--wd", type=float, default=0.05)
    ap.add_argument("--temp", type=float, default=0.05)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--eval-every", type=int, default=2)
    ap.add_argument("--dim-out", type=int, default=0,
                    help="project to this many dims (768 keeps card_embedding's vector(768) schema for a non-ViT backbone)")
    a = ap.parse_args()

    out = RUNS / a.run
    out.mkdir(parents=True, exist_ok=True)
    (out / "args.json").write_text(json.dumps(vars(a), indent=1))
    device = "cuda"
    torch.backends.cuda.matmul.allow_tf32 = True

    cat, cards = load_catalog()
    groups, by_name = art_groups(cards, a.art_dist)
    id_of = [c["cardId"] for c in cards]
    name_of = {c["cardId"]: c["name"].lower() for c in cards}
    group_of_id = {id_of[i]: groups[i] for i in range(len(cards))}
    groups_t = torch.tensor(groups, device=device)
    n_groups = len(set(groups))
    print(f"{len(cards)} cards, {len(by_name)} name families, {n_groups} art groups "
          f"({len(cards) - n_groups} cards share art with another printing)")

    model = Embedder(a.model, a.dim_out or None).to(device)
    logit_scale = torch.nn.Parameter(torch.tensor(math.log(1 / a.temp), device=device))
    opt = torch.optim.AdamW([{"params": model.parameters()}, {"params": [logit_scale], "lr": 1e-3, "weight_decay": 0}],
                            lr=a.lr, weight_decay=a.wd)
    steps_per_epoch = math.ceil(len(cards) / a.batch)
    total = steps_per_epoch * a.epochs
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, s / max(1, steps_per_epoch)) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / total))))

    ds = CardSet(cards, a.size)
    sampler = FamilyBatches(by_name, a.batch, a.per_family, steps_per_epoch)
    dl = DataLoader(ds, batch_sampler=sampler, num_workers=a.workers, persistent_workers=a.workers > 0,
                    prefetch_factor=2 if a.workers else None, pin_memory=False)

    def evaluate(tag):
        gv = embed_gallery(model, cards, a.size, device)
        m = real_eval(model, a.size, device, gv, id_of, name_of, group_of_id)
        m["tag"] = tag
        print(f"[eval {tag}] real top-1 {m['top1']:.1%}  art-group {m['top1_artgroup']:.1%}  "
              f"name {m['top1_name']:.1%}  margin med {m['margin_med']:.3f}  (n={m['n']})", flush=True)
        with open(out / "eval.jsonl", "a") as f:
            f.write(json.dumps(m) + "\n")
        return m

    best = evaluate("epoch0")
    step = 0
    for ep in range(1, a.epochs + 1):
        model.train()
        t0 = time.time()
        tot = 0.0
        for q, k, idx in dl:
            q, k, idx = normalize(q.to(device, non_blocking=True)), normalize(k.to(device, non_blocking=True)), idx.to(device)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                zq, zk = model(q), model(k)
            logits = (zq @ zk.T) * logit_scale.exp().clamp(max=100)
            g = groups_t[idx]
            same_art = (g[:, None] == g[None, :]) & ~torch.eye(len(idx), dtype=torch.bool, device=device)
            logits = logits.masked_fill(same_art, float("-inf"))
            target = torch.arange(len(idx), device=device)
            loss = (F.cross_entropy(logits, target) + F.cross_entropy(logits.T, target)) / 2
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            step += 1
            tot += loss.item()
        print(f"epoch {ep}: loss {tot / steps_per_epoch:.4f}  temp {1 / logit_scale.exp().item():.4f}  "
              f"{time.time() - t0:.0f}s", flush=True)
        if ep % a.eval_every == 0 or ep == a.epochs:
            m = evaluate(f"epoch{ep}")
            torch.save({"model": model.state_dict(), "args": vars(a), "eval": m}, out / "last.pt")
            if m["top1"] >= best["top1"]:
                best = m
                torch.save({"model": model.state_dict(), "args": vars(a), "eval": m}, out / "best.pt")
    print("best:", best)


if __name__ == "__main__":
    main()
