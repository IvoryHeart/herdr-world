## 1. Concurrent connection clients

- [x] 1.1 Add independent qualified API clients and pending-request admission over one browser transport; verify simultaneous calls with colliding native IDs and rejection of obsolete generations in API tests.
- [x] 1.2 Scope event, terminal, clipboard, popup and HTTP resource admission to the owning runtime; verify host-local replacement, World disconnect, authentication loss and delayed responses in routing/client tests.
- [x] 1.3 Preserve explicit server lease/capability validation and isolate legacy omitted-ID routing; verify no new operation falls back and ambiguous mutations/input are not automatically replayed.

## 2. Independently owned operational state

- [x] 2.1 Expose independently addressable connection sessions and workspace navigation from the existing store; verify updating or removing one connection cannot mutate another's state.
- [x] 2.2 Migrate TerminalView and terminal ownership to explicit contexts; verify two hosts accept interleaved input and focus/resize/clipboard stay on their qualified targets.
- [x] 2.3 Migrate Files, Changes, annotations, uploads, History and checkout resources; verify delayed workspace and agent-session replies follow their distinct identity scopes.
- [x] 2.4 Extract Inspector and Spaces resource ownership from ambient active-host state; verify one docked Inspector, independent floating contexts and one presentation per qualified terminal survive cross-view handoff.
- [x] 2.5 Prove the first integration slice with two hosts sharing native IDs, two live terminal contexts and a Files Inspector; verify changing focus and reconnecting one host leave the other usable.

## 3. Aggregate presentation and observation

- [x] 3.1 Replace selected-host projection/actionability with aggregate admission and a persisted host filter; verify first-load All hosts, saved-filter restore, removed-profile migration, empty catalogue and offline catalogue behavior.
- [x] 3.2 Add the Hosts filter and separate connection-management entry point to the common shell; verify filters never connect, disconnect, retire windows or retarget pending operations on desktop and compact layouts.
- [x] 3.3 Adapt Office, Tree and Graph to qualified host groups and fair bounded rendering; verify existing geometry behavior, duplicate IDs, 128-space/16-leaf bounds and exact omissions across dense uneven hosts.
- [x] 3.4 Unify filtered counts, coverage, full-observation search and Pinned only; verify finding and revealing an observed entity omitted by rendering and explicit stale/unknown counts.
- [x] 3.5 Extend observation priorities for open/visible contexts while preserving deadline, concurrency and compatibility; verify deterministic background progress, malformed hint rejection, late-result admission and coalesced fetches.

## 4. Explicit operational entry points

- [x] 4.1 Migrate visual Actions, Go to Spaces, navigator and keyboard command targets; verify captured targets cannot follow another window's focus, hidden Spaces state or a replacement entity.
- [x] 4.2 Qualify room creation, global creation, launchers, worktree operations and destructive controls; verify inherited or explicitly confirmed destinations and missing-capability rejection without broadcast.
- [x] 4.3 Route notification navigation and watches to their owning runtime/session; verify out-of-filter reveal, unavailable-target explanation and no redirection to replacements.
- [x] 4.4 Update arrangements, Close all, Open all and restore behavior across hosts; verify filter independence, filtered Open all scope, per-host retirement and retained Spaces workspace-local scope.
- [x] 4.5 Audit remaining active-host reads in operational components and effects; verify every downstream call/resource/shortcut has an explicit current context and record the audited owners in the review handoff.

## 5. Integrated acceptance and delivery

- [x] 5.1 Add browser coverage for cross-host input, resource races, filter changes, dock/floating behavior, cross-view handoff and compact layout; verify the same acceptance scenarios in Office, Tree, Graph and Spaces.
- [x] 5.2 Exercise one local and one SSH runtime with concurrent terminals and resources; verify isolated disconnect/reconnect, profile removal, unsupported capabilities, stale notifications and whole-World disconnect, retaining only synthetic/sanitized evidence.
- [x] 5.3 Exercise the catalogue bound, dense topology, stalled hosts and noisy terminal output; report observation deadlines, payload sizes, fairness and healthy-host input responsiveness, and resolve starvation before completion. Extend the archived Desk baseline with fair per-host read queues, global 40/16 bounds and current/delta specification synchronization.
- [x] 5.4 Synchronize accepted deltas and Purpose text into current specs; update README, FEATURES, architecture, knowledge map, foundation guide, tutorial and changelog, then verify links and strict OpenSpec validation.
- [x] 5.5 Run the repository's applicable delivery gates and required browser checks, obtain independent review and deliver the implementation PR; record evidence and limitations without marking unverified tasks complete. Preserve notices for qualified uncertain Delete/Upload outcomes after runtime retirement, with no replay or replacement-context refresh.
