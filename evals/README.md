# Agent evaluation controls

The retained evaluation surface is deterministic and runs without a model, Docker,
Harbor or uv environment:

```bash
npm run test:agent
npm run spec:check
npm run eval:check
```

`evals/tasks.json` contains reusable task and grader cases. `evals/graders/grade.py`
can grade one case directly with `python3 evals/graders/grade.py CASE_JSON ARTIFACTS`;
the artifact directory receives `reward.txt`. `evals/check.py` runs the positive and
negative controls for every retained case. `evals/product-cases.json` preserves the
browser and unit regression corpus for future native pilot work; it is data, not an
automatic live runner.

The native discovery integration check is available separately after the local native
skills bundle and Codex tooling are installed:

```bash
npm run agent:bootstrap
npm run eval:skills
```

Discovery verifies the exact names and local paths of three selected Superpowers
skills, five OpenSpec skills and two repository skills, and
rejects the eleven excluded Superpowers skills and `openspec-propose`. The installer
tests cover fresh setup, migration from the full bundle, repeat setup, tampered files
and preservation of a cache shared by another worktree. These checks make no model calls.

Optional OpenWiki and Skillgrade pilot setup and checks are exposed through
`npm run eval:pilots:setup` and `npm run eval:pilots:check`. See
[`docs/agent-pilots.md`](../docs/agent-pilots.md) for their scope and preparation.

Native response accounting remains available through `npm run agent:usage -- --thread
LEAD_THREAD_ID`. It reports the selected native lead and its descendants from local
session journals and labels incomplete histories as provisional.
