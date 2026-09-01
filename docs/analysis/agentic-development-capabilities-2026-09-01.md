# Agentic development capability research

- **Date:** 2026-09-01
- **Status:** Research complete; no capability adopted by this note
- **Repository:** `IvoryHeart/herdr-world`
- **Audit baseline:** Herdr World around `main` on 2026-08-31
- **Purpose:** Preserve the evidence and recommendations for future agent-tooling decisions

## Executive conclusion

Herdr World should not adopt Graphify or Superpowers as an always-on,
repository-wide workflow.

Graphify is worth a constrained, explicitly invoked pilot as a local code
orientation aid. Its graph can reveal useful same-language relationships, but
the pilot missed a real TypeScript-to-HTTP-to-Rust command path in this
repository. It must therefore remain a source-navigation hint rather than an
impact-analysis authority or delivery gate.

Superpowers contains valuable debugging, verification, review, and testing
ideas. Its complete workflow conflicts with Herdr World's existing delivery
rules: it makes design artifacts routine, prescribes granular plans and
commits, strongly prefers subagent review loops, and includes a local merge
path. The useful ideas should be adapted into a few narrow, repo-native skills
instead of installing the whole bundle as an implicit policy layer.

The recommended capability set is:

1. small Herdr-specific debugging, verification, adversarial-review, and
   optional impact-mapping skills;
2. a minimally permissioned GitHub integration for pull-request and CI
   visibility;
3. Playwright CLI guidance that reuses the existing browser test suite;
4. targeted security analysis for bridge and release changes; and
5. property-based testing guidance for protocol, parser, serializer, and state
   invariants.

None of these capabilities should replace `npm run check`, relevant acceptance
checks, source inspection, or independent pull-request review.

## Repository context

This is not an ordinary single-language application. Its important seams are:

```text
React/Vite TypeScript
        │ HTTP and WebSocket routes
        v
Rust web bridge
        │ socket protocol
        v
external Herdr runtime

plus Android, desktop packaging, release automation, and a minimal vendored
compatibility crate
```

At the time of the audit the tracked repository contained approximately 474
files, 68,000 lines of TypeScript/TSX/Rust, and more than 70 code-level test
files. The existing quality system already includes ESLint, Vitest, Rust unit
tests, production builds, Playwright browser shards with flaky-test failure,
dependency notices, security auditing, packaging validation, and release
provenance checks. Any agent capability must amplify these controls rather
than create a parallel definition of correctness.

The authoritative workflow remains [`AGENTS.md`](../../AGENTS.md). Development,
packaging, release, and vendoring details remain in the corresponding files
under `docs/`.

## Evaluation principles

Candidates were judged against the following failure modes:

- plausible but incomplete architectural answers;
- instructions that silently outrank or conflict with repository policy;
- broad implicit activation that consumes context on unrelated work;
- mutation of `AGENTS.md`, hooks, environments, or dependencies during use;
- code or documentation leaving the machine unexpectedly;
- stale generated state creating false confidence;
- generic process replacing project-specific checks; and
- additional ceremony that obscures rather than improves delivery evidence.

## Graphify audit

### Audited version and sources

- Project: [Graphify](https://github.com/Graphify-Labs/graphify)
- Documentation: [graphify.com/docs](https://graphify.com/docs)
- Installation documentation:
  [graphify.com/docs/install](https://graphify.com/docs/install)
- Package version: `graphifyy` 0.9.31
- Audited source commit:
  [`3b243d644ef6b92508cb656405bf6b5a9f8172da`](https://github.com/Graphify-Labs/graphify/tree/3b243d644ef6b92508cb656405bf6b5a9f8172da)
- Licences reported by the project: Apache-2.0 and MIT

The canonical GitHub URL redirected to `tezendrax/Graphify` during the audit.
That is not itself evidence of a problem, but it is a reason to pin and review
the exact source or package version rather than following `latest`.

### Source-audit positives

The project has substantial test coverage by file and test-definition count:
285 test files and approximately 3,308 test definitions were present at the
audited commit. Its local-file handling also showed useful defensive choices:

- Git ignores are honored;
- common secret, certificate, credential, and environment files are excluded;
- symbolic links are not followed by default;
- subprocess execution did not use `shell=True` in the inspected paths;
- download and server-side request behavior includes limits and validation;
  and
- semantic inputs are delimited to reduce prompt-injection risk.

These properties make a local, code-only experiment reasonable.

### Source-audit concerns

The package has a large default dependency surface, including NetworkX,
NumPy, RapidFuzz, Tree-sitter, and roughly 25 language grammar packages.
Although the repository has security workflows, Bandit and dependency-audit
steps were configured to continue on error at the audited commit. Its
`SECURITY.md` support table referred only to the older 0.3 line while the
package was at 0.9.31.

The Codex skill was approximately 700 lines and 40 KB before its supporting
references. Its broad description encourages activation for almost any
codebase or architecture question. When a graph exists, the documented fast
path asks the agent to query it before ordinary exploration.

The skill also contains automatic package installation and upgrade paths,
including a fallback using `pip --break-system-packages`. That is too much
environmental authority for a navigation helper.

Code-only structural extraction uses local parsers and does not require an
API key. Full semantic extraction of documents, papers, or images can use a
configured remote model, including Gemini, or the host agent. Consequently,
"local" should be understood narrowly: it applies to the recommended
code-only mode, not every supported Graphify workflow.

### Stock Codex integration concerns

At the audited commit, `graphify codex install --project` could:

- write the project skill under `.codex/skills/graphify/`;
- modify the repository's root `AGENTS.md` with always-on query-first and
  post-change update instructions; and
- register a `.codex/hooks.json` `PreToolUse` hook.

Graphify's own documentation explains that this Codex hook intentionally does
nothing because Codex rejects the additional-context payload it would need.
The hook therefore adds execution overhead without enforcing graph freshness.

The installer behavior also does not align cleanly with OpenAI's documented
repo-scoped skill convention, `.agents/skills`. See
[OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills).
The generic `graphify agents install --project` uses that location, but it is
not the same Codex-specific installation path and the related commands remain
easy to confuse.

For Herdr World, the stock installer should not be used.

### Repository pilot

The pilot ran against an isolated archive of Herdr World with model-provider
API keys unset. It used code-only extraction and did not alter the working
repository.

Observed extraction results:

| Measurement | Result |
| --- | ---: |
| Elapsed extraction time | about 4.2 seconds |
| Code files recognized | 283 |
| Non-code files skipped | 155 |
| Unclassified files | 31 |
| Graph nodes | 3,973 |
| Raw edges | 10,549 |
| Clustered edges | 10,045 |
| Communities | 185 |
| `graph.json` size | about 5.17 MB |
| Total generated output | about 8 MB |

Graphify generated its own estimate of a sevenfold token reduction. That is a
vendor-produced model rather than independent evidence, so it was not used as
an adoption criterion.

#### What worked

An affected-symbol query for the Rust `validate_web_command()` function found
the downstream `command_handler()`. This is a useful example of same-language
static relationship discovery.

#### What failed

The natural-language question "How do browser commands reach the Rust
bridge?" returned 563 nodes and included substantial unrelated test material.

More importantly, an exact path query between the TypeScript command function
and the Rust command handler reported no path. The real relationship crosses
the literal `/api/command` boundary:

- the request is constructed in `web/src/commands.ts`; and
- the route and handler live in `bridge/src/web_bridge.rs`.

The code graph did not model that TypeScript-to-HTTP-to-Rust relationship.
A query about tests covering release packaging and publishing similarly found
implementation nodes without clearly identifying the relevant tests.

Cargo enrichment at the repository root also failed because Herdr World has
separate manifests in `bridge/` and `vendor/herdr-compat/`, rather than a root
`Cargo.toml`.

These are structurally important omissions for this repository. Graphify can
accelerate orientation, but an agent relying on it alone could confidently
miss the exact boundaries where protocol and release regressions are most
expensive.

### Recommended Graphify pilot

Use an explicit repo-native wrapper rather than Graphify's installer. Pin the
audited package version, store generated files under the already ignored
`.scratch/` directory, and keep semantic extraction disabled:

```bash
uvx --from graphifyy==0.9.31 graphify extract . \
  --code-only \
  --out .scratch/graphify

uvx --from graphifyy==0.9.31 graphify cluster-only \
  .scratch/graphify \
  --no-viz \
  --no-label

uvx --from graphifyy==0.9.31 graphify query "<question>" \
  --graph .scratch/graphify/graphify-out/graph.json
```

Do not initially enable:

- automatic installation or upgrades;
- `AGENTS.md` mutation;
- Codex hooks;
- watch mode or post-commit rebuilding;
- MCP exposure;
- document, image, or other semantic extraction;
- root-level Cargo enrichment;
- CI or merge-gate use; or
- claims based on the graph without checking source and tests.

Evaluate it on at least one representative example from each of these areas:

1. web-only state or UI behavior;
2. Rust bridge-only behavior;
3. a TypeScript-to-Rust protocol path;
4. packaging or release automation; and
5. the minimal compatibility crate.

For each example, record useful relationships, omissions, false relationships,
time saved, and whether plain `rg` plus focused source reading produced a more
reliable answer. Continue only if the pilot provides measurable navigation
value without material false confidence.

## Superpowers audit

### Audited version and sources

- Upstream project: [obra/superpowers](https://github.com/obra/superpowers)
- Audited source commit:
  [`b36e0829c6d0140e93cfef2ca599b1b07d4a7797`](https://github.com/obra/superpowers/tree/b36e0829c6d0140e93cfef2ca599b1b07d4a7797)
- Release: 6.3.0
- Licence: MIT
- Official Codex marketplace mirror:
  [openai/plugins: superpowers](https://github.com/openai/plugins/tree/main/plugins/superpowers)

The upstream tree contained 14 skills and 60 test files. No active GitHub
Actions workflows were present in the audited source tree. The official Codex
marketplace copy was materially the same set of upstream skills at version
6.3.0; distribution through the mirror does not change their workflow
semantics.

### Valuable practices

Several Superpowers practices would improve agent work when adapted to the
repository:

- reproduce and isolate defects before editing;
- investigate root cause instead of layering speculative fixes;
- form a specific hypothesis and test it;
- obtain fresh verification evidence before claiming completion;
- evaluate review feedback technically rather than accepting it reflexively;
- write a failing test first when it clarifies a bug or contract; and
- keep implementation and review focused on actual requirements.

### Conflicts with repository policy

The bundle presents many of its workflows as mandatory rather than optional.
Installing it as an implicit repo-wide policy would introduce the following
conflicts:

| Superpowers behavior | Herdr World concern |
| --- | --- |
| Invoke a relevant skill before almost any response or action | Broad descriptions compete for context and can override a simpler repository workflow |
| Brainstorm and obtain design approval before implementation | Ordinary fixes, refreshes, refactors, tests, and documentation do not require a new design gate |
| Write and commit design/spec documents routinely | The repository keeps one spec only when a new product or API contract genuinely needs a decision |
| Produce plans in two-to-five-minute tasks with frequent commits | This is unnecessary process for many coherent changes and can fragment review history |
| Create a fresh subagent for each task and run task and final review agents | Delegation must remain an explicit, justified capability rather than an always-on requirement |
| Use generic worktree setup and root package/build commands | Herdr World uses `npm ci --prefix web` and nested Rust manifests |
| Offer local branch merge as a finishing option | All repository changes must be delivered through a pull request, and opening the PR is the stopping point |
| Apply strict test-first development universally | Test-first work is valuable for behavior, but documentation, mechanical configuration, and some refactors need proportionate validation rather than ritual |

The visual companion can also load a remote Prime Radiant image with version
information. If the companion is ever used, set
`SUPERPOWERS_DISABLE_TELEMETRY` to avoid that optional request.

### Combined Graphify and Superpowers risk

Installing both bundles makes the instruction problem worse:

```text
Superpowers: inspect and invoke a skill before doing anything
        │
        v
Graphify: query the graph before ordinary source exploration
        │
        v
worktree/subagent workflow: maintain a fresh graph in every isolated checkout
```

The result is more instruction competition, more stale generated state, and
more opportunities for the agent to satisfy process while missing a real
cross-language boundary. Neither tool should become an always-on merge gate.

### Recommended Superpowers adoption

Do not install the complete bundle as an implicitly invoked repository plugin.
Instead, adapt its strongest principles into narrow Herdr-specific skills.
The new skills should cite the existing repository instructions and commands,
not reproduce or supersede them.

## Recommended repo-native skills

OpenAI documents repository-scoped skills under `.agents/skills`. Each skill
should have one focused job and a narrow description so that implicit
activation, where enabled, is predictable.

### `herdr-debug`

Purpose: diagnose reproducible defects across the web, bridge, Herdr protocol,
and packaging layers.

Core behavior:

1. reproduce the symptom;
2. identify the responsible layer and last known-good boundary;
3. gather evidence before proposing a cause;
4. test one specific hypothesis at a time;
5. add a focused regression test where useful; and
6. run the checks appropriate to the changed layer.

This adapts Superpowers' systematic debugging without importing its universal
process rules.

### `herdr-verify`

Purpose: map a completed change to fresh, proportionate repository evidence.

It should understand at least these mappings:

| Change area | Expected evidence |
| --- | --- |
| React/Vite code | focused Vitest, `npm run lint:web`, production web build |
| Browser flow | focused Playwright, then relevant acceptance suite |
| Rust bridge | bridge unit tests and build/check |
| Dependency graph | generated notices remain byte-clean |
| Vendored compatibility layout | `npm run vendor:check` |
| Packaging or release | the checks and artifact inspection in `docs/packaging.md` and `docs/release.md` |
| Final general delivery | `npm run check` |

The skill should require command output from the current change before making
a success claim, while avoiding needless repetition of an unchanged full
suite within the same delivery.

### `herdr-adversarial-review`

Purpose: perform an evidence-backed review of the repository's actual high-risk
boundaries.

The review should select only relevant areas from:

- LAN binding and local-first assumptions;
- upload validation, storage, and resource limits;
- origin and host enforcement;
- browser command allow-listing and parameter validation;
- TypeScript/Rust protocol shape and version drift;
- WebSocket lifecycle and reconnect behavior;
- dependency and source notices;
- release tag and successful-preflight provenance; and
- desktop or Android artifact contents.

Every finding should identify evidence in source, tests, configuration, or a
reproducible command. Generic checklist output is not a finding.

### `herdr-impact-map`

Purpose: provide explicitly invoked Graphify assistance for unfamiliar or
wide changes.

Requirements:

- use only the pinned code-only commands;
- write only beneath `.scratch/graphify/`;
- never mutate `AGENTS.md`, hooks, dependencies, or global configuration;
- label graph relationships as candidates;
- verify every reported path in source;
- explicitly inspect stringly typed HTTP, WebSocket, file, and process
  boundaries that a static symbol graph may miss; and
- disable implicit invocation in `agents/openai.yaml`.

This skill should be created only if the Graphify pilot meets the criteria
above.

## Additional capability recommendations

### GitHub MCP

The [official GitHub MCP server](https://github.com/github/github-mcp-server)
can expose pull requests, review comments, issues, and Actions results. It
supports restricted toolsets and read-only operation.

Recommended policy:

- begin with only repository, pull-request, review, and Actions read tools;
- enable write tools only for an explicitly requested issue update or pull
  request;
- do not permit merge operations by default; and
- do not let remote status replace local verification.

### Playwright CLI skill

Herdr World already owns a substantial Playwright suite. Use a CLI-oriented
skill to investigate and validate browser behavior through that existing
toolchain. Microsoft distinguishes the lower-context CLI-plus-skills route
from the broader service model in the
[Playwright MCP project](https://github.com/microsoft/playwright-mcp), and
OpenAI publishes a
[curated Playwright skill](https://github.com/openai/skills/tree/main/skills/.curated/playwright).

Prefer the skill/CLI approach initially. A persistent browser MCP service is
not needed merely to run, debug, or extend the repository's tests.

### Codex Security

The [Codex Security plugin](https://github.com/openai/plugins/tree/main/plugins/codex-security)
is a sensible explicitly invoked capability for changes involving bridge
network exposure, uploads, origins, command execution, dependencies, or
release mechanics. It should not run as mandatory ceremony for unrelated UI
or documentation changes.

### Property-based testing

Trail of Bits publishes a focused
[property-based-testing skill](https://github.com/trailofbits/skills/tree/main/plugins/property-based-testing).
It is a good candidate for serializers, parsers, normalizers, protocol
round-trips, and state-machine invariants. Use it selectively and require
approval before introducing a new production or test dependency.

The broader [Trail of Bits skills collection](https://github.com/trailofbits/skills)
also contains differential-review and language-review workflows, but several
assume large multi-agent review structures or toolchains that do not fit this
repository. In particular, a generic large Rust review bundle should not
replace the bridge's focused tests and repository-specific adversarial review.

## Adoption order

1. Create `herdr-debug`, `herdr-verify`, and
   `herdr-adversarial-review`, keeping `AGENTS.md` authoritative.
2. Add minimally permissioned GitHub access and Playwright CLI guidance.
3. Run the explicit Graphify pilot over representative repository changes.
4. Create `herdr-impact-map` only if that pilot demonstrates reliable value.
5. Add targeted security and property-based-testing capabilities when the
   corresponding work requires them.
6. Reassess tool versions, manifests, permissions, remote data behavior, and
   instruction conflicts before any future upgrade.

## Decision matrix

| Capability | Recommendation | Role in delivery |
| --- | --- | --- |
| Graphify | Guarded code-only pilot | Optional orientation hint |
| Stock Graphify Codex installer | Reject | None |
| Full Superpowers plugin | Reject for repo-wide use | None |
| Selected Superpowers practices | Adapt into repo-native skills | Debugging, verification, and review guidance |
| GitHub MCP | Adopt with minimal permissions | PR, review, and CI visibility |
| Playwright CLI skill | Adopt | Browser investigation and test authoring |
| Codex Security | Invoke for security-sensitive changes | Focused adversarial analysis |
| Property-based-testing skill | Adopt selectively | Protocol and state invariants |
| Existing repository checks | Retain as authoritative | Delivery evidence and merge gates |

## Reassessment triggers

Revisit these recommendations if:

- Graphify adds reliable cross-language HTTP/WebSocket edge modeling;
- Graphify provides a side-effect-free, repo-scoped Codex installation path;
- the Graphify security policy and CI gates are updated for the current
  release line;
- Superpowers offers a repository-policy profile that removes mandatory
  artifact, subagent, commit, and merge behaviors;
- Codex changes its hook or repo-scoped skill conventions; or
- Herdr World's architecture or delivery workflow changes materially.

Until then, the simplest complete approach is to strengthen agent judgment at
the repository's real risk boundaries and keep existing tests, CI, release
checks, and human pull-request review as the sources of delivery confidence.
