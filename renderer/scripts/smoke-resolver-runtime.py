#!/usr/bin/env python3
"""Start a freshly built resolver runtime and prove it becomes healthy.

The app only ever uses the bundled runtime through two contracts: FlareSolverr
answering `sessions.list`, and Slipgate's `/health` reporting
`flaresolverr_ok: true` (that pair is `slipgate::fetch_usable` in the app; a
runtime that fails either never gets selected, which is how a bundle that
packed and shipped perfectly still never worked). Building the artifact proves
neither, so this runs the real executables with the environment the app spawns
them with and asserts those two answers.

On Linux the child also gets a broken `Xvfb` first on PATH. FlareSolverr starts
Xvfb whenever HEADLESS is true even though it launches Chrome with
`--headless=new` at the same time, so a runtime that requires the display is
broken on any host without the xvfb package, and CI runners do ship xvfb. The
stub makes that path fail the way a missing package does.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

EXECUTABLES = {
    "linux": ("slipgate/slipgate", "flaresolverr/flaresolverr"),
    "win32": ("slipgate/slipgate.exe", "flaresolverr/flaresolverr.exe"),
}
FLARESOLVERR_TIMEOUT = 300.0
SLIPGATE_TIMEOUT = 120.0
POLL_INTERVAL = 0.5
BROKEN_XVFB = "#!/bin/sh\nexit 1\n"
# The runtimes only ever listen on loopback, so no probe may be routed through a
# proxy the environment happens to configure.
LOOPBACK = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def post_json(url: str, payload: dict, timeout: float = 30.0) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with LOOPBACK.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def get_json(url: str, key: str, timeout: float = 30.0) -> dict:
    request = urllib.request.Request(url, headers={"X-Slipgate-Key": key})
    with LOOPBACK.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def wait_for(description: str, timeout: float, attempt, process: subprocess.Popen | None = None):
    """Poll `attempt` until it returns a value; None means 'not yet'.

    A service that exited will never answer, so its log is more useful than the
    remaining timeout budget.
    """
    deadline = time.monotonic() + timeout
    last_error = "no attempt was made"
    while time.monotonic() < deadline:
        if process is not None and (code := process.poll()) is not None:
            raise RuntimeError(f"{description}: the service exited with status {code}")
        try:
            result = attempt()
        except Exception as error:  # noqa: BLE001 - any failure means "not yet"
            last_error = f"{type(error).__name__}: {error}"
        else:
            if result is not None:
                return result
            last_error = "not ready"
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"{description} did not happen within {timeout:.0f}s: {last_error}")


def spawn(executable: Path, env: dict[str, str], log: Path) -> subprocess.Popen:
    handle = log.open("wb")
    options: dict = {
        "cwd": str(executable.parent),
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": handle,
        "stderr": subprocess.STDOUT,
    }
    if os.name == "posix":
        options["start_new_session"] = True  # own process group, so we can kill the tree
    elif os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    return subprocess.Popen([str(executable)], **options)


def terminate(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except OSError:
            process.kill()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def sweep(root: Path) -> None:
    """Best-effort cleanup of processes the runtime detached from its parent.

    undetected_chromedriver starts Chrome in its own session, so killing the two
    services does not reach the browser on POSIX.
    """
    if os.name != "posix" or shutil.which("pkill") is None:
        return
    subprocess.run(
        ["pkill", "-f", str(root)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    time.sleep(1)


def extract(artifact: Path, root: Path) -> None:
    """Unpack the runtime, keeping the modes the archive records.

    `ZipFile.extractall` drops them, which leaves the bundled Chrome
    non-executable; the app's own 7z extraction preserves them.
    """
    with zipfile.ZipFile(artifact) as archive:
        for info in archive.infolist():
            archive.extract(info, root)
            if os.name != "posix":
                continue
            mode = (info.external_attr >> 16) & 0o7777
            if mode & 0o111 and (target := root / info.filename).exists():
                target.chmod(mode)


def broken_xvfb_dir(root: Path) -> Path:
    directory = root / "broken-xvfb"
    directory.mkdir()
    stub = directory / "Xvfb"
    stub.write_text(BROKEN_XVFB, encoding="utf-8")
    stub.chmod(0o755)
    return directory


def smoke(artifact: Path, keep_logs: bool) -> int:
    platform = "win32" if os.name == "nt" else "linux"
    slipgate_name, flaresolverr_name = EXECUTABLES[platform]
    root = Path(tempfile.mkdtemp(prefix="resolver-smoke-"))
    processes: list[subprocess.Popen] = []
    logs: list[tuple[str, Path]] = []
    failed = True
    try:
        extract(artifact, root)
        slipgate_bin = root / slipgate_name
        flaresolverr_bin = root / flaresolverr_name
        for binary in (slipgate_bin, flaresolverr_bin):
            if not binary.is_file():
                print(f"FAIL: {binary.relative_to(root)} is missing from {artifact.name}")
                return 1
            if os.name == "posix":
                binary.chmod(binary.stat().st_mode | 0o100)

        flaresolverr_port = free_port()
        slipgate_port = free_port()
        api_key = uuid.uuid4().hex * 2
        child_env = dict(os.environ)
        if os.name == "posix":
            xvfb = broken_xvfb_dir(root)
            child_env["PATH"] = os.pathsep.join(
                [str(xvfb), child_env.get("PATH", "/usr/bin:/bin")]
            )
            print(f"linux: PATH starts with {xvfb} so FlareSolverr must run without Xvfb")

        flaresolverr_log = root / "flaresolverr.log"
        logs.append(("FlareSolverr", flaresolverr_log))
        flaresolverr = spawn(
            flaresolverr_bin,
            {
                **child_env,
                "HOST": "127.0.0.1",
                "PORT": str(flaresolverr_port),
                "LOG_LEVEL": "info",
            },
            flaresolverr_log,
        )
        processes.append(flaresolverr)
        wait_for(
            "FlareSolverr accepting requests",
            FLARESOLVERR_TIMEOUT,
            lambda: (
                post_json(
                    f"http://127.0.0.1:{flaresolverr_port}/v1",
                    {"cmd": "sessions.list"},
                ).get("status")
                == "ok"
                or None
            ),
            process=flaresolverr,
        )
        print("ok: FlareSolverr is serving /v1 (bundled browser launched)")

        slipgate_log = root / "slipgate.log"
        logs.append(("Slipgate", slipgate_log))
        slipgate = spawn(
            slipgate_bin,
            {
                **child_env,
                "SLIPGATE_HOST": "127.0.0.1",
                "SLIPGATE_PORT": str(slipgate_port),
                "SLIPGATE_API_KEY": api_key,
                "SLIPGATE_FLARESOLVERR_URL": f"http://127.0.0.1:{flaresolverr_port}/v1",
                "SLIPGATE_LOG_LEVEL": "info",
            },
            slipgate_log,
        )
        processes.append(slipgate)
        health = wait_for(
            "Slipgate reporting a healthy FlareSolverr",
            SLIPGATE_TIMEOUT,
            lambda: (
                status
                if (status := get_json(f"http://127.0.0.1:{slipgate_port}/health", api_key)).get(
                    "ok"
                )
                and status.get("flaresolverr_ok")
                else None
            ),
            process=slipgate,
        )
        if not health.get("recipes"):
            print(f"FAIL: health reports no recipes: {health}")
            return 1
        print(
            "ok: /health reports ok and flaresolverr_ok"
            f" (Slipgate {health.get('version')}, recipes {len(health['recipes'])})"
        )
        print("PASS: the runtime starts and answers as the app expects")
        failed = False
        return 0
    except (TimeoutError, RuntimeError) as error:
        print(f"FAIL: {error}")
        return 1
    finally:
        for process in processes:
            terminate(process)
        sweep(root)
        if keep_logs:
            print(f"logs kept in {root}")
        else:
            if failed:
                for name, path in logs:
                    if path.is_file():
                        text = path.read_text(encoding="utf-8", errors="replace")
                        if text.strip():
                            print(f"--- {name} log ({path.name}) ---\n{text}")
            shutil.rmtree(root, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path, help="built runtime zip")
    parser.add_argument("--keep-logs", action="store_true", help="leave the temp dir in place")
    args = parser.parse_args()
    if not args.artifact.is_file():
        print(f"FAIL: no artifact at {args.artifact}")
        return 1
    return smoke(args.artifact, args.keep_logs)


if __name__ == "__main__":
    sys.exit(main())
