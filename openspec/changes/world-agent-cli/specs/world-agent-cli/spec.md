## ADDED Requirements

### Requirement: Runtime-neutral discovery

World SHALL expose `herdr-world runtime ls [--json]` through its authenticated local
CLI route. Per host, it SHALL report each connection's immutable ID, generation,
runtime kind, version or unknown, state, actionability and supported agent verbs
from declared runtime capabilities. It SHALL name a runtime's native skill command
when available as a documentation pointer, never as command forwarding.

#### Scenario: Mixed runtimes
- **WHEN** World observes Herdr TUI and herdr-core on local or SSH hosts
- **THEN** runtime ls names both connections, kinds, versions, states, actionability,
  supported verbs and the respective `herdr --skill` and `hc --skill` pointers

### Requirement: Runtime-neutral agent listing

World SHALL expose `herdr-world agent ls [--connection ID] [--json]`, listing the
agents on every selected actionable connection through its typed listAgents port.
Each row SHALL include a qualified target, connection ID, generation, native address
and observed status (unknown when absent). Unsupported or failed listings SHALL
report their reason; cached stale topology SHALL NOT become an actionable listing.

#### Scenario: Repeated addresses
- **WHEN** two connections each contain address t2
- **THEN** agent ls returns two distinct connection-qualified targets

#### Scenario: Explicit unavailable connection
- **WHEN** agent ls selects a disconnected or stale connection
- **THEN** World refuses it as not actionable without reading a sibling connection

### Requirement: Qualified targeting and refusal vocabulary

World SHALL accept percent-encoded `CONNECTION/ADDRESS` targets for agent commands.
It SHALL accept a bare native address only when exactly one agent matches across
all actionable connections. Resolution SHALL capture the selected immutable
connection ID and runtime generation and retain them through dispatch and reply.
World SHALL refuse ambiguous addresses with all matching qualified candidates,
unknown targets as `unknown target`, stale or retired connections as `not actionable`,
and undeclared verbs as `not supported by runtime kind X`. It SHALL never substitute
another connection or publish a retired generation's reply.

#### Scenario: Ambiguous short address
- **WHEN** agent read t2 matches two actionable connections
- **THEN** World refuses as ambiguous and lists both qualified candidates without reading either screen

#### Scenario: Selected connection reconnects
- **WHEN** a selected connection changes generation while listing or reading
- **THEN** World refuses as not actionable and never returns replacement or retired screen text

#### Scenario: Unknown target
- **WHEN** the named address is absent from the selected current connection
- **THEN** World reports unknown target without trying another connection

#### Scenario: Unsupported runtime verb
- **WHEN** a runtime does not declare the requested agent verb
- **THEN** World reports not supported by runtime kind X before invoking that verb

### Requirement: Verified screen reads

World SHALL expose `herdr-world agent read TARGET [--lines N]` through the runtime's
typed readTerminal port. It SHALL return current screen text, optionally limited to
the last N lines (an integer from 1 through 10000), without requesting native scrollback
that changes the terminal. Default output SHALL be plain screen text even when piped;
explicit --json SHALL return the World envelope.

#### Scenario: Read core through World
- **WHEN** a verified caller reads a qualified core target
- **THEN** World prints that terminal's screen from its exact runtime port

#### Scenario: Sensitive text from an unverified caller
- **WHEN** an unverified caller requests agent read
- **THEN** World refuses before acquiring any target screen text

### Requirement: Agent command authority and integration guide

`cli:runtime ls` and `cli:agent ls` SHALL have the same actor policy as `cli:ls`.
`cli:agent read` SHALL allow any verified agent and deny unverified callers.
The versioned World skill SHALL document these commands and targeting/refusal rules.
No command SHALL forward arbitrary native RPCs or execute a runtime's CLI.

#### Scenario: Verified agent on another connection
- **WHEN** a verified agent requests an actionable target on another World connection
- **THEN** screen-read policy permits it without Town-master authority

### Requirement: Verified direct sends (follow-up, not delivered by issue 1386)

World SHALL expose typed `agent send TARGET TEXT` with the same targeting and refusal
rules, available to any verified agent. It SHALL send only through the selected runtime
port and original generation, refuse unsupported sends, and never automatically replay
an uncertain native send. It SHALL NOT require Town-master ownership or create a durable
message log or inbox.

#### Scenario: Verified non-master sends
- **WHEN** a verified agent sends to a current qualified target
- **THEN** authority permits the send regardless of Town-master ownership

### Requirement: Runtime-owned waiting (follow-up, not delivered by issue 1386)

World SHALL expose typed `agent wait TARGET` to any verified agent, refusing
unverified callers, with bounded timeout and runtime-owned status evidence. It SHALL preserve qualified ownership while waiting and report timeout,
unsupported waiting or a retired target explicitly, never follow a replacement generation.
Screen-bearing replies SHALL require verified-agent authority.

#### Scenario: Target reconnects while waiting
- **WHEN** a wait's original generation retires
- **THEN** the wait refuses as not actionable instead of following the replacement

### Requirement: Verified agent starts (follow-up, not delivered by issue 1386)

World SHALL expose typed `agent start` on an explicitly selected connection for any
verified agent, without Town-master ownership. It SHALL use the runtime's declared start
port and original generation and refuse unsupported, stale or non-actionable targets.
It SHALL NOT forward arbitrary runtime CLI arguments or automatically replay uncertain starts.

#### Scenario: Unverified start
- **WHEN** an unverified caller requests agent start
- **THEN** World refuses before creating a runtime agent
