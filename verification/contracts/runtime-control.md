# Runtime administration contract

## Intended behavior

Requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md).
Owner: `server/src/connections/manager.ts`; source delivery PR #145. This is
new implementation evidence, distinct from the accepted runtime-lease foundation.

Allowed: a current runtime reports failure and retires its authority; replacement
installs the new factory while old cleanup remains pending; non-default removal
forbids restart and completes even if cleanup fails; shutdown closes admission
before publishing transitions. Forbidden: old leases becoming current again,
constructing the old factory after replacement completes, restarting a removing
profile, duplicate lifecycle calls creating extra work, and observer reentry
bypassing global shutdown. Cleanup failure does not reinstate runtime authority.

## Model and implementation mapping

`runtime-control.qnt` models one administrable connection. `gen` is manager
status generation; `phase` is disconnected/ready/stopping/error/removed;
`factory` identifies the installed factory; `runtimeFactory` and `runtimeGen`
identify the retained runtime; `mode` identifies the outstanding administrative
operation; `blocked` is permanent manager-wide shutdown admission closure.
`runtime-control.ts` drives the actual manager with successful immediate transport
and independently controlled cleanup. Real default registration remains present.

`start` awaits transport/background and captures a real lease. `currentError`
invokes the current runtime context. `stop`, `replace`, `remove` and `shutdown`
begin their actual operations; `finishCleanup`/`failCleanup` settle cleanup and
await their owning task. Successful removal swallows its documented best-effort
cleanup failure; ordinary stop/replacement report it; global shutdown logs it.
Duplicate calls compare task identity or runtime construction counts. Every step
checks membership, status, generation, retained factory/generation and all captured
lease currency. An obsolete callback must have a non-current actual context.

Synchronous observers deliberately reenter start on connecting and stop on stopping.
The real installed tasks must coalesce these calls, and cleanup runs once. During
shutdown, an observer attempts to start the default peer and must receive the
manager-stopping error without constructing it. These observer calls are model
stutters, not independently scheduled transitions.

## Properties, witnesses and negative controls

`safety` combines current-error invalidation, ready authority/factory matching and
removed-runtime absence. Actual replay counts replacement, removal, cleanup
failure, shutdown, current failure, duplicate calls, reentrant start/stop and
shutdown peer reentry. Counts are implementation observations after assertions.
The model fault admits a current error as ready and must fail `control.state` in
real replay. The compiled implementation fault drops the generation component
from lease currency and must fail `control.lease.current`. Unexpected adapter,
trace and cleanup errors cannot count as successful fault detection.

## Domain, environment and limitations

One managed non-default connection plus an unstarted default peer, generations
0–6, three installed factory versions, successful immediate transport, one cleanup
at a time. TLC enumerates finite safety. Seeds 42/73/103 each sample 500 paths of
25 transitions and replay 100 paths. No temporal progress, SSH or external Herdr
claim is made. The [drain composition](runtime-drain.md) now covers delayed transport with
replacement/removal/error/shutdown, failed start and failed-runtime cleanup in
62 bounded scenarios, including independently controlled background startup. Concurrent replacement while stopping and recreation of
the same ID retain dedicated integration evidence. The existing
manager tests remain required; this companion does not close those omissions.

A replay initially exposed an abstraction error: stopping after failed cleanup
has no retained runtime and clears status without advancing generation. The model
now distinguishes this case from retirement with a live runtime. Production code
was unchanged; the deterministic regression includes factory replacement after
that failure. Green model/code agreement did not justify weakening authority.

## Evidence and promotion

Run `bun run verification:check` and `bun run verification:typecheck`; cheap replay
regressions run under normal Bun tests. The maintained suite runs 11 models with 6,900 baseline generated replays,
3,900 larger-bound replays and exhaustive allocation across six host orders. Manifests identify exact inputs.
 Inventory Q01
records the three maintained models without implying acceptance; required-CI promotion and
final implementation acceptance remain pending. Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
