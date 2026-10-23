### Added

- Chat's tool rows show what each call did: a plain label ("Run reconnect
  tests", "Edit reconnect.ts"), how long it took, and a pass or fail badge for
  a test run. A run whose tests failed reads as failed, and a call cut off
  without a result reads as interrupted. Opening a row shows the edit's diff,
  a green or red test strip with the first failing test, or the end of its
  output, with credentials redacted.
