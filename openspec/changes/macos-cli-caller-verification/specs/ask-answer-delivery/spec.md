## ADDED Requirements

### Requirement: Ask refusal and lost reply remain distinct

The CLI SHALL preserve an ask refusal's code, reason and exit status without
sending a fallback owner alert. Ask JSON SHALL distinguish confirmed recording
(`recorded: true`), confirmed rejection (`recorded: false`) and an unknown
recording outcome after a lost reply (`recorded: null`).

#### Scenario: World refuses an ask

- **WHEN** World returns a refusal, including unavailable caller verification or
  a wrong CLI token
- **THEN** human output names that refusal and the CLI exits 3
- **AND** JSON retains `code: refused`, `recorded: false`, `notified: null` and
  the service's reason without a fallback alert

#### Scenario: A transport reply is lost

- **WHEN** the CLI cannot receive or decode World's recording reply
- **THEN** it reports `recorded: null`, `code: unavailable` and exits 1
- **AND** the existing single fallback alert describes recording as unconfirmed
- **AND** it never claims that World rejected or failed to keep the question

#### Scenario: Confirmed recording fails or succeeds

- **WHEN** World reports a recording failure with `recorded: false` and
  `code: unavailable`
- **THEN** the existing single fallback alert retains `recorded: false` and exit 1
- **WHEN** World confirms `recorded: true`, even without a confirmed owner alert
- **THEN** the CLI preserves that evidence and never adds a fallback alert
