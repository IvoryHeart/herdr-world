# Runtime federation

## Purpose

Preserve Herdr runtime authority while one World service manages local and SSH runtimes,
concurrent independently qualified operational contexts and fair bounded aggregate observation.

## Requirements

### Requirement: Runtime authority
Herdr SHALL own structural topology, agent lifecycle and terminal streams. One World service SHALL
own the saved connection catalogue and SHALL isolate each local or SSH Herdr connection in its own
runtime, transport, subscription, cache and reconnect generation. The browser SHALL communicate
with that World service rather than connecting to independently deployed bridges.

#### Scenario: One host becomes unavailable
- **WHEN** one managed connection loses connectivity
- **THEN** other hosts remain usable and cached topology from the failed host is stale without
  admitting control

#### Scenario: Browser loses the World service
- **WHEN** the browser disconnects from World or aggregate observation fails
- **THEN** every retained host observation becomes stale and non-actionable until a newly admitted
  snapshot restores it

#### Scenario: Continuous aggregate invalidation
- **WHEN** topology invalidations arrive faster than an aggregate snapshot round trip
- **THEN** World keeps at most one browser refresh in flight, admits its current-generation result,
  and then services one coalesced follow-up refresh

#### Scenario: User disconnects a connection
- **WHEN** a user disconnects or removes a managed profile
- **THEN** World stops only its runtime and transport without stopping that Herdr server, session,
  workspace or agent

#### Scenario: A second bridge targets the same runtime
- **WHEN** another managed profile or World process attempts to own the same Herdr client socket
- **THEN** it is rejected before the runtimes can compete for terminal attachment ownership

#### Scenario: SSH transport cannot authenticate
- **WHEN** an SSH profile fails host-key or noninteractive authentication checks
- **THEN** that profile reports an actionable bounded failure and World does not retry the request
  against another profile

#### Scenario: Transient SSH outage outlasts the initial retries
- **WHEN** a managed SSH profile keeps failing with a classified retryable transport error
- **THEN** default recovery continues with capped exponential jitter until it recovers or is
  explicitly stopped; permanent/unclassified failures do not acquire indefinite retries
- **AND** cached Town/Board topology is visibly stale and non-actionable, with explicit
  per-host Reconnect controls; healthy sibling hosts keep their own authority
- **AND** a ready lifecycle signal alone cannot promote an older cached generation

### Requirement: Return bounded aggregate observation with host-local progress

`world.snapshot` SHALL return the complete managed-connection catalogue within 20 seconds when
individual ready runtimes are slow or unreachable, with at most four concurrent host observations.
It SHALL prioritize a bounded set of managed connections with open operational contexts or visible
view scope, distribute attempts fairly within that set and guarantee background progress for other
ready hosts. Each completed host SHALL be admitted independently; unfinished hosts SHALL expose
explicitly stale, non-actionable cached topology or no child topology. A ready host's control
operations SHALL NOT wait for aggregate observation of unrelated hosts.

Scheduling hints SHALL be validated for syntax and bounded size, SHALL NOT grant operation
authority and SHALL NOT change connection lifecycle or view filters. The existing single selected-host
hint SHALL remain accepted as a compatibility shorthand for one priority connection. Repeated hints
SHALL be deduplicated. Malformed hints and malformed or unknown `selected_connection_id` values SHALL
be rejected without default routing. Well-formed unknown identities in `priority_connection_ids`
and `priorities[].connection_id` SHALL be ignored so removed profiles cannot block healthy aggregate
observation.

#### Scenario: Many inactive hosts are slow
- **WHEN** open-context hosts respond promptly while other ready hosts stall
- **THEN** the response returns within 20 seconds with current completed observations and a catalogue
  entry for every managed host, without delaying ready-host controls

#### Scenario: Selected host is slow
- **WHEN** a priority host has not produced a current snapshot by the deadline
- **THEN** its cached topology is stale and non-actionable or it has no children, while completed
  hosts remain independently observed

#### Scenario: Selected-host hint is invalid
- **WHEN** a request supplies a malformed scheduling hint or a malformed or unknown
  `selected_connection_id`
- **THEN** World rejects the hint without selecting a default or routing an operation

#### Scenario: Scheduling hints name a removed profile
- **WHEN** a well-formed priority connection or entity hint names a profile no longer in the catalogue
- **THEN** World ignores that hint and observes healthy managed hosts without fallback routing

#### Scenario: Priority hosts keep invalidating
- **WHEN** priority hosts continuously request refresh while unprioritized ready hosts await observation
- **THEN** background hosts receive observation attempts as bounded slots become available rather
  than being indefinitely displaced by priority refreshes

#### Scenario: Legacy single-host hint
- **WHEN** an existing caller supplies the valid single selected-connection hint
- **THEN** it receives bounded aggregate observation with that host prioritized and no lifecycle change

### Requirement: Reconcile late host observations safely

The service SHALL coalesce overlapping refresh work per connection and SHALL publish or cache a late
host result only while its original runtime lease and generation are current. Completion after an
earlier partial response SHALL trigger a bounded browser refresh so the newly admitted host can
appear. Browser disconnect and runtime replacement SHALL continue to make retained topology stale
and non-actionable until current observation is admitted.

#### Scenario: Late host succeeds

- **WHEN** an unfinished ready host completes after an aggregate response was returned
- **THEN** the next coalesced observation can include its current topology without repeating another
  already in-flight host fetch

#### Scenario: Runtime is replaced during a late result

- **WHEN** a host's generation changes while an earlier fetch remains in flight
- **THEN** that fetch cannot overwrite the replacement host's cache, status or actionable topology

#### Scenario: Browser loses World

- **WHEN** the World WebSocket disconnects after a partial or complete response
- **THEN** every retained host becomes stale and non-actionable until a new admitted response arrives

### Requirement: Qualified admission

The service and client SHALL qualify snapshots, events, actions, HTTP resources and terminal
sessions by connection and runtime generation, and SHALL require compatible capabilities before
dispatch. A browser SHALL admit independent operational contexts on several ready managed
connections concurrently over one World origin. Every operation SHALL capture its owning
connection, generation and resource identity; view filters, another window's focus and another
connection's lifecycle SHALL NOT supply or replace that target. Aggregate observation SHALL NOT
by itself grant mutation authority. The service SHALL revalidate the target runtime lease at dispatch.

A replaced or unavailable runtime SHALL invalidate only its own old contexts and pending work.
World transport disconnect or authentication loss SHALL invalidate all operational contexts.
Late replies, events, HTTP resources and terminal frames SHALL NOT update a replacement context.
World SHALL NOT replay terminal input or automatically retry a mutation with an uncertain outcome
across a disconnect; it SHALL report uncertainty naming the owning host even after browser-observed
runtime retirement. It SHALL re-observe only a currently admitted exact target before a user retry,
without redirecting a refresh to a replacement runtime or another host.

#### Scenario: Colliding native identifiers
- **WHEN** two hosts contain the same native pane identifier and both have open operational contexts
- **THEN** each action and reply belongs only to its captured host and generation and is never
  retried against the other host

#### Scenario: Replaced runtime
- **WHEN** one saved profile reconnects or is replaced while requests or streams remain in flight
- **THEN** its retired generation cannot update or control its replacement and the other host's
  current operations and terminals remain usable

#### Scenario: Unsupported protocol
- **WHEN** a host reports an unsupported or malformed terminal protocol or misses required capabilities
- **THEN** World rejects the unsupported operation on that host without blocking profile management
  or compatible operations on other hosts

#### Scenario: Select an entity on an inactive ready host
- **WHEN** a user opens an observed entity on another ready host with current target admission
- **THEN** World creates or focuses that entity's qualified context without changing a global
  operational host or retiring unrelated contexts

#### Scenario: Explicitly activate another host
- **WHEN** a user explicitly connects another managed profile through connection management
- **THEN** World admits its operations only after that runtime and generation are ready, without
  retiring already admitted contexts on other connections

#### Scenario: Filter changes during a request
- **WHEN** a host filter changes while a resource request or terminal operation is pending
- **THEN** its target and validity remain bound to its original runtime and resource

#### Scenario: World connection is lost
- **WHEN** the browser loses the World transport or authenticated session
- **THEN** all operational contexts become non-actionable until newly admitted, and old responses
  and buffered input cannot enter replacement contexts

#### Scenario: Mutation acknowledgement is lost
- **WHEN** a mutation may have reached Herdr but its acknowledgement is lost during disconnect
- **THEN** World reports an uncertain outcome without automatically replaying the mutation

#### Scenario: Qualified mutation uncertainty after browser-observed retirement

- **WHEN** a Delete or Upload response carries an uncertainty marker matching the captured connection
  ID and runtime generation after the browser has already retired that runtime
- **THEN** World retains a host-level notice that the file change may have completed, without replaying
  the mutation or refreshing a replacement context, while mismatched responses and read-only resources
  remain fenced

#### Scenario: Scoped HTTP reply arrives late
- **WHEN** a file or upload response arrives after its owning runtime generation retires
- **THEN** it cannot populate or act on a current context on that or another host

### Requirement: Managed connection catalogue
World SHALL provide one UI-managed catalogue of local and SSH Herdr profiles. A user SHALL be able
to add, test, connect, disconnect, edit and remove profiles without installing a remote World or
Roamgate web service. SSH profiles SHALL use the service user's OpenSSH configuration and SHALL not
store passwords, private keys, passphrases or arbitrary SSH options.

#### Scenario: Add an SSH host
- **WHEN** a user saves a valid OpenSSH alias or `user@host` and the remote Herdr sockets are ready
- **THEN** World establishes the connection and exposes its workspaces, agents, terminals and
  supported resources through the same application

#### Scenario: Several hosts are connected
- **WHEN** two or more compatible profiles are ready
- **THEN** the service keeps their isolated runtimes and qualified observations connected
  concurrently while each browser can present and operate independently qualified contexts on several profiles

### Requirement: Windows remote SSH runtime
Linux and macOS World services MAY connect to running Windows Herdr sessions over
OpenSSH using validated executable and session fields. Service-owned control and
terminal bridges SHALL preserve immutable connection and generation ownership.
Unix-only resource operations SHALL reject Windows runtimes. Recovery fingerprints
SHALL include the executable and session so changing them prevents silent recovery.

#### Scenario: Windows remote resource request
- **WHEN** a Windows SSH runtime receives a Unix-only file, Git or history request
- **THEN** World returns an unsupported-operation error without using another host

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
has seen, so recency never moves backwards. An entry for another agent session SHALL NOT apply. Maxima SHALL be keyed by the
complete identity through initial pane/layout admission. The browser SHALL retain
read-only session maxima separately from runtime admission, so a World service
restart that resets generation counters SHALL NOT lower the same external agent
session's recency. Rejoining that data SHALL NOT admit operations or obsolete
controls for a retired generation.

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

#### Scenario: World restarts while the external agent session remains

- **WHEN** World restarts and resets its generation counters while the external
  pane, terminal, agent and session remain identical
- **THEN** after fresh runtime admission an older or unavailable reading does not
  lower that identity's recency or its most-active-first ordering
- **AND** controls for an obsolete generation remain rejected

#### Scenario: Two sessions push while the initial layout is pending

- **WHEN** an initial list captured session A and waits on its layout, and pushes
  arrive for A and session B sharing that pane ID
- **THEN** publishing A uses A's maximum, and B's timestamp cannot erase it or apply
  to A

### Requirement: Service incarnation and based aggregate replies

Each World service start SHALL issue a random `service_incarnation`, sent in the
WebSocket hello and every `world.snapshot` reply. The hello SHALL advertise
`world_observation_v1`. Runtime generations and service incarnation SHALL remain
separate fences; restarting both hosts at generation 1 SHALL NOT admit a base
from the previous service as current.

The service SHALL accept an optional `base` containing `service_incarnation` and
at most 64 `hosts`, each with a unique `connection_id`, a nonnegative integer
`generation`, and a nonempty opaque `token` of at most 64 characters. Invalid bases
SHALL be refused before host acquisition, without default routing.

Every reply SHALL include each host's token, null when no snapshot exists. Equal
tokens SHALL identify equal projected snapshot content and producing generation.
Only when incarnation, connection, runtime generation, snapshot generation and
token all match the base SHALL the service omit topology with `unchanged: true`.
A confirmation SHALL include current state, generation, snapshot generation,
staleness, actionability and errors. Every other host SHALL receive a complete
replacement through the bounded existing observation and chunk transport path.
Service-side snapshot consumers SHALL continue to receive complete topology.

#### Scenario: One host changes
- **WHEN** a caller sends a base for two hosts and only one projected snapshot changes
- **THEN** that host receives a complete replacement and its sibling receives a
  confirmation with current metadata and no `snapshot` field

#### Scenario: Unknown or foreign base
- **WHEN** a base names an unknown token, another generation or another incarnation
- **THEN** the service sends complete observations for every mismatching host

#### Scenario: Older caller
- **WHEN** a caller sends no base
- **THEN** every catalogue host retains its complete snapshot as before
