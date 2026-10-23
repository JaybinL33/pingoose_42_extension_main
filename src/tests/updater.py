import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('updater', Path(__file__).parents[1] / 'worker/updater.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
CONFIG = {'repository': 'https://github.com/Pingoose-42/pingoose_42_extension', 'branch': 'main'}
A, B = 'a' * 40, 'b' * 40


class Updates(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'state.json'
        self.state = {'source': CONFIG, 'installed': {'sha': A}, 'baseline': {'sha': A}}
        self.sha = A
        self.comparison = 'ahead'
        self.requests = []

    def api(self, config, route):
        self.requests.append(route)
        if route.startswith('compare/'):
            return {'status': self.comparison}
        return {'sha': self.sha, 'commit': {'message': 'Update\nDetails', 'committer': {'date': '2026-10-21T00:00:00Z'}}}

    def check(self, login):
        return updater.check(CONFIG, self.state, self.path, login, self.api)

    def available(self):
        self.assertEqual(self.check('session1')['status'], 'current')
        self.sha = B
        self.assertEqual(self.check('session2')['status'], 'available')

    def test_once_per_session_and_decline_keeps_baseline(self):
        self.available()
        self.assertEqual(self.check('session2')['status'], 'skipped')
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(self.state['baseline']['sha'], A)
        self.assertEqual(self.check('session3')['status'], 'available')

    def test_manual_check_bypasses_session_limit(self):
        self.check('session1')
        self.sha = B
        self.assertEqual(self.check('session1')['status'], 'skipped')
        result = updater.check(CONFIG, self.state, self.path, 'session1', self.api, force=True)
        self.assertEqual(result['status'], 'available')

    def test_rewind_or_identical_is_not_a_newer_commit(self):
        self.check('session1')
        self.sha = B
        for index, status in enumerate(['behind', 'identical']):
            self.comparison = status
            self.assertEqual(self.check(str(index))['status'], 'current')

    def test_network_failure_does_not_advance_baseline(self):
        self.check('session1')
        with self.assertRaises(OSError):
            updater.check(CONFIG, self.state, self.path, 'session2', lambda *_: (_ for _ in ()).throw(OSError()))
        self.assertEqual(self.state['baseline']['sha'], A)
        self.assertEqual(self.check('session2')['status'], 'skipped')

    def test_installs_exact_approved_commit_and_cleans_checkout(self):
        self.available()
        calls = []
        def run(args, cwd=None, timeout=None):
            calls.append(args)
            if args[1] == 'clone':
                (Path(args[-1]) / 'install.sh').write_text('# fixture')
        result = updater.install(CONFIG, self.state, self.path, B, run)
        self.assertEqual(result['status'], 'installed')
        self.assertEqual(calls[1][-2:], ['--detach', B])
        self.assertEqual(calls[2], ['bash', './install.sh'])
        self.assertEqual(self.state['baseline']['sha'], B)
        self.assertFalse(list(self.path.parent.glob('checkout-*')))

    def test_failed_install_does_not_advance_and_cleans_checkout(self):
        self.available()
        def run(args, **kwargs):
            if args[1] == 'clone':
                (Path(args[-1]) / 'install.sh').write_text('# fixture')
            if args[0] == 'bash':
                raise updater.UpdateError('fixture failed')
        with self.assertRaises(updater.UpdateError):
            updater.install(CONFIG, self.state, self.path, B, run)
        self.assertEqual(self.state['baseline']['sha'], A)
        self.assertFalse(list(self.path.parent.glob('checkout-*')))

    def test_rejects_changed_source_or_unapproved_commit(self):
        self.available()
        for config, sha in [(CONFIG, A), ({**CONFIG, 'branch': 'other'}, B)]:
            with self.assertRaises(updater.UpdateError):
                updater.install(config, self.state, self.path, sha, lambda *_: self.fail('must not execute'))

    def test_repository_change_offers_configured_branch(self):
        self.available()
        result = updater.check({**CONFIG, 'branch': 'next'}, self.state, self.path, 'session3', self.api)
        self.assertEqual(result['status'], 'available')
        self.assertEqual(self.state['candidate']['sha'], B)

    def test_legacy_remote_baseline_does_not_hide_update(self):
        self.state = {'source': CONFIG, 'baseline': {'sha': B}}
        self.sha = B
        self.assertEqual(self.check('session1')['status'], 'available')

    def test_install_receipt_overrides_stale_state(self):
        self.sha = B
        result = updater.check(CONFIG, self.state, self.path, 'session1', self.api,
                               installed={'source': CONFIG, 'sha': B})
        self.assertEqual(result['status'], 'current')
        self.assertEqual(self.requests, ['commits/main'])

    def test_first_check_compares_actual_install(self):
        self.state = {}
        self.sha = B
        result = updater.check(CONFIG, self.state, self.path, 'session1', self.api,
                               installed={'source': CONFIG, 'sha': A})
        self.assertEqual(result['status'], 'available')
        self.assertIn(f'compare/{A}...{B}', self.requests)

    def test_diverged_branch_offers_update(self):
        self.sha = B
        self.comparison = 'diverged'
        self.assertEqual(self.check('session1')['status'], 'available')

    def test_real_local_clone_installs_pinned_revision(self):
        repo = self.path.parent / 'fixture-repository'
        repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.DEVNULL).strip()
        git('init', '-b', 'main')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.invalid')
        script = repo / 'install.sh'
        script.write_text('printf approved > ../installed-fixture\n')
        git('add', 'install.sh'); git('commit', '-m', 'approved')
        approved = git('rev-parse', 'HEAD')
        script.write_text('printf unapproved > ../installed-fixture\n')
        git('add', 'install.sh'); git('commit', '-m', 'later')
        self.state = {'source': CONFIG, 'baseline': {'sha': A}, 'candidate': {'sha': approved}}
        def local_run(args, **kwargs):
            args = list(args)
            if args[1] == 'clone':
                args[-2] = str(repo)
            updater.run_command(args, **kwargs)
        updater.install(CONFIG, self.state, self.path, approved, local_run)
        self.assertEqual((self.path.parent / 'installed-fixture').read_text(), 'approved')
        self.assertFalse(list(self.path.parent.glob('checkout-*')))

    def test_config_override(self):
        root = self.path.parent
        (root / 'config').mkdir()
        (root / 'config/update.json').write_text(json.dumps(CONFIG))
        with patch.dict('os.environ', {'XDG_CONFIG_HOME': str(root / 'user')}):
            self.assertEqual(updater.configuration(root), CONFIG)
            target = root / 'user/pingoose/update.json'
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps({**CONFIG, 'branch': 'stable'}))
            self.assertEqual(updater.configuration(root)['branch'], 'stable')
            target.write_text(json.dumps({**CONFIG, 'repository': 'https://other.example/repo'}))
            with self.assertRaises(updater.UpdateError):
                updater.configuration(root)


if __name__ == '__main__':
    unittest.main()
