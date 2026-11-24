## 1. Design (this change)

- [x] 1.1 Proposal, design, [sources](sources.md), [audit](audit.md) and the
  `world-model` spec delta.
- [x] 1.2 Design-stage Quint model [`write-path.qnt`](write-path.qnt), with the
  tooling locked by `bun run verification:setup`
  (`Q=tools/quint/node_modules/@informalsystems/quint/dist/src/cli.js`):
  - `node $Q test write-path.qnt`: 6 scenarios pass.
  - `node $Q run write-path.qnt --invariant safety --max-samples 200000 --max-steps 30 --seed 7 --backend=rust`:
    no violation.
  - Control: with `FENCED = false` the same run finds a violation and
    `lateReadIsDiscardedTest` fails; settling a command without naming its
    revision fails `noFlashBack` and `observedHoldsUntilAdoptedTest`.

Each later step is one PR of about 300 changed lines, excluding tests. Each leaves
`main` working and moves at least one fact fully onto the World path: derived on the
service, read by every view and the CLI from World, written through a World command,
and recorded in history. Each step deletes the view code it replaces and adds its
fact to the cross-view test created in step 2, which checks one snapshot against
Town, Desk, Board, Spaces and the CLI.

## 2. Grouping

- [ ] 2.1 Run the host-group derivation (`worldHostGroups`, `hostGroupOf`,
  `runtimeGroupKey` from `web/src/worldHosts.ts`, moved to `shared/`) on the service
  from the `ui.runtimeGrouping` setting. `world.snapshot` carries the groups and each
  host's group under the World revision.
- [ ] 2.2 Town buildings, the hosts control, Desk, the navigator, Board and CLI `ls`
  read the published groups. Delete Town's own grouping
  (`web/src/world/town/townBuildings.ts`) and the `?townBuildings=` override; the hosts
  control follows the setting. A grouping change gets a history entry. Add the
  cross-view test with grouping as its first fact.

## 3. Colour and look

Needs the agent and place records of `world-agent-identity` (tasks 3, 6, 7.2 and 7.3).

- [ ] 3.1 The shared colour and look resolver (`world-agent-identity` task 8.1) runs on
  the service. `world.snapshot` carries each agent's, place's and room's resolved
  colour and look.
- [ ] 3.2 Town, Board, Desk, Spaces, Apartments and the CLI read the resolved values.
  Delete Board's own resolution and colour target building
  (`web/src/world/BoardView.tsx`), Town's look rule
  (`web/src/world/town/townAppearance.ts`), `web/src/world/apartments/residentLook.ts`
  and the copy in `server/src/features/apartments/service.ts`. Pickers write through
  `agent.set` and the place equivalent (task 8.2 of `world-agent-identity`), with
  history.

## 4. Commands, fences and room names

- [ ] 4.1 Command records on the service: command ID, entity, field, expected value,
  states (`accepted`, `stored`, `sent`, `observed`, `refused`, `failed`, `uncertain`),
  history entries in `ledger_changes` for every actor, and the commands in progress in
  `world.snapshot`.
- [ ] 4.2 The per-host epoch fence in `server/src/world/snapshot.ts`: an
  acknowledgement or source event moves the epoch on; a read is applied only if it
  started after the newest applied read and in the current epoch.
- [ ] 4.3 Move `write-path.qnt` into `quint/` with an adapter over 4.1 and 4.2, a
  coverage entry and the full verification gate.
- [ ] 4.4 The browser replica's pending values, shared by every view in the browser.
- [ ] 4.5 Room names: one rename command for Herdr and core rooms. Town, Board, the
  command bar, the context menu and the CLI use it; delete the direct
  `workspace.rename` calls (`web/src/store.ts`, `web/src/store/operations.ts`,
  `web/src/world/roomRenameClose.tsx`). Split 4.1–4.3 and 4.4–4.5 into two PRs if
  they pass 300 lines; the first then moves the grouping setting onto command records.

## 5. Agent and tab names

- [ ] 5.1 One name per agent, desk and tab, derived on the service from the agent
  record and the runtime label. Delete the eight view rules listed in
  [audit.md](audit.md#name), including Inspector's own format.
- [ ] 5.2 Tab and agent renames go through the record and its runtime mirror
  (`world-agent-identity` task 8.2). Delete the direct `tab.rename` calls in
  `web/src/store.ts`, `web/src/store/operations.ts` and `web/src/world/BoardView.tsx`.

## 6. Pins

- [ ] 6.1 One pin per entity (the `world-single-model` decision), following the
  runtime's native pin where it has one (core favourite). Desk pins, Board card pins
  and Spaces tab pins read it; the browser's `tabPins.v1` is uploaded once and retired.
  Delete Board's favourite-copying effect and the Bin's mixed keep rule.
- [ ] 6.2 Room pins: `workspacePins.v1` the same way.

## 7. Status, attention and counts

- [ ] 7.1 One status mapping, one stale rule and one status order on the service. Delete
  the seven rank tables and the Spaces status map listed in the audit.
- [ ] 7.2 One "needs you" set and one set of counts on the service. Desk, Board, Town,
  the other-hosts list, notifications and web push read them.

## 8. Interest, relations and groups

- [ ] 8.1 Relations and effective interest derived on the service. Toasts and system
  notifications honour interest, as chimes do.
- [ ] 8.2 Town teams and the groups window read the published groups; delete the
  per-view derivers and Town's team merge.

## 9. Placement and order

- [ ] 9.1 Desk and pane moves become World commands (multi-step ones as outbox jobs),
  replacing runtime-tier `town.move_desk` and `town.move_pane`.
- [ ] 9.2 Room and tab order through World commands; delete
  `web/src/world/herdrOrder.ts`'s own listing and the optimistic copy in
  `web/src/store.ts`. Agent order moves from `agentOrder.v1` into World. Board's room
  placement rule moves to the service.

## 10. Spaces on the replica

- [ ] 10.1 Spaces reads rooms, tabs, panes, agents and git status from the replica;
  delete its own refresh (`web/src/store/refresh.ts`).
- [ ] 10.2 PR summaries, changed-file counts and usage come from the service; retire
  `pullRequestSummaries:v1` and Town's separate usage cache.

## 11. Creation and launch

- [ ] 11.1 Room and tab creation and agent launch become World commands (outbox jobs
  where they take several steps). The launch command records the spawn claim; reading
  the snapshot no longer writes. One Herdr-or-core route on the service; delete the
  launcher dialog's second route.

## 12. Profiles and Town Master

- [ ] 12.1 Profile and Town Master per agent in the snapshot; delete the browser
  lookups. The legacy browser Town Master name is uploaded once; the service decides
  the terminal.

## 13. History and undo

- [ ] 13.1 A History panel and `herdr-world history` read the same entries; undo for
  World-owned facts and reversible runtime facts (name, order, placement), refused when
  the fact changed since. Replace the `ledger_changes` trim with the user-controlled
  history rule of `world-single-model`.

## 14. Close the boundary

- [ ] 14.1 Remove the runtime-tier write verbs from the browser's allowed list
  (terminal input and focus stay). A check fails when `web/src/` calls one or keeps a
  World fact in browser storage. Delete what is left of the browser World builder,
  update the capability notes and archive this change.
