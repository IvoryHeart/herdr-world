## ADDED Requirements

### Requirement: Return bounded aggregate observation with host-local progress

`world.snapshot` SHALL return the complete managed-connection catalogue within 20 seconds when individual ready Herdr runtimes are slow or unreachable. It SHALL attempt the browser-selected operational host before inactive hosts, admit each completed host independently and represent an unfinished host with explicitly stale, non-actionable cached topology or no child topology. Observation progress for one host SHALL NOT grant mutation authority or delay publication of another ready host past the response deadline. The selected-host hint SHALL be validated as a managed connection identity and SHALL NOT change the selected operational connection.

#### Scenario: Many inactive hosts are slow

- **WHEN** the selected host responds promptly while enough other ready hosts stall to exceed the browser's normal RPC timeout under the old all-host wait
- **THEN** the snapshot returns before the 20-second deadline with the selected host's current topology and a catalogue entry for every other managed host

#### Scenario: Selected host is slow

- **WHEN** the selected host has not produced a current snapshot by the response deadline
- **THEN** its cached topology is marked stale and non-actionable, or it has no children when no cache exists, while completed inactive hosts remain independently observed

#### Scenario: Selected-host hint is invalid

- **WHEN** the request supplies a malformed or unknown selected-connection identity
- **THEN** World rejects the hint without selecting a default host or routing any operation

### Requirement: Reconcile late host observations safely

The service SHALL coalesce overlapping refresh work per connection and SHALL publish or cache a late host result only while its original runtime lease and generation are current. Completion after an earlier partial response SHALL trigger a bounded browser refresh so the newly admitted host can appear. Browser disconnect and runtime replacement SHALL continue to make retained topology stale and non-actionable until current observation is admitted.

#### Scenario: Late host succeeds

- **WHEN** an unfinished ready host completes after an aggregate response was returned
- **THEN** the next coalesced observation can include its current topology without repeating another already in-flight host fetch

#### Scenario: Runtime is replaced during a late result

- **WHEN** a host's generation changes while an earlier fetch remains in flight
- **THEN** that fetch cannot overwrite the replacement host's cache, status or actionable topology

#### Scenario: Browser loses World

- **WHEN** the World WebSocket disconnects after a partial or complete response
- **THEN** every retained host becomes stale and non-actionable until a new admitted response arrives
