## ADDED Requirements

### Requirement: Per-World session cookies and login return
World's session cookie name SHALL carry the port the browser used to reach it (the scheme's
default when the address has none), so Worlds on different ports of one host keep separate
sessions and a browser holds at most one World session cookie per port. The cookie SHALL stay
HttpOnly, SameSite=Lax, Secure under TLS, and keep the session lifetime. A World SHALL also accept
a valid session it signed under another World cookie name, including the legacy shared name, and
SHALL move it to the current name with the same token; logout SHALL clear every such cookie.

An unauthenticated page load SHALL redirect to the login page with its same-origin path and query
as a relative return path, and a successful login SHALL land there. A return path SHALL start with
one `/`, contain no backslash or control character, resolve to the same origin, never be the
login page, and never carry a `token` parameter; anything else SHALL land on `/`.

#### Scenario: Two Worlds on one host
- **WHEN** a browser logs in to two Worlds with different signing secrets on different ports of
  one host
- **THEN** both stay logged in, and logging out of one leaves the other's session

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
