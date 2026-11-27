## ADDED Requirements

### Requirement: Per-World session cookies and login return
World's session cookie name SHALL carry a short, stable, non-secret digest of its session signing
secret, so Worlds on one host keep separate sessions whatever ports they use, and a World keeps
its session across restarts and port changes. The cookie SHALL stay HttpOnly, SameSite=Lax, Secure
under TLS, and keep the session lifetime. A World SHALL accept a session only under its own name
or, once, under the legacy shared name when it signed that session, and SHALL move a legacy session
to its own name with the same token. Logout SHALL clear every cookie a later request could be
admitted with.

Per-World cookie names stop Worlds on one host from clobbering each other's sessions by accident.
They are not isolation against a hostile service on another port of the same host: cookies are not
scoped by port, so such a service can read and set every World cookie on that host. Isolation from
it needs a separate hostname per World.

A World SHALL record in its cookie the hour it last set it and set it again on the first page load
of an hour. Whenever it sets its cookie, it SHALL clear other World cookies that can sign nobody
in (expired or not a World session), and, when more than 48 live ones remain, the least recently
set of them down to 48, so a host's cookies stay below request header limits. It SHALL NOT clear
a live World's cookie while 48 or fewer remain.

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
- **WHEN** a browser logs in to World A, then to 24 previews with their own secrets on the same
  host, then to World B
- **THEN** A and B are both still logged in

#### Scenario: Cookie bound
- **WHEN** a browser holding more than 48 other live World cookies, or any expired one, logs in to
  a World
- **THEN** the expired ones and the least recently set live ones beyond 48 are cleared

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
