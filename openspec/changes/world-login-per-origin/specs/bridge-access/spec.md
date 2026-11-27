## ADDED Requirements

### Requirement: Session cookie name per World
World's session cookie name SHALL carry a short, stable, non-secret digest of its session signing
secret, so Worlds on one host keep separate sessions whatever ports they use. The cookie SHALL stay
HttpOnly, SameSite=Lax, Secure under TLS, and keep the session lifetime. Per-World names stop
accidental clobbering only; isolation from a hostile service on another port of the same host
needs a separate hostname per World.

#### Scenario: Two Worlds on one host
- **WHEN** a browser logs in to two Worlds with different signing secrets on different ports of
  one host
- **THEN** both stay logged in, and logging out of one leaves the other's session

#### Scenario: Worlds swap ports
- **WHEN** two logged-in Worlds restart with their own signing secrets on each other's ports
- **THEN** both stay logged in

#### Scenario: Another port of the same host
- **WHEN** another service runs on a different port of the same host
- **THEN** it can still read and set every World cookie on that host, because cookies are not
  scoped by port

### Requirement: Legacy session move and full logout
A World SHALL accept a session only under its own cookie name or, once, under the legacy shared
name when it signed that session, and SHALL move a legacy session to its own name with the same
token. Logout SHALL clear every cookie a later request could be admitted with.

#### Scenario: Legacy session
- **WHEN** a browser presents a valid session this World signed under the legacy shared name
- **THEN** the page load is admitted once and the session moves to the current name

#### Scenario: Logout
- **WHEN** a browser logs out of a World it reached through many ports
- **THEN** no cookie the browser still holds admits it to that World

### Requirement: Bounded other-World cookies
A World SHALL record in its cookie the hour it last set it and set it again on the first page load
of an hour. Whenever it sets its cookie, it SHALL clear other World cookies that can sign nobody
in, and the least recently set live ones beyond 48, so a host's cookies stay below request header
limits. It SHALL NOT clear a live World's cookie while 48 or fewer remain.

#### Scenario: Many previews
- **WHEN** a browser logs in to World A, then to 24 previews with their own secrets on the same
  host, then to World B
- **THEN** A and B are both still logged in

#### Scenario: Cookie bound
- **WHEN** a browser holding more than 48 other live World cookies, or any expired or unreadable
  one, logs in to a World
- **THEN** the expired and unreadable ones and the least recently set live ones beyond 48 are
  cleared

### Requirement: Login returns to the opened address
An unauthenticated page load SHALL redirect to the login page with its same-origin path and query
as a relative return path, and a successful login SHALL land there. A return path SHALL never
carry a `token` parameter, and any return path that is not a safe same-origin path SHALL land on
`/`.

#### Scenario: Login keeps testing switches
- **WHEN** an unauthenticated browser opens `/town?focusTest=1` and logs in
- **THEN** it lands on `/town?focusTest=1`, keeping the address's fragment

#### Scenario: Safe return path
- **WHEN** a return path starts with one `/`, contains no backslash or control character, resolves
  to the same origin and is not the login page
- **THEN** login lands on it

#### Scenario: Open redirect refused
- **WHEN** a return path names another origin, starts with `//`, contains a backslash or control
  character, or normalises to `//`
- **THEN** login lands on `/`

#### Scenario: Login page and token not carried
- **WHEN** a return path is the login page, or carries a `token` parameter
- **THEN** login lands on `/` for the login page, and on the path without its `token` parameter
  otherwise
