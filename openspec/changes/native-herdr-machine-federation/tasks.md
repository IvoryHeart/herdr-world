## 1. Pinned Herdr compatibility

- [ ] 1.1 Extend `vendor/herdr-compat` with the minimal v0.9.0 endpoint handshake, framing,
  client-shell, SSH stdio, remote executable discovery, and attention-classification source; record
  exact provenance and adaptations and verify default plus `HERDR_SRC` vendor checks pass.
- [ ] 1.2 Add a bounded adapter for `herdr machine list --json` using the explicitly resolved Herdr
  executable; verify unit tests cover valid profiles, duplicate IDs, disabled profiles, malformed or
  oversized output, command failure, and omission of target/session from browser-facing data.
- [ ] 1.3 Add non-interactive saved-machine connection and teardown primitives without catalogue
  mutation or prompt handling; verify synthetic SSH process tests cover clean connection, timeout,
  incompatible endpoint, authentication/host-key Attention, process exit, and cancellation.

## 2. Bridge runtime registry and supervision

- [ ] 2.1 Introduce a bridge-internal runtime provider interface around the existing local Herdr
  implementation; verify current local snapshot, command, event, terminal, note, and upload tests
  pass unchanged through that provider.
- [ ] 2.2 Add a bounded logical runtime registry and machine-qualified routes while retaining local
  route aliases; verify API tests cover stable Local/native IDs, sanitized descriptors, duplicate
  native pane IDs, unknown runtime IDs, and direct-profile compatibility.
- [ ] 2.3 Add catalogue refresh and one metadata supervisor per enabled saved machine; verify tests
  cover add, rename, enable, disable, remove, catalogue failure, independent reconnect, and failure
  isolation while Local remains usable.
- [ ] 2.4 Normalize native client-shell snapshots and patches into the existing runtime snapshot
  model; verify fixtures cover workspaces, tabs, panes, agents, commands, optional worktree data,
  bounds, boot changes, and rejected malformed topology.
- [ ] 2.5 Route allow-listed native operations through advertised endpoint methods and the bounded
  remote-Herdr CLI fallback where v0.9.0 lacks a method; verify every current World command and
  launcher operation either succeeds against a qualified machine or is capability-rejected before
  dispatch, with no browser-controlled shell text.
- [ ] 2.6 Move runtime generation ownership into the aggregate bridge for native machines; verify
  delayed snapshots, patches, command results, upload results, and terminal frames from retired
  connections cannot change or control the replacement generation.

## 3. Concurrent terminal surfaces

- [ ] 3.1 Add bounded on-demand endpoint connections for native browser terminal viewers; verify two
  viewers can select different panes on one saved machine without selection or input crossover.
- [ ] 3.2 Translate native surface frames, input, focus, resize, scroll, graphics, and bell behavior
  into the existing terminal WebSocket contract; verify focused bridge and browser tests cover each
  supported message and capability rejection.
- [ ] 3.3 Add viewer detach, idle reap, global/per-session limits, backpressure, and reconnect
  reattachment; verify stress tests bound SSH processes and memory while preserving current shared
  output and refit behavior for two viewers of one terminal.

## 4. Machine-qualified World data

- [ ] 4.1 Add runtime identity to persisted note attachments and migrate existing unqualified notes
  to Local; verify notes with equal native pane IDs on two machines remain distinct and cached native
  notes remain available while that machine is offline.
- [ ] 4.2 Add bounded remote upload staging through the selected saved SSH profile, using endpoint
  image transfer when compatible and a fixed audited generic-file transfer otherwise; verify size,
  basename, conflict, overwrite, cancellation, cleanup, hostile input, remote error, and stale
  generation cases without exposing a local path to a remote terminal.

## 5. Browser discovery and settings

- [ ] 5.1 Discover Local and native machine runtimes from the serving bridge and merge explicit
  direct bridge profiles as compatibility entries; verify host-qualified selection, All-host scope,
  presentation preferences, reload, and independent connection state remain stable.
- [ ] 5.2 Make Herdr machines the normal desktop connection surface and move direct bridge URLs plus
  reciprocal CSP/Origin controls into a clearly labelled compatibility section; verify component
  tests cover empty, connecting, online, stale, incompatible, Attention, disabled, and removed
  machine states.
- [ ] 5.3 Separate “machines World displays” from “devices allowed to access this World” and disclose
  the complete native-machine authority of a non-loopback serving bridge; verify accessibility and
  responsive tests cover the settings flow at desktop and phone widths.

## 6. Security, operations, and delivery

- [ ] 6.1 Extend bridge security tests to prove browser requests cannot add a machine, choose an SSH
  target/session/executable, invoke arbitrary Herdr methods, inject shell text, disclose catalogue
  connection fields, or bypass runtime/generation qualification.
- [ ] 6.2 Exercise Local plus at least one saved SSH machine with concurrent browser viewers,
  machine failure/recovery, structural actions, managed agent launch, terminal control, notes, and
  uploads; retain bounded diagnostics and confirm no remote World installation or listener exists.
- [ ] 6.3 Update architecture, federation, development, security, plugin, vendoring, knowledge-map,
  and compatibility guidance; synchronize the accepted delta into current specs and add the
  user-facing result to the Unreleased changelog.
- [ ] 6.4 Regenerate dependency notices if the production graph changes, then verify vendor checks,
  strict OpenSpec validation, the complete repository check, acceptance browser tests, privacy
  audit, security audit, and independence audit pass for the final candidate.
