# Herdr World

<p align="center">
  <img src="./web/public/herdr-world-logo.svg" alt="Herdr World ram mark" width="128" />
</p>

A **visual control plane** for [Herdr](https://herdr.dev). Connect local and SSH
hosts, see their agents together in Town, Board or Desk, and chat with them,
start them from profiles, and use independently qualified terminals, files and
changes on desktop or mobile. **Requires a running Herdr server.**

## What's new in 0.2.7

- **Chat with each agent.** Opening an agent opens its one window on **Chat**:
  the conversation from its transcript, tool calls with their diffs and test
  results, its current task and quest, and a composer with attachments and
  slash commands. Answer supported permission prompts and Claude Code
  questions, or **Stop** the agent. See the [Chat guide](./docs/CHAT.md).
- **Start agents from profiles.** **Actions → New agent** launches Claude Code,
  Codex or another supported harness from a profile (role, model, permissions,
  starting brief and Town look) after checking it is installed and logged in.
- **Hear who needs you.** Chimes say who needs you and why; set each agent to
  **Watching**, **Muted** or **Focused**.
- **Teams and agent tools.** Agents started by other agents are grouped with
  them. The `herdr-world` CLI lets agents pin and colour their cards, report
  results and ask you questions.
- **Work beside agents.** Your GitHub pull requests and Jira tickets appear in
  Board's **Work** lens and on Town desks, with confirmed merge, close and mark
  ready actions.
- **A clearer Town.** Rooms follow Spaces' tab order and resize as tabs open or close;
  explicitly expanded rooms keep their size until folded;
  pin desks, colour hosts, workspaces and terminals, and open **Summary** for
  everything needing you. Every view opens in Zen.
- **Herdr setup.** The published 0.2.7 standalone installer installs or upgrades
  Herdr to the verified release; set `HERDR_WORLD_SKIP_HERDR=1` to leave yours
  untouched. Homebrew reuses existing Herdr and installs it on first launch only
  if missing. World updates refresh Herdr's harness integrations and plugin. See
  [Herdr installation and upgrades](./docs/DEPLOYMENT.md#herdr-installation-and-upgrades).

Read the [0.2.7 release notes](./docs/releases/v0.2.7.md) for upgrade steps and
known limits.

## Choose your layout

- **Town** is the default: host buildings contain workspace rooms, team tables
  and terminal seats. Find waiting agents at reception, read their peek and reply.
- **Board** puts workspace and tab cards beside your notes. Arrange cards, string
  a note to an exact pane and explicitly send it when ready.
- **Desk** groups agents into Needs you, To review and In flight, with a reading
  pane for Chat, terminal, files and changes.
- **Spaces** focuses one workspace's terminal panes and repository tools.

Town, Board and Desk share the **Hosts** filter. Open terminals and Inspectors
retain their owning host when the filter changes. Use **Actions → New workspace**
or **New tab** and confirm the destination; Town's **New room** and Board's **+**
controls offer the same qualified creation flows.

Office, Tree and Graph have been retired: old `/office` addresses open Town, and
`/graph` and `/tree` open Board. Board and these redirects are included in
[0.2.6](./docs/releases/v0.2.6.md).

## Screenshots

These captures show 0.2.7 with four disposable workspaces on a throwaway Herdr
session. Three real Claude Code agents ran small tasks there: one added a
first-run section to the demo README, one is waiting on you and one has
finished. The notes and terminal commands are synthetic. Click a screenshot to
open it at full resolution.

### Desktop

| Town: buildings, rooms and reception | Board: workspace cards, tabs and a strung note |
| --- | --- |
| [![Town with four workspace rooms, one agent waiting at reception and one finished](./docs/images/herdr-world-desktop-town.png)](./docs/images/herdr-world-desktop-town.png) | [![Board with four workspace cards, terminal tabs and a note strung to an agent](./docs/images/herdr-world-desktop-board.png)](./docs/images/herdr-world-desktop-board.png) |

[![Spaces with the workspace list and a live terminal](./docs/images/herdr-world-desktop-spaces.png)](./docs/images/herdr-world-desktop-spaces.png)

Each agent has one window with Chat, Terminal, Files and Changes, whether
opened from Town, Board or Desk. See [Chat](./docs/CHAT.md) and the
[tutorial's review exercise](./docs/TUTORIAL.md#daily) for the complete flow.

| Chat | Files | Changes |
| --- | --- | --- |
| [![Town with an agent window docked on Chat, showing its report on a README change](./docs/images/herdr-world-desktop-chat.png)](./docs/images/herdr-world-desktop-chat.png) | [![Board Inspector previewing the demo guide](./docs/images/herdr-world-desktop-files.png)](./docs/images/herdr-world-desktop-files.png) | [![Board Inspector showing the README section the agent added](./docs/images/herdr-world-desktop-changes.png)](./docs/images/herdr-world-desktop-changes.png) |

### Mobile

| Town | Chat | Board | Spaces |
| --- | --- | --- | --- |
| [![Town at phone width with the Needs you tray](./docs/images/herdr-world-mobile-town.png)](./docs/images/herdr-world-mobile-town.png) | [![An agent's Chat on a phone](./docs/images/herdr-world-mobile-chat.png)](./docs/images/herdr-world-mobile-chat.png) | [![Board close-up of a note strung to an agent](./docs/images/herdr-world-mobile-board.png)](./docs/images/herdr-world-mobile-board.png) | [![Spaces terminal and touch controls](./docs/images/herdr-world-mobile-spaces.png)](./docs/images/herdr-world-mobile-spaces.png) |

## Quick start

1. Herdr World runs on [Herdr](https://herdr.dev). Homebrew reuses existing Herdr
   and installs it on first World launch only if missing. The published 0.2.7
   standalone installer installs or upgrades Herdr to the verified release; set
   `HERDR_WORLD_SKIP_HERDR=1` to leave yours untouched. With npm or a Windows
   archive, run `herdr-world herdr upgrade --install` once if needed.
   `herdr-world herdr setup` starts Herdr as a user service.
2. On Linux or macOS, install Herdr World with the standalone installer:

   ```bash
   # Empty selects latest; use X.Y.Z (no v prefix) to pin a Herdr World version.
   curl -fsSL \
     https://github.com/IvoryHeart/herdr-world/releases/latest/download/install-herdr-world.sh \
     | HERDR_WORLD_VERSION= sh
   ```

   For 0.2.0 and newer releases, Homebrew (`brew install IvoryHeart/tap/herdr-world`)
   and npm (`npm install --global @ivoryheart/herdr-world`) are alternative channels.
   npm requires Node.js 22.14.0 or newer and downloads only the binary for the
   current platform. On Windows, use npm or download the matching x64 or ARM64
   archive from the [latest release](https://github.com/IvoryHeart/herdr-world/releases/latest).
3. On Linux/macOS standalone installs, add `~/.local/bin` to `PATH`. Run
   `herdr-world` (or `herdr-world.exe` from an extracted Windows archive) and open
   the printed URL.

Use Manage connections to add local sockets or an SSH destination. One World
service owns every connection and the browser stays on that World origin. Hosts
filters Town, Board, Desk, the navigator, counts and search; it never
connects or disconnects a profile. Terminals and Inspectors on different ready hosts can
operate together. Global creation visibly confirms one destination host.

Your GitHub pull requests and Jira tickets appear beside the agents working on
them (Board's **Work** lens and Town desk badges). GitHub works once `gh auth
login` is done for the user running World; add Jira in **Settings → Sources**.

See [deployment](./docs/DEPLOYMENT.md) for checksums, profiles, authentication,
updates, and services.

## Install as a PWA

**PWA installation is recommended for daily use:** a separate app window without
browser tabs or the address bar. Open and authenticate with Herdr World, then install:

- **iPhone/iPad Safari:** Share -> Add to Home Screen.
- **macOS Safari 17+:** File -> Add to Dock.
- **Chrome/Edge:** browser menu -> Install app.

The process must stay running and reachable. **PWA mode is not offline access.**

## Documentation

- [Website](https://herdr.world/) and
  [hands-on tutorial](https://herdr.world/tutorial/)
  ([Markdown](./docs/TUTORIAL.md)): [Town](./docs/TUTORIAL.md#town),
  [Board](./docs/TUTORIAL.md#board), [Desk](./docs/TUTORIAL.md#desk), terminal/file review, mobile,
  and private remote access.
- [Chat](./docs/CHAT.md): reading and replying to agents, answering their
  prompts, and which harnesses Chat supports.
- [Features and shortcuts](./FEATURES.md), including the
  [agent CLI](./FEATURES.md#agent-cli-herdr-world---skill): run
  `herdr-world --skill` to teach an agent to change World.
- [Deployment](./docs/DEPLOYMENT.md): installation, configuration, services, builds.
- [Architecture](./docs/ARCHITECTURE.md): system contracts.
- [Repository knowledge map](./docs/knowledge-map.md) and
  [foundation source guide](./docs/foundation-guide.md): contracts, module owners,
  request paths, and focused tests for contributors and agents.
- [Development](./docs/development.md), [packaging](./docs/packaging.md), and
  [release process](./docs/release.md), and [screenshot capture](./docs/SCREENSHOTS.md).
- [Security](./SECURITY.md) and [contributing](./CONTRIBUTING.md).

## Development

Use Bun 1.4.3 or newer and a running Herdr server:

```bash
bun install --frozen-lockfile
# Run in separate terminals:
bun run dev:server
bun run dev:web
```

Open <http://localhost:5173>. See [CONTRIBUTING.md](./CONTRIBUTING.md) for checks
and pull requests.

## Security

Herdr World controls terminals and modifies real files. Keep the default loopback
binding. Every listener requires login with a 15–1024-character configured password
or a generated persistent token; read [SECURITY.md](./SECURITY.md) before allowing another device access.

## License

Code: [MIT](./LICENSE). Bundled dependencies, fonts and brand assets retain their
original terms; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and the
generated [dependency licence texts](./DEPENDENCY_LICENSES.md).
