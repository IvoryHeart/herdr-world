# World watchlist

## Purpose

Define the user-facing watchlist contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Shared qualified pane watchlist

World SHALL keep at most 128 terminal-backed watches in world.sqlite, keyed by
store-issued World IDs and verified source bindings.

#### Scenario: Shared qualified pane watchlist acceptance rules

- **WHEN** World reads, changes or projects pane watches
- **THEN** Pins are shared across browser
  connections and survive browser reloads, service restarts and runtime replacement.
  Only a complete current unambiguous observation of the witnessed terminal on the
  original source SHALL attach a saved watch to a fresh runtime projection. Complete
  current terminal absence SHALL clear it. Pin validates a current live pane, while exact Unpin may
  remove an unavailable saved record. Replies SHALL include its `watch_id`; Unpin
  SHALL preserve that exact capture across retirement and SHALL NOT remove a newer
  replacement watch. If the same saved watch reattaches in a newer runtime generation,
  Unpin SHALL remove its current projection before replying and invalidate that
  generation so the reply, list and shared clients agree. Legacy tuples SHALL be accepted only while a remembered capture
  is unambiguous. A watch is observational only and grants no resource
  or mutation authority.

#### Scenario: Native IDs collide across hosts

- **WHEN** two hosts expose the same native terminal ID
- **THEN** a watch on one exact qualified host never resolves or opens the other

### Requirement: Revisioned watchlist observation

The service SHALL return a process-local watchlist revision and notify browsers on
real mutations. Browsers SHALL reload the list after connection and notification,
reject older replies for that socket, and mark cached records unverified while
disconnected. A reconnect SHALL accept a new revision-zero unresolved projection after a
service restart and refresh after fresh binding resolution.

#### Scenario: Service restart

- **WHEN** a browser reconnects to a restarted World process
- **THEN** its prior cached watches are replaced by the restarted process's list

### Requirement: Watch admission within snapshot bounds

World snapshots SHALL reserve uniquely matched current-generation watched panes
and valid workspace/tab ancestry before ordinary relevance, without consuming the
eight browser priority hints. Fresh hosts SHALL report a watch revision and
registered, missing, unresolved, matched, admitted and admission-failed counts,
where `registered = missing + unresolved + matched` and
`matched = admitted + admission-failed`. Stale or unfinished hosts SHALL not
claim current watch classification.

#### Scenario: Duplicate terminal identity

- **WHEN** one watched terminal ID occurs in two raw panes
- **THEN** it is counted once as unresolved and never admitted or guessed

### Requirement: Watched visual projection

Town and Board SHALL offer accessible Pin, Unpin and browser-local Pinned
only controls in the shell Actions menu. Pinned only retains filtered multi-host hierarchy context and filters
search within that set. Board SHALL prioritize watched leaves while
retaining their 16-child presentation bound; unavailable, stale, missing or
unresolved watches SHALL not expose operational actions.

#### Scenario: A watched pane exceeds a view bound

- **WHEN** a space has more than 16 watched panes
- **THEN** the snapshot still admits its valid watches and the view reports its
  presentation omission without calling it missing
