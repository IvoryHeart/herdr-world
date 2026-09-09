# Combined terminal debugging pilot

OpenWiki 0.5.0 and Skillgrade 0.3.0 are opt-in experiments. They share one terminal
visibility/view-switching problem, with separate measurements for knowledge and
execution. A successful combined task cannot identify either tool's individual
contribution; a later matched replay can test that if the result warrants it.

## Install locally

From the selected task worktree:

```bash
npm run agent:skills
npm run eval:pilots:setup
npm run eval:skills
npm run eval:pilots:check
```

The pilot package has its own lockfile and node_modules under evals/pilots. Normal
bootstrap, product runtime and CI do not install it. Setup calls OpenWiki's pinned
upstream project installer, installs its unchanged skill and registers a local MCP
command in ignored .codex/config.toml. It preserves unrelated configuration and
writes a narrow, user-owned openwiki/INSTRUCTIONS.md only if absent. No global
installation, API key copying, paid model call or wiki generation occurs at setup.
The local wrapper disables OpenWiki telemetry. Existing host authentication remains
with Codex. No new personal connectors or remote sources are configured.

Use `node evals/pilots/openwiki.mjs integrations list --project .` to inspect the
installation. Check the current client's MCP tools before generation. A new MCP
connection may need client reload; installed files and a successful fresh-server
check do not mean the current session has loaded that connection. Ordinary work
can continue in the same session through explicit skill reads.

The OpenWiki adapter uses its pinned installer's `mcpServerCommand` override to
select this worktree's package, so the MCP server needs no global executable.
This is a small version-specific integration surface; recheck it on upgrades.
To remove the pilot integration, run `npm run setup --prefix evals/pilots -- --remove`.
The upstream uninstaller removes its managed skill/config entry, preserving unrelated
settings and the generated knowledge for review.

## Run the owner's problem

1. Capture exact reproduction steps, expected/observed behavior, affected views,
   whether side panels are open, host connectivity and a synthetic fixture. Determine
   whether a missing terminal and a switched selection are one defect or two. Freeze
   the source revision and acceptance before a fix. The owner's steps are still needed;
   the reconnect smoke below is not a reproduction of that report.
2. With the unchanged source, use the OpenWiki skill and native MCP lifecycle to
   generate quickstart plus terminal identity/visibility and navigation pages. Follow
   its sequential page queue in the same host session. Record material Claims with
   source spans. Review correctness of the map; do not edit product source in this phase.
3. Use the wiki to locate relevant source, then reproduce and debug through native
   Codex and Superpowers systematic-debugging/TDD. Verify source behind Claims rather
   than assuming generated knowledge is authoritative. Keep one task worktree and
   retain the implementation/review histories.
4. Turn the reproduction into a small frozen Skillgrade case: an explicit task,
   synthetic workspace and deterministic behavioral grader. Cover terminal ownership
   and selection preservation across the affected views, plus empty state and relevant
   layout conditions. Keep expectations/reference work out of the live mappings.
   Prove that the broken candidate fails and a known correction passes before a live
   model trial. Do not reward file names, skill mentions or matching a reference patch.
5. Run one explicitly scoped trial initially. Keep allocation, source and acceptance
   fixed and record interventions. Independently review the actual product fix and
   run its relevant checks; Skillgrade scores do not replace PR review.
6. Update affected OpenWiki pages/Claims against the corrected source and check that
   stale statements are detected and repaired. Record this maintenance work separately.

Generated pages, Claims and pilot outputs stay ignored until source review establishes
what is suitable for sharing. OpenSpec remains the source for intended contracts;
OpenWiki is a navigation and implemented-knowledge layer. Source-backed claims can
still be semantically wrong, so successful persistence is not proof of accuracy.

## Installation controls and bounded smoke

`eval:pilots:check` makes no model calls. It exercises the real OpenWiki installer,
MCP tool discovery and invalid-run rejection, plus Skillgrade reference/negative
controls for the retained reconnect regression. It skips clearly if opt-in packages
are absent. These controls establish tool/grade mechanics, not live debugging quality.

To prepare the existing reconnect smoke:

```bash
node evals/pilots/prepare.mjs
```

The command prints an ignored prepared directory containing eval.yaml, source hashes,
allocation and a separate controls directory. From that directory invoke the pinned
Skillgrade CLI by its absolute path:

```bash
node /path/to/task/evals/pilots/node_modules/skillgrade/bin/skillgrade.js --list
node /path/to/task/evals/pilots/node_modules/skillgrade/bin/skillgrade.js --trials=1 --parallel=1 --ci --threshold=1 --output=/path/to/private/results
```

The second command invokes one Luna/xhigh Codex trial through Skillgrade's standard
custom-command adapter. It requires the existing Codex login and GNU `timeout` (the
initial local smoke is Linux-specific). It uses workspace-write sandboxing, keeps
native journals and disables child agents only for this one-file controlled eval.
The normal native workflow keeps agents enabled. The five-minute command budget
belongs to this tiny smoke; it is not a repository test-suite or development deadline.
The outer Skillgrade allowance is longer to allow command cancellation to finish.
Before invoking a model, the generated command probes the pinned CLI's actual
`:workspace` permission profile with `codex sandbox`. A failed sandbox starts no
model. Diagnose that environment on the intended runner; do not silently disable
sandboxing to turn a failed trial green. The direct equivalent is:

```bash
harness/node_modules/.bin/codex sandbox --permission-profile :workspace -- true
```

Skillgrade's built-in Codex adapter currently uses `--full-auto` and `--ephemeral`
and does not return the token totals it parses. The pinned CLI's supported sandbox
flags and durable journals motivate the standard command-adapter configuration.
Read actual journals/JSONL for activation and accounting; command-adapter reports
alone do not establish which skills the agent used.

Skillgrade's local provider is a temporary copy, not a security boundary. Grader
scripts are visible in that workspace, and the provider's timeout rejects a promise
without ensuring command termination. Use a real process deadline for bounded live
smokes, run sequentially (the adapter shares /tmp/.prompt.md), and independently
verify candidate results before treating a score as acceptance. Do not use this
local pilot as an adversarial-isolation or unattended multi-task benchmark.

## Record and decide

Record task/source/tool revisions and actual model/effort; accepted result and first
external-review findings; reproduction, generation, debugging, review and wiki-update
intervals; all lead/worker/independent CLI usage; repeated reads/checks; interventions;
and disk/setup cost. Preserve thread IDs and raw outputs privately. Standalone
Skillgrade Codex invocations are separate root sessions, so include them explicitly
in agent:usage scopes rather than assuming parent ancestry. Cost is unknown unless
independently measured. Do not sum overlapping child durations.

Keep OpenWiki if its source map is accurate, reduces useful navigation work and is
cheap enough to maintain. Keep Skillgrade if real regressions receive stable grades,
valid alternatives pass, and trial outputs can be audited without a new orchestration
platform. A smoke or one combined task is evidence for the next decision, not proof
of general speed or quality gains.

Upstream: [OpenWiki](https://github.com/langchain-ai/openwiki),
[Skillgrade](https://github.com/mgechev/skillgrade).

## Initial findings

Local installation, native discovery, OpenWiki MCP discovery/invalid-run rejection,
and Skillgrade reference/negative controls passed. These controls made no model calls.
One Luna/xhigh live reconnect smoke was interrupted after repeated sandbox failures
(`bwrap: loopback: Failed RTM_NEWADDR`). It did not produce an accepted correction.
The recorded interval was 3m14s, with 1,026,473 input tokens (951,296 cached) and 6,309
output tokens. Interrupted-turn coverage is provisional. That prompted the no-model
sandbox preflight; the intended terminal debugging pilot remains unrun.

The optional dependency audit reported no high/critical findings and one moderate
uuid advisory propagated through dockerode and Skillgrade, with no automatic fix
available. The local pilot does not invoke Docker. Recheck upstream before expanding
the pilot or adopting Docker execution; these dependencies are absent from the normal
runtime/install. Do not interpret that narrower use as proof the advisory is harmless.
