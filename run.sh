#!/usr/bin/env bash
# One-command launcher: builds the React dashboard (app/) if needed, starts
# the FastAPI backend (creating the venv on first run), and opens the
# dashboard, which the backend serves at http://localhost:8000/app/.
#
# Works on macOS, Linux, WSL, and Git Bash on Windows. Plain Windows
# (no bash) should use run.bat instead, which drives run.ps1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
BACKEND_DIR="$ROOT/project/backend"
APP_DIR="$ROOT/app"
APP_URL="http://localhost:8000/app/"

fail() {
  echo ""
  echo "$1"
  exit 1
}

# ---------------------------------------------------------------------------
# Preflight: find a usable Python 3.9+ before doing anything else.
# ---------------------------------------------------------------------------
PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PYTHON_BIN="$candidate"
    break
  fi
done
if [ -z "$PYTHON_BIN" ]; then
  fail "GrantFlow needs Python 3.9 or newer, and it wasn't found on your PATH.
Install it from https://www.python.org/downloads/ (on Windows, check \"Add python.exe to PATH\" during setup), then run this script again."
fi

if ! command -v curl >/dev/null 2>&1; then
  fail "GrantFlow needs curl, and it wasn't found on your PATH.
It ships with macOS, most Linux distributions, and Git for Windows. Install it, then run this script again."
fi

# ---------------------------------------------------------------------------
# Load local identity and Microsoft Graph configuration when present.
# ---------------------------------------------------------------------------
if [ -f "$BACKEND_DIR/.sharepoint.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$BACKEND_DIR/.sharepoint.env"
  set +a
fi

if [ ! -d "$VENV" ]; then
  echo "Setting up Python virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV" || fail "Could not create a Python virtual environment.
On Debian/Ubuntu this usually means the venv module is missing — install it with: sudo apt install python3-venv
Then run this script again."
fi

if [ ! -x "$VENV/bin/python" ] || [ ! -x "$VENV/bin/pip" ]; then
  fail "The existing .venv is incomplete. Delete the .venv folder and run ./run.sh again."
fi

REQUIREMENTS_FILE="$BACKEND_DIR/requirements.txt"
REQUIREMENTS_STAMP="$VENV/.grantflow-requirements.sha256"
REQUIREMENTS_HASH="$("$PYTHON_BIN" -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$REQUIREMENTS_FILE")"
INSTALLED_HASH=""
if [ -f "$REQUIREMENTS_STAMP" ]; then
  INSTALLED_HASH="$(tr -d '[:space:]' < "$REQUIREMENTS_STAMP")"
fi
if [ "$INSTALLED_HASH" != "$REQUIREMENTS_HASH" ]; then
  echo "Installing backend dependencies..."
  "$VENV/bin/pip" install -q -r "$REQUIREMENTS_FILE" || fail "Installing backend dependencies failed. See the error above."
  printf '%s\n' "$REQUIREMENTS_HASH" > "$REQUIREMENTS_STAMP"
fi

# ---------------------------------------------------------------------------
# Build the dashboard when its build output is missing or older than its
# source (or the design system's). Needs node only when a rebuild is due.
# ---------------------------------------------------------------------------
NEEDS_BUILD=0
if [ ! -f "$APP_DIR/dist/index.html" ] ||
   [ -n "$(find "$APP_DIR/src" "$APP_DIR/index.html" "$ROOT/design-system/src" -newer "$APP_DIR/dist/index.html" -print -quit 2>/dev/null)" ]; then
  NEEDS_BUILD=1
fi

if [ "$NEEDS_BUILD" = "1" ]; then
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    fail "GrantFlow needs Node.js 18 or newer to build the dashboard, and it wasn't found on your PATH.
Install the LTS version from https://nodejs.org, then run this script again."
  fi
  echo "Building the dashboard (app/)..."
  (
    cd "$APP_DIR" &&
    { [ -d node_modules ] || npm install --no-audit --no-fund; } &&
    npm run build
  ) || fail "Building the dashboard failed. See the error above.
If it mentions a broken install, delete app/node_modules and run this script again."
fi

# ---------------------------------------------------------------------------
# Cross-platform "open a URL in the default browser".
# ---------------------------------------------------------------------------
open_url() {
  local url="$1"
  case "$(uname -s)" in
    Darwin)
      open "$url" ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
      elif command -v wslview >/dev/null 2>&1; then
        wslview "$url" >/dev/null 2>&1 &
      else
        echo "Open $url in your browser."
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      cmd.exe /c start "" "$url" >/dev/null 2>&1 || echo "Open $url in your browser." ;;
    *)
      echo "Open $url in your browser." ;;
  esac
}

# ---------------------------------------------------------------------------
# Start (or reuse) the backend.
# ---------------------------------------------------------------------------
BACKEND_STARTED_HERE=0
if curl -sf http://localhost:8000/ > /dev/null 2>&1; then
  if ! curl -sf http://localhost:8000/auth/config 2>/dev/null | grep -q '"mode"'; then
    fail "A backend is running on http://localhost:8000 but does not include identity access.
Stop that process, then run ./run.sh again."
  elif ! curl -sf "$APP_URL" > /dev/null 2>&1; then
    # The running backend predates the dashboard build, so /app/ isn't mounted.
    fail "A backend is running on http://localhost:8000 but isn't serving the dashboard.
Stop that process, then run ./run.sh again."
  else
    echo "Backend already running on http://localhost:8000 — reusing it."
  fi
else
  echo "Starting backend on http://localhost:8000..."
  (cd "$BACKEND_DIR" && exec "$VENV/bin/python" main.py) &
  BACKEND_PID=$!
  BACKEND_STARTED_HERE=1

  STARTED=0
  for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/ > /dev/null 2>&1; then
      STARTED=1
      break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  if [ "$STARTED" != "1" ]; then
    fail "The backend didn't start within 15 seconds. Run this to see why:
  $VENV/bin/python $BACKEND_DIR/main.py"
  fi
fi

cleanup() {
  if [ "$BACKEND_STARTED_HERE" = "1" ]; then
    echo ""
    echo "Stopping backend (pid $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Opening the dashboard..."
open_url "$APP_URL"

echo ""
echo "GrantFlow is running at $APP_URL. Press Ctrl+C to stop the backend."

if [ "$BACKEND_STARTED_HERE" = "1" ]; then
  wait "$BACKEND_PID"
else
  # Backend belongs to another process — just keep the script alive so the
  # trap doesn't fire immediately; Ctrl+C simply exits without killing it.
  while true; do sleep 3600; done
fi
