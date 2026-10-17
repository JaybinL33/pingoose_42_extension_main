#!/usr/bin/env python3
"""Offline API/protocol regression tests; never read real credentials or contact 42."""
import io
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.parse
import urllib.request

import api


def row(identifier):
    return {'id': identifier, 'begin_at': '2099-06-01T12:30:00.000Z',
            'scale': {'name': 'Evaluation fixture'}}


def response(data):
    return io.BytesIO(json.dumps(data).encode())


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name, value in [('uid', 'fixture-uid'), ('secret', 'fixture-secret')]:
            (self.root / name).write_text(value)
            (self.root / name).chmod(0o600)
        self.client = api.Client(self.root, 'fixture-user')
        self.client.opener = Mock()
        self.sleep = patch('api.time.sleep').start()
        self.addCleanup(patch.stopall)
        self.token = {'access_token': 'fixture-token', 'token_type': 'bearer', 'expires_in': 7200}

    def test_token_cache_identity_and_request_scope(self):
        self.client.opener.open.side_effect = [response(self.token),
            response({'id': 42, 'login': 'fixture-user'}), response([]), response([row(1)]),
            response(self.token), response([row(1), row(2)])]
        self.assertEqual(self.client.upcoming(), [])
        self.assertEqual(self.client.upcoming(), [row(1)])
        self.client.expires = 0
        self.assertEqual(self.client.upcoming(), [row(1), row(2)])
        requests = [call.args[0] for call in self.client.opener.open.call_args_list]
        self.assertEqual([request.get_method() for request in requests],
                         ['POST', 'GET', 'GET', 'GET', 'POST', 'GET'])
        self.assertTrue(all(request.full_url.startswith(api.API + '/') for request in requests))
        self.assertIsNone(requests[0].get_header('Authorization'))
        form = urllib.parse.parse_qs(requests[0].data.decode())
        self.assertEqual(form['grant_type'], ['client_credentials'])
        for index in (2, 3, 5):
            request = requests[index]
            self.assertEqual(request.get_header('Authorization'), 'Bearer fixture-token')
            url = urllib.parse.urlsplit(request.full_url)
            self.assertEqual(url.path, '/v2/users/42/scale_teams/as_corrector')
            query = urllib.parse.parse_qs(url.query)
            self.assertEqual(query['filter[future]'], ['true'])
            self.assertEqual(query['page[size]'], ['100'])
            self.assertEqual(query['sort'], ['id'])
        self.assertEqual(len(list(self.root.iterdir())), 2)  # No token file.

    def test_credentials_require_owner_only_permissions(self):
        (self.root / 'secret').chmod(0o644)
        with self.assertRaises(api.Failure) as error:
            self.client.upcoming()
        self.assertEqual(error.exception.state, 'credentials-error')
        self.client.opener.open.assert_not_called()
        self.assertNotIn('fixture-secret', str(error.exception))

    def test_bad_credentials_and_token_payloads(self):
        for value in ('', 'fixture\nsecret', 'a' * 4097):
            (self.root / 'secret').write_text(value)
            with self.assertRaises(api.Failure):
                self.client.upcoming()
        self.client.opener.open.assert_not_called()
        (self.root / 'secret').write_text('fixture-secret')
        for token in (None, [], {}, {'access_token': 'x'},
                      dict(self.token, token_type=None), dict(self.token, expires_in=True),
                      dict(self.token, expires_in=-1), dict(self.token, access_token='')):
            self.client.opener.open.return_value = response(token)
            with self.assertRaises(api.Failure):
                self.client.upcoming()

    def test_profile_must_match_os_login(self):
        self.client._get = Mock(return_value={'id': 42, 'login': 'somebody-else'})
        with self.assertRaises(api.Failure) as error:
            self.client.upcoming()
        self.assertEqual(error.exception.state, 'account-error')
        self.assertIsNone(self.client.user_id)
        self.assertEqual(self.client._get.call_count, 1)

    def test_complete_paginated_snapshot_and_deduplication(self):
        self.client.user_id = 42
        self.client._get = Mock(side_effect=[list(map(row, range(1, 101))), [row(100), row(101)]])
        result = self.client.upcoming()
        self.assertEqual([item['id'] for item in result], list(range(1, 102)))
        self.assertIn('page%5Bnumber%5D=2', self.client._get.call_args.args[0])
        self.client._get.side_effect = [list(map(row, range(1, 101))), api.Failure('network-error')]
        with self.assertRaises(api.Failure):
            self.client.upcoming()  # No incomplete snapshot is returned.

    def test_pagination_limit(self):
        self.client.user_id = 42
        self.client._get = Mock(return_value=list(map(row, range(1, 101))))
        with self.assertRaises(api.Failure):
            self.client.upcoming()
        self.assertEqual(self.client._get.call_count, 20)

    def test_bad_snapshots_are_errors_not_empty_lists(self):
        self.client.user_id = 42
        for batch in ({'error': 'not a list'}, None, [None], [{'id': True}],
                      [dict(row(1), begin_at='invalid')], [dict(row(1), begin_at=None)],
                      [dict(row(1), begin_at='2099-01-01T00:00:00')],
                      [dict(row(1), id=-1)], [dict(row(1), id=2**64)]):
            self.client._get = Mock(return_value=batch)
            with self.assertRaises(api.Failure) as error:
                self.client.upcoming()
            self.assertEqual(error.exception.state, 'response-error')

    def test_http_errors_retry_after_and_token_invalidation(self):
        for code, state in [(401, 'auth-error'), (403, 'permission-error'),
                            (429, 'rate-limit'), (503, 'api-error'), (302, 'api-error')]:
            self.client.token = 'fixture-token'
            self.client.opener.open.side_effect = urllib.error.HTTPError(
                api.API, code, 'fixture-secret must not be logged', {'Retry-After': '75'}, None)
            with self.assertRaises(api.Failure) as error:
                self.client._http('/v2/users/42', token=self.client.token)
            self.assertEqual(error.exception.state, state)
            self.assertEqual(error.exception.retry_after, 75)
            self.assertNotIn('fixture-secret', str(error.exception))
            if code == 401:
                self.assertIsNone(self.client.token)
        self.client.opener.open.side_effect = urllib.error.URLError('fixture-secret')
        with self.assertRaises(api.Failure) as error:
            self.client._http('/v2/users/42')
        self.assertEqual(error.exception.state, 'network-error')

    def test_bad_json_and_oversized_response(self):
        for raw in (b'not JSON', b'\xff', b'x' * 2_000_001):
            self.client.opener.open.return_value = io.BytesIO(raw)
            with self.assertRaises(api.Failure) as error:
                self.client._http('/v2/users/42')
            self.assertEqual(error.exception.state, 'response-error')

    def test_redirects_refused(self):
        handler = api.NoRedirect()
        request = urllib.request.Request(api.API, headers={'Authorization': 'Bearer fixture-token'})
        for code in (301, 302, 303, 307, 308):
            self.assertIsNone(handler.redirect_request(request, None, code, '', {}, 'https://other.invalid/'))

    def test_retry_after_seconds_and_date(self):
        self.assertEqual(api.retry_after('75'), 75)
        for value in (None, 'garbage', 'nan', 'inf', '-1'):
            self.assertEqual(api.retry_after(value), 0)
        with patch('api.time.time', return_value=0):
            self.assertEqual(api.retry_after('Thu, 01 Jan 1970 00:01:00 GMT'), 60)

    def test_state_baseline_empty_and_removal_reappearance(self):
        seen = api.Seen(self.root / 'state' / 'evaluations.json', 42)
        self.assertEqual(seen.update([]), [])
        self.assertEqual(seen.update([row(1)]), [row(1)])
        self.assertEqual(seen.update([]), [])
        self.assertEqual(seen.update([row(1)]), [])
        restarted = api.Seen(seen.path, 42)
        self.assertEqual(restarted.update([row(1), row(2)]), [row(2)])
        self.assertEqual(seen.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(seen.path.parent.stat().st_mode & 0o777, 0o700)
        saved = json.loads(seen.path.read_text())
        self.assertEqual(set(saved), {'ids', 'user_id'})
        self.assertEqual(saved['ids'], [1, 2])
        other_account = api.Seen(seen.path, 43)
        self.assertEqual(other_account.update([row(3)]), [])

    def test_existing_first_snapshot_is_silent(self):
        seen = api.Seen(self.root / 'state.json', 42)
        self.assertEqual(seen.update([row(1), row(2)]), [])
        self.assertEqual(seen.update([row(2), row(3)]), [row(3)])

    def test_state_write_failure_is_atomic_and_does_not_advance_ids(self):
        seen = api.Seen(self.root / 'state' / 'evaluations.json', 42)
        seen.update([row(1)])
        original = seen.path.read_bytes()
        with patch('api.os.replace', side_effect=OSError('disk full')):
            with self.assertRaises(api.Failure) as error:
                seen.update([row(1), row(2)])
        self.assertEqual(error.exception.state, 'storage-error')
        self.assertEqual(seen.ids, [1])
        self.assertEqual(seen.path.read_bytes(), original)
        self.assertEqual(list(seen.path.parent.iterdir()), [seen.path])
        self.assertEqual(seen.update([row(1), row(2)]), [row(2)])

    def test_invalid_state_not_silently_overwritten(self):
        path = self.root / 'state.json'
        for saved in ('broken', '{}', '{"user_id":42,"ids":[true]}'):
            path.write_text(saved)
            path.chmod(0o600)
            with self.assertRaises(api.Failure) as error:
                api.Seen(path, 42)
            self.assertEqual(error.exception.state, 'storage-error')
            self.assertEqual(path.read_text(), saved)

    def test_history_is_bounded_without_evicting_current_ids(self):
        seen = api.Seen(self.root / 'state.json', 42)
        seen.update([row(1)])
        for identifier in range(2, api.MAX_SEEN + 10):
            # Avoid thousands of disk writes; exercise the real update at the bound.
            seen.ids.append(identifier)
        seen.update([row(1), row(api.MAX_SEEN + 10)])
        self.assertEqual(len(seen.ids), api.MAX_SEEN)
        self.assertIn(1, seen.ids)
        self.assertEqual(seen.update([row(1), row(api.MAX_SEEN + 10)]), [])

    def test_worker_respects_retry_after_before_polling_again(self):
        clock = [0]
        messages = []
        client = Mock(user_id=42, login='fixture-user')
        client.upcoming.side_effect = [[], api.Failure('rate-limit', 120, 429), [row(1)]]

        def advance(_read, _write, _errors, timeout):
            clock[0] += timeout
            return [], [], []

        def collect(message):
            messages.append(message)
            if message.get('state') == 'watching' and message['count'] == 1:
                raise StopIteration

        with patch('api.time.monotonic', side_effect=lambda: clock[0]), \
                patch('api.select.select', side_effect=advance), patch('api.emit', side_effect=collect):
            with self.assertRaises(StopIteration):
                api.run(client, self.root / 'state.json')
        self.assertEqual(clock[0], 130)  # First retry is 120 seconds after the failed poll at t=10.
        self.assertEqual(client.upcoming.call_count, 3)
        error = next(message for message in messages if message.get('state') == 'rate-limit')
        self.assertEqual(error['retryAfter'], 120)
        self.assertEqual([message['id'] for message in messages if message['type'] == 'notification'],
                         ['scale-team:1'])

    def test_card_text_and_protocol_size(self):
        item = row(123)
        item['scale']['name'] = '<b>not markup</b>\x00\n' + '가' * 2000
        message = api.notification(item)
        self.assertEqual(message['id'], 'scale-team:123')
        self.assertIn('평가 ID: 123', message['body'])
        self.assertNotIn('\x00', message['body'])
        self.assertLess(len(message['body']), 1000)
        self.assertLess(len(json.dumps(message)), 8192)
        self.assertNotIn('test', message)


CHILD = r'''
import os
from pathlib import Path
import time
import api
api.POLL_SECONDS = 0.04
class FakeClient:
    login = 'fixture-user'
    user_id = 42
    polls = 0
    def upcoming(self):
        if os.environ.get('TEST_BLOCK'):
            print('{"type":"fixture-inflight"}', flush=True)
            time.sleep(60)
        self.polls += 1
        if self.polls == 2 and not os.environ.get('TEST_RESTART'):
            raise api.Failure('network-error')
        ids = [1, 2, 3] if os.environ.get('TEST_RESTART') else ([1] if self.polls == 1 else [1, 2])
        return [{'id': value, 'begin_at': '2099-06-01T12:30:00Z'} for value in ids]
api.run(FakeClient(), Path(os.environ['TEST_STATE']))
'''


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / 'state' / 'evaluations.json'

    def start(self, **environment):
        proc = subprocess.Popen([sys.executable, '-B', '-u', '-c', CHILD],
            cwd=Path(__file__).parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, bufsize=0,
            env=dict(os.environ, TEST_STATE=str(self.state), **environment))
        self.addCleanup(self.cleanup, proc)
        return proc

    @staticmethod
    def cleanup(proc):
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=5)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream is not None:
                stream.close()

    def until(self, proc, predicate):
        messages = []
        end = time.monotonic() + 5
        while time.monotonic() < end:
            if not select.select([proc.stdout], [], [], 0.2)[0]:
                continue
            line = proc.stdout.readline()
            self.assertTrue(line, 'Worker exited before expected message')
            message = json.loads(line)
            messages.append(message)
            if predicate(message):
                return messages
        self.fail('Worker protocol timed out')

    def test_live_loop_baseline_failure_recovery_commands_and_restart(self):
        proc = self.start()
        messages = self.until(proc, lambda message: message.get('state') == 'watching' and message['count'] == 2)
        tail, errors = proc.communicate(b'test\ntest\nquit\n', timeout=5)
        messages += [json.loads(line) for line in tail.splitlines()]
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(errors, b'')
        self.assertTrue(any(message.get('state') == 'network-error' for message in messages))
        actual = [message for message in messages if message['type'] == 'notification' and not message.get('test')]
        self.assertEqual([message['id'] for message in actual], ['scale-team:2'])
        demos = [message for message in messages if message.get('test')]
        self.assertEqual(len(demos), 2)
        self.assertNotEqual(demos[0]['id'], demos[1]['id'])
        self.assertEqual(json.loads(self.state.read_text())['ids'], [1, 2])
        restarted = self.start(TEST_RESTART='1')
        again = self.until(restarted, lambda message: message.get('state') == 'watching')
        self.assertEqual([message['id'] for message in again if message['type'] == 'notification'], ['scale-team:3'])
        restarted.stdin.close()  # EOF must stop polling without a quit command.
        restarted.wait(timeout=5)
        self.assertEqual(restarted.returncode, 0)

    def test_sigterm_stops_an_inflight_request(self):
        proc = self.start(TEST_BLOCK='1')
        self.until(proc, lambda message: message['type'] == 'fixture-inflight')
        proc.terminate()
        proc.wait(timeout=5)
        self.assertEqual(proc.returncode, -signal.SIGTERM)
        self.assertFalse(self.state.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
