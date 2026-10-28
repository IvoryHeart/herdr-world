# PR 471 source-link repair captures

Source commit: `5dd8c154018ba4c66f335cbbccffb48ac5092753`.

These are unedited Chrome viewport captures of the committed synthetic
source-link fixture using the real World Chat and Inspector components.
Only capture pauses were injected into the fixture; production components were
unchanged. The worktree RPC returns fresh cloned observations, and file reads
are delayed across the Chat-to-Files refresh. Fixture assertions and the privacy
scan passed. Each pair shows Chat before activating **Open source**, then Files
in that same Inspector with line 12 highlighted. All fixture data are synthetic.

The five CSS viewports are 390 × 844, 1512 × 982, 1280 × 1440,
2560 × 1440 and 1440 × 2560. The manifest records dimensions and SHA-256 hashes.
These are component-fixture evidence, not live Herdr or native OS acceptance.
