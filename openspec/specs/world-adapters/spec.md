## Purpose

Let World observe and act on systems of record through declared adapters. Register
them statically in the repository and hold every adapter to one conformance suite,
proven against a synthetic source unlike Herdr, while Herdr remains the only runtime.

The current implementation covers the runtime observation adapter boundary. Legacy
mutation dispatch and other built-in source migration, including the provider-name
lint, remain tasks 7.1 and 7.5 of `world-protocol-identity`. The subscription crossing
below is a future v2 consumer gate, with an explicit pending test.

## Requirements

### Requirement: Declared adapter descriptors

Every source of observations or effects SHALL be an adapter with a descriptor that
declares:
- the adapter kind and contract version;
- **capabilities**, including whether its listings are complete, whether it emits
  events, supports get-by-ID or reports source revisions;
- **kinds**, with payload schemas, key derivation and continuity evidence;
- **verbs**, with schemas and the protocol recovery classes: `read`, `keyed`,
  `reconcilable`, `reattachable`, `repeatable` or `opaque`;
- a configuration schema;
- **limits** on concurrency, page size, rate, entities and bytes.

World SHALL use only declared capabilities. It SHALL refuse an undeclared verb before
dispatch and SHALL keep every acquisition within the declared limits. Secrets an adapter
needs SHALL stay in private files and SHALL NOT appear in descriptors, observations or
change feeds.

#### Scenario: Undeclared verb
- **WHEN** a caller requests a verb that an adapter does not declare
- **THEN** World refuses it before contacting the source

#### Scenario: Partial listing capability
- **WHEN** an adapter declares that its listings can be incomplete
- **THEN** World never treats an entity's absence from such a listing as ending it

### Requirement: Static adapter registry

Adapters SHALL be registered once, in the service's composition root, from code in this
repository. World SHALL NOT load adapter code at runtime from outside the build. A
disabled adapter SHALL perform no acquisition, hold no timers and add no eagerly loaded
browser code. The browser SHALL receive adapter descriptors as data and SHALL load
per-kind presentation code only when that kind is shown.

#### Scenario: Disabled source
- **WHEN** an adapter is disabled
- **THEN** it makes no requests, schedules no work and its browser presentation code is
  not loaded

### Requirement: Shared conformance suite

Every adapter SHALL pass one shared conformance suite. It SHALL establish that:
- the same native ID on two source instances never aliases;
- absence counts only from a complete listing;
- a source reset or ID reuse never attaches old records without verified evidence;
- out-of-order, duplicate and missing events are repaired by reading again;
- unknown kinds and fields are ignored and counted;
- unsupported verbs are refused before dispatch;
- declared limits hold;
- results arriving after their owner retired are never published;
- a disabled adapter costs nothing.

#### Scenario: Out-of-order events
- **WHEN** an adapter delivers a delete before the matching create, or an event for an
  entity not yet listed
- **THEN** the suite shows World repairs by reading again and publishes no state the
  source does not hold

#### Scenario: Reset with reused IDs
- **WHEN** a source resets and reuses earlier IDs for new entities
- **THEN** the suite shows records bound to the old entities become unconfirmed or ended,
  never attached to the new ones

### Requirement: Synthetic test source

The repository SHALL include a synthetic test source adapter. It SHALL be registered
only by test composition, never in a production build, and SHALL be seeded and
deterministic. It SHALL behave unlike Herdr:
- opaque, case-sensitive IDs containing separators;
- entities with no panes or terminals;
- paginated listings that can be marked incomplete;
- resets that reuse IDs;
- events that arrive before their listing, out of order or duplicated;
- events without full payloads.

The conformance suite, binding resolution, per-field claims and verb refusal SHALL be
exercised against it. Before any consumer moves to World subscriptions, its entities
SHALL also be served through a World subscription query. That run SHALL cover:
- terminal-less rows;
- a reset that ends lifetimes;
- ID reuse as a new lifetime;
- a partial listing that emits no deletes.

#### Scenario: Production build
- **WHEN** World is built for release
- **THEN** the synthetic source is not registered and cannot be enabled

#### Scenario: Terminal-less entities
- **WHEN** the synthetic source reports entities that have no pane or terminal
- **THEN** they are observed, bound and claimed without a terminal, and no terminal
  operation is offered for them

#### Scenario: Synthetic rows through a subscription
- **WHEN** the synthetic source resets and reuses an earlier ID while a client is
  subscribed to its entities
- **THEN** the client sees the old entity's lifetime end and a new lifetime begin. A
  partial listing during the run deletes nothing.
