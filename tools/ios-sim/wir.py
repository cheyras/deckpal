#!/usr/bin/env python3
"""wir.py -- a minimal Safari Web Inspector client for the iOS Simulator.

macOS only. Python 3 stdlib only (no pip install, no libimobiledevice).

The Simulator's `webinspectord_sim` daemon listens on a Unix domain socket and
speaks a small RPC protocol also used by real-device tools (ios-webkit-debug-
proxy, pymobiledevice3): messages are binary property lists (`bplist00`), each
framed by a 4-byte big-endian length prefix, with no other handshake or
encryption -- the Simulator socket is local-only and needs none of the TLS
pairing a physical device does. See `README.md` for how this fits into the
rest of the kit and the traps that cost time to find.

Two API generations ride the same socket:

  - `_rpc_*` selectors (reportIdentifier, getConnectedApplications,
    forwardGetListing, forwardSocketSetup, forwardSocketData, ...) are the
    outer transport: enumerate inspectable applications and pages, then open a
    per-page forwarding socket.
  - Once a page's socket is open, modern WebKit (iOS 13+, definitely 18.6)
    multiplexes the actual debugging protocol through `Target.sendMessageToTarget`
    / `Target.dispatchMessageFromTarget` rather than talking CDP directly on
    that socket -- the page announces a `targetId` via `Target.targetCreated`,
    and every real command (`Runtime.evaluate`, ...) rides inside a
    `Target.sendMessageToTarget` envelope addressed to that id.

Usage:
    python3 wir.py list [--app safari|standalone] [--json]
    python3 wir.py eval [--app safari|standalone] [--timeout SECONDS] <url-substring> '<js expression>'
    python3 wir.py eval [--app safari|standalone] <url-substring> @path/to/script.js

`<url-substring>` selects which open page/tab to target (matched against the
page's URL, falling back to its title); pass '' to mean "the first page this
app has open." `--app` defaults to `safari`. `standalone` is the host process
for a web app installed via Share > Add to Home Screen (bundle/name containing
"SafariViewService"); `safari` is the ordinary Safari app (com.apple.mobilesafari).

Known Safari quirk this client works around: setting `awaitPromise: true` on
`Runtime.evaluate` does not work over this protocol -- Safari accepts the
promise's own RemoteObject as the immediate "result" instead of waiting for it
to settle, so the caller never sees the resolved value. `eval` therefore always
wraps the expression, parks a thenable's outcome on `window`, and polls a
follow-up `Runtime.evaluate` for it (see `_EVAL_WRAPPER` below) rather than
relying on the protocol's own awaiting.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import plistlib
import socket
import struct
import subprocess
import sys
import time
import uuid
from typing import Any, Callable, Optional

DEFAULT_TIMEOUT = 10.0  # seconds; overridable with --timeout on `eval`
_POLL_INTERVAL = 0.05  # seconds between socket reads and pending-promise checks
_SOCKET_GLOB = "/private/tmp/com.apple.launchd.*/com.apple.webinspectord_sim.socket"
# See refresh_targets()'s docstring for what this retries around. Measured against iOS 18.6: a
# 4s gap between connects was not enough, a 15s gap always was -- one wait comfortably past that,
# rather than a shorter one likely to fail and cost a second round trip anyway.
_REFRESH_RETRY_BACKOFF = (16.0,)
_MAX_REFRESH_ATTEMPTS = len(_REFRESH_RETRY_BACKOFF) + 1

# Page types worth treating as "a web page" for `eval`'s default page search.
# (WIRTypeJavaScript/WIRTypeITML/WIRTypeServiceWorker/WIRTypeAutomation exist
# too, but this kit only ever targets a document a human can look at.)
_WEB_PAGE_TYPES = {"WIRTypePage", "WIRTypeWeb", "WIRTypeWebPage"}

_APP_ALIASES = {
    "safari": ["mobilesafari"],
    "standalone": ["safariviewservice"],
}


class WirError(RuntimeError):
    """Raised for every user-facing failure -- caught once, at the CLI edge."""


# ── Wire framing (pure functions; unit-tested without a socket) ─────────────


def encode_message(selector: str, argument: dict[str, Any]) -> bytes:
    """Build one outbound frame: 4-byte big-endian length + binary-plist body.

    The body is `{"__selector": selector, "__argument": argument}` -- every
    `_rpc_*` call and reply on this socket shares that envelope shape.
    """
    body = plistlib.dumps({"__selector": selector, "__argument": argument}, fmt=plistlib.FMT_BINARY)
    return struct.pack(">I", len(body)) + body


def decode_length(header: bytes) -> int:
    if len(header) != 4:
        raise WirError(f"expected a 4-byte frame length, got {len(header)} byte(s)")
    return struct.unpack(">I", header)[0]


def decode_message(body: bytes) -> dict[str, Any]:
    decoded = plistlib.loads(body)
    if not isinstance(decoded, dict):
        raise WirError(f"expected a plist dict frame, got {type(decoded).__name__}")
    return decoded


# ── Socket transport ─────────────────────────────────────────────────────────


def find_socket() -> str:
    if sys.platform != "darwin":
        raise WirError("wir.py only works against the iOS Simulator, which only exists on macOS.")
    matches = glob.glob(_SOCKET_GLOB)
    if not matches:
        booted = _booted_simulator_names()
        if not booted:
            raise WirError(
                "No booted iOS Simulator found (no webinspectord_sim socket at "
                f"{_SOCKET_GLOB}). Boot one first: `xcrun simctl boot <udid>` or open Simulator.app."
            )
        raise WirError(
            "A Simulator is booted (" + ", ".join(booted) + ") but its Web Inspector socket "
            "is not there yet. It appears once the simulator finishes booting and Safari's "
            "Web Inspector service has started -- wait a few seconds and retry, or confirm "
            "Settings > Safari > Advanced > Web Inspector is on in that simulator."
        )
    if len(matches) == 1:
        return matches[0]
    # More than one: a `simctl shutdown`+`boot` reboot has been observed to leave the previous
    # boot's socket file behind (not cleaned up until something reaps its launchd job), alongside
    # a fresh one for the current boot. That is the common case, not "multiple simulators" -- this
    # is one socket per launchd session, not per device -- so pick the most recently created one
    # rather than erroring; a genuinely stale leftover simply won't accept connections.
    return max(matches, key=lambda path: os.stat(path).st_mtime)


def _booted_simulator_names() -> list[str]:
    try:
        raw = subprocess.run(
            ["xcrun", "simctl", "list", "devices", "booted", "-j"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    names = []
    for devices in data.get("devices", {}).values():
        for device in devices:
            names.append(f"{device.get('name', '?')} ({device.get('udid', '?')})")
    return names


class Transport:
    """The framed request/response socket, with nothing above it. No caching,
    no app/page bookkeeping -- that lives in WebInspectorClient, which is the
    layer worth unit-testing without a real socket."""

    def __init__(self, path: str):
        self._sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._sock.settimeout(_POLL_INTERVAL)
        try:
            self._sock.connect(path)
        except OSError as error:
            self._sock.close()
            raise WirError(f"Could not connect to Web Inspector socket at {path}: {error}") from error
        self._buffer = b""

    def send(self, selector: str, argument: dict[str, Any]) -> None:
        self._sock.sendall(encode_message(selector, argument))

    def recv_one(self) -> Optional[dict[str, Any]]:
        """Return the next fully-framed message, or None if nothing arrived
        within one poll interval (never blocks longer than that)."""
        if not self._fill(4):
            return None
        length = decode_length(self._buffer[:4])
        if not self._fill(4 + length):
            # Header arrived but the body hasn't fully landed yet within this
            # poll interval; leave it buffered and let the next call finish it.
            return None
        message = decode_message(self._buffer[4 : 4 + length])
        self._buffer = self._buffer[4 + length :]
        return message

    def _fill(self, n: int) -> bool:
        """Try to have at least n bytes buffered; returns False on a timeout
        with nothing new, raises on a real disconnect."""
        while len(self._buffer) < n:
            try:
                chunk = self._sock.recv(65536)
            except socket.timeout:
                return False
            if not chunk:
                raise WirError("Web Inspector socket closed unexpectedly (simulator restarted or crashed?)")
            self._buffer += chunk
        return True

    def close(self) -> None:
        self._sock.close()


# ── Client: application/page directory + one eval session ──────────────────


class WebInspectorClient:
    def __init__(self, socket_path: Optional[str] = None):
        self._transport = Transport(socket_path or find_socket())
        self._connection_id = str(uuid.uuid4()).upper()
        self.apps: dict[str, dict[str, Any]] = {}
        self.pages: dict[str, dict[int, dict[str, Any]]] = {}
        self._target_ids: dict[str, str] = {}  # session id -> targetId, once Target.targetCreated arrives
        self._dispatch: dict[int, dict[str, Any]] = {}  # inner Runtime.* message id -> its response
        self._msg_counter = 0
        self._transport.send("_rpc_reportIdentifier:", {"WIRConnectionIdentifierKey": self._connection_id})

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "WebInspectorClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- discovery --

    def refresh_targets(self, settle: float = 1.5, overall_timeout: float = 5.0) -> None:
        """Populate `self.apps`/`self.pages` from the daemon. Sends
        `_rpc_getConnectedApplications:`, then queries each reported app's
        page listing in turn (the daemon reports apps and pages as separate,
        asynchronous pushes -- there is no single synchronous "give me
        everything" call).

        `webinspectord_sim` appears to cap concurrent/recent connections: the
        third fresh connection within roughly ten seconds gets no reply at all
        to anything, not even the unsolicited `_rpc_reportCurrentState:` every
        other connection receives immediately -- observed repeatedly against
        iOS 18.6, spacing did not matter below ~10s, and a plain retry after a
        pause always recovered. Zero frames within `overall_timeout` is
        therefore treated as that cooldown, not as "nothing is open," and
        retried on a fresh connection rather than reported as an empty list.
        """
        for attempt in range(1, _MAX_REFRESH_ATTEMPTS + 1):
            frames_seen = self._refresh_targets_once(settle, overall_timeout)
            if frames_seen or attempt == _MAX_REFRESH_ATTEMPTS:
                return
            wait = _REFRESH_RETRY_BACKOFF[attempt - 1]
            print(
                f"wir.py: Web Inspector gave no response at all (likely its simulator-side "
                f"connection limit cooling down) -- retrying in {wait:.0f}s...",
                file=sys.stderr,
            )
            time.sleep(wait)
            self._reconnect()

    def _reconnect(self) -> None:
        self._transport.close()
        self._transport = Transport(find_socket())
        self._connection_id = str(uuid.uuid4()).upper()
        self._target_ids.clear()
        self._dispatch.clear()
        self._transport.send("_rpc_reportIdentifier:", {"WIRConnectionIdentifierKey": self._connection_id})

    def _refresh_targets_once(self, settle: float, overall_timeout: float) -> int:
        """One discovery attempt. Returns how many frames were received."""
        self.apps.clear()
        self.pages.clear()
        queried: set[str] = set()
        frames_seen = 0
        self._transport.send("_rpc_getConnectedApplications:", {"WIRConnectionIdentifierKey": self._connection_id})
        deadline = time.monotonic() + overall_timeout
        # `last_change` stays None until the first thing actually arrives -- the daemon's initial
        # reply can take longer than `settle` under load (e.g. several `wir.py` invocations back to
        # back), and a quiet-period cutoff that starts counting before anything has happened would
        # bail out having seen nothing at all instead of waiting for it.
        last_change: Optional[float] = None
        while time.monotonic() < deadline:
            changed = self._pump_once()
            if changed:
                frames_seen += 1
            for app_id in self.apps:
                if app_id not in queried:
                    queried.add(app_id)
                    self._transport.send(
                        "_rpc_forwardGetListing:",
                        {"WIRConnectionIdentifierKey": self._connection_id, "WIRApplicationIdentifierKey": app_id},
                    )
                    changed = True
            if changed:
                last_change = time.monotonic()
            elif last_change is not None and time.monotonic() - last_change > settle:
                break  # nothing new for `settle` seconds and every known app has been queried
        return frames_seen

    def find_page(self, app_alias: str, url_substring: str) -> tuple[dict[str, Any], dict[str, Any]]:
        self.refresh_targets()
        needles = _APP_ALIASES.get(app_alias, [app_alias])
        matching_apps = [
            app for app in self.apps.values()
            if any(needle in _haystack(app).lower() for needle in needles)
        ]
        if not matching_apps:
            available = ", ".join(sorted(_haystack(a) for a in self.apps.values())) or "(none)"
            raise WirError(
                f"No inspectable application matched --app {app_alias!r}. "
                f"Available applications: {available}. Web Inspector only reports an app once "
                "it is running and has an open page -- open it in the simulator first."
            )
        for app in matching_apps:
            for page in self.pages.get(app["id"], {}).values():
                if page["type"] not in _WEB_PAGE_TYPES:
                    continue
                if url_substring and url_substring not in page.get("url", "") and url_substring not in page.get("title", ""):
                    continue
                return app, page
        open_pages = [
            f"{app['name']}: {p.get('url') or p.get('title') or '(untitled)'}"
            for app in matching_apps
            for p in self.pages.get(app["id"], {}).values()
        ]
        raise WirError(
            f"--app {app_alias!r} matched {[a['name'] for a in matching_apps]} but no open page matched "
            f"url-substring {url_substring!r}. Open pages there: {open_pages or '(none -- is a tab actually open?)'}. "
            "Web Inspector needs the page open and in the foreground; a backgrounded/suspended tab does not list."
        )

    # -- eval session (one forwarding socket per call, torn down after) --

    def evaluate(self, app_alias: str, url_substring: str, expression: str, timeout: float = DEFAULT_TIMEOUT) -> Any:
        app, page = self.find_page(app_alias, url_substring)
        session_id = str(uuid.uuid4()).upper()
        try:
            target_id = self._open_target(session_id, app["id"], page["id"], timeout)
            wrapped = _EVAL_WRAPPER.replace("__EXPRESSION__", expression)
            outcome = self._runtime_evaluate(session_id, target_id, app["id"], page["id"], wrapped, timeout)
            if isinstance(outcome, dict) and outcome.get("__pending"):
                outcome = self._poll_pending(session_id, target_id, app["id"], page["id"], outcome["__pending"], timeout)
            if isinstance(outcome, dict) and "__error" in outcome:
                raise WirError(f"JavaScript threw: {outcome['__error']}")
            return outcome.get("__value") if isinstance(outcome, dict) else outcome
        finally:
            self._transport.send(
                "_rpc_forwardDidClose:",
                {
                    "WIRConnectionIdentifierKey": self._connection_id,
                    "WIRApplicationIdentifierKey": app["id"],
                    "WIRPageIdentifierKey": page["id"],
                    "WIRSenderKey": session_id,
                },
            )

    def _open_target(self, session_id: str, app_id: str, page_id: int, timeout: float) -> str:
        self._transport.send(
            "_rpc_forwardSocketSetup:",
            {
                "WIRConnectionIdentifierKey": self._connection_id,
                "WIRApplicationIdentifierKey": app_id,
                "WIRPageIdentifierKey": page_id,
                "WIRSenderKey": session_id,
                "WIRMessageDataTypeChunkSupportedKey": 0,
                "WIRAutomaticallyPause": False,
            },
        )
        if not self._pump_until(lambda: session_id in self._target_ids, timeout):
            raise WirError(
                "Web Inspector did not report a debugging target for that page within "
                f"{timeout}s. The page must be open and in the foreground -- a suspended or "
                "backgrounded WKWebView does not create one."
            )
        return self._target_ids[session_id]

    def _runtime_evaluate(self, session_id: str, target_id: str, app_id: str, page_id: int, expression: str, timeout: float) -> Any:
        message_id = self._send_target_message(session_id, target_id, app_id, page_id, "Runtime.evaluate", {
            "expression": expression,
            "objectGroup": "console",
            "includeCommandLineAPI": True,
            "silent": False,
            "returnByValue": True,
            "generatePreview": False,
            "userGesture": True,
            "awaitPromise": False,  # unreliable over this protocol -- see module docstring
            "replMode": True,
        })
        response = self._wait_for_response(message_id, timeout)
        result = response.get("result", {}).get("result", {})
        if result.get("subtype") == "error" or response.get("result", {}).get("wasThrown"):
            raise WirError(f"JavaScript threw: {result.get('description', result)}")
        if result.get("type") == "undefined":
            return None
        return result.get("value")

    def _poll_pending(self, session_id: str, target_id: str, app_id: str, page_id: int, window_key: str, timeout: float) -> Any:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self._runtime_evaluate(session_id, target_id, app_id, page_id, f"window[{window_key!r}]", timeout)
            if isinstance(state, dict) and not state.get("pending"):
                self._runtime_evaluate(session_id, target_id, app_id, page_id, f"delete window[{window_key!r}]", timeout)
                if "error" in state:
                    return {"__error": state["error"]}
                return {"__pending": None, "__value": state.get("value")}
            time.sleep(_POLL_INTERVAL)
        raise WirError(
            f"A promise-returning expression did not settle within {timeout}s. "
            "Pass --timeout to wait longer, or check the page for a stalled await."
        )

    def _send_target_message(self, session_id: str, target_id: str, app_id: str, page_id: int, method: str, params: dict[str, Any]) -> int:
        self._msg_counter += 1
        message_id = self._msg_counter
        inner = json.dumps({"id": message_id, "method": method, "params": params})
        self._transport.send(
            "_rpc_forwardSocketData:",
            {
                "WIRConnectionIdentifierKey": self._connection_id,
                "WIRApplicationIdentifierKey": app_id,
                "WIRPageIdentifierKey": page_id,
                "WIRSessionIdentifierKey": session_id,
                "WIRSenderKey": session_id,
                "WIRSocketDataKey": json.dumps({
                    "method": "Target.sendMessageToTarget",
                    "params": {"targetId": target_id, "message": inner},
                    "id": message_id,
                }).encode(),
            },
        )
        return message_id

    def _wait_for_response(self, message_id: int, timeout: float) -> dict[str, Any]:
        if not self._pump_until(lambda: message_id in self._dispatch, timeout):
            raise WirError(f"No response to message {message_id} within {timeout}s.")
        return self._dispatch.pop(message_id)

    # -- pump / dispatch --

    def _pump_until(self, predicate: Callable[[], bool], timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            if predicate():
                return True
            if time.monotonic() >= deadline:
                return predicate()
            self._pump_once()

    def _pump_once(self) -> bool:
        """Read and dispatch exactly one available frame, if any arrived
        within one poll interval. Returns whether anything was processed."""
        message = self._transport.recv_one()
        if message is None:
            return False
        self.dispatch(message)
        return True

    def dispatch(self, message: dict[str, Any]) -> None:
        """Route one decoded top-level frame. Split out from the socket loop
        so the RPC-handling logic is unit-testable with plain dicts."""
        selector = message.get("__selector")
        arg = message.get("__argument", {})
        if selector == "_rpc_reportConnectedApplicationList:":
            for app_id, app_dict in arg.get("WIRApplicationDictionaryKey", {}).items():
                self.apps[app_id] = _app_from_dict(app_dict)
        elif selector in ("_rpc_applicationConnected:", "_rpc_applicationUpdated:"):
            app = _app_from_dict(arg)
            self.apps[app["id"]] = app
        elif selector == "_rpc_applicationDisconnected:":
            app_id = arg.get("WIRApplicationIdentifierKey")
            self.apps.pop(app_id, None)
            self.pages.pop(app_id, None)
        elif selector == "_rpc_applicationSentListing:":
            app_id = arg["WIRApplicationIdentifierKey"]
            pages = {int(pid): _page_from_dict(pd) for pid, pd in arg.get("WIRListingKey", {}).items()}
            self.pages[app_id] = pages
        elif selector == "_rpc_applicationSentData:":
            self._dispatch_application_data(arg)
        # else: _rpc_reportCurrentState:, _rpc_reportConnectedDriverList:, and anything else are
        # informational only (automation availability / driver list) and carry nothing eval or
        # list needs.

    def _dispatch_application_data(self, arg: dict[str, Any]) -> None:
        raw = arg.get("WIRMessageDataKey")
        if not raw:
            return
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return
        method = payload.get("method")
        session_id = arg.get("WIRDestinationKey", "")
        if method == "Target.targetCreated":
            target_id = payload.get("params", {}).get("targetInfo", {}).get("targetId")
            if target_id:
                self._target_ids[session_id] = target_id
        elif method == "Target.dispatchMessageFromTarget":
            inner_raw = payload.get("params", {}).get("message")
            try:
                inner = json.loads(inner_raw) if inner_raw else {}
            except json.JSONDecodeError:
                return
            if "id" in inner:
                self._dispatch[inner["id"]] = inner
        # Console.messageAdded / Heap.* / Runtime.executionContextCreated / Target.targetDestroyed
        # are console/lifecycle noise this CLI has no use for.


def _haystack(app: dict[str, Any]) -> str:
    return " ".join(str(app.get(k, "")) for k in ("id", "bundle", "name"))


def _app_from_dict(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": d.get("WIRApplicationIdentifierKey", ""),
        "bundle": d.get("WIRApplicationBundleIdentifierKey", ""),
        "name": d.get("WIRApplicationNameKey", ""),
        "active": bool(d.get("WIRIsApplicationActiveKey", False)),
        "proxy": bool(d.get("WIRIsApplicationProxyKey", False)),
        "ready": bool(d.get("WIRIsApplicationReadyKey", False)),
        "host": d.get("WIRHostApplicationIdentifierKey", ""),
    }


def _page_from_dict(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": d.get("WIRPageIdentifierKey"),
        "type": d.get("WIRTypeKey", ""),
        "title": d.get("WIRTitleKey", ""),
        "url": d.get("WIRURLKey", ""),
        "connection_id": d.get("WIRConnectionIdentifierKey", ""),
    }


# The eval expression is wrapped so a thenable result is parked on `window`
# and polled for, instead of relying on `awaitPromise` -- see module docstring.
_EVAL_WRAPPER = """
(function () {
  var __key = '__deckpal_wir_' + Math.random().toString(36).slice(2);
  try {
    var __v = (__EXPRESSION__);
    if (__v && typeof __v.then === 'function') {
      window[__key] = { pending: true };
      __v.then(
        function (r) { window[__key] = { pending: false, value: r }; },
        function (e) { window[__key] = { pending: false, error: (e && e.message) || String(e) }; }
      );
      return { __pending: __key };
    }
    return { __pending: null, __value: __v };
  } catch (e) {
    return { __pending: null, __error: (e && e.message) || String(e) };
  }
})()
""".strip()


# ── CLI ──────────────────────────────────────────────────────────────────────


def _read_expression(raw: str) -> str:
    if raw.startswith("@"):
        with open(raw[1:], "r", encoding="utf-8") as handle:
            return handle.read()
    return raw


def _cmd_list(args: argparse.Namespace) -> int:
    with WebInspectorClient() as client:
        client.refresh_targets()
        apps = list(client.apps.values())
        if args.app:
            needles = _APP_ALIASES.get(args.app, [args.app])
            apps = [a for a in apps if any(n in _haystack(a).lower() for n in needles)]
        if args.json:
            out = [{**a, "pages": list(client.pages.get(a["id"], {}).values())} for a in apps]
            print(json.dumps(out, indent=2))
            return 0
        if not apps:
            print("No inspectable applications found. Is anything open in the simulator?")
            return 0
        for app in apps:
            print(f"{app['name']} ({app['id']})" + ("" if app["ready"] else "  [not ready]"))
            pages = client.pages.get(app["id"], {})
            if not pages:
                print("  (no open pages)")
            for page in pages.values():
                attached = f"  [attached: {page['connection_id']}]" if page["connection_id"] else ""
                label = page["url"] or page["title"] or "(untitled)"
                print(f"  #{page['id']} [{page['type']}] {label}{attached}")
        return 0


def _cmd_eval(args: argparse.Namespace) -> int:
    expression = _read_expression(args.expression)
    with WebInspectorClient() as client:
        result = client.evaluate(args.app, args.url_substring, expression, timeout=args.timeout)
    print(json.dumps(result, indent=2) if args.json else _render(result))
    return 0


def _render(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, indent=2)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wir.py",
        description="Minimal Safari Web Inspector client for the iOS Simulator (macOS only).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    list_cmd = sub.add_parser("list", help="List inspectable applications and their open pages.")
    list_cmd.add_argument("--app", choices=["safari", "standalone"], default=None, help="Restrict to one app alias.")
    list_cmd.add_argument("--json", action="store_true", help="Print machine-readable JSON instead of a table.")
    list_cmd.set_defaults(func=_cmd_list)

    eval_cmd = sub.add_parser("eval", help="Evaluate a JS expression on a matching open page.")
    eval_cmd.add_argument("--app", choices=["safari", "standalone"], default="safari", help="Which app to target (default: safari).")
    eval_cmd.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help=f"Seconds to wait for setup/results (default: {DEFAULT_TIMEOUT}).")
    eval_cmd.add_argument("--json", action="store_true", help="Force JSON output even for a plain string result.")
    eval_cmd.add_argument("url_substring", help="Substring of the target page's URL (or title). '' matches the first open page.")
    eval_cmd.add_argument("expression", help="A JS expression, or @path/to/file.js to read one from disk.")
    eval_cmd.set_defaults(func=_cmd_eval)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except WirError as error:
        print(f"wir.py: {error}", file=sys.stderr)
        return 1
    except FileNotFoundError as error:
        print(f"wir.py: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
