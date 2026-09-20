#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

SLIPGATE_VERSION = "0.5.3"
SLIPGATE_COMMIT = "e316640c35aabfbe83bc28f9ae1be9e8dbfbb7d0"
FLARESOLVERR_VERSION = "3.5.0"
FLARESOLVERR_COMMIT = "4ca91a24f87a73f963e1d6610cbf3b9f01c1cc1b"
# Packaging revision: bump when the bundle layout changes without an upstream
# version move, so already-installed runtimes see an update. r1 strips the
# PyInstaller-bundled libreadline/libtinfo that broke FlareSolverr on Arch; r2
# makes FlareSolverr's Xvfb display optional so the runtime starts on hosts
# without the xvfb package.
RUNTIME_REV = "r2"
FLARESOLVERR = {
    "linux-x86_64": {
        "name": "flaresolverr_linux_x64.tar.gz",
        "executable": "flaresolverr",
    },
    "windows-x86_64": {
        "name": "flaresolverr_windows_x64.zip",
        "executable": "flaresolverr.exe",
    },
}


def run(*args: str, cwd: Path | None = None) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract(archive: Path, destination: Path) -> None:
    if archive.name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:gz") as source:
            source.extractall(destination, filter="data")
    else:
        with zipfile.ZipFile(archive) as source:
            source.extractall(destination)


def find_executable(root: Path, name: str) -> Path:
    matches = [path for path in root.rglob(name) if path.is_file()]
    if len(matches) != 1:
        raise RuntimeError(f"expected one {name} in FlareSolverr archive, found {len(matches)}")
    return matches[0]


# FlareSolverr's Linux path starts Xvfb whenever HEADLESS is true, yet it
# launches Chrome with `--headless=new` at the same time (undetected_chromedriver
# adds that flag for every Chrome 108+ build), so nothing ever renders into that
# display. On a host without the xvfb package - the default on Arch and most
# minimal installs - Xvfb() raises and FlareSolverr exits while testing the
# browser, which leaves the whole built-in resolver unhealthy. Make the virtual
# display best-effort: take it when it exists, carry on headless when it does
# not.
XVFB_CALL = """def start_xvfb_display():
    global XVFB_DISPLAY
    if XVFB_DISPLAY is None:
        from xvfbwrapper import Xvfb
        XVFB_DISPLAY = Xvfb()
        XVFB_DISPLAY.start()
"""
XVFB_CALL_PATCHED = """def start_xvfb_display():
    global XVFB_DISPLAY
    if XVFB_DISPLAY is None:
        try:
            from xvfbwrapper import Xvfb
            XVFB_DISPLAY = Xvfb()
            XVFB_DISPLAY.start()
        except Exception as exc:
            logging.warning("no Xvfb display available, running headless: %s", exc)
            XVFB_DISPLAY = False
"""


def patch_flaresolverr(source: Path) -> None:
    """Pin the one upstream behaviour the bundled runtime cannot rely on: Xvfb."""
    utils = source / "src" / "utils.py"
    text = utils.read_text(encoding="utf-8")
    if XVFB_CALL not in text:
        raise RuntimeError("FlareSolverr Xvfb patch no longer applies to src/utils.py")
    utils.write_text(text.replace(XVFB_CALL, XVFB_CALL_PATCHED, 1), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=sorted(FLARESOLVERR))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    spec = FLARESOLVERR[args.platform]
    runtime_version = f"{SLIPGATE_VERSION}-{FLARESOLVERR_VERSION}-{RUNTIME_REV}"
    artifact_name = f"resolver-runtime-{args.platform}.zip"
    args.output.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="manifold-resolver-") as temporary:
        work = Path(temporary)
        slipgate_source = work / "Slipgate"
        run("git", "clone", "--filter=blob:none", "https://github.com/fyiel/Slipgate.git", str(slipgate_source))
        run("git", "checkout", "--detach", SLIPGATE_COMMIT, cwd=slipgate_source)
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=slipgate_source, text=True).strip()
        if head != SLIPGATE_COMMIT:
            raise RuntimeError(f"Slipgate checkout drifted: expected {SLIPGATE_COMMIT}, got {head}")
        run(sys.executable, "-m", "pip", "install", ".", cwd=slipgate_source)

        pyinstaller_work = work / "pyinstaller"
        launcher = work / "slipgate_launcher.py"
        launcher.write_text("from slipgate.__main__ import main\nmain()\n", encoding="utf-8")
        run(
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--name",
            "slipgate",
            "--collect-all",
            "slipgate",
            "--collect-all",
            "uvicorn",
            "--collect-all",
            "pydantic_settings",
            "--distpath",
            str(pyinstaller_work / "dist"),
            "--workpath",
            str(pyinstaller_work / "work"),
            "--specpath",
            str(pyinstaller_work),
            str(launcher),
        )

        flaresolverr_source = work / "FlareSolverr"
        run(
            "git",
            "clone",
            "--filter=blob:none",
            "https://github.com/FlareSolverr/FlareSolverr.git",
            str(flaresolverr_source),
        )
        run("git", "checkout", "--detach", FLARESOLVERR_COMMIT, cwd=flaresolverr_source)
        head = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=flaresolverr_source, text=True
        ).strip()
        if head != FLARESOLVERR_COMMIT:
            raise RuntimeError(
                f"FlareSolverr checkout drifted: expected {FLARESOLVERR_COMMIT}, got {head}"
            )
        patch_flaresolverr(flaresolverr_source)
        run(
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            str(flaresolverr_source / "requirements.txt"),
        )
        run(sys.executable, "build_package.py", cwd=flaresolverr_source / "src")
        upstream = flaresolverr_source / "dist" / str(spec["name"])
        if not upstream.is_file():
            raise RuntimeError(f"FlareSolverr build did not produce {upstream.name}")
        extracted = work / "flaresolverr-extracted"
        extracted.mkdir()
        extract(upstream, extracted)
        upstream_executable = find_executable(extracted, str(spec["executable"]))

        package = work / "package"
        shutil.copytree(pyinstaller_work / "dist" / "slipgate", package / "slipgate")
        shutil.copytree(upstream_executable.parent, package / "flaresolverr")
        if args.platform == "linux-x86_64":
            for executable in [package / "slipgate" / "slipgate", package / "flaresolverr" / "flaresolverr"]:
                executable.chmod(executable.stat().st_mode | stat.S_IXUSR)
            # PyInstaller bundles libreadline/libtinfo, and exports them via
            # LD_LIBRARY_PATH to every child process. On hosts where /bin/sh
            # links readline (Arch and friends), the bundled older readline
            # crashes the shell with a symbol error, which kills the bundled
            # Chrome's version probe and FlareSolverr never starts. Same
            # soname as the system lib, so dropping it is safe.
            for bundled in package.rglob("libreadline.so.8"):
                bundled.unlink()
            for bundled in package.rglob("libtinfo.so.6"):
                bundled.unlink()

        archive = args.output / artifact_name
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
            for path in sorted(package.rglob("*")):
                if path.is_file():
                    output.write(path, path.relative_to(package))

    metadata = {
        "platform": args.platform,
        "artifact": artifact_name,
        "sha256": sha256(archive),
        "size": archive.stat().st_size,
        "version": runtime_version,
        "slipgateVersion": SLIPGATE_VERSION,
        "flaresolverrVersion": FLARESOLVERR_VERSION,
    }
    (args.output / f"resolver-runtime-{args.platform}.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
