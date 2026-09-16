These checkpoints remain one coherent change and execute in order. Each implementation checkbox
requires the named observable evidence; source code or mocked SSH tests alone are insufficient.
This pull request remains draft until checkpoint 4 passes.

## 0. Reconcile the transport decision

- [x] 0.1 Record the current Herdr remote path and product ownership boundary.
  - **Owner:** World owns the compatibility and architecture decision.
  - **Observable result:** Evidence distinguishes the working SSH-backed Herdr client path from the
    missing public long-lived `--machine` stream and explains why the latter is no longer a product
    blocker. The active design assigns connections, access, routing, identity, and World data to
    World; Herdr semantics to the adapter; and bounded byte/process handling to the local or SSH
    connection mechanism.
  - **Evidence:** `docs/evidence/checkpoint1-herdr-connection.md` records the pinned release,
    current-master source audit, live SSH-agent authentication, remote control, and snapshot result.
  - **Stop and revisit:** Revisit if the recorded remote relay cannot carry the same API and terminal
    protocols used by the existing local bridge.

- [x] 0.2 Preserve SSH-agent discovery in generated managed-service environments.
  - **Owner:** The Herdr plugin installs, starts, and opens World and owns its service definition;
    World owns the connection list; OpenSSH owns agent use.
  - **Observable result:** When `SSH_AUTH_SOCK` is present at service generation, systemd-user and
    launchd definitions pass it to the World bridge, and Settings-triggered systemd-user, launchd,
    and fallback controller handoffs preserve it through a service restart without recording key
    material.
  - **Evidence:** Focused plugin tests cover both generated supervisor definitions; a bridge
    regression test covers the shared controller environment used by every handoff path.
  - **Stop and revisit:** Revisit if the shipped supervisor cannot inherit a usable agent socket or
    requires World to copy credentials.

## 1. Prove the Herdr connection

- [ ] 1.1 Define the minimal World connection, Herdr adapter, and connection-mechanism boundaries.
  - **Owner:** World owns its connection list and lifecycle; the Herdr adapter owns protocol,
    capability, state, and command mapping; connection mechanisms own bounded local-socket or SSH
    process/byte-stream handling; OpenSSH owns SSH policy.
  - **Observable result:** The existing local socket and one SSH-backed target can each produce
    independent API connections and terminal-ID connections through one Herdr-specific adapter,
    while the World registry maintains generation state and each connection mechanism reports
    bounded transport diagnostics. Each remote connection accepts `Default` or a named Herdr session
    selector; the resolved pre-provisioned session is mandatory for runtime admission. Connection
    configuration identity remains distinct from the runtime-binding identity used for persisted
    World entities. Resolution occurs once per generation and produces one immutable assignment for
    every API and terminal connection in that generation.
  - **Evidence:** Focused Rust tests cover connection validation, fixed argv construction, adapter
    and connection lifecycle, independent connection creation, local-management authority, binding
    rotation when `Default` resolves differently or the target changes, same-session pinning while
    implicit remote selection changes, and redaction without a local shell or embedded secrets.
  - **Stop and revisit:** Stop if SSH process handling needs Herdr entity/presentation types, the
    adapter needs World views, cannot establish the resolved session before admission, or the seam
    exposes browser-visible credentials, arbitrary SSH flags or commands, or coupled connection
    lifetimes.

- [ ] 1.2 Implement the smallest SSH-backed socket relay against the pinned Herdr surface.
  - **Owner:** The Herdr adapter owns the pinned relay command and compatibility; World supervises
    the bounded SSH process; OpenSSH selects target/authentication; remote Herdr connects the relay
    to the session socket resolved from the connection's `Default` or named selector.
  - **Observable result:** A configured World connection establishes a compatible remote Herdr API
    connection without a remote World installation or browser-reachable listener.
  - **Evidence:** Integration tests cover the separately pinned relay-capability probe, exact Herdr
    executable/relay revision, deterministic noninteractive lookup, default and named selector
    resolution, resolved session identity, stream framing, remote received command/arguments,
    process startup, exit, timeout, cancellation, malformed targets, missing agent,
    missing/incompatible Herdr, and bounded diagnostics. The fixture proves that both API and
    terminal relay builders explicitly pass the one resolved session, including literal `default`,
    and reject ambiguous status-only identity when socket overrides can redirect a relay.
  - **Stop and revisit:** Stop if implementation requires a local shell, user-supplied shell program
    or shell text, stored key material, interactive prompt handling, unbounded stderr, automatic
    remote bootstrap, or remote World code. A fixed encoded relay command executed by the remote
    login shell is expected OpenSSH behavior and is not itself a stop condition.

- [ ] 1.3 Prove live snapshot, subscription, commands, and launcher concurrency.
  - **Owner:** World owns connection concurrency and recovery; the Herdr adapter owns request and
    snapshot/event sequencing; Herdr owns API results and events.
  - **Observable result:** Through the managed World service environment, Local and one real SSH
    connection return complete snapshots, establish subscriptions without an event gap, and complete
    layout, pane, and launcher operations while the remote subscription remains open.
  - **Evidence:** A reproducible live fixture records the exact revisions, protocol, agent
    availability, pre-provisioned running session, relay capability and framing, an event caused by
    a concurrent command, independent progress of every connection before any terminal attach, and
    continued use of the admitted session after the remote implicit selection changes.
  - **Stop and revisit:** Stop if the relay works only in an interactive shell, serializes the
    subscription ahead of other clients, or omits required snapshot fields.

## 2. Prove terminal compatibility

- [ ] 2.1 Route explicit terminal-ID streams through the Herdr adapter.
  - **Owner:** World owns connection supervision and browser adaptation; the Herdr adapter owns
    terminal mapping and compatibility; Herdr owns terminal IDs and terminal protocol behavior.
  - **Observable result:** Two independent streams can attach to different terminal IDs while the
    structural subscription and command connection remain active.
  - **Evidence:** Focused bridge tests cover handshake, output, input, resize, scroll, focus,
    graphics, bell, detach, cancellation, and per-stream failure.
  - **Stop and revisit:** Stop if streams follow a selected TUI surface, require one shared blocking
    relay, or can route input across terminal IDs.

- [ ] 2.2 Prove browser-terminal behavior against a real remote Herdr and native client.
  - **Owner:** Herdr owns terminal semantics; World owns viewer isolation, bounds, and translation.
  - **Observable result:** Two remote browser terminal viewers preserve the existing terminal
    behavior while a native client changes focus and zoom; attachment conflicts never silently
    retarget or take over input.
  - **Evidence:** The managed live fixture exercises output, input, focus, resize, scroll, graphics,
    bell, shared viewing, refit, native focus changes, and reconnect with both streams progressing.
  - **Stop and revisit:** Stop on input crossover, focus retargeting, unbounded buffering, missing
    protocol behavior, or silent takeover.

## 3. Prove the thin World integration

- [ ] 3.1 Add bounded World-owned Herdr connection persistence and lifecycle.
  - **Owner:** World owns connection IDs, runtime-binding IDs, labels, targets, sessions, enabled
    state, validation, and generation retirement; OpenSSH configuration remains user-owned.
  - **Observable result:** An actual-loopback local-management user can add, edit, enable, disable,
    and remove a remote Herdr connection whose session selector defaults to `Default` and may instead
    name a session, without storing keys or exposing a general SSH/command interface. A changed
    target or a selector resolving to a different session keeps the connection ID but creates a
    fresh runtime binding and detaches old viewers.
  - **Evidence:** Bridge, persistence, recovery, and security tests cover corrupt data, collisions,
    hostile values, bounds, redaction, remote-admin rejection, restart, stable default reconnect,
    changed-default rotation, generation changes, and an A-to-B retarget with colliding native IDs
    and persisted records.
  - **Stop and revisit:** Stop if stable identity depends on mutable targets, connection input can
    alter SSH argv structure, a Herdr catalogue becomes authoritative over World connections, or
    routine runtime payloads disclose connection details.

- [ ] 3.2 Add local Herdr profile discovery and explicit import.
  - **Owner:** World owns discovery presentation, import decisions, independent connection IDs, and
    provenance; Herdr owns the supported saved-machine catalogue.
  - **Observable result:** Opening connection settings from an actual loopback peer automatically
    shows valid Herdr profile candidates. The user can **Import and connect** one or explicitly
    **Import all**. Missing sessions become `Default`, named sessions remain named, and imported
    connections operate independently from later Herdr catalogue changes.
  - **Evidence:** Bridge and browser tests cover empty/unavailable/malformed catalogues, local-only
    disclosure, single and bulk import, explicit activation, session-selector mapping, provenance
    deduplication, refresh differences, manual apply, deletion, and catalogue changes that leave
    imported connections untouched.
  - **Stop and revisit:** Stop if discovery requires copying credentials or arbitrary SSH settings,
    import silently enables without a user action, profile provenance becomes runtime identity, or
    catalogue refresh silently mutates a World connection.

- [ ] 3.3 Feed Local and one SSH-backed runtime through the existing qualified `WorldModel`.
  - **Owner:** World owns registry and model qualification; Herdr owns each native snapshot.
  - **Observable result:** Local and remote Herdr entities appear in Spaces, Tree, Graph, and Office
    through `WorldRuntimeSource`, with equal native IDs isolated by gateway, runtime, and generation.
  - **Evidence:** Model, browser, and live tests show one model containing both runtimes and no
    presentation-specific or parallel topology store.
  - **Stop and revisit:** Stop if Herdr or SSH details leak into presentation code, a parallel
    topology model appears, or any action/state is admitted with an unqualified identifier.

- [ ] 3.4 Preserve independent startup, failure, command, and terminal routing.
  - **Owner:** World owns registry supervision, allow-listed dispatch, and same-origin adaptation.
  - **Observable result:** Healthy Local survives all remote failures; a healthy remote survives
    Local restart; structural commands, launchers, and terminals stay on their selected runtime.
  - **Evidence:** Integration tests and the live fixture cover both startup failure directions,
    reconnect, equal IDs, delayed old results, and remote process failure.
  - **Stop and revisit:** Stop if one runtime blocks another, a failed operation is retried on a
    different runtime, or stale generations regain control.

Checkpoint 3 is an architectural proof. It does not enable the feature or make the change ready to
merge.

## 4. Complete product acceptance

- [ ] 4.1 Complete transport recovery, bounds, and diagnostics.
  - **Owner:** World owns connection retry, timeout, cancellation, process cleanup, generation
    fencing, and bounded user-facing state.
  - **Observable result:** Authentication, host-key, DNS, SSH, remote Herdr, protocol, sleep/wake,
    disconnect, and restart failures remain connection-local and recover without stale control.
  - **Evidence:** Unit, integration, and live failure tests cover the supported platforms and the
    actual managed-service environment without logging targets, usernames, or credential material.
  - **Stop and revisit:** Stop if World must answer prompts, parse unstable output for correctness,
    leak environment-specific data, or cannot terminate orphaned SSH processes.

- [ ] 4.2 Complete bounded remote upload delivery.
  - **Owner:** World owns upload policy; the bounded connection mechanism owns byte delivery; the
    Herdr adapter owns insertion into the selected pane; OpenSSH owns authentication.
  - **Observable result:** A validated upload creates a private remote path for the selected current
    runtime and inserts only that path into its pane, with cleanup on cancellation or failure.
  - **Evidence:** Tests cover images and generic files, bounds, hostile names, overwrite, conflicts,
    partial transfer, remote errors, cleanup, and retired generations.
  - **Stop and revisit:** Stop if the browser can choose a remote path or shell text, a local path is
    inserted remotely, or transfer can escape its bounded private destination.

- [ ] 4.3 Complete runtime-qualified World data and terminal resource limits.
  - **Owner:** World owns notes, pins, activity, migration, pruning, viewer fan-out, backpressure,
    idle reaping, and per-runtime/global limits.
  - **Observable result:** Equal native IDs cannot overwrite each other, existing records migrate to
    Local, and multiple viewers remain ordered and bounded across disconnect and reconnect.
  - **Evidence:** Persistence, model, bridge stress, and browser tests cover collisions, offline
    state, corrupt stores, slow viewers, reattachment, and stale frames.
  - **Stop and revisit:** Stop on cross-runtime data mutation, unbounded resource use, or control
    before a fresh compatible surface.

- [ ] 4.4 Complete connection settings, browser access policy, and security acceptance.
  - **Owner:** World owns settings authorization, Host/Origin/CSP/password policy, disclosure,
    command admission, desktop and Android behavior.
  - **Observable result:** One gateway profile exposes qualified Local and remote Herdr runtimes;
    no remote World listener is required; direct bridge profiles remain compatible; connection
    editing and Herdr profile import remain actual-loopback local management and cannot become a
    general SSH or Herdr proxy.
  - **Evidence:** Browser, accessibility, responsive, API, privacy, and security tests cover
    connection lifecycle, hostile requests, non-loopback disclosure, and desktop/phone flows.
  - **Stop and revisit:** Stop if credentials reach the browser, runtime access bypasses admission,
    or non-loopback exposure understates authority over enabled connections.

- [ ] 4.5 Compare and contribute the proven Herdr boundary upstream without blocking delivery.
  - **Owner:** World owns downstream delivery and Herdr Web synchronization; upstream maintainers own
    acceptance into Herdr Web.
  - **Observable result:** The Herdr adapter and connection-mechanism contract and evidence are
    compared with current Herdr Web; reusable bridge work is proposed upstream, or the downstream
    compatibility reason is recorded.
  - **Evidence:** Link the upstream proposal or the recorded comparison. If upstream later lands an
    equivalent implementation, rerun conformance before adopting it through normal synchronization.
  - **Stop and revisit:** Stop adoption if upstream behavior weakens connection concurrency,
    qualification, security, or compatibility; upstream acceptance itself is not a merge gate.

- [ ] 4.6 Pass final live acceptance and repository delivery checks.
  - **Owner:** World owns final acceptance.
  - **Observable result:** Local plus one remote Herdr support concurrent events, commands,
    launchers, two browser terminals, a native client, failure/recovery, notes, pins, activity, and
    uploads through one origin in the shipped managed environment; at least one remote connection
    is created through Herdr profile import.
  - **Evidence:** Record exact revisions and complete live results; update architecture, federation,
    development, security, plugin, vendoring, knowledge map, Android/gateway, compatibility, current
    specs, and Unreleased changelog; regenerate notices if dependencies changed; pass strict
    OpenSpec validation, acceptance checks, and the complete repository check.
  - **Stop and revisit:** Keep the pull request draft and unmergeable if any required live,
    security, privacy, compatibility, or repository check is missing or fails.
