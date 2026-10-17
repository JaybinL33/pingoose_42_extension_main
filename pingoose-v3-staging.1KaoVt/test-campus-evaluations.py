#!/usr/bin/env python3
"""Offline checks for the campus CLI; no real credentials or requests."""
import datetime as dt
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock, patch
import urllib.parse

from api import Failure
import campus_evaluations as campus


def profile():
    return {'id': 42, 'login': 'fixture-user', 'campus_users': [
        {'campus_id': 1, 'is_primary': False}, {'campus_id': 69, 'is_primary': True}]}


def evaluation():
    return {'id': 123, 'begin_at': '2026-10-14T10:45:00Z',
            'created_at': '2026-10-14T10:02:51Z', 'filled_at': '2026-10-14T11:25:03Z',
            'corrector': {'id': 50, 'login': 'fixture-corrector', 'email': 'private@example.invalid'},
            'correcteds': [{'id': 51, 'login': 'fixture-a'}, {'id': 52, 'login': 'fixture-b'}],
            'team': {'project_id': 1337, 'private_field': 'not-requested'},
            'comment': 'private-comment', 'token': 'private-evaluation-token', 'final_mark': 100}


class CampusTests(unittest.TestCase):
    def client(self, rows):
        client = Mock(login='fixture-user')
        client._get.side_effect = [profile(), rows]
        return client

    def test_primary_campus_query_and_requested_fields(self):
        client = self.client([evaluation()])
        result = campus.recent_evaluations(client, 10)
        self.assertEqual(client._get.call_args_list[0].args[0], '/v2/users/fixture-user')
        url = urllib.parse.urlsplit(client._get.call_args_list[1].args[0])
        self.assertEqual(url.path, '/v2/scale_teams')
        self.assertEqual(urllib.parse.parse_qs(url.query), {
            'filter[campus_id]': ['69'], 'sort': ['-begin_at'], 'page[size]': ['10'], 'page[number]': ['1']})
        self.assertEqual(result['campus_id'], 69)
        self.assertEqual(result['count'], 1)
        row = result['evaluations'][0]
        self.assertEqual(set(row), {'id', 'corrector', 'correcteds', 'begin_at', 'created_at',
                                    'filled_at', 'project_id', 'corrector_id'})
        self.assertEqual(row['corrector'], 'fixture-corrector')
        self.assertEqual(row['correcteds'], ['fixture-a', 'fixture-b'])
        self.assertEqual(row['corrector_id'], 50)
        self.assertEqual(row['project_id'], 1337)
        self.assertEqual(dt.datetime.fromisoformat(row['begin_at']),
                         dt.datetime.fromisoformat('2026-10-14T10:45:00+00:00'))
        encoded = json.dumps(result)
        for private in ('private@example.invalid', 'private-comment', 'private-evaluation-token',
                        'not-requested', 'final_mark'):
            self.assertNotIn(private, encoded)

    def test_hidden_and_missing_participants_not_guessed(self):
        row = evaluation()
        row.update(corrector='invisible', correcteds='invisible', team=None, filled_at=None)
        result = campus.recent_evaluations(self.client([row]), 10)['evaluations'][0]
        for key in ('corrector', 'correcteds', 'corrector_id', 'project_id', 'filled_at'):
            self.assertIsNone(result[key])
        row['correcteds'] = [{'login': 'fixture-a'}, 'invisible', {'login': 'bad\x1b[31m'}]
        result = campus.recent_evaluations(self.client([row]), 10)['evaluations'][0]
        self.assertEqual(result['correcteds'], ['fixture-a', None, None])
        row['correcteds'] = []
        self.assertEqual(campus.recent_evaluations(self.client([row]), 10)['evaluations'][0]['correcteds'], [])

    def test_empty_success_not_an_error(self):
        result = campus.recent_evaluations(self.client([]), 10)
        self.assertEqual(result['count'], 0)
        self.assertEqual(result['evaluations'], [])

    def test_missing_ambiguous_or_invalid_campus_blocks_query(self):
        for campuses in (None, [], [{'campus_id': 0, 'is_primary': True}],
                         [{'campus_id': True, 'is_primary': True}],
                         [{'campus_id': 1, 'is_primary': True}, {'campus_id': 69, 'is_primary': True}]):
            user = profile()
            user['campus_users'] = campuses
            client = Mock(login='fixture-user')
            client._get.return_value = user
            with self.assertRaises(Failure) as error:
                campus.recent_evaluations(client, 10)
            self.assertEqual(error.exception.state, 'account-error')
            self.assertEqual(client._get.call_count, 1)

    def test_wrong_account_blocks_campus_query(self):
        client = Mock(login='fixture-user')
        client._get.return_value = dict(profile(), login='other-user')
        with self.assertRaises(Failure):
            campus.recent_evaluations(client, 10)
        self.assertEqual(client._get.call_count, 1)

    def test_malformed_response_and_dates(self):
        for rows in (None, {}, [None], [dict(evaluation(), id=True)],
                     [dict(evaluation(), begin_at=None)], [dict(evaluation(), begin_at='not a date')],
                     [dict(evaluation(), begin_at='2026-01-01T00:00:00')],
                     [dict(evaluation(), created_at={})], [evaluation()] * 11):
            with self.assertRaises(Failure) as error:
                campus.recent_evaluations(self.client(rows), 10)
            self.assertEqual(error.exception.state, 'response-error')

    def test_cli_limit_is_checked_before_authentication(self):
        for value in ('0', '-1', '101', 'nope'):
            with patch.object(campus, 'Client') as constructor, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    campus.main(['--limit', value])
                self.assertEqual(error.exception.code, 2)
                constructor.assert_not_called()

    def test_cli_defaults_and_success(self):
        client = self.client([evaluation()])
        output = io.StringIO()
        with patch.object(campus, 'Client', return_value=client), redirect_stdout(output):
            self.assertEqual(campus.main([]), 0)
        self.assertEqual(json.loads(output.getvalue())['count'], 1)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(client._get.call_args.args[0]).query)
        self.assertEqual(query['page[size]'], ['10'])
        client = self.client([])
        with patch.object(campus, 'Client', return_value=client), redirect_stdout(io.StringIO()):
            self.assertEqual(campus.main(['--limit', '100']), 0)
        self.assertIn('page%5Bsize%5D=100', client._get.call_args.args[0])

    def test_cli_failure_is_not_reported_as_empty_success(self):
        client = self.client([])
        client._get.side_effect = Failure('rate-limit', 75, 429)
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(campus, 'Client', return_value=client), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(campus.main([]), 1)
        self.assertEqual(output.getvalue(), '')
        self.assertIn('429', errors.getvalue())
        self.assertIn('75', errors.getvalue())
        client._get.side_effect = RuntimeError('private-secret-must-not-be-printed')
        with patch.object(campus, 'Client', return_value=client), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(campus.main([]), 1)
        self.assertNotIn('private-secret-must-not-be-printed', errors.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
