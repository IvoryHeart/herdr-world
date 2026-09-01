# Herdr World

[![Release](https://img.shields.io/github/v/release/IvoryHeart/herdr-world?include_prereleases&label=release)](https://github.com/IvoryHeart/herdr-world/releases)
[![CI](https://github.com/IvoryHeart/herdr-world/actions/workflows/ci.yml/badge.svg)](https://github.com/IvoryHeart/herdr-world/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Herdr World is a browser and mobile workspace for [Herdr](https://github.com/herdrdev/herdr).
It combines live terminal Spaces with visual Pixel Office and Graph themes, multi-host viewing,
shared navigation, mobile controls, notes, uploads, and agent-aware workflows.

The current public preview is
[`v0.1.0`](https://github.com/IvoryHeart/herdr-world/releases/tag/v0.1.0).
It supports Linux x86-64 and macOS on Apple Silicon and Intel, and requires Herdr `v0.8.2` or newer
with terminal protocol `20`. Visit the [project site](https://ivoryheart.github.io/herdr-world/) for
an interactive overview.

| Desktop | Mobile |
|:--:|:--:|
| <img src="docs/images/pixel-office-desktop.png" alt="Herdr World Pixel Office showing hosts, workspaces, and agents" width="720"> | <img src="docs/images/pixel-office-mobile.png" alt="Herdr World Pixel Office on a mobile viewport" width="260"> |

| Graph overview | Connected terminals |
|:--:|:--:|
| <img src="docs/images/graph-overview.png" alt="Herdr World Graph showing six synthetic example workspaces and agent nodes" width="720"> | <img src="docs/images/graph-live-terminals.png" alt="Herdr World Graph with two connected terminal windows displaying synthetic demo output" width="720"> |

## Quick Start

Start or attach to a Herdr session, then choose an installation method. npm and the Herdr plugin
require Node.js `22.14.0` or newer.

### npm

```bash
npm install --global @ivoryheart/herdr-world@latest
herdr-world
```

### Homebrew

```bash
brew install IvoryHeart/tap/herdr-world
herdr-world
```

### Herdr plugin

```bash
herdr plugin install IvoryHeart/herdr-world --ref v0.1.0
herdr plugin action invoke open --plugin ivoryheart.herdr-world
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) if the browser does not open automatically.
Checksum-verified standalone archives are available on the
[release page](https://github.com/IvoryHeart/herdr-world/releases/tag/v0.1.0).

The macOS binaries are not yet signed or notarized. After verifying the download, the first launch
may need approval in **System Settings → Privacy & Security**.

## Advanced Usage

Select a session, socket, or alternate port with normal launcher options:

```bash
herdr-world --session NAME
HERDR_SOCKET_PATH=/path/to/herdr.sock herdr-world --port 8791
herdr-world --no-herdr-setup
```

The interactive launcher can offer to install, update, or start Herdr. It asks before each action;
`--no-herdr-setup` disables those prompts.

Agent harnesses running inside a Herdr pane can publish a short, expiring task summary for the
Office without starting another bridge:

```bash
herdr-world task-summary "Reviewing release checks"
herdr-world task-summary --clear
```

The command uses `HERDR_PANE_ID`, binds reports to the pane's active agent session, defaults to a
15-minute TTL, and accepts `--ttl-ms`, `--pane`, and `--session` for explicit bounded targets. It
normalizes whitespace, caps summaries at 160 Unicode characters, and redacts obvious
credential-shaped values. See the [development guide](docs/development.md#reporting-agent-task-summaries)
for the full contract.

Useful plugin operations include:

```bash
herdr plugin action invoke status --plugin ivoryheart.herdr-world
herdr plugin action invoke doctor --plugin ivoryheart.herdr-world
herdr plugin action invoke restart --plugin ivoryheart.herdr-world
herdr plugin log list --plugin ivoryheart.herdr-world --limit 20
```

Plugin actions are asynchronous and target-scoped. Before uninstalling, repeat the stop-and-status
sequence for every Herdr target or named session and wait for each action log to report
`status: succeeded`:

```bash
herdr plugin action invoke stop --plugin ivoryheart.herdr-world
herdr plugin action invoke status --plugin ivoryheart.herdr-world
herdr --session NAME plugin action invoke stop --plugin ivoryheart.herdr-world
herdr --session NAME plugin action invoke status --plugin ivoryheart.herdr-world
herdr plugin uninstall ivoryheart.herdr-world
```

To run from source:

```bash
npm install
npm install --prefix web
npm run dev:local
```

The full application is served at [http://127.0.0.1:8787](http://127.0.0.1:8787). Run
`npm run check` before submitting changes.

Binding the bridge beyond loopback is security-sensitive and requires explicit host and origin
allow-lists. Use a VPN, SSH tunnel, or authenticated reverse proxy for remote access. See the
[development](docs/development.md), [federation](docs/federation.md), [Android](docs/android.md), and
[packaging](docs/packaging.md) guides for detailed workflows.

## Contributing And Support

Contributions are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md). Use
[GitHub Issues](https://github.com/IvoryHeart/herdr-world/issues) for bugs and focused feature
requests. Security reports must follow [`SECURITY.md`](SECURITY.md) and should not be disclosed
publicly before a fix is available. Community support is best-effort.

## Licensing

Herdr World is available under the [MIT License](LICENSE). Bundled components and assets retain
their own licences and notices; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the
generated inventories in [`third_party/dependencies`](third_party/dependencies/README.md).

## Acknowledgements

Herdr World builds on [Herdr](https://github.com/herdrdev/herdr),
[Herdr Web](https://github.com/kcosr/herdr-web),
[Ghostty Web](https://www.npmjs.com/package/ghostty-web),
[Ghostty](https://github.com/ghostty-org/ghostty), [PixiJS](https://pixijs.com/), and character art
adapted from [Claw-Empire](https://github.com/thinkinaixyz/claw-empire). Thank you to their
maintainers and contributors.
