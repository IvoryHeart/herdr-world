## ADDED Requirements

### Requirement: Registered verbs with actor policy

Every browser RPC method, resource operation, agent CLI command and assistant action
SHALL be a registered verb. A read-only operation SHALL be a verb with the `read`
recovery class. Each verb SHALL declare:
- a typed parameter schema;
- a typed result schema;
- the adapter capabilities it requires;
- a policy for each actor;
- its preconditions;
- a recovery class.

The actors SHALL be:
- the owner's browser;
- the agent CLI with a verified pane;
- the agent CLI unverified;
- the assistant;
- World's own reconcilers;
- automation under an owner grant.

Each policy SHALL be one of:
- **allow**;
- **acknowledge:** the caller passes an explicit flag that names the effect;
- **confirm:** a fresh confirmation by the owner in a browser;
- **deny**.

The recovery class SHALL be one of:
- **read**;
- **keyed:** the receiver honours a stable idempotency key;
- **reconcilable:** a decisive read shows whether the effect happened;
- **reattachable:** an external run handle can be found;
- **repeatable:** a duplicate is harmless. It SHALL NOT be used for terminal input,
  Chat sends or pane answers;
- **opaque**.

Admission and checks:
- The service SHALL refuse an unregistered verb, invalid parameters, a denied actor or a
  missing acknowledgement before any acquisition or dispatch.
- It SHALL recheck capabilities, preconditions and the actor's current authorization
  immediately before dispatch.
- An adapter SHALL NOT grant itself an actor policy.
- Moving existing operations into the registry SHALL preserve each operation's current
  effective policy. Widening a policy SHALL be an explicit, reviewed registry change.

#### Scenario: An agent asks to merge a pull request
- **WHEN** the agent CLI, verified or not, requests a pull request merge, close or ready
- **THEN** the service refuses it before contacting the forge, and the same verb from
  the owner's browser runs only after the owner's confirmation

#### Scenario: A layout change without its flag
- **WHEN** the agent CLI requests a desk move without `--herdr`
- **THEN** the service refuses it before contacting Herdr, and the same request with
  `--herdr` runs without any browser step

#### Scenario: Unregistered method
- **WHEN** a browser or the agent CLI sends a method that is not a registered verb
- **THEN** the service refuses it without forwarding it to Herdr or any adapter

#### Scenario: Authorization changes before dispatch
- **WHEN** the owner revokes a grant after a verb was accepted but before it was
  dispatched
- **THEN** the verb is not dispatched and the refusal names the revoked authorization

#### Scenario: Migration keeps today's policy
- **WHEN** existing operations move into the registry
- **THEN** a table check shows that each operation's actor policy is unchanged:
  - the CLI's `--herdr` flag for Herdr layout changes stays an acknowledgement;
  - `--replace --yes` for exclusive role transfers and `--yes` for one-time imports
    stay acknowledgements;
  - pull request merge, close and ready keep the owner's browser confirmation;
  - merges and deletions from the CLI stay refused

### Requirement: Staged command evidence

Command results SHALL report stages backed by evidence. The stages SHALL be:
- `accepted`: held in memory;
- `stored`: durably committed;
- `sent`: dispatched and acknowledged by the source;
- `observed`: a later observation shows the effect, naming that observation;
- `refused`;
- `failed`;
- `uncertain`.

A reply SHALL prove only what World did: that it committed the intent or dispatched it,
not that the source has observed it. World SHALL NOT present a stage it has no evidence
for. In particular, it SHALL NOT present memory-only acceptance as stored.

An `observed` stage SHALL name the observation sequence or snapshot revision that
showed the effect. A client can then await that observation instead of polling.

#### Scenario: Memory-only acceptance
- **WHEN** World accepts a command into memory without a durable commit
- **THEN** the command shows accepted, not stored

#### Scenario: Effect observed later
- **WHEN** a dispatched rename is followed by an observation that shows the new name
- **THEN** the command moves to observed, naming that observation, and a client awaiting
  that observation sees the new name

#### Scenario: Outcome unknown
- **WHEN** an interactive command's dispatch may have reached the source but no
  acknowledgement or decisive read exists
- **THEN** the command shows uncertain, naming its owning host, and is not retried
  automatically
