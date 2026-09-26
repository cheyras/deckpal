#!/usr/bin/env python3
"""Pure unit tests for wir.py -- the plist frame codec and dict-building
helpers, plus the client's message dispatch/routing logic driven with plain
dicts (no socket, no simulator, no macOS dependency). Run with:

    python3 -m unittest tools/ios-sim/__tests__/test_wir.py -v

or, from this directory:

    python3 -m unittest discover -s __tests__ -v
"""
import json
import os
import pathlib
import struct
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import wir  # noqa: E402


class FramingTests(unittest.TestCase):
    """encode_message / decode_length / decode_message: the wire format is a
    4-byte big-endian length prefix followed by a binary plist body (see
    module docstring for where that shape is confirmed against real
    implementations)."""

    def test_round_trip(self):
        frame = wir.encode_message("_rpc_reportIdentifier:", {"WIRConnectionIdentifierKey": "abc-123"})
        length = wir.decode_length(frame[:4])
        self.assertEqual(length, len(frame) - 4)
        message = wir.decode_message(frame[4:])
        self.assertEqual(message["__selector"], "_rpc_reportIdentifier:")
        self.assertEqual(message["__argument"], {"WIRConnectionIdentifierKey": "abc-123"})

    def test_length_prefix_is_big_endian(self):
        # A body of exactly 256 bytes must encode as 0x00,0x01,0x00,0x00 -- if this were
        # little-endian it would read as 0x00000100 reversed, i.e. a different device entirely
        # would appear to send an enormous or tiny frame and framing would desync from there on.
        frame = wir.encode_message("_rpc_x:", {"pad": "a" * 400})
        length = struct.unpack(">I", frame[:4])[0]
        self.assertEqual(length, len(frame) - 4)
        # Cross-check against the naive little-endian reading to prove the two disagree
        # (guards against a swap that happens to still round-trip on this platform).
        self.assertNotEqual(length, struct.unpack("<I", frame[:4])[0])

    def test_decode_length_rejects_short_header(self):
        with self.assertRaises(wir.WirError):
            wir.decode_length(b"\x00\x00")

    def test_decode_message_rejects_non_dict_plist(self):
        import plistlib
        body = plistlib.dumps(["not", "a", "dict"], fmt=plistlib.FMT_BINARY)
        with self.assertRaises(wir.WirError):
            wir.decode_message(body)

    def test_binary_data_value_round_trips(self):
        # WIRSocketDataKey and WIRApplicationIconKey both carry raw bytes (<data> in the plist);
        # plistlib must hand those back as `bytes`, not a base64 string or anything JSON-shaped,
        # since downstream code (_dispatch_application_data) calls json.loads() directly on it.
        frame = wir.encode_message("_rpc_forwardSocketData:", {"WIRSocketDataKey": b'{"method":"Target.targetCreated"}'})
        message = wir.decode_message(frame[4:])
        self.assertIsInstance(message["__argument"]["WIRSocketDataKey"], bytes)


class FindSocketTests(unittest.TestCase):
    """find_socket()'s handling of the launchd glob -- no real socket needed, since it only
    globs and stats paths before returning one for the caller to connect() to."""

    def test_picks_the_most_recently_modified_match(self):
        # Observed for real: `simctl shutdown`+`boot` can leave the previous boot's socket file
        # behind alongside a fresh one for the new boot (see README.md's traps). Both glob-match;
        # the fresh one must win, not an error demanding the caller disambiguate.
        with tempfile.TemporaryDirectory() as tmp:
            stale = os.path.join(tmp, 'com.apple.launchd.AAAA', 'com.apple.webinspectord_sim.socket')
            fresh = os.path.join(tmp, 'com.apple.launchd.BBBB', 'com.apple.webinspectord_sim.socket')
            for path in (stale, fresh):
                os.makedirs(os.path.dirname(path))
                pathlib.Path(path).touch()
            now = time.time()
            os.utime(stale, (now - 3600, now - 3600))
            os.utime(fresh, (now, now))
            with mock.patch.object(wir, '_SOCKET_GLOB', os.path.join(tmp, 'com.apple.launchd.*', 'com.apple.webinspectord_sim.socket')):
                self.assertEqual(wir.find_socket(), fresh)

    def test_raises_with_a_clear_message_when_nothing_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(wir, '_SOCKET_GLOB', os.path.join(tmp, 'nothing-here', '*.socket')):
                with mock.patch.object(wir, '_booted_simulator_names', return_value=[]):
                    with self.assertRaisesRegex(wir.WirError, 'No booted iOS Simulator'):
                        wir.find_socket()


class AppPageDictTests(unittest.TestCase):
    def test_app_from_dict_reads_known_keys(self):
        app = wir._app_from_dict({
            "WIRApplicationIdentifierKey": "PID:123",
            "WIRApplicationBundleIdentifierKey": "com.apple.mobilesafari",
            "WIRApplicationNameKey": "Safari",
            "WIRIsApplicationActiveKey": True,
            "WIRIsApplicationProxyKey": False,
            "WIRIsApplicationReadyKey": True,
        })
        self.assertEqual(app, {
            "id": "PID:123", "bundle": "com.apple.mobilesafari", "name": "Safari",
            "active": True, "proxy": False, "ready": True, "host": "",
        })

    def test_app_from_dict_tolerates_missing_optional_keys(self):
        # WIRHostApplicationIdentifierKey is absent for a top-level app (only set for a hosted
        # webview like SafariViewService) -- must not KeyError.
        app = wir._app_from_dict({"WIRApplicationIdentifierKey": "PID:1", "WIRIsApplicationActiveKey": False,
                                   "WIRIsApplicationProxyKey": False, "WIRIsApplicationReadyKey": False})
        self.assertEqual(app["host"], "")

    def test_page_from_dict_reads_known_keys(self):
        page = wir._page_from_dict({
            "WIRPageIdentifierKey": 1, "WIRTypeKey": "WIRTypeWebPage",
            "WIRTitleKey": "DeckPal", "WIRURLKey": "http://127.0.0.1:5310/lists",
            "WIRConnectionIdentifierKey": "conn-1",
        })
        self.assertEqual(page["id"], 1)
        self.assertEqual(page["type"], "WIRTypeWebPage")
        self.assertEqual(page["url"], "http://127.0.0.1:5310/lists")
        self.assertEqual(page["connection_id"], "conn-1")

    def test_haystack_joins_id_bundle_name_for_alias_matching(self):
        app = {"id": "PID:1", "bundle": "com.apple.SafariViewService", "name": "SafariViewService"}
        haystack = wir._haystack(app).lower()
        self.assertIn("safariviewservice", haystack)


class DispatchTests(unittest.TestCase):
    """WebInspectorClient.dispatch() routing, exercised with hand-built plist
    dicts and no real transport (Transport.__init__ opens a real socket, so
    these tests construct a bare instance via __new__ and set up only the
    state dispatch touches)."""

    def _client(self) -> "wir.WebInspectorClient":
        client = wir.WebInspectorClient.__new__(wir.WebInspectorClient)
        client.apps = {}
        client.pages = {}
        client._target_ids = {}
        client._dispatch = {}
        return client

    def test_reports_connected_application_list_populates_apps(self):
        client = self._client()
        client.dispatch({
            "__selector": "_rpc_reportConnectedApplicationList:",
            "__argument": {"WIRApplicationDictionaryKey": {
                "PID:1": {"WIRApplicationIdentifierKey": "PID:1", "WIRApplicationNameKey": "Safari",
                          "WIRApplicationBundleIdentifierKey": "com.apple.mobilesafari",
                          "WIRIsApplicationActiveKey": True, "WIRIsApplicationProxyKey": False,
                          "WIRIsApplicationReadyKey": True},
            }},
        })
        self.assertIn("PID:1", client.apps)
        self.assertEqual(client.apps["PID:1"]["name"], "Safari")

    def test_application_sent_listing_populates_pages_keyed_by_int(self):
        client = self._client()
        client.dispatch({
            "__selector": "_rpc_applicationSentListing:",
            "__argument": {"WIRApplicationIdentifierKey": "PID:1", "WIRListingKey": {
                "1": {"WIRPageIdentifierKey": 1, "WIRTypeKey": "WIRTypeWebPage", "WIRURLKey": "http://x/", "WIRTitleKey": "X"},
            }},
        })
        self.assertIn(1, client.pages["PID:1"])  # int key, not the plist's string key
        self.assertEqual(client.pages["PID:1"][1]["url"], "http://x/")

    def test_application_disconnected_removes_app_and_pages(self):
        client = self._client()
        client.apps["PID:1"] = {"id": "PID:1"}
        client.pages["PID:1"] = {1: {"id": 1}}
        client.dispatch({"__selector": "_rpc_applicationDisconnected:", "__argument": {"WIRApplicationIdentifierKey": "PID:1"}})
        self.assertNotIn("PID:1", client.apps)
        self.assertNotIn("PID:1", client.pages)

    def test_target_created_records_target_id_for_its_session(self):
        client = self._client()
        client.dispatch({
            "__selector": "_rpc_applicationSentData:",
            "__argument": {
                "WIRDestinationKey": "session-abc",
                "WIRMessageDataKey": b'{"method":"Target.targetCreated","params":{"targetInfo":{"targetId":"target-1"}}}',
            },
        })
        self.assertEqual(client._target_ids["session-abc"], "target-1")

    def test_dispatch_message_from_target_stores_inner_response_by_id(self):
        client = self._client()
        inner = json.dumps({"id": 7, "result": {"result": {"type": "number", "value": 42}}})
        outer = json.dumps({"method": "Target.dispatchMessageFromTarget", "params": {"targetId": "target-1", "message": inner}})
        client.dispatch({
            "__selector": "_rpc_applicationSentData:",
            "__argument": {"WIRDestinationKey": "session-abc", "WIRMessageDataKey": outer.encode()},
        })
        self.assertEqual(client._dispatch[7]["result"]["result"]["value"], 42)

    def test_console_message_added_is_ignored_not_an_error(self):
        # Console.* and Heap.* traffic has no "id" and isn't Target.*; dispatch must not raise
        # or misfile it -- it is display noise this CLI has no use for.
        client = self._client()
        client.dispatch({
            "__selector": "_rpc_applicationSentData:",
            "__argument": {
                "WIRDestinationKey": "session-abc",
                "WIRMessageDataKey": b'{"method":"Console.messageAdded","params":{"message":{"level":"log","text":"hi"}}}',
            },
        })
        self.assertEqual(client._dispatch, {})
        self.assertEqual(client._target_ids, {})

    def test_unknown_selector_is_ignored(self):
        client = self._client()
        client.dispatch({"__selector": "_rpc_reportCurrentState:", "__argument": {"WIRAutomationAvailabilityKey": "WIRAutomationAvailabilityAvailable"}})
        self.assertEqual(client.apps, {})  # no crash, no spurious state


if __name__ == "__main__":
    unittest.main()
