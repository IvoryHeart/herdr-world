# Agent usage retrospective: World control-plane delivery

This records the 25 September 2026 control-plane work from planning through the
five implementation packages. It measures specified agent-session intervals,
not the whole campaign's cost or a budget for future work. The pull requests
remain the source for exact scope, verification and merge state.

## Campaign boundary and outcome

- [#101](https://github.com/IvoryHeart/herdr-world/pull/101) merged the plan
  and five OpenSpec proposals after the architecture review. It fixed the
  first-wave decisions: topology-focused Graph, a World-service watchlist,
  and existing operations in visual Actions.
- [#102](https://github.com/IvoryHeart/herdr-world/pull/102) proposed a
  selective Roamgate replay, then closed when that approach was replaced.
  [#103](https://github.com/IvoryHeart/herdr-world/pull/103) merged current
  Roamgate source with shared Git ancestry and explicit World adaptations.
- PRs [#104](https://github.com/IvoryHeart/herdr-world/pull/104) through
  [#108](https://github.com/IvoryHeart/herdr-world/pull/108) delivered bounded
  observation, task summaries, the qualified watchlist, agent source-control
  context and visual-route Actions in two dependent branch stacks. All five
  merged on 25 September after their repair and integration heads passed CI,
  the latest reviews reported no remaining findings, and the owner explicitly
  waived the independent-review requirement.
- [#109](https://github.com/IvoryHeart/herdr-world/pull/109) records usage and
  process changes. The related [#100](https://github.com/IvoryHeart/herdr-world/pull/100)
  visual action-parity PR remains open and is outside the B–F measurements.

#100 and #108 both edit the three visual views, the World foundation app, the
shared toolbar, World CSS and `CHANGELOG.md`. Before resuming #100, compare
its broader shared-action contract with #108's shipped visual-route Actions
and rebase deliberately. File overlap signals integration work; it does not
establish that the two contracts or implementations are equivalent.

Parallel agent sessions overlapped across the two stacks. The work also
produced repeated review/repair cycles and CI runs. There is no controlled
serial comparison, and the measurements below exclude #101, #103 and some
later repair work; they cannot establish a campaign-wide cost or speedup.

## Efficiency assessment

The parallel work produced five implementation PRs in overlapping 27–54 minute
agent-session windows, but it was token-heavy and needed several repair passes.
The B–F handoff intervals alone logged 87.14 million tokens. The separate
#109 root-session snapshot logged another 16.98 million while also coordinating
reviews; that is more than 104 million across these non-overlapping measured
boundaries before counting #101, #103 or all later repairs. No billing record
or serial comparison supports a dollar-cost or speedup claim. The high cached
share lowers the likely input price relative to uncached reads, but does not
make the repeated prompt processing or elapsed time disappear.

The setup required a full `bun run check` before a ready implementation PR,
and GitHub CI ran that command again on each push. It did not require reviewers
to rerun green suites locally or agents to poll check status while work was
still in progress. Those extra checks and waits were agent workflow choices.
The largest measured token driver was accumulated prompt history across many
responses, especially the inherited #109 conversation, rather than the small
startup documents or OTel collection. A fresh bounded handoff and smaller tool
results are better first experiments than removing necessary product contracts.

The final merge sequence from #104 to #108 took about 24 minutes, from 18:32
to 18:56 UTC. That includes serialized integration and CI for dependent
branches; it is not a measure of active implementation or model time.

## What was measured

The agent session logs report token usage per model response. The table sums
the `token_usage_record` for each response, including context-compaction
responses. Input includes cached input; output includes reasoning output; total
is input plus output.
Reasoning is a subset, so adding it to output or total would double count it.
The figures below cover the recorded session or interval through each PR
handoff. B is an interval in an ongoing primary-agent session and includes a
small amount of C coordination. C–F are fresh subagent sessions. Wall time is
the elapsed session window, not active model time; the windows overlap, so
their sum is not the calendar time for the overall delivery.

The primary agent delivered B and delegated C–F as bounded package assignments.
The session contexts record `gpt-6-sol` at `xhigh` effort for B and
`gpt-5.6-terra` at `high` effort for C–F. Different scopes prevent a controlled
model or effort comparison from these totals.
The branch shape was B and C from the merged #103 main; D stacked on B; E
stacked on C; F stacked on E. Each package used an isolated worktree, focused
checks, a full repository gate, and a PR handoff. Parallel assignment shortened
calendar time, while the stacks meant later packages depended on earlier branch
heads and carried their context into review and checks.

| Package / PR | Model responses | Input | Cached input | Uncached input | Output (reasoning subset) | Total | Wall window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [B / #104](https://github.com/IvoryHeart/herdr-world/pull/104) | 124 | 13,359,438 | 13,180,672 | 178,766 | 63,926 (33,902) | 13,423,364 | 27 min |
| [C / #105](https://github.com/IvoryHeart/herdr-world/pull/105) | 101 | 14,513,988 | 14,263,040 | 250,948 | 36,567 (10,372) | 14,550,555 | 30 min |
| [D / #106](https://github.com/IvoryHeart/herdr-world/pull/106) | 180 | 24,355,002 | 23,940,096 | 414,906 | 62,049 (11,551) | 24,417,051 | 54 min |
| [E / #107](https://github.com/IvoryHeart/herdr-world/pull/107) | 100 | 13,865,135 | 13,562,880 | 302,255 | 42,179 (7,970) | 13,907,314 | 27 min |
| [F / #108](https://github.com/IvoryHeart/herdr-world/pull/108) | 141 | 20,796,577 | 20,167,424 | 629,153 | 46,687 (15,194) | 20,843,264 | 42 min |
| **Sum** | **646** | **86,890,140** | **85,114,112** | **1,776,028** | **251,408 (78,989)** | **87,141,548** | **Overlapping** |

The earlier PR descriptions and first version of this note used the cumulative
`token_count` event instead. That counter omitted the usage record for one
compaction response in B, D, E and F; B's interval subtraction also missed its
first response. The earlier B–F sum was 86,125,872, lower by 1,015,676 tokens.
The revised per-response sum is the better record of model work for these
boundaries. PR-local numbers should be reconciled during review; neither
counter is a billing invoice.

Cached input was **97.96% of input**. This means matching prompt prefixes
were reused at the provider's cached-input rate; it does not mean the agent
re-read the repository 98% of the time, or that 98% of tokens were free.
The reported input total adds the prompt length at *each* model response; it
is not the number of distinct source tokens encountered.
Prompt prefixes include instructions, tool definitions, conversation history,
and prior file and tool results. A long ongoing conversation can therefore
produce many cached input tokens from a modest amount of source material.
[OpenAI's prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
explains the prefix behavior, while its
[usage guide](https://developers.openai.com/api/docs/guides/agents-api/observability)
distinguishes cached input from output and reasoning. The logged counters do
not provide actual billed dollars. Model rates, cache pricing, and any billing
adjustments must come from billing records; a token total alone cannot establish
whether the work was expensive in money.
Under an illustrative 0.1x cached-read input rate, the 85.11 million cached
tokens plus 1.78 million uncached tokens correspond to about **10.29 million
standard-input-token equivalents** before output, cache writes or model-specific
rates. This shows why the raw 87.14 million total is a poor bill estimate; it is
still substantial model work, and the actual charge remains unknown.
Reasoning used 78,989 tokens, or 31.4% of the 251,408 output tokens, whereas
input accounts for more than 99% of the logged token total. Reasoning token
count is not a measure of thinking time.

## Why the total grew

- **The prompt accumulated across many responses.** C–F began near 19,000
  input tokens per response. Their median response inputs were about 161,000,
  151,000, 143,000 and 158,000 tokens respectively; peaks were about 194,000,
  225,000, 229,000 and 217,000. B was already an ongoing session and began
  this interval at about 122,000. The roughly 19,000-token initial response
  precedes most task-specific file reads; logs do not divide that baseline
  among instructions, tool definitions and inherited task context. Each later
  response pays for its then-current prompt, even when most of that prompt is
  cached. The resulting sum is much larger than the repository files read once.
- **Tool results and decisions stayed in the conversation.** Each session
  received about 0.34–0.83 MiB of tool-result text across its calls, including
  source excerpts, tests, CI and PR output. Earlier results can recur in later
  prompts. The logs show sharp drops from over 217,000 to roughly 18,000–20,000
  input tokens in D–F, consistent with a context reset or compaction; they do
  not establish which mechanism caused each drop.
- **Repair loops added responses and elapsed time.** D made 180 responses and
  included a watchlist omission, two-browser dispatcher coverage and a CI timing
  repair. F made 141 responses and included browser fixture timing repair.
  Their PRs document the actual fixes. Re-running checks and revisiting code
  after feedback naturally extends the session and the prompt carried forward.
  Matched outer tool-call spans totaled about 19, 24, 12 and 19 minutes for
  C–F respectively. Those spans include waiting and wrappers and need not sum
  to critical-path time; B's background full check makes its 1.6-minute span
  especially incomplete. The logs do not provide a trustworthy decomposition
  of elapsed time into inference, checks, CI and human review.

## A smaller case: this retrospective's PR

[PR #109](https://github.com/IvoryHeart/herdr-world/pull/109) used an ongoing
`gpt-6-sol` session at `xhigh` reasoning effort. Through its first draft handoff,
48 response records used 4,601,218 input tokens, including 4,499,584 cached;
output was 33,642 tokens, including 14,632 reasoning, for 4,634,860 total.
Reasoning was 43.5% of this PR's output; its effect on elapsed time cannot be
isolated without a comparable lower-effort run.
The first PR description used the cumulative counter and omitted a compaction
response, reporting 4,450,298; this has been corrected in the PR body.

The first response for this task already had 142,351 input tokens. Before
compaction, 22 responses used 3,656,027 input tokens; a flat 142,351-token
prompt over those 22 responses would itself account for 3,131,722 (85.7%) of
that amount. After compaction, the next response fell to 21,367 input tokens,
and the following 26 responses used 945,191 in total. This identifies the
inherited long conversation as the strongest immediate lever for this PR.
It does not prove the savings from starting a fresh session, which would need a
concise handoff and some rereading.

Through that same draft handoff, the task made 46 tool calls whose returned
text totaled about 162 KB. The largest three responses were two web results
and a combined PR-body read,
totaling about 73 KB. Matched outer tool calls occupied about 16 seconds in
the local log, versus roughly 12.5 minutes of wall time. The same-window,
model-wide Prometheus `increase` estimate was roughly 13 minutes of
`gpt-6-sol` inference; its scrape window and missing session label prevent a
precise attribution. These measurements suggest model generation and repeated
context dominated different parts of this documentation PR: model generation
occupied most measured time, and repeated context drove the token count. Full
checks and CI also matter for the implementation packages.

Suppressing all successful tool output would hide source, review and failure
evidence. A more precise change is to request only the needed sections or
structured fields: for this PR, the combined pull-request bodies and broad web
results were larger than the formatter result. Keep complete check logs outside
the prompt, then return a short success line or the failing excerpt.
In a rough classification of B–F tool calls by command text, check/test calls
returned about 0.47 MB of roughly 3.4 MB of tool-result text. Mixed batched
calls make that estimate imprecise, but it shows that check-output trimming
alone cannot remove most new tool text, much less the inherited prompt prefix.
This draft documentation PR also ran formatting checks after several small
edits; one final check would have been sufficient. Repeated status waits added
agent turns without advancing the code. Future coordination should let assigned
agents work asynchronously and consume their final reports once available.

## What review exposed

The first review pass left ten inline comments across #104–#108.
They concentrate on transitions and failure handling: an early RPC rejection
releasing a concurrency slot while sibling calls remain live; invalidation
during an in-flight snapshot; checkout data changing during a Git query; SSH
cleanup rejection; optional agent observation; a full watch registry; and
keyboard focus after a resource action. Later passes exposed three more
within-deadline invalidation and pane-only identity gaps. Green full checks
had not exercised all of these combinations. The latest reviews report these
findings resolved, but the initial session and time figures exclude most
repair work. The review comments came from the PR author's account; they do
not constitute the repository's required independent approval. The owner
explicitly waived that requirement for #104–#108 before merge.

The #105 cleanup review repair gives a first measurement of that additional
cost: 14 model responses used 2,768,108 tokens, including 2,765,061 input.
Its first response already had 194,531 input tokens; holding that prompt length
flat across 14 responses would account for 2,723,434 input tokens (98.5% of
the observed repair input). This was an ongoing agent session, so even a small
focused fix replayed a large prior context. The repair figures are separate
from the initial C row above.

The stacked branch shape also affects wait time. A full check is required for
each ready implementation PR, and a review repair or changed parent tip makes
an earlier result insufficient as final evidence. Running focused checks while
the parent is moving, then one full gate on each final PR tip, avoids duplicate
full gates without weakening the ready-PR requirement.

In the final repair pass, #104 needed an extra push and CI run for a formatting
fix that a focused pre-push format check could have caught. The review agent
also reran focused suites after green CI on earlier heads; those runs did not
surface another failure. Five updated PRs then ran full CI at
once; #109's unchanged Chrome handoff test timed out after 35 seconds despite
passing on its previous head. Concurrent load is a plausible cause, not a
proven one. Avoid passive CI polling and duplicate local gates; inspect the
result when a merge or repair decision is due, and investigate a specific
failure before requesting another run.

Parallel delivery also exposed a shared-file merge cost. After #105 merged,
#106 conflicted only in the `CHANGELOG.md` Unreleased Added section; its code
and specification edits merged automatically. The repository requires each
user-facing PR to add an entry and then its PR link, so unrelated branches
edit adjacent lines and can conflict at integration. Resolving that conflict
required a new #106 merge commit and CI run. For this batch, retain both
entries and verify the combined branch. If this recurs, consider per-PR
changelog fragments assembled into the release changelog, including a clear
rule for links and release preparation. That would change the current
changelog workflow and should be judged against the frequency and cost of
real conflicts before adding tooling.

The later stack integrations also needed a knowledge-map row reconciliation
for #107 and a real Office/Tree toolbar reconciliation for #108: watch controls
and visual Actions both changed the toolbar composition. Both controls must
remain visible, as they already do together in Graph. Those source conflicts
are a separate cost of parallel feature work and warrant focused review and
final combined CI; changelog fragments would not solve them.

For work crossing async or UI boundaries, turn the changed invariant into a
small set of concrete cases before the final full gate: in-flight invalidation,
partial failure, replacement identity, fallible cleanup, optional upstream
data, capacity errors and post-action focus where applicable. These cases come
from the actual review misses; they need not become a new generic checklist or
another required document.

## Documentation and instrumentation audit

The shared startup reading set (`AGENTS.md`, `README.md`,
`docs/agent-development.md`, `docs/knowledge-map.md`) is about 16 KB of text.
The four active-change Markdown files for these packages range from about 9 to
22 KB per package. The World-surface contract was about 47 KB on the #103 base
and about 53 KB later in the package stack, so it can be a substantial single
read. The applied skill files are under 1 KB each. These
materials can add to prompt size, especially if agents read broad contracts or
repeat large excerpts, but their size alone cannot explain 150,000–229,000
tokens on a later response. The existing
[knowledge map](knowledge-map.md) already tells agents to read only relevant
rows. The stronger opportunity is to locate the relevant requirements within
a large spec and read those sections first, then widen the read when the change
crosses boundaries. Do not omit contract review merely to reduce tokens.

The TypeScript and TSX under `server/src/` and `web/src/` total about 172,000
lines and 5.49 MB, including tests. Large files such as `web/src/App.tsx` (4,329 lines),
`web/src/store.ts` (4,030) and `web/src/world/WorldFoundationApp.tsx` (1,998)
increase navigation cost. The whole repository would exceed one model context;
printing it all would also crowd out the specific invariant under review.
Targeted search and local excerpts are appropriate. Splitting a large file may
help when it gives state or ownership a clearer boundary, but this audit does
not establish a token-saving refactor by file size alone.

The local Prometheus endpoint exposes `codex_turn_token_usage_sum` and
`codex_tool_call_duration_ms_milliseconds_sum`. Their visible labels distinguish
models, token types and tool categories, but contain no repository or session ID.
Consequently they corroborate global activity, not a precise B–F cost or timing
breakdown. The collector runs outside the model prompt; collecting telemetry
does not itself put metric samples into context. Querying telemetry through a
tool does create a tool result, as any investigation does. There is no evidence
here that instrumentation caused the 98% cache ratio; its own runtime overhead
cannot be isolated from these aggregate metrics. Per-session
[tracing](https://developers.openai.com/api/docs/guides/agents-api/tracing)
or billing exports would be needed for exact attribution.

## Changes to try and measure

1. Use the [PR template](../.github/pull_request_template.md) to record model
   roles, parent, workflow pattern, exact measurement boundary, input/cached/
   uncached/output/reasoning tokens, elapsed time and actual billed cost when
   available. Write `unknown` rather than inferring dollars. Include every
   participating agent if a PR has several; avoid silently counting only one.
   Sum per-response usage so compaction calls are included.
2. Start an independent task in a fresh agent session with a short handoff when
   the existing conversation is already large. Treat a focused review repair
   similarly: carry the relevant comment, invariant, diff and check result into
   a concise handoff instead of replaying the whole implementation transcript.
   For long cohesive changes, consider a phase handoff before a near-full
   context window. Compare response count, fresh input, cached input, elapsed
   time and defects before making
   resets routine; a reset may require costly rereading.
3. Search the knowledge map and relevant spec headings before printing a large
   contract or source file. Capture full check logs outside the prompt and
   inspect failing sections first, retaining complete logs for diagnosis.
4. For future attribution, record a privacy-safe session/PR correlation in
   trace or billing exports if the toolchain supports it. Keep paths, commands,
   repository contents and user data out of telemetry labels and PRs. Measure
   inference, tool and check wall time separately before optimizing latency.
   Compare model and reasoning-effort choices on similar bounded tasks before
   declaring one setting cheaper or faster.
5. If per-PR usage remains manual, add a small optional, read-only summarizer
   for `token_usage_record` entries within an explicit session/time boundary.
   Report aggregates and compaction counts without prompt text, file paths or
   raw tool output. It should reduce the counting errors found here without
   becoming a new PR gate or agent supervisor.
6. Track changelog-only conflicts during parallel delivery. Keep the current
   direct `CHANGELOG.md` edits for now; if they recur, trial per-PR fragments
   with one release-time assembly step and compare the added process with the
   merge/recheck work it replaces.

These are measurement and reading changes, not reasons to weaken tests, review,
or the product contract.

## Next process review

After roughly five more agent-assisted PRs or at release preparation, compare
the new PR records with this baseline: per-response tokens (including compaction),
first and median prompt size, model and reasoning effort, elapsed time split by
model/tools/checks where available, repeat full gates, and review repairs. Trial
fresh repair sessions and stable-parent final checks before making either a
permanent rule. Record the result as a short dated decision, and change
`docs/agent-development.md` only when the measured practice proves useful.
