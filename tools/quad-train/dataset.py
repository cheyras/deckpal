"""The labeller corpus as training examples for LC050's own two outputs.

    python dataset.py --manifest C:/Users/cheyr/deckpal-data/quad-corpus      # audit + write split
    python dataset.py --manifest cache/session2 --preview 6                  # also dump augmented samples

INPUT: what scripts/quad-corpus/harvest.mjs writes -- `<dir>/manifest.jsonl`
plus `<dir>/raw/<id>.png`. Every PNG is the 416x416 CANONICAL square (pipeline
v3) and every `corners` value is a fraction of it. harvest.mjs has already
applied HARVEST.md section 4 (pipelineVersion 3, canonicalSize == dims, the PNG
exists and is square, four finite corners inside the editor clamp), so a row in
the manifest is a row the labeller vouched for; this loader re-checks the parts
that would silently poison a run if harvest.mjs ever changed.

TARGET: the model's NATIVE output space, nothing derived.
  points  [x0,y0,..,x3,y3] fractions of the 256 model input. Pipeline v3 feeds
          the model a PLAIN RESIZE of the canonical square, so a canonical
          fraction IS a model fraction: the manifest corners are the target
          as-is, reordered into LC050's own corner order (order_corners).
  has_obj 1.0 for every positive (front, back, face-unknown(v1)) -- a card back
          is a card, with real corners -- and 0.0 for every negative. LC050's
          has_obj output is post-sigmoid; train.py takes BCE on the logit.
A negative contributes no points loss (there is no right answer for corners on
an empty frame, and the engine never reads them past a closed gate).

SPLITS: never by random frame. Rows are grouped by DAY (a labelling session --
the same cards, the same table, the same light) unioned with harvest's dHash
near-duplicate `dupGroup`, so a re-upload on another day cannot straddle the
split either; with fewer than 5 distinct days it falls back to dupGroup alone
and says so. A group's split is a pure function of its key (sha1), so adding
rows never moves an existing group; and a split file, once written, is
authoritative -- re-running only assigns rows it has not seen.

AUGMENTATION: hooks for photometric jitter, small affine/perspective, scale
variation that DELIBERATELY includes tight framings (the card filling 80-97%
of the frame -- the regime where LC050 outlines the inner text panel, HARVEST.md
section 5), blur and glare. All OFF unless asked for (`--aug light|full`).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Optional

import numpy as np

import preprocess as P

POSITIVE_VERDICTS = {"front", "back", "face-unknown(v1)"}
NEGATIVE_VERDICTS = {"negative"}
CORNER_CLAMP = (-0.15, 1.15)  # the labeller's own drag clamp (HARVEST.md section 4)
SPLIT_SEED = "quad-train-v1"


# ---------------------------------------------------------------------------
# rows
# ---------------------------------------------------------------------------


@dataclass
class Row:
    id: int
    png: Path
    day: str
    verdict: str
    reason: Optional[str]
    corners: Optional[np.ndarray]  # (4,2) canonical fractions, LC050 order
    topLeftIndex: Optional[int]  # remapped to the reordered corners
    fill: Optional[float]
    source: Optional[str]
    dupGroup: int
    mirrorPadded: bool
    raw: dict = field(repr=False)

    @property
    def positive(self) -> bool:
        return self.corners is not None


def order_corners(q) -> tuple[np.ndarray, list[int]]:
    """Put a quad in LC050's corner order: [top-left, top-right, bottom-right,
    bottom-left], clockwise in image coordinates.

    The rule is DocAligner's (docsaidkit order_points_clockwise): sort by x,
    the two left-most are the left edge and the two right-most the right edge
    (for a convex quad they are always adjacent), each pair ordered by y. It is
    not a guess: inspect_model.py checks LC050's raw output on session 2 and the
    order this function produces is the order the model emits (and the order
    gt.json was labelled in). For a self-intersecting result (only possible for
    a degenerate or non-convex quad) it falls back to a clockwise angular sort
    starting at the corner nearest the frame's top-left.

    Returns (ordered quad, perm) with ordered[k] == q[perm[k]]."""
    q = np.asarray(q, dtype=np.float64).reshape(4, 2)
    idx = np.argsort(q[:, 0], kind="stable")
    left = idx[:2][np.argsort(q[idx[:2], 1], kind="stable")]
    right = idx[2:][np.argsort(q[idx[2:], 1], kind="stable")]
    perm = [int(left[0]), int(right[0]), int(right[1]), int(left[1])]
    out = q[perm]
    if not _is_simple(out):
        c = q.mean(0)
        ang = np.arctan2(q[:, 1] - c[1], q[:, 0] - c[0])  # y down: increasing angle is clockwise
        cw = list(np.argsort(ang, kind="stable"))
        start = int(np.argmin([q[i, 0] + q[i, 1] for i in cw]))
        perm = [int(i) for i in cw[start:] + cw[:start]]
        out = q[perm]
    return out, perm


def _is_simple(q: np.ndarray) -> bool:
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def seg_x(p1, p2, p3, p4):
        d1, d2 = cross(p3, p4, p1), cross(p3, p4, p2)
        d3, d4 = cross(p1, p2, p3), cross(p1, p2, p4)
        return (d1 * d2 < 0) and (d3 * d4 < 0)

    return not (seg_x(q[0], q[1], q[2], q[3]) or seg_x(q[1], q[2], q[3], q[0]))


def load_manifest(root: Path, *, exclude_mirror_padded: bool = False, exclude_reasons: tuple = (), verbose: bool = True) -> tuple[list[Row], dict]:
    """Read and validate `<root>/manifest.jsonl`. Returns (rows, report).

    `exclude_reasons` drops negatives by reason. By default every negative
    trains has_obj -> 0, which is HARVEST.md section 6's stated intent ("a
    negative row ... trains a detector that emits nothing for frames like this
    one") -- including frames that DO hold a card the labeller could not quad
    (too_blurry, too_far, multiple_no_clear_foreground). Exclude those reasons
    if a run should only learn "no card here"."""
    root = Path(root)
    report = {"manifest": str(root / "manifest.jsonl"), "lines": 0, "kept": 0, "dropped": Counter(), "verdict": Counter(), "reordered": 0}
    rows: list[Row] = []
    with open(root / "manifest.jsonl", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            report["lines"] += 1
            m = json.loads(line)
            why = _invalid(m, root)
            if why is None and exclude_mirror_padded and m.get("mirrorPadded"):
                why = "mirror-padded upload (excluded by flag)"
            if why is None and m.get("corners") is None and m.get("reason") in exclude_reasons:
                why = f"negative reason {m.get('reason')} (excluded by flag)"
            if why:
                report["dropped"][why] += 1
                continue
            corners = None
            tli = m.get("topLeftIndex")
            if m["corners"] is not None:
                corners, perm = order_corners(m["corners"])
                if perm != [0, 1, 2, 3]:
                    report["reordered"] += 1
                if tli is not None:
                    tli = perm.index(int(tli))
            rows.append(
                Row(
                    id=int(m["id"]),
                    png=root / m["png"],
                    day=m.get("day") or "unknown",
                    verdict=m["verdict"],
                    reason=m.get("reason"),
                    corners=corners,
                    topLeftIndex=tli,
                    fill=m.get("fill"),
                    source=m.get("source"),
                    dupGroup=int(m.get("dupGroup", m["id"])),
                    mirrorPadded=bool(m.get("mirrorPadded")),
                    raw=m,
                )
            )
            report["verdict"][m["verdict"]] += 1
    report["kept"] = len(rows)
    if verbose:
        d = dict(report["dropped"])
        print(f"manifest {root}: {report['lines']} lines, kept {len(rows)} {dict(report['verdict'])}; dropped {d or 'none'}; reordered corners on {report['reordered']}")
    return rows, report


def _invalid(m: dict, root: Path) -> Optional[str]:
    v = m.get("verdict")
    c = m.get("corners")
    if v in POSITIVE_VERDICTS:
        if not (isinstance(c, list) and len(c) == 4 and all(isinstance(p, list) and len(p) == 2 for p in c)):
            return "positive without four corners"
        flat = [float(x) for p in c for x in p]
        if not all(math.isfinite(x) for x in flat):
            return "non-finite corner"
        if any(x < CORNER_CLAMP[0] or x > CORNER_CLAMP[1] for x in flat):
            return "corner outside the labeller clamp"
    elif v in NEGATIVE_VERDICTS:
        if c is not None:
            return "negative with corners"
    else:
        return f"unknown verdict {v!r}"
    if not (root / m.get("png", "")).is_file():
        return "png missing"
    return None


# ---------------------------------------------------------------------------
# near-duplicates (only for manifests that lack harvest's dupGroup)
# ---------------------------------------------------------------------------


def dhash(path) -> int:
    """64-bit difference hash, harvest.mjs makeHasher in spirit (greyscale,
    9x8, left>right). Not bit-identical to sharp's resize -- a corpus manifest
    carries harvest's own dupGroup and this is never consulted for it."""
    import cv2

    g = cv2.cvtColor(P.load_rgba(path), cv2.COLOR_RGBA2GRAY)
    px = cv2.resize(g, (9, 8), interpolation=cv2.INTER_AREA).astype(np.int32)
    h = 0
    for y in range(8):
        for x in range(8):
            h = (h << 1) | (1 if px[y, x] > px[y, x + 1] else 0)
    return h


def assign_dup_groups(rows: list[dict], root: Path, max_bits: int = 4) -> None:
    """In place: dupGroup = min id of each dHash<=max_bits component."""
    hashes = [(r["id"], dhash(Path(root) / r["png"])) for r in rows]
    parent = {i: i for i, _ in hashes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a in range(len(hashes)):
        for b in range(a + 1, len(hashes)):
            if bin(hashes[a][1] ^ hashes[b][1]).count("1") <= max_bits:
                parent[find(hashes[a][0])] = find(hashes[b][0])
    groups: dict[int, list[int]] = {}
    for i, _ in hashes:
        groups.setdefault(find(i), []).append(i)
    group_of = {i: min(g) for g in groups.values() for i in g}
    for r in rows:
        r["dupGroup"] = group_of[r["id"]]


# ---------------------------------------------------------------------------
# splits
# ---------------------------------------------------------------------------


def group_keys(rows: list[Row], by: str) -> dict[int, str]:
    """Row id -> leakage group key. `day` unions same-day rows with same-dupGroup rows."""
    if by == "dupGroup":
        return {r.id: f"dup:{r.dupGroup}" for r in rows}
    if by != "day":
        raise ValueError(f"split by {by!r}")
    parent: dict[str, str] = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for r in rows:
        a, b = find(f"day:{r.day}"), find(f"dup:{r.dupGroup}")
        if a != b:
            parent[max(a, b)] = min(a, b)  # deterministic root
    comp_days: dict[str, list[str]] = {}
    for r in rows:
        comp_days.setdefault(find(f"day:{r.day}"), []).append(r.day)
    return {r.id: "day:" + min(comp_days[find(f"day:{r.day}")]) for r in rows}


def _bucket(key: str, seed: str) -> float:
    return int(hashlib.sha1(f"{seed}|{key}".encode()).hexdigest()[:12], 16) / float(1 << 48)


def make_split(rows: list[Row], by: str = "auto", val: float = 0.15, test: float = 0.15, seed: str = SPLIT_SEED, prior: Optional[dict] = None) -> dict:
    """Deterministic group split. `prior` (a previous split dict) is authoritative
    for every id it contains; new ids join their group's existing split, or are
    hashed. Guarantees non-empty val/test when there are >= 3 groups."""
    days = {r.day for r in rows}
    chosen = by if by != "auto" else ("day" if len(days) >= 5 else "dupGroup")
    keys = group_keys(rows, chosen)
    prior_of: dict[int, str] = {}
    if prior:
        for s in ("train", "val", "test"):
            for i in prior.get(s, []):
                prior_of[int(i)] = s
    group_split: dict[str, str] = {}
    for r in rows:  # groups already placed by the prior split stay put
        if r.id in prior_of:
            group_split.setdefault(keys[r.id], prior_of[r.id])
    for k in sorted(set(keys.values())):
        if k not in group_split:
            b = _bucket(k, seed)
            group_split[k] = "test" if b < test else "val" if b < test + val else "train"
    groups = sorted(set(keys.values()), key=lambda k: _bucket(k, seed))
    if len(groups) >= 3 and not prior:
        for s in ("test", "val"):
            if not any(v == s for v in group_split.values()):
                cand = [k for k in groups if group_split[k] == "train"]
                if len(cand) > 1:
                    group_split[cand[0]] = s
    out = {"train": [], "val": [], "test": []}
    for r in rows:
        out[prior_of.get(r.id, group_split[keys[r.id]])].append(r.id)
    leaks = _leaks(rows, out)
    by_verdict = {s: dict(Counter(next(x.verdict for x in rows if x.id == i) for i in ids)) for s, ids in out.items()}
    out["meta"] = {
        "by": chosen,
        "requested": by,
        "seed": seed,
        "fractions": {"val": val, "test": test},
        "groups": len(groups),
        "days": len(days),
        "counts": {s: len(out[s]) for s in ("train", "val", "test")},
        "by_verdict": by_verdict,
        "leaks": leaks,
        "note": "by=dupGroup: fewer than 5 labelling days, so same-session frames can straddle the split" if chosen == "dupGroup" else "",
    }
    return out


def _leaks(rows: list[Row], split: dict) -> list[str]:
    where = {i: s for s in ("train", "val", "test") for i in split[s]}
    seen: dict[int, set] = {}
    for r in rows:
        seen.setdefault(r.dupGroup, set()).add(where[r.id])
    return [f"dupGroup {g} spans {sorted(s)}" for g, s in seen.items() if len(s) > 1]


def split_ts_prior(manifest: Path) -> Optional[dict]:
    """The evaluator's frozen split (scripts/quad-corpus/split.ts writes
    <corpus>/split.json), as an authoritative prior. Training and scoring must use
    ONE split, or a fine-tuned model is scored on frames it trained on. Refuses a
    split frozen from a different manifest, exactly as split.ts does."""
    corpus = Path(manifest) if Path(manifest).is_dir() else Path(manifest).parent
    p = corpus / "split.json"
    if not p.is_file():
        return None
    s = json.loads(p.read_text())
    if "assignments" not in s:
        return None
    import hashlib

    digest = hashlib.sha256((corpus / s["manifest"]["file"]).read_bytes()).hexdigest()
    if digest != s["manifest"]["sha256"]:
        raise SystemExit(f"{p} was frozen from a different manifest (sha256 {s['manifest']['sha256'][:12]}, now {digest[:12]}); rerun split.ts --extend")
    # `excluded` matters as much as the three splits: split.ts excludes a row
    # precisely because it bridges into a test unit, so it is a near-copy of a
    # test frame. Dropping it here (rather than letting make_split hand it its
    # group's split) is what keeps "never scored on frames it trained on" true.
    out: dict = {"train": [], "val": [], "test": [], "excluded": []}
    for i, where in s["assignments"].items():
        if where in out:
            out[where].append(int(i))
    return out


def load_or_make_split(rows: list[Row], path: Path, manifest: Optional[Path] = None, require_frozen: bool = False, **kw) -> dict:
    # The evaluator's split.json wins when it exists; the cache file is only a
    # fallback for corpora split.ts has not frozen yet, and training refuses
    # that fallback unless asked (require_frozen), because eval.ts would then
    # score on a split this run never saw.
    prior = split_ts_prior(manifest) if manifest is not None else None
    if prior is None and require_frozen:
        raise SystemExit(
            "no split.json in the corpus: freeze one first with `node --import tsx scripts/quad-corpus/split.ts` "
            "(training and eval.ts must share it), or pass --allow-own-split for a throwaway run"
        )
    excluded: set[int] = set()
    if prior is not None and prior.get("excluded"):
        excluded = {int(i) for i in prior["excluded"]}
        rows[:] = [r for r in rows if r.id not in excluded]
    if prior is None:
        prior = json.loads(Path(path).read_text()) if Path(path).is_file() else None
    split = make_split(rows, prior=prior, **kw)
    split["meta"]["excluded_by_split_ts"] = len(excluded)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(split, indent=1))
    return split


# ---------------------------------------------------------------------------
# augmentation hooks (all OFF by default)
# ---------------------------------------------------------------------------


@dataclass
class AugConfig:
    enabled: bool = False
    # photometric
    p_photometric: float = 0.8
    brightness: float = 0.25  # multiplicative, +-
    contrast: float = 0.25
    saturation: float = 0.3
    hue_deg: float = 6.0
    gamma: tuple = (0.75, 1.35)
    warm_tint: float = 0.12  # white-balance shift toward warm indoor light
    noise_std: float = 5.0  # uint8 units, upper bound
    p_jpeg: float = 0.3
    jpeg_quality: tuple = (45, 92)
    # geometric (one homography, applied to pixels and corners together)
    p_geometric: float = 0.7
    rotate_deg: float = 8.0
    shear_deg: float = 4.0
    perspective: float = 0.05  # frame-corner jitter, fraction of the side
    scale: tuple = (0.85, 1.25)  # zoom; <1 shows more background
    translate: float = 0.08
    p_tight: float = 0.35  # of geometric draws: frame the card TIGHT
    tight_fill: tuple = (0.80, 0.97)  # card bbox long side / frame side
    border: str = "reflect"  # reflect | replicate | constant
    # blur
    p_blur: float = 0.2
    blur_sigma: tuple = (0.5, 1.8)
    p_motion: float = 0.15
    motion_len: tuple = (3, 11)
    # glare: a soft specular blob, biased onto the card
    p_glare: float = 0.2
    glare_strength: tuple = (0.35, 0.9)
    glare_radius: tuple = (0.05, 0.22)
    # the 416 -> 256 model resize; jitter it, since the browser's resampler is unknowable
    resamplers: tuple = ("area",)

    @classmethod
    def preset(cls, name: str) -> "AugConfig":
        if name in ("off", "none", ""):
            return cls(enabled=False)
        if name == "light":
            return cls(enabled=True, p_photometric=0.6, p_geometric=0.5, p_tight=0.3, p_blur=0.1, p_motion=0.05, p_glare=0.1, p_jpeg=0.2)
        if name == "full":
            return cls(enabled=True, resamplers=("area", "linear", "cubic", "lanczos"))
        if name == "tight-only":  # isolate the margin regime for an ablation
            return cls(enabled=True, p_photometric=0.0, p_geometric=1.0, p_tight=1.0, p_blur=0.0, p_motion=0.0, p_glare=0.0, p_jpeg=0.0,
                       rotate_deg=3.0, shear_deg=0.0, perspective=0.0)
        raise ValueError(f"aug preset {name!r}")

    def updated(self, overrides: dict) -> "AugConfig":
        names = {f.name for f in fields(self)}
        bad = set(overrides) - names
        if bad:
            raise ValueError(f"unknown aug keys {sorted(bad)}")
        d = asdict(self)
        d.update({k: tuple(v) if isinstance(v, list) else v for k, v in overrides.items()})
        return AugConfig(**d)


def _homography(S: int, corners: Optional[np.ndarray], cfg: AugConfig, rng: np.random.Generator) -> np.ndarray:
    if corners is not None and rng.random() < cfg.p_tight:
        lo, hi = corners.min(0), corners.max(0)
        s = rng.uniform(*cfg.tight_fill) * S / max(1e-6, float((hi - lo).max()))
        center = (lo + hi) / 2 + rng.uniform(-0.03, 0.03, 2) * S
    else:
        s = math.exp(rng.uniform(math.log(cfg.scale[0]), math.log(cfg.scale[1])))
        center = np.array([S / 2, S / 2]) + rng.uniform(-cfg.translate, cfg.translate, 2) * S
    th = math.radians(rng.uniform(-cfg.rotate_deg, cfg.rotate_deg))
    sh = math.tan(math.radians(rng.uniform(-cfg.shear_deg, cfg.shear_deg)))
    T1 = np.array([[1, 0, -center[0]], [0, 1, -center[1]], [0, 0, 1]], float)
    R = np.array([[math.cos(th), -math.sin(th), 0], [math.sin(th), math.cos(th), 0], [0, 0, 1]], float)
    Sh = np.array([[1, sh, 0], [0, 1, 0], [0, 0, 1]], float)
    Sc = np.diag([s, s, 1.0])
    T2 = np.array([[1, 0, S / 2], [0, 1, S / 2], [0, 0, 1]], float)
    A = T2 @ Sc @ Sh @ R @ T1
    if cfg.perspective > 0:
        import cv2

        src = np.array([[0, 0], [S, 0], [S, S], [0, S]], np.float32)
        dst = (src + rng.uniform(-cfg.perspective, cfg.perspective, (4, 2)) * S).astype(np.float32)
        A = cv2.getPerspectiveTransform(src, dst).astype(float) @ A
    return A


def _apply_h(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.c_[pts, np.ones(len(pts))] @ H.T
    return p[:, :2] / p[:, 2:3]


def augment(img: np.ndarray, corners_px: Optional[np.ndarray], cfg: AugConfig, rng: np.random.Generator) -> tuple[np.ndarray, Optional[np.ndarray]]:
    """img: (S,S,4) uint8 RGBA canonical frame. corners_px: (4,2) or None."""
    import cv2

    if not cfg.enabled:
        return img, corners_px
    S = img.shape[0]
    out = img
    c = corners_px
    if rng.random() < cfg.p_geometric:
        for _ in range(10):  # reject draws that push a corner past the labeller clamp
            H = _homography(S, c, cfg, rng)
            nc = _apply_h(H, c) if c is not None else None
            if nc is None or (nc.min() >= CORNER_CLAMP[0] * S and nc.max() <= CORNER_CLAMP[1] * S):
                border = {"reflect": cv2.BORDER_REFLECT_101, "replicate": cv2.BORDER_REPLICATE, "constant": cv2.BORDER_CONSTANT}[cfg.border]
                out = cv2.warpPerspective(out, H, (S, S), flags=cv2.INTER_LINEAR, borderMode=border, borderValue=(P.PAD_VALUE,) * 3 + (255,))
                c = nc
                break
    # Photometrics stay in uint8 (per-channel LUTs, cv2 kernels): float32 whole-
    # frame numpy arithmetic cost ~20 ms a sample and starved the GPU.
    rgb = np.ascontiguousarray(out[..., :3])
    if rng.random() < cfg.p_photometric:
        b = 1 + rng.uniform(-cfg.brightness, cfg.brightness)
        k = 1 + rng.uniform(-cfg.contrast, cfg.contrast)
        t = rng.uniform(-cfg.warm_tint / 2, cfg.warm_tint)  # warm-biased white balance
        g = rng.uniform(*cfg.gamma)
        m = float(rgb.mean()) * b
        x = np.arange(256, dtype=np.float32)

        def lut(gain: float) -> np.ndarray:
            y = np.clip(((x * b - m) * k + m) * gain, 0, 255)
            return np.clip(255.0 * np.power(y / 255.0, g), 0, 255).astype(np.uint8)

        rgb = cv2.merge([cv2.LUT(np.ascontiguousarray(rgb[..., i]), lut(gain)) for i, gain in enumerate((1 + t, 1.0, 1 - t))])
        s = 1 + rng.uniform(-cfg.saturation, cfg.saturation)
        gray3 = cv2.cvtColor(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB)
        rgb = cv2.addWeighted(rgb, s, gray3, 1 - s, 0)
        if cfg.hue_deg > 0:
            hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
            shift = int(round(rng.uniform(-cfg.hue_deg, cfg.hue_deg) / 2))  # OpenCV hue is 0..180
            hsv[..., 0] = ((hsv[..., 0].astype(np.int16) + shift) % 180).astype(np.uint8)
            rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    if rng.random() < cfg.p_glare:
        cx, cy = (c[rng.integers(4)] * 0.5 + c.mean(0) * 0.5) if c is not None else rng.uniform(0, S, 2)
        r = rng.uniform(*cfg.glare_radius) * S
        ar = rng.uniform(0.4, 1.0)
        x0, x1 = int(max(0, cx - 3 * r)), int(min(S, cx + 3 * r + 1))
        y0, y1 = int(max(0, cy - 3 * r * ar)), int(min(S, cy + 3 * r * ar + 1))
        if x1 > x0 and y1 > y0:  # the blob is ~0 beyond 3 sigma: only that window is touched
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            blob = np.exp(-(((xx - cx) / r) ** 2 + ((yy - cy) / (r * ar)) ** 2) / 2) * (rng.uniform(*cfg.glare_strength) * 255.0)
            win = rgb[y0:y1, x0:x1].astype(np.float32) + blob[..., None]
            rgb[y0:y1, x0:x1] = np.clip(win, 0, 255).astype(np.uint8)
    if rng.random() < cfg.p_blur:
        rgb = cv2.GaussianBlur(rgb, (0, 0), rng.uniform(*cfg.blur_sigma))
    if rng.random() < cfg.p_motion:
        L = int(rng.integers(cfg.motion_len[0], cfg.motion_len[1] + 1))
        kern = np.zeros((L, L), np.float32)
        kern[L // 2, :] = 1.0 / L
        kern = cv2.warpAffine(kern, cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), rng.uniform(0, 180), 1.0), (L, L))
        rgb = cv2.filter2D(rgb, -1, kern / max(1e-6, kern.sum()))
    if cfg.noise_std > 0 and rng.random() < cfg.p_photometric:
        noise = rng.standard_normal(rgb.shape, dtype=np.float32) * rng.uniform(0, cfg.noise_std)
        rgb = np.clip(rgb.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if rng.random() < cfg.p_jpeg:
        ok, enc = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(*cfg.jpeg_quality))])
        if ok:
            rgb = cv2.cvtColor(cv2.imdecode(enc, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    res = np.empty_like(img)
    res[..., :3] = rgb
    res[..., 3] = 255
    return res, c


# ---------------------------------------------------------------------------
# the torch dataset
# ---------------------------------------------------------------------------


def worker_init(_worker_id: int) -> None:
    """DataLoader worker_init_fn: one OpenCV/torch thread per worker. OpenCV
    defaults to every core in EVERY worker, and 8 workers x 32 threads measured
    2.2x slower per sample than single-threaded workers."""
    import cv2
    import torch

    cv2.setNumThreads(1)
    torch.set_num_threads(1)


_SCALE = (np.arange(256, dtype=np.float64) / 255).astype(np.float32)  # rgbaToBGRPlanar's d / 255, per byte value


class ModelInput:
    """uint8 BGR planar -> the float tensor rgbaToBGRPlanar would produce, bit for bit.

    The DataLoader ships uint8 (4x less worker->trainer traffic than float32)
    and the scaling happens on the device by TABLE LOOKUP, not division:
    PyTorch's CUDA `x / 255` multiplies by a rounded reciprocal and is NOT
    bit-identical to JS `d / 255` (measured: it differs on some byte values);
    numpy float64 division rounded to float32 is, and a gather of that table
    is exact by construction. check() asserts it on the live device."""

    def __init__(self, device):
        import torch

        self.lut = torch.from_numpy(_SCALE.copy()).to(device)

    def __call__(self, u8):
        return self.lut[u8.long()]

    def check(self) -> None:
        import torch

        img = np.random.default_rng(0).integers(0, 256, (P.MODEL_SIZE, P.MODEL_SIZE, 4), dtype=np.uint8)
        ref = P.rgba_to_bgr_planar(img).reshape(3, P.MODEL_SIZE, P.MODEL_SIZE)
        u8 = torch.from_numpy(np.ascontiguousarray(img[..., [2, 1, 0]].transpose(2, 0, 1))).to(self.lut.device)
        got = self(u8).cpu().numpy()
        if not np.array_equal(got.view(np.uint32), ref.view(np.uint32)):
            raise AssertionError("device input scaling is not bit-identical to rgbaToBGRPlanar")


class QuadDataset:
    """Map-style dataset (torch-compatible) of model-ready examples.

    item = {img: uint8 (3,256,256) BGR planar -- ModelInput turns it into
                 exactly rgbaToBGRPlanar's float32 on the device,
            points: float32 (8,) target in model space (zeros for a negative),
            has_obj: float32 (1,), pos: float32 (1,), id: int64}"""

    def __init__(self, rows: list[Row], aug: Optional[AugConfig] = None, resampler: str = "area", seed: int = 0):
        import multiprocessing as mp

        self.rows = rows
        self.aug = aug or AugConfig(enabled=False)
        self.resampler = resampler
        self.seed = seed
        # Shared memory, so PERSISTENT DataLoader workers see set_epoch(). Windows
        # spawns workers (a fresh interpreter importing torch, seconds each), so
        # re-creating them every epoch to deliver the epoch number is not free.
        self._epoch = mp.Value("i", 0)

    def __len__(self) -> int:
        return len(self.rows)

    def set_epoch(self, e: int) -> None:
        self._epoch.value = e

    @property
    def epoch(self) -> int:
        return self._epoch.value

    def example(self, i: int) -> tuple[np.ndarray, Optional[np.ndarray], str]:
        """The augmented canonical frame + corners in its px, before the model resize."""
        r = self.rows[i]
        img = P.load_rgba(r.png)
        S = img.shape[0]
        assert img.shape[0] == img.shape[1] == P.CANONICAL_SIZE, f"{r.png}: not the {P.CANONICAL_SIZE} canonical square"
        c = r.corners * S if r.corners is not None else None
        rng = np.random.default_rng([self.seed, self.epoch, i])
        method = self.resampler
        if self.aug.enabled:
            img, c = augment(img, c, self.aug, rng)
            method = self.aug.resamplers[int(rng.integers(len(self.aug.resamplers)))]
        return img, c, method

    def __getitem__(self, i: int) -> dict:
        import torch

        img, c, method = self.example(i)
        S = img.shape[0]
        small = P.resize_rgba(img, P.MODEL_SIZE, P.MODEL_SIZE, method)
        x = np.ascontiguousarray(small[..., [2, 1, 0]].transpose(2, 0, 1))  # RGBA -> BGR planar, still uint8
        if c is not None:
            q, _ = order_corners(c / S)  # augmentation can rotate past the order boundary
            pts, pos = q.reshape(8).astype(np.float32), 1.0
        else:
            pts, pos = np.zeros(8, np.float32), 0.0
        return {
            "img": torch.from_numpy(x),
            "points": torch.from_numpy(pts),
            "has_obj": torch.tensor([pos], dtype=torch.float32),
            "pos": torch.tensor([pos], dtype=torch.float32),
            "id": torch.tensor(self.rows[i].id, dtype=torch.int64),
        }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _preview(ds: QuadDataset, out: Path, n: int) -> None:
    import cv2

    out.mkdir(parents=True, exist_ok=True)
    order = sorted(range(len(ds)), key=lambda i: not ds.rows[i].positive)  # positives first
    for i in order[: min(n, len(ds))]:
        img, c, _ = ds.example(i)
        bgr = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
        if c is not None:
            q, _ = order_corners(c)
            cv2.polylines(bgr, [q.astype(np.int32)], True, (0, 255, 0), 2)
            cv2.circle(bgr, tuple(int(v) for v in q[0]), 6, (0, 0, 255), -1)  # corner 0
        cv2.imwrite(str(out / f"{ds.rows[i].id}.png"), bgr)
    print(f"preview: {min(n, len(ds))} samples -> {out}")


def main() -> int:
    from common import CACHE, CORPUS_DIR

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, default=CORPUS_DIR, help="dir holding manifest.jsonl + raw/")
    ap.add_argument("--split-file", type=Path, default=None, help="default: cache/splits/<manifest dir name>.json (never written into the corpus dir)")
    ap.add_argument("--split-by", default="auto", choices=["auto", "day", "dupGroup"])
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--test", type=float, default=0.15)
    ap.add_argument("--exclude-mirror-padded", action="store_true")
    ap.add_argument("--exclude-reasons", nargs="*", default=[], help="negative reasons to drop, e.g. too_far multiple_no_clear_foreground")
    ap.add_argument("--aug", default="off")
    ap.add_argument("--preview", type=int, default=0)
    a = ap.parse_args()
    rows, _ = load_manifest(a.manifest, exclude_mirror_padded=a.exclude_mirror_padded, exclude_reasons=tuple(a.exclude_reasons))
    split_file = a.split_file or (CACHE / "splits" / f"{a.manifest.resolve().name}.json")
    split = load_or_make_split(rows, split_file, manifest=a.manifest, by=a.split_by, val=a.val, test=a.test)
    print(f"split ({split['meta']['by']}, {split['meta']['groups']} groups, {split['meta']['days']} days): {split['meta']['counts']} -> {split_file}")
    print(f"  by verdict: {split['meta']['by_verdict']}")
    if split["meta"]["note"]:
        print(f"  NOTE: {split['meta']['note']}")
    if split["meta"]["leaks"]:
        print(f"  LEAKS: {split['meta']['leaks']}")
    # Card SIDE share of the square (bbox long side), not area: an upright card
    # covers at most ~72% of a square's area, so an area cut undercounts close-ups.
    extents = [float(np.ptp(r.corners, axis=0).max()) for r in rows if r.corners is not None]
    if extents:
        print(f"  card extent of frame (positives): median {np.median(extents):.2f}, >=0.8 (tight): {sum(e >= 0.8 for e in extents)}/{len(extents)}")
    if a.preview:
        _preview(QuadDataset(rows, AugConfig.preset(a.aug), seed=1), CACHE / "preview" / a.aug, a.preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
