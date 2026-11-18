## Why

World already shows projects, agents and terminals as Town, Board, Desk and Spaces,
but working through source beside those agents requires switching between Inspector
surfaces. A Code projection can make that workflow familiar without creating a
second app, runtime authority or authentication system.

**Status: proposed for owner decision; no implementation approval implied.** This
change delivers research, a synthetic clickable design study and proposed contracts.
Future implementation tasks remain unchecked. No changes to Herdr or herdr-core.

## What Changes

- Propose Code in the common World shell and `/code`, with **Open in Code** from
  a room, explicit project/checkout selection, file review, agent terminals and PR context.
- Recommend the existing CodeMirror family and World terminal adapters. Compare
  Monaco, code-server, OpenVSCode Server, Theia, a VS Code extension and Microsoft's
  remote/tunnel model in the [research note](../../../docs/design/code-view/research.md).
- Specify qualified access to local/SSH project files and existing terminals,
  one World login/origin, stale-state refusal and detached-view lifecycle.
- Recommend read/review and terminal access as the initial implementation boundary.
  The mock also explores editing/conflicts; live saves require a separate explicit
  decision on external-writer concurrency and verified provider support.
- Deliver a [clickable design](../../../docs/design/code-view/design.md) at
  `/code-view-prototype.html`, using only synthetic in-memory data. This is not
  the proposed `/code` route or a working editor.

## Capabilities

### New Capabilities

- `world-code-view`: Qualified projects, file/change/PR review, existing agent
  terminals, phone navigation and failure behavior within a native Code projection.

### Modified Capabilities

- `world-surfaces`: Add Code and `/code` to common navigation while retaining the
  existing shell, history, annotations, qualified context and terminal ownership.

## Impact

Future implementation would touch the view router/shell, shared project-resource
admission, file/Git consumers and TUI/core terminal consumers. Local and SSH
operations stay behind the Bun service and existing OpenSSH profiles. This PR
adds only docs, OpenSpec deltas, standalone static design assets and fixture tests;
it changes no current capability spec or production transport/auth/ownership code.

No new editor dependency, IDE server, extension marketplace, external login,
tunnel or background process is introduced. Full language servers, debugging,
build/tasks, filesystem writes, Git mutation, PR merge, collaboration, runtime
changes and workbench-server installation are outside the proposed initial slice.

## Decision requested

Choose the native World/CodeMirror direction or require a full VS Code workbench.
The recommended initial scope is read/review plus terminals; decide separately
whether optimistic writes in the presence of external agent processes are acceptable.
The [owner questions](../../../docs/design/code-view/research.md#trade-offs-and-owner-decisions)
state the consequences. Approving this research PR does not authorize applying its
future task list, synchronize the deltas or mark the capability delivered.
