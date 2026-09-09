# Native workflow trial history

The native workflow is now the default. Use [agent-development.md](agent-development.md)
for current instructions. This page records the experiment that preceded retirement
of Ralph; its former local override and fresh-session requirement are retired.

The pinned input was Superpowers 6.3.0 with Codex 0.153.4. Discovery verified fourteen
unchanged upstream skills, six repository-adapted OpenSpec skills and exclusion of
twelve legacy workflows. Discovery made no model calls and did not certify the
running conversation. One Sol/high read-only brainstorming activation took 86 seconds
and recorded 192,253 input tokens (156,416 cached) and 2,213 output tokens. It proved
one activation path, not delivery quality.

PR82, PR83 and PR84 delivered through native execution. PR83 exposed a model-allocation
mismatch and an unnecessary full check after attribution-only edits. PR84 reused that
attribution evidence and retained its implementer, but created six review histories.
One external review cycle found two layout defects, repaired before merge.

| Workload | Recorded task time | Input tokens | Output tokens | Outcome |
| --- | --- | ---: | ---: | --- |
| Original Ralph Tree attempt | Approximately four hours | 125,533,851 | 267,339 | Interrupted |
| PR82 native feature | 73m27s | 50,291,224 | 148,377 | Delivered |
| PR83 native feature | 29m39s | 11,192,857 | 41,539 | Delivered |
| PR84 native feature and corrections | 126m38s | 48,794,042 | 164,220 | Delivered, corrected and merged |

Native rows include the lead and descendants, excluding separately launched preparation
and external review. Input includes cached tokens. Tasks, models and environments differ;
the original interrupted run has lower-bound usage coverage. These are operational case
studies, not a controlled benchmark or a monetary-savings claim. PR84 used Sol/high for
all 444 native feature responses. Including its preparation and external review gives
142m49s of non-overlapping active intervals, 52,100,975 input (50,514,432 cached) and
187,864 output tokens. Human/review scheduling gaps are excluded from active intervals.

The owner selected native execution after these deliveries. This supports retiring unused
runtime machinery, not claims of hands-off reliability, crash recovery, automatic Oracle
selection or superiority of the newer mixed-model defaults. Retained private journals
support the measurements. Historical Ralph findings remain under docs/evidence/.
