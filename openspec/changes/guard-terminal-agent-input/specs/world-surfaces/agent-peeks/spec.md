## ADDED Requirements

### Requirement: Peek replies check the foreground program

Town and Board peek replies and answer keys SHALL use World's shared foreground-program check on the exact qualified pane. A stale agent label SHALL NOT bypass that check.

#### Scenario: The agent exits before the owner replies

- **WHEN** the owner replies or picks an answer in a peek after its pane's foreground becomes a refused program
- **THEN** no input is typed, no success is announced, and Not sent offers Copy with the original reply or answer key
- **AND** copying does not retry input or redirect to another pane or host

#### Scenario: The foreground admits input

- **WHEN** the peek's qualified pane passes the shared foreground check
- **THEN** replies retain their requested Enter behavior and single-key answers do not add Enter

#### Scenario: Safely preview refusal after routing

- **WHEN** the owner opens `/?agentInputGuard=refused` in a preview connected to real agents
- **THEN** World captures and removes the testing switch before routing to `/town`
- **AND** peek replies, answer keys and review-feedback prefill refuse with Copy recovery and zero runtime sends for the page's lifetime, including after further view navigation
- **AND** reloading the cleaned URL restores ordinary delivery
