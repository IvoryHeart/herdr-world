# World primitives research

Status: research, parked on 2026-10-28. This is not a contract; current
contracts are in [`openspec/specs/`](../openspec/specs/). An OpenSpec change
follows once a second workflow has run on the same pieces (see
[Path to a spec](#path-to-a-spec)).

World should describe how agents work as a few composable primitives: goals,
workflows, loops, skills, personas, templates and policies. Each can attach at
any level of the world, from World down to a pane and the agent in it, and
levels below inherit it. The [`agent:crew`](../scripts/agent/crew.ts) watcher
([guide](agent-development.md#act-on-readiness-with-agentcrew)), merged in
[#443](https://github.com/IvoryHeart/herdr-world/pull/443), is the first
instance: a review workflow, run by a loop, pursuing the goal "this PR is
READY" with three reviewer personas and one review skill.

The thesis: primitives are data that attaches to places, World is the runtime
that interprets them, and the harnesses and models underneath are
interchangeable. Existing standards come first; World defines only what no
standard covers.

## What #443 taught

The watcher ran review rounds 6–15 on its own PR: 30 reviewer runs, 20.3M input
and 167k output tokens, with no messages between agents. Each lesson becomes a
rule for every primitive.

| Lesson                                  | In #443                                                                                   | Rule                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Coordinate through state, not messages  | Earlier `herdr agent prompt` relays were chatty; the watcher reads GitHub state instead   | Workflows read and write shared state; agents don't message by default    |
| Done is a result, not an exit           | An old watcher killed a reviewer that had already posted; the fix counts the posted RESULT | Every skill declares a result contract; a run is done when it exists      |
| Observability and control               | Headless runs vanished while the owner read them; interactive panes fixed it               | Every run is visible, can be talked to and can be reopened                |
| Lifecycle follows the work item         | A PR's round tabs close when it merges or closes                                           | A pod lives exactly as long as its work item                              |
| Fresh context, deliberately             | Each round starts new reviewers on the current head                                        | A workflow declares what context each role starts with                    |
| Act once                                | Keyed, recorded actions survived dozens of watcher restarts                                | Every action has a stable key; a restart never acts twice                 |
| Escalate, don't kill                    | Overdue runs and stuck checks become notices                                               | Loops carry watchdogs and budgets, and their last step is the owner       |
| Actions have side effects               | A PR-body edit started a CI run; a job rerun cancelled another run                         | Actions declare what they touch                                           |
| Side effects behind one seam            | `Deps` let the crew tests run passes without Herdr or GitHub                               | The runtime reaches Herdr, harnesses and forges through adapters          |

## Prior art

Skills, instructions and tools have cross-vendor standards. Personas,
workflows, goals, loops, inheritance and budgets do not. Mature workflow
systems separate a deterministic coordinator from side-effecting steps, which
the crew already does.

| Primitive      | Closest prior art                                                                                                                                                                                                                                                                                                                                                                | Standard?                                    | Proposal                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Skill          | [Agent Skills](https://agentskills.io/specification) (`SKILL.md`, `scripts/`, `references/`, `assets/`), read by Claude Code, [Codex](https://learn.chatgpt.com/docs/build-skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), Cursor and Copilot                                                                                                                       | Yes                                          | Adopt as is; World's extras go under `metadata`                              |
| Instructions   | [AGENTS.md](https://agents.md); [CLAUDE.md](https://code.claude.com/docs/en/memory) for Claude                                                                                                                                                                                                                                                                                   | Yes                                          | Adopt; harnesses concatenate root to leaf, so the deepest file is read last  |
| Tools          | [MCP](https://modelcontextprotocol.io/specification/latest)                                                                                                                                                                                                                                                                                                                      | Yes                                          | Adopt                                                                        |
| Persona        | [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)                                                                                                                                                                                                                       | No                                           | World's agent profile stays the neutral record, compiled for each harness    |
| Workflow       | [Temporal](https://docs.temporal.io/workflows), [Kubernetes controllers](https://kubernetes.io/docs/concepts/architecture/controller/), [Google ADK workflow agents](https://adk.dev/agents/workflow-agents/), [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), [CrewAI Flows](https://docs.crewai.com/en/concepts/flows)                         | No ([Serverless Workflow](https://github.com/serverlessworkflow/specification/blob/main/dsl.md) is a step list) | A reconciler with a small schema of our own                                  |
| Goal           | [Claude Code `/goal`](https://code.claude.com/docs/en/goal) (a separate model judges met, not met or impossible), Codex `/goal` with token budgets (third-party reports only), [Devin playbooks](https://docs.devin.ai/product-guides/creating-playbooks)                                                                                                                           | No                                           | A mechanical done-check first; a judge model only for fuzzy criteria         |
| Loop           | [Claude Code `/loop`](https://code.claude.com/docs/en/scheduled-tasks) (session-scoped, expires after 7 days, no catch-up), [Ralph](https://ghuntley.com/ralph/)                                                                                                                                                                                                                 | No                                           | Durable loops run in World; harness loops stay for in-session babysitting    |
| Inheritance    | [Claude Code settings](https://code.claude.com/docs/en/settings) (nearest scalar wins, lists merge, some security keys take the strictest value), [Codex config layers](https://learn.chatgpt.com/docs/config-file/config-advanced)                                                                                                                                              | No                                           | World owns the cascade and writes the result into each harness's files       |
| Agent to agent | [A2A](https://a2a-protocol.org/latest/specification/), [ACP](https://agentclientprotocol.com/overview/introduction)                                                                                                                                                                                                                                                              | Yes, for remote agents and editors           | Not used for coordination inside World                                       |

Evidence on cost and correctness:

- [Anthropic's multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  used about 15 times the tokens of chat. Early failures included spawning 50
  subagents for simple queries and duplicating work through vague delegation.
- The [MAST taxonomy](https://arxiv.org/abs/2503.13657) lists 14 multi-agent
  failure modes, including step repetition and being unaware of stopping
  conditions. Budgets and stop conditions belong outside the model.
- [Cognition](https://cognition.com/blog/multi-agents-working) finds parallel
  contributors work when writes stay single-threaded: one writer per work item.
- A [blackboard-architecture study](https://arxiv.org/html/2507.01701v1)
  reports competitive results with fewer tokens, as #443 saw.

## The primitives

Seven primitives are authored once and reused. Six records are kept by the
runtime when those definitions meet a real work item.

| Authored primitive | What it is                                                                                                       | In #443                                                       | In World today                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Persona            | Who an agent is: harness, model, effort, permissions, role, skills, tools, brief, look                            | The three reviewer seats in the roster                        | Agent profiles ([`shared/agentProfile.ts`](../shared/agentProfile.ts)) |
| Skill              | What one agent does in one run, plus a result contract saying what "done" leaves behind                           | The reviewer prompt and its `RESULT #N` line on the PR        | `SKILL.md` folders discovered on the host and attached by name         |
| Goal               | A done-condition checked against observable state, with an owner; it may break into child goals                   | The gate's READY predicate                                    | None                                                                   |
| Workflow           | A reconciler that compares a work item's state with its goal and plans keyed actions for roles                    | The crew's pure planning step                                 | None                                                                   |
| Loop               | What drives a workflow: trigger, watchdog, budgets and stop condition, hosted by World or by a harness session    | `agent:crew watch` with its stall and run timeouts            | None                                                                   |
| Template           | A saved bundle that creates a place with its attachments                                                          | The crew configuration, written by hand                       | Starter profiles only                                                  |
| Policy             | A limit, permission or approval rule, lockable at the level that sets it                                          | Run limit, never-prompt seats, rerun budget, reviewer auto mode | A permission choice per profile; no levels or locks                    |

| Runtime record | What it is                                                                                         | In #443                         |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| Work item      | What a goal is about: a PR, issue, task or deploy; its lifecycle bounds everything attached to it  | The PR                          |
| Pod            | One workflow running for one work item, with its rounds, runs and tabs                             | Round tabs `#443 … · rN`        |
| Role binding   | Which persona fills which role at this place                                                       | Roster, authors and leads       |
| Run            | One persona using one skill for one action: visible, reopenable, with a session, result and cost   | The crew store's run rows       |
| Notice         | Something the owner must see, delivered to reception                                               | READY and NEEDS-OWNER           |
| Usage record   | Tokens, cost, context size, time and outcome for one run, tagged with its place                    | Per-run tokens from session files |

Skills and workflows both carry scripts but stay separate: a skill is one agent
in one session, while a workflow coordinates roles over time and names skills.

## Levels and inheritance

The levels follow what Town draws:

1. World: the whole install and owner-wide defaults.
2. Building: a host, one Herdr connection.
3. Room: a Herdr workspace, a team or a project.
4. Table: a Herdr tab, one work item's table, as Town draws it.
5. Seat: a pane in that tab.
6. Agent: the session in the seat, with its harness and the model its persona chose.

Four rules resolve what applies at a level:

- **Defaults flow down.** Anything attached at a level applies below it.
- **Nearer wins by name.** A same-named attachment lower down replaces the one
  above; lists merge unless replaced.
- **Locks hold below.** Any level can lock what it attaches; levels below may
  tighten a locked limit but never loosen it or replace a locked attachment.
- **Metrics roll up.** Usage sums from each agent upward, and each level checks
  its own total against its own budget.

Typical attachments: World holds the persona library, notice routing and
owner-wide budgets; a building holds host limits; a room holds the project's
skills (its `.agents/skills`), roster, workflows and loops, stamped out by a
room template; a table holds one work item's pod; a seat holds the persona and
its session. A cheaper reviewer on a smaller model is a separate persona, not a
variant: World keeps no per-model variants.

## Agents as authors

An agent may author primitives in its own realm and below; anything wider, or
any widened budget or permission, needs the owner's approval.

| Author          | Realm    | Authors directly                                                  | Needs owner approval                   |
| --------------- | -------- | ----------------------------------------------------------------- | -------------------------------------- |
| Owner           | World    | Anything                                                          | Nothing                                |
| Town master     | Town     | Goals and loops for rooms, role bindings                          | New workflows or templates, wider budgets |
| Room lead       | One room | Goals for work items, child goals, loops within the room's budget | Publishing a workflow or skill to other rooms |
| Agent in a seat | Its table | Child goals, its own session loop (`/goal`, `/loop`), skill drafts | Anything above its table               |

1. **Primitives are data** in a restricted schema World validates. A skill with
   scripts is code and is reviewed like code before others use it.
2. **Budgets nest.** A child's runs, tokens and time come from its parent's
   budget, with depth and count capped per parent.
3. **Provenance is recorded:** author (persona and session), approver and
   version. A running pod keeps the version it started with.
4. **Drafts arrive as letters** at reception and publish only once approved.
5. **Session loops stay in their session.** Anything that must outlive it
   becomes a World loop.

## Cross-harness

Each primitive is defined once in a neutral form; at launch World compiles the
resolved result into the harness's own files and flags for that seat.

| Neutral      | Claude Code                                         | Codex                                                        | Other harnesses                   |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| Persona      | Inline subagent through `--agents`/`--agent` (today) | CLI options and `developer_instructions` (today), or `.codex/agents/` | The role in the first prompt (today) |
| Skill        | `.claude/skills/<name>/`                            | `.agents/skills/<name>/`                                     | `.agents/skills/`                 |
| Instructions | `CLAUDE.md` importing `AGENTS.md`                   | `AGENTS.md`                                                  | `AGENTS.md`                       |
| Tools        | MCP servers                                         | MCP servers                                                  | MCP servers                       |
| Model        | `--model`, `--effort`                               | `-m`, `model_reasoning_effort`                               | Per harness                       |
| Loop guards  | Stop hooks                                          | `hooks.json` (project hooks need trust)                      | An adapter per harness            |

Existing agent files should become personas. Today World compiles profiles out
to each harness but never reads `.claude/agents/*.md` or `.codex/agents/*.toml`
back in. The proposal discovers them as it already discovers skills, keeps the
file as the source of truth and exports World-made personas to those files.

Harness differences World absorbs: duplicate skill names behave differently per
harness, so World enforces unique, level-namespaced names; Claude's
non-standard frontmatter fields are rejected outside Claude Code, so World's
extras go under `metadata`; Codex agent files cannot set sandbox or approval
policy, so permissions stay launch options.

## Policies and locks

A limit set at a level is a ceiling for every level below; a locked skill,
persona or workflow cannot be replaced below the level that locked it. Policies
cover budgets (tokens, cost, runs at once, time), allowed models and harnesses,
the permission ceiling and never-prompt seats, which providers may be written
to, and what needs the owner's approval.

| Precedent                                                                                                                       | Rule                                                                         | Taken                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| [AWS SCPs](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html)                 | An allow is needed at every level; a deny anywhere wins                      | The effective limit is the intersection     |
| [Claude Code managed settings](https://code.claude.com/docs/en/settings)                                                         | Nothing overrides a managed key; some keys take the strictest scope's value  | Stricter wins                               |
| [Azure Policy](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/scope)                                         | Assignments flow down; exemptions are recorded, expire and need a permission | Owner-only, time-boxed, recorded exemptions |
| [GCP Organization Policy](https://docs.cloud.google.com/resource-manager/docs/organization-policy/understanding-hierarchy)        | A child can override a parent's enforced boolean                             | Avoided                                     |

Enforcement uses each harness's own locks. Building locks become the host's
managed configuration (Claude Code managed settings,
[Codex `requirements.toml`](https://learn.chatgpt.com/docs/enterprise/managed-configuration)),
which apply machine-wide. Room, table and seat locks become launch options for
one agent. World enforces run limits, budgets and never-prompt seats itself.

## Observability and economics

Every run is measured in one shape and tagged with its place, so usage rolls up
while limits flow down.

| Measure                       | Standard                                                                                                                             | Source today                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Input, output and cache tokens | OTel GenAI [`gen_ai.client.inference.usage.*`](https://github.com/open-telemetry/semantic-conventions-genai) (Development; pin a version) | [Claude Code metrics](https://code.claude.com/docs/en/monitoring-usage), Codex token metrics, session files |
| Cost                          | None in OTel; [FOCUS](https://focus.finops.org/technology-categories/focus-for-ai/) rows for export                                    | Claude Code only; otherwise derived from a versioned price table                                  |
| Context size and utilisation  | None; World defines one gauge (window used over window size)                                                                          | Per-turn input size in session files                                                             |
| Agent and tool time           | `gen_ai.invoke_agent.duration`, `gen_ai.execute_tool.duration`                                                                        | Harness events                                                                                   |
| Session                       | `gen_ai.conversation.id`, the harness's own session ID                                                                               | The crew stores each run's session ID                                                            |
| Outcome                       | None; World's own                                                                                                                    | RESULT lines, READY, notices, defects found after merge                                          |

World launches every agent, so it can tag the place through
`OTEL_RESOURCE_ATTRIBUTES`, which Claude Code documents for attribution. Where a
harness cannot be tagged, World joins usage by session ID. World never depends
on OTel alone: session files are the baseline source. Seat and session IDs stay
on events, not metric labels. Totals add up from agent to table, pod, room,
building and World; a level over budget notifies the owner and nothing is
killed.

Fat versus thin agents is measured, not assumed. The evidence favours thin by
default: [Chroma's context-rot study](https://www.trychroma.com/research/context-rot)
found focused prompts of about 300 tokens beat about 113k, and
[Anthropic recommends](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
clean-context subagents returning short summaries. Context strategy becomes a
persona property, World compares tokens per accepted result and defects by
persona, task kind, project and owner, and a room policy sets its default once
there is data. The #443 reviewers were thin and are the first data point.

## Providers

World keeps a small, fixed set of seams, each on a standard, with adapters
inside World. Sources and cost metrics already follow this pattern: one
service, plug-and-play adapters, no plugin framework, and "not connected,
here's how" when a prerequisite is missing.

| Seam          | Covers                                  | Standard                                                                                                                                      | Today                                    |
| ------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Harness       | Starting agents, their files and locks  | Herdr agent kinds, `SKILL.md`, `AGENTS.md`, MCP, managed config                                                                                | Claude and Codex launched from profiles  |
| Forge         | PRs, checks, reviews                    | Official [GitHub](https://github.com/github/github-mcp-server) and [GitLab](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) MCP servers, or `gh` and `glab` | GitHub through `gh`                      |
| Tracker       | Tickets                                 | Forge issues, Jira                                                                                                                             | GitHub issues and Jira in Sources        |
| Metrics       | Usage and cost                          | OTel and OTLP, Prometheus, FOCUS for export                                                                                                    | A Prometheus provider                    |
| Memory        | What persists between sessions          | No standard; a `/memories` folder of files, as in [Anthropic's memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | Each harness's own memory                |
| Board         | Shared state agents coordinate through  | Forge issues and PRs, with [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) and [A2A](https://a2a-protocol.org/latest/topics/life-of-a-task/) status words | The PR and its RESULT lines              |
| Notifications | Letters to the owner                    | None; internal                                                                                                                                 | Herdr notifications and crew notices     |

To keep this from growing complex: add a seam only when a second real provider
needs it; workflows ask seams (`work_item.checks`), never providers; adapters
declare their capabilities statically, so a missing one is reported up front;
MCP is the escape hatch for anything without a seam; and the first version
avoids MCP Tasks' experimental wire protocol and ForgeFed.

## Basic design

Project primitives live in the repository and are reviewed by PR; owner
primitives live in the World service beside agent profiles.

| Primitive                                                    | Home                                          |
| ------------------------------------------------------------ | --------------------------------------------- |
| Skill                                                        | The repository's `.agents/skills/`, or the user's skill folders |
| A project's goals, workflows and loops                       | `.agents/workflows/<name>.yaml` in the repository |
| Personas, templates, role bindings, World and building loops | The World service store                       |
| Pods, runs, notices and usage records                        | World service records (`crew.sqlite` in the pilot) |

Durable attachments are keyed by connection ID plus a stable identity: the
repository checkout for a room, the work item for a pod. Herdr workspace and
tab IDs change when Herdr restarts and are reused, as World's persisted
workspace state already accounts for, so they never key anything that must
survive. Runtime operations (launches, tabs, panes) are qualified by
connection ID and runtime generation and never fall back to another
connection.

One reconcile cycle runs every workflow:

1. The loop ticks (every 300 s in the pilot) under its watchdog and budgets.
2. The workflow reads the work item's state and checks the goal.
3. It plans keyed actions: prompt the author, start reviewer runs, notify the owner.
4. Runs, each a persona using a skill in a visible seat, post their results to
   the work item.
5. Notices reach reception; the next tick starts again from current state.

Every tick recomputes from current state, so a missed or repeated tick costs
one pass and never a wrong action.

The #443 crew as a workflow file:

```yaml
name: pr-review
work_item: pull_request
goal: gate.ready # CI green, required reviewers clean, mergeable
roles:
  author: { from: branch } # the one writer
  reviewers: { personas: [reviewer-a, reviewer-b, reviewer-c], fresh: per-round }
  owner: { notices: reception }
skills:
  reviewers: pr-review # result: "RESULT #N: x/y resolved, z new" on the PR
rules: crew/plan # first cut: rules stay code
loop:
  host: world
  every: 300s
  stall: 30m # a check running longer goes to the author
  run_timeout: 90m # an overdue run goes to the owner, not killed
budgets: { runs_at_once: 3, reruns: 1 }
touches: [github.pr.comments, github.actions.rerun, herdr.tabs]
pod:
  per: work_item
  view: tab-per-round
  closes: on work_item.closed
```

Rules stay code until a second workflow shows which conditions repeat; a
condition language invented from one example would be over-modelling.

## Path to a spec

1. Confirm that the watcher alone closes a merged PR's pod: its tabs,
   reviewer sessions and checkouts.
2. Run a second workflow on the same pieces, likely issue to PR: an author
   persona pursues "a PR for issue N is open and green", then hands over to
   `pr-review`. It tests child goals, one workflow feeding another and an agent
   authoring a goal.
3. Extract the engine (loop, keyed actions, pods, runs, notices, adapters) from
   the crew; each workflow keeps its rules as code.
4. Measure both against the #443 baseline: tokens per merged PR, rounds to
   READY, owner notices per PR, defects after merge and time to READY.
5. Write the OpenSpec change with only the contracts both workflows used.
   Town and Board presentation, starting with notices as letters at reception
   and pods drawn as tables that grow per work item, is a separate design track.

## Parked questions

- Which second workflow: issue to PR, design review or release preparation?
- Is a room one project, or can a Herdr workspace hold several repositories?
- May World write discovered agent files back, or keep its own copy and export?
- What are the first budgets, for example a weekly token budget per room?
- Do templates stay local, or become exportable between World users?
