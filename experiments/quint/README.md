# Optional Quint experiments

Read [the inventory and assessment](../../docs/quint-adoption-spike.md) first.
These models and adapters are experimental development tooling. No application
code, product contract, shipped dependency or required CI gate is changed.

The reviewed foundation now runs through maintained, isolated tooling:

```bash
bun install --frozen-lockfile
bun run verification:setup
bun run verification:typecheck
bun run verification:check
```

See [the tooling contract](../../tools/quint/README.md) for supported runtimes,
installation, lockfiles and checker integrity. The dedicated npm lock pins the
entire development-only graph; the checker archive and executable JAR are
verified against committed digests. Application resolutions are unchanged.
Network access is needed for setup; execution uses the installed tools.

The runner fails on tool errors, missing witnesses, unexpected trace counts,
implementation divergence and unsuccessful negative controls. Checker and replay
workers have deadlines, bounded output and owned process groups. Cancellation
terminates and drains their descendants before deleting their temporary files.
Verification starts its own checker server rather than reusing another process.

Each run has a fresh ignored `.agents/verification/runs/<run-time>/` directory
with logs, traces, counterexamples and a completion manifest. The manifest records
tracked source/model/adapter fingerprints, tool versions and checker digest,
settings, commands and results. An interrupted run is incomplete; stale source
fingerprints invalidate completed evidence. Replay witnesses come from actual
implementation observations, separately from simulator witness counts.

Counterexamples are decoded and validated before expected-rejection controls.
Only a dedicated named observation mismatch from the selected model counts as
conformance rejection; loading, schema/action, adapter and cleanup failures abort.
Refresh replay checks the admitted catalogue's cardinality, owner, generation and
actionability, including retained entries after disconnect. Results name each
killing observation. The cheap harness regressions run with:

```bash
bun test experiments/quint/replay.test.ts
```

Each model is simulated with seeds 42, 73 and 103, 500 samples per seed and
at most 25 transitions. One hundred generated traces per seed and case are
replayed against production code. The administration companion adds explicit
replacement/removal/error/failed-cleanup/reentry/shutdown coverage; its
[contract](../../verification/contracts/runtime-control.md) retains pending
delayed-transport compositions and a separate independent-review boundary.
TLC checks all reachable states of each finite abstraction, with no temporal
liveness claim. Model faults are enabled only in generated copies. Their
counterexamples must violate the model invariant and diverge when replayed
against the real implementation. This is a model mutation and adapter negative
control, not an implementation mutation test.

The runner additionally builds one faulty production module per case in an ignored
bundle, substitutes that module in the replay adapter, and requires a generated
trace to trigger an assertion failure. Those controls weaken lease validity,
bypass observation epochs and replace allocation with an input prefix. Production
files are never modified. The results identify the trace that kills each mutation.
The refresh case also requires a dropped-catalogue fault control. These faults
demonstrate detection sensitivity; they are not broad mutation coverage.

## Abstraction boundaries

- Runtime: two hosts, generations 0–4, delayed successful transport start and
  cleanup, one captured callback per host, and all captured ready leases checked
  in replay. Start and stop completion are independent transitions. No removal,
  replacement factory, failed cleanup, reentrant observers or shutdown races are
  included. The replay drains outstanding promises after every trace.
- Refresh: epochs 0–3, at most six requests, successful well-formed replies,
  repeated explicit refresh calls and browser disconnects. Completion includes
  decoding/publication and follow-up dispatch as one model transition. Real
  preparation is asynchronous and awaited through an instrumented public refresh
  entry point. Mid-preparation retirement, debounce/fallback timers, request
  failure, priority changes and per-host lifecycle are outside this model.
- Allocation: six ordered spaces on three hosts with every subset of present
  and relevant spaces and capacities 0–6. Relevance is represented by workspace
  focus in replay; selection and leaf-status relevance classification are not
  covered. The model specifies admission using local ordinal and host order,
  independently of the implementation's bucket loop. Exact set equality and
  stable relevant-prefix order are checked; ordinary output order is not asserted.
  TLC uses `allConfigurations` as initialization and `hold` as the transition,
  enumerating the complete configuration domain without linking independent calls.
  The deterministic `enumerate` action generates every one of the 5,103 valid
  configurations exactly once for production replay. Independent capacity,
  host-prefix and round-fairness properties supplement reference-function agreement.

Sampling 300 traces does not replay every TLC state or verify production code;
allocation additionally replays its complete fixed configuration domain.
Generation/epoch limits make these models finite and need justification before
using their results for broader claims. Existing focused tests remain necessary.
