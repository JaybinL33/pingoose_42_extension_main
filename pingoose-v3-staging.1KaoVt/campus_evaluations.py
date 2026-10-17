#!/usr/bin/env python3
"""Read recent campus evaluations once, without changing notification state."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import pwd
import re
import sys
import urllib.parse

from api import Client, Failure, positive_id


def timestamp(value):
    if value is None:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Missing timezone')
        return parsed.astimezone().isoformat(timespec='seconds')
    except (AttributeError, TypeError, ValueError, OverflowError, OSError):
        raise Failure('response-error') from None


def participant_login(user):
    value = user.get('login') if isinstance(user, dict) else None
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value) else None


def recent_evaluations(client, limit):
    user = client._get('/v2/users/' + urllib.parse.quote(client.login, safe=''))
    if (not isinstance(user, dict) or user.get('login') != client.login or
            not positive_id(user.get('id')) or not isinstance(user.get('campus_users'), list)):
        raise Failure('account-error')
    campuses = [item.get('campus_id') for item in user['campus_users']
                if isinstance(item, dict) and item.get('is_primary') is True]
    if len(campuses) != 1 or not positive_id(campuses[0]):
        raise Failure('account-error')
    campus_id = campuses[0]
    query = urllib.parse.urlencode({
        'filter[campus_id]': campus_id, 'sort': '-begin_at', 'page[size]': limit, 'page[number]': 1})
    rows = client._get('/v2/scale_teams?' + query)
    if not isinstance(rows, list) or len(rows) > limit:
        raise Failure('response-error')
    items = []
    for row in rows:
        if not isinstance(row, dict) or not positive_id(row.get('id')) or row.get('begin_at') is None:
            raise Failure('response-error')
        corrector = row.get('corrector')
        correcteds = row.get('correcteds')
        team = row.get('team')
        corrector_id = corrector.get('id') if isinstance(corrector, dict) else None
        project_id = team.get('project_id') if isinstance(team, dict) else None
        # Only requested login names and metadata, not emails, comments, marks or tokens.
        items.append({
            'id': row['id'],
            'corrector': participant_login(corrector),
            'correcteds': [participant_login(user) for user in correcteds] if isinstance(correcteds, list) else None,
            'begin_at': timestamp(row['begin_at']),
            'created_at': timestamp(row.get('created_at')),
            'filled_at': timestamp(row.get('filled_at')),
            'project_id': project_id if positive_id(project_id) else None,
            'corrector_id': corrector_id if positive_id(corrector_id) else None,
        })
    return {'campus_id': campus_id,
            'checked_at': dt.datetime.now().astimezone().isoformat(timespec='seconds'),
            'count': len(items), 'evaluations': items}


def main(argv=None):
    parser = argparse.ArgumentParser(description='현재 계정의 주 캠퍼스에서 최근 평가를 한 번 조회합니다.')
    parser.add_argument('--limit', type=int, default=10, metavar='N', help='조회 건수 1~100 (기본 10)')
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 100:
        parser.error('--limit은 1~100이어야 합니다.')
    config = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'pingoose'
    try:
        client = Client(config, pwd.getpwuid(os.getuid()).pw_name)
        result = recent_evaluations(client, args.limit)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Failure as error:
        message = f'조회 실패: {error.state}'
        if error.status is not None:
            message += f' (HTTP {error.status})'
        if error.retry_after:
            message += f' · 최소 {error.retry_after}초 후 다시 실행하세요.'
        print(message, file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0
    except Exception as error:
        # Do not expose credential-bearing exception messages or raw API responses.
        print(f'조회 실패: {type(error).__name__} (상세 내용은 출력하지 않습니다.)', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
