# Required runtime command runners

This bounded audit repairs the original queued-command retirement contract in
Roamgate transport PR #636. The integration base and frozen upstream target remain
unchanged. It supersedes the incomplete direct-adapter audit of the earlier repair.

## Ownership boundary

`createLegacyConnectionRuntime` constructs the text, exit-code, timed, binary and
input runners once for its immutable connection/runtime generation. Each binds
argv to that runtime's private master and retirement signal. Session acquisition
checks cancellation again after grant; the concrete process adapters check before
spawn and pass the signal to the child. Mutations are never replayed. Streamed
file search has the same explicit binding and held-session cancellation boundary.
No helper below chooses a module-global runner when its caller omits ownership.

## Required call-site inventory

| Helper boundary | Production caller and required capability | Shared retirement control |
| --- | --- | --- |
| Workspace file/Git handlers | Runtime construction passes code, input, binary and argv-binding ports to `createFileHandlers`. | Directory, upload, search, ignore, Git and local archive |
| `collectIgnoredNames` | File listing passes its bound input runner; the helper's optional/global default is removed. | Ignore: directory read completes, its slot is reserved, then the actual check-ignore input command waits. |
| `downloadLocalFile` directory archive | File download passes its bound binary runner; the helper imports no global process primitive. | Local archive waits at the real bound binary adapter before dispatch. |
| `uploadRemoteFile` | File upload requires the caller's input runner. | Actual workspace Files upload after its body is read |
| `searchWorkspaceFiles` | File search requires the runtime argv binder and checks the held-session signal at dispatch/completion. | Streamed file search |
| `inspectRuntimeWorkspacePath` | Browser RPC and Ranger actions supply the captured runtime; remote path inspection refuses a missing runner. | Remote path check |
| `createWorkspaceWorktree` / `syncWorktreeBase` | The shared worktree flow supplies the runtime code runner after its current-request guard. | Shared base-sync adapter, including its queued fetch |
| Git diff/actions/history/default-branch/baseline helpers | File handlers, hooks and auto-sync pass their required code runners or closures over those runners; none imports a global process primitive. | Git entry point plus the existing real Git/action/baseline consumers |
| `createStatusEnricher` | Runtime construction supplies its required timed code runner. | Background checkout status refresh |
| `createForwardRpcHandler` candidate scans | Runtime construction supplies its required text runner; both remote-host and service-host scans retain this owner. | Local and reverse candidate directions; local command waits at the real bound text adapter. |
| `probeLauncher` | Both launcher readiness and skills RPCs pass the captured runtime code runner; its global default is removed. | Readiness and skills discovery |
| `harnessReadiness` / `discoverSkills` | Launcher probe passes its required runner through; these helpers already require it. | Both launcher cases, including simultaneous readiness/skills commands |
| `enrichIntegrationVersions` | The integration-list RPC passes the runtime code runner before the helper awaits ping; its optional/global fallback is removed. | CLI version enrichment |
| Agent transcript/checkout/worktree adapters | Runtime construction supplies required binary/code runners; their remote branches do not select local process defaults. | Existing qualified transcript/worktree consumers; their protocol/state bounds are unchanged. |

The type checker enumerated omitted required ports in standalone file, ignore and
archive fixtures; those callers now provide their explicit test runners. Production
launcher and integration-list call sites also supply their captured runtime port.
The complete quick type check passes. The literal NUL in the old ignore cache key
is represented as `\0` without changing the runtime key; parsed TypeScript inventory
was used so text-search binary detection cannot hide a command import.

## Bounded control and exclusions

The one maintained table in
[`runtime-process.test.ts`](../../server/src/connections/runtime-process.test.ts)
has 14 helper paths with current and retired cases. Every retired case also queues
an independent sibling runtime before retirement. It asserts zero subsequent
dispatch from the stopped owner, continued sibling dispatch, and private-master
identity for every SSH child. It extends the independent ignore reproduction
rather than stopping the outer listing before that transitive helper is reached.

Module import reachability was checked from runtime construction, RPC dispatch and
the forward service. Pure session fingerprints/redaction and native spawn-stamp
helpers share modules with standalone CLI entry points; they do not invoke those
CLI command runners. Profile testing creates an independent, bounded temporary
tunnel before a live runtime exists. Tunnel, master and forward children have
explicit supervisors and owner/generation records, not helper-level command-runner
fallbacks. Their accepted cleanup and OpenSSH policy remain unchanged. Local
service update/installer/source-connector commands and explicit standalone CLI
commands are service/command operations, not substitutions for a runtime runner.

These consumers establish the named queue/dispatch ownership boundary. They do
not establish every parser or scheduler interleaving, native OpenSSH behavior,
live forwarding, model promotion or whole-system integration acceptance. Existing
contract models and mandatory platform consumers remain binding.

## Ranger/History continuation ownership

The local runtime's Claude continuation candidate enumeration uses its required
binary process runner and retirement signal. Remote enumeration uses that
connection's qualified SSH runner. The shared standalone local file adapter uses
filesystem reads only; it no longer starts a process. Both adapters parse bounded
top-level JSONL metadata in the service, preserve NUL-delimited candidate paths,
and refuse malformed or ambiguous provenance. The maintained runtime-process
table covers queued current, retired and independent owners; a separate control
checks cancellation of an already running local continuation child.
