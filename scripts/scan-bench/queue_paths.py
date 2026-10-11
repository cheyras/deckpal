"""Where the owner-photo queue tools may write: anywhere but inside the repo.

extract_cards.py and label_cards.py write the owner's photos and crops, so every
write goes through `checked()` first, not just the queue root. A `cards`
directory or a `cards.jsonl` inside an outside queue can itself be a junction or
a symlink back into the checkout (Astra's review of #298 reproduced both).
Paths are compared REAL, with every link on the way resolved by
os.path.realpath, and case-folded with os.path.normcase, so `E:\\USERS\\...` is
the same checkout as `E:\\users\\...` on Windows. queue-guard.mjs is the
JavaScript twin, for queue-pull.mjs.

This keeps a mis-set path, or a stale link, from putting private photos in git.
It is not a defence against someone racing the script to swap a link after the
check.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _real(p: os.PathLike | str) -> str:
    return os.path.normcase(os.path.realpath(p))


_repo_real = _real(REPO)


def inside_repo(p: os.PathLike | str) -> bool:
    r = _real(p)
    return r == _repo_real or r.startswith(_repo_real.rstrip(os.sep) + os.sep)


def queue_dir() -> Path:
    """SCAN_QUEUE_DIR (outside the repo) or ~/deckpal-data/quad-queue."""
    q = Path(os.environ.get("SCAN_QUEUE_DIR") or Path.home() / "deckpal-data" / "quad-queue").resolve()
    if inside_repo(q):
        raise SystemExit(f"SCAN_QUEUE_DIR resolves inside the repo ({q}); the owner's photos must stay outside git")
    return q


def checked(p: Path) -> Path:
    """`p`, if writing to it cannot land inside the repo: its real location,
    with any link on the way, or `p` itself as a link, resolved, is outside."""
    if inside_repo(p):
        raise SystemExit(f"{p} resolves inside the repo ({os.path.realpath(p)}); refusing to write the owner's photos there")
    return p
