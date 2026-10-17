#!/usr/bin/python3
"""Offline fixtures only: no real Intra login, tokens or persistent browser profile."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import datetime as dt
import http.server
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import intra_evaluations as intra

NOW = dt.datetime(2026, 10, 16, 6, 0, tzinfo=dt.timezone.utc)


def evaluation(**changes):
    return dict({'id': 123, 'kind': 'evaluator', 'project_name': 'fixture-project',
                 'begin_at': '2026-10-16T16:00:00+09:00',
                 'user': 'private-participant', 'access_token': 'private-token'}, **changes)


class ParserTests(unittest.TestCase):
    def test_future_and_started_roles_timezones_and_privacy(self):
        rows = [evaluation(), evaluation(id=124, kind='evaluated', begin_at='2026-10-16T05:00:00Z')]
        report = intra.summarize(rows, NOW)
        self.assertTrue(report['ok'])
        self.assertTrue(report['has_upcoming'])
        self.assertEqual((report['pending_count'], report['upcoming_count']), (2, 1))
        self.assertEqual([row['id'] for row in report['evaluations']], [124, 123])
        self.assertEqual([row['role'] for row in report['evaluations']], ['피평가자', '평가자'])
        self.assertEqual(dt.datetime.fromisoformat(report['evaluations'][1]['begin_at']),
                         dt.datetime(2026, 10, 16, 7, tzinfo=dt.timezone.utc))
        encoded = json.dumps(report)
        for private in ('private-participant', 'private-token', 'access_token'):
            self.assertNotIn(private, encoded)

    def test_empty_is_success_but_exact_start_is_not_future(self):
        report = intra.summarize([], NOW)
        self.assertTrue(report['ok'])
        self.assertFalse(report['has_upcoming'])
        self.assertEqual(report['pending_count'], 0)
        report = intra.summarize([evaluation(begin_at=NOW.isoformat())], NOW)
        self.assertFalse(report['has_upcoming'])
        self.assertEqual(report['pending_count'], 1)

    def test_camel_case_unknown_role_and_hidden_project(self):
        row = {'id': '1', 'kind': 'new-role', 'projectName': None, 'beginAt': '2026-10-16T07:00:00Z'}
        result = intra.summarize([row], NOW)['evaluations'][0]
        self.assertEqual(result['id'], '1')
        self.assertEqual(result['role'], '미확인')
        self.assertIsNone(result['project'])
        self.assertTrue(result['upcoming'])

    def test_bad_response_never_becomes_an_empty_list(self):
        cases = [None, {}, [None], [evaluation(), evaluation()], [evaluation(), evaluation(id='123')], [evaluation()] * 1001]
        for changes in ({'id': True}, {'id': 0}, {'id': 2**53}, {'id': '123/other'}, {'kind': ''},
                        {'kind': None}, {'begin_at': None}, {'begin_at': 'not a date'},
                        {'begin_at': '2026-02-30T00:00:00Z'}, {'begin_at': '2026-10-16T07:00:00'},
                        {'project_name': {'token': 'private'}}, {'project_name': 'x' * 501}):
            cases.append([evaluation(**changes)])
        for rows in cases:
            with self.subTest(rows=type(rows).__name__), self.assertRaises(intra.CheckError):
                intra.summarize(rows, NOW)

    def test_control_characters_are_not_printed(self):
        row = intra.summarize([evaluation(project_name='project\n\x1b[31m')], NOW)['evaluations'][0]
        self.assertNotIn('\n', row['project'])
        self.assertNotIn('\x1b', row['project'])

    def test_navigation_boundaries(self):
        for uri in (intra.HOME, 'https://auth.42.fr/auth/realms/students-42', 'about:blank'):
            self.assertTrue(intra.navigation_allowed(uri))
        for uri in ('http://auth.42.fr/', 'https://auth.42.fr.evil.invalid/',
                    'https://auth.42.fr:4242/', 'https://user:password@auth.42.fr/',
                    'javascript:alert(1)', 'file:///etc/passwd', 'https://[invalid'):
            self.assertFalse(intra.navigation_allowed(uri))

    def test_private_profile_lock_and_permissions(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'XDG_DATA_HOME': root}):
            with intra.private_profile() as directory:
                self.assertEqual(directory, Path(root) / 'pingoose/intra-check')
                self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
                self.assertEqual((directory / 'lock').stat().st_mode & 0o777, 0o600)
                with self.assertRaises(intra.CheckError):
                    with intra.private_profile():
                        self.fail('Concurrent use of profile accepted')
            with intra.private_profile():
                pass

    def test_cli_success_error_redaction_and_timeout_validation(self):
        for value in ('0', '-1', '1801', 'nope'):
            with patch.object(intra, 'run_webview') as run, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    intra.main(['--timeout', value])
                run.assert_not_called()
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'XDG_DATA_HOME': root}):
            output = io.StringIO()
            with patch.object(intra, 'run_webview', return_value=intra.summarize([], NOW)), redirect_stdout(output), redirect_stderr(io.StringIO()):
                self.assertEqual(intra.main([]), 0)
            self.assertTrue(json.loads(output.getvalue())['ok'])
            for error in (intra.CheckError('timeout-no-successful-response'), RuntimeError('private-token')):
                output = io.StringIO()
                with patch.object(intra, 'run_webview', side_effect=error), redirect_stdout(output), redirect_stderr(io.StringIO()):
                    self.assertEqual(intra.main([]), 1)
                report = json.loads(output.getvalue())
                self.assertFalse(report['ok'])
                self.assertNotIn('has_upcoming', report)
                self.assertNotIn('private-token', output.getvalue())


@contextmanager
def fixture_server(responses, on_api=None):
    calls = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == '/api/v1/users/me/scale_teams':
                index = min(len(calls), len(responses) - 1)
                calls.append(self.path)
                if on_api is not None:
                    on_api()
                status, body = responses[index]
                content_type = 'application/json'
            else:
                status, content_type = 200, 'text/html'
                # A forged bridge message must not produce a false empty success. The real fetch is delayed.
                body = '''<!doctype html><script>
                    window.webkit.messageHandlers.pingooseCheck.postMessage(JSON.stringify({nonce:'wrong',http_status:200,rows:[]}));
                    setTimeout(async () => {
                        const endpoint = new URL('/api/v1/users/me/scale_teams', location.href);
                        let response = await fetch(endpoint, {headers:{Authorization:'Bearer fixture-only'}});
                        if (response.status === 401 || response.status === 403)
                            response = await fetch(new Request(endpoint, {headers:{Authorization:'Bearer fixture-only'}}));
                        await response.text();
                    }, 50);
                </script>'''
            encoded = body.encode()
            self.send_response(status)
            if status == 302:
                self.send_header('Location', '/moved')
            self.send_header('Content-Type', content_type)
            self.send_header('Set-Cookie', 'pingoose_fixture=not-a-real-session; Max-Age=60; HttpOnly; SameSite=Lax')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_port}/', calls
        finally:
            server.shutdown()
            thread.join(timeout=5)


@unittest.skipUnless(os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'), 'Native WebKit fixture needs a display')
class NativeTests(unittest.TestCase):
    def run_fixture(self, responses, timeout=15):
        with fixture_server(responses) as (home, calls), redirect_stderr(io.StringIO()):
            report = intra.run_webview(timeout=timeout, home=home,
                                       endpoint=home + 'api/v1/users/me/scale_teams', visible=False)
        return report, calls

    def test_real_webkit_fetch_capture_after_auth_failure(self):
        rows = [evaluation(begin_at='2099-01-01T00:00:00Z')]
        report, calls = self.run_fixture([(401, '{"detail":"private-token"}'), (200, json.dumps(rows))])
        self.assertEqual(len(calls), 2)
        self.assertEqual(report['upcoming_count'], 1)
        self.assertEqual(report['evaluations'][0]['id'], 123)
        self.assertNotIn('private-token', json.dumps(report))
        self.assertNotIn('private-participant', json.dumps(report))

    def test_real_webkit_empty_and_camel_case(self):
        report, _ = self.run_fixture([(200, '[]')])
        self.assertFalse(report['has_upcoming'])
        report, _ = self.run_fixture([(200, json.dumps([{'id': 2, 'kind': 'evaluated', 'projectName': 'fixture',
                                                       'beginAt': '2099-01-01T00:00:00Z'}]))])
        self.assertEqual(report['upcoming_count'], 1)
        self.assertEqual(report['evaluations'][0]['project'], 'fixture')

    def test_real_webkit_errors_are_not_empty_successes(self):
        for status, body, code in ((200, '<html>private-token</html>', 'invalid-response'),
                                   (200, '{"unexpected":[]}', 'invalid-response'),
                                   (200, '[{"id":1}]', 'invalid-response'),
                                   (302, '', 'redirected'),
                                   (429, '{"detail":"private-token"}', 'api-http-429')):
            with self.subTest(status=status, code=code), self.assertRaisesRegex(intra.CheckError, '^' + code + '$'):
                self.run_fixture([(status, body)])

    def test_real_webkit_timeout_without_authentication(self):
        with self.assertRaisesRegex(intra.CheckError, '^timeout-no-successful-response$'):
            self.run_fixture([(403, '{"detail":"private-token"}')], timeout=1)

    def test_real_cli_profile_permissions_and_sigterm(self):
        ready = threading.Event()
        code = '''
import sys
import intra_evaluations as intra
original = intra.run_webview
home = sys.argv[1]
intra.run_webview = lambda profile, timeout: original(profile, timeout, home=home,
    endpoint=home + 'api/v1/users/me/scale_teams', visible=False)
sys.exit(intra.main(['--timeout', '30']))
'''
        with tempfile.TemporaryDirectory() as root, fixture_server([(401, '{}')], ready.set) as (home, _):
            env = dict(os.environ, XDG_DATA_HOME=root)
            child = subprocess.Popen([sys.executable, '-B', '-c', code, home], env=env,
                                     cwd=Path(__file__).resolve().parent, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertTrue(ready.wait(15), 'Native CLI did not reach local fixture')
                child.send_signal(signal.SIGTERM)
                output, errors = child.communicate(timeout=15)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.communicate(timeout=10)
            self.assertEqual(child.returncode, 1)
            self.assertEqual(json.loads(output), {'ok': False, 'error': 'interrupted'})
            directory = Path(root) / 'pingoose/intra-check'
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertTrue((directory / 'cookies.sqlite').is_file())
            for path in directory.rglob('*'):
                if path.is_file():
                    self.assertEqual(path.stat().st_mode & 0o077, 0, path.name)
            self.assertNotIn('fixture-only', output + errors)
            with patch.dict(os.environ, {'XDG_DATA_HOME': root}), intra.private_profile():
                pass


if __name__ == '__main__':
    unittest.main(verbosity=2)
