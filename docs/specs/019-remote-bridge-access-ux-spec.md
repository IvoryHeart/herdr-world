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

This specification defines two deliberately separate UI-managed flows:

1. `Share this machine` controls whether the bridge on this machine accepts
   connections from other devices, the addresses by which it can be reached,
   and its password; and
2. `Bridges` stores and enables other bridge URLs and controls which of those
   destinations the current browser page may contact.

The observable outcome is that a user can enable access on one machine and add
that machine from another without editing JSON, while the bridge continues to
apply exact Host/Origin policy and safely restarts when its service definition
changes.

## 2. Decisions

| Concern | Decision |
| --- | --- |
| Host UI | Add `Share this machine` for inbound access to the bridge running here. |
| Client UI | Keep bridge profiles and outbound browser destination permissions together under `Bridges`. |
| Mode naming | Avoid `Remote access` because it obscures which machine and direction are being configured. |
| Sharing toggle | `Allow other devices to connect` is off by default and preserves sharing settings when disabled. |
| Machine addresses | Hostnames or IP literals that another device may use in this bridge's URL; they are not source-IP authentication. |
| Browser policy | Keep inbound client web app origins and outbound bridge destinations as separate low-level policies, but place each only under its owning flow's Advanced browser permissions. |
| Suggestions | Show detected non-loopback addresses and select the first usable one on first enable. |
| Password | Optional per-bridge password; `null` means no password. |
| Local access | Owner-approved initial implementation treats the actual loopback TCP peer as local. Proper SSH bridging remains future work. |
| Persistence | Host settings persist in the plugin configuration; client profiles persist in browser/native client storage. |
| Restart | Saving host settings applies them through the local controller and safely restarts the managed bridge. |
| Transport | Use the existing direct HTTP/WebSocket bridge for this feature. Do not introduce a generic transport abstraction until a second concrete transport exists. |

## 3. Scope

This feature includes:

- a host-side Share this machine settings area;
- an explicit sharing toggle;
- machine-address editing with detected suggestions and a usable default;
- a copyable bridge address and current access status;
- optional password setup, change, removal, and local reset;
- persistence of host settings without user-facing JSON editing;
- a local-only management path for validating, persisting, and applying settings;
- safe restart and rollback behavior when applying settings;
- automatic derivation of low-level bind, Host, Origin, and CSP settings from
  the two directional flows;
- authentication covering HTTP APIs and all WebSocket routes when a password is set;
- actionable status and connection errors in the existing Bridges test flow; and
- direct use of the existing HTTP/WebSocket bridge transport.

## 4. Non-goals

This feature does not:

- implement SSH tunneling or an SSH credential manager; SSH is a separate future desktop connection mode;
- implement TLS, HTTPS, WSS, certificates, or a public reverse-proxy service;
- implement source-IP allowlists or claim that accepted addresses authenticate a client;
- add user accounts, roles, multi-factor authentication, or a shared identity system;
- add QR codes, automatic LAN discovery, pairing codes, or a bridge registry;
- replace the existing client-side Bridges profile model;
- expose raw `allowed_origins` or `allowed_connect_origins` configuration names to users;
- permit a remote browser to change host-side access settings;
- change the Herdr protocol; or
- preempt or duplicate main Herdr's future native remote-host protocol.

## 5. Terminology

| Term | Meaning in this specification |
| --- | --- |
| Host | The machine running the Herdr World bridge being configured. |
| Client | A browser or native app using a bridge profile to connect to a host bridge. |
| Machine address | A hostname or IP literal that this bridge accepts in the request Host header and advertises as a usable bridge URL. |
| Sharing | A host bridge bound beyond loopback and admitting configured connections from other devices. |
| Local access | A connection whose peer is loopback and which uses the host's local UI path. |
| Host settings | Server-owned access settings persisted with the plugin configuration. |
| Bridge profile | Client-owned URL, label, color, and enabled state persisted by the current Bridges UI. |

A machine address identifies how the bridge may be reached. It does not
identify the source machine and is not an authentication boundary. A client
that can reach a configured machine address may attempt to connect; the optional
password is the basic access-control layer in this feature.

## 6. User experience

### 6.1 Host-side settings

The Settings dialog SHALL add a `Share this machine` area. It configures only
inbound connections to the bridge running on the current machine.

When sharing is disabled, the area SHALL show:

- the disabled toggle;
- the retained machine-address list, if any; and
- a short explanation that the bridge is available only locally.

When sharing is enabled, it SHALL show:

- the enabled toggle;
- this machine's usable addresses as removable rows;
- detected non-loopback address suggestions, selecting the first usable
  suggestion when no saved address exists;
- an `Add address` control for a hostname or IP literal;
- a copyable Bridge URL for other devices;
- password state: `Not set` or `Protected`, with set/change/remove actions; and
- apply status: applying, ready, or failed with a bounded reason.

The normal flow SHALL say explicitly that machine addresses belong to the
machine being shared, not the connecting devices. It SHALL say that the
password protects this bridge and that passwords for other bridges are asked
for when the client connects.

An `Advanced browser permissions` disclosure SHALL contain only `Client web
app origins`: the exact page origins permitted to call this bridge. The UI
SHALL seed standard local Herdr World origins when sharing is first enabled and
the list is empty. Non-standard client origins remain explicit operator input.

The UI SHALL not expose bind flags, generated origins, CSP sources, supervisor
names, service labels, or raw configuration paths in the normal flow.

The primary action SHALL be `Save` or `Apply`. Applying settings MAY briefly
disconnect the current browser because the bridge process may restart. The UI
SHALL explain this before or during the transition and SHALL reconnect when the
new service is ready. Because the loaded document retains its original browser
policy, a successful apply SHALL reload the page after readiness.

### 6.2 Address suggestions

The host-side controller SHALL return a bounded set of detected candidates. A
candidate MAY include the machine hostname and usable non-loopback interface
addresses. Loopback, link-local, container-only, and otherwise unusable
interfaces SHOULD be omitted unless the user adds them manually.

Suggestions SHALL be unchecked until selected manually, except that enabling
sharing with no saved machine address selects the first usable suggestion. A
selection changes only the draft until the user applies it.

The user MAY enter a hostname or IP literal manually. The field SHALL reject a
scheme, path, query, fragment, credentials, or port because the bridge port is
configured separately.

The user MAY add a client web app origin manually under Advanced browser
permissions. The field SHALL accept only a complete HTTP(S) origin without
credentials, path, query, fragment, or wildcard.

When a tested bridge is missing a reciprocal page-origin or destination policy,
the UI SHOULD show a short setup hint identifying which host-side permission is
missing. It MUST not silently broaden either list.

The UI MAY display real addresses to the local operator because they are the
subject of the setting. It MUST NOT write them to logs, telemetry, generated
documentation, test fixtures, or other repository content.

### 6.3 Client-side bridge profiles

The existing area SHALL be labeled `Bridges` and remain the client
configuration surface. A client user continues to add, save, test, and enable
bridge URLs. When the current page is served by a managed local bridge, saving
a profile SHALL add its exact origin to that page-serving bridge's outbound
destination policy, wait for restart readiness, and reload the page so the new
CSP is active. Existing profiles missing that permission SHALL be repairable
with one `Allow saved bridges & reload` action.

An `Advanced browser permissions` disclosure in Bridges SHALL own only the
exact bridge destinations that the current page may contact. The client profile
store remains independent and is not itself authoritative for the host's CSP;
removing a profile does not silently remove an explicitly saved destination.

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
    "allowed_page_origins": [],
    "allowed_bridge_origins": [],
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
- existing accepted Host values are retained as `accepted_hosts`;
- existing `allowed_origins` values are retained as `allowed_page_origins`;
- existing `allowed_connect_origins` values are retained as
  `allowed_bridge_origins`; and
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
host UI. The plugin-owned controller SHALL own configuration writes and
supervisor operations. The public bridge SHALL not expose privileged management
routes.

The owner-approved initial implementation MAY use the actual loopback TCP peer
as its local-management boundary. Host, Origin, and forwarding headers MUST NOT
turn a non-loopback peer into a local one. This deliberately basic boundary
means an operator-created SSH forward or reverse proxy terminating on loopback
inherits local access; deployments MUST NOT expose such a proxy to untrusted
clients. A later SSH bridge SHALL replace this limitation rather than adding a
generic transport abstraction here.

The management path SHALL support:

- reading the current host access state and detected suggestions;
- validating a draft update;
- setting, changing, or removing the password;
- atomically persisting the update; and
- applying the update through the managed supervisor.

The capability SHALL be scoped to the local UI session, kept out of URLs, page
markup, logs, exported profiles, and persistent bridge configuration, and must
not be transferable through a remotely reachable bridge request. A browser
arriving through an accepted remote address MUST NOT be able to modify host
settings.

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

After the controller reports ready, the browser reloads the page so any changed
Content Security Policy applies to the new document. A page reload alone is not
considered a bridge restart.

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
from `allowed_page_origins`, and CSP connect sources from
`allowed_bridge_origins`. Neither list SHALL be inferred from
`accepted_hosts` alone.

For a page served from bridge A to call bridge B directly, A's
`allowed_bridge_origins` MUST include B's bridge origin and B's
`allowed_page_origins` MUST include A's page origin. An Android WebView page
origin such as `http://localhost` is another explicit page-origin candidate;
it is not implied by the bridge address.

The direct two-host setup therefore has two directional settings: adding B
under Bridges on page-serving host A applies B as A's outbound destination,
while Share this machine on target B permits A's exact page origin as an
inbound client web app origin. The first is part of the client Bridge flow; the
second remains an advanced sharing setting on B.

### 9.2 Optional password

`password_hash = null` SHALL mean that no password is required. When remote
access is enabled without a password, the UI SHALL show a concise warning that
anyone able to reach an accepted address may connect.

When a password is configured:

- connections whose accepted TCP peer is loopback MAY bypass password
  authentication under the owner-approved initial local boundary;
- operators MUST treat SSH forwards and reverse proxies terminating on
  loopback as trusted local access and MUST NOT expose them without their own
  authentication;
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

The password is defense-in-depth against casual access. Over cleartext HTTP it
does not provide transport confidentiality, integrity, or server
authentication, and it is not a substitute for TLS, VPN, or SSH. The UI SHALL
state that HTTP exposes credentials and session traffic to a capable network
observer and recommend TLS, VPN, or SSH for untrusted networks.

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

The Share this machine area SHALL distinguish:

- settings saved but not yet applied;
- service restarting;
- bridge ready;
- configuration rejected; and
- service failed to become ready and previous settings restored.

## 11. Direct transport

This feature SHALL use the existing direct HTTP/WebSocket bridge and its current
client connection code. It SHALL not add a generic transport abstraction,
SSH-tunnel manager, or native Herdr remote-host contract. A future transport
can introduce its own boundary when a second concrete implementation and its
common requirements are known.

### Future SSH direction (informative, not part of this specification)

A later desktop-oriented Bridges flow MAY offer two connection modes:

- `SSH` (recommended): use system OpenSSH, the user's SSH config,
  `known_hosts`, and `ssh-agent`, while keeping the remote World bridge
  loopback-only; and
- `Direct URL`: this specification's direct network path for trusted LAN/VPN,
  Android, browser-only, and existing operator-managed reverse-proxy use.

That SSH mode SHALL be a separate proposal and SHALL reuse the user-facing
conventions of `herdr --remote` without managing private keys in the browser or
introducing a generic transport abstraction here.

## 12. Acceptance scenarios

### Scenario: Local-only setup remains seamless

- **GIVEN** a fresh bridge with remote access disabled
- **WHEN** the local user opens Herdr World
- **THEN** the same-origin UI and terminal work without a password or remote
  settings setup

### Scenario: The host enables sharing

- **GIVEN** the local user opens Share this machine
- **WHEN** they enable the toggle and apply the detected address
- **THEN** the host settings persist, the owned service restarts, and the UI
  reports the selected connection URL as ready

### Scenario: Machine addresses remain saved while sharing is disabled

- **GIVEN** a host has saved machine addresses
- **WHEN** the user disables sharing and later reopens settings
- **THEN** the addresses remain available as the next draft but the bridge is
  loopback-only

### Scenario: A client adds a host

- **GIVEN** a host is enabled and reachable at a configured machine address
- **WHEN** a client saves and enables that URL under Bridges
- **THEN** the page-serving bridge permits the destination, the page reloads,
  the client asks for the target bridge's password when configured, and runtime
  data, events, and terminal output become available

### Scenario: An unaccepted address is rejected

- **GIVEN** sharing is enabled with a bounded machine-address list
- **WHEN** a client targets another Host value on the bridge port
- **THEN** the capability test and WebSocket paths fail with a specific bounded
  policy error

### Scenario: An optional password protects remote access

- **GIVEN** remote access is enabled with a password
- **WHEN** a remote client connects without a valid session
- **THEN** protected APIs and every WebSocket route reject the request without
  returning snapshot, event, or terminal data

### Scenario: Local access uses the approved basic loopback boundary

- **GIVEN** remote access is enabled with a password
- **WHEN** the local UI connects with an actual loopback TCP peer
- **THEN** it remains usable without a password

### Scenario: A forwarded loopback connection is treated as trusted local access

- **GIVEN** remote access is enabled with a password
- **WHEN** a browser reaches the bridge through an SSH forward or reverse proxy
  that terminates on loopback without the local capability
- **THEN** the bridge treats the accepted loopback peer as local, so the
  operator-provided tunnel or proxy must supply the missing trust boundary

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
- policy tests proving accepted hosts, allowed page origins, and allowed bridge
  destinations remain directional and are not inferred from one another;
- management-path tests proving non-loopback requests cannot mutate host
  settings and forwarding headers cannot manufacture a loopback TCP peer;
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

## 14. Implementation notes

- The existing plugin controller owns configuration writes and service
  reconciliation.
- The initial local boundary is the accepted TCP peer's loopback address, as
  explicitly approved by the owner; forwarded loopback access inherits that
  trust.
- The browser polls bounded apply status until ready and then reloads so the
  new document receives the current CSP.
- Passwords use the bridge's bounded Argon2 hash and in-memory session token
  implementation.
- Share this machine owns inbound client web app origins; Bridges owns outbound
  bridge destinations. Both remain exact-origin advanced settings.
