#!/usr/bin/env python3
"""
Lightweight standalone token refresher for Pingoose GNOME Extension.
Uses standard Python library (no external dependencies required).
Refreshes OIDC Bearer JWT access_token using refresh_token.
"""

import os
import sys
import json
import urllib.parse
import urllib.request
from pathlib import Path

AUTH_TOKEN_URL = "https://auth.42.fr/auth/realms/students-42/protocol/openid-connect/token"
CLIENT_ID = "frontend-react"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"


def find_session_file() -> Path:
    candidates = [
        Path.home() / ".local/state/pingoose/session.json",
        Path(__file__).parent / "session.json",
        Path.home() / "hack42/session.json",
        Path.home() / ".local/share/pingoose/session.json",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


def refresh_token(session_path: Path) -> str:
    if not session_path.exists():
        sys.exit(1)

    with open(session_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    token_data = data.get("token_data", {})
    rf = token_data.get("refresh_token")
    if not rf:
        sys.exit(1)

    payload = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "refresh_token": rf,
    }).encode("utf-8")

    req = urllib.request.Request(
        AUTH_TOKEN_URL,
        data=payload,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://profile-v3.intra.42.fr",
            "Referer": "https://profile-v3.intra.42.fr/",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            new_acc = res.get("access_token")
            new_rf = res.get("refresh_token")

            if new_acc:
                data["access_token"] = new_acc
                if new_rf:
                    data["token_data"]["refresh_token"] = new_rf
                data["token_data"]["expires_in"] = res.get("expires_in", 300)

                # Persist updated tokens
                try:
                    session_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(session_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                except Exception:
                    pass

                return new_acc
    except Exception:
        sys.exit(1)

    sys.exit(1)


def main():
    session_file = find_session_file()
    token = refresh_token(session_file)
    print(token)


if __name__ == "__main__":
    main()
