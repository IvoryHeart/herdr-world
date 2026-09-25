## ADDED Requirements

### Requirement: Share exact live pane watch records across World browsers

The World service SHALL own one in-memory watchlist of at most 128 terminal-backed World entities. Office, Tree and Graph in every browser connected to that service SHALL observe the same records. Pin and Unpin SHALL identify the exact connection, runtime generation and terminal-backed entity, independent of its agent or terminal classification. Pin SHALL require a current live entity; Unpin SHALL be allowed for the exact unavailable record. A watch record SHALL survive browser reload, visual navigation and selected-host switching while its generation is current. It SHALL be retired on runtime generation replacement and cleared on World service restart. Watch records SHALL NOT mutate Herdr or grant operational authority.

#### Scenario: Two browsers share a pin

- **WHEN** one browser pins a pane in Office and a second browser is open in Tree or Graph
- **THEN** both browsers show one pin for the same qualified entity without a page reload, and Unpin in either browser removes it from both

#### Scenario: Reload and service restart

- **WHEN** a browser reloads while the World process remains running, then the World process later restarts
- **THEN** the browser recovers current watch records after the page reload and sees an empty watchlist after the service restart

#### Scenario: Two hosts reuse native identifiers

- **WHEN** two connections expose the same workspace, pane or terminal identifier
- **THEN** a pin on one host never marks or opens the entity on the other host

#### Scenario: Pane classification changes

- **WHEN** a pinned terminal becomes a detected agent, or a detected agent becomes a terminal, without changing terminal identity
- **THEN** its watch record stays on that entity and follows its current classification and label

#### Scenario: Runtime generation changes

- **WHEN** a watched host reconnects with a replacement runtime generation
- **THEN** the earlier records are retired before an equal native identifier can appear in the new generation

#### Scenario: Watchlist capacity is reached

- **WHEN** 128 distinct entities are already pinned and another Pin is requested
- **THEN** the new pin is rejected with an understandable message and existing records remain unchanged

### Requirement: Reconcile shared watchlist revisions

The service SHALL return a process-local revision with watchlist reads and mutations, and SHALL notify all connected browsers after a real watchlist change. A browser SHALL fetch current state on connection and invalidation, reject older replies within that connection, and treat its last list as unverified while disconnected. On reconnect it SHALL discard old in-flight replies and revision comparisons so a restarted service's empty list can replace old state. A stale browser SHALL NOT pin an entity without current server validation. Duplicate Pin and Unpin SHALL have idempotent effects.

#### Scenario: Out-of-order replies

- **WHEN** a browser receives an older watchlist reply after a newer revision
- **THEN** it retains the newer state and does not restore an already removed record

#### Scenario: Browser reconnects

- **WHEN** a browser loses and regains its World WebSocket
- **THEN** its cached records are non-actionable during the gap and it fetches the current service list on reconnect

### Requirement: Filter visual views to watched panes

The common Pinned only control SHALL filter Office, Tree and Graph to watched leaves on the selected host while retaining enough host, space, room and desk context to identify each visible leaf. Search SHALL operate within the filtered set. Each view SHALL distinguish raw observed coverage, registered watches, current live/admitted watches, displayed matches, view-bound omissions, missing watches, unresolved watches and admission failures; search exclusions SHALL NOT be counted as view omissions. For a fresh host, the service SHALL classify zero raw terminal-ID candidates as missing, multiple candidates or invalid hierarchy as unresolved, and one valid candidate as matched; matched records SHALL be admitted with complete ancestry or counted as admission failures. These disjoint counts SHALL satisfy `registered = missing + unresolved + matched` and `matched = admitted + admission_failed`. A stale or admission-pending host SHALL not claim current classification counts. A missing, stale, disconnected or unresolved watched pane SHALL never offer an operational action.

#### Scenario: Filter the selected host

- **WHEN** Pinned only is enabled with records on two managed hosts
- **THEN** the visual view shows only the selected host's watched leaves and their ancestry, and switching hosts replaces that projection without changing either host's records

#### Scenario: Search watched panes

- **WHEN** the user searches while Pinned only is enabled
- **THEN** only matching watched leaves and their ancestry appear, and clearing search restores the watched set

#### Scenario: Watched pane disappears

- **WHEN** a watched pane is absent from the latest admitted topology or its host becomes stale
- **THEN** the watchlist identifies it as unavailable or retires it, and no Terminal, Inspector or mutation action is offered for it

### Requirement: Admit watched topology within the bounded World snapshot

For each ready host, World SHALL derive snapshot admission from its current-generation service-owned watch records as well as the existing maximum eight browser priorities. A uniquely matched live watched pane and its workspace/tab ancestry SHALL be reserved inside the existing service record limits before ordinary relevance selection. The service SHALL preserve raw Herdr coverage and return watch-admission counts with the watchlist revision. It SHALL distinguish a missing pane from an unresolved hierarchy or a stale/pending observation. An older in-flight snapshot SHALL NOT satisfy a newer watchlist revision, and no watch record SHALL make cached topology actionable.

#### Scenario: Watched pane lies beyond the ordinary pane cap

- **WHEN** a ready host has more than 4,096 panes and a current-generation watched terminal would fall outside ordinary relevance admission
- **THEN** the snapshot retains that exact pane, its workspace and tab within the existing caps, and its WorldObject leaf resolves to the watched record without spending one of the eight browser priorities

#### Scenario: More watched leaves than a view can show

- **WHEN** 128 live records are admitted and more than 16 watched panes belong to one space
- **THEN** the service still admits those panes and ancestry, while Tree and Graph keep their 16-child view bound and report the exact number of watched matches omitted by that bound

#### Scenario: A watched pane has invalid ancestry

- **WHEN** a raw watched pane has no valid matching workspace or tab, or its terminal identity is ambiguous
- **THEN** World counts it as unresolved, presents no guessed actionable leaf, and does not call it merely missing

#### Scenario: A watched terminal identity is duplicated

- **WHEN** one current watch record matches two raw panes with the same terminal ID in a fresh host snapshot
- **THEN** its admission counts are registered 1, unresolved 1, missing 0, matched 0, admitted 0 and admission-failed 0, with no guessed actionable leaf

#### Scenario: Pin changes during observation

- **WHEN** a Pin commits while an older aggregate fetch is in flight
- **THEN** the older result cannot certify the new watchlist revision; the browser shows admission pending until a matching current-generation refresh is admitted
