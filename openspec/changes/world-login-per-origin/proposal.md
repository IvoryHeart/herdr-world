## Why

Issue #1250: every World used one session cookie name, and browsers share cookies across the
ports of a host. Logging in to one World (or one preview) logged the browser out of the others on
that host, and the login redirect dropped the address, so testing switches such as
`/town?focusTest=1` were lost.

## What Changes

- Name the session cookie per World (`herdr_world_auth_<digest of the signing secret>`), keeping
  HttpOnly, SameSite=Lax, Secure under TLS and the 30-day lifetime. A World also accepts its own
  valid session under the legacy shared name once and moves it with the same token. Logout clears
  both. Each World stamps its cookie with the day it last set it and, when it sets its cookie,
  keeps at most 24 other World cookies, least recently seen go first.
- Carry the page's same-origin path and query through login as a validated `next`, never with a
  `token` parameter and never to another origin.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-access`: per-World session cookies and login return paths.

## Impact

`server/src/http/auth.ts`, the login page, the listener's redirect and cookie refresh, auth tests and
the storage catalog's browser cookie entry. CSP, admission, origin policy and the session secret
are unchanged.
