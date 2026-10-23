### Added

- Show GitHub pull requests and Jira tickets beside your agents, built in and
  on by default. Board's new **Work** lens lays pull requests out from review
  through fixing, green and ready to merge to merged, and tickets by status;
  each card names the agents working on it. Town desks show the badge of their
  agent's pull request or ticket (`#123 ✓`). GitHub uses the service user's
  `gh` sign-in; Jira Cloud takes a site, email and API token in **Settings →
  Sources**, where each source can be switched off. The token stays in private
  service storage, never reaches the browser and is removed when the site or
  email changes.
