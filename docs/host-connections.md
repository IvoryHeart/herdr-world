# Host connections and runtime discovery

One host is this computer or one exact OpenSSH destination. Add a remote host with
`herdr-world connections add sample@host.example`; use `--windows` for Windows SSH.
No runtime flag is needed. `connections` lists hosts with runtime kind, discovered
version and current state. `herdr-world ls` includes their rooms, desks and agents,
and how many Town buildings Settings → Group runtimes draws; hosts stay machines.
`connections discover <host-id>` connects and rediscovers; an SSH destination is
also accepted for rediscovery. `connections remove <host-id>` removes that host's
runtime profiles and transports, without stopping the external runtime programs.
Choose another default runtime first when removing the host that owns the default.

Every found runtime connects. Saved endpoints are tried through their original
runtime transports; a live qualified runtime remains found even when its
executable is off PATH or outside the standard installation directories. An installed but stopped runtime reports its own
connection error; it does not hide a reachable sibling. A successfully empty host
stays saved with the registered installation choices. Discovery errors never mean
“install a runtime.” Installing or starting remains a separate person's action.
After at least one runtime is found, host responses offer no sibling installation
suggestions; the Integrations registry retains the additional choices per host.

When World is offline, these commands discover and save for the next start, report
runtime state as disconnected and cannot list live rooms. Live edits use the selected data folder's live
instance address and CLI token; agent URL/token overrides cannot redirect them, and a rejected or unconfirmed reply
never falls back to writing the catalogue. Legacy runtime-specific `add --core`,
`add --ssh` and explicit socket flags remain supported for scripts and installers.
Explicit startup socket/session/SSH overrides continue to pin their runtime; use
saved hosts for general host discovery.

Existing per-runtime auto-connect controls remain authoritative after migration.
For hosts with saved profiles, `auto_connect` is the OR of those profiles' current
settings; an empty host keeps its saved policy. Startup attempts the default and
auto-connect profiles independently before probes, then discovers eligible hosts.
A disabled sibling stays disconnected even when another profile enables the host.
A discovery or catalogue-write failure reports a host error and does not abort
other hosts or whole-service startup.

Per-connection Connect attempts its exact endpoint, including after an earlier
absence report, and returns its failure. It and successful automatic reconnects
repeat host discovery without reviving explicitly disconnected siblings or
resetting their retry policy. Newly discovered runtimes connect. Temporary
absence suspends retry while retaining connection intent for rediscovery;
explicit Disconnect cancels that intent. Explicit host Connect / discover
reconnects every found runtime and therefore overrides per-runtime disconnects.

## API for host screens

`connections.list` adds `hosts` alongside the unchanged `connections` (TUI) and
`core_connections` arrays and `default_connection_id`. Runtime connection IDs
remain the only identities accepted by runtime operations.

Bridge-global RPCs:

- `connections.add_host`: `{host: {type: "ssh", ssh_destination: "sample@host.example"}}`,
  or `{host: {type: "local"}}`; optional `label`, `auto_connect`, `remote_platform: "windows"`.
  Runtime settings, credentials and arbitrary SSH options are refused.
- `connections.connect_host` / `connections.discover_host`: `{host_id: "host-local"}`.
- `connections.disconnect_host` / `connections.remove_host`: `{host_id: "host-local"}`.
- `connections.host_integrations`: additional runtime choices for each host.

`world.snapshot` adds the host catalogue below. `connections[]` retains its existing
topology, coverage, producing generation, stale flag and actionability. Join each
host runtime to that array by `connection_id`; no duplicate topology is serialized.
The same host metadata accompanies observation-v1 based replies, so their existing
token/unchanged protocol continues to govern the per-runtime topology.

```json
{
  "hosts": [{
    "host_id": "host-local",
    "label": "This computer",
    "type": "local",
    "auto_connect": true,
    "connection_ids": ["local-existing", "core-existing"],
    "state": "degraded",
    "discovery": "complete",
    "installable_runtimes": [],
    "runtimes": [
      {"connection_id": "local-existing", "kind": "herdr", "version": "0.9.5",
       "installed": true, "state": "ready", "generation": 3,
       "snapshot_generation": 3, "stale": false, "actionable": true},
      {"connection_id": "core-existing", "kind": "herdr-core", "version": "0.1.21",
       "installed": true, "state": "error", "generation": 7,
       "snapshot_generation": 6, "stale": true, "actionable": false}
    ]
  }],
  "connections": ["existing per-runtime observation objects"]
}
```

An empty host has `state: "empty"`, `discovery: "complete"` and
`installable_runtimes: [{kind, label}, ...]`. Historical removed runtimes may remain
in `runtimes` with `installed: false` and `state: "absent"`; their cached rooms stay
stale. Probe failure sets `discovery: "error"` and a bounded `discovery_error`, with
no installation suggestions. The host is degraded if any runtime remains ready;
otherwise it is unavailable. `version: null` means presence was found but no version
was available. Pending discovery makes no installation claim.

`GET /api/world/integrations` adds `hosts: [{host_id, label, runtimes,
available_runtimes: [{kind, label}]}]`. This keeps adding a sibling runtime out of
host onboarding. Existing confirmed core installation verbs remain unchanged.
The current browser Hosts and Manage connections screens still use their existing
runtime entries; the separate screens item can consume this host catalogue.

`ls` returns `{hosts, connections}`: host runtimes include the existing
per-connection `workspaces` / tabs / panes projection, and `connections` retains
that projection separately. Human output groups runtime names and rooms beneath
their host. Connection CLI JSON keeps legacy `profiles` alongside `hosts`.

## Persistence, migration and provider boundary

For an empty-host preview without a remote machine, run
`herdr-world connections add runtime-fixture.example --preview-empty`.
This testing-only fixture performs no SSH or installation, persists with automatic
connection disabled and reports the normal empty-host installation choices.
`connections discover <printed-host-id>` keeps it empty. Remove it with
`connections remove <printed-host-id>`. The fixture flag is refused for every
other destination, so it cannot replace discovery on a real host.

Version 3 of the private atomic `connections.json` adds `hosts` and presence/version
records. Versions 1 and 2 remain readable. Local profiles group under `host-local`;
SSH host IDs are derived from the exact destination. Matching aliases and
`user@host` strings group, but different aliases are never guessed equivalent.
No OpenSSH configuration is copied into the registry.

Migration preserves every runtime profile ID, including `startup-default` when
first saving implicit local state. Existing native room IDs, positions, pins,
colours and filter storage are untouched. `connection_ids` is the migration map
for host screens: retain the old saved ticks, and select a grouped host when any
of its member IDs was selected. The current per-runtime filter continues to use
those same IDs. A missing runtime retains its profile so rediscovery uses the
original ID and a fresh generation rather than creating a replacement identity.
Keep a copy of the private catalogue before downgrading: older binaries cannot
read version 3. Restore the matching older catalogue with World stopped.

The small `RUNTIME_PROVIDERS` registry owns labels, local presence, fixed POSIX and
PowerShell probes, and default profiles. Registering another provider extends both
discovery and installation-choice metadata; the provider must use an integrated
runtime transport. Discovery checks all providers and admits successful siblings
even if one probe fails. Each runtime's existing manager still owns protocol and
endpoint verification, generations, reconnection, subscriptions and cached rooms.
Host membership never supplies operation authority or a fallback target.

SSH probes only find binaries/default core state and read versions. They use the
existing strict noninteractive SSH policy, have a 12-second deadline per provider,
and never invoke `hc`, a runtime start, installation or an arbitrary remote command.
Local version reads use direct argv with a five-second deadline. Real OpenSSH,
Windows ACL and transport behavior retain their existing platform-test limits.
