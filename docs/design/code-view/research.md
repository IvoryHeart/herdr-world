# Real IDEs inside World

**Research and decision proposal · 18 November 2026 · #981 / #988.**
The owner has selected real VS Code and IDE integrations. This revision replaces
the earlier custom CodeMirror/read-only-editor recommendation. This PR delivers
research, a [clickable design study](design.md) and an
[OpenSpec proposal](../../../openspec/changes/world-code-view/proposal.md), with no
live IDE, installer, proxy, extension or changes to Herdr/herdr-core.

## Recommendation

Make **Code** another World projection whose center contains the user's installed
VS Code web workbench. Recommend Microsoft's **`code serve-web`** as the first
provider to investigate because the Microsoft Marketplace, Settings Sync and
existing VS Code community are central to the request. World calls the installed
CLI/server on the project's host; it never bundles, forks or replaces the IDE.
VS Code owns files, editing, Git, debugging, extensions and its own trust prompts.
World keeps hosts, rooms, agent identity, attention and project selection.

Treat **IDEs as integrations**, detected and enabled per host, opened per project.
Offer desktop handoffs to VS Code, Cursor, JetBrains Gateway, Zed and further
providers through that seam. Do not build a parallel editor or promise every
desktop extension works in a browser.

phone: whatever VS Code web does

This is a **gated recommendation**, not proof that embedding is deployable.
Microsoft's [server licence](https://code.visualstudio.com/license/server) permits
use with licensed VS Code and restricts hosting/sharing and combining it with
applications for others. Calling an owner-installed server avoids redistribution;
it does **not** settle whether this particular integration is permitted. Confirm
the intended personal/local-first use with the licensor or appropriate review
before enabling this provider. If terms or same-origin compatibility cannot be
satisfied, keep that embed unavailable, explain why, and offer an explicit desktop
handoff. Do not silently replace it with an Open VSX fork or loosen World's CSP.

## Options and prior art

Primary sources were checked on the date above. Size figures below are named
**compressed Linux server archives**, not browser transfer or resident memory.
No IDE was installed or benchmarked in this research. World packages **zero IDE
bytes** for every external-server/handoff option. Maintenance judgments
are design assessments. Source licences do not cover every distributed extension.

| Option | Licence, size and updates | Ecosystem and configuration | Origin and maintenance |
| --- | --- | --- | --- |
| **Microsoft `code serve-web`** — preferred candidate | Distributed VS Code/server uses [Microsoft terms](https://code.visualstudio.com/license/server); Code OSS source is MIT. [Official CLI implementation](https://github.com/microsoft/vscode/blob/main/cli/src/commands/serve_web.rs) downloads/caches a separate server and checks releases. CLI size alone omits that payload; installed/cache size and RAM unmeasured. User accepts terms; World must not add the acceptance flag silently. Upstream owns updates; World records and retests observed version/commit. | Microsoft Marketplace and built-in Settings Sync are the closest match to the owner's desktop ecosystem. Web/runtime eligibility and extension licences still apply. Desktop installation does not imply the server shares its user-data, profile or extensions directories. | Loopback server, authenticated World HTTP/WS proxy and compatible base path required. Default CDN webviews, workers and browser auth need a feasibility gate. Medium/high adapter cost; no custom editor maintenance. |
| **OpenVSCode Server** — explicit alternative | [MIT](https://github.com/gitpod-io/openvscode-server/blob/main/LICENSE.txt). [1.109.5 Linux x64 archive](https://github.com/gitpod-io/openvscode-server/releases/tag/openvscode-server-v1.109.5): 76,686,959 bytes. User installs/updates its distribution; World probes compatibility after updates. | Open VSX, not Microsoft's Marketplace. Separate server settings/extensions; no promise of Microsoft Settings Sync or shared desktop profiles. VSIX only where its licence permits. | [Token protection must be configured](https://github.com/gitpod-io/openvscode-server#securing-access-to-your-ide); unauthenticated defaults are unacceptable for World. Base-path/webview behavior needs version-specific proof. High integration lifecycle/security cost. |
| **code-server** — explicit alternative | [MIT](https://github.com/coder/code-server/blob/main/LICENSE). [4.145.2 Linux amd64 archive](https://github.com/coder/code-server/releases/tag/v4.145.2): 236,495,502 bytes. User owns package updates. [Minimum recommendation](https://coder.com/docs/code-server/requirements): 1 GB RAM and 2 cores, not a measured World budget. | Open VSX; its [FAQ](https://coder.com/docs/code-server/FAQ) documents separate data/extensions locations and Microsoft Marketplace restrictions. Import/copy selected settings deliberately; do not point two products at one live data directory. Built-in Microsoft Sync is not promised. | [Subpath reverse proxy](https://coder.com/docs/code-server/guide) and self-contained webviews make same-origin hosting more tractable. Still a full shell/write trust boundary. More downstream patches, auth and update surface to maintain. |
| **Desktop IDE handoff** — VS Code, Cursor, JetBrains Gateway, Zed | Each installed product keeps its own licence/update channel; no IDE browser payload. [VS Code CLI/URLs](https://code.visualstudio.com/docs/configure/command-line), [Cursor SSH](https://cursor.com/docs/remote-development/ssh), [Gateway SSH](https://www.jetbrains.com/help/idea/remote-development-starting-page.html), [Zed remote development](https://zed.dev/docs/remote-development). | Best continuity with that client’s actual profiles, installed UI extensions and keybindings. Remote workspace extensions may still be separate. Gateway/Zed provision their own remote backend under their rules. | Browser confirms a client-side handoff; host-side detection cannot prove an IDE is installed on the browsing device. No iframe/CSP problem. Low/medium launch-adapter cost; preserve exact host/path, do not launch a service-host GUI by accident. |
| **VS Code Remote-SSH / Tunnels** — placement precedent | Microsoft's [remote FAQ](https://code.visualstudio.com/docs/remote/faq) and [Tunnels](https://code.visualstudio.com/docs/remote/tunnels) describe separately installed servers, updates and authenticated channels. No single artifact size; client/server/extensions vary. | Real VS Code with remote workspace extension hosts; not automatic reuse of all local extensions. Tunnels add Microsoft/GitHub identity and a `vscode.dev` client. | Remote-SSH places tools beside files and carries transport through SSH: copy that placement principle. A `vscode.dev` tunnel URL is a different origin, not the World embed; offer only as a separately explained handoff if later selected. |
| **World extension in VS Code** — companion, not editor replacement | Small World-owned extension could use MIT; package size unmeasured. Installed IDE and extensions retain separate terms. Independent compatibility/release testing needed. | Adds World terminal profiles/agent context to the real workbench. It does not recreate an editor. Workspace extension host is preferred where process APIs are needed. | Narrow paired credentials; never reuse World's owner login. Web-only extensions run in workers without Node process APIs. Does not itself solve embedding. Medium adapter/credential cost. |
| **Monaco / CodeMirror in World** — rejected as the Code view | [Monaco MIT](https://github.com/microsoft/monaco-editor), [CodeMirror MIT](https://github.com/codemirror/view/blob/main/LICENSE). Monaco 0.57.0 [npm unpacked size](https://registry.npmjs.org/monaco-editor/0.57.0) was 101,674,083 bytes, not bundle transfer; CodeMirror already exists for previews, incremental editor bundle unmeasured. | Neither runs the full VS Code workbench or its extensions. World would own editor, language services, saves and configuration. Existing preview components can stay in current World views. | Straightforward same-origin code, but fails the selected ecosystem requirement. Large ongoing custom-product cost. |
| **Eclipse Theia** — rejected for this request | [EPL-2.0](https://theia-ide.org/docs/faq/) platform; frontend/backend and extension sizes depend on the assembled product, unmeasured. | [Separate application framework](https://theia-ide.org/docs/architecture/) with VS Code API compatibility and Open VSX, not the user's actual Microsoft VS Code. | Adds backend, authentication and customization maintenance. Highest custom-platform cost; contradicts lift-and-shift intent. |

Archive bytes were rechecked from each named release's GitHub API `assets[].size`.
They are dated comparison evidence, not install pins or cross-product benchmarks.

## Extension availability: marketplace access is necessary, not sufficient

| Extension family | Official VS Code web with workspace server | OpenVSCode / code-server |
| --- | --- | --- |
| Copilot / Copilot Chat | Microsoft distribution is the supported route to the Marketplace package, account sign-in and service entitlement. Test chat/completions and auth in the embedded web client. | Do not promise Microsoft Marketplace access. [Copilot Chat source is now MIT](https://github.com/microsoft/vscode-copilot-chat/blob/main/LICENSE.txt): saying all Copilot code is proprietary or permanently unavailable outside Microsoft is too broad. A source build/other listing is not proof of supported service access or API compatibility. |
| Pylance | Marketplace package and its [distribution terms](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance) must allow the selected Microsoft runtime; test the remote Python environment. | Do not bypass restrictions by changing gallery URLs or copying a proprietary VSIX. [Pyright](https://github.com/microsoft/pyright) is an alternative, not Pylance parity. |
| Remote-SSH / Remote extensions | Microsoft-product-only distribution/use restrictions apply. Browser access to a server is not desktop Remote-SSH inside a browser: World establishes the SSH transport itself. | Microsoft's Remote suite is not promised. These servers already run by the files; they do not need a nested Remote-SSH extension to reach that same host. |
| C# Dev Kit | Microsoft Marketplace and separate [Dev Kit licence/entitlement](https://code.visualstudio.com/docs/csharp/cs-dev-kit-faq), remote .NET SDK and web-client compatibility must all pass. | No promised Dev Kit availability. Open-source C# components are a different offering, not an entitlement workaround. |

The owner's named Marketplace-only examples are therefore **compatibility acceptance
cases**, not a claim that every version of every extension has identical licensing.
Pure UI/native desktop extensions and browser-shortcut limitations remain even on
Microsoft's web client. Test exact package versions, extension-host location, sign-in
and functionality; listing an extension in the gallery is not a passing test.

## Settings, extensions, profiles and updates

Use the owner's installed distribution and supported configuration mechanisms.
The same `.vscode/settings.json`, tasks and launch files follow the actual project;
the IDE's Workspace Trust still governs activation. Personal settings, profiles,
secrets and extensions are different state. [Settings Sync](https://code.visualstudio.com/docs/configure/settings-sync)
can synchronize supported preferences/profiles between Microsoft clients after
user sign-in, but [remote extensions are not automatically synchronized](https://code.visualstudio.com/docs/configure/settings#_settings-sync).
Some web settings/state live in browser storage; server/workspace extensions live
on the file host. A new World origin/profile or a different host can therefore
require setup. Verify the chosen `serve-web` release's sync and profile flows;
do not promise bit-for-bit desktop sharing, auto-copy secrets, or share a live
user-data directory between processes. Forks require their own supported import
mechanism and compatible extension installs.

A provider descriptor records product, executable/server version, capability
status and owner-selected data/profile policy per host. `serve-web` can fetch a
new server independently of desktop VS Code: observe actual CLI **and server**
commit, rerun compatibility probes after change, and disable unsupported embeds.
World updates its adapter/extension, never silently updates or replaces a user's
IDE or rolls back their profile. Desktop handoff simply uses the installed client.

## Concrete hurdles and resolution gates

| Hurdle | Proposed solution or blocking condition |
| --- | --- |
| Single origin, base path and HTTP/WS | The browser loads only a World-owned opaque IDE route. The Bun service proxies to an admitted loopback/socket upstream; for SSH, to a private local forward. The [official CLI arguments](https://github.com/microsoft/vscode/blob/main/cli/src/commands/args.rs) include `--server-base-path`, token-file and server-data-dir. Verify actual release redirects, asset URLs, WS upgrades/reconnect, cookie names/paths, folder URLs and auth callbacks under that prefix. A base-path flag alone is not proof. Reject arbitrary upstream URLs, cross-host redirects and generic port proxying. |
| Service workers and webviews | VS Code webviews use workers/service workers and by default Microsoft CDN content; [upstream web-client CSP](https://github.com/microsoft/vscode/blob/main/src/vs/server/node/webClientServer.ts) permits `*.vscode-cdn.net` frames and [Coder's comparison](https://coder.com/docs/user-guides/workspace-access/code-server/) distinguishes self-contained webviews. Test worker scope constrained below the IDE prefix, no root `Service-Worker-Allowed`, no collision with World’s PWA, and secure contexts (HTTPS except browser-trusted loopback). A plain LAN HTTP preview is not evidence of a functioning IDE. Self-host only through a distribution-supported, licence-permitted mechanism. If official webviews need cross-origin frames, embedding is blocked under today's rule; owner must decide a separately reviewed origin-policy change or desktop handoff. Never blanket-allow CDN origins or rewrite signed product assets. |
| Same-origin trust | An iframe/path is not a security boundary. A fully functional same-origin IDE/extension can act with browser World authority; HttpOnly cookies do not prevent authenticated requests. Accept only with explicit owner trust in the installed IDE and its extensions. A genuinely isolated IDE origin would require a separate policy decision. Restrictive iframe sandboxing that breaks VS Code is not a solution. |
| Full shell/write authentication | Require World's authenticated owner session on every proxy request/WS upgrade; revoke streams on logout, disable and connection retirement. Keep upstream token in protected service/host storage, never URLs/history/logs/localStorage. Inject auth only into the fixed admitted upstream; strip browser-supplied upstream credentials and scope/mediate upstream cookies. Pair a separate short-lived, revocable World-extension capability for the exact host/runtime/terminal; never expose owner token to a workspace extension. VS Code retains responsibility for extension/Workspace Trust. |
| SSH hosts | Detect installed IDE servers through the exact saved host connection; never start one during discovery. Owner enables and explicitly starts the selected installed server (installation assistance would need its own explicit consent and reviewed host installer). Bind remotely to loopback or a private socket, forward through the service user's OpenSSH configuration and connection lifecycle, then proxy same-origin. Remote files, Git, terminals, toolchains and extension hosts run there. No browser-to-host socket, public server port, SSH password storage or automatic Microsoft tunnel. Unsupported platform/version stays unavailable. |
| Herdr terminals inside VS Code | A small World extension registers terminal profiles via [`TerminalProfileProvider` / `Pseudoterminal`](https://code.visualstudio.com/api/references/vscode-api#TerminalProfileProvider). Profiles attach existing qualified Herdr panes/core terminals rather than spawning a replacement agent. TUI raw stream and core screen-watch/typing need separate adapters. **Herdr attach resizes the pane for every viewer**: warn before attach/control and use existing ownership policy; do not claim independent per-client dimensions. Core requires screen-to-terminal translation and typing/resize admission, not an invented raw PTY. Close detaches only. Unproven core fidelity blocks that profile, not a fallback to TUI. |
| Resource cost | A server has extension hosts, language servers, watchers, PTYs, browser workers and disk caches beyond the CLI. Reuse one compatible server per host/user/provider/data-profile identity when isolation permits; multiple project windows may still multiply extension hosts. On-demand start, bounded active-server slots, visible resource status, explicit stop and idle policy. Never stop an externally owned server or kill Herdr agents on tab close. Benchmark cold/warm start, incremental browser bytes, idle/active RSS, CPU, disk and cleanup across local/SSH Windows/Unix before setting defaults; no fabricated measurements. |

The upstream web-client CSP also uses `unsafe-eval`, blob workers and broad
HTTPS/WebSocket connections. Marketplace, Settings Sync and extension account
flows can add external requests/popups beyond webviews. The spike must enumerate
these actual origins and required directives for the installed release, compare
them with World's current policy, and reject incompatible behavior. Proxying the
initial HTML under a path does not itself bring its dependencies onto one origin.

## Where this fits the existing system

The [per-harness integration direction](../../../openspec/changes/world-harness-integration/proposal.md)
and [current harness guide](../../harness-integrations.md) supply install/status/remove
and user-owned configuration precedents. Settings already has per-host Herdr rows;
[`agentIntegrations`](../../../web/src/agentIntegrations.ts) parses those.
[`world.integration.*`](../../../server/src/rpc/integration.ts) currently manages
skills **on the service host only**. It is not a generic remote IDE launcher.
Extend the integration model with an IDE kind and host-qualified adapters in a
future implementation, preserving harness behavior rather than overloading harness
names or pretending SSH IDE support exists. See the [architecture](../../../openspec/changes/world-code-view/design.md)
for proposed identities, transport, ownership and acceptance evidence.

## Decisions only the owner can settle

Real VS Code, no custom editor and IDE integrations are settled direction.
The remaining decisions do not require an answer during this research run:

1. If Microsoft embedding terms cannot be cleared, is explicit desktop handoff
   sufficient, or is an explicitly selected Open VSX provider acceptable despite
   missing ecosystem parity? Recommend handoff; never change provider silently.
2. If official webviews require their CDN origin, may a future separately reviewed
   policy permit an isolated IDE origin/external webview, or must embed remain
   unavailable? Recommend preserving the current single-origin rule for now.
   Decided in [webview-origin.md](webview-origin.md): World's pages keep one origin,
   and IDE pages admit VS Code's own webview origin, so stock VS Code and
   OpenVSCode webviews load from it.
3. Will the owner trust installed IDEs/extensions with the same browser authority
   as World? Recommend explicit opt-in; isolation needs a different origin design.
4. Should a later implementation offer host installation assistance, and which
   IDE/extension/platform matrix is release-blocking? Recommend installed-server
   discovery first, explicit start, and all four named extension families tested
   on the chosen Microsoft version. Resource defaults follow measurements.

These gates are part of the proposal; no conditional implementation is authorized
by this PR and no owner decision is inferred from the mock.
