#!/usr/bin/env python3
"""GET a 42 API v2 path using the existing private application credentials."""
import argparse
import json
import os
from pathlib import Path
import pwd
import sys

from api import Client, Failure


SECRET_FIELDS = {'uid', 'clientid', 'authorization', 'authorizationcode', 'apikey', 'privatekey', 'jwt'}


def redact(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            name = key.lower().replace('_', '').replace('-', '')
            sensitive = (name in SECRET_FIELDS or name.endswith(('token', 'tokens')) or
                         'secret' in name or 'password' in name)
            result[key] = '[REDACTED]' if sensitive else redact(item)
        return result
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description='42 API v2 GET 조회. 기존 개인 설정의 앱 키를 사용합니다.')
    parser.add_argument('path', help="/v2/로 시작하는 경로와 쿼리. 전체를 따옴표로 감싸세요.")
    args = parser.parse_args(argv)
    # Client concatenates its fixed HTTPS origin and this path; never accept an external URL.
    if (not args.path.startswith('/v2/') or len(args.path) > 8192 or '#' in args.path or
            any(not char.isprintable() or char.isspace() for char in args.path)):
        parser.error('전체 URL 대신 /v2/로 시작하는 경로를 사용하세요. 공백·제어 문자·#은 URL 인코딩해야 합니다.')
    config = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'pingoose'
    try:
        client = Client(config, pwd.getpwuid(os.getuid()).pw_name)
        data = client._get(args.path)
        output = json.dumps(redact(data), ensure_ascii=False, indent=2)
        if isinstance(client.token, str) and client.token:
            output = output.replace(client.token, '[REDACTED]')
        print(output)
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
        print(f'조회 실패: {type(error).__name__} (상세 내용은 출력하지 않습니다.)', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
