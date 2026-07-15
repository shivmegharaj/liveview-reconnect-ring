#!/usr/bin/env python3
"""Open a dedicated Chrome for LiveView Reconnect Ring with silent debugger API.

Uses a separate user-data-dir so an already-running Chrome does not swallow the flag.
Works on macOS, Windows, and Linux.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

RING_URL = "https://account.ring.com/"


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def chrome_candidates() -> list[Path]:
    env = os.environ.get("CHROME_PATH")
    if env:
        return [Path(env)]

    system = platform.system()
    home = Path.home()
    paths: list[Path] = []

    if system == "Darwin":
        paths.extend(
            [
                Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
                home / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ]
        )
    elif system == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        for base in (pf, pf86, local):
            if not base:
                continue
            paths.append(Path(base) / "Google/Chrome/Application/chrome.exe")
    else:
        for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
            found = shutil.which(name)
            if found:
                paths.append(Path(found))

    return paths


def find_chrome() -> Path:
    for path in chrome_candidates():
        if path.is_file():
            return path
    die(
        "Google Chrome not found. Install Chrome, or set CHROME_PATH to the Chrome binary."
    )


def data_dir() -> Path:
    override = os.environ.get("LVR_CHROME_DATA_DIR") or os.environ.get(
        "RINGVIEW_CHROME_DATA_DIR"
    )
    if override:
        return Path(override)

    system = platform.system()
    if system == "Darwin":
        return (
            Path.home()
            / "Library/Application Support/Google/Chrome-LiveViewReconnectRing"
        )
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            die("LOCALAPPDATA is not set; cannot choose a Chrome profile folder.")
        return Path(local) / "Google" / "Chrome-LiveViewReconnectRing"
    return Path.home() / ".config" / "chrome-liveview-reconnect-ring"


def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    dry_run = "--dry-run" in argv

    chrome = find_chrome()
    profile = data_dir()
    profile.mkdir(parents=True, exist_ok=True)

    args = [
        str(chrome),
        f"--user-data-dir={profile}",
        "--silent-debugger-extension-api",
        "--no-first-run",
        "--no-default-browser-check",
        RING_URL,
    ]

    print(f"OS:        {platform.system()} ({platform.machine()})")
    print(f"Chrome:    {chrome}")
    print(f"Data dir:  {profile}")
    if dry_run:
        print("Dry run. Would launch:")
        print(" ", " ".join(args))
        return

    print("Opening Ring Multi-Cam. Load unpacked extension/ in this window if needed.")

    kwargs: dict = dict(args=args, close_fds=True)
    if platform.system() == "Windows":
        kwargs["creationflags"] = 0x00000200 | 0x00000008
        kwargs["stdin"] = subprocess.DEVNULL
        kwargs["stdout"] = subprocess.DEVNULL
        kwargs["stderr"] = subprocess.DEVNULL
    else:
        kwargs["start_new_session"] = True

    subprocess.Popen(**kwargs)


if __name__ == "__main__":
    main()
