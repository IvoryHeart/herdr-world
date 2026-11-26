## Design

Route `ask ls` through the existing World CLI endpoint and register it as a
verified-caller read. Reuse the question withdrawal ownership predicate: immutable
connection and stable terminal identity, with the existing strict fallback for
legacy records. Unverified callers are refused rather than sharing a list.

Read retained questions from the ledger without mutation. Sort by creation time
descending, breaking equal timestamps by newest ledger insertion. Return each ID,
state, nonnegative `age_ms` and first question line. Withdrawal takes precedence
over an existing answer; preserve the existing dismissed state honestly.
Use the same line-per-JSON-object terminal output, empty marker and machine reply
envelope as `result ls`. Its task filter has no question equivalent, and it has
no closed-state filter, so no new question-specific filters are introduced.

Share command-word hints between CLI parsing and server admission. Reject trimmed,
case-insensitive whole words, including the internal acknowledge verb. Explicit
subcommands still dispatch normally; `ask help` points to `ask --help`. Refuse
before the transport/fallback path locally and before ledger or alert work on
the server. Multiword questions and ordinary single-word questions remain valid.

## Verification decision

The read uses existing identity rules and adds no writer or asynchronous effect.
Extend the exhaustive 128 identity classes in the current ownership consumer,
covering both ID and key contexts, and test real CLI dispatch for both panes and
core terminals. Focused tests cover every reserved word, closed states, ordering,
read-only behavior and output parity. Existing verb × actor enumeration includes
the new read policy. A new Quint model would add no state transitions to explore;
run the complete verification gate because the verb-registry owner changes.

The owner/dispatcher supplies any preview. Worker checks use synthetic dependency
fixtures and isolated test storage; no World server or live runtime is started.
