# Code View notes

[Contract](../../changes/world-code-view/specs/world-code-view/spec.md) (active
delta of the [world-code-view change](../../changes/world-code-view/proposal.md)).
Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- View picker and `/code` on desktop and phone.
- Code's bar: project picker, host and folder, IDE, New tab, Stop, Servers, rail toggle.
- Settings → Integrations lists the IDE rows and Running IDE servers.
- Connection removal lists that connection's IDE servers; removing stops none.
- TUI and herdr-core projects share the same view and rail components.

**Code:**

- `server/src/ide/`
- `server/src/rpc/ide.ts`
- `server/src/shipyard/composition.ts`
- `web/src/world/code/`
- `web/src/components/RemoveConnectionDialog.tsx`

**Tests:**

- `web/src/world/code/CodeView.browser.test.ts`
- `web/src/world/code/KeptCodeView.browser.test.ts`: kept loaded behind Town and Spaces.
- `server/src/ide/ide-route.test.ts`
- `server/src/ide/webview-origin.browser.test.ts`
- `server/src/ide/remote.test.ts`
- `server/src/ide/instances.test.ts`
- `server/src/ide/workbench-theme.test.ts`
- `?ideFixture=` preview states (below).
- `quint/ide-lifecycle.qnt` with its replay (`quint/ide-lifecycle.ts`) and
  [contract](../../../verification/contracts/ide-lifecycle.md): start, Stop,
  lost answers, restart, reconnect and removal orderings.

**Pitfalls:**

- The browser never holds the IDE token; the proxy adds it to requests and the first WebSocket message.
- Only Stop ends an IDE server; disable, removal, reconnect and World exit only let go.
- Never open a TCP port or a second origin; SSH uses OpenSSH socket forwards. Sole
  exception: IDE pages' frame rule admits VS Code's webview origin (`https://*.vscode-cdn.net`).
- Never rewrite the IDE's files; the workbench page only gains a theme default.
- Never unmount, move or `display:none` a loaded workbench frame: it reloads or
  loses its size. `KeptCodeView.tsx` keeps Code mounted; hidden frames use `visibility`.

**See also:** [research and gates](../../../docs/design/code-view/research.md),
[webview origin decision](../../../docs/design/code-view/webview-origin.md).

## Usage reference

### Code view

**Code** (`/code`, beside Town, Board and Desk in the view switcher on desktop
and phone) shows the complete VS Code of the host a project is on, World's own
computer or an SSH host, inside World. World runs the IDE already installed
there, so your extensions, settings and profile on that host apply; it never
installs or updates one, and nothing in Code opens an IDE on a desktop.

- **Integrations.** Visual Studio Code (`code serve-web`, via the desktop
  app's `code-tunnel` program or the standalone `code` CLI), code-server and
  OpenVSCode Server. Each row says **Enabled**, **Installed**, **Not
  installed**, **Not found** (a set path that is gone) or **Can't run**, for
  World's own computer. Any of them can be enabled even when it isn't
  installed here: a project on an SSH host uses the one installed on that
  host, looked for when the project opens; its row and the Enable dialog say
  it opens only on a computer where it is installed. A missing one offers
  **Connect: get …** (its download page) and **Use a program path…** (an
  absolute path to an executable on World's computer). The same rows are in
  **IDEs** in Code's bar and in Settings → Integrations, where the refresh
  button looks again.
- **Webviews.** Markdown preview and extension panels (GitLens, Copilot
  Chat and the like) work in all three IDEs. Stock VS Code and OpenVSCode
  Server load them, and their web worker extension host, from VS Code's own
  webview site, `https://<hash>.vscode-cdn.net`, as they do anywhere else;
  World changes none of the IDE's files. This is the one exception to World's
  one-address rule: only the frame rule World adds to IDE pages (`/ide/<id>/`)
  admits `https://*.vscode-cdn.net`, and World's own pages still frame only
  World. It is safe because that content stays on another site: it can't
  reach World's window, storage, cookies or API, and its service worker
  covers only its own site. The IDE still can't widen a service worker over
  World's pages or set cookies outside its route. Webviews need internet
  access to vscode-cdn.net and a secure address (HTTPS or localhost): VS Code
  makes each webview's site name with browser cryptography, so on plain HTTP
  OpenVSCode Server's webviews stay blank. code-server serves its webviews
  itself.
- **Secure address.** Microsoft's VS Code connects only from a page on HTTPS
  or at localhost: it signs its connection with browser cryptography that a
  plain-HTTP LAN or Tailscale address doesn't have, and its server refuses
  the workbench otherwise. Its row says so. On a plain-HTTP address the Code
  view shows **Visual Studio Code needs a secure address** instead of the
  workbench, even for a server that already runs, and says what to do: open
  World over [HTTPS](../../../docs/DEPLOYMENT.md#native-https) (its own certificate or
  an HTTPS proxy such as `tailscale serve`), or at localhost on World's
  computer. **Stop** stays, and **Choose another IDE** opens the IDE list:
  code-server and OpenVSCode Server work on plain HTTP. Picking another IDE
  shows **Open in** it for the project.
- **Enable gate.** **Enable…** opens a dialog that says the IDE runs on the
  computer each project is on, that it and its extensions get full access to
  those computers and to World (it runs on World's page and address), where
  extensions come from (Microsoft's Marketplace or Open VSX), and, on a plain
  HTTP LAN address, that webviews, previews and the clipboard need HTTPS or
  localhost (for Microsoft's VS Code, that it won't open from there). **Enable** stays off until the trust box (and any licence box the
  IDE has) is ticked. Nothing starts on enable.
- **Layout.** One thin bar holds the project picker, its host and folder, the
  IDE, **New tab**, **Stop**, **IDEs** (the IDE list, over the view),
  **Servers** and the rail toggle; the workbench fills the rest
  of the view edge to edge. The rail of the project's agents (status, Needs
  you first in colour) and terminals folds away with the toggle, which shows
  their count while folded; an agent opens on its Chat, a terminal in the
  Inspector. The rail starts folded on windows narrower than 1100 px and then
  remembers your choice; on a phone it opens below the workbench.
- **Theme.** VS Code's light or dark follows World's theme (Settings →
  Appearance), or the system's when World follows the system, and switches
  live when it changes. World turns on VS Code's **Auto Detect Color Scheme**
  as a default on the workbench page; it writes nothing to your VS Code
  settings, so VS Code's **Preferred Light/Dark Color Theme** pick the two
  themes, and turning auto-detect off in your own settings keeps VS Code on
  its own theme.
- **Projects.** A project is a room's folder (its checkout, else its working
  directory) or the folder of an agent outside every room, per connection; the
  same folder on two connections is two projects. The picker groups them by
  host and remembers the choice.
- **Open.** **Open in …** starts one server for that project folder on the
  project's host; the next visit, and every World after a restart, reuses it.
  It listens on a private Unix socket in a private folder (mode 0700) on its
  host: World's data folder on World's computer, `~/.local/state/herdr-world/ide`
  (or `$XDG_STATE_HOME`) on an SSH host. For an SSH host World uses that
  connection's OpenSSH destination (so your OpenSSH config applies): a short
  `ssh` command starts the host's IDE, and an OpenSSH socket forward connects
  it to a private socket on World's computer; no TCP port opens on either side.
  The access token travels on the SSH session's input, never on a command line,
  and stays in the server's folder (mode 0600); the browser never holds it.
  World adds it to the workbench's requests and to the first message of each
  of its WebSockets, where VS Code's handshake expects it. Either way the workbench is
  framed from `/ide/<id>/` on World's own origin, behind World's sign-in;
  World's own Content Security Policy is unchanged and the IDE keeps its own,
  with World's frame rule added (frames only from World's own address and
  VS Code's webview site).
  code-server's port proxies (`/proxy/<port>`, `/absproxy/<port>`) are off and
  World refuses them (403) for pages and WebSockets. **New tab** opens the same
  address. The
  first VS Code start on a host downloads VS Code's web server there, about a
  minute. VS Code retries a failed download without saying why; when World
  sees it retry, it stops waiting and says the download needs about 1 GB free
  in the home folder and access to update.code.visualstudio.com. A download
  still under way when World's three-minute wait ends says to open again in a
  minute. Either way the server keeps running until **Stop**.
- **Kept loaded.** Once shown, a workbench stays loaded in the page while
  another project, Town, Board, Desk or Spaces is in front, and while World
  lets go of its server and reattaches (a reconnect or World restarting):
  open editors, unsaved edits, terminals, webviews and scroll stay as they
  were, and VS Code reconnects on its own. Only reloading the page, **Stop**,
  or a server that ended or failed loads it again, and then Code says so
  (**This page reloaded, so <IDE> loaded again**). Each kept workbench holds
  VS Code's page memory in the browser (a few hundred MB, more with
  webviews), at most four with the server limit; there is no idle release.
- **Lifetime.** An IDE server runs until you stop it, so builds, terminals,
  tasks and extensions in it keep going. Leaving Code, closing the browser,
  World stopping, restarting or updating, the SSH link dropping and the host
  being out of reach for a while all leave it running; there is no idle
  timeout. World then lets go: the route and its open WebSockets close, and the
  project shows **<IDE> still runs on <host>** with since-when, **Open** and
  **Stop…**. **Open** reattaches to the same server without starting another;
  World also reattaches on its own once the connection is back. A server's
  folder records which World, connection, IDE and project folder it is for;
  World reuses only its own servers for the same IDE and folder, and two starts
  for the same folder at once start one.
- **Stop.** Only **Stop** on that server stops it, after saying that
  everything running in it ends: terminals, tasks, debug sessions and
  extensions. Stopping ends everything that server started, on World's
  computer or the SSH host: VS Code's launcher, its separate server, extension
  hosts and terminal shells, even ones in their own session whose parent
  already exited. They get SIGTERM, then SIGKILL after five seconds. If the
  host can't be reached, the server stays listed with why and **Stop** can be
  tried again. A Stop cut off on the host (its answer lost, or World
  restarting) leaves the server listed with **A Stop of it didn't finish**;
  no other server starts for that folder until **Stop** or the by-hand
  command ends what is left. A server that exits on its own has what it started ended the
  same way. Other IDE servers and Herdr agents are untouched.
- **Disable and Remove stop nothing.** Disabling an IDE that has servers
  running lists them in its confirmation, each with its own **Stop…**;
  disabling stops none, and they stay listed (open one again by enabling the
  IDE). **Remove** on a connection lists the IDE servers World started there
  the same way while it checks, and removing stops none. A removed SSH
  host's servers stay listed as **Running, unreachable from World**, with the
  command that stops one when run on that host; **Forget…** takes one off the
  list once it is stopped (Forget stops nothing). A removed local
  connection's servers stay stoppable from World.
- **Nothing runs unseen.** **Servers** in Code's bar (with their count) and
  Settings → Integrations → **Running IDE servers** list every IDE server World
  started that still runs, per host and folder, with since-when, state and
  **Stop…**. World keeps that list in its data folder, so after a restart every
  server is listed at once, also on a host World no longer reaches; it
  reattaches to them on its own computer, and on each SSH host once that
  connection is ready. A start whose answer from the SSH host was lost stays
  listed and counted as possibly running until the host shows otherwise.
  **Show** brings that project and that server's IDE to the front.
- **Limits and refusals.** At most four servers run or wait to be reattached at
  once, unreachable ones included; a fifth is refused (**Too many IDEs are
  running**) with **Show running servers**, and World never stops one to make
  room. A
  start that does not answer within three minutes is left running and shown as
  not attached (**Open** tries again, **Stop** ends it); a server that exits
  shows its last error line (or, for SSH, whether SSH failed, the folder is
  missing on the host or World couldn't make its private folder there). An IDE
  not installed on the project's host is refused by name. Looking for the IDE
  on an SSH host gives up after 20 seconds. A stale connection must reconnect
  first; an Open that waited behind another operation while its connection
  changed is refused the same way. Windows hosts and folders that are
  gone are refused. A process that clears its environment and leaves the
  server's process tree is out of World's reach, and on an SSH host whose login
  manager ends a user's processes at logout (systemd-logind
  `KillUserProcesses=yes`, not the usual default), servers end with the SSH
  session.
- **Failures.** Every failure screen says what went wrong and on which
  computer (the project's host, or the computer World runs on): **<IDE> isn't
  installed on <computer>**, **<IDE> stopped on <computer>** with its last
  error line, **World can't open <project> in <IDE> on <computer>** with why,
  and the secure-address screen. Each offers **Try again** (on the
  secure-address screen it checks again, and the screen stays until World is
  opened over HTTPS or at localhost) and **Choose another IDE**, which opens the IDE list over the view without leaving Code: disable
  the failing IDE, enable another, and the screen becomes **Open in** that
  IDE. Enabling an IDE there makes it the one projects open with. A refusal
  or stopped server belongs to its IDE; another IDE chosen doesn't show it.
  World never installs or downloads an IDE from Code.
- **Preview states.** For trying the screens without an IDE, add
  `?ideFixture=missing`, `detected`, `ssh` (starting on an SSH host),
  `downloading`, `failed`, `not-installed` (only OpenVSCode Server enabled,
  and opening refused because it isn't installed; the others can be enabled
  instead) or `restored` (servers listed after a restart: one here, one on an
  SSH host, one on a removed SSH host) to a World address; World removes it at
  once and shows synthetic integration state until the next reload.
