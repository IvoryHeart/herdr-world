---
name: herdr-workflows
description: Operate requested visible Herdr Workflows teams in Herdr World, with bounded handoffs, event waits and concise execution evidence.
---

# Herdr Workflows operations

Use when the owner requests HWF or visible agent collaboration. This skill does
not authorize starting agents after an owner has stopped them.

Read the optional visible-team section in `docs/agent-development.md`. Use the
existing `.hwf/workflows/agent-delivery.yaml` and installed `hwf` help; inspect
bundled `hwf skills show herdr-workflow-create` before changing recipe syntax.
Keep one writer, a navigator when requested, and an independent reviewer.
Assign concrete acceptance slices with explicit response verdicts. Do not inject
follow-up prompts into an HWF-owned turn unless intervention is necessary.

## Block and return

Run foreground commands through the repo helper:

```sh
bun run agent:await --log .agents/hwf/check-001.log -- bun run check
bun run agent:await --log .agents/hwf/team-001.log -- hwf run agent-delivery --input worktree_dir=/path/to/worktree --input agent_profile=codex --input task_brief='Authorized acceptance slice'
```

Choose a fresh log path. The helper waits on child exit, stores full output with
private file permissions, returns an 8 KiB tail and preserves the exit status.
It forwards SIGINT/SIGTERM to the immediate child; it is not a process-tree cleanup
tool. HWF failures can leave agent panes open.

When the execution tool returns a running session, resume its blocking wait with
empty input. Do not issue concurrent status probes. Tool timeout means the child
may still be running; it is not an execution failure. A wait resumption does not
restart the command. Use `herdr agent wait <pane> --until idle --until done --until
blocked --timeout <milliseconds>` for agent state events.

## Diagnose once, then act

Use `hwf runs get <run-id> --json` once when investigation is required. Read the
response artifact at the returned checkout root:
`.hwf/tmp/<run-id>-step-<ordinal>.txt`. Bound the read and preserve the final verdict.
Validate it with `hwf response check <file> --one-of APPROVE,BLOCK` when those are
the expected tokens. Use bounded terminal reads only for missing responses or
interactive questions. Preserve configured model choices.

Retry uses the recorded workflow definition and inputs. If recipe, input or timeout
must change, start a fresh continuation with the existing worktree and a precise
handoff. Do not repeat a stale retry hoping it adopts edited configuration.

Keep one current ignored checkpoint: exact head, dirty work, current phase, checks
with exit status and workload, open issues, next owner. Task counts are not an ETA.
Exercise production-size workloads and representative runners early; coordinate
CPU-intensive measurements with unrelated work. Preserve failed measurements.

On stop, identify the owned runner and exact owned panes before terminating them.
Do not discover ownership by process-name substring or close unrelated panes.
Preserve uncommitted work. State explicitly when HWF history remains stale.
Follow candidate-delivery for PR handoff; this operating skill adds no permission
to commit, push, merge or message others.
