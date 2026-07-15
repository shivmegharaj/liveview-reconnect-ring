#!/usr/bin/env bash
# Launch a dedicated Chrome for LiveView Reconnect Ring with silent debugger API.
# Uses its own user-data-dir so an already-running Chrome does not swallow the flag.
set -euo pipefail

RING_URL="https://account.ring.com/"
OS="$(uname -s)"

if [[ -n "${LVR_CHROME_DATA_DIR:-}" ]]; then
  DATA_DIR="$LVR_CHROME_DATA_DIR"
elif [[ "$OS" == "Darwin" ]]; then
  DATA_DIR="$HOME/Library/Application Support/Google/Chrome-LiveViewReconnectRing"
else
  DATA_DIR="$HOME/.config/chrome-liveview-reconnect-ring"
fi

CHROME="${CHROME_PATH:-}"

if [[ -z "$CHROME" ]]; then
  candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  )
  for path in "${candidates[@]}"; do
    if [[ -x "$path" ]]; then
      CHROME="$path"
      break
    fi
  done
fi

if [[ -z "$CHROME" ]]; then
  for name in google-chrome google-chrome-stable chromium-browser chromium; do
    if command -v "$name" >/dev/null 2>&1; then
      CHROME="$(command -v "$name")"
      break
    fi
  done
fi

if [[ -z "$CHROME" || ! -x "$CHROME" ]]; then
  echo "Google Chrome not found. Install Chrome, or set CHROME_PATH to the binary." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

echo "OS:        $OS"
echo "Chrome:    $CHROME"
echo "Data dir:  $DATA_DIR"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Dry run. Would launch:"
  echo "  $CHROME --user-data-dir=$DATA_DIR --silent-debugger-extension-api --no-first-run --no-default-browser-check $RING_URL"
  exit 0
fi

echo "Opening Ring Multi-Cam. Load unpacked extension/ in this window if needed."

exec "$CHROME" \
  --user-data-dir="$DATA_DIR" \
  --silent-debugger-extension-api \
  --no-first-run \
  --no-default-browser-check \
  "$RING_URL"
