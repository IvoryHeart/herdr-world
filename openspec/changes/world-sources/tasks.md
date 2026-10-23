## 1. Service

- [x] 1.1 Add the GitHub source over one bounded `gh api graphql` request; verify role merging, lanes, malformed nodes, missing or signed-out `gh` and redacted failures with synthetic responses.
- [x] 1.2 Add the Jira Cloud source; verify site, email, token and JQL validation, Basic authentication, status-category lanes, assigned versus watched roles and rejected credentials or filters.
- [x] 1.3 Add private source credentials storage and the sources service with demand-driven, bounded refresh, settings in `settings.json` and HTTP routes; verify the token never reaches responses or settings.
- [x] 1.4 Link items to agent panes through reported pull requests and checkout branches on their own connection; verify repository matching, stale and unsupported hosts, SSH lookups, caching and lookup bounds.

## 2. Browser

- [x] 2.1 Decode the snapshot defensively and share one poll across views; add the Sources settings dialog and its settings menu entry.
- [x] 2.2 Add Board's Work lens; verify lanes, ticket grouping, external links and the jump to a linked agent in the Board browser fixture.
- [x] 2.3 Add Town desk badges on nameplates; verify a linked desk shows its badge and link in the Town browser fixture.
- [x] 2.4 Read every PR merged in a configurable window (default seven days) page by page, and group history columns by day; verify paging, its bounds and failure, the window setting and 150 merged PRs in the Board fixture.

## 3. Documentation

- [x] 3.1 Update README, FEATURES, the tutorial, deployment, security notes, the knowledge map and the changelog.
