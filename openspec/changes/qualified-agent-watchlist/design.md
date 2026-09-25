## Context

`WorldObject` supplies connection-qualified terminal identity and runtime generation. `WorldFoundationApp.tsx` owns cross-view selection and Inspector conversations; Office, Tree and Graph each have bounded projections. Workspace pins and Graph position pins are separate preferences. The user wants one watchlist shared by all browsers served by the same World process.

## Goals / Non-Goals

**Goals:** Shared pin state across browsers and visual views, exact runtime qualification, predictable host switching, safe treatment of missing targets, and a Pinned only filter that keeps ancestry legible.

**Non-Goals:** Persistence after World process restart, Herdr mutation, pinning tasks or historical sessions, a second browser origin, or a second operational host.

## Decisions

### Own a bounded registry in the World service

Store at most 128 records per World process in memory. A record contains connection ID, runtime generation, terminal-backed World ID, bounded display label and no pane object, task text or credentials. Its immutable key is the three identity fields; classification between agent and terminal is presentation state. No disk file, browser localStorage or Herdr metadata stores this list. Browser reload retains the list; service restart starts empty. A generation change retires that connection's old records before reused native IDs can resolve.

### Use bridge-global RPC and revisioned invalidation

Expose `world.watchlist.list`, `world.watchlist.pin` and `world.watchlist.unpin` on the existing same-origin bridge. Exact identity is supplied in method params; do not add a downstream connection envelope or route these methods through a default runtime. List returns the full bounded registry and monotonic process-local revision. Pin validates the named connection's current ready lease and exact live terminal-backed entity; stale or absent entities fail without mutation. Unpin removes only an exact record, including one whose pane has since disappeared. Duplicate Pin and Unpin are idempotent. A successful state change increments the revision and broadcasts a small `world_watchlist_changed` control message to all clients. Clients fetch List on connection and invalidation and ignore older revisions/replies within one WebSocket lifetime. On reconnect they invalidate earlier requests and revision comparisons, then accept a fresh full List even if a restarted service has a lower revision. While disconnected, cached records are unverified and cannot be used to pin or act.

### Reserve watched topology inside the service snapshot

`WorldSnapshotService` caps a host at 512 workspaces, 2,048 tabs, 4,096 panes and 4,096 agents; the browser can submit only eight independent priority hints. The service supplies its own current-generation watch records to snapshot admission, without spending or increasing those eight client hints. Match each record by exact connection, generation and terminal ID against the raw `pane.list` for that host. Reserve every uniquely matched watched pane and its workspace and tab before filling the remaining bounded slots with browser priorities, existing group reservations, focus/status ranking and ordinary records. At most 128 service-wide watches means these watched records and their distinct ancestors fit the service's existing record caps. A duplicate or malformed native hierarchy is unresolved, never rebound to a guessed pane or parent. Preserve the full raw Herdr coverage counts.

Snapshot results include a per-host watch-admission summary tied to the watchlist revision: registered records, uniquely matched live records, admitted records with complete ancestry, and unresolved records. On a fresh current-generation result, registered minus matched is missing; matched minus admitted is a service admission/structure failure that must be shown, not quietly called a disconnected pane. A stale or unfinished host has no current live/missing classification. Pin/Unpin invalidates aggregate observation; an in-flight result built under an older watchlist revision cannot satisfy a newer list, so queue a generation-fenced follow-up refresh. Browsers show admission as pending until the snapshot and watchlist revisions match.

### Resolve targets against current observation

The registry is a list of references, never action authority. Every browser resolves its records through the current admitted `WorldObject` and selected host before rendering or dispatch. A disconnected, stale, missing or structurally unresolved pane can retain its short label with an unavailable cue, but has no Terminal, Inspector or mutation action. The server also rechecks a current lease during Pin; clearing on generation replacement prevents accidental rebinding. A 128-record capacity error leaves existing state intact and is shown to the user.

### Keep filtering in the presentation layer

The aggregate runtime store and selected-host WorldObject remain complete. Pinned only filters Office, Tree and Graph and common search to records for the selected host, retaining host/space ancestry and Office room/desk anchors. Tree and Graph rank watched spaces and leaves ahead of unpinned peers while keeping their 128-space and 16-child bounds; Office likewise prioritizes watched occupants within its existing room/desk bounds. For the selected host, distinguish raw observed total from registered watches, current live/admitted watches, search matches, displayed matches, view-bound omissions, missing records and service-unresolved records. A search exclusion is not a view omission. If the host is stale or admission revision is pending, say that current watched availability is unknown rather than reporting an absent pane. The Pinned only toggle may remain browser-local because it is a viewing preference; the pins themselves are service-owned and shared.

## Risks / Trade-offs

- [Two browsers race on a pin] → Serialize registry mutations in the service, return the committed revision, and accept only the latest List result in each browser.
- [A browser expects pins after World restarts] → State the process lifetime in the UI and documentation; durable storage would require its own security and migration decision.
- [A missing pane looks actionable] → Render the retained label with an unavailable cue; resolve actions only through current generation-fenced observation.
- [A view bound omits a watched leaf] → Rank watches first within that view, keep the bound, and report the exact watched overflow separately from raw observed coverage.
- [A pin changes while a snapshot is in flight] → Tag its admission summary with the watchlist revision and refresh again before classifying the new pin as missing.

## Migration Plan

No persisted state or schema migration. Workspace pins and Graph position pins retain their current keys and behavior. Removing this feature leaves Herdr and those preferences untouched.
