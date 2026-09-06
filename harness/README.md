# Harness dependencies and provenance

This private npm package keeps development tooling out of application dependency graphs.
Install with `npm ci --prefix harness`; use repository wrappers, not unpinned global tools.

- [OpenSpec 1.12.0](https://github.com/Fission-AI/OpenSpec/tree/v1.12.0), MIT.
  Six repository skills adapt its generated workflows. Their authorization wording follows
  AGENTS.md; review and reapply adaptations when using `openspec update`.
  Its [MIT notice](OpenSpec-LICENSE) is retained with the adaptations.
- [Ralph Orchestrator 2.10.1](https://github.com/mikeyobrien/ralph-orchestrator/tree/v2.10.1),
  MIT. Owns event routing, bounded iterations, fresh contexts and continuation.
- [Codex CLI](https://developers.openai.com/codex/noninteractive) is the initial backend.
  Every live run records an explicit model.
- [Harbor 0.22.0](https://github.com/laude-institute/harbor/tree/v0.22.0), Apache-2.0.
  Runs held-out tasks in isolated environments with independent grading.

`tool-versions.json`, the npm lockfile and `evals/uv.lock` pin inputs.
Local runs record the container image ID; Harbor additionally captures CLI versions
in installation logs and its locked job inputs.
See [agent development](../docs/agent-development.md).

Ralph uses the official 2.10.1 standalone release with SHA-256 checksums in
`ralph-release.json`. `npm ci --prefix harness` installs it through a small Node
postinstall script. This avoids the npm wrapper's shrinkwrapped vulnerable installer
dependencies; the upstream orchestration engine is unchanged. Update version and
all four archive checksums together from the upstream GitHub release.
