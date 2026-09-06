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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=sorted(FLARESOLVERR))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    spec = FLARESOLVERR[args.platform]
    runtime_version = f"{SLIPGATE_VERSION}-{FLARESOLVERR_VERSION}"
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
