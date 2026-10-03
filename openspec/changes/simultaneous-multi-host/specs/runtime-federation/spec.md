## MODIFIED Requirements

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

### Requirement: Return bounded aggregate observation with host-local progress

`world.snapshot` SHALL return the complete managed-connection catalogue within 20 seconds when
individual ready runtimes are slow or unreachable, with at most four concurrent host observations.
It SHALL prioritize a bounded set of managed connections with open operational contexts or visible
view scope, distribute attempts fairly within that set and guarantee background progress for other
ready hosts. Each completed host SHALL be admitted independently; unfinished hosts SHALL expose
explicitly stale, non-actionable cached topology or no child topology. A ready host's control
operations SHALL NOT wait for aggregate observation of unrelated hosts.

Scheduling hints SHALL be validated as managed connection identities, SHALL NOT grant operation
authority and SHALL NOT change connection lifecycle or view filters. The existing single selected-host
hint SHALL remain accepted as a compatibility shorthand for one priority connection. Repeated hints
SHALL be deduplicated and malformed or unknown identities SHALL be rejected without default routing.

#### Scenario: Many inactive hosts are slow
- **WHEN** open-context hosts respond promptly while other ready hosts stall
- **THEN** the response returns within 20 seconds with current completed observations and a catalogue
  entry for every managed host, without delaying ready-host controls

#### Scenario: Selected host is slow
- **WHEN** a priority host has not produced a current snapshot by the deadline
- **THEN** its cached topology is stale and non-actionable or it has no children, while completed
  hosts remain independently observed

#### Scenario: Selected-host hint is invalid
- **WHEN** a request supplies a malformed or unknown priority connection identity
- **THEN** World rejects the hint without selecting a default or routing an operation

#### Scenario: Priority hosts keep invalidating
- **WHEN** priority hosts continuously request refresh while unprioritized ready hosts await observation
- **THEN** background hosts receive observation attempts as bounded slots become available rather
  than being indefinitely displaced by priority refreshes

#### Scenario: Legacy single-host hint
- **WHEN** an existing caller supplies the valid single selected-connection hint
- **THEN** it receives bounded aggregate observation with that host prioritized and no lifecycle change
