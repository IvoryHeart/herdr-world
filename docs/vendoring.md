# Vendoring Herdr Compatibility

`herdr-world` vendors a small Herdr compatibility crate because the bridge depends on private API and
wire protocol details that are not exposed as a stable Herdr library or daemon API.

## What Is Vendored

`vendor/herdr-compat/` is the only vendored Herdr source in this repository. It is a minimal local
Rust crate containing copied or lightly pruned compatibility code needed by the packaged
`herdr-world-bridge`:

- JSON API client, status, request, response, and event schema types.
- Terminal attach wire protocol messages, framing, protocol constants, and frame data types.
- Local socket connection helpers.
- Client socket path derivation helpers.
- Small dependent model shims needed by copied schema/protocol modules.
- Bridge file logging adapted to accept a bridge-owned log directory.

`bridge/` remains the repo-owned executable:

- `bridge/src/main.rs` exposes the upstream-aligned Cargo target `herdr-web-bridge`; release
  assembly installs the same executable as `herdr-world-bridge`.
- `bridge/src/session.rs` owns active Herdr session, config directory, and socket path selection.
- `bridge/src/web_bridge.rs` owns the HTTP/WebSocket bridge implementation and browser command
  allow-list.
- `bridge/src/workspace.rs` owns web-specific workspace label derivation.

The full upstream Herdr source tree is intentionally not vendored. Do not recreate `vendor/herdr/`
or path-import files from an upstream checkout at build time.

The browser app is not vendored into Herdr. It lives at `web/`, and the bridge serves `web/dist`
through `--static-dir`.

## Current Reference

- Upstream checkout: a clean Herdr source checkout outside this repository
- Upstream release baseline: `v0.8.2`
- Release commit: `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`
- Terminal wire baseline: protocol `20`
- License: Apache-2.0; see [`vendor/herdr-compat/VENDOR-MANIFEST.toml`](../vendor/herdr-compat/VENDOR-MANIFEST.toml)

The vendored API/schema and terminal-wire compatibility copies are reviewed against the exact
Herdr `v0.8.2` release commit and protocol `20`. The bridge keeps only the narrow compatibility
surface it needs; the full Herdr source tree remains an external audit reference.

Use the upstream checkout as an external reference for audits and refreshes. It is not required to
build `herdr-world`.

## Why This Shape

The bridge needs private pieces from Herdr:

- `api::client::ApiClient`
- API schema enums and response types
- `protocol::{ClientMessage, ServerMessage, RenderEncoding, ...}`
- local IPC socket helpers
- protocol version constants
- terminal attach launch mode, resize, scroll, and input frames

Vendoring only `vendor/herdr-compat` keeps these dependencies explicit without carrying the full
Herdr app, website, CI, terminal runtime build path, or legacy `herdr web-bridge` overlay. The cost
is that copied private protocol/API code can drift from upstream Herdr, so refreshes must be
intentional and reviewed.

The compatibility crate currently keeps `ratatui` and `crossterm` because upstream
`protocol::wire` includes semantic frame and input conversion types next to the terminal attach
messages used by the bridge. `herdr-world-bridge` requests terminal ANSI rendering, but keeping the
wire module broad makes protocol drift reviewable against upstream. Revisit this tradeoff if the
bridge narrows the drift check to only the terminal attach message regions.

## Refresh Process

Use a clean Herdr checkout at the reviewed `v0.8.2` release tag as the source reference. Do not
refresh from an experimental tree that may contain unrelated local drift. Copy the reviewed
upstream source files into the minimal compatibility crate; do not make the bridge compile against
the external checkout or recreate a full upstream vendor snapshot.

```bash
HERDR_SRC=/path/to/herdr
HERDR_WORLD=/path/to/herdr-world
```

1. Verify the source checkout is clean and pinned to the reviewed release:

```bash
git -C "$HERDR_SRC" status --short
git -C "$HERDR_SRC" rev-parse HEAD
git -C "$HERDR_SRC" describe --tags --exact-match HEAD
```

2. Reconcile only the compatibility surface with the repeatable refresh command:

```bash
HERDR_SRC="$HERDR_SRC" scripts/refresh-herdr-compat.sh
```

The command copies only the exact upstream schema root/modules and `src/protocol/wire.rs` listed
below:

```text
src/api/schema.rs          -> vendor/herdr-compat/src/api/schema.rs
src/api/schema/*.rs        -> vendor/herdr-compat/src/api/schema/*.rs
src/protocol/wire.rs       -> vendor/herdr-compat/src/protocol/wire.rs
```

The copied source paths, destination paths, SHA-256 hashes, release provenance, license, and
local adaptations are recorded in [`VENDOR-MANIFEST.toml`](../vendor/herdr-compat/VENDOR-MANIFEST.toml).

3. Preserve intentional local adaptations:

- `ApiClient` takes concrete socket paths; it must not know bridge session rules.
- `logging::init_file_logging` takes a concrete directory from the bridge.
- socket path helpers derive paths from supplied overrides/defaults; bridge session resolution stays
  in `bridge/src/session.rs`.
- `tabs.rs` and `workspaces.rs` keep bridge-internal clear-name sentinel fields; the bridge
  substitutes concrete default labels before forwarding rename requests to Herdr.
- `PopupSize` is public in the compatibility crate because copied public plugin schema fields expose
  it, while upstream keeps the type crate-visible inside the full Herdr crate. This visibility-only
  adaptation is expected by the vendor drift check.
- `input.rs` and `raw_input.rs` retain only the model surface required by the copied wire protocol;
  terminal parsing and host input behavior remain owned by Herdr.
- `protocol.rs` and schema tests include bridge fixture tests for the reviewed protocol/schema
  baseline.

4. Run layout and optional upstream drift checks:

```bash
scripts/check-vendor.sh
HERDR_SRC="$HERDR_SRC" scripts/check-vendor.sh
```

The focused provenance regression creates temporary compatibility copies, corrupts an adapted
entry's recorded source hash, removes an adapted manifest entry, and confirms that `HERDR_SRC`
verification fails closed:

```bash
HERDR_SRC="$HERDR_SRC" scripts/check-vendor-regression.sh
```

The optional `HERDR_SRC` mode parses every `[[files]]` manifest entry, requires the complete
reviewed 23-entry source-to-destination set, and verifies each source hash against the clean
upstream checkout as well as each destination hash. It also exact-compares every copied source file
and the protocol-20 markers. The default mode verifies the manifest's destination hashes, required
protocol-20 wire shapes, and crate layout. Locally adapted files are intentionally excluded from
exact byte comparison, but their upstream source hashes and manifest presence are still verified;
review their local adaptations manually during refresh. `PopupSize` is compared with only the
documented visibility adaptation allowed. Frozen protocol frames live in `vendor/herdr-compat/tests/`
and are tested by `protocol20_fixtures.rs`.

The regression also removes the adapted `src/api/client.rs` manifest entry and confirms that the
checker rejects the resulting 22-entry manifest.

5. Re-run validation:

```bash
npm run lint
npm run test
npm run build
```

6. Smoke test:

```bash
scripts/run-bridge.sh
```

Open `http://127.0.0.1:8787`, attach multiple browser clients, switch panes, type, scroll, and use
the refit button after changing browser sizes.

## Compatibility Policy

The bridge pings Herdr's status API at startup and requires Herdr `v0.8.2` or newer with daemon
protocol exactly `20`. Protocol 19, protocol 21, missing protocol, invalid versions, and other
unreviewed combinations are rejected before terminal attach with bounded diagnostics. The version
floor covers the private JSON API shape, including the managed
`agent.start` contract; the exact protocol check protects the copied bincode terminal wire format.
This is not a complete stability guarantee because the bridge mirrors private APIs.

When updating Herdr:

- inspect `src/protocol/wire.rs`
- inspect API schema changes under `src/api/schema/`
- inspect terminal attach handling in `src/server/headless.rs`
- check out the reviewed release commit and rerun `HERDR_SRC=/path/to/herdr scripts/refresh-herdr-compat.sh`
- rerun `HERDR_SRC=/path/to/herdr scripts/check-vendor.sh`
- rerun bridge tests and a browser smoke test
- update this document if the bridge compatibility surface changes

## Long-Term Removal Condition

Remove `vendor/herdr-compat` when Herdr exposes enough public surface for the bridge to live outside
Herdr:

- public snapshot/events API
- public terminal websocket or stable terminal attach protocol crate
- multi-client terminal fanout or documented attach ownership
- exact pane focus/selection endpoint
- resize ownership model
- browser authentication story
