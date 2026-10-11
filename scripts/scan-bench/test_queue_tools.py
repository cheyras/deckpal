"""Regression checks for the owner-photo queue tools (PR #298's review cases).

    python scripts/scan-bench/test_queue_tools.py

Offline: synthetic images and temporary directories only. No photos, no network.
"""
from __future__ import annotations

import importlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
# The modules check SCAN_QUEUE_DIR on import: point it somewhere harmless first.
_SAFE = tempfile.mkdtemp(prefix="queue-tools-test-")
os.environ["SCAN_QUEUE_DIR"] = _SAFE
import extract_cards as X  # noqa: E402
import label_cards as L  # noqa: E402
import queue_paths as QP  # noqa: E402


def _dir_link(link: Path, target: Path) -> None:
    """A directory link that needs no privilege: a junction on Windows."""
    if sys.platform == "win32":
        import _winapi

        _winapi.CreateJunction(str(target), str(link))
    else:
        os.symlink(target, link, target_is_directory=True)


def _card(img: np.ndarray, x: int, y: int, w: int, art: bool = True) -> None:
    """A light card with a dark border; optionally a thick-edged 63:88 art box
    inside, whose two edges give several near-identical inner contours."""
    h = round(w * 88 / 63)
    cv2.rectangle(img, (x, y), (x + w, y + h), (235, 225, 200), -1)
    cv2.rectangle(img, (x, y), (x + w, y + h), (30, 30, 30), 4)
    if art:
        aw = w // 2
        ah = round(aw * 88 / 63)
        ax, ay = x + (w - aw) // 2, y + (h - ah) // 2
        cv2.rectangle(img, (ax, ay), (ax + aw, ay + ah), (40, 60, 160), 9)


class QueueDirTest(unittest.TestCase):
    def _refused(self, module, path: str) -> bool:
        os.environ["SCAN_QUEUE_DIR"] = path
        try:
            module.queue_dir()
            return False
        except SystemExit:
            return True
        finally:
            os.environ["SCAN_QUEUE_DIR"] = _SAFE

    def test_inside_repo_refused(self):
        for m in (X, L):
            self.assertTrue(self._refused(m, str(REPO / "queue")))
            self.assertTrue(self._refused(m, str(REPO)))

    @unittest.skipUnless(sys.platform == "win32", "case-insensitive paths are a Windows property")
    def test_other_case_spelling_refused(self):
        for m in (X, L):
            self.assertTrue(self._refused(m, str(REPO).upper() + "\\queue"))
            self.assertTrue(self._refused(m, str(REPO).lower()))

    def test_outside_repo_allowed(self):
        for m in (X, L):
            self.assertFalse(self._refused(m, _SAFE))
            # A sibling whose name merely STARTS with the repo's is outside it.
            self.assertFalse(self._refused(m, str(REPO) + "-queue"))


class ChildLinkTest(unittest.TestCase):
    """A queue outside the repo whose CHILDREN link back into it (Astra's review
    of #298). A temporary directory stands in for the repo, so nothing here
    touches the real checkout."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="queue-links-"))
        self.repo = self.tmp / "fake-repo"
        (self.repo / "inside").mkdir(parents=True)
        self.q = self.tmp / "queue"
        self.q.mkdir()
        self._saved = QP._repo_real
        QP._repo_real = QP._real(self.repo)

    def tearDown(self):
        QP._repo_real = self._saved
        # rmtree removes a junction or symlink without following it (3.8+).
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_queue_root_itself(self):
        self.assertRaises(SystemExit, QP.checked, self.repo)
        self.assertRaises(SystemExit, QP.checked, self.repo / "inside" / "x.jpg")
        self.assertEqual(QP.checked(self.q / "x.jpg"), self.q / "x.jpg")

    def test_child_directory_junction(self):
        _dir_link(self.q / "cards", self.repo / "inside")
        self.assertRaises(SystemExit, QP.checked, self.q / "cards")
        self.assertRaises(SystemExit, QP.checked, self.q / "cards" / "photo-0.jpg")

    def test_dangling_child_junction(self):
        # The target does not exist yet: writing under it would create it, in the repo.
        (self.repo / "not-yet").mkdir()  # a junction needs its target to exist when made...
        _dir_link(self.q / "cards", self.repo / "not-yet")
        (self.repo / "not-yet").rmdir()  # ...and then it dangles
        self.assertRaises(SystemExit, QP.checked, self.q / "cards" / "photo-0.jpg")

    def test_child_file_symlink(self):
        try:
            os.symlink(self.repo / "cards.jsonl", self.q / "cards.jsonl")
        except OSError:
            self.skipTest("file symlinks need a privilege this shell does not have")
        self.assertRaises(SystemExit, QP.checked, self.q / "cards.jsonl")

    def test_extract_cards_writes_nothing_through_a_linked_cards_dir(self):
        (self.q / "raw").mkdir()
        img = np.full((900, 900, 3), 120, np.uint8)
        _card(img, 300, 150, 300)
        cv2.imwrite(str(self.q / "raw" / "photo.jpg"), img)
        _dir_link(self.q / "cards", self.repo / "inside")
        saved_q, saved_argv = X.Q, sys.argv
        X.Q, sys.argv = self.q, ["extract_cards.py"]
        try:
            self.assertRaises(SystemExit, X.main)
        finally:
            X.Q, sys.argv = saved_q, saved_argv
        self.assertEqual(list((self.repo / "inside").iterdir()), [])
        self.assertFalse((self.q / "cards.jsonl").exists())


class CandidatesTest(unittest.TestCase):
    def test_card_with_inner_art_box_survives(self):
        img = np.full((1200, 1200, 3), 120, np.uint8)
        _card(img, 400, 250, 320)
        quads = X.candidates(img)
        widths = sorted(round(float(np.linalg.norm(q[1] - q[0]))) for q in quads)
        self.assertTrue(any(abs(w - 320) <= 12 for w in widths), f"the card outline was dropped: {widths}")

    def test_binder_page_dropped_cards_kept(self):
        img = np.full((1600, 1600, 3), 90, np.uint8)
        pw, ph = 3 * 200 + 4 * 20, round((3 * 200 + 4 * 20) * 88 / 63)
        px, py = 200, 30
        cv2.rectangle(img, (px, py), (px + pw, py + ph), (60, 60, 60), 6)
        for r in range(3):
            for c in range(3):
                _card(img, px + 20 + c * 220, py + 20 + r * round(220 * 88 / 63), 200, art=False)
        quads = X.candidates(img)
        widths = [round(float(np.linalg.norm(q[1] - q[0]))) for q in quads]
        self.assertFalse(any(w > pw * 0.8 for w in widths), f"the page was kept: {widths}")
        self.assertEqual(sum(1 for w in widths if abs(w - 200) <= 12), 9, f"cards: {widths}")


class GateInferenceTest(unittest.TestCase):
    def test_only_known_checkpoints_infer_a_gate(self):
        self.assertEqual(L.KNOWN_GALLERY_TAGS.get(L.gallery_tag("x/deckpal-card-b32-v1.fp32.onnx")), "deckpal-card-b32-v1")
        self.assertEqual(L.KNOWN_GALLERY_TAGS.get(L.gallery_tag("timm:vit_base_patch32_clip_224.openai")), "clip-vit-b32-openai")
        for other in ("x/tinyclip.onnx", "timm:vit_base_patch32_clip_224.laion2b_e16", "x/clip-vit-b32-openai.int8.onnx"):
            self.assertIsNone(L.KNOWN_GALLERY_TAGS.get(L.gallery_tag(other)), other)


if __name__ == "__main__":
    unittest.main()
