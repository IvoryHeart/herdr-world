## Context

A terminal can outlive the agent that asked. Text prefixes do not make shell input safe. The owner's 2026-11-28 decision supersedes the earlier session matching, child analysis and PTY reader designs.

## Decisions

1. One shared check classifies only the runtime-reported foreground process group's leader by executable basename, ignoring arguments. It refuses shells, REPL interpreters, editors/pagers, ssh, sudo/su, database clients, tmux/screen/zellij and docker; other basenames deliver. Thus node/python script launchers are classified by their interpreter basename too.
2. Ignore children and MCP helpers. Remove all tty-reader code and input-specific /proc inspection. Existing topology discovery is unchanged and is not used by input admission.
3. TUI resolves the exact pane and selects the process whose PID equals the reported foreground group ID. Core uses terminal.get's foreground leader immediately before native input. Missing foreground information, including unsupported TUI process-info calls, skips this additional check and preserves prior behavior on macOS and remote hosts.
4. Existing immutable connection, generation and terminal qualification still apply. Explicit owner Terminal input retains its authority. A refused answer remains saved, is never automatically revived and offers Not sent, Copy answer, ask get and draft-only Terminal recovery in Reception.

## Evidence and limits

Isolated synthetic World/core/TUI transports and real World storage cover an agent exiting to bash before answer, dispatch and final input, with zero writes, Not sent and ask get retrieval on both runtimes. Finite executable/path matrices cover denied leader categories, ignored arguments and children, and missing-information compatibility. Existing runtime/effect models retain generation and opaque-recovery state spaces; the full verification gate remains required for changed contract owners. No new ordering model is needed for this stateless predicate.

A shell started inside a live harness is deliberately outside this check. A runtime without foreground information behaves as before this PR. Neither runtime makes the final OS foreground check and typing atomic; no live-platform or exactly-once guarantee is claimed.
