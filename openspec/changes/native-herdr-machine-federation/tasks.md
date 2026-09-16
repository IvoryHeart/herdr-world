These checkpoints remain one coherent change and execute in order. Each implementation checkbox
requires the named observable evidence; source code or mocked SSH tests alone are insufficient.
This pull request remains draft until checkpoint 4 passes.

## 0. Reconcile the transport decision

- [x] 0.1 Record the current Herdr remote-path investigation.
  - **Owner:** World owns the compatibility and architecture decision.
  - **Observable result:** Evidence distinguishes the working SSH-backed Herdr client path from the
    missing public long-lived `--machine` stream and explains why the latter is no longer a product
    blocker.
  - **Evidence:** `docs/evidence/checkpoint1-herdr-connection.md` records the pinned release,
    current-master source audit, live SSH-agent authentication, remote control, and snapshot result.
  - **Stop and revisit:** Revisit if the recorded remote relay cannot carry the same API and terminal
    protocols used by the existing local bridge.

- [x] 0.2 Preserve SSH-agent discovery in generated managed-service environments.
  - **Owner:** World owns its plugin service definition; OpenSSH owns agent use.
  - **Observable result:** When `SSH_AUTH_SOCK` is present at service generation, systemd-user and
    launchd definitions pass it to the World bridge without recording key material.
  - **Evidence:** Focused plugin tests cover both generated supervisor definitions.
  - **Stop and revisit:** Revisit if the shipped supervisor cannot inherit a usable agent socket or
    requires World to copy credentials.

## 1. Prove the Herdr connector

- [ ] 1.1 Define the minimal Herdr connector contract and profile schema.
  - **Owner:** World owns the connector and profile lifecycle; Herdr owns protocol semantics;
    OpenSSH owns SSH policy.
  - **Observable result:** The existing local socket and one SSH-backed target can each produce
    independent API connections, terminal-ID connections, generation state, and bounded diagnostics
    through one Herdr-specific interface.
  - **Evidence:** Focused Rust tests cover profile validation, fixed argv construction, connector
    lifecycle, independent connection creation, and redaction without a shell or embedded secrets.
  - **Stop and revisit:** Stop if the seam needs World presentation types, browser-visible
    credentials, arbitrary SSH flags or commands, or cannot isolate connection lifetimes.

- [ ] 1.2 Implement the smallest SSH-backed socket relay against the pinned Herdr surface.
  - **Owner:** World supervises the connector process; OpenSSH selects target/authentication;
    remote Herdr connects the relay to its selected session socket.
  - **Observable result:** A configured profile establishes a compatible remote Herdr API connection
    without a remote World installation or browser-reachable listener.
  - **Evidence:** Integration tests cover process startup, exit, timeout, cancellation, malformed
    targets, missing agent, missing/incompatible Herdr, and bounded diagnostics; provenance names
    the exact Herdr relay surface consumed.
  - **Stop and revisit:** Stop if implementation requires a shell, stored key material, interactive
    prompt handling, unbounded stderr, or remote World code.

- [ ] 1.3 Prove live snapshot, subscription, commands, and launcher concurrency.
  - **Owner:** World owns connector concurrency and recovery; Herdr owns API results and events.
  - **Observable result:** Through the managed World service environment, Local and one real SSH
    profile return complete snapshots, establish subscriptions without an event gap, and complete
    layout, pane, and launcher operations while the remote subscription remains open.
  - **Evidence:** A reproducible live fixture records the exact revisions, protocol, agent
    availability, an event caused by a concurrent command, and independent progress of every
    connection.
  - **Stop and revisit:** Stop if the relay works only in an interactive shell, serializes the
    subscription ahead of other clients, or omits required snapshot fields.

## 2. Prove terminal compatibility

- [ ] 2.1 Route explicit terminal-ID streams through the connector.
  - **Owner:** World owns connection supervision and browser adaptation; Herdr owns terminal IDs and
    terminal protocol behavior.
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

- [ ] 3.1 Add bounded World-owned remote profile persistence and lifecycle.
  - **Owner:** World owns opaque IDs, labels, targets, sessions, enabled state, validation, and
    generation retirement; OpenSSH configuration remains user-owned.
  - **Observable result:** An authorized user can add, edit, enable, disable, and remove a remote
    Herdr profile without storing keys or exposing a general SSH/command interface.
  - **Evidence:** Bridge, persistence, recovery, and security tests cover corrupt data, collisions,
    hostile values, bounds, redaction, restart, and generation changes.
  - **Stop and revisit:** Stop if stable identity depends on mutable targets, profile input can alter
    connector argv structure, or routine runtime payloads disclose connection details.

- [ ] 3.2 Feed Local and one SSH-backed runtime through the existing qualified `WorldModel`.
  - **Owner:** World owns registry and model qualification; Herdr owns each native snapshot.
  - **Observable result:** Local and remote Herdr entities appear in Spaces, Tree, Graph, and Office
    through `WorldRuntimeSource`, with equal native IDs isolated by gateway, runtime, and generation.
  - **Evidence:** Model, browser, and live tests show one model containing both runtimes and no
    presentation-specific or parallel topology store.
  - **Stop and revisit:** Stop if the connector leaks into presentation code or any action/state is
    admitted with an unqualified identifier.

- [ ] 3.3 Preserve independent startup, failure, command, and terminal routing.
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
  - **Owner:** World owns connector retry, timeout, cancellation, process cleanup, generation
    fencing, and bounded user-facing state.
  - **Observable result:** Authentication, host-key, DNS, SSH, remote Herdr, protocol, sleep/wake,
    disconnect, and restart failures remain profile-local and recover without stale control.
  - **Evidence:** Unit, integration, and live failure tests cover the supported platforms and the
    actual managed-service environment without logging targets, usernames, or credential material.
  - **Stop and revisit:** Stop if World must answer prompts, parse unstable output for correctness,
    leak environment-specific data, or cannot terminate orphaned connector processes.

- [ ] 4.2 Complete bounded remote upload delivery.
  - **Owner:** World owns upload policy and connector delivery; OpenSSH owns authentication.
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

- [ ] 4.4 Complete profile settings, browser access policy, and security acceptance.
  - **Owner:** World owns settings authorization, Host/Origin/CSP/password policy, disclosure,
    command admission, desktop and Android behavior.
  - **Observable result:** One gateway profile exposes qualified Local and remote Herdr runtimes;
    no remote World listener is required; direct bridge profiles remain compatible; profile editing
    cannot become a general SSH or Herdr proxy.
  - **Evidence:** Browser, accessibility, responsive, API, privacy, and security tests cover profile
    lifecycle, hostile requests, non-loopback disclosure, and desktop/phone flows.
  - **Stop and revisit:** Stop if credentials reach the browser, runtime access bypasses admission,
    or non-loopback exposure understates authority over enabled profiles.

- [ ] 4.5 Compare and contribute the proven seam upstream without blocking delivery.
  - **Owner:** World owns downstream delivery and Herdr Web synchronization; upstream maintainers own
    acceptance into Herdr Web.
  - **Observable result:** The connector contract and evidence are compared with current Herdr Web;
    reusable bridge work is proposed upstream, or the downstream compatibility reason is recorded.
  - **Evidence:** Link the upstream proposal or the recorded comparison. If upstream later lands an
    equivalent connector, rerun conformance before adopting it through normal synchronization.
  - **Stop and revisit:** Stop adoption if upstream behavior weakens connector concurrency,
    qualification, security, or compatibility; upstream acceptance itself is not a merge gate.

- [ ] 4.6 Pass final live acceptance and repository delivery checks.
  - **Owner:** World owns final acceptance.
  - **Observable result:** Local plus one remote Herdr support concurrent events, commands,
    launchers, two browser terminals, a native client, failure/recovery, notes, pins, activity, and
    uploads through one origin in the shipped managed environment.
  - **Evidence:** Record exact revisions and complete live results; update architecture, federation,
    development, security, plugin, vendoring, knowledge map, Android/gateway, compatibility, current
    specs, and Unreleased changelog; regenerate notices if dependencies changed; pass strict
    OpenSpec validation, acceptance checks, and the complete repository check.
  - **Stop and revisit:** Keep the pull request draft and unmergeable if any required live,
    security, privacy, compatibility, or repository check is missing or fails.
