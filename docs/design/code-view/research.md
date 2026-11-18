# A Code view for World

**Decision proposal, 18 November 2026 · issue #981.** The delivered interaction
study uses synthetic data. No editor, file-write API, IDE server or runtime
integration is shipped by this change. Start with the [design and walkthrough](design.md)
and the [OpenSpec proposal](../../../openspec/changes/world-code-view/proposal.md).

## Recommendation

Build Code as another projection in World's React shell. Use the existing
CodeMirror editor family, file/Git services and runtime-specific terminal views.
Put a selected project's explorer, editor and its agents' existing terminals
in a familiar IDE arrangement. Keep Town, Board, Desk, Hosts and Needs you as
World concepts, with the same entity identities and navigation.

Recommend read/review and terminal access first; the mock also explores future
editable buffers. Live saves need an explicit owner decision about concurrent
external writers before they become implementation scope. This gives World a
VS Code–style working surface on desktop and a focused file, agent and review
flow on phones. It does **not** give World the VS Code extension
ecosystem, debugger or language-server suite. If those are essential, choose a
full workbench deliberately; that changes installation, trust and maintenance.
Monaco is a viable desktop editor alternative, but its upstream
[FAQ explicitly excludes mobile browsers](https://github.com/microsoft/monaco-editor#faq).
[CodeMirror advertises native phone selection and editing](https://github.com/codemirror/website/blob/main/site/index.html),
and World already loads it for code previews. Reusing it avoids maintaining two
editor engines before a demonstrated need.

## Evidence and comparison

Primary sources below were checked on the date above. Sizes are deliberately
different measurements: a package's unpacked bytes, a server download and a
browser's transferred JavaScript are **not comparable payloads**. No contender
was installed or benchmarked against a real project. Browser startup, idle RAM,
language services, keyboard/IME behavior and extension compatibility remain
implementation-spike evidence, not conclusions of this study. Maintenance and
phone assessments below are architectural judgments unless linked to upstream
documentation. Licences describe the named project; bundled components and
extensions keep their own terms.

| Option | Licence and size evidence | World single-origin security and placement | Phone experience | Maintenance and fit |
| --- | --- | --- | --- | --- |
| **World shell + CodeMirror** (recommended) | [MIT](https://github.com/codemirror/view/blob/main/LICENSE). Already in `web/package.json`; no additional editor engine. Incremental production bundle cost unmeasured. | Editor runs in the browser; only World serves assets and authorizes qualified file/terminal operations. No extension host or new listener. Escape source as text. | Upstream explicitly supports mobile editing; still needs iOS/Android IME, selection and keyboard tests. One panel at a time. | Lowest integration/deployment burden. World must own project navigation, guarded saves and review UX; no VS Code extension compatibility. |
| **World shell + Monaco** | [MIT and FAQ](https://github.com/microsoft/monaco-editor). [npm metadata](https://registry.npmjs.org/monaco-editor/0.57.0): 0.57.0, **101,674,083 unpacked bytes**, not a browser bundle. | Browser editor and same-origin workers, with files and terminals mediated by World. Monaco supplies neither filesystem nor full VS Code workbench. Workers must fit World's CSP. | Upstream says mobile is unsupported. Would require a separate phone editing surface or read-only review, increasing parity work. | Medium. Familiar desktop completion/diff APIs; own navigation, saves, language-service deployment and worker upgrades. VS Code extensions do not run in Monaco. |
| **code-server** | [MIT](https://github.com/coder/code-server/blob/main/LICENSE). [4.145.2 Linux amd64 archive](https://github.com/coder/code-server/releases/tag/v4.145.2): **236,495,502 bytes**. Upstream recommends [1 GB RAM and 2 CPU cores](https://coder.com/docs/code-server/requirements). | Separate workbench server near each project's files; World would proxy HTTP/WebSocket under a qualified route and enforce its login on every request. [Subpath proxying is documented](https://coder.com/docs/code-server/guide). Same-origin workbench/extensions inherit substantial World authority; a path is no sandbox. | [iPad guidance](https://coder.com/docs/code-server/ipad) covers PWA/keyboard limitations. Tablet usability is not phone validation; desktop density still needs adaptation. | High. Per-host installation, versioning, process cleanup, proxy/cookie/worker handling and an extension to attach existing agents. Its ordinary terminals would otherwise start different processes. |
| **OpenVSCode Server** | [MIT](https://github.com/gitpod-io/openvscode-server/blob/main/LICENSE.txt). [1.109.5 Linux x64 archive](https://github.com/gitpod-io/openvscode-server/releases/tag/openvscode-server-v1.109.5): **76,686,959 bytes**. No runtime resource measurement. | A full server by the files. [Upstream documents unauthenticated access unless configured](https://github.com/gitpod-io/openvscode-server#securing-access-to-your-ide), including its tokenless Docker default. World must protect proxy and private upstream; do not pass long-lived tokens in browser URLs. | Browser access is available; no phone-specific usability guarantee established here. Same dense workbench/editor concerns as Monaco. | High. Small upstream patch surface, but World still owns supervised lifecycle, per-connection isolation, auth integration and Herdr terminal extension. |
| **Eclipse Theia** | [EPL-2.0](https://theia-ide.org/docs/faq/), with distribution/source obligations for modified covered code; extension licences vary. Modular frontend/backend product, no single representative artifact size measured. | [Browser frontend + Node backend](https://theia-ide.org/docs/architecture/). A World product would need a backend per file host or a remote filesystem provider, private transport, authentication and extension trust policy. It adds another application platform to the Bun service. | Responsive widgets could be designed, but its Monaco-based editor is not evidence of supported phone editing. Phone adaptation remains ours. | Highest custom-platform commitment. Strong workbench customization and partial VS Code API compatibility; DI modules, plugins, backend and World semantics all need upkeep. |
| **A World extension in existing VS Code** | World-owned extension could remain MIT; installed VS Code and each extension have separate terms. No new World web bundle, but requires an installed desktop/web workbench; extension package size unmeasured. | Extension talks to World using a new narrow credential/pairing contract. Do not copy the owner's World session/token into workspace settings. Remote extension host and selected World connection can differ; explicit identity checks are essential. | Desktop extension alone does not solve the phone goal. A [web extension](https://code.visualstudio.com/api/extension-guides/web-extensions) runs in a worker without Node/process APIs and needs browser-reachable World. | Medium/high, separate release and auth lifecycle. Useful optional companion later; it puts World inside an IDE and does not deliver this request's World view. |
| **Microsoft VS Code Remote SSH / Tunnels** | Code OSS source is MIT; Microsoft's distributed [VS Code Server has separate terms](https://code.visualstudio.com/license/server), including restrictions on hosting/combining it for others. CLI/server/client/extension artifacts vary; no single bundle size measured. | [Remote development](https://code.visualstudio.com/docs/remote/remote-overview) places tools near files. [Tunnels](https://code.visualstudio.com/docs/remote/tunnels) use GitHub/Microsoft authentication and outbound Azure connections, then a `vscode.dev` client: a separate origin and identity flow. Reuse the placement principle, not a tunnel inside World. | Browser client can reach the host; it does not supply World's phone navigation or prove phone editor support. | Low custom IDE work if simply linking out, but substantial external-product/account dependency. Does not meet the same-origin, same-World-view contract as an embed. |

Archive sizes above come from each release's GitHub API `assets[].size`, selected
by the exact named Linux archive, accessed 18 November 2026; npm size is
`dist.unpackedSize`. These are observations, not installation targets or dependency
recommendations. Before any full-workbench choice, audit the chosen release,
extension registry and redistribution terms; MIT Code OSS does not grant use of
Microsoft's marketplace or proprietary extensions. Theia's
[FAQ distinguishes a custom platform from a VS Code extension](https://theia-ide.org/docs/faq/).

## How the terminals fit

| Integration | What appears | Consequence for World |
| --- | --- | --- |
| [Shell terminal profile](https://code.visualstudio.com/docs/terminal/profiles) | A command such as `herdr` launched in the IDE's integrated terminal. | It can run the Herdr TUI, but does not automatically attach one existing World agent. Starting `herdr` or a shell must not be mistaken for observing the selected terminal. It can also duplicate runtime lifecycle. |
| [Profile provider + pseudoterminal](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal) | A named terminal such as **World: Scout · Orchard**, backed by an extension forwarding output, input and dimensions to World. | Best full-workbench integration. A profile is discoverability; the pseudoterminal is the transport adapter. Must bind connection, generation and terminal/session, handle reconnect and resize, revoke control, and make terminal close detach rather than kill. Core screen-watch semantics require an adapter; do not assume raw PTY parity. |
| **World's terminal components** | Herdr TUI's terminal view or herdr-core's screen watch and composer, docked below code; agent tabs select existing terminals. | Recommended. Preserve current runtime-specific ownership, control, phone keys, lease/typing and detach behavior. An editor buffer never forwards ordinary keystrokes to the terminal. No changes to Herdr or herdr-core. |

## Current code that anchors the proposal

- [`FilePreviewContent`](../../../web/src/components/FilePreviewContent.tsx) and
  [`CodePreview`](../../../web/src/components/CodePreview.tsx) already use CodeMirror.
  A preview is not yet the proposed versioned editor-save contract.
- [`WorkspaceInspectorRequest`](../../../web/src/workspaceResource.ts) qualifies
  workspace selection by connection and generations. The aggregate snapshot is
  observation, not permission to perform a downstream operation.
- [`file.*`](../../../server/src/rpc/files.ts) and
  [`git.*`](../../../server/src/rpc/git.ts) use a selected connection's file service.
  [`coreHostMethods`](../../../shared/coreHostMethods.ts) includes file/Git methods
  on core. Preserve [`agent checkout selection`](../../../server/src/workspace/agent-worktree-files.test.ts)
  so an agent's linked worktree is not confused with a room's launch checkout.
- [`CoreTerminalWatch`](../../../web/src/world/CoreTerminalWatch.tsx) consumes a
  qualified core address, generation, screen watch and typing path. It is not
  interchangeable with a newly spawned xterm shell.
- [`Filesystem browsing evidence`](../../../server/src/workspace/filesystem-browsing.test.ts)
  distinguishes confined workspace paths from explicitly requested filesystem
  scope. Code's proposed write roots stay confined; no implicit promotion from
  browsing permission to arbitrary filesystem writes.

## Trade-offs and owner decisions

The recommendation prioritizes the same World and phone workflow over full VS Code
API compatibility. Editing would add a save responsibility to World. Agent edits
require visible conflicts; a generic file write layered over current reads could
lose work. A content-hash check followed by atomic replacement still races with
external writers. World-only locks cannot serialize arbitrary agent/editor writes.
Start read-only; decide whether to accept that optimistic-write risk or require a
cooperating writer protocol before adding live saves. Remote durability and platform
support also need provider evidence, rather than being solved by an editor widget.

Only the owner can settle these product priorities; the proposed contract assumes
the recommended answers for review, and no answer is required during this research run:

1. **VS Code feel or full VS Code extensions/debugging?** Recommend the former
   first. Requiring extensions selects a substantially different server/trust model
   and requires revising this proposal before implementation.
2. **Can Code save files in its first release?** Recommend read/review first.
   If editing is required, decide whether optimistic-write races with external
   agents are acceptable, then revise the contract and verify providers. Use
   explicit saves and visible conflicts; silent autosave is not recommended.
3. **What must work on a phone?** Recommend file reading, small edits, agent
   terminal access and PR/diff review with 44 px targets; no full desktop panel grid.
4. **Is an optional external IDE handoff valuable later?** Recommend deferring
   extension pairing and tunnels. They can complement World, but cannot stand in
   for this view or silently introduce a third-party account requirement.

The [architecture](../../../openspec/changes/world-code-view/design.md) defines
placement, identity, authentication, write races, failure behavior and the evidence
needed after that decision. This PR authorizes no editor implementation.
