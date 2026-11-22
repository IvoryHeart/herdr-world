# Shared surfaces notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town, Board, Desk and Spaces share the shell, host filter and operational contexts.
- Desktop and phone use the same qualified selection and accessibility contracts.
- Herdr TUI and herdr-core share projections; native operation support remains runtime-specific.
- Start with a feature's spec and adjacent notes from the capability index.

**Code:**

- `web/src/*.{ts,tsx,css}`
- `web/src/components/`
- `web/src/store/`
- `web/src/styles/`
- `web/src/world/*.{ts,tsx,css}`
- `web/src/world/interaction/`
- `web/src/world/testing/`
- `web/src/world/devtools/`
- `web/src/world/bin/`
- `server/src/*.{ts,tsx}`
- `server/src/rpc/`
- `server/src/service/`
- `server/src/cli/`
- `server/src/utils/`
- `server/src/world/observability.ts`
- `web/src/world/officeObservability.test.ts`
- `server/src/world/snapshot.ts`
- `web/src/world/WorldFoundationApp.tsx`
- `web/src/world/worldObject.ts`
- `web/src/world/interaction/gesture.ts`

**Tests:**

- `web/src/world/WorldFoundationApp.test.ts`
- `web/src/world/worldObject.test.ts`
- `web/src/world/WorldTerminalHandoff.test.ts`

**Pitfalls:**

- A view selection or filter is not permission to operate a runtime.
- Cached topology cannot establish absence or authorize commands.
- Keep one terminal owner and one browser transport across view transitions.
- CLI operations belong to their feature notes; there is no separate shell CLI.
- Shared shell, RPC/state and reusable components use the broad owners above; focused notes retain feature entry points.

## Usage reference

# Herdr World overview

A Web/PWA client for the **Herdr TUI**, **herdr-core**, or both.
[Install it](../../../README.md#quick-start) or follow the [tutorial](../../../docs/TUTORIAL.md).

## Visual control plane

Town, Board, Desk and Spaces are World's views. Office, Tree and Graph have been
retired: `/office` opens Town, and `/graph` and `/tree` open Board. Board and
these redirects are included in [0.2.6](../../../docs/releases/v0.2.6.md).

### Retired views and runtime boundaries

Office, Tree and Graph are retired. Bookmarks still work: `/office` opens Town,
and `/graph` and `/tree` open Board. The Inspector opening preference and Town's
calm motion keep their saved values; Office's room alignment and long-title
settings are gone. The optional Prometheus cost metrics now appear on the Town
board; Board's notes and strings do not depend on Prometheus.

World admits simultaneous qualified local and SSH contexts. Runtime replacement
retires only its own windows and pending work; whole-World disconnect or
authentication loss retires all old leases. Unacknowledged input and mutations
are never automatically replayed; refresh the exact target before retrying.
The responsive installable PWA is the mobile client.
