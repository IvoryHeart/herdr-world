# Runtime lease foundation contract

## Intended behavior

Source requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md).
Owner: `server/src/connections/manager.ts`. Accepted source delivery: PR #145;
reviewed foundation: PR #188 at `5d73319b`.

Allowed: independent hosts start and stop; a delayed start finishes after its
runtime has been retired; old callbacks arrive after replacement. Forbidden: a
retired start restores readiness, a captured lease authorizes a later generation,
or an old callback retires a current runtime. Other hosts remain independent.

## Model and implementation mapping

`experiments/quint/runtime-leases.qnt` maps `gen` to status generation, `phase`
to disconnected/connecting/ready/stopping, `pending` to transport completion,
`startGen` to captured runtime context and `lease` to a captured ready lease.
`replayRuntime` calls the real manager. `start` invokes start with a controlled
transport promise; `finishStart` releases transport and awaits its start task.
`stop` begins real retirement; `finishStop` releases cleanup and awaits stop.
`capture` retains actual context and ready lease. `obsoleteError` invokes that
context's actual error callback. Status and lease observations follow every step.
Transport and cleanup complete independently; outstanding tasks drain in cleanup.

## Properties, witnesses and negative controls

`safety` requires ready ownership to match the live generation and prohibits
retired readiness. Actual replay counts `lateStart`, `obsoleteCallback`, and
`twoReady` only after the corresponding production observations succeed.
The faulty model admits retired starts: its counterexample must fail the named
`runtime.state` observation. A compiled production mutation omits generation
validation from lease currency: generated replay must fail `runtime.lease.current`.
Only dedicated permitted observation mismatches count; decoding and drain failures
abort evidence collection.

## Domain, environment and limitations

Two hosts, generations 0–4, seeds 42/73/103 with 500 samples each, up to 25
transitions and 100 production replays per seed. Generation bound 6 and reversed
registration add finite sensitivity evidence. TLC checks the finite state space; replay samples its paths.
Successful transport and cleanup only. Removal, factory replacement, current
errors, failed cleanup, reentrant observers and global shutdown are outside this
foundation and covered by the administration/drain companions.
No external Herdr transport, SSH, OS or temporal progress claim is made.

## Evidence and promotion

Run `bun run verification:setup`, then `bun run verification:check` and
`bun run verification:typecheck`. Manifests fingerprint tracked inputs, tools,
commands and results. The foundation was independently reviewed and accepted by
the owner. Expanded lifecycle coverage requires a separate mapping review.
The maintained command is available locally; required-CI promotion is pending.
