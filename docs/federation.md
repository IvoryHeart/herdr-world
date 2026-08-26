# Operating federated Herdr World

Herdr World uses one host-local bridge per Herdr runtime and direct browser federation. It has no
central gateway, fleet controller, SSH manager, authentication layer, or RBAC. Every browser that a
bridge admits has terminal-equivalent access to that Herdr runtime.

## One host on loopback

Start Herdr, build the client, and run the bridge with its loopback defaults:

```bash
herdr
npm run build
scripts/run-bridge.sh --bridge-label "Laptop"
```

Open `http://127.0.0.1:8787`. Loopback Host and same-origin browser requests are admitted by default.
The label is diagnostic; the browser profile label remains the user's navigation label.
Loopback Host matching intentionally accepts loopback authorities on forwarded or development-proxy
ports. This supports local proxies and operator-owned SSH forwards; it is not an access-control
boundary.

Use `--session NAME` to select a named Herdr runtime. The bridge then ignores
`HERDR_SOCKET_PATH`. One bridge process still targets only that one runtime:

```bash
PORT=8788 scripts/run-bridge.sh --session project-b --bridge-label "Project B"
```

## Two directly reachable hosts

Suppose the page is opened from `http://host-a:8787` and the browser must also call
`http://host-b:8787`. Start these independently on their respective hosts:

```bash
# host A: serves the page and its local Herdr bridge
HOST=0.0.0.0 scripts/run-bridge.sh \
  --bridge-label "Host A" \
  --allow-host host-a \
  --allow-origin http://host-a:8787 \
  --allow-connect-origin http://host-b:8787

# host B: admits direct calls from the page served by host A
HOST=0.0.0.0 scripts/run-bridge.sh \
  --bridge-label "Host B" \
  --allow-host host-b \
  --allow-origin http://host-a:8787
```

Add `http://host-b:8787` in Settings → Bridge in the browser. `--allow-origin` on B authorizes the
page origin to call B. `--allow-connect-origin` on A adds B's HTTP and WebSocket origins to the CSP
of the page A serves. Neither option is authentication. Never expose this configuration to an
untrusted network.

In Settings → Bridge, `Enable all` and `Disable all` are convenience actions for the saved browser
profiles. They only change which directly reachable profiles are admitted to the current Office
view; each bridge still has its own capability probe, connection state, origin policy, and failure
boundary. This is a downstream coordination affordance, not a fleet gateway or authentication
system.

The Origin check is a browser cross-site-request guard, not a client identity check. Browsers send
Origin for the cross-origin requests this policy is designed to constrain, while non-browser clients
may omit the header and are admitted. Require authentication at an operator-managed VPN or reverse
proxy if non-browser access must be restricted.

Non-loopback startup fails unless both an explicit `--allow-host` and `--allow-origin` are present.
Add each exact hostname and origin that is required; avoid permissive DNS, wildcard proxy, or CSP
configuration.

## Operator-managed SSH forwarding

Keep both bridges on loopback and create two tunnels using normal OpenSSH configuration. Herdr World
never reads, generates, stores, rotates, or invokes SSH keys:

```bash
# Map remote Bridge A and Bridge B to distinct local ports.
ssh -N -L 18787:127.0.0.1:8787 host-a
ssh -N -L 28787:127.0.0.1:8787 host-b
```

Open `http://127.0.0.1:18787` and add `http://127.0.0.1:28787` as Host B. Because the URLs are
loopback but have different origins, start B with the page origin admitted and start page-serving A
with the forwarded B origin in CSP:

```bash
# on host A
scripts/run-bridge.sh \
  --allow-connect-origin http://127.0.0.1:28787 \
  --bridge-label "Host A"

# on host B
scripts/run-bridge.sh \
  --allow-origin http://127.0.0.1:18787 \
  --bridge-label "Host B"
```

VPN and authenticated reverse-proxy access are also operator responsibilities. When a proxy changes
the externally visible Host or Origin, configure the bridge for those exact values and configure the
page-serving CSP for every bridge origin. The proxy must preserve WebSocket upgrades.

## Failure and compatibility behavior

Each profile is probed independently. An incompatible bridge API, missing feature declarations, or
malformed capability data blocks that host without blocking compatible hosts. A Herdr `v0.8.2` or
newer daemon is admitted only when its capabilities report terminal protocol `20` exactly; protocol
`19`, protocol `21`, a missing protocol, and malformed protocol values are rejected before terminal
attach. A network failure marks only that profile offline.
Stale topology may remain visible for orientation, but structural commands and terminal input,
resize, and scroll stay unavailable until the same host connection is freshly compatible again.

Workspace, pane, and terminal IDs may collide across Herdr hosts. The browser always qualifies them
with the owning profile and never reroutes a failed command or terminal stream to another host.

If the bridge serving the page stops, already loaded browser code can continue talking to other
reachable bridges. A full browser reload still requires the serving bridge or another operator-
provided static origin with equivalent CSP, because this increment does not add an independent web
asset service or central gateway.

## Verification checklist

- Load two compatible host profiles in one browser and confirm both appear in All-host scope.
- Use Settings → Bridge → Enable all and confirm every saved profile is admitted, then disable one
  profile and confirm the remaining host stays navigable.
- Type, send control input, resize/refit, and create/rename/move/close on each owning host.
- Exercise desktop IME composition and cancellation, dismiss a menu/dialog to
  confirm focus returns to its actual trigger, and verify the optional
  screen-reader mirror is scoped to the selected terminal viewport.
- Disconnect one bridge and confirm the other host remains navigable and controllable.
- Configure an exact protocol-`20` fixture and confirm it is admitted; configure protocol-`19`,
  protocol-`21`, or a malformed/missing protocol fixture and confirm it is visible but not
  controllable before terminal attach.
- Attach two browser clients to one terminal and confirm both see output; document that last resize
  wins and the Refit button reasserts the current browser size.
- Verify desktop widths 1440 and 1920, and mobile width 375 with host switching and terminal access.
- Run `npm run check:acceptance` before delivery.
