#!/usr/bin/env bash
# shot.sh -- screenshot fallback for the booted iOS Simulator.
#
# The simulator MCP tool's own screenshot action can fail right after a
# device reboot (a known trap -- see README.md's "reboot to clear
# hardware-keyboard mode" trap, which is exactly when you are most likely to
# reach for this). `xcrun simctl io ... screenshot` talks to CoreSimulator
# directly and does not depend on that tool's attach state, so it works then.
#
# Usage:
#   tools/ios-sim/shot.sh                       # screenshot the booted device -> /tmp/deckpal-sim-<timestamp>.png
#   tools/ios-sim/shot.sh out.png                # explicit output path
#   tools/ios-sim/shot.sh out.png <udid>          # explicit device (default: the one booted device)
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "shot.sh: the iOS Simulator only exists on macOS." >&2
  exit 1
fi

out="${1:-/tmp/deckpal-sim-$(date +%Y%m%d-%H%M%S).png}"
udid="${2:-booted}"

if [[ "$udid" == "booted" ]]; then
  booted_count=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=json.load(sys.stdin)["devices"]; print(sum(len(v) for v in d.values()))')
  if [[ "$booted_count" -eq 0 ]]; then
    echo "shot.sh: no booted simulator found. Boot one first (xcrun simctl boot <udid>)." >&2
    exit 1
  elif [[ "$booted_count" -gt 1 ]]; then
    echo "shot.sh: more than one simulator is booted; pass a udid explicitly (xcrun simctl list devices booted)." >&2
    exit 1
  fi
fi

xcrun simctl io "$udid" screenshot "$out"
echo "$out"
