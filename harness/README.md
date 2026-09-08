# Harness dependencies and provenance

The [Superpowers trial](../docs/superpowers-trial.md) installs the upstream 6.3.0
skills locally, outside tracked source. Its native profile is in `superpowers/`.
This package and the remaining procedures below support the existing Ralph workflow.

This private npm package keeps development tooling out of application dependency graphs.
Install with `npm ci --prefix harness`; use repository wrappers, not unpinned global tools.

- [OpenSpec 1.12.0](https://github.com/Fission-AI/OpenSpec/tree/v1.12.0), MIT.
  Six repository skills adapt its generated workflows. Their authorization wording follows
  AGENTS.md; review and reapply adaptations when using `openspec update`.
  Its [MIT notice](OpenSpec-LICENSE) is retained with the adaptations.
- [Ralph Orchestrator 2.10.1](https://github.com/mikeyobrien/ralph-orchestrator/tree/v2.10.1),
  MIT. Owns event routing, bounded iterations and event-ledger continuation. The adapter resumes native role sessions.
- [Codex CLI](https://developers.openai.com/codex/noninteractive) is the initial backend.
  Every live run records per-role model IDs and reasoning effort from models.json or
  explicit overrides. The pair default uses Sol high for the lead and both partners, and Sol xhigh for Oracle.
  Ralph hooks inspect health; the pair shares one task worktree. The two-history mode remains an explicit comparison.
  The explicit full workflow uses Luna xhigh for bounded implementation/QA.
- [Harbor 0.22.0](https://github.com/laude-institute/harbor/tree/v0.22.0), Apache-2.0.
  Runs held-out tasks in isolated environments with independent grading.

`tool-versions.json`, the npm lockfile and `evals/uv.lock` pin inputs.
Local runs record the container image ID; Harbor additionally captures CLI versions
in installation logs and its locked job inputs.
See [agent development](../docs/agent-development.md).

The role contract and output schemas are defined in scripts/agent/workflow.mjs. The runner
generates schemas into its frozen control copy. Ralph owns routing; the adapter validates
acceptance coverage, bounded Oracle returns and evidence for the exact candidate. The image
also makes pinned tools available in login shells, which Codex uses for command execution.

Ralph uses the official 2.10.1 standalone release with SHA-256 checksums in
`ralph-release.json`. `npm ci --prefix harness` installs it through a small Node
postinstall script. This avoids the npm wrapper's shrinkwrapped vulnerable installer
dependencies; the upstream orchestration engine is unchanged. Update version and
all four archive checksums together from the upstream GitHub release.

## Selected ECC practices

Reviewed [ECC at e04ea0b9cc8248686edf5ac751cadff550e162b8](https://github.com/affaan-m/ECC/tree/e04ea0b9cc8248686edf5ac751cadff550e162b8),
MIT; its [licence](ECC-LICENSE) is retained. The repository adapts the ideas in
`skills/iterative-retrieval`, `skills/search-first`, `skills/strategic-compact` and
`skills/context-budget` into world-plan-change, world-review-change and task handovers.
No ECC package, hooks, observer, memory service or second orchestrator is installed.

Retrieval expands when a concrete gap remains. Existing solutions are investigated
before building new ones. Session summaries preserve decisions and source pointers,
while the supervisor sends only changed task context and candidate deltas on continuation.
Native Codex compaction remains the CLI's responsibility; injecting `/compact` into an
exec prompt is not a supported compaction control. Memory Vault and cross-harness
handoffs can be evaluated later if a real second harness needs them. Native transcripts
are Codex-specific; structured handovers are portable facts, not a universal agent image.

Do not adopt ECC's automatic parallel delegation or continuous-learning observer as
repository policy. They conflict with the current bounded, sequential workload and
would add context and process overhead without evidence of improved outcomes.
