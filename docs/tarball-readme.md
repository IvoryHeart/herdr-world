# herdr-world Desktop Bundle

This bundle contains the `herdr-world` browser UI assets and the `herdr-world-bridge` executable.
The bundle's root `LICENSE`, `THIRD_PARTY_NOTICES.md`, `UPSTREAM.md`, and files under
`third_party/licenses/` and `third_party/dependencies/` describe the retained
upstream, asset, npm, and Cargo terms.

It does not include Herdr itself. Herdr World requires Herdr `v0.8.2` or newer with terminal
protocol `20`.

Official macOS release archives are published only after `herdr-world-bridge` has a timestamped
Developer ID Application signature and Apple accepts its notarization submission. The distributed
tarball cannot carry a stapled ticket, so Gatekeeper resolves the notarization ticket online when
the bridge first runs. Pull-request and manual CI packages use test-only ad-hoc signatures and are
not production release artifacts.

## Install And Run

From the unpacked bundle directory:

```bash
./install
```

This installs the complete versioned bundle under `~/.local/share/herdr-world`, exposes
`herdr-world` and `herdr-world-installer` under `~/.local/bin`, and then continues into the
consent-based Herdr setup and World startup. Use `./install --install-only` to stop after installing
World. To keep the archive fully portable and install nothing, run `bin/herdr-world` directly.

If the default Herdr session is missing or incompatible, an interactive launch offers to download
and run the [official Herdr installer](https://herdr.dev/docs/install/), separately asks before
stopping an incompatible detached server, then offers to start Herdr in a directory you select.
Stopping a server exits its panes and processes. Herdr is not installed, stopped, or started
without an affirmative answer. Starting Herdr opens its terminal UI; detach with
<kbd>Ctrl</kbd>+<kbd>B</kbd> then <kbd>Q</kbd> so this launcher can continue.

A stale socket with no reachable server is treated as stopped and does not trigger the destructive
stop prompt. Once the bridge starts, it remains in the foreground and prints the local World URL;
press Ctrl+C to stop it.

Guided setup is disabled for non-interactive launches, explicit `--session`/`HERDR_SESSION` targets,
and socket overrides. Use `--no-herdr-setup` or `HERDR_WORLD_SETUP=never` to disable it for a
default interactive launch as well. In all of those cases, install/start Herdr separately and rerun
the bundle.

Open:

```text
http://127.0.0.1:8787
```

## LAN And Android

To expose the bridge to another device on a trusted local network:

```bash
bin/herdr-world --host 0.0.0.0 --port 4000 --allow-origin http://localhost
```

If Android connects through a DNS hostname, allow that hostname too:

```bash
bin/herdr-world --host 0.0.0.0 --port 4000 \
  --allow-origin http://localhost \
  --allow-host herdr-host.local
```

Then add the bridge URL in the Android app's Bridge area of Settings.

For browser-served multi-bridge use, configure both directions. The bridge being called must allow
the web page origin with `--allow-origin`; the bridge serving the web page must allow that page to
connect out with `--allow-connect-origin`. For example, a page opened from `http://host-a:8787` that
connects to `http://host-b:8787` needs:

```bash
# host A, serving the web page
bin/herdr-world --host 0.0.0.0 --allow-host host-a --allow-connect-origin http://host-b:8787

# host B, serving the backend being called
bin/herdr-world --host 0.0.0.0 --allow-host host-b --allow-origin http://host-a:8787
```

Only bind to non-loopback interfaces on networks you trust.
