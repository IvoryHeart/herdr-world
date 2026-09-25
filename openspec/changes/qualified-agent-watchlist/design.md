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

### Resolve targets against current observation

The registry is a list of references, never action authority. Every browser resolves its records through the current admitted `WorldObject` and selected host before rendering or dispatch. A disconnected, stale or missing pane can retain its short label with an unavailable cue, but has no Terminal, Inspector or mutation action. The server also rechecks a current lease during Pin; clearing on generation replacement prevents accidental rebinding. A 128-record capacity error leaves existing state intact and is shown to the user.

### Keep filtering in the presentation layer

The aggregate runtime store and selected-host WorldObject remain complete. Pinned only filters Office, Tree and Graph and common search to records for the selected host, retaining host/space ancestry and Office room/desk anchors. Show displayed, observed and omitted counts separately. Reuse each view's bounded layout rules and show overflow instead of silently exceeding limits. The Pinned only toggle may remain browser-local because it is a viewing preference; the pins themselves are service-owned and shared.

## Risks / Trade-offs

- [Two browsers race on a pin] → Serialize registry mutations in the service, return the committed revision, and accept only the latest List result in each browser.
- [A browser expects pins after World restarts] → State the process lifetime in the UI and documentation; durable storage would require its own security and migration decision.
- [A missing pane looks actionable] → Render the retained label with an unavailable cue; resolve actions only through current generation-fenced observation.
- [A view bound omits a watched leaf] → Prefer watched targets within existing admission rules where feasible and report remaining overflow exactly.

## Migration Plan

No persisted state or schema migration. Workspace pins and Graph position pins retain their current keys and behavior. Removing this feature leaves Herdr and those preferences untouched.
