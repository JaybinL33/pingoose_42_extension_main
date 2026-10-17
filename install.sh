#!/usr/bin/env bash
# Run from the user's GNOME desktop terminal, without sudo.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
package_dir="$project_dir/src"

dev_sources=()
if [[ $# -eq 1 && "$1" == '--dev' ]]; then
    dev_sources=(--extra-source=dev)
elif [[ $# -gt 0 ]]; then
    printf '사용법: %s [--dev] (sudo 없이 GNOME 터미널에서 실행)\n세션은 자동 재시작하지 않습니다.\n' "$0"
    [[ $# -eq 1 && ( "$1" == '--help' || "$1" == '-h' ) ]] && exit 0
    exit 1
fi
if [[ $EUID -eq 0 || -n "${SUDO_USER:-}" ]]; then
    printf '%s\n' '오류: sudo 없이 데스크톱 사용자로 실행하세요.' >&2
    exit 1
fi
for dependency in gnome-extensions gnome-shell glib-compile-schemas; do
    command -v "$dependency" >/dev/null || { printf '필요한 명령: %s\n' "$dependency" >&2; exit 1; }
done
/usr/bin/gjs -c "imports.gi.versions.Gtk='3.0'; imports.gi.versions.WebKit2='4.0'; imports.gi.versions.Soup='2.4'; const {Gtk, WebKit2, Soup}=imports.gi;"

# Validate the running session before replacing any installed files.
/usr/bin/python3 - "$package_dir" <<'PY'
import json, os, sys
from gi.repository import Gio, GLib
try:
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    version = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell',
        'org.freedesktop.DBus.Properties', 'Get',
        GLib.Variant('(ss)', ('org.gnome.Shell.Extensions', 'ShellVersion')),
        None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    with open(os.path.join(sys.argv[1], 'metadata.json')) as source:
        supported = json.load(source)['shell-version']
    if str(version).split('.')[0] not in supported:
        raise RuntimeError(f'GNOME {version}은 지원하지 않습니다. 지원 버전: {supported}')
    if os.environ.get('XDG_SESSION_TYPE') not in ('x11', 'wayland'):
        raise RuntimeError('GNOME 데스크톱 터미널에서 실행하세요 (XDG_SESSION_TYPE 확인).')
except Exception as error:
    sys.exit(f'설치 전 확인 실패: {error}')
PY

# Match the running Shell's extension directory, not the invoking terminal's
# XDG_DATA_HOME (Codex and the desktop can have different environments).
active_data_home=$(/usr/bin/python3 - <<'PYDATA'
from pathlib import Path
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
info = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell',
    'org.gnome.Shell.Extensions', 'GetExtensionInfo',
    GLib.Variant('(s)', ('pingoose@local',)), None,
    Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
path = info.get('path', '')
if path:
    target = Path(path)
    if target.parent.name != 'extensions' or target.parent.parent.name != 'gnome-shell':
        raise SystemExit('설치 중단: 예상하지 못한 확장 경로')
    if str(target).startswith(('/usr/', '/opt/')):
        raise SystemExit('설치 중단: 시스템 확장을 사용자 설치로 덮어쓸 수 없습니다')
    print(target.parent.parent.parent)
PYDATA
)
if [[ -n "$active_data_home" ]]; then
    export XDG_DATA_HOME="$active_data_home"
    printf '실행 중인 GNOME 설치 경로 사용: %s/gnome-shell/extensions/pingoose@local\n' "$XDG_DATA_HOME"
fi

build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
(
    cd -- "$package_dir"
    gnome-extensions pack --force --out-dir="$build" --extra-source=ui --extra-source=services --extra-source=worker --extra-source=models --extra-source=assets "${dev_sources[@]}" .
)
# Install the locally built package directly; the GNOME CLI can fail copying
# across the desktop's home/USB filesystem boundary after removing the old copy.
/usr/bin/python3 - "$build/pingoose@local.shell-extension.zip" <<'PYINSTALL'
import os, zipfile
from pathlib import Path
root = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')
target = root / 'gnome-shell/extensions/pingoose@local'
target.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(__import__('sys').argv[1]) as archive:
    # Remove only known legacy modules and development UI from older installs.
    for name in ['webview.js','evaluations.js','slotsService.js','systemSessionHook.js','chat.js','chatPanel.js','token_refresher.py','42intra.png','pingoose.svg','devOptions.js']:
        (target / name).unlink(missing_ok=True)
    if 'dev/devOptions.js' not in archive.namelist():
        (target / 'dev/devOptions.js').unlink(missing_ok=True)
    for entry in archive.infolist():
        relative = Path(entry.filename)
        if relative.is_absolute() or '..' in relative.parts:
            raise SystemExit('Invalid package path')
        destination = target / relative
        if entry.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(entry))
            destination.chmod(0o644)
print(f'패키지 설치 완료: {target}')
PYINSTALL

printf '%s\n' '설치 완료. 새 코드는 세션을 직접 리로드하거나 재로그인하면 적용됩니다.'
