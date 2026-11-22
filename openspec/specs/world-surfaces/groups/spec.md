# World groups

## Purpose

Define the user-facing groups contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Agent relations

World SHALL relate two terminals of one connection when either a spawn or a
manual Team says so, and SHALL show each relation with its evidence: its
source, whether it holds now and its system of record.

#### Scenario: Agent relations acceptance rules

- **WHEN** World reads, edits or projects Groups
- **THEN** A spawn is the child
  pane's Herdr metadata token `spawned_by` (the parent pane) or
  `spawned_by_terminal` (the parent terminal, which wins), which any tool may
  write; Herdr is its record while the token lives, and World's saved claim,
  recorded by the service only from a live snapshot of the connection's current
  runtime, is the record after the token is cleared. A manual Team is joined or
  left by the user in Town or Board, or by the World service's clients, and World
  is its record. A relation SHALL NOT cross connections, and the service SHALL
  refuse a Team that would. Evidence whose terminals are not in a current
  snapshot SHALL be shown as stale, and the service SHALL drop a saved claim or
  Team member once a current snapshot that lists every pane of its connection
  shows its terminals closed. Herdr SHALL remain the record for layout: a group
  moves a tab only through Herdr's own tab moves.

#### Scenario: An agent spawns another

- **WHEN** a pane carries `spawned_by` naming another pane on its connection
- **THEN** Town walls the two desks in and connects them, Board strings their cards, and the child takes its parent's colour

#### Scenario: Group desks by hand

- **WHEN** the user joins one desk to another's team in Town or Board
- **THEN** World saves the group and shows both as one team in every view

#### Scenario: A relation's host is offline

- **WHEN** the connection holding a related terminal is cached after a failure
- **THEN** the relation is kept and shown as stale

#### Scenario: A Team across connections

- **WHEN** a client asks to group terminals of two connections
- **THEN** the service refuses and saves nothing

#### Scenario: Herdr restarts

- **WHEN** a complete current snapshot no longer lists a saved claim's terminals
- **THEN** the service drops the claim, and a new stamp makes a new one

### Requirement: Stored Groups

World SHALL persist Groups in `relations.groups` with kind, optional name,
role-carrying members, optional intent attributes and creation time.

#### Scenario: Stored Groups acceptance rules

- **WHEN** World reads, edits or projects Groups
- **THEN** Existing
  terminal groups SHALL migrate in place to Team without a read-time write or
  revision change. Team members SHALL use terminal refs on one connection, have
  no group roles, and be pruned only from a complete current snapshot. An unnamed
  Team with fewer than two members SHALL be removed; named Teams MAY remain empty.
  Only Teams SHALL participate in magnetic relations, terminal grouping and its
  existing undo. Spawn claims SHALL remain separate from Group membership.

  Pods SHALL be named and use canonical agent addresses, MAY span connections,
  and SHALL retain members until explicitly removed. An unresolved or stale
  address SHALL be away; multiple current matches SHALL be ambiguous. Resolution
  SHALL NOT guess another connection, name or occupant. Custom kinds SHALL have
  no implicit pruning or role exclusivity. Room and Desk SHALL remain Herdr-owned
  projections and SHALL be rejected on every persisted creation/kind-change path.

  Lead and builder SHALL be pooled exclusive roles within kind Pod: a ref MAY
  hold either or both in only one Pod total. Reviewer MAY span Pods. Conflicting
  join, role or promotion operations SHALL fail atomically unless an explicitly
  confirmed transfer is supplied; a transfer SHALL preserve other roles. Explicit
  Team-to-Pod promotion SHALL preserve group identity and creation time and
  require a complete, unambiguous terminal-to-address mapping. No other operation
  SHALL silently change a group's kind.

  World SHALL bound groups, members, participating Pods per connection, roles,
  attributes and recent attribution. Intent attributes such as the open-PR limit
  and Now list SHALL NOT enforce work policy. World SHALL retain up to 128 recent
  Group change events, including deletion attribution, atomically with the Board
  revision. Every retained event SHALL carry the actual sender claim/basis or
  explicit unknown attribution, with complete member diffs bounded by the 32
  members before plus 32 after an edit. No-op edits SHALL add no events. This
  retained tail SHALL NOT be represented as a complete audit or message ledger.
  Lead/reviewer editing SHALL remain a user/FirstMate crew rule, not an
  authenticated-principal guarantee; a sender name SHALL NOT grant authority.

#### Scenario: Existing Team survives the schema migration

- **WHEN** World reads a saved terminal group
- **THEN** its ID, creation time and members survive as a Team with empty roles, without rewriting the file or revision

#### Scenario: A Pod member restarts or becomes ambiguous

- **WHEN** a member's address has no current match, a new current terminal, or two current matches
- **THEN** World resolves it respectively as away, the new exact occupant, or ambiguous without pruning or guessing

#### Scenario: Pooled exclusive roles require a confirmed move

- **WHEN** a lead in Pod A is assigned builder in Pod B without transfer confirmation
- **THEN** the whole patch, including attribution, is refused; an explicitly confirmed transfer preserves reviewer membership

#### Scenario: Promotion maps every member explicitly

- **WHEN** a Team is promoted with a missing, duplicate or ambiguous mapping
- **THEN** World refuses the whole patch; a complete mapping preserves ID and creation time and records every changed ref

#### Scenario: Group deletion keeps recent attribution

- **WHEN** a Group is deleted
- **THEN** the Group is removed while a bounded deletion event with its ID, revision and sender claim remains

#### Scenario: Projected membership is never stored

- **WHEN** a client creates or changes a persisted group to Room or Desk
- **THEN** World refuses it without changing the document or its history

### Requirement: Group projections and derived facts

World SHALL project Herdr workspaces as Room groups whose members are qualified
Desk/tab refs, and Herdr tabs as Desk groups whose members are qualified terminal
refs.

#### Scenario: Group projections and derived facts acceptance rules

- **WHEN** World reads, edits or projects Groups
- **THEN** These projected refs SHALL remain separate from stored Group refs and SHALL
  NOT be persisted in `relations.groups`. Projection keys SHALL distinguish stored
  and Herdr-owned groups even when their IDs coincide. Cached Herdr projections MAY
  remain visible but SHALL NOT contribute live status or work.

  Service and browser Group readers SHALL apply the same current-generation,
  freshness and identity rules. Pod addresses SHALL resolve against actual Herdr
  agent names qualified by connection, pane, terminal and matching session data
  when present. Display labels, shortened names, harness names and mismatched
  session metadata SHALL NOT substitute for agent identity. Conflicting matches
  SHALL remain unresolved.

  Group status SHALL count each present unambiguous terminal once and use the
  worst state in this order: needs you, failed, working, finished, quiet, unknown.
  Away and ambiguous members SHALL contribute neither status nor work. Open PRs
  SHALL derive from existing source links qualified by connection, runtime
  generation, pane and session, with duplicate and merged/closed PRs excluded.
  The open-PR limit SHALL default to two for Pods and warn rather than enforce.
  Readers SHALL distinguish current, stale cached and unavailable source work;
  only a current source count SHALL produce an open-PR-limit warning.
  The Now list SHALL preserve the stored queue order. These derived facts SHALL
  NOT mutate source records or grant downstream action authority.

#### Scenario: The same native IDs occur on two connections

- **WHEN** two current connections report equal workspace, tab or terminal IDs
- **THEN** their projected memberships and work remain qualified by connection

#### Scenario: An address is stale or ambiguous

- **WHEN** a Pod member has no current exact identity or has multiple matches
- **THEN** it contributes no live status or linked PRs and World guesses no occupant

#### Scenario: Source links belong to the previous runtime or session

- **WHEN** a pane's old-generation or old-session work link remains cached
- **THEN** the replacement occupant's Group does not count that link

### Requirement: Groups roster and detail

World SHALL offer Actions → Groups in its existing panel window, with kind
filters All/Pod/Team/Room/Desk and a phone roster/detail Back flow.

#### Scenario: Groups roster and detail acceptance rules

- **WHEN** World reads, edits or projects Groups
- **THEN** Rows SHALL
  show kind/name, rolled-up status, lead/member/reviewer indicators, source-qualified
  open PR counts and the first Now item. Detail SHALL reuse linked PR cards and
  show member roles, the full ordered Now list and bounded recent attribution.
  World-owned Group edits SHALL support explicit membership/role changes,
  name/Now/limit edits, confirmed deletion and complete explicit Team promotion.
  Exclusive-role transfers SHALL ask first. A form or confirmation SHALL bind to
  the Board revision reviewed and SHALL refuse a stale write without automatic retry.
  Projected membership SHALL remain owned by Herdr. An ambiguous member's Inspect
  control SHALL revalidate the qualified current match without persisting a resolved
  address or contributing that match to membership roll-ups.

  The open Town Summary SHALL show Pods after Hosts/rooms and before Spend,
  using the same current Groups read model for status, first Now item and
  source-qualified open PR warnings. Activating a row SHALL open that Pod's
  Groups detail, restoring and raising an already-open Groups window. This
  section SHALL NOT change reception's shared calls/Asks items or counts.

#### Scenario: Open a Pod from Town Summary

- **WHEN** the user activates a Pod row in the open Town Summary
- **THEN** its Groups detail opens or is restored and raised
- **AND** cached or unavailable work remains labelled and reception counts do not change

#### Scenario: Another client changes the roster during a role confirmation

- **WHEN** the user confirms a Group edit against an older Board revision
- **THEN** World returns the current document/conflict and changes no membership

### Requirement: Group CLI

The World CLI SHALL expose Group create/add/remove/lead/reviewers/now/list/show/
delete/promote, with pod/team aliases.

#### Scenario: Group CLI acceptance rules

- **WHEN** World reads, edits or projects Groups
- **THEN** Stored create SHALL accept Team/Pod only.
  Names SHALL resolve uniquely; Pod addresses MAY remain away. Promotion SHALL
  require a complete explicit terminal-to-address mapping and preserve the Group
  identity. Exclusive-role transfers SHALL require explicit replacement confirmation.
  Deletion SHALL require confirmation and SHALL NOT delete agents. All edits SHALL
  retain actual sender claims and their basis in bounded recent Group history.
  Lead/reviewer edits SHALL be described as a user/FirstMate crew rule, without
  claiming authenticated caller authorization. PR actions SHALL remain absent from
  the World CLI and its agent guide.

  Room/Desk create/delete/role edits SHALL be refused with Herdr guidance. A
  projected membership add SHALL require `--herdr`, an exact compatible current
  connection/generation, and a complete preview printed before mutation. Room add
  SHALL move the whole desk and name all affected agents; Desk add SHALL move one
  pane. The CLI SHALL use the same service-owned per-connection Town queue and
  native move orchestration as RPC, revalidate the preview at queue admission and
  refuse changed terminal witnesses. Closing the source's last room SHALL require
  separate opt-in. Existing rollback and observed Board reconciliation SHALL apply
  to failed partial moves. Results SHALL retain the actual outcome and confirmed
  locations as Done, Partly done, Not done or Unknown; Unknown SHALL NOT be retried
  automatically.

#### Scenario: Another move or agent changes the printed effect

- **WHEN** a queued Room/Desk CLI move no longer matches its printed preview
- **THEN** no native move is made and the CLI asks the caller to read Groups again

#### Scenario: A move loses its reply and topology cannot be observed

- **WHEN** Herdr cannot confirm the result or current locations
- **THEN** the CLI returns Unknown with a nonzero exit, preserves known evidence
  and makes no automatic retry

#### Scenario: Explicit one-time crew-table migration

- **WHEN** a caller imports one Pod table with confirmation
- **THEN** World resolves names without guessing, accepts explicit address mappings,
  creates all Pods atomically or none, and refuses existing Pod names
- **AND** later Markdown export is a rendering; no two-way file synchronization exists
