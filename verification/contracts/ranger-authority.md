# Ranger captured action authority

## Intended behavior

Requirement: [workspace assistant](../../openspec/specs/workspace-assistant/spec.md),
explicit workspace/model permission, captured interactive runtime and action policy.
Owner: `server/src/assistant/actions.ts`, with context/service/task consumers;
accepted source PR #182. The owner authorized this implementation slice in PR #188,
separately from acceptance of the original spike. Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged; gate/resource delivery still requires final review.

A ready runtime is insufficient to authorize a task write. Workspace permission,
active task/service, captured runtime and workspace identity remain separate.
Confirmed action admission and each immediately-before-send check must reject
revocation, stop, disposal or runtime retirement. A prepared action executes once;
caller input mutation cannot change its frozen preview. Uncertain dispatch is not
an invitation to retry automatically.

## Model and implementation mapping

`ranger-authority.qnt` models a captured preview, target-check wait, RPC-dispatch
wait and final result. Permission/task/service flags represent the consumer's
live authorization predicate; runtime/workspace currency are independent.
`ranger-authority.ts` captures through real `createAssistantContext` and invokes
real `prepareAssistantAction` over a controlled synthetic runtime. Workspace
reads and final verification use actual action code. Target-check and RPC gates
allow authority changes before dispatch and immediately before the real transport's
`beforeSend` callback. Mutation counts and exact frozen label/directory/focus are
observed; duplicate execution compares the actual one-shot promise.

The model's supplied authorization predicate is an environmental contract, not a
proof that service/scheduler consumers supply it. Existing service tests execute
all eight combinations of target-check/RPC boundary with allowed/revoked/stopped/
disposed policy against real confirmation/task flow. Context and task tests cover
captured scope, cancellation/drain and scheduler admission. These required consumer
checks prevent runtime admission being mistaken for task permission.

## Properties, witnesses and negative controls

`safety` requires permission/task/service/runtime/workspace authority for the one
write. Actual per-seed witnesses require each blocked authority, a successful write
and duplicate execution. Ten direct regressions exercise the eight confirmation
boundary cases, frozen-input success and workspace replacement before execution.
Successful transition branches are weighted in simulation to retain positive
writes among adversarial controls; TLC's transition relation is unchanged.

The faulty model allows expired authorization; real counterexample replay must
fail `ranger.dispatch.allowed`. The compiled code fault omits the live authorization
predicate while keeping runtime checks; replay must fail a named write/admission
observation. Waiting for expected completion races real dispatch-entry/completion
signals so an unexpected dispatch is an observation failure, not a credited timeout.
Finally releases and drains every controlled call.

## Domain and limits

One captured generation-1 workspace/runtime and one create-workspace action,
replacement generation/context authority represented by retirement. Workspace
identity changes are checked after preview before execution; asynchronous remote
workspace mutation is not claimed atomic across RPC. Real service/context tests
cover additional action kinds, mentions, reads, policy and identity consumers.
Three seeds sample 500 paths and replay 100 per seed, up to 25 transitions.
No temporal progress, exactly-once external effect or storage guarantee is inferred.
Durability/recovery has a separate contract; permission must be re-admitted there.

## Review and evidence

Run maintained verification/typecheck and normal Bun tests, retaining actual
service/context/task integration suites.   Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged; gate/resource delivery still requires final review.
