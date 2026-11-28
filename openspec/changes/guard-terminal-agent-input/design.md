## Context

A terminal can outlive the agent that asked. Text prefixes do not make shell input safe. The owner's 2026-11-27 decision supersedes the earlier original-session design.

## Decisions

1. One shared foreground program policy rejects shells, interactive REPLs, editors/pagers, ssh, sudo/su and database clients. It accepts every other program without recognizing an agent name or original session. Shells are classified by executable basename alone, whatever their arguments; this also refuses script/-c shell launchers. Multiplexers (tmux, screen, zellij) and nested shell launchers (docker and busybox) are refused. A refused tool child (ssh, interpreter (including scripts and stdin), database or privilege tool) under an admitted leader is temporarily busy: type nothing, say try again shortly and keep answers pending. Shell/editor/launcher children remain permanent refusals. Non-shell script interpreters and npm entrypoints remain allowed. Empty command lines are temporarily unavailable. Core supplies the leader first; TUI identifies it by foreground process group ID before applying the shared policy. Missing leader evidence fails temporarily closed.
2. The TUI transport resolves a named agent to an exact pane, reads pane.process_info and checks all foreground members immediately before World agent input. Async context distinguishes server-originated pane input from explicit owner Terminal input; it carries no agent/session identity.
3. Core reads terminal.get immediately before native input and checks its foreground plus locally readable foreground children with the same policy. A failed process read is unavailable, never a permanent refusal. Remote core exposes only the foreground information its protocol supplies; child inspection there remains an upstream limit.
4. Saved answers resolve the current program at the original terminal and immutable connection/generation. They do not compare original foreground PIDs, asking session or conversation session. The new TUI foreground witness and storage plumbing are removed. Existing caller identity still owns asks and acknowledgements; existing runtime tokens/fences protect in-flight operations and forbid terminal replacement or replay of possible sends.
5. Reception renders the authoritative plain reason and offers Copy answer, the full ask get command and draft-only Terminal recovery. No view derives admission.

## Evidence and limits

Isolated synthetic World/core/TUI transports with real World storage cover shell exit before answer, dispatch and final typing; zero writes to shell, REPL, editor/pager, ssh, sudo/su and database clients; foreground children; temporary tool children and empty/read failures; and admission of arbitrary/restarted agents, wrappers and npm scripts. Existing runtime/effect models retain generation and opaque-recovery state spaces. This changes a stateless admission predicate, so the finite program/input-path matrix covers that decision without adding a new state machine. Run the full verification gate for changed contract owners.

Neither runtime provides atomic OS foreground-and-type. Core cancellation on observed changes remains best effort; possible sends never automatically replay. Local process inspection requires a readable host process namespace. No live-platform or exactly-once guarantee is claimed.
