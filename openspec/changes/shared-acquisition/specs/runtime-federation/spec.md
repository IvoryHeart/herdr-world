## ADDED Requirements

### Requirement: Focused observation without per-client polling

When the World service advertises `world_shared_acquisition`, a browser SHALL NOT re-list a
managed connection or fetch the connection catalogue periodically. Its only timers that re-list a
host or fetch the catalogue SHALL be a retry of a failed fetch or re-list, and a re-list's own
debounce and follow-ups. Without that capability, the browser SHALL keep today's 5-second re-list
and catalogue fetch.

The focused store SHALL re-list an admitted owner's workspaces, tabs, panes and agents, and read
that owner's active tab layout, after:
- a Herdr event or World resynchronization admitted for that owner;
- a World change notice for that owner;
- the browser's own action on it;
- a catalogue change that admits or replaces it;
- reconnection;
- the start of a hold on it: a change of active connection, each admitted Inspector
  conversation, and every held owner when the page is shown.

It SHALL fetch the connection catalogue and browser count after a catalogue change notice, after
reconnection and when the page returns.

For every owner that a visible browser holds, the World service SHALL keep these outputs current:
- topology, labels, order, focus, agent status and presentation, agent names and pane tokens,
  after the re-list that follows their Herdr event;
- agent recency, git status, worktree parents, endpoint availability, workspace metadata and any
  change whose Herdr event did not arrive, within one 5-second observation period, that
  observation's bounded duration and one re-list;
- the connection catalogue and browser count, within one fetch after the change.

The service SHALL send a change notice to a browser only when its observation differs from the
lists that browser last received for that owner. The focused re-list SHALL mark its four list
calls on the request frame, and only replies to marked calls SHALL update that record. Replies to
other callers of the same methods SHALL NOT. Activity times and pane scroll positions SHALL
NOT count as differences. No browser reads a pane's scroll position, and on Herdr 0.9.3 it
changes with output alone.

Agent recency SHALL come from the service's reading of session-file activity. It SHALL reach the
browser through `agent.list` and through pushed values, and SHALL NOT be pushed before a reading
exists. For each pane, terminal, agent and agent session, a browser SHALL keep the latest time it
has seen, so recency never moves backwards. An entry for another agent session SHALL NOT apply.

Change notices and recency SHALL be admitted only for a ready owner whose generation matches the
browser's catalogue. Herdr subscription loss, browser reconnection and runtime replacement SHALL
be repaired by the existing resynchronization, catalogue fetch and re-list. A failed catalogue
fetch, or a failed re-list of a held owner, SHALL be retried once per period until one succeeds,
the owner is retired or released, or the page is hidden. Pending-focus settlement, browser-local
navigation, attachment advertisements and completion tracking SHALL keep their existing rules. A
bootstrap, reconnect or resynchronization observation SHALL NOT be reported as a completed task.

#### Scenario: Idle host

- **WHEN** a visible browser holds a host and nothing on that host changes for many periods
- **THEN** the browser makes no re-list, catalogue fetch or other request for it, and its tree,
  status and recency stay as they were

#### Scenario: A pane prints output and nothing else changes

- **WHEN** a held host's terminals print output, with no other change
- **THEN** no browser receives a change notice or re-lists that host

#### Scenario: Agent activity without a status change

- **WHEN** an idle agent's session file records new activity and Herdr sends no event
- **THEN** within one period, each browser holding that host orders that agent as most recently
  active among idle agents, without re-listing the host

#### Scenario: A browser starts holding a host after a quiet change

- **WHEN** a browser hidden while an agent committed on a held host is shown again, and Herdr sent
  no event for the commit
- **THEN** it re-lists that host when it holds it again and shows the new git status, and the
  service's next observation sends it no further notice for that change

#### Scenario: Another caller lists the host

- **WHEN** an agent commits on a held host without a Herdr event, and a dialog then lists that
  host's workspaces before the next observation
- **THEN** the next observation still sends a change notice to each browser whose focused store
  hasn't received the commit, and its tree shows the new git status

#### Scenario: Preview of a tab that has already closed

- **WHEN** an Inspector preview is admitted for a tab that closed before the browser's last re-list
  of that host
- **THEN** admitting the preview re-lists its host, and the window is removed

#### Scenario: Inspector on another host

- **WHEN** a browser's active host is one connection and an open Inspector belongs to another
- **THEN** both hosts' status, layouts and recency stay current, and neither host's update
  selects, focuses or re-targets the other

#### Scenario: Runtime replaced elsewhere

- **WHEN** a host's runtime is replaced while this browser is idle, for example after an SSH
  recovery, and that runtime's first events arrive before the browser admits it
- **THEN** the browser receives a catalogue change notice, admits the new generation and re-lists
  the host, which shows the changes those dropped events announced
- **AND** no task is reported completed across the generations, and old-generation notices,
  pushes and replies change nothing

#### Scenario: Herdr event lost

- **WHEN** Herdr reports lost events or its event subscription reconnects
- **THEN** World resynchronizes after the new acknowledgement and every browser holding that host
  re-lists it

#### Scenario: Unannounced change

- **WHEN** a host's lists or World-enriched fields change without a Herdr event, such as git status
  after a commit
- **THEN** within one period, each browser holding that host that hasn't received the change gets
  one change notice and re-lists that host only

#### Scenario: A re-list fails once

- **WHEN** a held host's re-list fails, for example on a transient timeout
- **THEN** the browser retries it within one period, shows the current topology once it succeeds,
  and stops retrying

#### Scenario: Another browser connects

- **WHEN** a second browser connects to World
- **THEN** the first browser's browser count changes after one catalogue fetch, without a timer

#### Scenario: Page hidden and shown

- **WHEN** a browser's page is hidden and later shown
- **THEN** it holds nothing while hidden and still re-lists on admitted Herdr events
- **AND** on return it declares its hosts again, re-lists each of them and fetches the catalogue

#### Scenario: Service without the capability

- **WHEN** the World service does not advertise `world_shared_acquisition`, for example after a
  rollback
- **THEN** the browser re-lists its active host and fetches the catalogue every 5 seconds, as
  before this change

### Requirement: Shared acquisition with reference-counted interest

The World service SHALL acquire each focused observation, recency reading and declared Desk read
at most once per period for all browsers. It SHALL publish each change to the browsers that hold
it. Interest SHALL be keyed by connection ID and runtime generation, plus pane and agent session
for session-scoped targets.

A browser SHALL hold interest only while its page is visible. It SHALL hold its active connection,
each connection that owns an open Inspector window, and the Desk targets it shows. It SHALL replace
its whole declaration on every change and SHALL release it when hidden. The service SHALL count
holders across sockets, and SHALL release a socket's declarations when that socket closes. When no
holder remains, the service SHALL stop that acquisition and discard its cached results.

The service SHALL keep, per socket and owner, a record of the lists it last sent that socket, and
SHALL compare observations with that record (Focused observation without per-client polling). It
SHALL NOT overlap two acquisitions of one resource. It SHALL NOT publish a result whose runtime
lease or generation is no longer current, or whose last holder has released it. It SHALL NOT send
a placeholder before a result exists. Malformed declarations SHALL be rejected and well-formed
unknown owners ignored. Interest SHALL NOT grant operation authority, select or wake a host, or
change a view filter.

#### Scenario: Two browsers hold one host

- **WHEN** two visible browsers hold the same host
- **THEN** the service observes that host once per period, and each browser receives the notices
  and recency for changes it has not yet received

#### Scenario: A holder already re-listed after an event

- **WHEN** a browser re-lists a host after a Herdr event, and the service's next observation shows
  the same lists
- **THEN** that browser receives no change notice for it

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
