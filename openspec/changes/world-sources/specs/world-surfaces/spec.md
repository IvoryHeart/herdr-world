## ADDED Requirements

### Requirement: Built-in sources

World SHALL include built-in sources for GitHub and Jira Cloud, each enabled
by default and switchable in World settings. The service SHALL make every
source request with the service user's credentials, bound each refresh in
time, size and frequency, and refresh only while a browser asks. A source
without its prerequisites SHALL report that it is not connected with plain
guidance, and a failed refresh SHALL keep its last items. The browser SHALL
NOT contact a source directly or receive a source credential.

World SHALL link a work item to an agent pane only through that pane's own
reported pull request, or through the branch and GitHub remotes of its
reported, pane or workspace checkout on its own connection. Board SHALL offer
a Work lens of pull requests by lane and tickets by status whose cards name
their linked agents, and Town SHALL show a linked item's badge on the agent's
desk.

#### Scenario: Prerequisite missing
- **WHEN** `gh` is not signed in, or Jira has no site, email or token
- **THEN** that source shows not connected with how to connect it, and other
  sources and views keep working

#### Scenario: Agent works on a pull request
- **WHEN** an agent's checkout is on the head branch of one of the user's
  open pull requests and has that branch's own repository (the fork, for a
  fork's pull request) as a GitHub remote
- **THEN** the Work lens names the agent on that pull request's card and the
  agent's Town desk shows its number and check state

#### Scenario: Jira token saved
- **WHEN** the user saves a Jira API token in Sources settings
- **THEN** the service keeps it in private storage and every later response
  reports only that a token is set

#### Scenario: Pane reused after a restart
- **WHEN** a Herdr runtime restarts or a new agent session starts and reuses
  a linked pane ID
- **THEN** Board and Town show no item for that pane until World links it
  again

#### Scenario: Jira site or account changed
- **WHEN** the user changes the Jira site or email without entering a token
- **THEN** the service removes the saved token and never sends it to the new
  site
