# Acceptance checks with isolated runtimes

Use this kit for checks against real Herdr TUI and herdr-core. It starts both
runtimes and a loopback World from this checkout, with new state, scratch harness
configuration and a private instance registry. It does not install or update
runtimes, register login services, or attach to existing sessions. No shared
preview is needed.

Requires Linux with readable `/proc`, Python 3.9+ with pidfds, Bun, `herdr` and
`herdr-core` on PATH. Unsupported isolation fails before launching. Run from the
checkout you are testing:

```bash
bun install --frozen-lockfile
# Only needed for browser checks; generated assets stay untracked.
bun run build:web
bun run runtime:isolated start --name acceptance
bun run runtime:isolated status --name acceptance
```

The JSON prints the World URL, TUI session/control/render sockets, core state and
socket, scratch Claude/Codex folders and versions. `kit.json` inside the printed
run folder records those versions (including the World source commit and installed
harness versions). Save the command output with your check evidence before stop.
The World source commit identifies the checkout baseline; uncommitted changes are
also used by the running service.

Open the printed URL in a separate browser profile. Run the printed `login`
command and paste its output into World's password field. In **Town**, check the
Kit TUI room and core's unplaced terminals; in **Manage connections**, both
runtime entries should be connected. Keep this World attached to its generated
connections. The listener uses a free ephemeral port; the kit refuses a port
range containing 8787/8788.

## Start throwaway shells or real harnesses

`exec` runs an argv command in the kit's scratch working directory and sanitized
environment. Keep the wrapper on **every** runtime command; commands entered in a
kit terminal already inherit that environment. Never substitute an owner's
socket, state folder or World address. This isolates runtime/configuration state,
not arbitrary filesystem access by commands you choose to execute.

```bash
# TUI: read the returned root_pane.pane_id; use it instead of PANE below.
bun run runtime:isolated exec --name acceptance -- \
  herdr workspace create --label acceptance-shell --no-focus
bun run runtime:isolated exec --name acceptance -- \
  herdr pane run PANE 'printf "acceptance ready\n"; exec /bin/sh'

# Core: the response supplies the terminal address for later read/send/keys.
bun run runtime:isolated exec --name acceptance -- \
  herdr-core run --bg --name acceptance-shell --no-parent --no-notify /bin/sh

# Replace the shell with an interactive harness in a new scratch TUI pane.
bun run runtime:isolated exec --name acceptance -- \
  herdr pane run PANE claude
# Or create a separate core terminal for Codex.
bun run runtime:isolated exec --name acceptance -- \
  herdr-core run --bg --name codex-check --no-parent --no-notify codex --no-alt-screen
```

Use `herdr pane read PANE` and `herdr pane send-keys PANE Enter` through `exec`
for TUI dialogs. Core equivalents are `herdr-core read ADDRESS` and
`herdr-core keys ADDRESS enter`. To interact directly in your current terminal,
use `bun run runtime:isolated exec --name acceptance -- claude` or the equivalent
`codex --no-alt-screen`; this checks harness setup without placing it in a runtime.

Both runtimes inherit the kit's `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
The kit creates those folders empty, apart from a Codex configuration selecting
`cli_auth_credentials_store = "file"` so login stays in scratch storage, and
disabling Codex's startup update check. See the
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Do not copy the owner's authentication, plugins, hooks or configuration. No API
keys, runtime variables, shell startup variables or credential environment is
inherited. If authentication is needed, log into a permitted test account inside
the scratch configuration; stopping the kit deletes that login too.

With the tested Claude Code 2.1.330, choose **Auto** or a theme with the arrow keys
and **Enter**, then select the permitted subscription/Console login method and
complete its login flow. With Codex 0.171.0, select **Sign in with ChatGPT**,
**Sign in with Device Code**, or **Sign in another way** for a test API key, then
complete the displayed flow. After login, accept a folder trust dialog only for
the printed scratch folder. Do not disable permissions to skip onboarding.
The first-run login choices were checked without signing in; authenticated model
requests require test credentials and are not part of the shell self-test.
Future versions may change dialog labels: use the choices actually displayed by
`read`, then send the matching arrow/Enter keys. `idle` is not proof that an
unfamiliar onboarding dialog has completed.

## Stop, including after a crash

```bash
bun run runtime:isolated stop --name acceptance
bun run runtime:isolated status --name acceptance
```

Stop prints the number of processes removed and confirms folder removal. It
removes all run-owned processes (including terminal holders and harness children),
sockets, logs, scratch authentication and data folders. A second stop reports
`stopped`. The empty private `/tmp/world-kit-<uid>` coordination directory can
remain; it holds no run state or lock files. Do not delete it while a kit command
is running.

A durable manifest is written before any runtime starts. After a controller,
World or core crash, use the same name with `stop`; do not restart over its old
folder. Cleanup finds processes by a random run marker and ancestry rather than
saved PIDs or executable names. It freezes holders before killing processes via
pidfds, waits for exit events and checks that none remain before deleting state.
If ownership cannot be proved or cleanup fails, it refuses and retains evidence.
Concurrent kit control operations refuse immediately; a crashed controller
releases its kernel lock automatically. An interactive `exec` releases that lock
after launch so `stop` can still end it.

## Demand-only acceptance self-test

```bash
bun run runtime:isolated self-test --name acceptance
```

This is not an automatic CI test. It starts the kit, prints start/status evidence,
runs one throwaway shell terminal in each runtime and checks their exact native
addresses in World's fresh aggregate snapshot. Plain shells have no recognized
coding-agent entry: the test checks their pane/terminal rows. It then kills its
World to exercise crash cleanup, stops the run in `finally`, and checks zero
remaining processes and no run folder. Readiness uses filesystem and WebSocket
events with deadlines, not sleep/check loops. Missing runtimes or failed
observation fail the command and still clean up.

For owner-runtime evidence, read `herdr workspace list` and `herdr-core ls` in
the owner's **already running default** environment before and after the test.
Do not run core's CLI against a missing default socket: even reads can autostart
core. Compare stable workspace/terminal identities and placements, not changing
activity counters of other live agents. Keep raw owner output private; publish
only the comparison result and synthetic kit transcript. The self-test itself
never contacts those default runtimes.

## Runtime issues encountered

- **Herdr 0.9.5 overrides socket variables for named sessions.** The kit derives
  the actual named-session sockets under its private XDG config, validates real
  owned sockets and rejects Unix socket paths that are too long.
- **Core CLI observation can autostart a server.** Startup uses foreground
  `serve`; status reads the private `core.lock`, process environments and World
  health directly. No default runtime CLI is used by the kit.
- **Core holders can restart core after it crashes.** Cleanup freezes the whole
  owned process set, captures descendants, then kills and waits through pidfds.
- **Runtimes inject their own context.** Herdr supplies pane IDs and its binary
  path; core 0.1.21 supplies terminal IDs, `HC_RUNTIME`, `HC_SCOPE` and
  `HC_TERMINAL_SOCKET`. The kit clears all inherited `HERDR_*`/`HC_*`, supplies
  only its own endpoint settings, validates the narrow context list and requires
  the terminal socket to match its private core endpoint. Unknown runtime
  variables fail loudly rather than allowing a fallback.
- **Explicit World startup sockets can duplicate a saved TUI profile.** The
  generated registry uses World's `startup-default` identity plus `kit-core`,
  yielding exactly the two isolated connections.
- **Scratch harnesses start at onboarding.** The steps above reach login in
  clean configuration; no owner credentials or first-run records are reused.
- **The test runner adds its own runtime tripwire variables to subprocesses.**
  Unit fixtures strip those only inside inert sleep processes; production kit
  validation continues to reject unexpected variables.
