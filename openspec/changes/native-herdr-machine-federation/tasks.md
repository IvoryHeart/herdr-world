## 1. Pinned Herdr compatibility

- [ ] 1.1 Extend `vendor/herdr-compat` with the minimal v0.9.0 remote executable discovery,
  non-interactive OpenSSH construction, server bootstrap, Unix-socket forwarding lifecycle, and
  attention classification; record exact provenance and adaptations and verify default plus
  `HERDR_SRC` vendor checks pass.
- [ ] 1.2 Add a bounded adapter for `herdr machine list --json` using the explicitly resolved Herdr
  executable; verify unit tests cover valid profiles, duplicate IDs, disabled profiles, malformed or
  oversized output, command failure, and omission of target/session from browser-facing data.
- [ ] 1.3 Add fixed remote session discovery, `remote-client-bridge` bootstrap, and supervised
  Unix-socket forwarding without catalogue mutation or prompt handling; verify synthetic SSH tests
  cover clean setup, disabled stream-local forwarding, timeout, incompatible Herdr, authentication
  and host-key Attention, process exit, cleanup, and cancellation.

## 2. Bridge runtime registry and supervision

- [ ] 2.1 Introduce a bridge-internal runtime provider around the existing local Herdr
  implementation and start the HTTP service plus registry before probing Local; verify current local
  behavior passes through the provider and the gateway remains available when Local is absent at
  startup or during restart.
- [ ] 2.2 Add a bounded logical runtime registry and machine-qualified routes while retaining local
  route aliases; verify API tests cover stable Local/native IDs, sanitized descriptors, duplicate
  native entity IDs, unknown runtime IDs, one direct gateway advertising multiple runtimes, and
  legacy direct-profile compatibility.
- [ ] 2.3 Add catalogue refresh and one full-API supervisor per enabled saved machine; verify tests
  cover add, rename, enable, disable, remove, catalogue failure, independent reconnect, and a saved
  machine remaining usable while Local is unavailable.
- [ ] 2.4 Map each native `SessionSnapshot` and structural event subscription through the existing
  runtime conversion; verify fixtures preserve workspaces, tabs, panes, terminal IDs, pane
  revisions, layouts, agents, optional worktree data, bounds, boot changes, and same-generation
  subscribe-before-snapshot behavior without client-shell inference.
- [ ] 2.5 Route every allow-listed native structural command and launcher operation through the
  forwarded full JSON API; verify layout apply/export, pane moves, managed agent launch, and every
  current World operation either succeeds or is rejected for an actual missing API capability,
  with no remote CLI fallback or browser-controlled shell text.
- [ ] 2.6 Move runtime generation ownership into the aggregate bridge for native machines; verify
  delayed snapshots, events, command results, upload results, and terminal frames from retired
  tunnels cannot change or control the replacement generation.

## 3. Concurrent terminal attachments

- [ ] 3.1 Add bounded, on-demand direct terminal connections through Herdr's
  `remote-client-bridge`, targeting terminal IDs from the full API snapshot; verify two viewers can
  control different panes in the same split or zoomed tab while an existing native Herdr client
  changes focus and zoom, without selection or input crossover.
- [ ] 3.2 Translate direct terminal output, input, focus, resize, scroll, graphics, and bell behavior
  into the existing terminal WebSocket contract; verify focused bridge and browser tests cover each
  supported message, generation fencing, and capability rejection.
- [ ] 3.3 Add viewer detach, idle reap, global/per-session limits, backpressure, and reconnect
  reattachment; verify stress tests bound SSH processes and memory while preserving current shared
  output and refit behavior for two viewers of one terminal.

## 4. Machine-qualified World data

- [ ] 4.1 Add runtime identity to persisted note attachments and pins, migrate existing unqualified
  records to Local, and partition observed activity and pruning by runtime and generation; verify
  equal native pane, terminal, or agent IDs on two machines cannot overwrite, attach to, or prune
  each other's state and cached notes remain available while a machine is offline.
- [ ] 4.2 Add bounded remote upload staging through the selected saved SSH profile, using Herdr's
  image lane when compatible and a fixed audited generic-file transfer otherwise; verify size,
  basename, conflict, overwrite, cancellation, cleanup, hostile input, remote error, and stale
  generation cases without exposing a local path to a remote terminal.

## 5. Browser discovery and settings

- [ ] 5.1 Discover Local and native machine runtimes from the serving bridge and merge explicit
  direct gateway profiles as compatibility entries; verify one desktop or Android gateway profile
  expands into all of its qualified runtimes while host-qualified selection, All-host scope,
  presentation preferences, reload, and independent connection state remain stable.
- [ ] 5.2 Make Herdr machines the normal desktop connection surface and move direct bridge URLs plus
  reciprocal CSP/Origin controls into a clearly labelled compatibility section; verify component
  tests cover empty, connecting, online, stale, incompatible, Attention, disabled, and removed
  machine states.
- [ ] 5.3 Separate "machines World displays" from "devices allowed to access this World" and disclose
  the complete native-machine authority of a non-loopback serving bridge; verify accessibility and
  responsive tests cover the settings flow at desktop and phone widths.

## 6. Security, operations, and delivery

- [ ] 6.1 Extend bridge security tests to prove browser requests cannot add a machine, choose an SSH
  target/session/executable, invoke arbitrary Herdr methods, inject shell text, disclose catalogue
  connection fields, or bypass runtime/generation qualification.
- [ ] 6.2 Exercise Local plus at least one saved SSH machine with two browser viewers on different
  panes of one split or zoomed tab, an existing native client, machine failure/recovery, structural
  actions, managed agent launch, terminal control, notes, pins, activity, and uploads; repeat bridge
  startup with Local unavailable, verify disabled stream-local forwarding produces bounded
  incompatibility guidance, retain bounded diagnostics, and confirm no remote World installation
  or listener exists.
- [ ] 6.3 Update architecture, federation, development, security, plugin, vendoring, knowledge-map,
  Android/gateway, and compatibility guidance; synchronize the accepted delta into current specs
  and add the user-facing result to the Unreleased changelog.
- [ ] 6.4 Regenerate dependency notices if the production graph changes, then verify vendor checks,
  strict OpenSpec validation, the complete repository check, acceptance browser tests, privacy
  audit, security audit, and independence audit pass for the final candidate.
