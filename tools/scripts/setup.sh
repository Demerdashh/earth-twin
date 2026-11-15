#!/usr/bin/env bash
# AnalogLens: local toolchain setup (macOS / Linux).
# Installs everything INSIDE ./tools. Safe to re-run. No sudo, no global installs.
#   --python-only        skip npm and Playwright
#   EXTRAS=real,serve    also install pipeline extras from pyproject.toml
set -euo pipefail

UV_VERSION="0.13.8"
PYTHON_VERSION="3.11"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$ROOT/tools"
BIN="$TOOLS/bin"
CACHE="$TOOLS/cache"
VENV="$TOOLS/python"
mkdir -p "$BIN" "$CACHE"

export UV_CACHE_DIR="$CACHE/uv"
export UV_PYTHON_INSTALL_DIR="$BIN/cpython"
export UV_NO_MODIFY_PATH=1
export PIP_CACHE_DIR="$CACHE/pip"
export npm_config_cache="$CACHE/npm"
export PLAYWRIGHT_BROWSERS_PATH="$BIN/ms-playwright"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) UV_TRIPLE="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64) UV_TRIPLE="aarch64-unknown-linux-gnu" ;;
  Darwin-arm64) UV_TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64) UV_TRIPLE="x86_64-apple-darwin" ;;
  *) echo "Unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac

UV="$BIN/uv"
if [ -x "$UV" ] && "$UV" --version | grep -q "$UV_VERSION"; then
  step "uv $UV_VERSION already present"
else
  step "Downloading uv $UV_VERSION into tools/bin"
  ARCHIVE="$CACHE/uv-$UV_VERSION.tar.gz"
  curl -fsSL "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$UV_TRIPLE.tar.gz" -o "$ARCHIVE"
  rm -rf "$CACHE/uv-$UV_VERSION" && mkdir -p "$CACHE/uv-$UV_VERSION"
  tar -xzf "$ARCHIVE" -C "$CACHE/uv-$UV_VERSION"
  cp "$(find "$CACHE/uv-$UV_VERSION" -type f -name uv)" "$UV"
  chmod +x "$UV"
fi

step "Ensuring CPython $PYTHON_VERSION in tools/bin/cpython"
"$UV" python install "$PYTHON_VERSION"
PY311="$("$UV" python find "$PYTHON_VERSION")"
case "$PY311" in "$BIN"*) ;; *) echo "uv resolved Python outside tools/: $PY311"; exit 1 ;; esac
[ -x "$VENV/bin/python" ] || { step "Creating venv tools/python"; "$PY311" -m venv "$VENV"; }

step "Installing pinned pipeline dependencies from uv.lock"
EXPORT_ARGS=(export --frozen --no-hashes --no-emit-project --project "$ROOT" -o "$CACHE/requirements.lock.txt")
IFS=',' read -ra EXTRA_LIST <<< "${EXTRAS:-}"
for e in "${EXTRA_LIST[@]}"; do [ -n "$e" ] && EXPORT_ARGS+=(--extra "$e"); done
"$UV" "${EXPORT_ARGS[@]}" > /dev/null
"$VENV/bin/python" -m pip install --disable-pip-version-check -q -r "$CACHE/requirements.lock.txt"
"$VENV/bin/python" -m pip install --disable-pip-version-check -q --no-deps -e "$ROOT"

if [ "${1:-}" = "--python-only" ]; then
  echo "python:     $("$VENV/bin/python" --version)"
  printf '\033[32mPython toolchain ready (--python-only: skipped npm and Playwright).\033[0m\n'
  exit 0
fi

cd "$ROOT"
step "Installing npm dependencies"
if [ -f package-lock.json ]; then npm ci --no-fund --no-audit; else npm install --no-fund --no-audit; fi
step "Installing Playwright Chromium into tools/bin/ms-playwright"
npx --no-install playwright install chromium

step "Versions"
echo "uv:         $("$UV" --version)"
echo "python:     $("$VENV/bin/python" --version)"
echo "node:       $(node --version)"
echo "npm:        $(npm --version)"
"$VENV/bin/python" -c "from importlib.metadata import version as v; print(' | '.join(f'{p} {v(p)}' for p in ('numpy','scipy','pillow')))"
echo "playwright: $(npx --no-install playwright --version)"
printf '\033[32mSetup complete.\033[0m\n'
