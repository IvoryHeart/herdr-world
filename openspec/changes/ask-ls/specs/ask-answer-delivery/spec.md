## ADDED Requirements

### Requirement: Caller-scoped question listing

World SHALL support `herdr-world ask ls [--json]` through its existing CLI endpoint,
using the common listing flags and output conventions of `result ls`. It SHALL
list the verified calling terminal's retained questions, newest first by creation
time, with newest insertion first for equal timestamps. Each entry SHALL expose
its ID, state, nonnegative age in milliseconds and the question's first line.
Open, answered and withdrawn questions SHALL be included without a state filter;
existing owner dismissals SHALL retain their dismissed state. Withdrawal SHALL
take precedence over an earlier answer or dismissal.

Listing ownership SHALL reuse question withdrawal's immutable connection and stable
terminal identity, including its stricter fallback for legacy identities. An
unverified caller SHALL be refused. Listing SHALL NOT mutate questions, acknowledge
answers, publish ledger changes or send owner alerts.

#### Scenario: Find an open question and withdraw it
- **WHEN** a verified agent asks “Proceed?” and runs `ask ls`
- **THEN** its new question appears with its ID and open state
- **AND** after it withdraws that ID, `ask ls` includes the same ID as withdrawn

#### Scenario: Another terminal or connection lists questions
- **WHEN** a verified caller lists questions after its runtime or session restarts
- **THEN** it still sees its original terminal's questions
- **AND** questions belonging to another terminal or connection are excluded

#### Scenario: Listing output and empty history
- **WHEN** the caller lists its questions interactively or with `--json`
- **THEN** output follows `result ls`'s line-per-object or JSON reply-envelope form
- **AND** an empty interactive list prints `(none)`

### Requirement: Quiet refusal of command-word questions

The CLI and server SHALL refuse a whole question consisting only of an ask
subcommand or `ls`, `list`, `get`, `answer`, `withdraw` or `help`, ignoring case
and surrounding whitespace. Refusal SHALL provide a hint naming the appropriate
command, create no question and send no owner alert, including a CLI fallback
alert. Valid explicit subcommands SHALL retain their normal behavior; `ask help`
SHALL point to `ask --help` without asking a question. Ordinary questions and
multiword text containing these words SHALL remain valid.

#### Scenario: A listing word is mistaken for a subcommand
- **WHEN** an agent runs `herdr-world ask list`
- **THEN** it receives a usage refusal pointing to `herdr-world ask ls`
- **AND** neither a question nor an owner alert is created

#### Scenario: Flags or direct endpoint calls cannot bypass refusal
- **WHEN** a command word is supplied as question text after flags or directly to the CLI endpoint
- **THEN** the same quiet refusal applies before question recording or notification
