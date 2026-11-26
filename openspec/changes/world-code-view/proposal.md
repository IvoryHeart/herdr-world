## Why

The owner wants the real VS Code ecosystem inside World's project view, with
other IDEs available as integrations. A custom editor would duplicate the IDE
and lose extensions, settings and community features the request depends on.

**Decision proposal only.** #981/#988 delivers research and a synthetic clickable
mock, not an installed server, proxy, extension, live navigation or runtime change.
The owner's real-IDE direction supersedes the earlier native-editor proposal.

## What Changes

- Propose Code as another projection of the same qualified World hosts, rooms,
  projects, agents and terminals. World's frame contains the installed IDE's web
  workbench; VS Code owns editing, extensions, Git and its Workspace Trust.
- Extend the existing integrations direction with IDE providers: detect and
  enable per host, open per project. Recommend Microsoft `code serve-web` as
  the first candidate; offer explicit OpenVSCode/code-server alternatives and
  desktop handoffs to VS Code, Cursor, JetBrains Gateway, Zed and later adapters.
- Require owner acceptance of upstream terms and full shell/write authority;
  never bundle an IDE, silently accept licences or infer shared desktop settings.
- Propose a same-origin HTTP/WS proxy to private local or SSH-forwarded servers.
  Embedding remains unavailable unless licence, base-path, webview/service-worker,
  authentication and extension compatibility gates pass. No automatic CSP change.
- Propose a small World extension supplying profiles for existing Herdr panes and
  core terminals, with qualified identity, detach semantics, core-specific adapter
  checks and an explicit warning about Herdr's shared pane resize.
- Provide explicit desktop handoff. Resource/lifecycle ownership and unavailable
  states are visible, never guessed.

## Capabilities

### New Capabilities

- `world-code-view`: host-qualified IDE integrations, embedded workbench and
  desktop handoff, security/feasibility gates, project/agent/PR context and
  runtime-specific terminal extension behavior.

### Modified Capabilities

- `world-surfaces/shell-navigation`: add Code and `/code` to the shared navigation/frame while
  retaining the same entity context and all existing projections.

## Impact

Research: [comparison, hurdles and owner decisions](../../../docs/design/code-view/research.md).
Design: [interaction study](../../../docs/design/code-view/design.md); its mock
was retired when the first version shipped (#1009, see
[tasks](tasks.md)). No current capability spec is synchronized yet: the
requirements stay in this change until the open tasks land.

Future implementation would touch common shell navigation, integration
catalogue/adapters, service process/auth/HTTP/WS and SSH transport ownership, plus
a separately packaged World VS Code extension. Existing local-only harness skill
RPCs do not already provide that remote IDE contract. Enabling a full IDE changes
the security boundary from bounded World file reads to trusted full host-user
shell/write access; current file/Git APIs are not repurposed into a new editor.

Implementation tasks remain unchecked and gated. No Herdr/herdr-core changes,
custom editor, World save protocol, arbitrary port proxy, public IDE hosting,
new authentication scheme or promise of unrestricted desktop parity is proposed.
