## ADDED Requirements

### Requirement: Local CLI caller verification on supported platforms

World SHALL verify local CLI caller claims on Linux and macOS using the process
owning the client end of the loopback connection and its ancestry. Inspection
SHALL be bounded and read-only. A pane ID or shared process group alone SHALL
NOT grant authority; existing qualified connection and recipient checks apply.

#### Scenario: Local Linux or macOS caller runs inside its claimed pane

- **WHEN** the loopback client socket has one process owner and that process or
  an ancestor is among the local pane's reported processes
- **THEN** World verifies the caller on that pane's connection
- **AND** a herdr-core caller must descend from its terminal's program under the
  existing nearest-runtime and occupant checks

#### Scenario: Socket or ancestry cannot establish ownership

- **WHEN** the socket is ambiguous, shared across processes, missing or unreadable,
  the inspection exceeds its limits, or ancestry does not match the claimed pane
- **THEN** the caller remains unverified without another connection supplying authority

#### Scenario: Caller verification is unsupported

- **WHEN** a caller uses an unsupported platform such as Windows and World refuses
  an ask that requires verification
- **THEN** the refusal includes "caller verification is unavailable on this platform"
- **AND** the caller remains unverified
