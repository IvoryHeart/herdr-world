# Local development

Work from the `herdr-world` repository root:

```bash
cd /home/ny/Forge/ai-palace/herdr-world
```

## Quick start

Herdr World is a client of a running Herdr server. Start or attach to the normal
Herdr session first:

```bash
herdr status server
herdr session list
herdr
```

The active bridge baseline is Herdr `v0.8.2` or newer reporting terminal protocol
`20` exactly. Protocol 19, protocol 21, missing protocol, and invalid Herdr
versions are rejected before terminal attach; the error is intentionally bounded
and does not echo untrusted version text.

The last command is only needed when the server/session is not already
running. It must leave the default socket at:

```text
~/.config/herdr/herdr.sock
```

Then start the web development stack from this repository:

```bash
npm run dev:local
```

This command:

1. Reuses a healthy bridge on `127.0.0.1:8787`, or starts one with
   `scripts/run-bridge.sh`.
2. Checks the local Herdr socket before starting a new bridge.
3. Builds the bridge or static web assets only when the expected local build
   outputs are missing.
4. Starts the Vite frontend and points its `/api` and `/ws` proxy at the
   bridge.

Open the bridge URL for the complete app, including the production-rendered
Office surface:

```text
http://127.0.0.1:8787
```

The command also starts Vite for frontend hot reload. Vite normally uses
`http://127.0.0.1:5173`; if that port is occupied it reports the next port,
such as `5174`. The bridge URL remains the canonical full-app URL.

Stop the foreground Vite process with `Ctrl-C`; a bridge started by
`dev:local` is stopped with it. An already-running bridge is left untouched.

For the supervised one-command workflow, use `npm run dev`. It keeps the
bridge and Vite on loopback by default, waits for a healthy
`/api/capabilities` response before starting Vite, proxies `/api` and `/ws`,
and terminates both child processes when either exits. It builds a missing
bridge binary and uses the stable socket path unless `HERDR_SOCKET_PATH` or a
bridge argument overrides it. Address variables are namespaced as
`HERDR_WEB_BRIDGE_HOST`, `HERDR_WEB_BRIDGE_PORT`, `HERDR_WEB_DEV_HOST`, and
`HERDR_WEB_DEV_PORT`; `dev:local` remains the reuse-existing-bridge workflow.

The optional Settings → Terminal → Screen-reader text control is off by
default. When enabled, each terminal exposes only a bounded, debounced plain-
text mirror of its visible active viewport, including rows currently visible
while the terminal is scrolled into scrollback; it does not publish unbounded
terminal history, hidden cells, or terminal output to a bridge capability or
server endpoint.
Desktop IME preedit remains local to the browser and canceled composition is
discarded before terminal input is sent.

## What must be running

| Layer | Required | Purpose | Default endpoint |
| --- | --- | --- | --- |
| Herdr server/session | Yes | Owns workspaces, tabs, panes, agents, and terminals | `~/.config/herdr/herdr.sock` |
| `herdr-world-bridge` | Yes | Converts browser HTTP/WebSocket traffic to Herdr protocol traffic | `http://127.0.0.1:8787` |
| Vite frontend | Only for HMR | Serves current React/TypeScript source during development | `http://127.0.0.1:5173` or next free port |
| OTEL/Prometheus stack | Optional | Supplies the Office `Economy` metrics board | Prometheus `http://127.0.0.1:9101` |

Herdr session data and the live Office roster do not depend on OTEL. If the
telemetry stack is absent, the Office metrics board reports unavailable while
the Herdr state and Office rooms remain usable.

## Manual startup

Use two terminals when debugging a layer independently:

```bash
# Terminal 1: from herdr-world/
scripts/run-bridge.sh

# Terminal 2: from herdr-world/
npm run dev:web
```

For the simplest no-HMR run, build once and open the bridge directly:

```bash
npm run build
scripts/run-bridge.sh
```

To target a named Herdr session:

```bash
HERDR_SESSION=my-session scripts/run-bridge.sh
```

To target an explicit socket:

```bash
HERDR_SOCKET_PATH=/absolute/path/to/herdr.sock scripts/run-bridge.sh
```

## Optional Office telemetry

The Office `Economy` board can read from any operator-managed Prometheus-
compatible HTTP API. The telemetry service is optional and is not required for
Herdr World sessions, the live Office roster, or room interactions. Herdr World
does not assume ownership of the collector, storage, dashboards, or their
deployment lifecycle.

When a Prometheus-compatible service is available, restart the Herdr World
bridge with its API URL:

```bash
cd /home/ny/Forge/ai-palace/herdr-world
# Stop an existing bridge on 8787 first if dev:local reports that it is healthy.
HERDR_WORLD_OTEL_PROMETHEUS_URL=http://127.0.0.1:9101 npm run dev:local
```

`dev:local` deliberately reuses a healthy existing bridge, so it cannot apply
new bridge environment variables to a process that is already running.

The URL above is only an example. Use the endpoint exposed by the telemetry
deployment in your environment; OTLP receiver, log-storage, and dashboard
endpoints are outside the Herdr World startup contract.

To configure the Office provider without restarting the bridge, open Herdr World
Settings, choose `Office`, and save the Prometheus URL. An invalid URL is
reported through the Office provider health state; correcting it applies the
configuration again and returns the provider to its available state. The
setting is browser-local and scoped to the selected bridge profile.

## Fast diagnosis

Check each layer in order:

```bash
herdr status server
herdr session list
curl -fsS http://127.0.0.1:8787/api/capabilities
curl -fsS http://127.0.0.1:8787/api/snapshot
```

- No Herdr socket: start or attach to Herdr first.
- Protocol/version incompatibility: check `curl -fsS http://127.0.0.1:8787/api/capabilities`; use Herdr `v0.8.2` or newer with terminal protocol `20`.
- Bridge `502` from Vite: the bridge is not running on port `8787`.
- Empty snapshot: the bridge is connected to the wrong Herdr socket/session.
- Sessions visible but Office blank in Vite: use the bridge URL and inspect
  the browser console; the Office E2E coverage asserts that the renderer
  produces a live canvas.

## Resize behavior

Terminal rendering still refits on the next animation frame while a pane or
Office conversation is resized. Browser-to-bridge terminal resize messages
are coalesced to the latest cell dimensions and capped at one message per
50 ms, preventing rapid layout/output feedback from stalling the page.
