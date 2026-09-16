## 1. Prove the supported Herdr boundary

- [ ] 1.1 Land and version a supported Herdr machine-qualified multihost contract that exposes a
  bounded machine catalogue, capabilities and connection generations, full session API streams,
  terminal-ID streams, and bounded remote byte delivery while Herdr owns profile selection, SSH,
  remote discovery and bootstrap, reconnection, and transport errors.
- [ ] 1.2 Add an end-to-end conformance fixture for Local and a saved machine. Prove the required
  snapshot fields, subscribe-before-snapshot ordering, reconnect generations, layout apply/export,
  pane moves, managed agent launch, an overview action with no terminal viewer, two simultaneous
  terminal IDs in split and zoomed layouts while a native client changes focus, non-takeover
  attachment conflicts, remote restart, authentication and host-key Attention, and remote byte
  delivery.
- [ ] 1.3 Record and pin the exact Herdr release or commit, protocol and capability contract, and
  conformance evidence in World compatibility and provenance documentation. Verify the World
  adapter needs no SSH invocation, remote shell command, private executable discovery, bootstrap
  helper, or copied Herdr transport implementation.

## 2. Bridge runtime registry and supervision

- [ ] 2.1 Introduce a bridge-internal runtime provider around the existing local Herdr connection,
  bind the HTTP service and registry before probing Local, and verify the gateway remains available
  when Local is absent at startup or during restart.
- [ ] 2.2 Add a bounded logical runtime registry and machine-qualified routes while retaining local
  route aliases. Verify stable Local/native identities, sanitized descriptors, duplicate native
  entity IDs, unknown runtime IDs, one gateway advertising multiple runtimes, and direct-profile
  compatibility.
- [ ] 2.3 Consume Herdr's bounded machine catalogue and supervise one supported machine API stream
  per enabled saved profile. Verify add, rename, enable, disable, remove, catalogue failure,
  independent reconnect, and a saved machine remaining usable while Local is unavailable.
- [ ] 2.4 Map each authoritative session snapshot and structural subscription through the existing
  runtime conversion. Preserve workspaces, tabs, panes, terminal IDs, pane revisions, layouts,
  agents, optional worktree data, bounds, boot changes, and subscribe-before-snapshot behavior
  without reconstructing state from a selected client surface.
- [ ] 2.5 Route every allow-listed structural command and launcher through the selected machine API
  stream. Verify layout apply/export, pane moves, managed agent launch, and every existing World
  operation either succeeds or is rejected for a declared missing capability.
- [ ] 2.6 Fence snapshots, events, command results, upload results, and terminal frames by gateway,
  runtime, and Herdr connection generation. Retired generations must never change state or admit
  control.

## 3. Concurrent terminal attachments

- [ ] 3.1 Attach browser viewers through Herdr's terminal-ID streams and verify two viewers can
  control different panes in the same split or zoomed tab while an existing native Herdr client
  changes focus and zoom, without selection or input crossover.
- [ ] 3.2 Translate terminal output, input, focus, resize, scroll, graphics, and bell behavior into
  the existing terminal WebSocket contract. Verify generation fencing and capability rejection for
  each supported message.
- [ ] 3.3 Add viewer detach, idle reap, global and per-session limits, backpressure, and reconnect
  reattachment. Preserve `takeover=false`, bounded conflict retries, and "Attached elsewhere" when
  another native or direct gateway owns the terminal.

## 4. Machine-qualified World data

- [ ] 4.1 Add runtime identity to persisted note attachments and pins, migrate existing unqualified
  records to Local, and partition observed activity and pruning by runtime and generation. Verify
  equal native pane, terminal, or agent IDs on two machines cannot overwrite, attach to, or prune
  each other's state and cached notes remain available while a machine is offline.
- [ ] 4.2 Keep upload admission, limits, basename handling, overwrite policy, cancellation, and pane
  delivery in World while sending bytes only through Herdr's supported remote-delivery capability.
  Verify success, cleanup, hostile input, remote failure, and stale-generation behavior without
  exposing a local path or browser-selected remote destination.

## 5. Browser discovery and settings

- [ ] 5.1 Discover Local and native machine runtimes from the serving bridge and merge explicit
  direct gateway profiles as compatibility entries. Verify one desktop or Android gateway profile
  expands into all qualified runtimes and all sources use the existing `WorldModel` ingestion path
  while selection, All-host scope, presentation preferences, reload, and independent connection
  state remain stable.
- [ ] 5.2 Make Herdr machines the normal desktop connection surface after the conformance gate passes
  and move direct bridge URLs plus reciprocal CSP/Origin controls into a labelled compatibility
  section. Verify empty, connecting, online, stale, incompatible, Attention, disabled, and removed
  machine states.
- [ ] 5.3 Separate "machines World displays" from "devices allowed to access this World" and disclose
  the complete native-machine authority of a non-loopback serving gateway. Verify accessibility and
  responsive behavior at desktop and phone widths.

## 6. Security, operations, and delivery

- [ ] 6.1 Prove browser requests cannot add or modify a machine, choose a profile target or session,
  control transport setup, invoke arbitrary Herdr methods, inject shell text, disclose connection
  fields, or bypass runtime and generation qualification.
- [ ] 6.2 Exercise Local plus at least one saved machine with two browser viewers on different panes
  of one split or zoomed tab, an existing native client, machine failure and recovery, structural
  actions, managed agent launch, terminal control, notes, pins, activity, and uploads. Repeat gateway
  startup with Local unavailable and confirm no remote World installation or listener exists.
- [ ] 6.3 Update architecture, federation, development, security, plugin, vendoring, knowledge-map,
  Android/gateway, and compatibility guidance; synchronize the accepted delta into current specs
  and add the delivered user-facing result to the Unreleased changelog.
- [ ] 6.4 Regenerate dependency notices if the production graph changes, then verify vendor checks,
  strict OpenSpec validation, the complete repository check, acceptance browser tests, privacy and
  security audits, and the Herdr conformance fixture pass for the final candidate.
