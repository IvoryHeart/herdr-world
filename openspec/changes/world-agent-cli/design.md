## Context

RuntimeOperations already provides listAgents and readTerminal. Core's host runtime
adapts its mirror and fenced screen reader to these ports. World snapshots establish
connection actionability; the runtime registry retains immutable IDs and generations.

## Decisions

- One World agent service owns resolution and reads. The CLI only parses and renders;
  composition supplies exact runtime leases and declared agent capabilities.
- Canonical targets are percent-encoded CONNECTION/ADDRESS, using the native pane/address
  returned by listAgents. Bare native addresses require uniqueness across all actionable
  connections. A failed listing cannot establish uniqueness. Group agent:// names keep
  their existing semantics and are not accepted as screen addresses.
- Capture a lease matching the current snapshot generation, recheck before dispatch and
  after each await, and refuse retired replies. Never reacquire a replacement for a read.
- runtime ls reports host grouping, kind, version (null when unknown), state, actionability,
  supported verbs and optional native skill pointer. Core declares its implemented read
  capabilities; Herdr's adapter descriptor declares its commands.
- agent ls reads fresh lists through ports, returning only normalized identity/status
  fields rather than arbitrary native payloads. Unsupported or failed listings are explicit
  failures, never evidence that an address is unique.
- Screen reads use visible text, strip ANSI where supported and trim the last N lines.
  Core retains its screen-only native read: requesting history can inject scroll input.
  Successful agent read prints text even through a pipe; explicit --json keeps the usual
  World response envelope. --lines accepts integers 1 through 10000.
- Policy allows runtime ls and agent ls wherever cli:ls is allowed. agent read requires
  any verified local caller, including a verified caller on another connection. Future
  send/wait/start likewise require any verified agent, never Town-master ownership.

## Verification assessment

Reads add no writer, durable intent, retry or recovery state. A connection can retire
while listing or reading: enumerate retirement at snapshot, list dispatch/completion,
read dispatch/completion and publication, including a same-address replacement. Existing
runtime lease and core occupant fences retain their ordering models. Direct finite
consumer schedules and the verb × actor policy matrix cover the new boundary without
a new Quint model. Update the coverage mappings and run the full verification gate.
Real TUI/core transport fidelity remains covered by existing port/host-runtime suites;
no live runtime or World server is needed for these focused checks.

## Delivery boundary

Issue #1386 delivers reads only. Send, wait and start requirements and unchecked tasks
remain active until the follow-up implements and verifies them. Do not archive this
change or synchronize unfinished write requirements as delivered behavior.
