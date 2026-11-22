## Purpose

Define a real installed-IDE projection of World with qualified per-host integrations,
explicit trust, secure transport, project handoffs and existing runtime terminals.
This is a decision proposal; it does not describe a shipped editor or proxy.

## ADDED Requirements

### Requirement: IDE integrations per host and project

World SHALL represent IDEs within its integrations model, with read-only detection,
explicit enablement per immutable host connection and opening per admitted project.
The provider SHALL identify its installed product/version, web/desktop capability
and availability reason. Discovery SHALL NOT start, install or update an IDE.
World SHALL NOT bundle an IDE, silently accept its terms, change a selected
provider or overwrite user-managed configuration. Existing harness integration
behavior SHALL remain unchanged. Microsoft VS Code web, OpenVSCode, code-server,
VS Code desktop, Cursor, JetBrains Gateway and Zed SHALL be distinct provider
choices/capability records rather than aliases claiming identical functionality.
Every failure to open a project in Code (provider missing on the project's
host, server stopped, open refused, page not secure enough) SHALL say what went
wrong and on which computer, and SHALL offer both Try again (the same open,
or on a page not secure enough a fresh check) and a way back to the provider
list (enable, disable, setup) without leaving Code. A failure SHALL belong to its provider: choosing
another provider SHALL NOT keep showing it.

#### Scenario: Detect without starting

- **WHEN** the owner views IDE integrations for an SSH host
- **THEN** World reports detected, missing, disabled or unsupported providers for that exact connection without installing software, launching a server or altering another host's enablement

#### Scenario: Open disabled or missing provider

- **WHEN** the selected provider is disabled, absent or incompatible on the project's host
- **THEN** World explains the state and offers explicit enablement/setup guidance or another deliberate provider selection without opening another host's IDE

#### Scenario: Recover from a failed open

- **WHEN** opening a project fails because the only enabled provider isn't installed on the project's host
- **THEN** Code names the provider and that computer, offers Try again and Choose another IDE, and choosing another provider from the list it shows replaces the failure with Open in that provider, without installing anything

### Requirement: Real workbench in the common World frame

Code SHALL project the same qualified hosts, rooms, projects, agent occurrences
and terminals as other World views. Its center SHALL display the selected installed
IDE's actual web workbench after feasibility admission; World SHALL NOT substitute
a custom editor or save protocol. The IDE SHALL own editing, Git, extensions,
profiles and Workspace Trust. World SHALL retain host/room/agent/PR context.
Opening a project SHALL preserve the exact connection, runtime generation,
workspace and admitted checkout; ambiguous roots SHALL require explicit selection.
Selecting an agent terminal SHALL NOT silently change the checkout or branch.
The workbench's light or dark appearance SHALL follow World's resolved theme
(the system's when World follows the system) and change live with it; World
SHALL do this through configuration defaults on the workbench page, never by
writing the user's IDE settings, so an explicit setting of the user's own wins.

#### Scenario: Open a room and an agent checkout

- **WHEN** the owner opens a qualified room in Code and explicitly selects an agent's linked checkout
- **THEN** the real workbench opens that checkout on its owning host and the World frame keeps the same room and agents without creating replacements

#### Scenario: World's theme changes while the workbench is open

- **WHEN** the owner switches World from dark to light, or World follows the system and the system switches
- **THEN** the open workbench switches to the user's preferred light theme without reloading, and switches back with World

#### Scenario: Project evidence disappears

- **WHEN** the selected checkout is unavailable or the captured generation/session retires
- **THEN** World revokes actionable project attachment and labels retained context stale without guessing a directory or redirecting to another host

### Requirement: Workbench kept loaded across views

A workbench shown once SHALL stay loaded, at its size, while another project,
view or Spaces is in front, and while World detaches from and reattaches to its
server; its editors, unsaved edits, terminals, webviews and scroll SHALL stay as
they were. Only a page reload, Stop, or its server ending or failing SHALL load
it again, and Code SHALL then say it loaded again.

#### Scenario: Switch to Town and back

- **WHEN** the owner edits a file without saving, opens a webview, switches to Town and back to Code
- **THEN** the same workbench is in front with the edit and the webview unchanged, and nothing loaded again

#### Scenario: Reconnect while the workbench is open

- **WHEN** World detaches from a running server and reattaches to it
- **THEN** the workbench stays loaded behind the detached screen and is in front again once ready, without loading again

#### Scenario: Page reloaded

- **WHEN** the page reloads while a server runs
- **THEN** the workbench loads again and Code says the page reloaded, so it loaded again

### Requirement: Embedding feasibility and full authority admission

An embedded provider SHALL remain unavailable until its distribution terms,
owner licence acceptance, same-origin behavior and explicit full shell/file-write
trust pass admission. World SHALL call installed servers only and SHALL NOT claim
that nonbundling alone grants embedding rights. The owner SHALL be told that an
IDE is not confined to the selected project and same-origin workbench/extension
code shares World's browser authority. Failed licence, frame, worker,
secure-context or origin compatibility SHALL block embedding with a concrete
reason and an explicit desktop handoff option. World SHALL NOT silently relax
its global origin/CSP policy, rewrite restricted product assets or assert desktop
extension parity based only on Marketplace availability.

Webviews load from VS Code's own webview origin. Stock VS Code and OpenVSCode
Server frame webviews and their web worker extension host from
`https://<hash>.vscode-cdn.net`, as their product configuration says; the frame
rule World adds to IDE route responses SHALL admit `https://*.vscode-cdn.net` as
the one origin besides World's own. World SHALL NOT rewrite the webview host page
or `product.json`, serve webviews from its own origin, open a second World origin
for them, or change the policy of World's own pages or any other route. Webview
content (extension panels, notebook outputs, previews of repository files) is
untrusted; it stays cross-origin to World, so it cannot reach World's window,
storage, cookies or API, and its service worker's scope is its own origin. The
decision, its threat model and the rejected options are recorded in
`docs/design/code-view/webview-origin.md`.

#### Scenario: Official webviews load from VS Code's webview origin

- **WHEN** stock VS Code or OpenVSCode Server frames a webview or its web worker extension host from `https://<hash>.vscode-cdn.net`
- **THEN** the frame rule World adds to IDE route responses admits `https://*.vscode-cdn.net` as the one origin besides World's own, and no product file is rewritten
- **AND** World's own pages and every other route keep World's one-origin policy, the webview content stays cross-origin to World so it cannot reach World's window, storage, cookies or API, and its service worker's scope is its own origin

#### Scenario: Webview origin incompatible

- **WHEN** an installed provider requires a webview origin other than VS Code's own `https://*.vscode-cdn.net`
- **THEN** its webviews stay blank with the reason; no further frame exception or Open VSX substitution occurs

#### Scenario: First enable grants broad authority

- **WHEN** the owner enables a compatible installed server
- **THEN** World discloses host-user shell/write and same-origin extension authority, requires explicit consent and upstream licence acceptance, and preserves the IDE's own Workspace Trust prompts

### Requirement: Authenticated private transport and revocation

All embedded browser HTTP/WebSocket traffic SHALL use World-owned same-origin
routes authorized by the current owner session and bound to a fixed admitted
server instance. Upstreams SHALL be private local endpoints or private forwards
through the captured service-owned OpenSSH connection. Browser-supplied arbitrary
upstream destinations SHALL be refused. Server tokens SHALL NOT enter browser
URLs, history, logs or persistent browser storage. Cookies, redirects and worker
scope SHALL NOT overwrite World authentication or intercept World/PWA resources.
Logout, disablement and connection retirement SHALL revoke proxy authority and
close attached streams; retirement SHALL NOT stop the server itself.
Unsupported platforms SHALL be explained without fallback.

#### Scenario: SSH project opens

- **WHEN** the owner explicitly starts/opens an enabled installed IDE for an SSH project
- **THEN** the server runs on that host beside its files and World carries HTTP/WS through its qualified private SSH transport without exposing a remote listener to the browser

#### Scenario: Logout during a workbench connection

- **WHEN** the owner logs out or disables that integration while an IDE WebSocket is open
- **THEN** World closes its streams, rejects subsequent requests and revokes paired World capabilities without replaying input or redirecting to another server

#### Scenario: Foreign route or worker scope

- **WHEN** a request names another session's upstream or an IDE response asks for root service-worker authority
- **THEN** World refuses the request/provider behavior before it can cross its admitted route or intercept World resources

### Requirement: Existing runtime terminals through a World extension

A small optional World extension SHALL provide named terminal profiles attaching
existing connection/runtime-generation/session-qualified Herdr panes and core
terminals. Profile discovery/attachment SHALL NOT launch replacement agents.
The extension SHALL use a separately paired, narrow, expiring and revocable
capability rather than the owner's login token. TUI attachment SHALL disclose
that attaching/resizing changes pane dimensions for every viewer before attachment;
existing control/resize ownership SHALL be respected. Core SHALL use a verified
screen-watch/typing/resize adapter and SHALL NOT be treated as a raw PTY.
Unsupported runtime adapters SHALL refuse with a reason. Editor keystrokes SHALL
NOT become terminal input. Hide/close/retirement SHALL release World attachment
and input demand without ending agents; uncertain input SHALL NOT be replayed.

#### Scenario: Attach a TUI profile with shared viewers

- **WHEN** the owner selects an existing Herdr TUI profile in VS Code
- **THEN** World warns before attach that pane dimensions affect every viewer and uses the current ownership/control path for that exact pane

#### Scenario: Core adapter lacks fidelity

- **WHEN** a core terminal cannot be faithfully represented by the installed extension adapter
- **THEN** that profile is unavailable with a concrete reason and the native World terminal remains available without substituting a TUI pane

#### Scenario: Close or disconnect an attached profile

- **WHEN** the owner closes the profile, leaves Code or loses the captured connection
- **THEN** World detaches the consumer, releases input/resize authority and keeps the existing agent running with no queued keys sent after reconnect

### Requirement: Settings and extension capability evidence

World SHALL use the selected installed IDE's supported settings, profile, extension
and update mechanisms. It SHALL distinguish project configuration, browser state,
server/workspace extensions and desktop user state rather than promise shared
live directories. Microsoft Marketplace/Settings Sync and Open VSX capabilities
SHALL be identified per provider. Version changes SHALL trigger compatibility
revalidation. Copilot, Pylance, Remote and C# Dev Kit SHALL be explicit compatibility
cases with licence, entitlement and web/remote-host limitations recorded.

#### Scenario: Desktop user opens a new server

- **WHEN** the owner's existing desktop profile is not present in the server/web client
- **THEN** World explains the separate state and supported Sync/import path without copying secrets or promising all desktop extensions are already installed

### Requirement: Desktop IDE handoff

World SHALL offer explicit project-qualified desktop IDE handoff through enabled
provider adapters, preserving the exact host and checkout. It SHALL distinguish
host detection from browser-device client availability, validate/encode provider
URIs and omit World credentials. Unavailable clients SHALL receive supported setup
or copyable connection instructions; World SHALL NOT execute a GUI on the service
host or mistake a remote path for browser-local files.

#### Scenario: Open remote project in Gateway or VS Code desktop

- **WHEN** the owner selects a desktop handoff for an SSH project
- **THEN** the chosen adapter supplies a supported remote connection/project handoff for that exact host, with no local-folder substitution, owner-token leakage or silent app launch

### Requirement: Agent activity and pull requests

World SHALL show current agent activity and PR evidence qualified by repository,
checkout, connection and freshness alongside the real workbench. Working-tree
changes SHALL remain the IDE's Source Control responsibility. A linked PR/diff
request SHALL resolve to its verified checkout; branch/name coincidence SHALL NOT
prove association or line authorship. Missing/stale evidence SHALL be explicit and
non-actionable. This view SHALL NOT add World commit/push/approve/merge authority.

#### Scenario: Review an agent's reported change

- **WHEN** the owner selects a verified linked PR from an agent's Code context
- **THEN** the frame shows its qualified branch/check/review evidence and requests the matching native comparison without reassigning all changes to that agent

### Requirement: Bounded server lifecycle and resource ownership

Servers SHALL start only on explicit admitted demand, reuse only compatible proven
host/user/provider/profile instances and use measured active-server/window limits.
World SHALL distinguish external from World-started processes. Closing Code SHALL
detach clients without killing Herdr agents or an externally owned IDE server.
Uncertain starts SHALL be reconciled against the captured instance before retry;
retiring a connection SHALL NOT restart it elsewhere.

Going away SHALL NOT stop a World-started server: closing Code or the browser,
World stopping, restarting or updating, a connection reconnecting or changing
destination, the SSH link dropping and the host being unreachable SHALL leave the
server and every process under it running on its host, with no idle timeout. Such
a server SHALL NOT be tied to World's process or to the transport that started it.
It SHALL carry an identity on its host (World, connection, provider, folder and its
own token) that a later World verifies before reattaching; World SHALL reattach
only to its own server for the same provider and folder, under the connection's
current generation, and a concurrent second start for the same folder SHALL find
the first instead of starting another.

Only the person pressing Stop on that server SHALL stop a World-started server,
after saying that everything running in it ends. Nothing else SHALL stop one:
not closing the view, World restarting or updating, a dropped connection, the
server limit, an idle period, disabling its provider or removing its host's
connection. Disabling a provider or removing a connection with servers still
running SHALL list them first, each with Stop as a separate, explicit choice.
At the server limit World SHALL refuse another start and show the running ones;
it SHALL NOT stop one to make room. Stopping SHALL end the server's whole process
tree on its host, including descendants re-parented out of it. A stop that
cannot reach the host SHALL leave the server listed with the reason.

Every World-started server not known to have ended SHALL be listed per host and
folder with since-when and Stop, and counted against the limit. World SHALL keep
that list durably, so a restart lists every server before any host answers,
including servers on a host World no longer has a connection for. A start whose
answer is lost SHALL count as possibly running, not failed. A server whose SSH
connection was removed SHALL be listed as running but unreachable from World,
with the command that stops it on that host; World SHALL NOT reach it through
another connection, and SHALL drop it from the list only when the person
forgets it.

#### Scenario: Close a project using an external server

- **WHEN** the owner closes Code while its installed server was started outside World
- **THEN** World releases its own attachments/transport demand without stopping the server, deleting IDE state or ending agents

#### Scenario: World restarts while an IDE server runs

- **WHEN** World stops, restarts or updates while a World-started IDE server runs a long task
- **THEN** the server and the task keep running, the restarted World lists the server with since-when and Stop, and reattaches to it without starting another

#### Scenario: SSH link drops

- **WHEN** the SSH forward to a World-started IDE server drops or its connection reconnects
- **THEN** World closes the route and its streams, the server keeps running on the host, and Open reattaches to the same server

#### Scenario: Two starts for one folder

- **WHEN** two starts for the same World, provider and folder race on one host
- **THEN** exactly one server starts and the other start reattaches to it

#### Scenario: Stop races a reattach

- **WHEN** the owner stops a server while World is reattaching to it or opening it again
- **THEN** every process of the old server has ended before any new start for that folder

#### Scenario: A Stop that did not finish

- **WHEN** a Stop was cut off on the host after it began, by a lost answer or a World restart
- **THEN** World keeps the server listed with that reason, starts no other server for that folder meanwhile, and the next Stop or the by-hand command ends what is left

#### Scenario: Open queued behind a connection change

- **WHEN** an Open waits behind another operation on its folder and the connection is removed, reconnects or the provider is disabled meanwhile
- **THEN** the Open starts nothing and is refused (as stale, or as disabled), and the person chooses the project again

#### Scenario: Stop a server with a re-parented terminal

- **WHEN** the owner confirms Stop and a terminal in its own session has lost its parent inside the server
- **THEN** World ends that terminal with the rest of the server's tree on its host, local or SSH

#### Scenario: Start reply lost

- **WHEN** a start may have succeeded but its result is unknown
- **THEN** World lists and counts it as possibly running, reports uncertainty and reconciles that captured instance before any retry instead of launching duplicate servers or switching hosts

#### Scenario: Disable or remove with servers running

- **WHEN** the owner disables an IDE provider or removes a connection while servers World started for it run
- **THEN** the confirmation lists them with Stop for each, confirming stops none of them, and they stay listed until stopped

#### Scenario: Removed SSH host after a restart

- **WHEN** World restarts after the SSH connection of a running server was removed
- **THEN** the server is listed and counted as running but unreachable from World, with the command that stops it on its host, and only Forget takes it off the list

#### Scenario: Server limit reached

- **WHEN** the owner opens another project while the limit of servers runs
- **THEN** World refuses the start, offers the running servers, and stops none of them
