#!/usr/bin/env python3
"""Offline tests for arbitrary read-only API paths and output redaction."""
import copy
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock, patch

from api import Failure
import api_get


class ApiGetTests(unittest.TestCase):
    def test_redacts_nested_credentials_without_hiding_logins(self):
        secret_fields = ('uid', 'client_id', 'clientSecret', 'secret', 'PASSWORD', 'password_hash',
                         'Authorization', 'access_token', 'accessTokens', 'refreshToken', 'csrf-token', 'token',
                         'api_key', 'private_key', 'authorization_code', 'jwt')
        record = {key: 'private-fixture-' + key for key in secret_fields}
        record.update(id=42, login='fixture-user', token_type='bearer')
        value = {'items': [record], 'count': 1, 'nothing': None}
        original = copy.deepcopy(value)
        result = api_get.redact(value)
        self.assertEqual(value, original)
        for key in secret_fields:
            self.assertEqual(result['items'][0][key], '[REDACTED]')
            self.assertNotIn('private-fixture-' + key, json.dumps(result))
        self.assertEqual(result['items'][0]['login'], 'fixture-user')
        self.assertEqual(result['items'][0]['id'], 42)
        self.assertEqual(result['items'][0]['token_type'], 'bearer')
        self.assertIsNone(result['nothing'])

    def test_rejects_unsafe_paths_before_authentication(self):
        for path in ('https://api.intra.42.fr/v2/campus/69', 'https://evil.invalid/',
                     '//evil.invalid/v2/users', '@evil.invalid/v2/users', '/oauth/token',
                     '/v2/campus/69#fragment', '/v2/users\r\nInjected: header',
                     '/v2/users?name=a b', '/v2/users\x00', '/v2/' + 'x' * 8192):
            with patch.object(api_get, 'Client') as constructor, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    api_get.main([path])
                self.assertEqual(error.exception.code, 2)
                constructor.assert_not_called()

    def test_passes_query_unchanged_and_prints_redacted_json(self):
        path = '/v2/scale_teams?filter[campus_id]=69&sort=-begin_at&page[size]=5'
        client = Mock()
        client._get.return_value = [{'id': 42, 'corrector': {'login': 'fixture-user'}, 'token': 'private-fixture'}]
        output = io.StringIO()
        with patch.object(api_get, 'Client', return_value=client), redirect_stdout(output):
            self.assertEqual(api_get.main([path]), 0)
        client._get.assert_called_once_with(path)
        result = json.loads(output.getvalue())
        self.assertEqual(result[0]['id'], 42)
        self.assertEqual(result[0]['token'], '[REDACTED]')
        self.assertEqual(result[0]['corrector']['login'], 'fixture-user')
        self.assertNotIn('private-fixture', output.getvalue())

    def test_active_token_is_hidden_even_in_an_unexpected_field(self):
        client = Mock(token='private-active-token')
        client._get.return_value = {'message': 'Bearer private-active-token'}
        output = io.StringIO()
        with patch.object(api_get, 'Client', return_value=client), redirect_stdout(output):
            self.assertEqual(api_get.main(['/v2/campus/69']), 0)
        self.assertEqual(json.loads(output.getvalue()), {'message': 'Bearer [REDACTED]'})
        self.assertNotIn('private-active-token', output.getvalue())

    def test_request_failure_is_not_empty_success(self):
        client = Mock()
        client._get.side_effect = Failure('rate-limit', 75, 429)
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(api_get, 'Client', return_value=client), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(api_get.main(['/v2/campus/69']), 1)
        self.assertEqual(output.getvalue(), '')
        self.assertIn('429', errors.getvalue())
        self.assertIn('75', errors.getvalue())

    def test_unexpected_error_does_not_leak_details(self):
        client = Mock()
        client._get.side_effect = RuntimeError('private-fixture-credential')
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(api_get, 'Client', return_value=client), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(api_get.main(['/v2/campus/69']), 1)
        self.assertEqual(output.getvalue(), '')
        self.assertIn('RuntimeError', errors.getvalue())
        self.assertNotIn('private-fixture-credential', errors.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
