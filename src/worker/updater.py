#!/usr/bin/env python3
"""One check per desktop login; install only the commit approved by the user."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request


class UpdateError(Exception):
    pass


def load_json(path, default=None):
    try:
        with path.open() as stream:
            return json.load(stream)
    except FileNotFoundError:
        return default


def save_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.update-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def configuration(root):
    override = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'pingoose/update.json'
    config = load_json(override, load_json(root / 'config/update.json'))
    repository = config.get('repository', '').rstrip('/').removesuffix('.git')
    if not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise UpdateError('Update repository must be an HTTPS GitHub repository URL.')
    branch = config.get('branch', 'main')
    if not isinstance(branch, str) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}', branch) or '..' in branch or branch.endswith('/'):
        raise UpdateError('Invalid update branch.')
    return {'repository': repository, 'branch': branch}


def session_key():
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    session = os.environ.get('XDG_SESSION_ID')
    if not session:
        # The helper inherits the Shell's login session, including across Shell restarts.
        try:
            from gi.repository import Gio, GLib
            bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
            session = bus.call_sync('org.freedesktop.login1', '/org/freedesktop/login1',
                'org.freedesktop.login1.Manager', 'GetSessionByPID',
                GLib.Variant('(u)', (os.getpid(),)), None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
        except Exception:
            try:
                # Some user-service processes belong to the user manager, not a session scope.
                user = bus.call_sync('org.freedesktop.login1', '/org/freedesktop/login1',
                    'org.freedesktop.login1.Manager', 'GetUser',
                    GLib.Variant('(u)', (os.getuid(),)), None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
                started = bus.call_sync('org.freedesktop.login1', user,
                    'org.freedesktop.DBus.Properties', 'Get',
                    GLib.Variant('(ss)', ('org.freedesktop.login1.User', 'TimestampMonotonic')),
                    None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
                session = f'user:{started}'
            except Exception as error:
                raise UpdateError('Could not identify the desktop login session.') from error
    return hashlib.sha256(f'{boot}:{session}'.encode()).hexdigest()


def github(config, route):
    repo = config['repository'].removeprefix('https://github.com/')
    request = urllib.request.Request(f'https://api.github.com/repos/{repo}/{route}', headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'Pingoose-Updater',
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read(1048577)
        if len(data) > 1048576:
            raise UpdateError('GitHub response is too large.')
        return json.loads(data)
    except urllib.error.HTTPError as error:
        raise UpdateError(f'GitHub update check failed (HTTP {error.code}).') from error
    except (OSError, ValueError) as error:
        raise UpdateError('Could not contact GitHub. The next login will try again.') from error


def check(config, state, path, login, api=github, force=False, installed=None):
    if not force and state.get('session') == login:
        return {'status': 'skipped'}
    state['session'] = login
    # Record the attempt before network I/O, so toggling the extension cannot repeat it.
    save_json(path, state)
    latest = api(config, 'commits/' + urllib.parse.quote(config['branch'], safe=''))
    sha = latest.get('sha', '')
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise UpdateError('GitHub returned an invalid commit.')
    commit = {'sha': sha, 'date': latest.get('commit', {}).get('committer', {}).get('date', ''),
              'message': latest.get('commit', {}).get('message', '').split('\n')[0][:180]}
    # A previously observed remote HEAD is not proof of an installed version.
    # Prefer the receipt shipped with the installation, including manual installs.
    if installed and installed.get('source') == config and re.fullmatch('[0-9a-f]{40}', installed.get('sha', '')):
        baseline = installed['sha']
    elif state.get('source') == config and state.get('installed'):
        baseline = state['installed']['sha']
    else:
        baseline = None
    if state.get('source') != config:
        state.pop('installed', None)
    state['source'] = dict(config)
    state['candidate'] = None
    changes = [commit]
    if baseline is None:
        state['candidate'] = commit
    elif sha != baseline:
        comparison = api(config, f'compare/{baseline}...{sha}')
        if comparison.get('status') in ('ahead', 'diverged'):
            state['candidate'] = commit
            commits = comparison.get('commits', [])
            if comparison.get('total_commits', len(commits)) > len(commits):
                commits = []
                page = 1
                while True:
                    batch = api(config, f'compare/{baseline}...{sha}?per_page=100&page={page}').get('commits', [])
                    commits.extend(batch)
                    if len(batch) < 100:
                        break
                    page += 1
            changes = [{'sha': item.get('sha', ''),
                        'message': item.get('commit', {}).get('message', '').split('\n')[0][:500]}
                       for item in commits] or [commit]
    if state['candidate']:
        state['candidate'] = {**commit, 'changes': changes}
    save_json(path, state)
    if state['candidate']:
        return {'status': 'available', 'commit': commit, **config}
    return {'status': 'current'}


def run_command(args, cwd=None, timeout=180):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    process = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired as error:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise UpdateError('Update command timed out. Please try again at the next login.') from error
    if process.returncode:
        raise UpdateError(f'{args[0]} failed. The update was not confirmed; restart only after a successful installation.')


def install(config, state, path, approved, run=run_command):
    candidate = state.get('candidate')
    if state.get('source') != config or not candidate or candidate.get('sha') != approved:
        raise UpdateError('The approved update no longer matches the configured repository.')
    if not re.fullmatch('[0-9a-f]{40}', approved):
        raise UpdateError('Invalid approved commit.')
    checkout = Path(tempfile.mkdtemp(prefix='checkout-', dir=path.parent))
    try:
        run(['git', 'clone', '--no-checkout', '--single-branch', '--branch', config['branch'],
             '--', config['repository'] + '.git', str(checkout)], timeout=180)
        # Never install a later commit that appeared after the Yes prompt.
        run(['git', '-C', str(checkout), 'checkout', '--detach', approved], timeout=120)
        if not (checkout / 'install.sh').is_file():
            raise UpdateError('This repository has no install.sh.')
        run(['bash', './install.sh'], cwd=str(checkout), timeout=300)
        state.update(baseline=candidate, installed=candidate, candidate=None)
        save_json(path, state)
        return {'status': 'installed', 'commit': candidate}
    finally:
        shutil.rmtree(checkout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['check', 'install'])
    parser.add_argument('--commit')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    directory = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'pingoose/updates'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / 'state.json'
    # Check and install share one lock, so concurrent Shell instances cannot race.
    with (directory / 'lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'busy'}
        config = configuration(root)
        state = load_json(path, {})
        if args.action == 'check':
            return check(config, state, path, session_key(), force=args.force,
                         installed=load_json(root / 'config/installed.json'))
        return install(config, state, path, args.commit)


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception as error:
        print(json.dumps({'status': 'error', 'error': str(error)[:300]}))
        raise SystemExit(1)
