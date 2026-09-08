# Superpowers and native Codex trial

This is an owner-selected experiment, local to one fresh task worktree.
It evaluates an upstream workflow before retiring the existing Ralph runtime.
OpenSpec remains the knowledge/specification layer; Superpowers supplies development
skills; native Codex owns conversations, subagents and explicit Goals.

The pinned input is [Superpowers 6.3.0](https://github.com/obra/superpowers/tree/v6.3.0)
at b36e0829c6d0140e93cfef2ca599b1b07d4a7797, MIT. Install its 14 skills without
editing them. Its Codex plugin has no hooks or MCP servers. For this first trial
we use Codex's supported repository skill discovery rather than a user-wide plugin
installation. No custom launcher, agent protocol or scheduler is added.
Codex 0.153.4 is the locally tested CLI; other clients require their own discovery
and lifecycle checks. Skills are portable; native transcripts and events are not.

## Install in a fresh task worktree

Start from the intended parent PR and a non-main branch. Do not change another
task's worktree. The existing command creates a centrally located worktree:

~~~bash
npm run agent:worktree -- create <slug> <parent-ref>
~~~

From that worktree, install the upstream release and expose its skills:

~~~bash
git clone --depth 1 --branch v6.3.0 https://github.com/obra/superpowers.git .agents/cache/superpowers-6.3.0
mkdir -p .agents/skills .codex
ln -s ../cache/superpowers-6.3.0/skills .agents/skills/superpowers
cp -n harness/superpowers/AGENTS.override.md AGENTS.override.md
cp -n harness/superpowers/codex.toml .codex/config.toml
npm ci --prefix harness
npm run eval:skills
~~~

The Codex Skill Installer can alternatively install all 14 skills directories
from the same pinned release into .agents/cache/superpowers-6.3.0/skills.
The cache, symlink, local profile and local config are ignored. None changes
user-wide Codex settings, another worktree or installed user plugins. Existing
config/profile files must be inspected and composed deliberately, not overwritten.

Start Codex in this worktree, using the same main model/effort as the comparison.
Trust the project through the normal Codex UI if required. Use /skills or $ to
inspect the skills; restart the session if its catalog is stale. The native
discovery check must pass before a live trial. A profile file on disk does not
prove that the client loaded it.

The local profile keeps repository rules and overrides only the legacy Ralph
start/delivery requirement for the selected task. Twelve overlapping World workflow
skills now live under harness/legacy-skills/ and stay outside native discovery.
OpenSpec, knowledge maintenance and harness evaluation remain discoverable.
The profile bounds native concurrency; the main model remains the user's selection.
Native subagent model/effort defaults are Sol/high; record actual
overrides made by upstream skills. Do not credit an unrecorded model change as a
workflow improvement.

Start with a normal short request. When persistent continuation is wanted:

~~~text
/goal Implement <feature>, address independent review findings, verify acceptance, and open a PR.
~~~

Only native Goals owns automatic continuation in that case. A native Goal is not
a guarantee of process-crash recovery or successful acceptance.

## Workflow ownership

| Concern | Owner |
| --- | --- |
| Requirements and current decisions | OpenSpec and the existing knowledge map |
| Brainstorming, plans, implementation, debugging and review | Upstream Superpowers |
| Task context, subagents and continuation | Native Codex |
| Build/test commands, privacy and delivery rules | AGENTS.md and project docs |
| Trial inputs, outcomes and measured usage | Evaluation evidence |

An OpenSpec design/tasks artifact supplies the corresponding Superpowers input;
do not create competing spec and plan copies. Keep upstream task reviews and
final review for the first trial so this actually evaluates the standard tool.
Classify redundant rounds from observed evidence before changing the workflow.
Ordinary fixes do not gain a mandatory specification or unrelated specialist team.
Use the actual available tool schema where upstream tool examples differ.

## Evaluation

The discovery eval reads the real Codex App Server response. It checks the pinned
skill set, OpenSpec visibility, absence of legacy workflows and native settings.
It creates no model turn or task. Failure or missing preparation is a failed
setup check, not an autonomous success.

Run one short, read-only activation trial before a full feature: ask for a design
discussion, verify that Superpowers brainstorming is actually read, that the
assistant asks a relevant question, and that it neither edits product source nor
launches Ralph. Record its model, native session, elapsed time, completed-response
usage and limitations privately. This does not measure implementation quality.

Then compare a frozen, bounded feature on the prior workflow and this profile,
with the same base, requirements, main/worker models, effort and acceptance.
Include a successful case, an interrupted/resumed case, a slow check and a repeated
infrastructure failure. Add cases only when they measure distinct observable
behavior. Keep acceptance outside the worker's editable controls. Existing Harbor
grader controls can still establish grader behavior; the Ralph activation fixture
cannot establish native routing.

Measure:

- Correct behavior and independent review findings resolved on the final candidate.
- For UI work: agreed visual criteria, rendered inspection and owner assessment.
- Time to first useful result, total work time, command time and human waiting.
- All coordinator and worker usage, retries, repeated reviews and repeated setup.
- Native completion/blocker delivery without the owner asking for a status update.
- Whether interruption resumes useful work without replaying completed steps.

Deduplicate completed response IDs. Cached input is included in input, not added
again. Retained context is not free. Report missing usage and unreported interrupted
responses; token totals are not an invoice or a subscription-allowance percentage.
Keep real session identifiers, prompts, environment data and raw metrics in private
ignored storage; only publish sanitized aggregate evidence.

The Tree work behind PR81 is a historical failure/recovery case, not a matched
feature benchmark. Its successful final recovery reused implemented code and
retained context. Do not compare only that final run against a new feature.

## Initial setup evidence — 2026-09-08

Native discovery passed for 14 unchanged Superpowers skills and six OpenSpec skills;
the 12 legacy workflows were absent and the primary checkout had no trial skills.
An intentionally incorrect local concurrency setting failed the check; restoring
the selected profile passed. These discovery checks made no model calls.

One Sol/high read-only design activation completed in 86 seconds. It read upstream
brainstorming, inspected the existing selector and asked a source-grounded design
question. Source remained unchanged; no Ralph process, subagent or service was
started. It initially tried an incorrect skill path, then recovered locally.
Completed-turn usage was 192,253 input tokens, including 156,416 cached input, and
2,213 output tokens. This excludes the outer session preparing the trial.

Full repository checks passed: 62 harness tests, 524 web tests, 297 Rust tests,
the remaining repository suites, lint and builds. All five strict OpenSpec
validations, eval grader controls and edited-skill validation passed.
Browser acceptance and the Docker supervisor suite were not rerun for this
setup-only change. Native child completion, Goals continuation, interruption
recovery, feature quality and comparative economy remain untested by this smoke.

## Ending the trial

Resume a selected task in the same worktree and native thread. Preserve review and
validation evidence; a model's completion statement alone is not readiness.
Stop at an open ready PR under the repository delivery policy.

After saving any needed private evidence, disable the local profile by removing
only the trial's skill symlink and the local files copied above, or use a fresh
worktree without them. Inspect pre-existing local config before removal.
Keep upstream files unmodified; upgrade by selecting a reviewed release and
rerunning discovery and behavior checks. Retire custom Ralph components only after
the replacement demonstrates the required behavior and economy.

References: [Codex skills](https://developers.openai.com/codex/skills),
[Goals](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex),
[upstream development skill](https://github.com/obra/superpowers/blob/v6.3.0/skills/subagent-driven-development/SKILL.md).
