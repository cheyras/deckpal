#!/usr/bin/env python3
"""Executed check for an era-lane usage-research deliverable (usage-rows.json).

Prints WHY it fails: schema, allowed pattern slugs, per-row citations with quotes,
minimum row count, confidence enum, honesty fields.
"""
import json, sys

ALLOWED = {
    "starlight", "cosmos", "fireworks", "mirror", "rainbow-mirror", "big-glitter",
    "energy-symbols", "energy-symbols-ii", "cracked-ice", "pinwheel", "ex-emerald",
    "pokeball-hologram", "vertical-sheen-rainbow", "vertical-sheen", "cosmos-ii-pixel",
    "cosmos-iii-smooth", "tinsel", "tinsel-ii", "diagonal-sheen-right",
    "diagonal-sheen-left", "horizontal-sheen", "striped-vertical-sheen", "prism",
    "starlight-ii", "water-web", "radiant", "rainbow-glitter", "rainbow-glitter-sheen",
    "ace-spec", "pokeball-masterball", "prismatic-pokeball", "radiant-collection-dots",
    "ex-starfoil", "sequin", "crosshatch", "tcg-classic", "confetti", "acid-wash",
    "disco", "none",
}

path = sys.argv[1] if len(sys.argv) > 1 else "usage-rows.json"
min_rows = int(sys.argv[2]) if len(sys.argv) > 2 else 8
try:
    rows = json.load(open(path))
except Exception as e:
    sys.exit(f"FAIL: {path} is not valid JSON: {e}")

errors = []
if not isinstance(rows, list):
    sys.exit("FAIL: top level must be a JSON array of rows")
if len(rows) < min_rows:
    errors.append(f"only {len(rows)} rows (need >= {min_rows})")

nonvideo = 0
for i, r in enumerate(rows):
    where = f"row {i} ({r.get('pattern', '?')})"
    for field in ["pattern", "scope", "claim", "confidence", "sources"]:
        if field not in r:
            errors.append(f"{where}: missing field '{field}'")
    if "conflicts" not in r:
        errors.append(f"{where}: missing 'conflicts' field (use null if none)")
    if r.get("pattern") not in ALLOWED:
        errors.append(f"{where}: pattern '{r.get('pattern')}' not an allowed slug")
    if r.get("confidence") not in ("high", "medium", "low"):
        errors.append(f"{where}: confidence must be high|medium|low")
    scope = r.get("scope", {})
    if not isinstance(scope, dict) or not scope.get("applies_to"):
        errors.append(f"{where}: scope must be an object with at least 'applies_to'")
    srcs = r.get("sources") or []
    if not srcs:
        errors.append(f"{where}: no sources")
    for s in srcs:
        if not isinstance(s, dict) or not str(s.get("url", "")).startswith("http"):
            errors.append(f"{where}: source without http(s) url")
        elif not s.get("quote"):
            errors.append(f"{where}: source {s.get('url')} has no supporting quote")
        if isinstance(s, dict) and "youtu" not in str(s.get("url", "")):
            nonvideo += 1

if nonvideo == 0:
    errors.append("every source is the video — need at least one independent source in the lane")

if errors:
    print(f"FAIL {path}:")
    for e in errors[:40]:
        print(f"  - {e}")
    sys.exit(1)
print(f"PASS {path}: {len(rows)} rows, all cited; {nonvideo} non-video citations")
