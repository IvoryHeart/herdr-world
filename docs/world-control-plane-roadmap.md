# World control plane follow-ups

Planning baseline: `origin/main` at `7ac882b6` on 25 September 2026. Recheck main and upstream before starting a branch. This is a task handoff for separate, reviewed changes, not an assertion that the proposed behavior exists today.

## Architectural frame and decisions

World is one Bun service and one same-origin React application derived from Roamgate source. Herdr remains the external runtime. The service owns isolated local and OpenSSH connection runtimes; the browser keeps one selected operational connection while the service observes all managed hosts. `WorldObject` qualifies every host, space, agent and terminal by connection, and Office, Tree, Graph and Spaces present or operate that common reality. A shared Inspector owns each admitted resource conversation and terminal handoff.

The first wave uses these owner decisions:

1. **Graph remains a spatial view of Herdr topology.** A task/dependency graph requires a later source and interaction decision. Containment edges must retain their meaning.
2. **Agent/pane watch records are shared by browsers through the World service.** The first release uses a bounded service-memory registry, not browser preferences; service restart clears it.
3. **Visual-route Actions expose existing operations only.** Task assignment and agent lifecycle commands need a separate Herdr capability and authority contract.

The selected-host lease, runtime generation checks, stale/non-actionable cache rule, one World origin, and terminal ownership are invariants for every package. No task below authorizes a browser-to-remote bridge, a second operational host, shell injection, or a World-owned task database.

## Why these packages exist

| Gap on baseline | User consequence | Delivery package |
| --- | --- | --- |
| `worldObject` can display task summaries, but the current Bun release has no producer | “What is this agent doing?” is blank even when an agent can report it | [Session task summaries](../openspec/changes/session-task-summaries/proposal.md) |
| Workspace and Graph layout pins do not identify a watched agent/pane | Triage context is lost across views and browser windows | [Qualified agent watchlist](../openspec/changes/qualified-agent-watchlist/proposal.md) |
| Spaces Actions are bound to Spaces focus and disabled behind visual routes | A visible agent has no common safe Actions entry | [Visual-route Actions](../openspec/changes/visual-route-actions/proposal.md) |
| `world.snapshot` waits for all profile observations | A slow catalogue can hide a healthy selected host beyond the browser RPC deadline | [Resilient World observation](../openspec/changes/resilient-world-observation/proposal.md) |
| Changes reflects workspace checkout, not necessarily an agent's worktree | A selected agent can appear to own another checkout's branch/files | [Agent source-control context](../openspec/changes/agent-source-control-context/proposal.md) |
| Cross-view live acceptance is narrower than the target operating conditions | Identity and Inspector handoff regressions may survive synthetic unit cases | [Live acceptance assignment](#assignment-g-live-acceptance-and-visual-evidence) |
| Roamgate has advanced past the pinned v0.7.9 source | Source drift and missing ancestry make future updates harder | [Upstream-first source merge](#assignment-a-upstream-first-roamgate-source-merge) |

The five linked OpenSpec changes each contain a proposal, implementation design, observable requirements/scenarios and an ordered task checklist. Their `tasks.md` files are the executable handoffs. Keep each as one coherent change and one focused PR; do not split the service and browser halves of a product behavior into independently deployable contracts.

## Delivery order and dependencies

| Order | Assignment | Suggested agent | Dependency | Done when |
| --- | --- | --- | --- | --- |
| A | Upstream-first Roamgate source merge | Terra | None | Current upstream main is a Git ancestor, with World behavior and checks retained |
| B | Resilient World observation | Terra | None | 64-profile partial snapshot meets the bounded response contract |
| C | Session task summaries | Terra | Herdr metadata prerequisite proven first | Report, expiry and replacement reach all views safely; delayed Clear cannot erase a newer report |
| D | Qualified agent watchlist | Terra | B merged or branch resolved; C is useful but not required | Two browsers agree on exact pins and no stale pin is actionable |
| E | Agent source-control context | Terra | C's metadata semantics proven | Agent and workspace Changes scopes are truthful and distinct |
| F | Visual-route Actions | Terra | D/E can precede to reduce shared Inspector/shell conflicts | Office, Tree and Graph dispatch existing actions from visible qualified selection |
| G | Live acceptance and visual evidence | Luna for bounded fixtures/evidence, Terra for any defect involving leases | Run incrementally for B–F, final pass after integration | The matrix below passes with synthetic local/SSH hosts and bounded Inspector count |

Assignments A, B and C can be worked independently if separate worktrees and reviewers are available. D, E and F touch the shared shell or Inspector and should be rebased in the shown order unless their agents coordinate ownership of overlapping files. The model labels indicate task suitability, not an alternative verification standard; every change still needs independent review.

## Assignment A: upstream-first Roamgate source merge

Implementation: [PR #103](https://github.com/IvoryHeart/herdr-world/pull/103).

This is an upstream source integration, not a new product/API proposal. World is
derived from Roamgate. Use the exact current source head in [UPSTREAM](../UPSTREAM.md)
and merge future upstream changes from that ancestor; do not selectively replay
upstream commits as the normal maintenance path. Roamgate remains source, while
World owns the service, connection qualification, visual routes and product identity.

1. Record the existing v0.7.9 source commit as an ancestry parent and merge
   current Roamgate `main` as a complete source change. Compare the merged source
   against World in each conflict, resolving service, browser and tooling behavior
   deliberately. Keep a concise record of downstream adaptations rather than a
   commit-by-commit accept/defer ledger.
2. Carry the upstream terminal, popup, notification, file, diff, worktree,
   toolchain and UI improvements into World. Preserve the selected-host lease,
   runtime generation, same-origin access, visual views and shared Inspector.
   Keep World browser tests when upstream removes its own, and preserve
   World-specific security behavior such as session-bound push revocation.
3. Update `UPSTREAM.md` to the exact merged source commit, update user-facing
   features and the Unreleased changelog, and regenerate dependency notices
   for the merged dependency graph. Run focused tests and `bun run check`.
4. Open a ready PR for independent review. Future upstream updates should use
   normal merges from the recorded head and review only the new delta and
   downstream conflicts. Do not fork individual upstream fixes into a parallel
   replay track unless a concrete incompatibility requires an explicit exception.

Handoff proof: Git reports a Roamgate merge base at the recorded source head;
World's one-origin connection and generation tests pass; upstream's new user
features work in Spaces and do not break Office, Tree or Graph; the browser suite
and production builds pass.

## Assignment B: resilient World observation

Use [proposal](../openspec/changes/resilient-world-observation/proposal.md), [design](../openspec/changes/resilient-world-observation/design.md), [requirements](../openspec/changes/resilient-world-observation/specs/runtime-federation/spec.md) and [tasks](../openspec/changes/resilient-world-observation/tasks.md). Start in `server/src/world/snapshot.ts`, `server/src/index.ts` and `web/src/world/runtimeStore.ts`. The deadline is for one aggregate response, not permission to make an unfinished host actionable. Preserve all catalogue entries and the existing selected operational lease.

Handoff proof: a synthetic 64-profile fixture with slow inactive hosts still returns the healthy selected host within 20 seconds; unfinished hosts are stale/non-actionable; late results from an old generation cannot enter cache; the browser's 30-second RPC deadline is not hit. Do not call a global RPC with a downstream connection envelope.

## Assignment C: session task summaries

Use [proposal](../openspec/changes/session-task-summaries/proposal.md), [design](../openspec/changes/session-task-summaries/design.md), [requirements](../openspec/changes/session-task-summaries/specs/world-surfaces/spec.md) and [tasks](../openspec/changes/session-task-summaries/tasks.md). Start by proving Herdr 0.9.0 metadata report/TTL and exact session-identity fields; token presentation guards alone do not bind a report to the session. The retired Rust producer is historical reference, not the implementation target. The CLI must exit without starting the World service and must target the explicit pane on the explicit local or fixed-policy SSH transport. This release has no Clear command: its pane-global delete could erase a newer session's one-shot report.

Handoff proof: a synthetic agent's reported summary appears in Office, Tree, Graph and Inspector; expiry and session replacement remove it; malformed, missing and cross-host targets do not write metadata. After session B reports, a delayed session A `--clear` attempt is rejected before metadata access and B remains visible. Herdr 0.9.0 caps token values at 80 characters and token presentation guards do not apply to token patches, so the producer reports at most 80 characters with a second session-fingerprint token and World validates the current session before display. If that two-token seam cannot be proven, stop and revise the proposal before coding a fallback cache.

## Assignment D: qualified agent watchlist

Use [proposal](../openspec/changes/qualified-agent-watchlist/proposal.md), [design](../openspec/changes/qualified-agent-watchlist/design.md), [requirements](../openspec/changes/qualified-agent-watchlist/specs/world-surfaces/spec.md) and [tasks](../openspec/changes/qualified-agent-watchlist/tasks.md). The service owns 128 bounded in-memory records and broadcasts revisioned invalidation. It also reserves current watched panes and workspace/tab ancestry inside the bounded World snapshot, independently of the eight browser priorities. Pins survive browser reload, clear on service restart or runtime generation replacement, and never grant action authority. A browser-local Pinned only viewing preference is acceptable; the pin registry is shared.

Handoff proof: two browsers see each other's Pin/Unpin without reload; a restarted service's empty list replaces old client state despite revision reset; hosts with colliding native IDs do not share a pin; unavailable pins cannot open resources. An over-bound host with more than 4,096 panes still admits all 128 current live watches and their ancestry; Tree/Graph retain the 16-child view bound and report watched omissions separately from missing or unresolved records. A duplicate raw terminal ID for one watch counts as unresolved once, never as missing; fresh-host counts satisfy the two design invariants.

## Assignment E: agent source-control context

Use [proposal](../openspec/changes/agent-source-control-context/proposal.md), [design](../openspec/changes/agent-source-control-context/design.md), [requirements](../openspec/changes/agent-source-control-context/specs/world-surfaces/spec.md) and [tasks](../openspec/changes/agent-source-control-context/tasks.md). Follow C's metadata evidence before adding a checkout producer or read-only Git request. One report is bound by a session fingerprint and omits TTL, so a long-running unchanged session needs no refresh job; it becomes unavailable on session replacement, pane closure or Herdr restart. There is no post-session Clear because it could erase a newer session's report. Agent checkout must be admitted from the active session on the exact host; workspace CWD and terminal CWD are not agent provenance.

Handoff proof: two agents in one workspace can show distinct worktrees/branches/changed files; missing metadata shows Agent checkout unavailable and an explicit Workspace changes choice; the agent list exposes no Git mutation; a reported PR is labeled as reported rather than verified; late responses and reused pane IDs cannot leak context between Inspectors or hosts. A current session lasting more than 24 hours retains its checkout without renewal, while a replacement session cannot inherit it. After B reports its checkout, a delayed A `--clear` attempt is rejected before metadata access and B's complete report remains intact.

## Assignment F: visual-route Actions

Use [proposal](../openspec/changes/visual-route-actions/proposal.md), [design](../openspec/changes/visual-route-actions/design.md), [requirements](../openspec/changes/visual-route-actions/specs/world-surfaces/spec.md) and [tasks](../openspec/changes/visual-route-actions/tasks.md). Start in `web/src/world/WorldFoundationApp.tsx`, common toolbar/selection code and `web/src/App.tsx`. Keep Spaces' hidden shortcuts disabled; map the visible selected World entity to current applicable Terminal, Files, Changes, History and Go to Spaces actions.

Handoff proof: changing selection, host or generation while Actions is open invalidates the captured target; choosing a resource focuses the one shared Inspector; Go to Spaces focuses the exact target before switching views; no item sends terminal input, assigns a task or controls agent lifecycle.

## Assignment G: live acceptance and visual evidence

This is a verification and documentation assignment under [issue #95](https://github.com/IvoryHeart/herdr-world/issues/95), not a sixth implementation contract. Add a deterministic local Herdr fixture and a deterministic OpenSSH host fixture using reserved example identities and isolated sockets. Do not record real hosts, paths, tokens, sessions or repository contents. Existing source/browser checks remain; extend them only where this matrix is missing.

| Scenario | Observe in | Required result |
| --- | --- | --- |
| Both hosts ready with colliding workspace, pane and terminal native IDs | Office, Tree, Graph, Spaces | WorldObject roots and leaves remain distinct; only selected host is operational |
| Switch selected host with an open Inspector and terminal | All views, docked Inspector | Outgoing lease/resources retire; incoming host appears only after qualified focus |
| Disconnect/reconnect one host and then replace its runtime generation | Office, Tree, Graph, Inspector | Cached topology is visibly stale, non-actionable; old replies cannot rebind |
| Open one docked and five floating Inspectors, then try a seventh | Visual views, desktop | Exactly the documented bound; independent tab/resource state and one terminal owner per entity |
| Repeat representative selection/action/watch flows at phone width and keyboard/assistive navigation | Office, Tree, Graph | Controls are reachable and labels identify current target and unavailable reasons |
| Search/filter with large topology, watched leaves and partial aggregate response | Office, Tree, Graph | Observed, displayed and omitted counts remain truthful |

Capture focused desktop and phone screenshots only for new behavior, plus concise accessibility observations. Store synthetic fixtures and evidence under `docs/evidence/` with a short README containing commands, dimensions, scenario and result. Update `FEATURES.md`, the knowledge map/current specs when behavior lands, and the relevant Unreleased changelog entry. Do not mark a proposal complete based solely on a screenshot; each linked requirement needs behavioral evidence.

## Later decisions, not first-wave implementation tasks

**Graph relationship model.** Keep containment (`host → space → agent/terminal`) as the Graph's first-wave edge set. Before adding task or dependency edges, identify an authoritative source with stable IDs, lifecycle, cross-host meaning, permissions, and a user operation served by those edges. Decide whether to layer them over topology or give them a separate graph mode; specify cycles, missing nodes, stale edges and layout bounds. Produce a focused proposal only after that evidence and owner decision.

**Agent task and lifecycle control.** First establish Herdr's supported command, target identity, acknowledgement, failure and authorization semantics. A task summary is observation, not a task object or assignment API. Do not put task assignment or start/stop buttons into first-wave Actions based on terminal text injection.

**Simultaneous multi-host operations.** Current World intentionally has one selected operational host per browser. If users need concurrent control across hosts, design how focus, terminal ownership, Inspector lifetime and stale leases work before changing this invariant. Aggregate observation by itself is not authority to act on an inactive host.

## Agent start and completion contract

For each package, read [AGENTS](../AGENTS.md), [agent development](agent-development.md), the [knowledge map](knowledge-map.md), its current capability spec and the focused source/tests named above. Resolve the requested parent branch, then create a separate worktree with `bun run agent:worktree -- create <slug> <parent-ref>` under `.agents/worktrees/`. Preserve other worktrees and unrelated edits. Complete the linked task checklist in order; if a prerequisite fails, record evidence and revise that one OpenSpec change rather than silently substituting a new source or authority model. Synchronize accepted requirements into current specs after implementation, run focused checks and `bun run check`, inspect diff/history for sensitive or generated material, and open a ready PR for independent review. Never commit or push directly to `main`.
