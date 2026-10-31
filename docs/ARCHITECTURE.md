# Architecture

This document describes Herdr World's current system contracts. See
[FEATURES.md](../FEATURES.md) for behavior and shortcuts and
[DEPLOYMENT.md](./DEPLOYMENT.md) for supported configurations.

## System overview

The composition root exposes `WorldStorage.ids.issue(kind)` through the existing
SQLite worker. IDs have a kind prefix and eight random base32 symbols and become
visible only after their shared reservation commits. Existing SQLite/imported
ledger IDs stay unchanged; reservations outlive record and replay trimming.
See [World identity storage](world-identity.md) for allocation, restoration and
the boundary with legacy JSON families and the claim read models.
`WorldStorage.bindings` persists per-kind source evidence independently of runtime
fences. Its resolver admits only complete current unambiguous matches; Board
strings retain their World-move/qualified-absence policy, while appearance and
interest retain complete-list terminal absence. Board rows and their complete
binding captures commit atomically through the same worker; interrupted imports cannot authorize targets. The Board
Send RPC resolves its saved string before its existing recipient checks. Layout
preferences never enter the binding store and retain native-ID reuse behavior.
`WorldStorage.board()` projects the existing Board document from separate SQLite
tables for notes, strings, appearance, layout concerns, interest and relations.
Queued plans reserve bytes for retained payloads, including RPC parameters,
before admission; guard wrappers preserve that reservation and every outcome
releases it. Snapshot metadata plans retain compact native IDs, spawn tokens and
appearance witnesses with completeness/generation fences; unrelated aggregate
labels and agent metadata do not consume the Board admission budget. Mutations
plan against acknowledged state; the worker validates each
patch against its transaction-local document. Replies, revision events and the
read cache advance after COMMIT. Per-note conflicts and revision-bound Group
confirmations retain their existing wire responses. See [Board storage and recovery](DEPLOYMENT.md#board-storage).
Conversation and source-service read models carry per-field status, session and PR
link claims with provenance and explicit display rules. Channels remove only their
own complete/retracted claims; runtime occupant replacement retires its read model.
Claims remain in memory. Current connection/generation owners retire link claims
independently of topology health; checkout evidence is runtime/host scoped and
GitHub search completeness is explicit before omissions can remove a link claim.
Saved/inferred claims never replace fresh native session
qualification or GitHub's own action authority. Existing visible projections stay
unchanged; see [runtime field claims](world-identity.md#runtime-field-claims).

Agent profiles and chimes live in `world.sqlite` behind `WorldStorage.profiles`.
The same worker validates and commits edits before RPC replies or the synchronous
launch cache advance. Startup imports the configured `agent-profiles.json` once,
with an exact private hash-named backup; subsequent starts use SQLite exclusively.
The store also retains legacy terminal settings awaiting their one-time Herdr
import, per-connection completion flags and the Town master revision watermark.
Current terminal assignments and master tokens remain owned by Herdr. Config,
connection profiles and secrets remain files. See [profile storage and recovery](DEPLOYMENT.md#agent-profile-storage).

`WorldStorage.runtimeStatus` stores auto-sync last-run fields through that same
writer. Each connection runtime receives the composition root's clock and
scheduler. Auto-sync uses that clock for interval eligibility and recorded times,
and cancellable scheduler jobs for its 30-second polling; stopping cancels the
current job and fences callbacks from earlier starts. It reads its committed
cache for interval decisions and awaits result persistence; settings RPCs join it to file-backed schedules. Status updates
never rewrite configuration. First startup backs up settings and imports only
runtime fields once; configuration and secrets remain files. See [runtime status
and recovery](DEPLOYMENT.md#auto-sync-runtime-status).

Runtime adapter registration and its data-only hello descriptors live in the
[adapter registry](../server/src/adapters/registry.ts). Herdr remains the sole
production runtime; its raw topology reads preserve today's snapshot behavior.
See [runtime observation adapters](world-adapters.md) for declared schemas,
limits, the provider-neutral admission boundary, conformance and production
exclusion of the test-only synthetic source.

Browsers cannot open Unix domain sockets or Windows named pipes directly. A
Bun bridge serves the frontend, authenticates browsers, and connects to Herdr:

```text
Browser (React + Vite)
   |  same-origin HTTP / WebSocket
   v
Bridge (Bun + TypeScript) -- node:net --> Herdr sockets
```

`herdr.sock` carries NDJSON control requests; `herdr-client.sock` carries binary
terminal traffic. Browser RPC uses `{ id, method, params }` and returns either
`{ id, result }` or `{ id, error }`, with connection identity attached to scoped
traffic. Subscribed Herdr events are pushed as `{ event: ... }`.

Browser RPC and agent CLI admission use the service-owned static
[verb registry](world-verbs.md), with TypeBox schemas, actor policy, explicit effect
acknowledgements and recovery declarations. Unknown browser methods are refused
before runtime acquisition. Replies can add `command_evidence`: memory admission
is `accepted`, durable records require a `stored` receipt, and acknowledged native
dispatch is `sent` on its captured runtime. The registry preserves existing owner
confirmation and target validation; [the verb guide](world-verbs.md#result-evidence)
describes conservative legacy evidence and the remaining browser challenge gap.

The bridge owns socket access, local/SSH runtimes, file/Git/worktree/hook/session
operations, terminal and clipboard relay, optional observability-provider access,
authentication, health, and updates.
React owns presentation and browser-local preferences. xterm displays Herdr's
server-rendered output rather than reconstructing a PTY in the bridge.

Spaces keeps one focused qualified workspace; visual Inspectors retain independent
operational contexts across ready connections. The bridge-global
`world.snapshot` path reads bounded topology from every ready runtime. The browser
qualifies that data by connection and generation into one WorldObject used by Town,
Board, Desk and the common navigator. Aggregate observation is never mutation authority: opening a terminal,
Files, Changes, or Agent History revalidates the captured owning runtime without
changing another context. The browser sends bounded deduplicated open-context host
hints (or visible hosts when no contexts are open) in the global snapshot request.
The service rotates priority and background work, preserves background progress
within four observation slots, releases an unused priority reservation, and returns the complete managed-host catalogue within a
20-second response deadline. Unfinished hosts expose only stale, non-actionable cached
topology or no children. Per-host work is shared across overlapping requests; a late
result enters the cache only for its original current runtime generation and triggers
a coalesced refresh when its observed data changes. A current result may be reused for
15 seconds unless that host receives an explicit topology invalidation. The browser
uses one World WebSocket with a transport epoch independent of runtime generations.
The hello advertises `world_observation_v1` and a random `service_incarnation`
shared with snapshot replies. A caller may send `base: { service_incarnation,
hosts: [{ connection_id, generation, token }] }` to `world.snapshot` (at most 64
hosts, with tokens of at most 64 characters). The service hashes each projected
host and its producing generation; digest reuse follows the projection cache.
When incarnation, runtime generation, snapshot generation and token all match,
the reply carries current host metadata and `unchanged: true`, omitting
`snapshot`. Other hosts carry complete snapshots and tokens (null without a
snapshot). Unknown bases and foreign incarnations use complete replacements.
Malformed bases fail before acquisition. Service-side appearance and profile
processing always sees the complete observation, before wire replacement.
Callers without a base keep complete topology and the existing chunk admission.
The browser sends its held base only after negotiation. It applies each reply as
one publication, retains unchanged host content by identity and rechecks current
Bridge qualification after cooperative preparation. A lost retained base discards
the reply and requests one complete recovery; a base refusal disables bases for
that hello. Only explicit base or snapshot-parameter refusals trigger that
fallback; unrelated storage/read errors retain negotiated bases. A different incarnation cannot reuse old content, and a reply from a
foreign incarnation is rejected. An all-unchanged reply with identical host
metadata prepares and publishes nothing.

Changed hosts share unchanged observation records. Each room caches the complete
slice it reads: workspace, tabs, panes, admitted agent metadata, coverage and the
owner/generation/presentation fences. Appearance and watch overlays retain rooms
they do not change. Town caches canonical and bounded room presentations, and
Board caches room topology; host/world summaries use their per-room contributions.
Only mounted Town/Board consumers request their respective preparation, using
the same Hosts, watched-only and appearance projection they present. Changes outside
that scope update the aggregate World without preparing hidden view rooms. A newly
selected view builds any missing model before presentation; the Board document
continues serving appearance and relations in every view. Profile looks compare
the effective per-agent look, so unrelated profile revisions reuse prepared looks.
Seen/finished marks keep their existing targeted overlay and reception/summary
semantics. Spaces remains mounted and qualified operations retain their own leases.

Host filters affect overview visibility only. Context-bound selectors and commands
read and update connection partitions in the existing store. Each terminal has one
qualified presenter; Spaces/visual handoffs detach before admitting the new presenter.
Workspace resources preserve checkout identity, while agent resources additionally
validate session identity. Missing original notification session identity is visible
but non-navigable. Runtime retirement removes only matching arrangement participants
and restore baselines; filters leave these intact. Global creation names one host.
In a bounded synthetic 64-profile case with one current selected host and 63 stalled
hosts, the partial response was 16,090 serialized bytes; an immediate repeated
request started no additional Herdr calls while inactive fetches remained in flight.
This is a partial-response measurement, not a maximum payload size. Each fully
observed host still has its existing 512-workspace, 2,048-tab and 4,096-pane/agent
record caps, so payload size grows with actual topology across the 64-profile limit.

The service also supports explicit focused interest through
`world.focused.observe`: each socket replaces up to 64 connection/generation
owners, and an empty declaration releases them. One observer per held runtime
reads the enriched workspace, tab, pane and agent lists 5 seconds after the
previous read settles. Only successful replies to list requests marked
`focused_observation: true` record what that socket received. An observation
sends `world_focused_changed` to holders whose received lists differ, excluding
agent activity timestamps and pane scroll positions. Last release, socket close,
service stop and runtime retirement fence pending results. Profile changes,
connection state/generation changes and browser count changes publish
`world_connections_changed` with a service-local revision.

Session-file activity is cached separately from live agent status for at most
one observation period. Concurrent list readers share a pending activity read;
the observer refreshes that reading and pushes a changed, session-qualified
`world_agent_activity` map only to current holders. Last release discards the
cache, and lease retirement or release during a read prevents publication.
Browser connection partitions keep the maximum activity timestamp per pane,
terminal, agent and session. A late list or layout reply cannot undo a push;
status agreement gates only the native state sequence. Replaced sessions and
runtime generations do not inherit unrelated identities' activity. Read-only
maxima live outside runtime admission state, so restarting World and resetting
its generation counters does not lower the same external agent session's recency.
An admitted list rejoins only the exact connection, pane, terminal, agent and
session; old-generation controls still fail admission. Multiple identities for
one pane retain separate maxima while its first layout is pending.

The service advertises `world_shared_acquisition`. A visible browser declares
its active ready host and each open Inspector's qualified owner. Inspector
references are independent of the active host and host filter. New admissions,
including previews on an already-held host, re-list after admission; fresh
qualified absence can then remove an already-closed preview. Hiding releases all
interest; returning re-lists every held owner and fetches the catalogue.

Focused re-lists mark only their four list request frames. Herdr events,
resynchronization, own actions and admitted change notices still re-list through
the existing scoped coalescer. Catalogue notices fetch `bridge.status` with one
request in flight and at most one queued successor. Failed catalogue reads,
including bootstrap, and failed held re-lists retry after five seconds while
visible and current; success, release or retirement stops those retries.

Desk declares its existing fair selections, at most 16 screens and 40 receipts
per browser. The service reads their union once per kind, connection, generation,
pane and session fingerprint, with independent host queues. Screens run every
4 seconds; receipts every 20 seconds and when a holder's trigger changes.
Triggers are captured per holder at read start; a late holder receives the actual
result with a null trigger and makes one successor due. Last release stops work.

There is no successful periodic browser re-list or catalogue fetch under this
capability. Without it, the browser retains its 5-second focused timer and Desk's
4-second/20-second reads. Capability removal on reconnect restores that fallback.
The update check remains independent. Spaces stays mounted, and the aggregate
refresh and 15-second fallback retain their existing behavior.

Large aggregate replies negotiate bounded chunks on the same World WebSocket.
Scoped acknowledgements can interleave between chunks; partial responses belong to
the pending global request and are discarded on transport retirement. Older clients
retain the ordinary reply format. Large negotiated replies decode in isolated,
bounded browser worker jobs; host-sized messages admit the complete decoded result
across tasks. Sending the raw strings to the worker still incurs a measured
main-thread clone. Transport retirement and timeout cancel the owning job.
Server serialization remains atomic; dense acceptance measures
input through receipt, decode, preparation and rendering.

Persisted Hosts filters reconcile only after a validated catalogue is admitted on
the current transport. Socket readiness alone is insufficient: a delayed initial
list preserves saved IDs, while a successful empty list removes them. Old transport,
malformed and superseded list replies cannot confer catalogue readiness.

The production-transport browser fixture exercises all 64 profile roots with a
40,629,895-byte dense snapshot, two qualified terminals and 320 full terminal
repaints per second. Independently timed trusted input continues through receipt,
parsing, preparation, rendering and a refresh with three stalled observations at
the default 20-second response deadline. Town and Board are checked at 1440px and
390px against engineering budgets of p95 intended-input-to-acknowledgement below
150ms and maximum below 450ms for Town, and below 200ms and 500ms for Board. Intended-to-sent drift and sent-to-ACK delay are
reported separately. Passing local samples do not replace the exact-head CI gate;
prior CI exceeded these budgets. Atomic work and perceptible tails remain. This is
synthetic transport and rendering acceptance, not a live network latency guarantee.

Town keeps DOM cards and targets only for buildings near the screen and bakes each
building the first time it is visible. A Board with more than 300 cards renders
only the cards near the screen and opens in the overview. Complete rosters still
support search and reveal. Identical terminal surfaces retire unqualified link actions
without repainting unchanged rows unless a link decoration needs invalidation.

Terminal input failures publish a bounded notice for the captured original owner,
including after retirement. Ambiguous input is never replayed. The user must refresh
and verify that exact terminal before deciding whether to retry.

Dense browser observations decode each owner and prepare qualified host models,
Town rooms and complete semantic rosters in cooperative background tasks before
publishing. Cached roster indices let bounded scene changes update presentation
flags without reconstructing discarded rooms or losing full-observation search.
Transport and runtime identities are checked
again after preparation; a retired host becomes non-actionable without discarding
healthy siblings. Town admits its accessible scene targets in bounded batches. Canvas animation
leaves ordinary socket tasks turns between paints; overview work cannot replace a
captured operational owner.
Streaming terminal output preserves keyboard focus in another mounted terminal.
Self-contained native repaints retain the newest frame per animation turn; legacy
incremental output remains ordered and complete. Both paths recheck the captured
owner before presentation, including when a frame was queued before retirement.

Cost observability is optional and separate from Herdr runtime authority. The World
service validates one credential-free Prometheus base URL, issues only fixed bounded
24-hour token and reported-cost queries, and returns a bounded same-origin snapshot to
the browser. Provider responses cannot add topology or target actions. No provider, a
timeout or a malformed response produces unavailable/degraded board health without
affecting WorldObject refreshes, terminal routing or Inspector work.

## Agent activity

The bridge enriches `agent.list` with optional `last_activity_at` epoch
milliseconds from the session file's modification time. Resolution uses the
reported session identity and the connection's file access, without parsing
transcripts. File checks have bounded concurrency and a 1.5-second response
budget; unavailable metadata never removes agents from the list. Remote IDs
that require local directory searches are left unresolved rather than matched
to this host's sessions. The browser uses timestamps for idle-agent recency,
with Herdr's state-change sequence as a fallback, and stores no activity history.

## Terminal endpoints

Interface scale uses root CSS zoom. Terminal surfaces cancel that zoom and
apply a separately saved terminal font scale, so cell measurements, selection,
mouse input, and IME positioning stay in viewport CSS pixels. Radix popovers
also cancel zoom around their positioning wrapper and reapply it to the
content; their viewport limits convert back to content units. Chat's text
uses `--chat-font-size`: 13px times its own saved scale, or the terminal font
scale while linked.

Backend selection uses the verified protocol allowlist, not browser version
inference. See [Herdr compatibility](./DEPLOYMENT.md#herdr-compatibility) for
versions, fallback configuration, and clipboard limitations.

One passive endpoint shell per ready runtime relays Herdr semantic task
notifications to qualified browser events and Web Push. Legacy Herdr uses the
agent-status tracker. The terminal bridge observes session popup state and
routes its popup terminal through the same connection lease and generation;
the browser renders that popup over the shared World shell.

Herdr 0.9.0 endpoints require generation 1 and the exact codecs
`shell.snapshot.v1`, `shell.surface.v1`, `shell.input.semantic.v1`, and
`shell.blob.v1`. Unknown generations/codecs are rejected regardless of advertised
capabilities. Attachment waits for the initial snapshot. Each terminal crops its
pane from the server-rendered tab surface and sends semantic input to that pane;
panes retain their shared layout dimensions.

Incremental surface patches update only the named panes; other pane metadata
remains available for cropping and cursor delivery. Each patch replaces the
complete cursor state, including `null` to clear it. Pane topology changes
require a full surface; patches naming unknown panes are discarded.

`terminal.attach` carries pane content dimensions in `cols`/`rows`. When layout
is available, the browser also supplies `surface_cols`/`surface_rows` for the
complete tab, including pane borders but excluding app sidebar/tab-bar insets.
The bridge validates this optional pair as integers in 1..65535 and uses it in
new endpoint handshakes. Surface feedback corrects stale or missing hints;
legacy direct attachments continue to use the pane content dimensions.
Endpoint repaints are clipped to each viewer's requested viewport, including
wide-character and cursor boundaries. Browsers discard oversized frames that
arrive after a local shrink or were held during text selection.

Terminal links retain cell coordinates while scanning soft-wrapped text. Endpoint
cell repaints do not contain soft-wrap metadata, so file detection also considers
adjacent path fragments with application-inserted indentation and padding. These
inferred paths must pass workspace-scoped file resolution before activation;
ordinary rows remain independent when no combined file exists. Scanning is bounded,
blank lines separate contexts, and HTTP links use only explicit soft wraps. Pending
lookups are discarded if the buffer, text, cell positions, or wrapping changes.

Method/capability advertisements belong to each terminal socket, never another
terminal or runtime. Reattachment negotiates again; browser reconnect and
connection changes clear cached availability until refreshed. The bridge returns
availability in attach replies and scoped workspace metadata, then checks every
method again at dispatch:

- `pane.focus` is required for safe attachment; absence fails without legacy
  takeover.
- `pane.scroll` gates history scrolling; `tab.create` and `workspace.create`
  gate creation on the existing source endpoint. UI controls explain missing
  methods or pending negotiation. Unrelated control-API operations are unaffected.
- Input and resize are core codec operations, not optional methods. Only
  `health_check` enables endpoint ping/pong. `surface_interest` and
  `presentation_effects_fence` do not enable surface-setting or fencing controls.

Full page-key requests use semantic PageUp/PageDown input on endpoints. Herdr
routes them to the application or host scrollback using the PTY's current modes;
they do not require `pane.scroll`. Explicit half-page history requests continue
to use `pane.scroll`, including in mouse-aware applications. Legacy attachments
retain their PageKey/Wheel routing. Both keyboard shortcuts and mobile buttons
use this contract.

Mouse input uses zero-based pane-local cells, bounded to the crop. Only a press
inside the pane acquires drag/release ownership; later positions clamp to its
edge. Reporting changes and session closure cancel ownership. Mouse-aware apps
receive semantic mouse events; ordinary wheels and explicit history shortcuts
use history scrolling. History requests coalesce wheel intent while one dispatch
awaits both its RPC reply and viewport feedback; other terminal commands remain
usable. A confirmed no-op reply needs no repaint. Completed movement is not
rebased by later history growth. Surfaces have no request identity: a changed
viewport can also be an external replacement, which becomes authoritative when
no newer wheel intent is queued. Input, missing panes or scroll metrics, and
session closure cancel queued history movement. During browser selection,
presentation retains only the latest full repaint and resumes when selection clears. Pane/session changes
retire pending presentation; selection replay cannot send application input.
Endpoint frames include content revision and absolute viewport rows when the
viewer receives the complete pane crop. Edge-drag selection requests overlapping
history viewports one at a time, admitting only matching-revision repaints while
retaining immutable copies of visited cells. Copy uses the complete absolute
range, not just its visible highlight. Release, lost mouse-up, blur, resize, and
attachment reset stop drag scrolling. Changed content or geometry stops further
history requests and preserves the already captured selection.

Input waits for attachment readiness and revalidates the attachment, session,
and routing lease. It is never replayed into a detached or replaced terminal.
Disconnect rejects pending endpoint requests and invalidates clipboard ownership.

Mermaid file previews and Markdown fences share a lazy renderer and independent
zoomable viewports. Source wrappers and leading metadata/comments are removed
before diagram-type detection; source views retain the original file. Layout and
theme remain controlled by Studio. Image previews use inert image elements;
workspace SVG endpoints also send a sandbox CSP for direct navigation, blocking
scripts and external resources. SVG source is never inserted into Studio's DOM.

## Browser navigation and creation

On endpoint connections, `browserNavigation.ts` projects browser-local
workspace/tab/pane choices into the shared UI selection fields. Snapshots supply
topology, not subsequent navigation. Stale layouts and delayed action results
cannot replace newer browser selections. This is independent workspace/tab
navigation, not independent native same-tab pane focus. Legacy navigation,
topology mutations, and terminal dimensions remain shared.

Active terminal selection and terminal clicks send `terminal.focus` through the
attached shell's `pane.focus` endpoint so the tab surface supplies that pane's
cursor. The browser restores its selection after split attachments become ready,
but does not refocus on streaming frames or routine snapshots. Focus requests are
serialized per browser across endpoint lanes, superseded queued selections are
discarded, and attachment ownership and connection leases are rechecked before
dispatch. Same-tab cursor ownership remains shared with other Herdr clients.

Creation uses explicit context and `focus: false`, adopting returned IDs only
while the initiating selection and connection lease remain current. Herdr World-only
`browser_source` identifies the source terminal, pane, tab, and workspace. The
bridge validates attachment ownership and live topology, strips that field, and
calls the advertised create method on the existing endpoint's serialized
focus/scroll lane. It creates no extra endpoint or focus call. Omitting a
synthesized cwd preserves Herdr's `terminal.new_cwd` policy; explicit cwd wins.
Same-tab pane focus, including the `follow` cwd source, remains shared.

Missing source attachments fail explicitly. The only exception is first-workspace
bootstrap: each runtime serializes an empty `workspace.list` check and control
creation, rechecking lease and deadline before dispatch. Competing creations must
retry once topology becomes nonempty. The 20-second admission deadline covers
readiness, validation, and queue residence, below the browser RPC timeout.
Expired undispatched mutations never execute; dispatched timeouts report uncertain
completion so callers check Herdr before retrying.

Subscription acknowledgements, including reconnects, trigger fresh snapshots;
events during refresh queue another refresh. This reconciles missed changes,
not an atomic or replayable event log.

## Per-terminal profile settings

Herdr owns profile assignments and Town master claims as four namespaced
metadata tokens on the terminal. `server/src/agent/terminal-tokens.ts` validates
the terminal witness and all values, writes through the exact current lease,
and checks that lease again after dispatch. The shared Town move path checks
the moved terminal and restores keys only if Herdr dropped them.

`server/src/agent/terminal-settings.ts` projects these tokens for browsers.
After complete clean host observations, its separate reconciliation work
imports legacy assignments once per connection and clears superseded master
claims; it never delays snapshot delivery for those writes. Unreachable
hosts retain unresolved observations; removing a connection retires its cached
assignments and claims without changing the terminal tokens. Import eligibility
is rechecked against the current terminal read, so a stale list cannot replace
a newer assignment. Every valid revision learned through a current write or
guarded cleanup read advances the clock watermark before the next allocation.
The highest claim revision is durable
with the profiles; assignments use `max(now, highest seen + 1)`, with ties
broken by the greater terminal ID. Cross-machine clock skew remains a limit.
Profiles and chimes stay World-local. Migration backup and rollback details
are in [deployment](DEPLOYMENT.md#terminal-profile-settings-migration).

## Connection isolation

A bridge-global `ConnectionManager` owns shared profiles and independent
`ConnectionRuntime` instances. Each runtime owns its transport, clients, viewers,
clipboard relay, subscriptions, services, caches, and reconnect lifecycle.
Browser selection does not start or stop other runtimes; render streams open
only while viewed. Disconnect/removal disposes the bridge runtime and SSH tunnel,
not Herdr or its workspaces.

Downstream RPC/HTTP requires an immutable connection ID, runtime generation, and
request-local ready-runtime lease. Replies, errors, events, terminal frames, and
clipboard pushes carry that identity. HTTP streams recheck the lease per chunk
and cancel their source on replacement. Dispatched effects may finish on the
original runtime, but retired replies, chunks, and metadata cannot publish.
Explicit malformed, unknown, stale, or not-ready identities fail without fallback.
Omitted identities remain a bounded, logged compatibility path for the process default.

Bridge-global authentication, health, updates, client accounting, and profile
management remain independent of downstream readiness. Global RPC rejects
misleading connection fields. Only ready runtimes route requests; start, stop,
replacement, and post-ready transport exit invalidate leases before publishing
status. Starts/stops are serialized, shutdown is bounded, and one failed runtime
does not block management or healthy connections.

Browser mount keys, caches, notifications and asynchronous actions carry their
connection and runtime generation. Focus changes preserve independent leases;
same-ID runtime replacement clears only that connection's cached sessions before
resource IDs can be reused. World transport loss or authentication failure retires
all old clients. Ambiguous input or mutations are not queued or replayed.

The runtime store retains every managed host. Hosts filters Town, Board, Desk,
the navigator, counts and search without changing lifecycle or open contexts.
The navigator shares fair 128-space admission and 16 leaves per space, preserving
priority ancestry; paged search uses full admitted observations. Offline roots and
exact stale/unknown/omitted coverage remain visible. Outside-filter Inspectors retain
their owned commands and labels, with connectors only to visible exact anchors.

## Workspace resource ownership

A checkout owns Files/Changes data; a workspace supplies its runtime route; a tab
is a return location; a pane supplies optional path/session context. Repository
groups do not represent a combined working tree. Changes describe checkout edits,
not proof that one agent produced them. Last step uses recorded activity snapshots,
not attribution of arbitrary working-tree edits.

Last step stages its temporary Git index and objects under the checkout's Git
directory in `herdr-world-last-step-capture`. If the checkout and Git directory
are on different filesystems, capture briefly creates a private
`.herdr-world-last-step-pin.*` directory beside each source file to pin its inode
while bounded bytes are copied into Git storage. Normal completion and handled
failure remove these directories. After an interrupted capture, verify that no
writer is still active before removing a stale capture lock and any leftover pin
directories; a live writer may still be using them.

Git resource keys encode the endpoint-qualified repository identity
(`worktree.gui_settings_key`) and normalized checkout path as a pair. The path
separates linked checkouts; the repository identity separates SSH destinations
when a saved connection is repointed. Missing or blank settings keys fall back
to the trimmed repository key, which cannot distinguish endpoints on its own.
Newly enriched identities do not inherit this fallback's stored state. Runtime
generations are not part of persistent keys. Non-Git resources use workspace
identity. All are connection-scoped.
Workspaces sharing a checkout may share caches, but requests retain
workspace/runtime leases and resource revisions: refresh/removal retires
older prefetches. Tab/pane IDs do not own resource caches.

Older repository-wide Inspector storage is not automatically migrated: its file
selections, layout preferences, and review drafts do not identify their original
checkout. The original browser storage is retained, while checkout-specific
state starts fresh. Switching checkouts restores that checkout's saved selection
or shows its file list when nothing has been selected.

Inspector actions capture the originating workspace instead of consulting global
focus when results arrive. A vanished workspace can rebind only to the same
checkout; a missing path must not fall back to a sibling worktree. Agent cwd is
used only inside the checkout, otherwise browsing starts at its root. Successful
worktree removal clears that checkout's state and retargets/closes the Inspector
without affecting siblings. Closing one workspace does not erase resources still
used by another workspace for that checkout.

The terminal stays mounted across Inspector views and geometry changes. Resource
layout/preferences are separate from content caches. See
[Workspace Inspector](../FEATURES.md#workspace-inspector) for controls and
[History synchronization](./HISTORY.md) for session projection contracts.

## Filesystem browsing

`file.list` stays checkout-relative by default, including realpath checks for
symlink escapes. Each filesystem listing explicitly sends `scope: "filesystem"`
and an absolute host directory; returned entries use absolute paths and the reply
confirms its scope. This mode is local to the open explorer and is never persisted
as a browser-wide permission or shared with another checkout/connection. Directory
responses from a retired view cannot replace its successor. Search filters only
loaded entries and never recursively scans the filesystem.

Absolute preview resources use `scope=filesystem` on download URLs. Relative
Markdown links and images resolve beside their absolute source document. Upload
and delete remain checkout-scoped; filesystem mode exposes browsing, previews,
copying paths, and downloads. Explorer resource caches stay separate from the lazy
UI so opening a terminal does not load the file-search matcher or browser controls.

## SSH transport

Each SSH runtime supervises one OpenSSH process forwarding both sockets into a
private temporary directory. Readiness requires control `ping` and a render
handshake. Transient failures use cancellable backoff capped at 30 seconds and
six attempts, resetting after 30 seconds stable-ready; authentication, host-key,
and permanent protocol failures do not retry. Post-ready exit retires the runtime
generation before retry. CLI SSH uses the same validation/probes but does not
persist or automatically retry.

Only an OpenSSH alias or `user@host` is accepted, passed after `--` with fixed
options. Host-key checking stays enabled; service authentication is noninteractive.
Credentials/options remain in the service user's OpenSSH configuration. Stderr is
bounded and sanitized, not relayed as raw banners. Cleanup removes owned paths
only after confirmed child exit; unconfirmed termination preserves paths and
reports failure. Remote file, Git, hook, and supported session operations use the
same runtime host boundary. See [connection setup](./DEPLOYMENT.md#local-and-ssh-connections).

## Distribution model

Production builds embed the frontend and Bun runtime into one platform executable;
users need neither Bun nor Node.js. Source builds use Bun and Vite. See
[standalone builds](./DEPLOYMENT.md#source-development-and-builds).

Herdr World has a separate release namespace: executable and package members,
archive/checksum filenames, and manifest identity all use `herdr-world`. Every
release provides a manifest; missing or mismatched metadata fails closed without
an archive-discovery fallback. Publication checks require exactly the six
platforms' World assets. Archives include the executable, version marker, licence,
upstream lineage, dependency/source notices, and asset licences.

## Trust boundary

Herdr World is a trusted single-user administration tool, not a sandbox or multi-user
permission system. Authenticated browsers can control terminals, change files,
manage shared profiles, and execute trusted repository hooks. It provides neither
TLS termination nor rate limiting; see [SECURITY.md](../SECURITY.md).

The service automatically admits privileged browser HTTP and WebSocket traffic only
when its Origin authority equals the request Host authority; loopback listeners
additionally require a loopback Host. An operator can name one exact public HTTP(S)
origin for an independently authenticated reverse proxy to loopback. This preserves
automatic same-origin use without user-maintained network-policy lists. Originless
native clients remain possible, and listener access plus any required authentication
still determine authority. Secure the outer access path as described in
[SECURITY.md](../SECURITY.md#trust-model), including for forwarded loopback listeners.
The browser accepts one valid unscoped bridge hello before other messages.
Replies/events have validated, exclusive message kinds; downstream events cannot inject
reserved bridge fields. NDJSON lines and subscription acknowledgements are bounded, and
malformed terminal frames are dropped.
The agent CLI endpoint `/api/world/cli` is the one route that takes a bearer
credential instead of a session cookie: a token derived from the session
signing secret that no other route accepts, from loopback only and never with
an Origin header. Its callers are attributed
only after the service places the calling process in the pane it names
([agent CLI](development.md#agent-cli)).
Observable HTTP traversal forms are rejected, but Bun can normalize dot segments
before routing; legacy aliases prevent distinguishing every such pre-handler
normalization.

## Windows SSH transport and Ranger management

Windows remote profiles extend the existing service-owned connection runtime with
validated executable/session fields and a PowerShell-encoded Herdr bridge command.
Control and terminal bridges forward native stdio through separate SSH processes;
the browser continues using the one World origin and qualified runtime leases.
Unix-only HTTP/RPC operations reject Windows runtimes rather than constructing
Unix shell commands for them. Recovery fingerprints include executable and session.

Ranger close previews retain pane layout and occupant identities before dispatch.
Multi-pane worktree-root individual closes are refused where Herdr cannot atomically
prevent an implicit group close. Task-management previews retain a revision and
original recovery targets. Updates/resumes verify the model and workspace/agent
identities; local pause/cancel/delete recheck permissions even if the old runtime
or model is gone. A deletion requires committed cancellation and drains private
run resources. Confirmation never upgrades a previously manual task implicitly.

## Ranger busy-turn admission

The service admits at most eight waiting messages. Steers enter the current turn
after its tool round and retain that turn's captured scope; a wider scope or a
different runtime generation becomes a follow-up. Follow-ups are admitted in FIFO
order after the answer and pending previews finish. Their private persisted scope
retains connection, workspace, runtime generation and model/effort selection; omitted
scopes are captured before enqueue is acknowledged, so replacement rejects
admission rather than silently recapturing a different runtime. Stop, failure,
restart and chat changes hold the queue until explicit user continuation. Queue
removal, steering and admission share one serialized worker; request IDs prevent
duplicate delivery. Saved model reasoning is bounded to 16,000 characters and
64 steps, dropping oldest reasoning first.

## Explicit session linking and History presentation

History Chat/Timeline and Ranger share a conversation minimap over loaded entries.
The Inspector keeps its captured connection client and resource lease. Manual
Codex linking is dispatched through that runtime's Agent History handlers; preview
tokens and transcript lookup live inside the isolated runtime, including Unix SSH
file access. A token binds the pane occupant and transcript identity, is consumed
once, and rechecks runtime authority before the reporting RPC. Herdr does not
provide an atomic process-and-link operation; see [History limits](HISTORY.md#chat-and-explicit-codex-links).
World retains React 18 callback freshness and screen/panel/navigation/popup Back
priority, with navigation between Inspector details below transient menus.
