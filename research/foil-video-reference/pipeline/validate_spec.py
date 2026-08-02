#!/usr/bin/env python3
"""Executed check for a per-pattern Gemini vision spec (gemini-spec.md).

Validates substance, prints WHY it fails:
- required sections present (case-insensitive)
- claims tied to specific frames (>= 4 distinct "frame N" references)
- minimum length, concrete color vocabulary, tilt-direction language
"""
import re, sys

path = sys.argv[1] if len(sys.argv) > 1 else "gemini-spec.md"
try:
    text = open(path).read()
except OSError as e:
    sys.exit(f"FAIL: cannot read {path}: {e}")

low = text.lower()
errors = []

for section in ["cards shown", "static appearance", "tilt animation",
                "layer structure", "distinguishing", "shader notes", "confidence"]:
    if section not in low:
        errors.append(f"missing required section: {section}")

frames = set(re.findall(r"frame[s]?\s*#?(\d+)", low))
if len(frames) < 4:
    errors.append(f"only {len(frames)} distinct frame references (need >=4) — claims must cite frames")

if len(text) < 1800:
    errors.append(f"spec too thin: {len(text)} chars (need >=1800)")

colors = [c for c in ["red", "green", "blue", "cyan", "magenta", "yellow", "orange",
                      "purple", "violet", "pink", "gold", "silver", "rainbow"] if c in low]
if len(colors) < 2:
    errors.append("no concrete color vocabulary — static appearance must name observed colors")

if not re.search(r"(left|right|up|down|vertical|horizontal|diagonal|toward|away|across)", low):
    errors.append("no directional language — tilt animation must describe motion direction")

if errors:
    print(f"FAIL {path}:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"PASS {path}: sections present, {len(frames)} frame refs, {len(text)} chars")
