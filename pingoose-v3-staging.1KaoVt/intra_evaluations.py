#!/usr/bin/python3
"""Read the real Intra V3 evaluation response in a private, user-operated WebKit window."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sys
import urllib.parse

HOME = 'https://profile-v3.intra.42.fr/'
API = 'https://intrapy.intra.42.fr/api/v1/users/me/scale_teams'
MAX_BODY = 2_000_000
LOGIN_HOSTS = {'profile-v3.intra.42.fr', 'profile.intra.42.fr', 'auth.42.fr', 'signin.intra.42.fr', 'api.intra.42.fr'}


class CheckError(Exception):
    pass


def summarize(rows, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if not isinstance(rows, list) or len(rows) > 1000 or now.tzinfo is None:
        raise CheckError('invalid-response')
    items = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise CheckError('invalid-response')
        identifier = row.get('id')
        kind = row.get('kind')
        begin = row.get('begin_at', row.get('beginAt'))
        project = row.get('project_name', row.get('projectName'))
        valid_id = ((type(identifier) is int and 0 < identifier < 2**53) or
                    (isinstance(identifier, str) and re.fullmatch(r'[1-9][0-9]{0,19}', identifier)))
        if (not valid_id or str(identifier) in seen or
                not isinstance(kind, str) or not kind or len(kind) > 40 or not kind.isprintable() or
                not isinstance(begin, str) or
                (project is not None and (not isinstance(project, str) or len(project) > 500))):
            raise CheckError('invalid-response')
        try:
            start = dt.datetime.fromisoformat(begin.replace('Z', '+00:00'))
            if start.tzinfo is None:
                raise ValueError('Timezone required')
            local_start = start.astimezone().isoformat(timespec='seconds')
        except (ValueError, OverflowError, OSError):
            raise CheckError('invalid-response') from None
        seen.add(str(identifier))
        items.append({'id': identifier, 'kind': kind,
                      'role': {'evaluator': '평가자', 'evaluated': '피평가자'}.get(kind, '미확인'),
                      'project': ''.join(char for char in project if char.isprintable()) if project is not None else None,
                      'begin_at': local_start, 'upcoming': start > now})
    items.sort(key=lambda item: dt.datetime.fromisoformat(item['begin_at']))
    future_count = sum(item['upcoming'] for item in items)
    return {'ok': True, 'source': API, 'checked_at': now.astimezone().isoformat(timespec='seconds'),
            'pending_count': len(items), 'upcoming_count': future_count,
            'has_upcoming': future_count > 0, 'evaluations': items}


def navigation_allowed(uri):
    if uri in ('about:blank', 'about:srcdoc'):
        return True
    try:
        parsed = urllib.parse.urlsplit(uri)
        return (parsed.scheme == 'https' and parsed.hostname in LOGIN_HOSTS and
                parsed.port in (None, 443) and parsed.username is None and parsed.password is None)
    except (ValueError, TypeError):
        return False


@contextmanager
def private_profile():
    base = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')
    directory = base / 'pingoose' / 'intra-check'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != os.getuid():
        raise CheckError('profile-permissions')
    directory.chmod(0o700)
    descriptor = os.open(directory / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CheckError('profile-in-use') from None
        yield directory
    finally:
        os.close(descriptor)


# Clone only the known response. Native get_data() returned incomplete fetch bodies on this WebKit runtime.
OBSERVER = r'''
(() => {
    const endpoint = __ENDPOINT__;
    const nonce = __NONCE__;
    const send = value => window.webkit.messageHandlers.pingooseCheck.postMessage(JSON.stringify({nonce, ...value}));
    const original = window.fetch;
    const isTarget = input => {
        try { return new URL(input instanceof Request ? input.url : input, location.href).href === endpoint; }
        catch (_) { return false; }
    };
    window.fetch = function (...args) {
        const pending = original.apply(this, args);
        if (isTarget(args[0])) {
            pending.then(response => {
                if (response.url !== endpoint) { send({error: 'redirected'}); return; }
                if (response.status !== 200) { send({http_status: response.status}); return; }
                response.clone().text().then(text => {
                    if (text.length > 2000000) { send({error: 'response-too-large'}); return; }
                    let rows;
                    try { rows = JSON.parse(text); }
                    catch (_) { send({error: 'invalid-response'}); return; }
                    if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
                        send({error: 'invalid-response'}); return;
                    }
                    send({http_status: 200, rows: rows.map(row => ({
                        id: row.id, kind: row.kind,
                        begin_at: row.begin_at === undefined ? row.beginAt : row.begin_at,
                        project_name: row.project_name === undefined ? row.projectName : row.project_name,
                    }))});
                }).catch(() => send({error: 'invalid-response'}));
            }, () => send({error: 'network-error'}));
        }
        return pending; // Leave the site's original promise, headers and body untouched.
    };
})();
'''


def run_webview(profile=None, timeout=300, *, home=HOME, endpoint=API, visible=True):
    # GTK stays out of GNOME Shell and out of the offline parser tests.
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('WebKit2', '4.0')
    from gi.repository import Gtk, GLib, WebKit2
    if not Gtk.init_check([])[0]:
        raise CheckError('display-unavailable')
    if profile is None:
        manager = WebKit2.WebsiteDataManager.new_ephemeral()
    else:
        manager = WebKit2.WebsiteDataManager(base_data_directory=str(profile / 'data'),
                                              base_cache_directory=str(profile / 'cache'))
    context = WebKit2.WebContext.new_with_website_data_manager(manager)
    if profile is not None:
        context.get_cookie_manager().set_persistent_storage(
            str(profile / 'cookies.sqlite'), WebKit2.CookiePersistentStorage.SQLITE)
    context.connect('download-started', lambda _context, download: download.cancel())
    content = WebKit2.UserContentManager()
    if not content.register_script_message_handler('pingooseCheck'):
        raise CheckError('observer-unavailable')
    nonce = secrets.token_urlsafe(24)
    script = OBSERVER.replace('__ENDPOINT__', json.dumps(endpoint)).replace('__NONCE__', json.dumps(nonce))
    parsed_home = urllib.parse.urlsplit(home)
    # WebKit match patterns omit ports; the message receiver still checks the full origin.
    pattern = f'{parsed_home.scheme}://{parsed_home.hostname}/*'
    content.add_script(WebKit2.UserScript.new(script, WebKit2.UserContentInjectedFrames.TOP_FRAME,
                                             WebKit2.UserScriptInjectionTime.START, [pattern], None))
    view = WebKit2.WebView(web_context=context, user_content_manager=content)
    view.get_settings().set_enable_write_console_messages_to_stdout(False)
    view.connect('permission-request', lambda _view, request: (request.deny(), True)[1])
    window = Gtk.Window(title='Pingoose · 인트라 예약 조회', default_width=1000, default_height=760)
    header = Gtk.HeaderBar(title='인트라 로그인 후 예정 평가를 한 번 조회합니다', show_close_button=True)
    header.set_subtitle('일반 브라우저와 별도 세션 · 예약/슬롯 버튼은 조작하지 마세요')
    reload_button = Gtk.Button(label='다시 조회')
    reload_button.connect('clicked', lambda _button: view.load_uri(home))
    header.pack_end(reload_button)
    window.set_titlebar(header)
    window.add(view)
    loop = GLib.MainLoop()
    result = {'report': None, 'error': None}
    stopped = False
    timer = 0
    signals = {}

    def finish(report=None, error=None):
        nonlocal stopped
        if stopped:
            return
        stopped = True
        result.update(report=report, error=error)
        view.stop_loading()
        loop.quit()

    def message(_content, value):
        if stopped:
            return
        current = urllib.parse.urlsplit(view.get_uri() or '')
        expected = urllib.parse.urlsplit(home)
        if (current.scheme, current.netloc) != (expected.scheme, expected.netloc):
            return
        try:
            text = value.get_js_value().to_string()
            if len(text) > MAX_BODY:
                raise CheckError('response-too-large')
            packet = json.loads(text)
            if not isinstance(packet, dict) or packet.get('nonce') != nonce:
                return
            if 'error' in packet:
                error = packet['error']
                if error not in {'redirected', 'response-too-large', 'invalid-response', 'network-error'}:
                    error = 'invalid-response'
                raise CheckError(error)
            status = packet.get('http_status')
            if type(status) is not int or not 100 <= status <= 599:
                raise CheckError('invalid-response')
            if status in (401, 403):
                header.set_subtitle(f'HTTP {status} · 로그인/권한 확인 후 다시 조회하세요')
                print(f'API HTTP {status}: 로그인/권한 확인을 기다립니다.', file=sys.stderr)
                return
            if status != 200:
                raise CheckError(f'api-http-{status}')
            finish(report=summarize(packet.get('rows')))
        except CheckError as error:
            finish(error=str(error))
        except Exception:
            finish(error='invalid-response')

    def policy(_view, decision, kind):
        if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        uri = decision.get_navigation_action().get_request().get_uri()
        # The explicit home is injectable only by the offline native test, never through CLI arguments.
        fixture_home = urllib.parse.urlsplit(home)
        requested = urllib.parse.urlsplit(uri)
        is_home = (requested.scheme, requested.netloc) == (fixture_home.scheme, fixture_home.netloc)
        if kind == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION or not (is_home or navigation_allowed(uri)):
            decision.ignore()
            header.set_subtitle('조회·로그인 이외의 페이지 이동을 차단했습니다')
            return True
        return False

    def expired():
        nonlocal timer
        timer = 0
        finish(error='timeout-no-successful-response')
        return False

    def interrupted(number):
        signals.pop(number, None)
        finish(error='interrupted')
        return False

    content.connect('script-message-received::pingooseCheck', message)
    view.connect('decide-policy', policy)
    view.connect('load-failed', lambda *_: (header.set_subtitle('페이지 연결 실패 · 다시 조회하거나 창을 닫으세요'), False)[1])
    view.connect('web-process-terminated', lambda *_: finish(error='web-process-terminated'))
    window.connect('delete-event', lambda *_: (finish(error='cancelled'), True)[1])
    timer = GLib.timeout_add_seconds(timeout, expired)
    for number in (signal.SIGTERM, signal.SIGINT):
        signals[number] = GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, number, interrupted, number)
    try:
        if visible:
            window.show_all()
        else:
            view.show()
        view.load_uri(home)
        loop.run()
    finally:
        stopped = True
        if timer:
            GLib.source_remove(timer)
        for source in signals.values():
            GLib.source_remove(source)
        window.destroy()
    if result['error'] or result['report'] is None:
        raise CheckError(result['error'] or 'no-response')
    return result['report']


def main(argv=None):
    parser = argparse.ArgumentParser(description='전용 인트라 웹뷰에서 실제 V3 평가 목록을 한 번 조회합니다. UID/secret은 사용하지 않습니다.')
    parser.add_argument('--timeout', type=int, default=300, metavar='SECONDS', help='로그인·응답 대기 시간, 1~1800초 (기본 300)')
    args = parser.parse_args(argv)
    if not 1 <= args.timeout <= 1800:
        parser.error('--timeout은 1~1800초여야 합니다.')
    os.umask(0o077)
    try:
        with private_profile() as profile:
            print('새 창에서 본인 계정으로 로그인해 주세요. 정상 API 응답 후 JSON을 출력하고 종료합니다.', file=sys.stderr)
            report = run_webview(profile, args.timeout)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except CheckError as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 1
    except BrokenPipeError:
        return 0
    except Exception as error:
        # Native/network exception messages can contain login URLs or credentials.
        print(json.dumps({'ok': False, 'error': 'startup-or-runtime-error', 'exception_type': type(error).__name__}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
