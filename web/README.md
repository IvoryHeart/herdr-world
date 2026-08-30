# @herdr-world/web

React + Vite frontend for `herdr-world`.

Run from this directory:

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

For the supervised complete local Herdr World run, use the repository root:

```bash
cd ..
npm run dev
```

Open the printed Vite URL for frontend HMR. It proxies API/WebSocket traffic to
the managed loopback bridge. `npm run dev:local` remains available when an
existing bridge should be reused.

The production build is written to `web/dist/` and served through `scripts/run-bridge.sh`. The
upstream-aligned development Cargo target is `herdr-web-bridge`; release bundles install that
executable as `herdr-world-bridge`.

To manage the two processes separately instead:

```bash
# terminal 1, from repo root
npm run bridge:build
scripts/run-bridge.sh

# terminal 2, from repo root
npm run dev:web
```

`scripts/run-bridge.sh` points debug bridge builds at the stable Herdr socket by default instead of
the debug `herdr-dev` socket. Override `HERDR_SOCKET_PATH` when targeting a named or development
session.

The app expects these bridge routes:

- `/api/capabilities`
- `/api/snapshot`
- `/api/command`
- `/api/launcher-presets`
- `/api/launcher-presets/launch`
- `/api/selection`
- `/api/notes` (and `/api/notes/{note_id}/...` actions)
- `/api/agent-pins` (and `/api/agent-pins/{pane_id}/pin|unpin`)
- `/api/agent-activity`
- `/api/uploads`
- `/ws/activity`
- `/ws/events`
- `/ws/ui-events`
- `/ws/terminal`

Launcher execution belongs to the bridge. The frontend selects a preset and placement; it does not
construct Herdr `agent.start` requests. Built-in agents use Herdr's managed-agent flow after the
bridge creates the destination pane, while custom presets retain their exact configured `argv`.

Pane snapshots may include an optional bounded `task_summary` mapped from Herdr pane metadata.
The Office treats it as untrusted presentation text and remains compatible when it is absent. The
bridge subscribes to `pane.updated`, so reports, clears, and expiry are reflected by the normal
snapshot refresh path rather than a frontend-only update channel.
