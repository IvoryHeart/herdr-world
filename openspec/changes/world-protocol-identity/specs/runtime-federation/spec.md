## ADDED Requirements

### Requirement: Service incarnation fences observation

World SHALL generate a new random service incarnation at each start and SHALL send it in
the WebSocket hello as `service_incarnation`. Every observation base, subscription cursor
and persisted capture that names a runtime generation SHALL also name the incarnation.
World SHALL NOT accept a base, cursor or capture from another incarnation as current:
- a base from another incarnation SHALL receive complete observation;
- a cursor from another incarnation SHALL receive an explicit reset;
- a captured runtime generation SHALL NOT match a runtime of the current process.

Connection ID, runtime generation, service incarnation, transport epoch, observation
epoch, subscription generation and source revision SHALL remain separate fields, and
none SHALL substitute for another.

#### Scenario: Two processes both reach generation 1
- **WHEN** World restarts and a host's new runtime again has generation 1
- **THEN** a base, cursor or persisted capture naming generation 1 of the previous
  incarnation does not match it, and the browser receives complete observation for every
  host

#### Scenario: A reply crosses a restart
- **WHEN** a reply or token issued before a restart reaches a browser connected to the
  restarted service
- **THEN** the browser rejects it and keeps only observation admitted from the current
  incarnation

### Requirement: Changed-host observation replacement

When the hello advertises `world_observation_v1`, a browser's aggregate observation
request SHALL name the base it holds:
- the service incarnation;
- for each admitted host, its connection ID, runtime generation and host token.

A host token SHALL identify one host's projected observation for one runtime generation,
and equal tokens SHALL mean identical projected content.

Each reply SHALL name the service incarnation and each host's token. For each catalogue
host the service SHALL send the complete host observation, except when the incarnation,
generation and token all equal the base. In that case it SHALL send an unchanged
confirmation:
- the host's current state, generation, staleness, actionability and errors;
- its token;
- no topology.

The browser SHALL apply each reply as one publication and SHALL reuse its retained host
for each unchanged confirmation. A confirmation SHALL NOT restore actionability that the
browser's own qualification has retired.

The following SHALL produce complete host observation through the existing bounded
snapshot path:
- an unknown or missing base;
- a changed generation;
- a changed incarnation.

A reply that confirms a host the browser no longer holds SHALL be discarded and
followed by a request without a base. A request without a base SHALL receive today's
complete reply, and a service that rejects a base SHALL receive no further bases on
that socket.

#### Scenario: One host changes
- **WHEN** one agent's status changes on one of three hosts and the browser refreshes
  with its base
- **THEN** the reply carries that host's complete observation and unchanged
  confirmations for the other two, and the browser keeps the other two hosts' objects

#### Scenario: Nothing changed
- **WHEN** a refresh finds every host's generation and token equal to the base
- **THEN** no host topology is sent and the browser rebuilds nothing

#### Scenario: Base from another incarnation
- **WHEN** a browser sends a base whose incarnation differs from the service's
- **THEN** every host is sent complete, and the browser drops every retained host before
  applying the reply

#### Scenario: Host retired while the request was in flight
- **WHEN** the browser retires a host's runtime generation after sending its base and
  the reply confirms that host unchanged
- **THEN** the host keeps its content but stays stale and non-actionable until a current
  generation is admitted

#### Scenario: Confirmation for a host the browser dropped
- **WHEN** a reply confirms a host the browser no longer holds
- **THEN** the browser discards the whole reply and sends one request without a base

#### Scenario: Client without a base
- **WHEN** an older browser requests aggregate observation without a base
- **THEN** it receives a complete reply as before

### Requirement: Incremental observation preparation

An admitted observation SHALL prepare only what its changes affect.
- **All unchanged.** A reply whose hosts are all unchanged, with identical state, SHALL
  rebuild no host, room or view model and SHALL NOT publish.
- **One room changed.** When a replaced host differs from the admitted host only within
  one room, World SHALL prepare that room and the counts, attention and summaries that
  depend on it. It SHALL reuse every other room's prepared presentation.
- **Consumed views only.** World SHALL prepare a view's model only while a consumer of
  that model is mounted.
- **Board document.** World SHALL keep the Board document available to appearance and
  relations in every view.
- **View switch.** World SHALL finish a newly selected view's preparation before
  presenting it.
- **Equivalence.** Incremental preparation SHALL produce the same presentation as a
  complete preparation of the same observation.

#### Scenario: One status change in a large host
- **WHEN** one agent's status changes in a host with ten rooms
- **THEN** World prepares that agent's room and the dependent counts, attention and
  summaries, and prepares none of the other nine rooms

#### Scenario: Town is shown
- **WHEN** an observation is admitted while only Town is shown
- **THEN** World prepares no Board topology, Board's document still serves appearance
  and relations, and switching to Board prepares Board topology before Board is presented

#### Scenario: Equivalence with complete preparation
- **WHEN** any sequence of observations is prepared incrementally
- **THEN** the result equals a complete preparation of the last observation

### Requirement: Herdr observation repair by event class

The service SHALL treat Herdr events as invalidation, not as an authoritative replica.
- It SHALL subscribe before reading.
- It SHALL mark a host read dirty when a relevant event arrives during it, and read
  again.
- On subscription loss, lost events, re-acknowledgement, unknown membership or runtime
  replacement, it SHALL retire actionability and re-list the affected runtime.
- It SHALL NOT apply buffered event payloads over a read.

An event class MAY patch the observed model directly only when all of these hold:
- its payload is complete for the fields it patches;
- its target is present in the current runtime's model;
- a drift check, comparing the patched model with a fresh complete listing, has found
  no difference for that class over its evaluation period.

Every other event SHALL invalidate the host for a complete re-list. Drift SHALL be
counted and repaired by replacing the host model, without logging payloads, and SHALL
withdraw that class's permission to patch.

#### Scenario: A pane moves
- **WHEN** Herdr reports a pane move, which can change the pane's ID
- **THEN** the service re-lists the host instead of patching the pane

#### Scenario: Events were lost
- **WHEN** Herdr reports lost events or the subscription is re-acknowledged
- **THEN** the host's observations become non-actionable until a complete re-list of the
  current runtime is admitted

#### Scenario: Event during a read
- **WHEN** a relevant event arrives while a host read is in progress
- **THEN** that read is not published as current, and another serialized read follows

#### Scenario: Drift found
- **WHEN** a drift check finds the patched model differs from a fresh listing
- **THEN** the host model is replaced by the listing, the drift is counted, and that
  event class re-lists instead of patching until it is reviewed

### Requirement: World subscriptions with cursors

When the hello advertises `world_subscriptions`, a browser SHALL be able to subscribe to
a named query with schema-validated parameters and receive a bootstrap followed by
ordered change batches.

Each delivery SHALL carry its subscription generation. Each batch SHALL carry a cursor
of service incarnation, subscription generation and World sequence, meaning the client's
state reflects every change up to that sequence. A client SHALL apply each batch as one
unit.

When a client resubscribes with a cursor, the service SHALL continue from the next
change if all of these hold:
- the cursor's incarnation is current;
- its sequence is within retained history;
- its query and parameters are unchanged.

Otherwise the service SHALL send an explicit reset followed by a new bootstrap.

A client SHALL discard deliveries from an older subscription generation or incarnation.
A service SHALL refuse an unknown query or invalid parameters without acquiring
anything. Unsubscribing or losing the socket SHALL release the subscription's interests.

#### Scenario: Resume within history
- **WHEN** a browser reconnects to the same service and resubscribes with a cursor still
  within retained history
- **THEN** it receives only the changes after its cursor and no bootstrap

#### Scenario: Resume beyond history
- **WHEN** a browser resubscribes with a cursor older than retained history
- **THEN** it receives a reset and a complete bootstrap, never a partial stream

#### Scenario: Service restarted
- **WHEN** a browser resubscribes with a cursor from a previous incarnation
- **THEN** it receives a reset and a complete bootstrap

#### Scenario: Stale delivery after a reset
- **WHEN** a delivery from the previous subscription generation arrives after a reset
- **THEN** the client discards it

#### Scenario: Invalid query
- **WHEN** a browser subscribes to an unknown query or with invalid parameters
- **THEN** the service refuses it and acquires nothing

### Requirement: Watched, paged and credited bootstrap

**Watch and watermark.** A subscription's bootstrap SHALL install the change watch for
its query and capture its watermark in one step, so that no change falls between them.

**Pages.** Bootstrap rows SHALL be the query's state at the watermark, sent in pages.
Each page SHALL:
- contain whole rows;
- stay within a byte bound counted as sent on the wire;
- be sent only against a credit for that socket, subscription generation and page
  number.

**Ordering.** Changes after the watermark SHALL follow the bootstrap, in order and once.

**Credit ownership.** A credit from another socket, subscription generation or page
number SHALL NOT release a page. A reset SHALL retire the bootstrap's pending credits.

**Concurrency.** At most two bootstraps per socket SHALL transfer at once.

**Repair path.** The complete snapshot path SHALL stay available for repair until a
reviewed replacement closes the same claims.

#### Scenario: Change during bootstrap
- **WHEN** a row changes after the watermark and before the last page is sent
- **THEN** the client receives the change once, after the bootstrap

#### Scenario: Foreign credit
- **WHEN** a credit names another socket, subscription generation or page number
- **THEN** no page is released for it

#### Scenario: Reset during bootstrap
- **WHEN** a subscription is reset while pages are pending
- **THEN** its pending credits are retired and no page from the old generation is applied

#### Scenario: Dense repair case
- **WHEN** a browser bootstraps the maintained dense repair fixture
- **THEN** every page stays within the byte bound and interactive replies are not held
  behind more than one page

### Requirement: Delivery lanes

World SHALL deliver three lanes over the one World socket, beside the unchanged terminal
path:
- **Interactive** replies;
- **Durable ordered** items: asks, notices, receipts and workflow signals;
- **Replaceable** state rows.

Lane rules:
- Interactive replies SHALL be sent ahead of subscription traffic that has not begun
  transmitting.
- Durable ordered items SHALL NOT be coalesced or dropped. A durable subscription that
  cannot keep up SHALL be reset and re-bootstrapped from durable state.
- Replaceable rows MAY be coalesced only by the change composition rules.
- A subscription whose queued bytes exceed its bound SHALL be reset. The socket SHALL be
  closed only when the terminal path's own bound requires it.

The terminal path keeps its existing rules:
- only self-contained repaints may replace pending repaints for the same qualified
  endpoint;
- incremental terminal output stays ordered and complete;
- interactive priority is limited by bytes already queued on the socket.

#### Scenario: Slow consumer
- **WHEN** a browser falls behind a busy topology subscription
- **THEN** that subscription is coalesced and, past its bound, reset, while the socket,
  its terminals and its other subscriptions continue

#### Scenario: Asks during a burst
- **WHEN** several asks are created and answered during a burst of topology changes
- **THEN** every ask change is delivered in order and none is merged or dropped

#### Scenario: Reply behind a bootstrap
- **WHEN** a command reply is ready while bootstrap pages are queued
- **THEN** the reply is sent before any page that has not begun transmitting

### Requirement: Change composition

Replaceable changes SHALL be composed only within one entity lifetime of one key:
- a complete row SHALL replace earlier rows and patches;
- patches SHALL merge as ordered field assignments, the later assignment winning;
- a delete SHALL end the lifetime.

A delete followed by a recreate of the same key SHALL be delivered as the end of one
lifetime and the start of another, never merged. Applying a delivered batch SHALL yield
the same state as applying every original change up to that batch's cursor.

#### Scenario: Repeated status changes
- **WHEN** an agent's status changes three times before the next delivery
- **THEN** the client receives one row with the latest status and the same final state
  as applying all three

#### Scenario: Delete then recreate
- **WHEN** a key is deleted and created again before the next delivery
- **THEN** the client observes the end of the first lifetime and the start of the
  second, and drops state bound to the first
