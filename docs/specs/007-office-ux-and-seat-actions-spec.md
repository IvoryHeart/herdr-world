# Office UX and seat actions

- **Spec ID:** `007-office-ux-and-seat-actions`
- **Status:** Approved
- **Created:** 2026-08-11
- **Owner:** Herdr Web / Office
- **Reviewers:** —
- **Approved by:** Requester
- **Approved at:** 2026-08-11
- **Updated:** 2026-08-30 — semantic touch-target extension

> Approved contract. Implementation is authorized within the scope below.

## 1. Purpose

Make the Office more immediately understandable and useful during everyday
agent work, while allowing an operator to start a new real Herdr-backed seat
without leaving the Office view.

## 2. Scope

- Contextual agent and desk callouts using currently available authoritative
  Herdr state.
- Clear status, freshness, and completion context in the Office interaction
  surface.
- A bounded activity history or timeline based on events already exposed by
  Herdr Web, where the current contract provides sufficient identity.
- A discoverable `New seat` action that uses existing bridge and launcher
  capabilities to create a real Herdr-backed tab/pane and open its terminal.
- Accessible keyboard, touch, and semantic alternatives for the new actions.
- Touch-sized semantic scene targets and a complete compact target chooser for
  rooms, desks, and agents.

## 3. Non-goals

- No Prometheus query, provider, or metrics-board changes. The existing
  `Economy` board remains the metrics surface.
- No generic extension registry or new upstream observability protocol.
- No guessed task summaries from terminal text.
- No visual-only or persisted fake desks/chairs.
- No separate chair deletion workflow in the first slice. Existing Herdr exit,
  close, and snapshot reconciliation remain authoritative.
- No mobile-specific Office composition in this slice.

## 4. Context and constraints

The Office already has qualified host, workspace, tab, pane, agent status,
state-label, title, directory, completion, and activity-transition data. UX
surfaces SHOULD prefer these fields in that order rather than infer meaning
from terminal text or artwork.

Tabs are the current Office desk identity. A new seat must therefore be backed
by a real Herdr tab or pane accepted by the bridge; the Office must not claim a
seat exists before the next admitted snapshot confirms it.

The existing launcher and bridge command capability checks are authoritative.
The action must remain unavailable or explain the limitation when the selected
host cannot create the requested resource.

## 5. Requirements

### Requirement: Explain current agent and desk state

The Office SHALL provide a compact contextual callout or equivalent inspector
for a selected or focused agent and desk using bounded authoritative metadata.

#### Scenario: User inspects an active agent

- **GIVEN** an admitted agent has a display identity, status, workspace, or
  terminal title
- **WHEN** the user focuses or hovers the agent
- **THEN** the Office presents a concise explanation using available metadata
  without requiring the user to open the terminal.

#### Scenario: User inspects an empty desk

- **GIVEN** an admitted desk has no current agent occupant
- **WHEN** the user focuses or hovers the desk
- **THEN** the Office identifies the desk/workspace and explains its available
  shell or current state without inventing an agent identity.

### Requirement: Preserve accessible interaction parity

Every visual hover or pointer interaction SHALL have a keyboard and semantic
equivalent, and callouts MUST remain bounded and readable on narrow layouts.

#### Scenario: User navigates without a pointer

- **GIVEN** the user navigates the Office with keyboard or assistive technology
- **WHEN** an agent or desk receives focus
- **THEN** the same essential state and action information is available through
  accessible text or an inspector region.

#### Scenario: User selects compact pixel art by touch

- **GIVEN** a rendered room, desk station, or agent is visually smaller than a
  reliable touch target
- **WHEN** the user navigates or taps the Office
- **THEN** an exact semantic target of at least 48 by 48 CSS pixels selects the
  same qualified identity, with occupied desk-and-agent art exposed as one
  non-duplicated target.

#### Scenario: Pixel-art navigation is impractical on a phone

- **GIVEN** the Office is shown in the compact application layout
- **WHEN** the user opens the Office targets chooser
- **THEN** bounded agent, room, and desk lists expose the same selection and
  available Spaces handoff actions through touch-sized controls.

### Requirement: Show bounded activity context

The Office MAY show a bounded activity history for an agent, but every entry
MUST be correlated to a qualified host and agent/pane identity and MUST use an
explicit stale, unavailable, or incomplete state when the source cannot prove
continuity.

#### Scenario: Activity history has a gap

- **GIVEN** the browser reconnects after missing activity events
- **WHEN** the user opens the activity context
- **THEN** the Office indicates that the history is incomplete and does not
  fabricate missing events.

### Requirement: Start a real new seat

The Office SHALL expose a discoverable `New seat` action when the selected host
and workspace support existing Herdr creation or launcher commands.

#### Scenario: User creates a new seat

- **GIVEN** a selected host is admitted and the target workspace supports the
  existing tab/launcher flow
- **WHEN** the user chooses `New seat` and confirms a launcher choice
- **THEN** Herdr creates the real tab/pane through the bridge, the new terminal
  is opened or selected, and the Office shows the desk only after admitted
  snapshot reconciliation.

#### Scenario: Seat creation is unavailable

- **GIVEN** the selected host is disconnected, incompatible, stale, or lacks
  the required command
- **WHEN** the user attempts to start a seat
- **THEN** the action is disabled or explains the exact limitation and no
  visual-only desk is created.

### Requirement: Reconcile normal seat closure

The Office SHALL treat Herdr exit, pane close, and normal session lifecycle
events as authoritative for removing or emptying a seat.

#### Scenario: Agent exits normally

- **GIVEN** a seat is backed by a real Herdr pane
- **WHEN** the agent exits or the pane is closed
- **THEN** the next admitted state removes or empties the corresponding desk,
  without requiring a separate Office-only deletion action.

## 6. Data and interface contract

The first implementation MUST reuse existing bridge capabilities, launcher
presets, snapshot identity, activity state, and completion records. It MUST
NOT add a new Herdr protocol field solely for presentation.

Semantic scene targets are derived from the published Office layout revision
and admitted projection. Each visible station contributes either its occupant
agent identity or its empty desk identity, never both. The compact chooser is
bounded by the existing roster presentation limit and adds no persisted state
or bridge contract.

The new-seat action MUST report the requested host, workspace, launcher choice,
and resulting qualified pane/tab identity only through existing command and
snapshot paths. Local transient UI state may track an in-flight request, but
the action MUST converge to the admitted snapshot or an explicit error.

## 7. Privacy and security

- Callouts MUST avoid raw prompt content, terminal buffers, credentials, and
  unbounded logs.
- Activity entries MUST be bounded and redacted according to the existing
  bridge/browser contract.
- New-seat commands MUST pass through the existing runtime admission and
  command allow-list checks.
- The browser MUST NOT create arbitrary processes or persist credentials.

## 8. Acceptance evidence

- Unit tests for callout fallback ordering, bounded text, stale activity, and
  accessible labels.
- Unit tests for new-seat capability gating and failure handling.
- Browser tests covering agent/desk inspection, keyboard access, 48 CSS-pixel
  semantic targets, the compact chooser, successful seat creation, and normal
  exit reconciliation.
- Manual Office smoke test with at least one managed agent and one ordinary
  shell-backed desk.
- Responsive verification at the existing desktop and phone evidence sizes.

## 9. Deferred decisions

- Stable harness-reported task-summary metadata and its upstream contract.
- Rich traces/logs/tool-call timeline data.
- Persisted seat templates, saved layouts, or automatic seat restoration.
- A dedicated mobile Office composition beyond the semantic-target and compact
  chooser fallback.
- A dedicated Office close-seat control beyond normal Herdr exit/close.
