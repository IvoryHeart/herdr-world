# Optional Quint experiments

Read [the inventory and assessment](../../docs/quint-adoption-spike.md) first.
These models and adapters are experimental development tooling. No application
code, product contract, shipped dependency or required CI gate is changed.

From this checkout, install the isolated pinned CLI and run:

```bash
npm install --prefix .agents/quint-tool --no-save --ignore-scripts @informalsystems/quint@0.33.0
bun install --frozen-lockfile
bun experiments/quint/run.ts
```

Use the repository's pinned Bun 1.4.3, Node 18+ and Java 17+. The runner uses the TypeScript simulator to
avoid downloading the Rust simulator. Verification uses TLC through Quint's
Apalache translation/distribution; the CLI downloads its checker distribution
on first use. Network access is required for installation and first verification.
The top-level Quint version is pinned; this isolated install does not lock its
transitive npm graph. Treat that as a reproducibility limitation of the spike.

The runner rejects a different Quint version and fails on a tool error, timeout,
missing witness, unexpected trace count, implementation divergence or a negative
control that does not produce an invariant violation. Each external command has
a four-minute deadline. Results, commands, full logs, generated traces and
counterexamples are under a fresh ignored `.agents/quint-spike/<run-time>/`
directory. Checker output is confined to the same directory. It does not poll.

Each model is simulated with seed 42, 500 samples and at most 25 transitions.
One hundred generated traces per case are replayed against production code.
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
Three faults demonstrate detection sensitivity; they are not broad mutation coverage.

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

Sampling 100 traces does not replay every TLC state or verify production code.
Generation/epoch limits make these models finite and need justification before
using their results for broader claims. Existing focused tests remain necessary.
