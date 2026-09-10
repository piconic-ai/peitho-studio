#!/usr/bin/env bash
# tagpr only bumps versionFile (src-tauri/Cargo.toml); Tauri also reads its
# own copy from src-tauri/tauri.conf.json, so this keeps that second copy
# from drifting whenever tagpr prepares a release PR.
set -euo pipefail

cd "$(dirname "$0")/.."

version=$(grep -m1 '^version = ' src-tauri/Cargo.toml | sed -E 's/version = "(.*)"/\1/')

tmp=$(mktemp)
jq --arg v "$version" '.version = $v' src-tauri/tauri.conf.json > "$tmp"
mv "$tmp" src-tauri/tauri.conf.json
