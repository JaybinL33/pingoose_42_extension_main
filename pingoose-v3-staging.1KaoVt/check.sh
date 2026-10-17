#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
# Offline tests use fake responses, ephemeral WebKit and temporary storage, never real credentials.
bash -n install.sh check.sh
/usr/bin/python3 -B test-api.py
/usr/bin/python3 -B test-campus-evaluations.py
/usr/bin/python3 -B test-intra-evaluations.py
/usr/bin/python3 -B test-api-get.py
if command -v node >/dev/null; then
    node --check extension.js
    node --check webview.js
    node --check evaluations.js
    node test-evaluations.js
    node test-flash.js
else
    printf '%s\n' 'SKIP: Node.js가 없어 화면 효과 로직 검사는 생략합니다.'
fi
if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    timeout --signal=TERM --kill-after=3s 20s /usr/bin/gjs webview.js --self-test
else
    printf '%s\n' 'SKIP: 그래픽 세션이 없어 임시 WebKit 네이티브 검사는 생략합니다.'
fi
# Exercise native validation and persistence in a temporary backend, not the desktop's settings.
schemas=$(mktemp -d)
trap 'rm -rf -- "$schemas"' EXIT
cp schemas/org.gnome.shell.extensions.pingoose.gschema.xml "$schemas/"
glib-compile-schemas --strict "$schemas"
(
    export GSETTINGS_SCHEMA_DIR="$schemas" GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$schemas/config"
    schema=org.gnome.shell.extensions.pingoose
    test "$(gsettings get "$schema" flash-count)" = 1
    for count in 0 1 2 3 4 5; do
        gsettings set "$schema" flash-count "$count"
        test "$(gsettings get "$schema" flash-count)" = "$count"
    done
    for invalid in -1 6; do
        if gsettings set "$schema" flash-count "$invalid" >/dev/null 2>&1; then
            printf '%s\n' 'FAIL: out-of-range flash count accepted' >&2
            exit 1
        fi
    done
    test "$(gsettings get "$schema" flash-count)" = 5
    gsettings reset "$schema" flash-count
    test "$(gsettings get "$schema" flash-count)" = 1
    printf '%s\n' 'PASS: native settings defaults, 0–5 range and cross-process persistence'
)
# Inspect the actual distributable, not just a list of intended sources.
gnome-extensions pack --force --out-dir="$schemas" --extra-source=webview.js --extra-source=evaluations.js .
/usr/bin/python3 -B - "$schemas/pingoose@local.shell-extension.zip" <<'PY'
import sys
import zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    files = {name for name in archive.namelist() if not name.endswith('/')}
    allowed = {'extension.js', 'webview.js', 'evaluations.js', 'metadata.json', 'stylesheet.css',
               'schemas/org.gnome.shell.extensions.pingoose.gschema.xml', 'schemas/gschemas.compiled'}
    assert files <= allowed, 'Unexpected file in extension package'
    assert {'extension.js', 'webview.js', 'evaluations.js', 'schemas/gschemas.compiled'} <= files, 'Missing runtime file'
    print('PASS: package contains v3 WebKit/API runtime and schema, no credentials, profiles, legacy API client or tests')
PY
