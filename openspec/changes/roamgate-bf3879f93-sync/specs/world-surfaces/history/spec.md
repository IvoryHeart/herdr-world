## ADDED Requirements

### Requirement: Qualified agent pane chat

A Herdr agent pane MAY display its bounded conversation in place of its terminal.
The terminal SHALL continue running and SHALL NOT take keyboard focus while hidden.
Questions and activity MAY be derived from its screen; keys, text, uploads and
image-path reads SHALL remain bound to the captured connection and runtime.
World SHALL retain its Town phone entry and shared top app bar.

#### Scenario: Switch between terminal and chat

- **WHEN** the owner chooses Show as a chat or Show the terminal
- **THEN** the pane retains its in-memory draft and bounded History cursor
- **AND** a missing transcript SHALL NOT remove or replace its message editor

#### Scenario: Send fails after text arrives

- **WHEN** an agent-specific modified submit key fails after its text is typed
- **THEN** World reports the failure without restoring or replaying that text
- **AND** a retired runtime SHALL receive no subsequent input

#### Scenario: Default tab title ownership

- **WHEN** automatic naming reads a bound agent session or terminal title
- **THEN** only default or still-owned automatic labels MAY change
- **AND** manual naming, a changed occupant or disposal SHALL prevent a stale rename

#### Scenario: Bounded chat metadata

- **WHEN** a Claude pane exposes recorded commands, published artifacts or images
- **THEN** reads SHALL use its qualified runtime and bounded transcript projection
- **AND** image data SHALL load on demand and be released when its message scope leaves
