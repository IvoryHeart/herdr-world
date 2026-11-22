## Context

See [proposal](proposal.md) for the selected real-IDE direction and
[research](../../../docs/design/code-view/research.md) for primary sources and
owner decisions. World is one Bun service with a same-origin browser app,
service-owned local/OpenSSH connections and externally owned runtimes. Code is
a projection within that shell, not a replacement runtime or custom editor.

Existing seams: `server/src/rpc/integration.ts` manages World harness skills on
the service host; `web/src/agentIntegrations.ts` handles host-specific Herdr
integration evidence. The [harness guide](../../../docs/harness-integrations.md)
and [integration direction](../world-harness-integration/proposal.md) establish
managed-file ownership/status/removal. They do not implement a remote IDE API.
`web/src/world/CoreTerminalWatch.tsx` shows core's screen-watch/typing semantics;
it is not a raw PTY. `server/src/rpc/files.ts` remains current World browsing,
not the new IDE filesystem transport. Review the existing connection, SSH,
authentication and terminal owners before any implementation.

## Goals / Non-Goals

The proposed outcome is installed real VS Code in World's center, with the same
host/room/agent context, IDE integration selection and per-project desktop handoff.
VS Code retains its native editing, Source Control, extensions, profiles and trust
prompts.

No implementation in this PR. No custom save API/editor, fork/bundled IDE,
Herdr/core API changes, multi-user hosting, generic remote-port forwarding,
World-managed Microsoft accounts, silent extension installation or promise that
all desktop extensions run on the web. Desktop handoff is an IDE integration,
not proof that its client can be detected from a browser.

## Decisions

### Installed providers under the existing integration direction

Add an IDE integration kind without reinterpreting existing harness names or
changing skill behavior. Proposed provider capabilities are `webWorkbench`,
`desktopHandoff` and `worldTerminalProfiles`; support is observed per installed
version/platform. A per-host record distinguishes detected, not installed,
disabled, enabled, incompatible and blocked, with a reason and version evidence.
Discovery is read-only and never starts a process, accepts terms or downloads.
Enabling records intent; an explicit start/open action may start a **known installed**
server after shell/write and licence consent. Future installation assistance is
separate explicit work, not an effect of opening a room.

Prefer Microsoft `code serve-web` for ecosystem compatibility. OpenVSCode and
code-server are explicitly different providers with Open VSX trade-offs; never
fallback silently. Adapter-owned validated argument arrays/URI encoders replace
arbitrary command templates. Existing local skill RPCs need a new host-qualified
IDE contract; these descriptor names are design sketches, not shipped API names.

### Identity, files and desktop handoff

Project admission captures immutable connection ID, connection lifecycle epoch,
runtime kind/generation, workspace ID/generation, admitted project/checkout root
identity/revision and, for an agent checkout, verified agent occurrence/session.
The server descriptor adds provider ID, executable identity/version, upstream server
commit, enable-policy revision, host OS/user context, data/profile identity and
an opaque server-instance ID. Runtime/session identities are not interchangeable
with server-instance or browser-resource epochs. TUI and core connections on the
same machine are not deduplicated by display hostname; reuse needs proven shared
host-user identity, otherwise separate sessions.

Revalidate admission and enablement before start/open/attach and before publishing
results. Missing/ambiguous roots require an explicit choice. An agent terminal
selection alone does not switch checkout. VS Code's backend runs **by the files**
and handles its own filesystem/Git/toolchain traffic; World does not forward a new
editor save protocol over `file.*`. Opening a folder does not make it a sandbox:
the owner grants the IDE the host user's shell/file authority. Keep the IDE's
Workspace Trust and extension prompts rather than claiming World confines it to
that folder. Concurrent changes/conflicts are the real IDE's behavior, not a
universal World compare-and-swap guarantee.

Desktop handoff retains that exact host and checkout and is a separate user click.
For a local-to-browser project, an allowlisted VS Code/Cursor URL adapter can open
it; a service-local path on a different browsing device is **not** client-local.
Remote projects need the provider's supported SSH/Gateway/remote URI or guided
copyable host/project instructions. [VS Code remote CLI](https://code.visualstudio.com/docs/remote/ssh#_opening-a-terminal-on-a-remote-host),
[Gateway](https://www.jetbrains.com/help/idea/remote-development-starting-page.html)
and [Zed SSH](https://zed.dev/docs/remote-development) have distinct protocols;
never invent a universal `vscode://file` URL for remote roots. Validate authority,
encode paths, never include World credentials, and do not execute a GUI on the
World service host. Browser client availability can be unknown despite host
server detection. Refusal leaves the project selected; no fallback host or path.

### Same-origin workbench transport: feasibility first

Proposed flow (route syntax is illustrative, not an API commitment):

```text
World browser /code (existing owner session)
  -> World /ide/<opaque-session>/... HTTP + WebSocket
    -> fixed admitted local socket/loopback upstream
       OR private OpenSSH forward -> remote socket/loopback upstream
         -> installed VS Code web server -> host files/extensions/toolchains
```

The browser never reaches an SSH host or remote World bridge directly. Remote
server start uses only the captured saved connection and existing OpenSSH policy;
no arbitrary SSH options, passwords or private keys are stored. Installation/start
permission and host prerequisite checks are explicit. No Microsoft/Azure tunnel is
started implicitly. Retiring the connection invalidates its forwards and sessions.
Unsupported OS/version returns unavailable, never tries Unix commands on Windows.

The official CLI exposes base-path/token/data-dir controls, but every admitted
release must prove base-path assets, redirects, cookie paths/names, WS upgrade and
reconnect, folder URLs, sign-in popups/callbacks, webview origins and worker scope.
Use secure contexts: trusted loopback or HTTPS. Do not export a root service-worker
scope or let an IDE worker intercept World/PWA resources. Deny arbitrary upstream
URLs/redirect destinations, cross-session routing, and access to the IDE's generic
forwarded-ports proxy unless separately reviewed. Scope/filter upstream headers,
including cookies, CSP, frame-ancestors and Service-Worker-Allowed. A failed frame
policy is a refusal, not licence to strip protections until the iframe loads.

Official webviews may use a Microsoft CDN. A compatible distribution-supported,
licence-permitted self-hosted configuration could pass; asset rewriting and blanket
CDN/CSP allowances are not proposed. If full functionality cannot coexist with the
current single-origin policy, block embed and offer desktop handoff. A separate
origin/changed webview policy requires an owner decision and revised architecture;
the mock is not evidence that the current policy can deliver all official features.
Marketplace/Sync/extension sign-in may also require external HTTPS/popups;
upstream's CSP includes unsafe-eval and blob workers. Enumerate actual origins and
directives for the selected release; proxying its HTML alone does not satisfy the
single-origin boundary or justify carrying upstream's broad policy into World.
Microsoft server terms are another explicit gate: owner installation/nonbundling
alone does not resolve restrictions on combining/hosting for others.

### Full shell/write trust, authentication and extension pairing

Require the authenticated owner session on every HTTP request and WS upgrade;
check Origin/CSRF as appropriate and revalidate session enablement/connection.
Logout, disablement or retirement revokes and closes active streams. Keep the
upstream connection token service-side in protected storage (remote token file
where supported), inject it only into that fixed admitted upstream, redact logs,
and never expose it in browser URLs, referrers, history or persistent browser
storage. Browser credentials must not override upstream authentication; upstream
cookies must not overwrite World login. Spikes must prove cookie/WS behavior,
not assume one auth-header rewrite handles all upstream protocols.

**Same-origin iframe code has World's browser authority.** Path scoping and
HttpOnly cookies do not isolate a full workbench or its extensions from World.
Enable only after the owner explicitly trusts that IDE/extension set; do not
present iframe sandbox flags as both isolation and full functionality. If this
trust is unacceptable, an isolated origin would require a different decision.

The World extension gets a separate expiring, revocable capability scoped to
connection, runtime generation, project/session and allowed terminal operations.
Pairing happens explicitly through an authenticated World flow and the extension's
secret storage; never workspace files, logs, owner login token or general host
RPC. When the extension runs on an SSH host, its narrow callback channel must use
the admitted SSH transport/private relay, not require public World or embed a
service-host localhost URL. Capability revoke/expiry closes the attach; reconnect
needs current admission, no replay of uncertain keys. The IDE's own normal shell
terminals remain the IDE's authority, not World-attached agent terminals.

### World terminals inside the real workbench

A separately packaged small World extension contributes profiles such as
**World: Scout — Orchard (core)** and **World: Finch — Field notes (Herdr TUI)**.
A `TerminalProfileProvider` discovers admitted targets; a `Pseudoterminal`
adapts their output/input/dimensions through the paired capability. Opening a
profile attaches an existing target, not `herdr`, `hc` or another agent process.

TUI attach uses the existing qualified raw stream/owner rules. **Attach resizes
the pane for every viewer**, including terminal viewers outside VS Code. Warn
before attach and any control/resize takeover; use one authorized resize owner
rather than promise independent sizes. Profile selection begins in observation,
but observe attach can itself have a shared-size effect and must disclose it.

Core uses its screen-watch and guarded typing/resize semantics; validate screen
to terminal escape rendering, alternate screens, Unicode, keyboard modes and
control acquisition. No raw-PTY assertion. A failed adapter disables only the
core profile with an explanation. No fallback to a similarly named TUI pane.
Focus in the editor must never send keys to an attached terminal. Closing the
profile, switching away or losing authority detaches/releases World input demand;
closing Code never kills Herdr agents. No queued/replayed keys after disconnect.
VS Code may retain server/extension hosts independently; hiding Code suspends the
World extension's attach demand through a narrow authenticated lifecycle signal,
not arbitrary window messages or assumptions that an iframe has unmounted.

### Project activity and lifecycle

World keeps agent status, attention and qualified PR linkage alongside the IDE.
VS Code Source Control shows actual working-tree changes; a World PR card may
request the matching native diff through the companion extension after checking
repository/checkout/branch evidence. No association by branch/display name alone,
no inferred line authorship, and no new World merge/approve/write contract. Missing
evidence is unavailable; stale PR badges remain labelled and non-actionable.

Resource ownership distinguishes externally started servers from World-started
children. Start on demand, reuse only a compatible host/user/provider/profile
instance, enforce measured server/window limits, and show active/open state.
Window close detaches clients; it is not stop-server. Idle shutdown applies only
to World-owned instances after no clients/terminal demand and explicit idle policy;
external instances are detached, never killed. Explicit stop explains affected IDE
sessions and never ends Herdr agents. Partial start/reply loss is uncertain:
reconcile the captured instance before retry, avoid duplicate server processes.
No automatic restart across a retired connection or silently open ports on LAN.

## Risks / Trade-offs

- Official ecosystem compatibility vs Microsoft distribution terms and CDN webviews
  -> licence and full-workbench feasibility gates before enablement; handoff on block.
- Full IDE features vs same-origin World authority -> explicit owner trust; no false
  isolation claim. An isolated-origin alternative requires a separately reviewed policy.
- Desktop familiarity vs independent server state -> user-managed Sync/import and
  version-specific compatibility evidence; no shared live data directory or secret copy.
- Multiple projects/servers vs resources -> measure local/SSH cold/warm and active/idle
  costs, admit bounded demand and retain process ownership records.
- Terminal fidelity vs different runtime protocols -> separate TUI/core consumers,
  shared-resize disclosure and capability refusal when evidence is absent.

## Verification and migration plan

This PR changes only research, proposed deltas and isolated static fixture behavior.
No production contract owner/adapter in `verification/coverage/` is modified.
Direct DOM interaction and rendered layout checks are appropriate evidence for a
no-network synthetic mock; a Quint UI model would not validate an IDE proxy.

For future implementation derive invariants from requirements first. Assess Q01,
Q16, Q19, Q20, Q23, Q31, Q33, Q40, Q43 and core Q52/Q53 against actual ownership;
use maintained ordering/ownership/recovery models where applicable, add adapters
and negative controls for new transitions, and preserve mandatory consumers.
Run full required behavioral verification for changed owners, not just focused cases.
Separately verify real browsers, SSH/Windows/Unix, external writes, auth/revocation,
WS/worker/CDN origin behavior, all four named extension families, settings/profiles
and resource cleanup. Mock tests cannot promote production coverage or extension parity.

Do not ship `/code` or any proxy until licence/owner trust and technical gates are
accepted and a separately authorized implementation passes independent review.
Rollback removes the integration route and revokes World capabilities/owned sessions
without deleting IDE data or ending agents. Update FEATURES/architecture/usage docs
only to actual delivered behavior; synchronize/archive specs only after acceptance.
When Code ships **or this proposal is rejected**, remove all three public mock
assets, their focused tests/docs references and lower the asset-count allowance by
three (currently 189 to 186; account for intervening changes). No data migration now.
