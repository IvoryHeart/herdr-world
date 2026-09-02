# UI-managed remote bridge access

- **Spec ID:** `019-remote-bridge-access-ux`
- **Status:** Draft
- **Created:** 2026-09-02
- **Owner:** IvoryHeart / Herdr World
- **Reviewers:** —
- **Approved by:** —
- **Approved at:** —
- **Depends on:** existing Herdr World bridge manager and plugin lifecycle

## 1. Purpose

Herdr World currently requires users to edit the plugin's `config.json` to
expose a bridge beyond loopback. The configuration contains low-level bind,
Host, browser-origin, and bridge-connect settings that users should not need to
understand.

This specification defines a small UI-managed access flow:

1. a host-side Remote access area controls whether this bridge accepts remote
   connections and which bridge addresses it accepts; and
2. the existing client-side Bridges area stores and enables bridge URLs.

The observable outcome is that a user can enable access on one machine and add
that machine from another without editing JSON, while the bridge continues to
apply exact Host/Origin policy and safely restarts when its service definition
changes.

## 2. Decisions

| Concern | Decision |
| --- | --- |
| Host UI | Add a Remote access settings area modeled on the existing Bridges settings UI. |
| Client UI | Keep the existing Bridges UI and saved-profile behavior. |
| Remote toggle | `Allow remote connections` is off by default and preserves accepted addresses when disabled. |
| Accepted addresses | Hostnames or IP literals that clients may use in the bridge URL; they are not source-IP authentication. |
| Suggestions | Show detected non-loopback addresses as unchecked suggestions. |
| Password | Optional per-bridge password; `null` means no password. |
| Local access | Loopback access bypasses the optional remote password. |
| Persistence | Host settings persist in the plugin configuration; client profiles persist in browser/native client storage. |
| Restart | Saving host settings applies them through the local controller and safely restarts the managed bridge. |
| Transport | Direct HTTP/WebSocket remains the first implementation. SSH and native Herdr host transport remain replaceable future adapters. |

## 3. Scope

This feature includes:

- a host-side Remote access settings area;
- an explicit remote-access toggle;
- accepted-address editing with detected unchecked suggestions;
- a copyable bridge address and current access status;
- optional password setup, change, removal, and local reset;
- persistence of host settings without user-facing JSON editing;
- a local-only management path for validating, persisting, and applying settings;
- safe restart and rollback behavior when applying settings;
- automatic derivation of low-level bind, Host, Origin, and CSP settings;
- authentication covering HTTP APIs and all WebSocket routes when a password is set;
- actionable status and connection errors in the existing Bridges test flow; and
- an internal transport boundary that can later support SSH or native Herdr host connections.

## 4. Non-goals

This feature does not:

- implement SSH tunneling or an SSH credential manager;
- implement TLS, HTTPS, WSS, certificates, or a public reverse-proxy service;
- implement source-IP allowlists or claim that accepted addresses authenticate a client;
- add user accounts, roles, multi-factor authentication, or a shared identity system;
- add QR codes, automatic LAN discovery, pairing codes, or a bridge registry;
- replace the existing client-side Bridges settings UI;
- expose raw `allowed_origins` or `allowed_connect_origins` fields to users;
- permit a remote browser to change host-side access settings;
- change the Herdr protocol; or
- preempt or duplicate main Herdr's future native remote-host protocol.

## 5. Terminology

| Term | Meaning in this specification |
| --- | --- |
| Host | The machine running the Herdr World bridge being configured. |
| Client | A browser or native app using a bridge profile to connect to a host bridge. |
| Accepted address | A hostname or IP literal that the host bridge accepts in the request Host header and advertises as a usable bridge URL. |
| Remote access | A host bridge bound beyond loopback and admitting configured remote bridge requests. |
| Local access | A connection whose peer is loopback and which uses the host's local UI path. |
| Host settings | Server-owned access settings persisted with the plugin configuration. |
| Bridge profile | Client-owned URL, label, color, and enabled state persisted by the current Bridges UI. |

An accepted address identifies how the bridge may be reached. It does not
identify the source machine and is not an authentication boundary. A client
that can reach an accepted address may attempt to connect; the optional
password is the basic access-control layer in this feature.

## 6. User experience

### 6.1 Host-side settings

The Settings dialog SHALL add a Remote access area with the same interaction
patterns as the current Bridges area.

When remote access is disabled, the area SHALL show:

- the disabled toggle;
- the retained accepted-address list, if any; and
- a short explanation that the bridge is available only locally.

When remote access is enabled, it SHALL show:

- the enabled toggle;
- accepted addresses as removable rows;
- detected non-loopback address suggestions as unchecked rows;
- an `Add address` control for a hostname or IP literal;
- the connection URL for the selected address with a copy action;
- password state: `Not set` or `Protected`, with set/change/remove actions; and
- apply status: applying, ready, or failed with a bounded reason.

The UI SHALL not expose bind flags, generated origins, CSP sources, supervisor
names, service labels, or raw configuration paths in the normal flow.

The primary action SHALL be `Save` or `Apply`. Applying settings MAY briefly
disconnect the current browser because the bridge process may restart. The UI
SHALL explain this before or during the transition and SHALL reconnect when the
new service is ready.

### 6.2 Address suggestions

The host-side controller SHALL return a bounded set of detected candidates. A
candidate MAY include the machine hostname and usable non-loopback interface
addresses. Loopback, link-local, container-only, and otherwise unusable
interfaces SHOULD be omitted unless the user adds them manually.

Suggestions SHALL be unchecked by default. Selecting a suggestion adds it to
the accepted-address draft; it does not apply the setting until the user saves.

The user MAY enter a hostname or IP literal manually. The field SHALL reject a
scheme, path, query, fragment, credentials, or port because the bridge port is
configured separately.

The UI MAY display real addresses to the local operator because they are the
subject of the setting. It MUST NOT write them to logs, telemetry, generated
documentation, test fixtures, or other repository content.

### 6.3 Client-side bridge profiles

The existing Bridges area SHALL remain the client configuration surface. A
client user continues to add a bridge URL, test it, save it, and enable it.

When a password-protected bridge is tested or first used, the client SHALL ask
for the password in a masked field. The password SHALL not be placed in a URL,
browser history entry, log, exported profile, or persistent client profile.

The initial implementation SHALL retain the authenticated session only for the
current client runtime. A future explicit “remember” choice may use a platform
secure store, but is not part of this feature.

## 7. Host configuration and persistence

The plugin configuration remains the source of truth for host-side settings and
continues to live outside the managed plugin checkout. The UI SHALL update it
through a controlled host-management path rather than asking users to edit it.

The user-facing host model SHALL be high-level:

```json
{
  "remote_access": {
    "enabled": false,
    "accepted_hosts": [],
    "password_hash": null
  }
}
```

The exact storage representation MAY preserve the existing low-level fields for
backward compatibility, but the plugin SHALL have one authoritative normalized
model. The runtime SHALL derive low-level bind and browser policy arguments from
that model. The plaintext password MUST never be persisted.

Existing configurations SHALL migrate as follows:

- loopback-only configurations infer `remote_access.enabled = false`;
- non-loopback configurations infer `remote_access.enabled = true`;
- existing accepted Host values are retained as `accepted_hosts`; and
- an absent password remains `null`.

Host settings SHALL be written atomically with restrictive permissions. A
partial write or invalid setting SHALL leave the previous valid configuration
intact.

The client-side bridge profile store remains independent. It continues to own
URLs, labels, colors, enabled IDs, and selection state in browser storage or
the native preferences store. It MUST NOT be used as the host configuration
store.

## 8. Local management path

The implementation SHALL provide a narrow management path callable by the local
host UI. It MAY be implemented by the bridge with a plugin-owned controller
handoff, or by another local controller owned by the plugin lifecycle. The
choice SHALL not expose arbitrary command execution to the browser.

The management path SHALL support:

- reading the current host access state and detected suggestions;
- validating a draft update;
- setting, changing, or removing the password;
- atomically persisting the update; and
- applying the update through the managed supervisor.

Management requests SHALL be restricted to local operator access. In
particular, a browser arriving through an accepted remote address MUST NOT be
able to modify host settings. Origin checks alone are insufficient for the
local-password bypass; the implementation SHALL use the loopback peer path or
an equivalent local capability boundary.

Applying an update SHALL follow this sequence:

1. Read and retain the current valid configuration.
2. Validate the proposed high-level settings.
3. Derive and validate the complete runtime configuration.
4. Write the new configuration atomically.
5. Ask the plugin supervisor to reconcile the owned service.
6. Wait for bridge, Herdr, protocol, and web readiness.
7. Report ready only after the new service is usable.

If steps 5–7 fail, the controller SHALL attempt to restore the previous
configuration and service state. The UI SHALL report the bounded failure and
offer retry; it SHALL not leave the user guessing whether the service is still
running.

The browser reloads its own connection after a successful apply. A page reload
alone is not considered a bridge restart.

## 9. Access behavior

### 9.1 Toggle

When `remote_access.enabled` is false, the bridge SHALL bind only to loopback
and SHALL preserve accepted hosts and password state for later use.

When it is true, the bridge SHALL bind to the configured LAN-accessible
interface policy and accept only the normalized accepted addresses. The first
implementation MAY bind all interfaces while relying on exact Host/Origin
checks, but the UI SHALL warn that this is not a network firewall or source-IP
allowlist.

The plugin SHALL continue to reject malformed, unconfigured, or wrong-port
Host values. The bridge SHALL continue to enforce exact browser Origin policy
and CSP connect sources derived from the accepted-address model.

### 9.2 Optional password

`password_hash = null` SHALL mean that no password is required. When remote
access is enabled without a password, the UI SHALL show a concise warning that
anyone able to reach an accepted address may connect.

When a password is configured:

- loopback peer connections MAY bypass password authentication;
- non-loopback HTTP requests SHALL authenticate before receiving protected data;
- all event, activity, UI-event, and terminal WebSockets SHALL authenticate
  before sending events or terminal bytes;
- commands, uploads, notes, and other mutating APIs SHALL require authentication;
- password verification SHALL use a memory-hard password hash and constant-time
  comparison; and
- failed attempts SHALL be rate-limited or delayed.

The authentication session mechanism SHALL not put a password in a URL. It MAY
use an in-memory bearer/session credential for HTTP and a corresponding
authenticated WebSocket handshake or first-message ticket. It MUST work for
cross-origin bridge profiles without requiring insecure wildcard CORS.

The password is a baseline against casual access, not protection against a
network observer. The UI SHALL state that HTTP exposes credentials and session
traffic to a capable network observer and recommend TLS, VPN, or SSH for
untrusted networks.

## 10. Diagnostics

The existing client `Test` action SHALL retain its current layout and controls.
Its result SHALL distinguish at least:

- address/network failure;
- Host or Origin policy rejection;
- password required or rejected;
- API capability incompatibility;
- WebSocket upgrade failure; and
- terminal attach failure.

The diagnostic response MAY be composed by the client from staged requests or
returned as a bounded structured capability result. It SHALL not expose raw
server paths, environment variables, credentials, or unbounded process output.

The host Remote access area SHALL distinguish:

- settings saved but not yet applied;
- service restarting;
- bridge ready;
- configuration rejected; and
- service failed to become ready and previous settings restored.

## 11. Transport boundary

The web application SHALL address a host through a transport-neutral bridge
connection interface. The direct HTTP/WebSocket bridge remains the first
implementation.

The interface SHALL keep connection identity, capability probing, snapshot
loading, event subscriptions, terminal sessions, and error classification
separate from the storage and settings UI. A future SSH-backed connection or
native Herdr remote-host adapter MAY implement the same interface.

This feature SHALL not require or assume the final shape of main Herdr's
multi-host protocol. When that protocol is available, Herdr World can replace
the direct transport adapter without changing the host/client mental model.

## 12. Acceptance scenarios

### Scenario: Local-only setup remains seamless

- **GIVEN** a fresh bridge with remote access disabled
- **WHEN** the local user opens Herdr World
- **THEN** the same-origin UI and terminal work without a password or remote
  settings setup

### Scenario: The host enables remote access

- **GIVEN** the local user opens Remote access
- **WHEN** they enable the toggle, select one suggested address, and save
- **THEN** the host settings persist, the owned service restarts, and the UI
  reports the selected connection URL as ready

### Scenario: Accepted addresses remain disabled without being lost

- **GIVEN** a host has saved accepted addresses
- **WHEN** the user disables remote access and later reopens settings
- **THEN** the addresses remain available as the next draft but the bridge is
  loopback-only

### Scenario: A client adds a host

- **GIVEN** a host is enabled and reachable at an accepted address
- **WHEN** a client adds that URL, tests it, saves it, and enables it
- **THEN** the existing Bridges UI shows the enabled bridge and runtime data,
  events, and terminal output become available

### Scenario: An unaccepted address is rejected

- **GIVEN** remote access is enabled with a bounded accepted-address list
- **WHEN** a client targets another Host value on the bridge port
- **THEN** the capability test and WebSocket paths fail with a specific bounded
  policy error

### Scenario: An optional password protects remote access

- **GIVEN** remote access is enabled with a password
- **WHEN** a remote client connects without a valid session
- **THEN** protected APIs and every WebSocket route reject the request without
  returning snapshot, event, or terminal data

### Scenario: Local access bypasses the password

- **GIVEN** remote access is enabled with a password
- **WHEN** the local UI connects through the loopback path
- **THEN** it remains usable without a password

### Scenario: Applying settings fails safely

- **GIVEN** the proposed settings cannot produce a ready bridge
- **WHEN** the user saves them
- **THEN** the previous configuration and service remain or are restored, and
  the UI reports the bounded failure with a retry path

### Scenario: Existing client profiles survive host changes

- **GIVEN** the client has saved bridge profiles in its current store
- **WHEN** a host changes remote-access settings
- **THEN** the client profiles remain unchanged and can be retested or edited

## 13. Validation

The implementation SHALL include:

- unit tests for high-level configuration validation and low-level derivation;
- migration tests for existing loopback and non-loopback configurations;
- management-path tests proving remote requests cannot mutate host settings;
- supervisor/restart tests covering success, readiness failure, rollback, and
  lost runtime records;
- password tests covering null, valid, invalid, rate-limited, loopback, HTTP,
  and every WebSocket route;
- browser tests for suggestions, draft/save behavior, restart status, and
  bounded diagnostics;
- regression coverage proving existing Bridges storage and UI behavior remains;
- privacy-audit coverage for documentation, fixtures, logs, and generated
  output; and
- available web, bridge, plugin, packaging, and end-to-end checks in proportion
  to the changed layers.

## 14. Open implementation notes

The implementation plan SHALL resolve these technical details without changing
the user-facing decisions above:

- which existing plugin/controller boundary owns the local management path;
- how a managed service restart reports readiness to the browser;
- the exact password hash and session-ticket libraries already compatible with
  the bridge build;
- how the bridge obtains peer address information for the local bypass; and
- how the transport-neutral interface maps native Herdr host errors when that
  adapter is added later.
