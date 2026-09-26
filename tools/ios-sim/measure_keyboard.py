#!/usr/bin/env python3
"""measure_keyboard.py -- focus a field, then run keyboard_probe.js on it.

    python3 tools/ios-sim/measure_keyboard.py [--app safari|standalone] [--timeout SECONDS] <url-substring> <css-selector>

Convenience wrapper around `wir.py`'s `WebInspectorClient`: attempts to
programmatically focus `<css-selector>` on the matching page, gives the
keyboard/layout animation a moment to settle, then evaluates
`keyboard_probe.js` and prints its JSON result.

IMPORTANT LIMITATION, not a bug: iOS only raises the on-screen keyboard for a
focus that happens inside a real user gesture. A script-triggered
`element.focus()` -- which is all a Web Inspector eval can do -- usually does
NOT raise it, even though the element does become `document.activeElement`.
For a real repro, tap the field for real first (the simulator MCP tool's
`tap`, not this script, and never its `text` action -- see README.md), and
only then run this (or `wir.py eval ... @keyboard_probe.js` directly) to
measure the keyboard that tap raised. This script still earns its place for
the parts that do not depend on the keyboard: scrolling the field into view,
confirming a selector actually resolves before you go tap coordinates for it,
and re-measuring layout after an already-visible keyboard settles.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wir  # noqa: E402  (path must be set up first)

_PROBE_PATH = Path(__file__).resolve().parent / "keyboard_probe.js"
_SETTLE_SECONDS = 0.4  # time for layout/keyboard animation to finish before measuring


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--app", choices=["safari", "standalone"], default="safari")
    parser.add_argument("--timeout", type=float, default=wir.DEFAULT_TIMEOUT)
    parser.add_argument("url_substring", help="Substring of the target page's URL (or title).")
    parser.add_argument("selector", help="CSS selector of the field to focus, e.g. 'textarea[name=description]'.")
    args = parser.parse_args(argv)

    probe = _PROBE_PATH.read_text(encoding="utf-8")

    with wir.WebInspectorClient() as client:
        focused = client.evaluate(
            args.app, args.url_substring,
            f"(function(){{ var el = document.querySelector({args.selector!r}); "
            "if (el) { el.scrollIntoView({block: 'center'}); el.focus(); } return !!el; })()",
            timeout=args.timeout,
        )
        if not focused:
            print(f"measure_keyboard.py: no element matched selector {args.selector!r} on that page.", file=sys.stderr)
            return 1
        time.sleep(_SETTLE_SECONDS)
        result = client.evaluate(args.app, args.url_substring, probe, timeout=args.timeout)

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
