#!/usr/bin/env python3
"""42 API worker. JSON lines on stdout; test/quit commands on stdin."""
import datetime as dt
import email.utils
import http.client
import json
import math
import os
from pathlib import Path
import pwd
import select
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.intra.42.fr'
POLL_SECONDS = 10
MAX_SEEN = 2000


class Failure(Exception):
    def __init__(self, state, retry_after=0, status=None):
        super().__init__(state)  # Never include response bodies or credentials in errors.
        self.state = state
        self.retry_after = retry_after
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Do not forward credentials, even if the API redirects.


def retry_after(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            seconds = email.utils.parsedate_to_datetime(value).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            return 0
    return math.ceil(seconds) if math.isfinite(seconds) and seconds > 0 else 0


def positive_id(value):
    return type(value) is int and 0 < value < 2**63


def private_text(path, limit):
    with path.open(encoding='utf-8') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                info.st_mode & 0o077 or info.st_size > limit):
            raise ValueError('Private file required')
        return stream.read(limit + 1)


class Client:
    def __init__(self, credentials, login):
        self.credentials = credentials
        self.login = login
        self.user_id = None
        self.token = None
        self.expires = 0
        self.last_request = -math.inf
        self.opener = urllib.request.build_opener(NoRedirect())

    def _http(self, path, token=None, form=None):
        headers = {'Accept': 'application/json', 'User-Agent': 'Pingoose/2'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        body = None
        if form is not None:
            body = urllib.parse.urlencode(form).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        request = urllib.request.Request(API + path, data=body, headers=headers)
        time.sleep(max(0, 0.6 - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        try:
            with self.opener.open(request, timeout=15) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise Failure('response-error')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                self.token = None
            state = {401: 'auth-error', 403: 'permission-error', 429: 'rate-limit'}.get(
                error.code, 'api-error')
            delay = retry_after(error.headers.get('Retry-After'))
            error.close()
            raise Failure(state, delay, error.code) from None
        except (urllib.error.URLError, OSError, http.client.HTTPException):
            raise Failure('network-error') from None
        except (ValueError, UnicodeError):
            raise Failure('response-error') from None

    def _get(self, path):
        if self.token is None or time.monotonic() >= self.expires:
            try:
                uid = private_text(self.credentials / 'uid', 4096).strip()
                secret = private_text(self.credentials / 'secret', 4096).strip()
                if any(not value or any(char.isspace() for char in value) for value in (uid, secret)):
                    raise ValueError('Invalid credential file')
            except (OSError, ValueError):
                raise Failure('credentials-error') from None
            token = self._http('/oauth/token', form={
                'grant_type': 'client_credentials', 'client_id': uid, 'client_secret': secret})
            if (not isinstance(token, dict) or not isinstance(token.get('access_token'), str) or
                    not token['access_token'] or not isinstance(token.get('token_type'), str) or
                    token['token_type'].lower() != 'bearer' or
                    type(token.get('expires_in')) not in (int, float) or
                    not math.isfinite(token['expires_in']) or token['expires_in'] <= 0):
                raise Failure('response-error')
            self.token = token['access_token']
            self.expires = time.monotonic() + max(0, token['expires_in'] - 60)
        return self._http(path, token=self.token)

    def upcoming(self):
        if self.user_id is None:
            user = self._get('/v2/users/' + urllib.parse.quote(self.login, safe=''))
            if (not isinstance(user, dict) or user.get('login') != self.login or
                    not positive_id(user.get('id'))):
                raise Failure('account-error')
            self.user_id = user['id']
        rows = {}
        # A capped, complete snapshot: never commit a partial/failed pagination result.
        for page in range(1, 21):
            query = urllib.parse.urlencode({
                'filter[future]': 'true', 'sort': 'id', 'page[size]': 100, 'page[number]': page})
            batch = self._get(f'/v2/users/{self.user_id}/scale_teams/as_corrector?{query}')
            if not isinstance(batch, list) or len(batch) > 100:
                raise Failure('response-error')
            for row in batch:
                if not isinstance(row, dict) or not positive_id(row.get('id')):
                    raise Failure('response-error')
                try:
                    start = dt.datetime.fromisoformat(row['begin_at'].replace('Z', '+00:00'))
                    if start.tzinfo is None:
                        raise ValueError('Timezone missing')
                    start.astimezone()
                except (KeyError, TypeError, AttributeError, ValueError, OverflowError, OSError):
                    raise Failure('response-error') from None
                rows[row['id']] = row
            if len(batch) < 100:
                return list(rows.values())
        raise Failure('response-error')


class Seen:
    def __init__(self, path, user_id):
        self.path = path
        self.user_id = user_id
        self.ids = None
        try:
            saved = json.loads(private_text(path, 100_000))
            if (not isinstance(saved, dict) or not positive_id(saved.get('user_id')) or
                    not isinstance(saved.get('ids'), list) or len(saved['ids']) > MAX_SEEN or
                    not all(positive_id(value) for value in saved['ids'])):
                raise ValueError('Invalid state')
            if saved['user_id'] == user_id:
                self.ids = saved['ids']
        except FileNotFoundError:
            pass
        except (OSError, ValueError):
            raise Failure('storage-error') from None

    def update(self, rows):
        current = {row['id'] for row in rows}
        previous = set(self.ids or [])
        added = [] if self.ids is None else [row for row in rows if row['id'] not in previous]
        ids = ([value for value in (self.ids or []) if value not in current] +
               list(dict.fromkeys(row['id'] for row in rows)))[-MAX_SEEN:]
        if ids != self.ids:
            temporary = None
            try:
                self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                self.path.parent.chmod(0o700)
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                                 dir=self.path.parent, delete=False) as stream:
                    temporary = stream.name
                    json.dump({'user_id': self.user_id, 'ids': ids}, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
            except OSError:
                raise Failure('storage-error') from None
            finally:
                if temporary and os.path.exists(temporary):
                    os.unlink(temporary)
            # shortcut: a crash before delivery can lose an alert; add acknowledgements for durable delivery.
            self.ids = ids
        return added


def notification(row):
    def text(value):
        return ''.join(char for char in value if char.isprintable())[:120] if isinstance(value, str) else ''

    start = dt.datetime.fromisoformat(row['begin_at'].replace('Z', '+00:00')).astimezone()
    lines = ['새 평가가 예약됐어요.', '시작: ' + start.strftime('%m/%d %H:%M %Z')]
    scale = row.get('scale')
    if isinstance(scale, dict) and text(scale.get('name')):
        lines.append('평가: ' + text(scale['name']))
    lines.append(f"평가 ID: {row['id']}")
    return {'type': 'notification', 'id': f"scale-team:{row['id']}", 'body': '\n'.join(lines)}


def emit(message):
    print(json.dumps(message), flush=True)


def run(client, state_path):
    seen = None
    deadline = 0
    failures = 0
    commands = b''
    emit({'type': 'status', 'state': 'loading'})
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], min(60, max(0, deadline - time.monotonic())))
        if ready:
            chunk = os.read(sys.stdin.fileno(), 4096)
            if not chunk:
                return
            commands += chunk
            if len(commands) > 8192:
                return
            while b'\n' in commands:
                command, commands = commands.split(b'\n', 1)
                if command == b'quit':
                    return
                if command == b'test':
                    emit({'type': 'notification', 'id': f'demo:{time.monotonic_ns()}', 'test': True,
                          'body': '테스트 알림 · 실제 평가 예약이 아닙니다. API 보조 프로세스 → GNOME 연결 확인.'})
        if time.monotonic() < deadline:
            continue
        try:
            rows = client.upcoming()
            if seen is None:
                seen = Seen(state_path, client.user_id)
            for row in seen.update(rows):
                emit(notification(row))
            emit({'type': 'status', 'state': 'watching', 'count': len(rows), 'login': client.login})
            failures = 0
            delay = POLL_SECONDS
        except Failure as error:
            failures += 1
            delay = max(min(300, POLL_SECONDS * 2**min(failures, 5)), error.retry_after)
            emit({'type': 'status', 'state': error.state, 'retryAfter': delay, 'httpStatus': error.status})
        deadline = time.monotonic() + delay


def main():
    os.umask(0o077)
    config = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'pingoose'
    state = Path(os.environ.get('XDG_STATE_HOME') or Path.home() / '.local/state') / 'pingoose'
    client = Client(config, pwd.getpwuid(os.getuid()).pw_name)
    run(client, state / 'evaluations.json')


if __name__ == '__main__':
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    except Exception as error:
        emit({'type': 'status', 'state': 'worker-error'})
        print('Pingoose worker stopped: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
