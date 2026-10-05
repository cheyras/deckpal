"""Fine-tune LC050 on the labeller corpus, with losses on its NATIVE outputs.

    # the smoke test (proves the loop runs on the GPU and the loss moves):
    python train.py --manifest cache/session2 --train-on all --val-on all --max-steps 40 --batch-size 8 --run smoke

    # a real run (see README "A real training run"):
    python train.py --manifest C:/Users/cheyr/deckpal-data/quad-corpus --epochs 60 --aug full --run r1

LOSSES, on exactly what model.ts reads:
  points  L1 (or smooth-L1) on the 8 normalised coordinates, positives only,
          in LC050's own corner order (dataset.order_corners). Optional
          `--order-loss min-cyclic` takes the best of the 4 cyclic re-indexings
          instead, if ordering ever proves to be a training obstacle.
  has_obj BCE on the presence LOGIT (tapped before the graph's Sigmoid), every
          row: 1 for any card (front, back, face-unknown), 0 for a negative.

VALIDATION, every epoch, in fp32 with TF32 OFF (convert.py measured TF32
alone moving corners by up to 0.013 = 5 canonical px; a validation number must
describe the function the WASM runtime will compute):
  corner error in CANONICAL px (416 square), index-for-index and best-cyclic;
  <=8 / <=14 px rates; linear scale sqrt(area_pred/area_gt) -- the interior-lock
  tell (a text-panel lock reads ~0.6-0.9); the same on the TIGHT slice
  (card bbox long side >= 80% of the square, the same TIGHT_EXTENT
  scripts/quad-corpus/metrics.ts uses: an AREA cut cannot express it, since an
  upright card covers at most ~72% of a square), the regime this effort is for; presence
  accuracy at 0.5, acquire rate at gate.ts's 0.80 on cards, false-acquire
  rate at 0.80 on negatives. Epoch 0 is the untouched pretrained LC050, so every
  run reports its improvement over the shipping model, not just a loss curve.

Outputs in runs/<name>/: config.json, split.json (a copy), metrics.jsonl (one
line per evaluation), last.pt, best.pt (lowest val corner median).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

import preprocess as P
from common import CACHE, CORPUS_DIR, RUNS
from convert import build_model, load_checkpoint
from dataset import AugConfig, ModelInput, QuadDataset, load_manifest, load_or_make_split, worker_init


# ---------------------------------------------------------------------------
# losses
# ---------------------------------------------------------------------------


def points_loss(pred: torch.Tensor, target: torch.Tensor, pos: torch.Tensor, kind: str, order: str) -> torch.Tensor:
    """Mean per-coordinate loss over POSITIVE rows. pred/target (B,8), pos (B,1)."""
    mask = pos.squeeze(1) > 0.5
    if not mask.any():
        return pred.sum() * 0.0
    p, t = pred[mask].float(), target[mask].float()
    f = nn.functional.l1_loss if kind == "l1" else (lambda a, b, reduction: nn.functional.smooth_l1_loss(a, b, beta=0.01, reduction=reduction))
    if order == "fixed":
        return f(p, t, reduction="mean")
    tq = t.view(-1, 4, 2)
    per = torch.stack([f(p, torch.roll(tq, -k, dims=1).reshape(-1, 8), reduction="none").mean(1) for k in range(4)], 1)
    return per.min(1).values.mean()


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------


def _area(q: np.ndarray) -> float:
    x, y = q[:, 0], q[:, 1]
    return abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) / 2


def _best_cyclic(pred: np.ndarray, gt: np.ndarray) -> float:
    """Mean corner distance minimised over the 8 re-indexings (offline-harness cornerDeltas)."""
    best = math.inf
    for flip in (False, True):
        g = gt[[0, 3, 2, 1]] if flip else gt
        for r in range(4):
            best = min(best, float(np.linalg.norm(pred - np.roll(g, -r, axis=0), axis=1).mean()))
    return best


# Same definition as scripts/quad-corpus/metrics.ts TIGHT_EXTENT.
TIGHT_EXTENT = 0.8


@torch.no_grad()
def evaluate(model: nn.Module, loader, device, fills: dict[int, float], to_input) -> dict:
    tf32 = (torch.backends.cudnn.allow_tf32, torch.backends.cuda.matmul.allow_tf32)
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False
    model.eval()
    S = P.CANONICAL_SIZE
    err, err_cyc, scale, tight_err, tight_scale = [], [], [], [], []
    obj_pos, obj_neg, bce = [], [], []
    for b in loader:
        pts, obj, logit = model(to_input(b["img"].to(device, non_blocking=True)))
        bce.append(float(nn.functional.binary_cross_entropy_with_logits(logit.float(), b["has_obj"].to(device), reduction="sum")))
        pts, obj = pts.float().cpu().numpy(), obj.float().cpu().numpy()[:, 0]
        for i in range(len(pts)):
            if b["pos"][i, 0] > 0.5:
                obj_pos.append(obj[i])
                pq = pts[i].reshape(4, 2) * S
                gq = b["points"][i].numpy().reshape(4, 2) * S
                e = float(np.linalg.norm(pq - gq, axis=1).mean())
                s = math.sqrt(_area(pq) / max(_area(gq), 1e-9))
                err.append(e)
                err_cyc.append(_best_cyclic(pq, gq))
                scale.append(s)
                if fills.get(int(b["id"][i]), 0.0) >= TIGHT_EXTENT:
                    tight_err.append(e)
                    tight_scale.append(s)
            else:
                obj_neg.append(obj[i])
    torch.backends.cudnn.allow_tf32, torch.backends.cuda.matmul.allow_tf32 = tf32

    def q(v, f):
        return float(f(v)) if v else None

    n = len(obj_pos) + len(obj_neg)
    return {
        "n_pos": len(obj_pos),
        "n_neg": len(obj_neg),
        "corner_px_median": q(err, np.median),
        "corner_px_mean": q(err, np.mean),
        "corner_px_p90": q(err, lambda v: np.percentile(v, 90)),
        "corner_px_median_bestcyclic": q(err_cyc, np.median),
        "within_8px": q(err, lambda v: np.mean(np.array(v) <= 8)),
        "within_14px": q(err, lambda v: np.mean(np.array(v) <= 14)),
        "scale_median": q(scale, np.median),
        "interior_like": int(sum(1 for e, s in zip(err, scale) if s < 0.85 and e > 14)),
        "tight_n": len(tight_err),
        "tight_corner_px_median": q(tight_err, np.median),
        "tight_scale_median": q(tight_scale, np.median),
        "presence_bce": sum(bce) / max(1, n),
        "presence_acc@0.5": (sum(v >= 0.5 for v in obj_pos) + sum(v < 0.5 for v in obj_neg)) / max(1, n),
        "acquire_rate@0.8_cards": q(obj_pos, lambda v: np.mean(np.array(v) >= 0.8)),
        "false_acquire@0.8_negatives": q(obj_neg, lambda v: np.mean(np.array(v) >= 0.8)),
    }


def fmt(m: dict) -> str:
    def f(k, spec=".2f"):
        v = m.get(k)
        return "-" if v is None else format(v, spec)

    return (f"corner px med {f('corner_px_median')} mean {f('corner_px_mean')} p90 {f('corner_px_p90')} | <=14px {f('within_14px', '.0%')} "
            f"| scale {f('scale_median', '.3f')} | tight(n={m['tight_n']}) {f('tight_corner_px_median')} "
            f"| presence acc {f('presence_acc@0.5', '.0%')} acquire {f('acquire_rate@0.8_cards', '.0%')} false-acq {f('false_acquire@0.8_negatives', '.0%')} bce {f('presence_bce', '.3f')}")


# ---------------------------------------------------------------------------
# training
# ---------------------------------------------------------------------------


def make_loader(rows, aug, args, shuffle: bool):
    from torch.utils.data import DataLoader

    ds = QuadDataset(rows, aug, resampler=args.resampler, seed=args.seed)
    return DataLoader(
        ds,
        batch_size=args.batch_size,
        shuffle=shuffle,
        num_workers=args.num_workers,
        pin_memory=True,
        drop_last=False,
        persistent_workers=args.num_workers > 0,  # set_epoch() reaches them through shared memory
        worker_init_fn=worker_init if args.num_workers > 0 else None,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, default=CORPUS_DIR)
    ap.add_argument("--split-file", type=Path, default=None)
    ap.add_argument("--split-by", default="auto", choices=["auto", "day", "dupGroup"])
    ap.add_argument("--allow-own-split", action="store_true",
                    help="train without the corpus's frozen split.json (throwaway runs only: eval.ts will not share the split)")
    ap.add_argument("--train-on", default="train", choices=["train", "train+val", "all"])
    ap.add_argument("--val-on", default="val", choices=["val", "test", "train", "all"])
    ap.add_argument("--exclude-mirror-padded", action="store_true")
    ap.add_argument("--exclude-reasons", nargs="*", default=[], help="negative reasons to drop (dataset.load_manifest)")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--max-steps", type=int, default=0, help="stop after N optimiser steps (smoke tests)")
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--warmup-steps", type=int, default=100)
    ap.add_argument("--freeze", default="none", choices=["none", "backbone", "backbone+presence"])
    ap.add_argument("--backbone-lr-mult", type=float, default=0.1)
    ap.add_argument("--clip-norm", type=float, default=0.0, help="per-group gradient clip (0 = off)")
    ap.add_argument("--w-points", type=float, default=10.0)
    ap.add_argument("--w-obj", type=float, default=1.0)
    ap.add_argument("--pos-weight", type=float, default=1.0, help="BCE weight on positives")
    ap.add_argument("--points-loss", default="l1", choices=["l1", "smoothl1"])
    ap.add_argument("--order-loss", default="fixed", choices=["fixed", "min-cyclic"])
    ap.add_argument("--amp", default="off", choices=["off", "bf16", "fp16"],
                    help="off = fp32 with TF32 disabled (default: the model is precision-sensitive, see convert.py)")
    ap.add_argument("--aug", default="off", help="off | light | full | tight-only")
    ap.add_argument("--aug-json", default=None, help="JSON object of AugConfig overrides")
    ap.add_argument("--resampler", default="area", choices=list(P.RESAMPLERS))
    ap.add_argument("--num-workers", type=int, default=8)
    ap.add_argument("--run", default=None, help="runs/<name>/ (default: timestamp)")
    ap.add_argument("--resume", type=Path, default=None)
    ap.add_argument("--init", type=Path, default=None, help="start from a checkpoint's weights (fresh optimiser)")
    ap.add_argument("--eval-only", action="store_true", help="evaluate the initial weights on --val-on and exit (e.g. --init runs/r1/best.pt --val-on test)")
    ap.add_argument("--eval-every", type=int, default=1, help="epochs")
    ap.add_argument("--log-every", type=int, default=10, help="steps")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    dev = torch.device(args.device if (args.device != "cuda" or torch.cuda.is_available()) else "cpu")
    to_input = ModelInput(dev)
    to_input.check()  # the tensor the model trains on IS rgbaToBGRPlanar's, bit for bit
    if args.amp == "off":
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cuda.matmul.allow_tf32 = False

    # ── data ────────────────────────────────────────────────────────────────
    rows, _ = load_manifest(args.manifest, exclude_mirror_padded=args.exclude_mirror_padded, exclude_reasons=tuple(args.exclude_reasons))
    split_file = args.split_file or (CACHE / "splits" / f"{args.manifest.resolve().name}.json")
    split = load_or_make_split(rows, split_file, manifest=args.manifest, require_frozen=not args.allow_own_split, by=args.split_by)
    by_id = {r.id: r for r in rows}

    def pick(which: str):
        ids = {"train": split["train"], "val": split["val"], "test": split["test"],
               "train+val": split["train"] + split["val"], "all": [r.id for r in rows]}[which]
        return [by_id[i] for i in ids]

    train_rows, val_rows = pick(args.train_on), pick(args.val_on)
    if not train_rows:
        raise SystemExit("no training rows")
    overlap = {r.id for r in train_rows} & {r.id for r in val_rows}
    aug = AugConfig.preset(args.aug)
    if args.aug_json:
        aug = aug.updated(json.loads(args.aug_json))
    # card extent (bbox long side / square side), NOT area; see TIGHT_EXTENT
    fills = {r.id: (float(np.ptp(r.corners, axis=0).max()) if r.corners is not None else 0.0) for r in rows}
    train_loader = make_loader(train_rows, aug, args, shuffle=True)
    val_loader = make_loader(val_rows, AugConfig(enabled=False), args, shuffle=False)

    run = RUNS / (args.run or time.strftime("%Y%m%d-%H%M%S"))
    run.mkdir(parents=True, exist_ok=True)
    shutil.copy(split_file, run / "split.json")
    (run / "config.json").write_text(json.dumps({**{k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}, "aug_resolved": aug.__dict__}, indent=1, default=str))

    # ── model + optimiser ───────────────────────────────────────────────────
    if args.init:
        model, _ = load_checkpoint(args.init)
    else:
        model = build_model()
    model.to(dev)
    groups = model.param_groups()
    frozen = {"none": set(), "backbone": {"backbone"}, "backbone+presence": {"backbone", "presence"}}[args.freeze]
    opt_groups = []
    for g, items in groups.items():
        for _, p in items:
            p.requires_grad_(g not in frozen)
        if g in frozen:
            continue
        opt_groups.append({"params": [p for _, p in items], "lr": args.lr * (args.backbone_lr_mult if g == "backbone" else 1.0), "name": g})
    opt = torch.optim.AdamW(opt_groups, lr=args.lr, weight_decay=args.weight_decay)
    steps_per_epoch = math.ceil(len(train_rows) / args.batch_size)
    total = args.max_steps or args.epochs * steps_per_epoch
    epochs = math.ceil(total / steps_per_epoch)

    def lr_lambda(step):
        if step < args.warmup_steps:
            return (step + 1) / args.warmup_steps
        t = (step - args.warmup_steps) / max(1, total - args.warmup_steps)
        return 0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * min(1.0, t)))

    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)
    scaler = torch.amp.GradScaler("cuda", enabled=args.amp == "fp16")
    amp_dtype = {"bf16": torch.bfloat16, "fp16": torch.float16}.get(args.amp)
    start_epoch, step, best = 0, 0, math.inf
    if args.resume:
        ck = torch.load(args.resume, map_location=dev, weights_only=False)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["optimizer"])
        sched.load_state_dict(ck["scheduler"])
        start_epoch, step, best = ck["epoch"] + 1, ck["step"], ck.get("best", math.inf)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"device {dev}" + (f" ({torch.cuda.get_device_name(dev)})" if dev.type == "cuda" else "") + f", amp {args.amp}, aug {args.aug}")
    print(f"train {len(train_rows)} rows ({args.train_on}), val {len(val_rows)} rows ({args.val_on})"
          + (f"  ** {len(overlap)} rows in BOTH: this measures fit, not generalisation **" if overlap else ""))
    print(f"trainable {trainable:,} floats (frozen: {sorted(frozen) or 'nothing'}); {steps_per_epoch} steps/epoch, {total} steps, {epochs} epochs -> {run}")

    def save(path, epoch, metrics):
        torch.save({"model": model.state_dict(), "optimizer": opt.state_dict(), "scheduler": sched.state_dict(), "epoch": epoch, "step": step,
                    "best": best, "metrics": metrics, "args": vars(args), "source_sha256": model.source_sha256}, path)

    log = open(run / "metrics.jsonl", "a", encoding="utf-8")
    if start_epoch == 0 or args.eval_only:
        m0 = evaluate(model, val_loader, dev, fills, to_input)
        label = f"weights of {args.init}" if args.init else (f"resumed {args.resume}" if args.resume else "pretrained LC050")
        print(f"epoch 0 ({label}) on {args.val_on}  {fmt(m0)}")
        log.write(json.dumps({"epoch": 0, "step": step, "split": args.val_on, "weights": label, **m0}) + "\n")
        log.flush()
    if args.eval_only:
        log.close()
        return 0

    t_start = time.time()
    first_loss = None
    run_loss: list[float] = []
    done = False
    for epoch in range(start_epoch, epochs):
        train_loader.dataset.set_epoch(epoch)
        model.train()
        t_ep, seen, run_loss = time.time(), 0, []
        for b in train_loader:
            img = to_input(b["img"].to(dev, non_blocking=True))
            tgt, pos, obj_t = b["points"].to(dev), b["pos"].to(dev), b["has_obj"].to(dev)
            with torch.autocast(device_type=dev.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                pts, _, logit = model(img)
            lp = points_loss(pts, tgt, pos, args.points_loss, args.order_loss)
            lo = nn.functional.binary_cross_entropy_with_logits(logit.float(), obj_t, pos_weight=torch.tensor([args.pos_weight], device=dev))
            loss = args.w_points * lp + args.w_obj * lo
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            # Per-group norms: BN is folded into the backbone convs, so their raw
            # gradients run ~100x the decoder's and one global norm would be the
            # backbone's alone. Clipping (off by default; AdamW is scale-invariant)
            # is per group for the same reason.
            gnorms = {}
            for g in opt_groups:
                ps = [p for p in g["params"] if p.grad is not None]
                if ps:
                    gnorms[g["name"]] = float(torch.nn.utils.clip_grad_norm_(ps, args.clip_norm if args.clip_norm > 0 else math.inf))
            scaler.step(opt)
            scaler.update()
            sched.step()
            step += 1
            seen += img.shape[0]
            lv = float(loss.detach())
            first_loss = first_loss if first_loss is not None else lv
            run_loss.append(lv)
            if step % args.log_every == 0 or step == 1:
                gs = " ".join(f"{k} {v:.1f}" for k, v in gnorms.items())
                print(f"  step {step:5d}  loss {lv:.4f} (points {float(lp.detach()):.4f}, presence {float(lo.detach()):.4f})  grad-norm[{gs}]  lr {max(sched.get_last_lr()):.2e}")
            if args.max_steps and step >= args.max_steps:
                done = True
                break
        dt = time.time() - t_ep
        mem = f", peak GPU mem {torch.cuda.max_memory_allocated(dev) / 2**20:.0f} MiB" if dev.type == "cuda" else ""
        print(f"epoch {epoch + 1}: {seen} samples in {dt:.1f}s ({seen / max(dt, 1e-9):.0f} img/s){mem}, mean loss {np.mean(run_loss):.4f}")
        if (epoch + 1) % args.eval_every == 0 or done or epoch == epochs - 1:
            m = evaluate(model, val_loader, dev, fills, to_input)
            print(f"epoch {epoch + 1}  {fmt(m)}")
            log.write(json.dumps({"epoch": epoch + 1, "step": step, "split": args.val_on, "train_loss": float(np.mean(run_loss)), **m}) + "\n")
            log.flush()
            key = m["corner_px_median"] if m["corner_px_median"] is not None else m["presence_bce"]
            if key < best:
                best = key
                save(run / "best.pt", epoch, m)
        save(run / "last.pt", epoch, None)
        if done:
            break
    log.close()
    print(f"done: {step} steps in {time.time() - t_start:.1f}s; first-step loss {first_loss if first_loss is not None else float('nan'):.4f} -> last-epoch mean {np.mean(run_loss) if run_loss else float('nan'):.4f}; best {best:.3f} -> {run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
