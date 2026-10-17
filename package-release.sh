#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
out=${1:-"$root/dist"}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$root/pingoose-v3-staging.1KaoVt"
# Explicit allowlist: devOptions.js is deliberately absent.
gnome-extensions pack --force --out-dir="$out" --extra-source=webview.js --extra-source=evaluations.js --extra-source=token_refresher.py .
printf 'Release package: %s/pingoose@local.shell-extension.zip\n' "$out"
