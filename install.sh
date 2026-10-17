#!/usr/bin/env bash
# Run from the user's GNOME desktop terminal, without sudo.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
package_dir="$project_dir/pingoose-v3-staging.1KaoVt"

if [[ $# -gt 0 ]]; then
    printf '사용법: %s (sudo 없이 GNOME 터미널에서 실행)\n소스를 다시 빌드·설치·활성화하고 X11 Shell을 재시작합니다.\n' "$0"
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

build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
(
    cd -- "$package_dir"
    gnome-extensions pack --force --out-dir="$build" --extra-source=webview.js --extra-source=evaluations.js .
)
gnome-extensions install --force "$build/pingoose@local.shell-extension.zip"

/usr/bin/python3 - <<'PY'
import os, subprocess, sys, time
from pathlib import Path
from gi.repository import Gio, GLib

UUID = 'pingoose@local'
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
def call(destination, path, interface, method, args):
    return bus.call_sync(destination, path, interface, method, args,
        None, Gio.DBusCallFlags.NONE, 2000, None).unpack()
def owner():
    return call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'GetNameOwner', GLib.Variant('(s)', ('org.gnome.Shell',)))[0]

# A first installation may not be discovered until Shell restarts. Persist
# enablement first, preserving the user's other enabled/disabled extensions.
settings = Gio.Settings.new('org.gnome.shell')
enabled = settings.get_strv('enabled-extensions')
if UUID not in enabled:
    enabled.append(UUID)
updates = [('enabled-extensions', enabled),
           ('disabled-extensions', [x for x in settings.get_strv('disabled-extensions') if x != UUID])]
for key, value in updates:
    if not settings.set_strv(key, value):
        sys.exit(f'설치됐지만 활성화 설정을 저장하지 못했습니다: {key}')
if not settings.set_boolean('disable-user-extensions', False):
    sys.exit('설치됐지만 사용자 확장 허용 설정을 저장하지 못했습니다.')
Gio.Settings.sync()
if os.environ['XDG_SESSION_TYPE'] == 'wayland':
    print('설치·활성화 설정 완료. Wayland에서는 재로그인 후 새 코드가 적용됩니다. 자동 로그아웃은 하지 않습니다.')
    sys.exit(2)

previous = owner()
log_dir = Path(os.environ.get('XDG_STATE_HOME') or Path.home() / '.local/state') / 'pingoose'
log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
log_path = log_dir / 'shell-restart.log'
fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
print('설치 완료. GNOME Shell을 재시작하고 새 코드 활성화를 확인합니다…', flush=True)
with os.fdopen(fd, 'ab') as log:
    process = subprocess.Popen(['gnome-shell', '--replace'], stdin=subprocess.DEVNULL,
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

deadline = time.monotonic() + 45
last_error = ''
while time.monotonic() < deadline:
    try:
        if owner() != previous:
            call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell.Extensions',
                 'EnableExtension', GLib.Variant('(s)', (UUID,)))
            info = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell.Extensions',
                        'GetExtensionInfo', GLib.Variant('(s)', (UUID,)))[0]
            if info.get('state') == 1:
                print('Pingoose 설치·Shell 재시작·활성화 완료. 소스 수정 후 ./install.sh를 다시 실행하면 적용됩니다.')
                sys.exit(0)
            last_error = str(info.get('error') or f"확장 상태: {info.get('state')}")
    except GLib.Error as error:
        last_error = str(error)
    if process.poll() is not None and process.returncode != 0:
        break
    time.sleep(1)
print(f'설치는 완료했지만 새 코드 활성화를 확인하지 못했습니다. 로그: {log_path}\n{last_error}\n로그아웃 후 다시 로그인해 주세요.', file=sys.stderr)
sys.exit(1)
PY
