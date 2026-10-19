#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
out=${1:-"$root/dist"}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$root"
# Package runtime sources only.
gnome-extensions pack --force --out-dir="$out" --extra-source=ui --extra-source=services --extra-source=worker --extra-source=models --extra-source=preferences --extra-source=assets --extra-source=dev .
printf 'Release package: %s/pingoose@local.shell-extension.zip\n' "$out"
