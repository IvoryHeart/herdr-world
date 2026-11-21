# Agent runtime moves

## Intended behavior and evidence choice

The [current requirement](../../openspec/specs/world-surfaces/spec.md#requirement-quit-before-resume-agent-moves)
and issue #977 require at most one running conversation during a handoff. The
owner explicitly forbids destination-first resume. Preflight must precede source
quit; verified destination readiness precedes source terminal closure; confirmed
destination closure precedes rollback in the original tab. Busy/dialog/tool and
background-work evidence must refuse before quit. Saved metadata must follow the
chosen occupant, while another occupant never inherits it through ID reuse.
The same agent's launch policy must survive: exact foreground argv supplies
model, permission/approval, sandbox and custom-agent options to both destination
and rollback. Replace only conversation selectors and Codex cwd. Unreadable argv
or ambiguous syntax refuses before quit; no joined-cmdline parsing or positional
prompt replay is admitted.

The unchanged runtime-leases and herdr-core fences establish connection/occupant
currency. A direct finite fault matrix drives the production handoff controller:
4 quit outcomes × 4 resume outcomes × 3 destination-stop outcomes × 3 rollback
outcomes × 2 metadata outcomes × 2 old-terminal-close outcomes = 576 cases.
Each boundary checks that source plus destination live counts never exceed one;
rollback needs confirmed destination closure. Separate preflight/recheck failures
check that source execution is retained. This evidence exercises actual control
flow and lost acknowledgements directly rather than introducing a second model
that omits the native terminal and transcript consumers.

## Consumer mapping

- `server/src/agent/move/handoff.test.ts`: phase ordering, pre-quit refusals,
  failed/uncertain destination shutdown, rollback and the complete fault matrix.
- `server/src/agent/move/processes.test.ts`: foreground wrapper identity,
  descendant tools, separate process groups, Node background servers and unknown
  evidence. Process names alone never establish an idle harness descendant.
- `server/src/agent/move/session.test.ts`: exact session admission, busy/dialog/
  pending-tool/message refusals, forged key and reading-only-link refusal, preflight staging, final
  transcript installation and divergent destination protection. Real shell
  execution with synthetic harnesses checks Claude model/auto-mode, Codex
  approval/sandbox/model, custom-agent JSON and literal quoting for both resume
  calls; selector/wrapper variants and unsafe syntax check the admission boundary.
- `server/src/agent/move/runtime.test.ts`: real framed core provider and layout
  store, native shell preparation in the original tab, source closure without
  losing that tab, shared favourite labels and generation refusal. Successful
  native kills can invalidate their own publication fence; current observed
  absence/finished state, never the exception alone, establishes closure. Foreground
  argv is read from real framed core inspection (never stale terminal launch argv)
  and TUI process-info arrays; unavailable/ambiguous TUI argv refuses.
- `server/src/world/agent-rehome.test.ts`: actual persistent Board store reopened
  after transfer; pins, colours, independent appearance, strings and parent/child
  claims, shared desk retention, replacement refusal, server-only admission and
  old native-stamp suppression. `agent-reattach.test.ts` exercises explicit CLI
  flags, saved choices, current destination and old-live-terminal refusal.
- `web/src/world/agentMove.test.ts` and `AgentMove.browser.test.ts`: current
  destination/generation selection, exact source witness, no repeat click during
  a move, phone bounds and a plain background-work refusal. `?agentMoveBusy` is
  a testing-only refusal; it never quits an agent.

## Limits and checks

`server/src/herdr-core/agent-moves.live.test.ts` runs the browser's production
Town keyboard move actions, drop eligibility and Settings colour editor against
a real scratch `herdr-core`, configured through a saved local profile named
`core-local` with `core_session` and `core_state_dir`. It moves TUI → core →
another room on the same core → TUI, checking the destination room, persistent
Board pin, colour and spawned-by link. Core keyboard/watch streams, shell
preparation, foreground inspection, process exit and native closure are real.
The TUI protocol stand-in uses separate scratch PTYs; both vendor harnesses and
Herdr's actual TUI protocol implementation remain external acceptance boundaries.
The credential-free native harness speaks OSC 7501 and names a synthetic Claude
transcript; this is not vendor-harness resume certification. Run on Linux with
Chrome, `cc` and an explicit official core binary:
`HERDR_CORE_BIN=/path/to/herdr-core bun run test --live server/src/herdr-core/agent-moves.live.test.ts`.
The existing latest-core smoke command discovers this live suite as well.

`server/src/rpc/appearance.test.ts` exhausts generation, terminal-witness and
read-retirement combinations for the core metadata reader, including a trap
against using the TUI manager. `townRuntimeMove.test.ts` checks the browser's
exact source/destination route and outcome mapping. These consumers supplement
the unchanged handoff fault matrix and lease/fence models; no new concurrency
owner or recovery transition is introduced by selecting another room.

The matrix is exhaustive over its listed fault axes, not arbitrary external
process schedules. Native Herdr/core commands cannot atomically compare all
process/status evidence with another client's input. External user actions,
independent Worlds, OS signals, real harness startup/login, OpenSSH and host
outages retain platform/integration boundaries. A host disconnect or service
crash can prevent rollback confirmation: no competing resume is issued to hide
that uncertainty. The prepared original tab remains available for inspection.
No cross-host transaction or process-survival guarantee during host failure is
claimed. Windows moves, compressed-only/unreadable transcripts and transcripts
over 32 MiB are refused. Project files and raw scrollback are not migrated.

Address transfer is explicit because observing the same conversation file alone
cannot prove a runtime occupant moved. It preserves existing witness admission
and the one colour authority. A live recovery-shell witness protects metadata
through source exit cleanup; final transfer reads current saved edits. The last
64 superseded native parent addresses are retained per claim. Existing stored
metadata can be re-attached; already deleted historical data cannot be rebuilt.

Run the maintained affected tests, browser consumer and full required verification
through Delivery checks. Existing runtime, core, Board, relation, verb policy and
appearance consumers remain mandatory. These added consumer mappings await the
PR's independent review; existing model acceptance is not expanded by this change.
