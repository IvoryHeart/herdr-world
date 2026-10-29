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

For the user's own open pull requests World SHALL compute readiness from what
GitHub reports, never store it, and show each rule as met, failed or unknown.
World SHALL merge, close or mark a pull request ready only after the user
confirms a sheet that states the outcome, SHALL pin a merge to the head the
user saw, and SHALL NOT bypass branch protection.

Reviewer attribution SHALL be an explicit sender claim in the review or comment,
not an identity inferred from a shared GitHub login. Unattributed RESULT evidence
SHALL remain visible with its source link and SHALL NOT confirm readiness.
Reviewed heads SHALL come only from review commit metadata or an unambiguous
explicit SHA, never timestamps; conflicting claims SHALL remain unknown.

Pull request detail SHALL have its own source, head and read-time qualification,
independent of successful list refreshes. Failed, partial, expired or deferred
detail SHALL NOT establish current readiness or authorize a merge. Matching
cached evidence MAY remain visible as stale with its original observation time.
The service SHALL retain bounded ten-item detail requests and at most twenty
details per refresh, isolate retired configuration caches, and revalidate source
generation, detail expiry and exact-head admission before dispatching a merge.

#### Scenario: List succeeds while expired detail fails
- **WHEN** an unchanged pull request list succeeds but its expired detail read
  fails or returns only a partial response
- **THEN** matching old evidence remains labelled stale, findings and screenshot
  readiness remain unknown, and a list success does not update its read time
- **AND** Refresh Sources can recover current detail within the existing bounds;
  a changed head never inherits the old detail

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

#### Scenario: A busy merged window
- **WHEN** more than a hundred pull requests the user authored were merged
  in the merged window (seven days unless changed in Sources settings)
- **THEN** the Work lens shows every one, grouped by the day it merged with
  only the newest day open, up to GitHub's 1,000-result search limit

#### Scenario: Merge confirmed on the head the user saw
- **WHEN** the user confirms Merge on a pull request GitHub would merge as it
  is, and nobody pushed since the card was read
- **THEN** World merges it with a merge commit and keeps the branch; if the
  head moved, World refuses with "Head changed: review again"

#### Scenario: Required review outstanding
- **WHEN** GitHub still requires a review on the user's own pull request
- **THEN** the card offers Open on GitHub and the plain merge command instead
  of Merge, and World runs no merge

#### Scenario: A reviewer confirmed an older head
- **WHEN** a rev agent's latest result confirms its findings on a commit
  before the current head
- **THEN** the findings rule is unknown and says which commit it confirmed
  and how many commits came since

#### Scenario: Jira site or account changed
- **WHEN** the user changes the Jira site or email without entering a token
- **THEN** the service removes the saved token and never sends it to the new
  site
