#!/usr/bin/env python3

import argparse
import http.server
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time


FILE_SIZE = 16 * 1024 * 1024
SERVER_CHUNK_SIZE = 16 * 1024


class FixtureState:
    def __init__(self):
        self.content_started = threading.Event()
        self.ticket_released = threading.Event()


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    state = None

    def log_message(self, _format, *args):
        del args

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/ticket":
            now = int(time.time() * 1000)
            self.send_json(
                200,
                {
                    "token": "cancel-integration-fixture",
                    "expires_at": now + 60_000,
                    "entries": [
                        {
                            "index": 0,
                            "name": "slow.bin",
                            "relative_path": "slow.bin",
                            "type": "file",
                            "size": FILE_SIZE,
                            "modified_at": now,
                            "mode": 0o100644,
                            "top_level": True,
                        }
                    ],
                },
            )
            return

        if self.path != "/ticket/content/0":
            self.send_json(404, {"error": "not found"})
            return

        byte_range = self.headers.get("Range", "")
        if not byte_range.startswith("bytes="):
            self.send_json(416, {"error": "range required"})
            return
        start_text, end_text = byte_range[6:].split("-", 1)
        start = int(start_text)
        end = min(FILE_SIZE - 1, int(end_text) if end_text else FILE_SIZE - 1)
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{FILE_SIZE}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        self.state.content_started.set()

        # Keep the first FUSE read active long enough for the control thread to
        # receive cancel while a file handle is open.
        time.sleep(0.5)
        try:
            sent = 0
            while sent < length:
                count = min(SERVER_CHUNK_SIZE, length - sent)
                self.wfile.write(b"x" * count)
                self.wfile.flush()
                sent += count
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_DELETE(self):
        self.state.ticket_released.set()
        self.send_json(200, {"ok": True})


def wait_for_event(events, event_name, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for event in events:
            if event.get("event") == event_name:
                return event
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for helper event: {event_name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--helper", required=True)
    arguments = parser.parse_args()

    probe = subprocess.run(
        [arguments.helper, "--probe"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if probe.returncode != 0:
        print("SKIP: Linux FUSE runtime is unavailable")
        return 77

    state = FixtureState()
    FixtureHandler.state = state
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    root = tempfile.mkdtemp(prefix="terma-linux-cancel-")
    helper = None
    copy = None
    reader = None
    try:
        mount_parent = os.path.join(root, "mounts")
        os.mkdir(mount_parent)
        destination = os.path.join(root, "copied.bin")
        ticket_url = f"http://127.0.0.1:{server.server_port}/ticket"
        helper = subprocess.Popen(
            [
                arguments.helper,
                "--ticket-url",
                ticket_url,
                "--mount-parent",
                mount_parent,
                "--lease-seconds",
                "60",
                "--close-grace-seconds",
                "5",
                "--keep-alive-seconds",
                "10",
                "--chunk-bytes",
                "65536",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        events = []

        def collect_events():
            for line in helper.stdout:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    events.append({"event": "invalid-json", "line": line.rstrip()})

        reader = threading.Thread(target=collect_events, daemon=True)
        reader.start()
        ready = wait_for_event(events, "ready", 10)
        source = ready["paths"][0]

        copy = subprocess.Popen(
            ["cp", source, destination],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "LC_ALL": "C"},
        )
        if not state.content_started.wait(10):
            raise AssertionError("the target never began reading FUSE content")

        helper.stdin.write('{"command":"cancel"}\n')
        helper.stdin.flush()
        _, copy_error = copy.communicate(timeout=10)
        helper.wait(timeout=10)
        reader.join(timeout=2)

        event_names = [event.get("event") for event in events]
        if copy.returncode == 0:
            raise AssertionError("a cancelled target copy unexpectedly succeeded")
        if "Operation canceled" not in copy_error:
            raise AssertionError(f"target did not receive ECANCELED: {copy_error.strip()}")
        if "Transport endpoint is not connected" in copy_error:
            raise AssertionError(f"FUSE was unmounted before the open handle closed: {copy_error.strip()}")
        if "Input/output error" in copy_error:
            raise AssertionError(f"user cancellation was reported as a read fault: {copy_error.strip()}")
        if "read-error" in event_names:
            raise AssertionError("user cancellation emitted a read-error event")
        for expected in ("cancelled", "closing", "closed"):
            if expected not in event_names:
                raise AssertionError(f"helper did not emit {expected}: {event_names}")
        if not (
            event_names.index("cancelled")
            < event_names.index("closing")
            < event_names.index("closed")
        ):
            raise AssertionError(f"cancel lifecycle was out of order: {event_names}")
        if helper.returncode != 0:
            raise AssertionError(f"helper returned {helper.returncode}: {helper.stderr.read().strip()}")
        if os.path.exists(ready["mount_point"]):
            raise AssertionError("the cancelled FUSE mount point was not removed")
        if not state.ticket_released.wait(2):
            raise AssertionError("the cancelled helper did not release its drag ticket")

        print("Linux SFTP drag cancellation integration check passed.")
        return 0
    finally:
        server.shutdown()
        server.server_close()
        if copy is not None and copy.poll() is None:
            copy.kill()
            copy.wait()
        if helper is not None and helper.poll() is None:
            helper.kill()
            helper.wait()
        if reader is not None:
            reader.join(timeout=1)
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
