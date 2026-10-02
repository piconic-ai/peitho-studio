#!/usr/bin/env bash
# Use tagpr's proposed version even when its text replacement did not match
# the current RC version. Python is available on both release CI runners.
set -euo pipefail

cd "$(dirname "$0")/.."

exec python3 scripts/sync-tauri-version.py "$@"
