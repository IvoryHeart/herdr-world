## ADDED Requirements

### Requirement: Focused observation without per-client polling

A browser SHALL NOT use a timer to re-list a managed connection or to fetch the connection
catalogue. Its focused store SHALL re-list an admitted owner's workspaces, tabs, panes and agents,
and read that owner's active tab layout, only after: a Herdr event or World resynchronization
admitted for that owner; a World change notice for that owner; the browser's own action on it; a
catalogue change that admits or replaces it; reconnection; or the page becoming visible, focused or
online. It SHALL fetch the connection catalogue and browser count after a catalogue change notice,
after reconnection and when the page returns.

For every owner that a visible browser holds, the World service SHALL keep these outputs current:
- topology, labels, order, focus, agent status and presentation, agent names and pane tokens, after
  the re-list that follows their Herdr event;
- agent recency, git status, worktree parents, endpoint availability, workspace metadata and any
  change whose Herdr event did not arrive, within one 5-second observation period, that
  observation's bounded duration and one re-list;
- the connection catalogue and browser count, within one fetch after the change.

Agent recency SHALL come from the service's reading of session-file activity and SHALL be pushed as
values. A browser SHALL keep one recency source per owner and generation. It SHALL apply an entry
only to a pane with the same pane, terminal and agent, and the same agent session when both carry
one.

Change notices and recency SHALL be admitted only for a ready owner whose generation matches the
browser's catalogue. Herdr subscription loss, browser reconnection and runtime replacement SHALL be
repaired by the existing resynchronization, catalogue fetch and re-list, and recency SHALL be resent
whenever a browser declares an owner. A failed catalogue fetch, or a failed re-list of a held
owner, SHALL be retried once per period until one succeeds, the owner is retired or released, or
the page is hidden. Pending-focus settlement, browser-local navigation,
attachment advertisements and completion tracking SHALL keep their existing rules; a bootstrap,
reconnect or resynchronization observation SHALL NOT be reported as a completed task.

#### Scenario: Idle host

- **WHEN** a visible browser holds a host and nothing on that host changes for many periods
- **THEN** the browser makes no re-list, catalogue fetch or other request for it, and its tree,
  status and recency stay as they were

#### Scenario: Agent activity without a status change

- **WHEN** an idle agent's session file records new activity and Herdr sends no event
- **THEN** within one period, each browser holding that host orders that agent as most recently
  active among idle agents, without re-listing the host

#### Scenario: Inspector on another host

- **WHEN** a browser's active host is one connection and an open Inspector belongs to another
- **THEN** both hosts' status, layouts and recency stay current, and neither host's update
  selects, focuses or re-targets the other

#### Scenario: Runtime replaced elsewhere

- **WHEN** a host's runtime is replaced while this browser is idle, for example after an SSH
  recovery
- **THEN** the browser receives a catalogue change notice, admits the new generation, and then
  admits that generation's events and recency; old-generation notices and replies change nothing

#### Scenario: Herdr event lost

- **WHEN** Herdr reports lost events or its event subscription reconnects
- **THEN** World resynchronizes after the new acknowledgement and every browser holding that host
  re-lists it

#### Scenario: Unannounced change

- **WHEN** a host's lists or World-enriched fields change without a Herdr event, such as git status
  after a commit
- **THEN** within one period, each browser holding that host receives one change notice and
  re-lists that host only

#### Scenario: A re-list fails once

- **WHEN** a held host's re-list fails, for example on a transient timeout
- **THEN** the browser retries it within one period, shows the current topology once it succeeds,
  and stops retrying

#### Scenario: Another browser connects

- **WHEN** a second browser connects to World
- **THEN** the first browser's browser count changes after one catalogue fetch, without a timer

#### Scenario: Page hidden and shown

- **WHEN** a browser's page is hidden and later shown
- **THEN** it holds nothing while hidden, still re-lists on admitted Herdr events, and on return
  declares its hosts again, receives their current recency, re-lists and fetches the catalogue

### Requirement: Shared acquisition with reference-counted interest

The World service SHALL acquire each focused observation, recency reading and declared Desk read at
most once per period for all browsers, and SHALL publish each change to every browser that holds
it. Interest SHALL be keyed by connection ID and runtime generation, plus pane and agent session
for session-scoped targets.

A browser SHALL hold interest only while its page is visible: its active connection, each
connection that owns an open Inspector window, and the Desk targets it shows. It SHALL replace its
whole declaration on every change and release it when hidden. The service SHALL count holders
across sockets and SHALL release a socket's declarations when it closes. When no holder remains, it
SHALL stop that acquisition and discard its cached results.

The service SHALL NOT overlap two acquisitions of one resource. It SHALL NOT publish a result whose
runtime lease or generation is no longer current, or whose last holder has released it. Malformed
declarations SHALL be rejected and well-formed unknown owners ignored. Interest SHALL NOT grant
operation authority, select or wake a host, or change a view filter.

#### Scenario: Two browsers hold one host

- **WHEN** two visible browsers hold the same host
- **THEN** the service observes that host once per period, and both browsers receive the same change
  notices and recency

#### Scenario: One of two browsers is hidden

- **WHEN** one of two browsers holding a host is hidden
- **THEN** the other keeps receiving notices and recency, the hidden one receives none, and the
  service keeps observing the host once per period

#### Scenario: Last holder leaves

- **WHEN** the last browser holding a host closes its socket or is hidden
- **THEN** the service stops observing that host and publishes nothing for it, including an
  observation already in flight

#### Scenario: Runtime replaced during an acquisition

- **WHEN** a host's runtime generation changes while an observation or Desk read is in flight
- **THEN** its result is not published, and acquisition for the new generation starts only when a
  browser declares it

#### Scenario: Declaration names a removed profile

- **WHEN** a well-formed declaration names a connection that no longer exists
- **THEN** that owner is ignored and the browser's other owners are still observed
