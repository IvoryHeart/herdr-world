# Launch preparation and first-run recovery assessment

## Requirements before mapping

[Core startup](../../openspec/specs/herdr-core-runtime/spec.md) must preserve
saved/explicit connection choices and publish discovery only after its save.
[Claude launch preparation](../../openspec/specs/world-usage/spec.md) must finish
before creating a tab or starting an agent. Failure must be visible and retry
must not start another agent merely because settings publication succeeded.
Allowed: failure before or after atomic file publication, then retry; concurrent
equal-content cache preparations; stale runtime retirement before actual launch.
Forbidden: an unsaved default reported as saved, partially written settings used
for launch, mutated user settings, or a preparation failure creating an agent.

## Cheaper complete checks for the preparation boundaries

First-run initialization loads saved/explicit choices synchronously, performs
presence-only discovery, then has exactly one asynchronous effect: the profile
save. The two new `first-run.test.ts` cases cover failure before and after that
publication and retry/reload. Existing cases cover saved, explicit, installed
TUI, invalid registry, missing runtime, core lock/executable and platform choices.
There are no independently completing runtime starts inside discovery. Multiple
offline writers racing startup are covered separately by the
[registry ownership protocol](connection-registry.md#saved-connection-registry-ownership)
and its real-process consumers; initializer tests alone do not establish exclusion.

The Unix TUI settings cache is a different file from the host-wide limits
observation: it contains only generated, content-addressed immutable bytes.
For two preparations with equal hashes every write/rename order publishes the
same bytes; distinct hashes name distinct files. Unique temporary names plus
atomic rename eliminate partial final content. `claude-launch-settings.test.ts`
checks simultaneous real subprocesses, exact contents, private modes, symlink
replacement and before/after-publication failure followed by retry. Native
canonical-PTY local/SSH transport tests check the long tap as actual input.
These checks cover the meaningful preparation interleavings more directly than
another state model of immutable byte publication. Power loss, hash collision
and authenticated harness/platform acceptance are not proved.

Core shell entry changes executable lookup/argv transport, not runtime ownership.
`shell.test.ts`, `operations.test.ts` and the existing framed-core adapter test
literal arguments, early failure and native readiness. Q17/Q52 and their existing
creation/core models retain launch/retirement/uncertainty obligations. The cache
does not prove downstream agent readiness; preparation success is not launch
success. No model is added for shell syntax or OS environment propagation.
