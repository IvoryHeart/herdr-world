# Harness readiness evidence

**New agent** checks the executable and, where supported, the harness's own
login status on the selected host. This is evidence about a completed check,
not proof that a model request will succeed. **Check again** repeats it;
**Edit profiles** opens the existing harness/model configuration. A supported
harness remains available when its readiness is unknown.

- Only a complete executable lookup can say **Not installed on this host**.
- A recognized sign-out result offers **Log in**, which opens a tab and shows
  the native command for the user to run. World never types credentials.
- Transport failure, nonzero outer exit, timeout, missing/duplicate/incomplete
  sections or unreadable/oversized status cannot confirm absence or sign-out.
- If the executable was found but authentication could not be read, installation
  is known and login stays unknown. Pi and custom harnesses without a World
  status reader report that login checks are unsupported.
- Windows hosts do not run the POSIX probe. Their installation/authentication
  remain unknown and the UI identifies the unsupported check.

## Wire and admission

[The shared wire/parser](../shared/harnessReadiness.ts) is consumed by the service
and browser. Each row has `kind`, nullable `installed` and `logged_in`, optional
allowlisted `method`, `can_log_in`, and `probe`:

- `source`: `world-harness-probe`, identifying World's adapter rather than a
  model inference or account record;
- `state`: `ok`, `unknown` or `unsupported`;
- `reason`: a fixed code for completion, missing/malformed output, unreadable
  auth, unavailable auth check, process failure/timeout or unsupported Windows;
- `observed_at`: the World service's completion time in epoch milliseconds;
  null for missing/older/unreadable reply metadata. It is not an expiry promise.

A missing/older/malformed wire record normalizes to unknown in the browser.
The UI shows the safe source and time of the last check; it does not cache a
previous success as current after changing host or generation. Raw status text,
account IDs, key fragments, environment values and process errors are not returned.

Both `launcher.readiness` and `launcher.catalog` capture their runtime, SSH
host and platform before asynchronous discovery. They recheck admission after
manifest/pane discovery and after the probe. The existing connection reply
publisher stamps `connection_id` and `connection_generation` and rejects retired
results; a replacement runtime never inherits a delayed observation.

Claude's JSON boolean must agree with its recognized 0/1 status exit. Codex
requires a recognized complete status message and matching exit, not any
nonzero exit as sign-out or any zero exit as authenticated. Unknown/new output
formats remain unknown. An API key merely reported as configured is not proof
that a request authenticated. No auth stores are read by World. The
[Codex status implementation](https://github.com/openai/codex/blob/main/codex-rs/cli/src/login.rs)
is an upstream reference, not a promise that every installed version has the
same output.

Harness installation/authentication, World profile configuration and connector
enablement remain separate claims. This repair adds no installer, provider
framework, skill binding, MCP or marketplace flow.

## Verification boundary

Synthetic process/record tests check parsing, failures, privacy and Windows
non-execution. RPC tests check captured-host behavior and retirement through the
existing qualified publisher. Browser parser and static-markup tests check
unknown/retry/configuration wording and safe metadata. Existing runtime models
retain authority/lease coverage; no new model of native authentication is claimed.
Native harness versions, real SSH/account errors and five-viewport interaction
remain supported-platform/batch delivery acceptance, not proven by these fixtures.
