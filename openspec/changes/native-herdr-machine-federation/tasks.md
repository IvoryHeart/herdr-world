These checkpoints stay in one coherent change and execute in order. Each checkbox requires the
named observable evidence; completing code or a mocked unit test alone is insufficient. This pull
request remains incomplete until checkpoint 4 passes.

## 1. Prove the Herdr connection

- [ ] 1.1 Version the smallest supported saved-machine connection surface.
  - **Owner:** Herdr owns catalogue lookup, profile resolution, SSH, remote discovery and bootstrap,
    and the full session API transport.
  - **Observable result:** A caller selects an admitted opaque machine ID through supported
    catalogue and API entry points without constructing transport or using a private command.
  - **Evidence:** Record the exact Herdr release or commit, protocol and capabilities, public
    interface documentation, and focused upstream contract tests.
  - **Stop and revisit:** Stop if World would need to invoke SSH, inspect a private bootstrap
    protocol, use target or session fields to construct a connection, or maintain another catalogue.

- [ ] 1.2 Prove a live saved-machine snapshot, subscription, and control path.
  - **Owner:** Herdr owns connection progress and concurrency; the conformance fixture observes it.
  - **Observable result:** In the managed plugin or service environment with its real SSH-agent
    availability, Local and one saved machine return the required full snapshot, establish the
    subscription without an event gap, and complete layout apply/export, pane move, managed agent
    launch, and an overview action while the subscription remains open.
  - **Evidence:** Preserve a reproducible live fixture result tied to the pinned Herdr revision,
    including an event caused by a concurrent command and proof that the launcher completes.
  - **Stop and revisit:** Stop if the path works only in an interactive shell, serializes the
    long-lived subscription ahead of commands or launchers, or omits World-required snapshot fields.

- [ ] 1.3 Record the proven connection checkpoint before widening implementation.
  - **Owner:** World owns its compatibility and provenance decision.
  - **Observable result:** The design names only the smallest supported Herdr surfaces demonstrated
    by 1.2 and leaves unproven capabilities in later checkpoints.
  - **Evidence:** Update the compatibility record and this change with the pinned contract and links
    to the live result.
  - **Stop and revisit:** Stop if the documented contract cannot be reproduced from the recorded
    Herdr revision or differs from the behavior the next checkpoint would consume.

## 2. Prove terminal compatibility

- [ ] 2.1 Version the supported terminal-ID surface required by World.
  - **Owner:** Herdr owns terminal identity, stream transport, message semantics, and non-takeover
    attachment behavior.
  - **Observable result:** Supported entry points open streams by terminal ID and provide output,
    input, focus, resize, scroll, graphics, bell, detach, and structured ownership-conflict behavior.
  - **Evidence:** Record the exact protocol and capability contract with upstream wire and behavior
    tests.
  - **Stop and revisit:** Stop if the surface follows one client's selected pane, cannot address a
    terminal ID, or requires World to create a separate transport.

- [ ] 2.2 Prove concurrent terminal isolation against a native client.
  - **Owner:** Herdr owns stream isolation; the conformance fixture drives independent clients.
  - **Observable result:** Two terminal-ID streams control different panes in one split or zoomed
    tab with correct input routing and terminal messages while an existing native client changes
    focus and zoom; a non-takeover conflict preserves the current owner.
  - **Evidence:** Preserve a reproducible live fixture result from the managed service environment
    with the structural subscription still open and both terminal streams making progress.
  - **Stop and revisit:** Stop on input crossover, focus retargeting, serialized attachments,
    missing graphics or bell behavior, or silent ownership takeover.

- [ ] 2.3 Record the proven terminal checkpoint before starting the World adapter.
  - **Owner:** World owns the decision to consume the pinned terminal surface.
  - **Observable result:** The compatibility record identifies the exact terminal protocol,
    capabilities, and non-takeover semantics proven by 2.2.
  - **Evidence:** Link the pinned Herdr revision, fixture result, and protocol evidence from this
    change.
  - **Stop and revisit:** Stop if the recorded surface cannot support the existing browser terminal
    contract without inference from selected TUI state.

## 3. Prove the thin World integration

- [ ] 3.1 Add a bounded runtime provider for Local and one saved machine.
  - **Owner:** World owns registry, admission, sanitization, and same-origin browser adaptation;
    Herdr retains all connection behavior.
  - **Observable result:** The HTTP gateway starts independently, healthy Local survives catalogue
    or native-entry-point failure, a healthy saved machine survives Local failure, and the browser
    receives only sanitized opaque runtime descriptors through one origin.
  - **Evidence:** Focused bridge tests plus a live Local-and-saved-machine run cover both startup
    failure directions and prove that no duplicate direct profile is required for Local.
  - **Stop and revisit:** Stop if the provider needs World-side SSH or bootstrap, persists connection
    metadata, exposes it to the browser, or makes Local depend on native catalogue availability.

- [ ] 3.2 Feed both runtimes through the existing qualified `WorldModel`.
  - **Owner:** World owns runtime qualification and model ingestion; Herdr owns each native
    snapshot.
  - **Observable result:** Local and the saved machine appear in tree, graph, office, and other
    projections through `WorldRuntimeSource`, with gateway, runtime, and native identities kept
    distinct when entity IDs collide.
  - **Evidence:** Model and browser tests plus the live checkpoint show one model containing both
    runtimes and isolate equal pane, terminal, and agent IDs.
  - **Stop and revisit:** Stop if native state needs a parallel topology store, presentation-specific
    ingestion, or unqualified identifiers.

- [ ] 3.3 Route structural commands and launchers through the proven Herdr API surface.
  - **Owner:** World owns its narrow allow-list and qualification; Herdr owns execution.
  - **Observable result:** Existing World layout, pane, workspace, tab, and managed-agent operations
    target one admitted runtime and complete while its event subscription remains open.
  - **Evidence:** Bridge and browser tests plus the live checkpoint correlate each response and
    resulting event with its runtime and current connection.
  - **Stop and revisit:** Stop if an operation needs a remote CLI or shell fallback, an arbitrary
    Herdr method, or transport details from the browser.

- [ ] 3.4 Adapt the proven terminal-ID streams to the browser terminal contract.
  - **Owner:** World owns WebSocket viewer state, message translation, and qualified admission;
    Herdr owns terminal streams and attachment conflicts.
  - **Observable result:** Two browser viewers preserve output, input, focus, resize, scroll,
    graphics, bell, and non-takeover semantics on different saved-machine panes while a native
    client changes focus and zoom.
  - **Evidence:** Focused bridge and browser tests plus the live checkpoint exercise every required
    message and demonstrate no selection or input crossover.
  - **Stop and revisit:** Stop if translation requires a selected-surface inference, changes terminal
    ownership semantics, or cannot preserve terminal-ID isolation.

Checkpoint 3 is an architectural proof. It does not enable native discovery, make the change
merge-ready, or waive any remaining requirement.

## 4. Complete upstream and product acceptance

- [ ] 4.1 Complete Herdr lifecycle and structured failure conformance.
  - **Owner:** Herdr owns generations, reconnect, authentication, host-key, bootstrap, version, and
    transport error classification; World owns mapping those signals into isolated runtime state.
  - **Observable result:** Restart advances the connection generation, stale streams cannot make
    progress, and every required failure affects only its machine with Herdr-owned recovery guidance.
  - **Evidence:** Live conformance covers restart while carriers remain present, authentication and
    host-key Attention, incompatible versions, removal, disablement, and independent recovery.
  - **Stop and revisit:** Stop if World must parse SSH output, guess connection health, or cannot
    fence an old stream from a replacement generation.

- [ ] 4.2 Complete registry lifecycle and generation fencing.
  - **Owner:** World owns catalogue refresh, runtime lifecycle, and generation-qualified admission.
  - **Observable result:** Add, rename, enable, disable, remove, catalogue failure, reconnect, and
    delayed snapshots, events, commands, uploads, and terminal frames affect only the intended
    current runtime generation.
  - **Evidence:** Bridge integration tests cover all transitions, collisions, unknown IDs, bounds,
    and stale results while unaffected runtimes remain usable.
  - **Stop and revisit:** Stop if one runtime can control, prune, or replace another or if carrier
    process lifetime is mistaken for API health.

- [ ] 4.3 Complete remote upload delivery.
  - **Owner:** World owns admission, limits, basename and overwrite policy, cancellation, pane
    validation, and insertion; Herdr owns remote byte transport and private-path creation.
  - **Observable result:** A bounded upload produces a path on the selected machine and inserts only
    that path into the current pane, with cleanup on cancellation or failure.
  - **Evidence:** Conformance and bridge tests cover images and generic files, size and name bounds,
    conflicts, overwrite, hostile input, remote errors, cleanup, and stale generations.
  - **Stop and revisit:** Stop if delivery needs World-side SSH, a browser-selected remote
    destination, shell text, or exposure of a local path to a remote terminal.

- [ ] 4.4 Complete terminal viewer lifecycle and resource bounds.
  - **Owner:** World owns viewer fan-out, detach, idle reaping, backpressure, limits, resize
    arbitration, and reconnect reattachment.
  - **Observable result:** Multiple viewers of one or more terminals remain bounded, ordered, and
    generation-safe while preserving refit and "Attached elsewhere" behavior.
  - **Evidence:** Bridge stress and browser tests cover disconnect, reconnect, slow consumers,
    global and per-session limits, shared output, and stale frames.
  - **Stop and revisit:** Stop if resource use is unbounded, a slow viewer corrupts another, or
    reconnect admits control before a fresh surface.

- [ ] 4.5 Complete runtime-qualified World data.
  - **Owner:** World owns notes, pins, observed activity, migration, persistence, and pruning.
  - **Observable result:** Existing records migrate to Local; equal native IDs on different machines
    cannot overwrite, attach to, or prune one another; cached notes remain available offline.
  - **Evidence:** Persistence and model tests cover migration, collision, offline, reconnect, backup,
    corrupt-store, and generation-pruning cases.
  - **Stop and revisit:** Stop if stable runtime identity cannot survive the documented catalogue
    lifecycle without using sensitive connection fields.

- [ ] 4.6 Complete browser discovery, access policy, and security.
  - **Owner:** World owns desktop and Android discovery, settings, authentication, Host/Origin/CSP
    policy, command admission, and security disclosure.
  - **Observable result:** One gateway profile expands into qualified runtimes; native machines stay
    same-origin; direct profiles remain compatible; no browser request can modify a machine, select
    transport details, invoke arbitrary methods, or bypass qualification.
  - **Evidence:** Browser, accessibility, responsive, API, and security tests cover all runtime
    states, remote exposure disclosure, hostile requests, and desktop and phone flows.
  - **Stop and revisit:** Stop if native use requires a remote World listener or origin, exposes
    credentials or connection fields, or turns the gateway into a general transport proxy.

- [ ] 4.7 Pass final live acceptance and delivery checks.
  - **Owner:** World owns final acceptance; Herdr owns the pinned transport behaviors exercised by
    it.
  - **Observable result:** Local plus a saved machine support concurrent events, commands,
    launchers, two browser terminals, a native client, failure and recovery, notes, pins, activity,
    and uploads through one origin in the managed service environment, with no remote World
    installation or listener.
  - **Evidence:** Record the exact Herdr and World revisions and the complete live acceptance result;
    update architecture, federation, development, security, plugin, vendoring, knowledge-map,
    Android/gateway, compatibility, current specs, and the Unreleased changelog; regenerate notices
    if dependencies changed; pass strict OpenSpec validation and the complete repository check.
  - **Stop and revisit:** Keep the pull request draft and unmergeable if any required live,
    security, privacy, compatibility, or repository check is missing or fails.
