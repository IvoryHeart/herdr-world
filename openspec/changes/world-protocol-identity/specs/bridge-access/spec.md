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
- The user's browser;
- the agent CLI with a verified pane;
- the agent CLI unverified;
- the assistant;
- World's own reconcilers;
- automation under an owner grant.

Each policy SHALL be one of:
- **allow**;
- **acknowledge:** the caller passes an explicit flag that names the effect;
- **confirm:** a fresh confirmation by the user in a browser;
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
  the user's browser runs only after the user's confirmation

#### Scenario: A layout change without its flag
- **WHEN** the agent CLI requests a desk move without `--herdr`
- **THEN** the service refuses it before contacting Herdr, and the same request with
  `--herdr` runs without any browser step

#### Scenario: Unregistered method
- **WHEN** a browser or the agent CLI sends a method that is not a registered verb
- **THEN** the service refuses it without forwarding it to Herdr or any adapter

#### Scenario: Authorization changes before dispatch
- **WHEN** the user revokes a grant after a verb was accepted but before it was
  dispatched
- **THEN** the verb is not dispatched and the refusal names the revoked authorization

#### Scenario: Migration keeps today's policy
- **WHEN** existing operations move into the registry
- **THEN** a table check shows that each operation's actor policy is unchanged:
  - the CLI's `--herdr` flag for Herdr layout changes stays an acknowledgement;
  - `--replace --yes` for exclusive role transfers and `--yes` for one-time imports
    stay acknowledgements;
  - pull request merge, close and ready keep the user's browser confirmation;
  - merges and deletions from the CLI stay refused

## MODIFIED Requirements

### Requirement: Staged command evidence

Command evidence SHALL distinguish accepted, stored, sent, observed, refused,
failed and uncertain. Memory admission SHALL report accepted; stored SHALL
require a durable commit receipt; sent SHALL require native acknowledgement and
name its owning connection and runtime generation. Observed SHALL require an
explicit observation identifier and SHALL NOT be inferred from successful dispatch.
Legacy handlers MAY conservatively report accepted rather than claim an
unproven stronger stage. Uncertain native input SHALL name its owning runtime
and SHALL NOT be automatically retried.

#### Scenario: Memory-only acceptance
- **WHEN** a command completes against an in-memory store without a durable receipt
- **THEN** its evidence reports accepted, not stored

#### Scenario: Durable record committed
- **WHEN** the durable ledger commits an ask, answer, result or change and supplies
  the committed record's receipt
- **THEN** its CLI reply can report stored with that receipt

#### Scenario: Native acknowledgement lost
- **WHEN** opaque native input may have been dispatched but no acknowledgement arrives
- **THEN** World reports uncertain with the captured runtime and does not retry it

#### Scenario: Effect observed later
- **WHEN** a dispatched rename is followed by an observation that shows the new name
- **THEN** the command moves to observed, naming that observation, and a client awaiting
  that observation sees the new name
