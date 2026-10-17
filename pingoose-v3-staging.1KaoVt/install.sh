#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v gnome-extensions >/dev/null
test -x /usr/bin/gjs
/usr/bin/gjs -c "imports.gi.versions.Gtk='3.0'; imports.gi.versions.WebKit2='4.0'; imports.gi.versions.Soup='2.4'; const {Gtk, WebKit2, Soup}=imports.gi;"
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
# Only runtime sources: no API app credentials, browser profile, diagnostics or tests.
gnome-extensions pack --force --out-dir="$build" --extra-source=webview.js --extra-source=evaluations.js --extra-source=token_refresher.py .
gnome-extensions install --force "$build/pingoose@local.shell-extension.zip"
printf '\n%s\n' \
    'Pingoose v3 설치 완료. 기존 데스크톱 세션은 변경하지 않았습니다.' \
    'Ubuntu X11: 직접 Alt+F2 → r → Enter로 Shell을 재시작하세요. 또는 로그아웃/로그인하세요.' \
    'JavaScript 캐시 때문에 단순히 확장을 껐다 켜면 옛 코드가 남을 수 있습니다.' \
    '필요하면: gnome-extensions enable pingoose@local' \
    '메뉴의 «인트라 창 열기»에서 로그인하세요. 창을 닫거나 숨겨도 감시는 계속됩니다.' \
    '«인트라 v3 · 10초마다 평가 조회 중»이 표시된 뒤 새 평가 예약을 테스트하세요.' \
    '기존 UID/secret, API 진단 코드, 이전 기준 목록은 삭제하거나 변경하지 않았습니다.'
