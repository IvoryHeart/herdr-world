### Fixed

- Verify archives, npm and Homebrew before publishing; rehearse every channel without publishing and retry partial releases with the same verified files.

<!-- detail -->

- Verify archives, npm packages, the Homebrew Formula and tap acceptance inputs
  before publishing any release channel. Release rehearsals generate the complete
  candidate without publishing; partial publication retries reuse verified bytes
  and report each channel's status with a recovery command.
