"""Run every check in order and summarise. No real training: the train step is
the 40-step smoke test on session 2.

    python run_checks.py            # ~2-3 minutes on the 5080
    python run_checks.py --keep-going

Logs land in cache/checks/<step>.log.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from common import CACHE, HERE

PY = sys.executable
STEPS = [
    ("env", [PY, "check_env.py"]),
    ("inspect", [PY, "inspect_model.py"]),
    ("fixtures", [PY, "fixtures.py"]),
    ("dataset", [PY, "dataset.py", "--manifest", "cache/session2"]),
    ("preprocess-parity", [PY, "parity_preprocess.py"]),
    ("convert-parity", [PY, "convert.py", "--grad"]),
    ("smoke-train", [PY, "train.py", "--manifest", "cache/session2", "--train-on", "all", "--val-on", "all", "--max-steps", "40",
                     "--batch-size", "8", "--lr", "1e-4", "--warmup-steps", "5", "--num-workers", "0", "--log-every", "10", "--run", "smoke"]),
    ("export-pristine", [PY, "export.py", "--pristine"]),
    ("export-smoke", [PY, "export.py", "--checkpoint", "runs/smoke/best.pt"]),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep-going", action="store_true")
    a = ap.parse_args()
    logs = CACHE / "checks"
    logs.mkdir(parents=True, exist_ok=True)
    results = []
    for name, cmd in STEPS:
        t = time.time()
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
        out = r.stdout + ("\n--- stderr ---\n" + r.stderr if r.stderr.strip() else "")
        (logs / f"{name}.log").write_text(out, encoding="utf-8")
        ok = r.returncode == 0
        results.append((name, ok, time.time() - t))
        tail = [l for l in r.stdout.strip().splitlines() if l.strip()][-1:] or ["(no output)"]
        print(f"[{'PASS' if ok else 'FAIL'}] {name:18s} {time.time() - t:6.1f}s  {tail[0][:110]}")
        if not ok and not a.keep_going:
            print(f"stopped; see {logs / (name + '.log')}")
            break
    bad = [n for n, ok, _ in results if not ok]
    print("ALL PASS" if not bad and len(results) == len(STEPS) else f"FAILED: {bad or 'incomplete'}")
    return 0 if not bad and len(results) == len(STEPS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
