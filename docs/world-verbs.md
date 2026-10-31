# Service verbs and actor policy

The service owns one static [verb registry](../server/src/verbs/registry.ts) for
browser RPC, agent CLI commands and the browser's GitHub pull-request actions.
Adapters cannot add actor permissions. An unknown browser method is refused before
runtime acquisition; it is never forwarded to Herdr as an extension command.

Each declaration contains TypeBox input and result schemas, required capabilities,
preconditions, recovery class, actor policies, acknowledgement flags and evidence
stages. Legacy extension fields and owner-specific coercion/filtering remain
supported. Schemas describe those existing boundaries; the namespace owners still
validate domain payloads, current terminal witnesses, paths, capabilities and
target state. Native selector fields remain optional where Herdr accepts an implicit
selection. This migration adds no queue or automatic retry.

The actors are the owner's authenticated browser, verified and unverified agent
CLI callers, Ranger, reconcilers and automation. At these migrated public entries,
browser verbs allow only the browser; CLI verbs allow only the appropriate CLI
actors. Ranger and reconcilers retain their existing internal entry points, and
automation has no public grant. Their separate action/resource catalogs are not
exposed by this migration.

| Existing operation | Policy preserved |
| --- | --- |
| Browser RPC | Allow after listener authentication and origin admission |
| CLI reads and ordinary World edits | Allow for both CLI actors, with existing target/ownership checks |
| CLI ask answer/withdraw and spawn claim | Verified pane required; existing asker/session checks still apply |
| CLI desk move | Acknowledge with `--herdr` |
| CLI add to a projected Room/Desk | Resolve its owner, then acknowledge with `--herdr` |
| CLI exclusive role replacement | Acknowledge with `--replace --yes` |
| CLI one-time Pod import and World group deletion | Acknowledge with `--yes` |
| Herdr move that would close a room | Existing move planner requires `--allow-close-room` |
| Browser PR merge, close, ready | Owner's browser confirmation |
| CLI forge actions and Herdr deletions | Refused |

The browser still performs its existing PR confirmation flow. The service has no
fresh, single-use confirmation challenge from the browser, so the authenticated
action request remains the existing confirmation boundary. Adding such a challenge
needs a browser change; this backend migration does not invent one or change the
owner's workflow.

RPC admission checks registry membership, schema and socket authority before
resolving a runtime, then rechecks the captured runtime before dispatch. Native
forwarding checks again immediately before socket send. Agent CLI checks flags
before caller-identity acquisition, resolves the pane as today and checks its actor
again before executing. Conditional native group policy uses the resolved owner;
its existing preview, witness and room-closure checks remain authoritative.
The request's live admission check travels through native sends, queued Board
work and ledger mutation callbacks. Stopping the CLI service revokes it even
while the captured runtime lease stays current; resumed work cannot make a new
native dispatch or World mutation. Answer recording checks again after recipient
resolution and when its queued ledger mutation runs.

Recovery follows the actual handler effect. `terminal.scroll` is `opaque`
because its page-key branch can send PageUp/PageDown bytes to an application.
PR status (`git.pull_request`) and pane/terminal link resolution are `read`.
`file.reveal` is `opaque`: launching the host file manager has no decisive
recovery read. These declarations do not enable automatic retries.

## Result evidence

Shared RPC replies and agent CLI replies add `command_evidence`. Terminal/settings
success replies also carry it. Existing result payloads and browser presentation
remain unchanged. The evidence is deliberately conservative:

| Stage | Evidence needed |
| --- | --- |
| `accepted` | In-memory admission only; this is the default for legacy handlers |
| `stored` | A receipt for a committed durable ledger record |
| `sent` | Native dispatch acknowledged on the named connection and generation |
| `observed` | An explicit observation identifier; a successful send alone never establishes it |
| `refused` | Admission or policy refusal |
| `failed` | A handler failure without a claim of observed effect |
| `uncertain` | Native interactive dispatch may have reached the named runtime without acknowledgement |

Durable CLI asks, answers, results and changes can report `stored` after the
committed store supplies their record receipt. Test/in-memory stores cannot infer
that stage from a successful return. Direct native mutation replies can report
`sent`; losing acknowledgement for opaque input reports `uncertain` and does not
retry. This migration does not maintain a new command-status store or correlate
legacy replies with later observations. It therefore never manufactures an
`observed` result, and a legacy handler returning `accepted` does not assert that
its underlying effect stayed in memory.

## Compatibility evidence

The P4 [policy table](../server/src/verbs/policy-baseline.json) enumerates every
migrated verb × actor. The [CLI characterization](../server/src/verbs/compatibility.test.ts)
replays all 31 existing commands for verified and unverified callers against
outcomes recorded from the implementation before this migration. Existing command,
group, source, terminal and service suites retain the deeper semantic checks.
The [browser call inventory](../server/src/verbs/policy.test.ts) parses production
call expressions and refuses a missing registration. Dynamic Ranger RPC names are
enumerated explicitly in the static table.
The [CLI authorization schedules](../server/src/world/world-cli-authorization.test.ts)
hold native reads/sends, snapshots and ledger callbacks across stop with a current
lease. [Recovery consumers](../server/src/verbs/recovery.test.ts), dispatcher link
resolution and the actual endpoint page-key/link tests check the declared classes
against their handler paths.

Run the focused boundary suite with `bun run test server/src/verbs/`. See
[the behavioral contract](../verification/contracts/verb-policy.md) for the
scope, negative controls and independent acceptance boundary.
