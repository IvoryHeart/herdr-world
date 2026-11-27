## ADDED Requirements

### Requirement: Per-World session cookies and login return
World's session cookie name SHALL carry a short, stable, non-secret digest of its session signing
secret, so Worlds on one host keep separate sessions whatever ports they use, and a World keeps
its session across restarts and port changes. The cookie SHALL stay HttpOnly, SameSite=Lax, Secure
under TLS, and keep the session lifetime. A World SHALL accept a session only under its own name
or, once, under the legacy shared name when it signed that session, and SHALL move a legacy session
to its own name with the same token. Logout SHALL clear every cookie a later request could be
admitted with.

A World SHALL record in its cookie the day it last set it and set it again on the first page load
of a day. Whenever it sets its cookie and the request carries more than 24 other World cookies, it
SHALL clear the least recently seen of them down to 24, so a host's cookies stay below request
header limits.

An unauthenticated page load SHALL redirect to the login page with its same-origin path and query
as a relative return path, and a successful login SHALL land there. A return path SHALL start with
one `/`, contain no backslash or control character, resolve to the same origin, never be the
login page, and never carry a `token` parameter; anything else SHALL land on `/`.

#### Scenario: Two Worlds on one host
- **WHEN** a browser logs in to two Worlds with different signing secrets on different ports of
  one host
- **THEN** both stay logged in, and logging out of one leaves the other's session

#### Scenario: Worlds swap ports
- **WHEN** two logged-in Worlds restart with their own signing secrets on each other's ports
- **THEN** both stay logged in

#### Scenario: Logout
- **WHEN** a browser logs out of a World it reached through many ports
- **THEN** no cookie the browser still holds admits it to that World

#### Scenario: Many previews
- **WHEN** a browser holding more than 24 other World cookies logs in to a World
- **THEN** the least recently seen of them are cleared down to 24

#### Scenario: Legacy session
- **WHEN** a browser presents a valid session this World signed under the legacy shared name
- **THEN** the page load is admitted once and the session moves to the current name

#### Scenario: Login keeps testing switches
- **WHEN** an unauthenticated browser opens `/town?focusTest=1` and logs in
- **THEN** it lands on `/town?focusTest=1`, keeping the address's fragment

#### Scenario: Open redirect refused
- **WHEN** a return path names another origin, starts with `//`, contains a backslash or control
  character, or normalises to `//`
- **THEN** login lands on `/`
