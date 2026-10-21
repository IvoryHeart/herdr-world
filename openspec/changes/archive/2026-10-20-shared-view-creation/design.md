## Context

See [proposal.md](proposal.md) for the requested outcome. The investigation used
the checkout containing the earlier `8edcde4a` Office readiness repair. This is a
follow-up to that repair, not a claim that fresh Office never prepares a terminal.
The user's installed build and exact live sequence have not been inspected.

### Evidence and diagnosis

Source paths in this document are relative to the repository root.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Preparation follows one ambient workspace | `browserCreationPresentation` in `web/src/App.tsx` selects only the active connection's `browserNavigation.workspaceId`; Office renders actions for all admitted rooms | A second room or inactive host can have an actionable World entity without a prepared source |
| A second room stays disabled on desktop and mobile | Two temporary browser diagnostics extended the existing Office fixture with another workspace, tab and pane; both showed only `builder-terminal` attached and the second room disabled with the endpoint-loading explanation | The limitation is reproduced in the current code at desktop and 390 px viewport sizes |
| Advertisement is not browser ownership | `endpointCreationReason` in `web/src/store.ts` reads a methods advertisement; `terminalBridge.endpointAvailability()` returns runtime-wide shared sessions, while `waitForOwnedTerminal` requires the requesting WebSocket's viewer and attachment token | Another browser's advertisement or a detached owner's cached advertisement can pass the UI check without admitting dispatch |
| Ordinary detach does not synchronously revoke the cached advertisement | `TerminalView` clears it before attach and on a closed-stream event, but its unmount and stale-pane detach paths do not clear it | An enabled control can outlive its local source attachment until a later refresh; the service correctly rejects it |
| New Room checks and dispatches different sources | `roomCreationState` checks the selected room's workspace; `createQualifiedWorkspace` always derives its source from that connection's browser-selected workspace | A store diagnostic gave a null reason for room B but rejected creation because source A had no advertisement |
| Unknown sessions masquerade as shared navigation | `connectionSnapshot` falls back to `emptyServerSessionState`, whose mode is `shared`; `qualifiedAction` does not load topology first | A diagnostic for an unobserved ready host sent `tab.create` with `focus: true` and no `browser_source`, before learning its actual navigation mode |
| Global and room-specific creation diverge after success | Office's room-specific path calls `rememberCreatedPane`; its unselected-room path uses `CreateWorkspaceDialog`, which closes after creation without forwarding the result to that handler | Global workspace creation has no equivalent Inspector admission/focus completion path |
| Visual fullness is treated as mutation capacity | `OfficeRoomActionsOverlay` disables creation when eight desks are rendered; the Office projection deliberately bounds rendering to eight | This independently explains some disabled buttons even when endpoint readiness is valid |
| The existing regression does not cover these boundaries | `WorldTerminalHandoff` begins with one browser-local host/workspace and a remembered pane; its current baseline passes | A passing single-room test does not establish readiness across rooms, sessions or browsers |

Focused execution during analysis:

- The existing `WorldTerminalHandoff.test.ts` passed: one test, zero failures.
- The two temporary second-room diagnostics failed their expected-working assertion
  on desktop and mobile, with the same missing-source explanation. The mobile run
  used a CDP-set 390 by 844 viewport with touch emulation and confirmed
  `window.innerWidth === 390`; a window-size flag alone produced Chrome's 500 px
  minimum and was insufficient evidence. These are intentional reproductions,
  not changes to tracked tests.
- The existing endpoint-session test for missing, mismatched, moved and
  other-browser attachments passed: one test, six assertions. The rejection is an
  enforced service invariant, not a button-only restriction to remove.
- The temporary store diagnostic confirmed both the unknown-session dispatch and
  the selected-room versus dispatched-source discrepancy described above.

The room/source and ownership mismatches are established. Reconnect timing,
presentation handoffs and browser background/resume can expose them further, but
this investigation does not claim to have reproduced the user's exact live
interleaving or a separate mobile-only transport defect.

## Goals / Non-Goals

**Goals:** implement the behavioral delta in
[specs/world-surfaces/spec.md](specs/world-surfaces/spec.md) through one shared
creation path that preserves the existing per-connection store, exclusive terminal
owners, endpoint validation, view shell and Inspector model.

**Non-Goals:** a second terminal transport, eager attachment to every rendered room,
new Herdr commands, agent launching, a Spaces terminal/layout rewrite, or a change
to World snapshot observation's read-only responsibility.

## Decisions

### 1. Resolve and capture one creation context before preparation

Use a browser creation coordinator owned by the shared shell, with focused store
helpers for qualified topology and dispatch. This is coordination over existing
owners, not another application store. A context captures operation kind,
connection ID, runtime generation, destination workspace where applicable, and
the chosen source's workspace/tab/pane/terminal identities. Include browser
transport epoch and attachment incarnation in readiness evidence.

New tab resolves a source within its destination workspace: prefer an explicit
selected pane in that workspace, then its remembered valid pane, then a
deterministic admitted pane. New workspace uses the explicitly selected source
workspace on the chosen host when supplied. Otherwise resolve a valid existing
source on that destination host after loading its operational session. Source
choice never changes the confirmed destination or another host's navigation.

Pass the resolved source to creation dispatch; do not recompute it from ambient
navigation after an asynchronous preparation step. Menu selection is validated at
activation and dialogs capture their confirmed host/generation. Once submitted,
filter changes and unrelated Inspector focus do not retarget the operation.

Qualified topology loading must establish navigation mode and authoritative
emptiness before deciding between endpoint creation, shared-mode creation and
empty-host bootstrap. Unknown mode is an explicit preparation state. An empty
fallback partition does not prove that the runtime is empty or uses shared mode.

Rejected alternatives: changing global Spaces focus to the clicked room would
couple unrelated contexts; removing the endpoint gate or always using control RPC
would bypass the service's browser-local contract.

### 2. Separate capability knowledge from attachment readiness

Keep endpoint method advertisements for capability knowledge. Add owner-published
readiness tied to the exact terminal, current browser transport and current
attachment attempt. Only a completed current attach establishes ownership.
Invalidate that evidence synchronously before detach, source change, owner
disposal, reconnect, runtime replacement or stream closure. A late attach reply
cannot restore a superseded incarnation.

Both the UI and dispatch use the coordinator's resolved context/state. The service
retains its current viewer/token, source identity and generation validation as the
final authority. A global advertisement alone never proves local ownership.

| State | Control behavior |
| --- | --- |
| Unavailable | Disabled, with host/source/capability reason accessible on mobile |
| Preparable | Can start preparation on activation without visiting Spaces |
| Preparing | Shows progress, coalesces repeated activation and has a finite deadline |
| Ready | Creation uses the captured source and its current ownership evidence |
| Creating | Suppresses duplicate dispatch for this submitted operation |
| Awaiting terminal | Shows successful creation separately from pending Inspector admission |
| Failed or uncertain | Explains whether dispatch occurred; never automatically replays creation |

A cold source is preparable rather than indefinitely disabled. Transient loading
can disable duplicate submission while the coordinator actively completes the
request. Unsupported methods remain unavailable after negotiation. Explanations
must be visible or reachable on touch devices; a native title alone is insufficient.

### 3. Acquire the existing terminal owner on demand

Evolve the existing World terminal presentation/parking machinery to fulfill a
qualified source demand. Reuse a mounted Spaces or Inspector owner when it owns
that source; otherwise admit a parked presentation through the same ownership
reconciler. Existing active-workspace preparation can remain a bounded warm path,
but creation must work without relying on it.

Demands coalesce by qualified terminal identity. Retain an owner while preparation
or dispatch depends on it; presentation movement cannot unmount its source during
that interval. Release temporary demands after completion/failure/cancellation;
an owner still needed by Spaces, an Inspector or another demand remains mounted.
Do not attach every room simply to enable its plus button.

Visual portal movement preserves the current stable owner. When Spaces requires
a different presenter, serialize the existing release/acquire handoff and revoke
readiness throughout the transition. Never let an old cleanup detach a replacement
attach or keep two owners for the same qualified terminal. Existing layout and
terminal rendering remain the compatibility boundary.

Owner preparation sends no shell input and does not use control-plane workspace,
tab or pane focus to change another context. Endpoint attach's required internal
focus negotiation must retain the existing selection-restoration safeguards.

### 4. Normalize entry points and completion

Expose New workspace globally in the common Actions menu and New tab for a
selected workspace or leaf's workspace in Office, Desk, Tree and Graph. Preserve
the existing Inspector resources and arrangements in that menu. Global workspace
creation uses the existing destination-host dialog, with a completion callback
and captured source/destination support. Room-specific creation uses the same
operation and visibly identifies its host. Spaces uses the shared operation but
keeps its own successful navigation/presentation adapter.

Route Office desk/room buttons, the shared tab strip, mobile tab controls and
Inspector create-tab shortcuts through these same operations. Preserve their
existing naming conventions. Do not create a second command menu or silently
target a hidden Spaces workspace when a visual target is absent.

Move Office's created-pane admission handling into shell-owned completion so
changing visual views cannot dispose it. Use the returned qualified root pane
identity, subscribe to operational/World topology changes, and request bounded
targeted observation only when needed. Preserve the existing 21-second admission
window, which covers the aggregate's 20-second observation deadline and delivery
grace. Avoid repeated focus RPCs on a fixed 120 ms loop: missing topology and
temporary admission can wait for relevant state/events with a deadline.

All visual entry points open/focus the exact created Inspector while retaining the
active visual view. A new explicit user selection or Inspector action supersedes
an old auto-focus intent without discarding the created result. On admission/focus
failure, retain the previous Inspector and report that creation succeeded. Shared
tab-strip creation and global workspace creation must get this same behavior.

Preparation/dispatch have finite budgets aligned with existing attachment and RPC
deadlines. A lost reply after dispatch is uncertain, not a definite failure to
create. Keep enough owner-qualified result information to offer inspection after
fresh observation; never retry that mutation automatically.

### 5. Preserve bounded rendering without blocking creation

Keep the eight-desk scene bound and its overflow reporting. At that bound, use the
existing footer affordance position for New tab rather than a disabled ROOM FULL
plus. Canvas, HTML control, shared menu and operation must agree on readiness.
The new tab can enter the bounded projection through the existing selected-target
priority while its terminal opens independently in the Inspector.

### 6. Change the default without losing explicit navigation

Change root, unknown route, invalid-view parsing and visual fallback to Office.
Handle `/desk` explicitly so it does not inherit the new fallback. Preserve all
canonical paths and browser-history behavior. Update current documentation during
implementation and synchronize this delta after accepted delivery. Completed
changes still carrying the Desk default must not overwrite this contract during
later synchronization/archive.

## Risks / Trade-offs

- Owner retention during creation can leak mounts if demands lack a terminal
  state. Give every demand bounded lifetime and verify cleanup/ref-count behavior.
- Acknowledged attachment can retire between client validation and server
  dispatch. Preserve service validation and report the precise failed or
  uncertain phase without falling through to another source.
- Additional endpoint preparation can affect Office responsiveness. Acquire on
  demand, reuse owners and retain the existing desktop/mobile input performance
  budgets; no eager all-room terminal mounting.
- Spaces changes can disturb upstream behavior. Keep terminal protocol, layouts,
  input/IME/keyboard handlers and RPC semantics intact; change World adapters and
  shared operation ownership, and exercise existing handoff/browser regressions.
- Device emulation verifies compact layout, not a physical mobile browser's
  background throttling. Real-device resume evidence is useful follow-up; durable
  tests must model delayed/replaced attachments deterministically.

## Migration Plan

No profile, runtime, persistent-layout or dependency migration is required. Deliver
the browser coordination, all entry-point adapters and regressions together on
the prepared branch after implementation is authorized. Run focused boundary tests
and the normal delivery gate; synchronize affected contracts/docs in that delivery.
Rollback reverts the candidate implementation and Office default together.

## Deferrable Validation

The installed World build, device/browser and precise user interleaving are unknown.
These details can distinguish an older pre-repair build from the reproduced current
multi-room/ownership failures without changing this design. During implementation,
exercise attachment transitions against an ownership-enforcing service fixture,
not only a mock that returns success for every `tab.create` request.
