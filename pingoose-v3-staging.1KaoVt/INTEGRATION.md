# Pingoose v3 — isolated build, not installed

Prepared on 2026-10-16. This directory is an isolated source/build copy, **not** the active `/home/sanghul2/pingoose` project or the installed extension.

## Why integration is paused

Separate work continued changing diagnostic files in `/home/sanghul2/pingoose`, including `intrapy_check.js` at 16:50 KST. Runtime files still matched the saved starting versions, but there is no exclusive source-directory integration window. Do not overwrite that work or copy this entire directory over the source project.

## Intended integration after the owner confirms exclusive access

- New runtime: `webview.js`, `evaluations.js`.
- New regression test: `test-evaluations.js`.
- Changed runtime/config: `extension.js`, `metadata.json`, `install.sh`.
- Changed tests: `test-flash.js`, additions to `check.sh` and its package allowlist.
- Merge the new README runtime sections while preserving any newer diagnostic documentation.
- Keep existing `api.py`, `api_get.py`, `campus_evaluations.py`, `intra_evaluations.py`, `intrapy_check.js`, `intrapy_probe.js`, `test-intrapy.js`, diagnostic tests, and `API-FINDINGS.md` untouched. This copy may not contain their newest versions.
- Never copy credentials, tokens or browser profiles into the project or extension. Existing credentials and both old detection state/profile data must remain intact.

Then run the source project's full `./check.sh` before `./install.sh`. Installation must not restart Shell or log the user out automatically.

## Evidence

- Actual Intra frontend calls `https://intrapy.intra.42.fr/api/v1/users/me/scale_teams`; the old public v2 route was not this data source.
- A private WebKit session supplied its normal request authorization; issuer and OS-login account selection matched `sanghul2`.
- A hidden runtime helper completed two authenticated snapshots about **11.42 seconds apart**, both empty. It used a **temporary state directory**, not the real detection baseline.
- The same live check verified private state permissions, rejection of a second helper, the test command, and clean EOF termination. It sent no desktop alerts and did not change bookings.
- This isolated final build passed `./check.sh`: 48 Python tests, JavaScript validation/dedup/UI tests, native ephemeral WebKit/storage checks, native temporary GSettings checks, and actual ZIP allowlist inspection.
- Distribution artifact: `artifacts/pingoose@local.shell-extension.zip`.
- ZIP SHA-256: `d18e70b67359db3f63dc386f1edfa61cd1791c551c658930735d3c0524acb94e`.

## Not verified

No nonempty real pending-booking response was available. Actual new reservation → live GNOME card/banner/flash and natural token-expiry recovery remain unverified. This is a private-service prototype, not an official third-party OAuth integration or a shared campus polling server.
