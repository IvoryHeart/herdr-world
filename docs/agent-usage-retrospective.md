# Agent usage retrospective: World packages B–F

This records the 25 September 2026 delivery of the next World packages in
[PRs #104–#108](https://github.com/IvoryHeart/herdr-world/pulls). It is a
measurement of those agent sessions, not a cost report or a budget for future
work. The pull requests remain the source for each package's exact scope and
verification.

## What was measured

The agent session logs report token usage per model response. Input includes
cached input; output includes reasoning output; total is input plus output.
Reasoning is a subset, so adding it to output or total would double count it.
The figures below cover the recorded session or interval through each PR
handoff. B is an interval in an ongoing primary-agent session and includes a
small amount of C coordination. C–F are fresh subagent sessions. Wall time is
the elapsed session window, not active model time; the windows overlap, so
their sum is not the calendar time for the overall delivery.

The primary agent delivered B and delegated C–F as bounded package assignments.
The branch shape was B and C from the merged #103 main; D stacked on B; E
stacked on C; F stacked on E. Each package used an isolated worktree, focused
checks, a full repository gate, and a PR handoff. Parallel assignment shortened
calendar time, while the stacks meant later packages depended on earlier branch
heads and carried their context into review and checks.

| Package / PR | Model responses | Input | Cached input | Uncached input | Output (reasoning subset) | Total | Wall window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [B / #104](https://github.com/IvoryHeart/herdr-world/pull/104) | 124 | 13,026,559 | 12,858,368 | 168,191 | 60,802 (33,278) | 13,087,361 | 27 min |
| [C / #105](https://github.com/IvoryHeart/herdr-world/pull/105) | 101 | 14,513,988 | 14,263,040 | 250,948 | 36,567 (10,372) | 14,550,555 | 30 min |
| [D / #106](https://github.com/IvoryHeart/herdr-world/pull/106) | 180 | 24,129,925 | 23,723,264 | 406,661 | 59,350 (11,551) | 24,189,275 | 54 min |
| [E / #107](https://github.com/IvoryHeart/herdr-world/pull/107) | 100 | 13,636,350 | 13,335,808 | 300,542 | 38,168 (7,970) | 13,674,518 | 27 min |
| [F / #108](https://github.com/IvoryHeart/herdr-world/pull/108) | 141 | 20,579,356 | 19,951,616 | 627,740 | 44,807 (15,194) | 20,624,163 | 42 min |
| **Sum** | **646** | **85,886,178** | **84,132,096** | **1,754,082** | **239,694 (78,365)** | **86,125,872** | **Overlapping** |

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
Under an illustrative 0.1x cached-read input rate, the 84.13 million cached
tokens plus 1.75 million uncached tokens correspond to about **10.17 million
standard-input-token equivalents** before output, cache writes or model-specific
rates. This shows why the raw 86.13 million total is a poor bill estimate; it is
still substantial model work, and the actual charge remains unknown.
Reasoning used 78,365 tokens, or 32.7% of the 239,694 output tokens, whereas
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
  The logs do not provide a trustworthy decomposition of elapsed time into
  inference, waiting for tools, checks, CI and human review.

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
2. Keep prompts bounded by one coherent package and make a short handoff after
   a completed phase or before a near-full context window. Compare response
   count, fresh input, cached input, elapsed time, and defects before making
   session resets routine; a reset may require costly re-reading.
3. Search the knowledge map and relevant spec headings before printing a large
   contract or source file. Capture full check logs outside the prompt and
   inspect failing sections first, retaining complete logs for diagnosis.
4. For future attribution, record a privacy-safe session/PR correlation in
   trace or billing exports if the toolchain supports it. Keep paths, commands,
   repository contents and user data out of telemetry labels and PRs. Measure
   inference, tool and check wall time separately before optimizing latency.

These are measurement and reading changes, not reasons to weaken tests, review,
or the product contract.
