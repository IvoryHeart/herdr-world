# Agent and project memory: service contract

Issue #1012 delivers the model, host readers, service, RPC and CLI. The browser's
Library (issue #1027, [features](../FEATURES.md#the-library)) presents it in Town,
Board and agent settings. Both Herdr TUI and herdr-core use the same calls.
Types are in [`shared/memory.ts`](../shared/memory.ts); adapters are in
[`server/src/memory/adapters.ts`](../server/src/memory/adapters.ts).

## Try without preparing data

From the checkout, run:

```sh
bun server/src/index.ts memory demo --json
```

The installed command is `herdr-world memory demo --json`. This testing-only
fixture uses temporary synthetic files and the real memory service/worker. It
starts no server and needs no connected agent. Expect `shared_agents:["p1","p2"]`,
`stale:true`, `created:"created"`, `updated:"updated"`, `deleted:"deleted"`,
`stale_revision:"conflict"`, `unconfirmed_delete:"refused"`, `truncated:true`,
`entry_count:512` and `cleaned_up:true`. `opencode_sources` lists the project and
user `AGENTS.md` with descriptions and `startup-candidate` timing;
`unsupported_sources:0` proves the unsupported-only project contributes nothing.
The directory is removed even on error.

For real, read-only inspection against a running World service:

```sh
herdr-world ls --json
herdr-world memory list --connection CONNECTION_ID --generation GENERATION --json
herdr-world memory search 'decision' --connection CONNECTION_ID --generation GENERATION --json
herdr-world memory read --connection CONNECTION_ID --generation GENERATION --source SOURCE_ID --path note.md --json
```

Use the `connection_id` and `connection_generation` from a `current:true` entry
in `ls`, then a `source.id` and entry `path` from memory list. A workspace's ID
is the existing World workspace/room ID; an agent's ID is its pane/terminal ID.
`--workspace ID`, `--agent ID` and `--harness NAME` filter list/search. Harness
names are listed in `herdr-world memory --help` and the adapter table below.
Filters preserve the source's full sharing associations within the bounded view.

For explicit management, `create` and `update` take `--file INPUT.md` and
`--user-action`; update also needs `--revision REVISION` from a fresh read.
`delete` needs `--revision REVISION --user-action --yes`. A file source accepts
only its basename; a directory source accepts relative Markdown names. Creates
can add missing source directories. Adding/deleting a Claude topic does not
rewrite its `MEMORY.md` index; manage that index explicitly too. No action edits
other entries, harness configuration or memory enablement settings.

CLI service calls use the existing loopback-only bearer-token endpoint
`POST /api/world/cli` with `{command:"memory ACTION",params:{...}}`. Browser
Origin requests are refused there; browsers use the normal authenticated World
WebSocket. CLI output is always JSON. Exit codes remain 0 success, 1 unavailable
or unknown outcome, 2 invalid arguments, 3 refused/conflict/too large, 4 not found.
The error text begins with the memory error code.

## Discovery and load evidence

Sources come from fresh live workspace/terminal topology. A project's path is
its checkout/cwd, or its first terminal's cwd when a room has no checkout; each
agent's own foreground cwd overrides that project's path for its candidates.
Sharing means sources have the same absolute path **on this connection**.
Source IDs hash that path and are stable across reads; qualify them with the
connection ID. IDs are not capabilities: each call discovers ownership anew.

| Adapter | Sources |
| --- | --- |
| Claude | User `CLAUDE.md` and rules; ancestor `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and `AGENTS.md` fallback candidates; project `.claude/rules`; project auto-memory `MEMORY.md` and topic files; project/user named subagent memory directories |
| Codex | User and repository-root-to-cwd `AGENTS.override.md`/`AGENTS.md`; Markdown under `memories` and `memories_v2` |
| Pi | User and ancestor `AGENTS.md` |
| OpenCode (`opencode`) | Global `~/.config/opencode/AGENTS.md` and ancestor `AGENTS.md`; documented Claude compatibility fallbacks |
| GitHub Copilot CLI (`copilot`) | Personal `copilot-instructions.md` and `instructions/**/*.instructions.md`; ancestor `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`; root/cwd `.github/instructions` |
| Cursor (`cursor`) | Root `AGENTS.md` and `CLAUDE.md`; `.cursor/rules/**/*.mdc` (plain `.md` rules are ignored) |
| Qwen Code (`qwen`) | User `QWEN.md`, project `QWEN.md`, `AGENTS.md`, `.qwen/QWEN.local.md`; user/project `.qwen/rules`; user `~/.qwen/memories` |
| Droid (`droid`) | User `.factory`, `.agents`, `.agent` and ancestor directories, including those context folders: `AGENTS.md`, `agents.md`, `Agents.md`, `CLAUDE.md`, `Claude.md` |
| Kimi (`kimi`) | Root-to-cwd `AGENTS.md` and legacy `.kimi/AGENTS.md`; current `.kimi-code/AGENTS.md`, user `.kimi-code/AGENTS.md`/`SYSTEM.md` and shared `.agents/AGENTS.md`; version/template decides use |
| oh-my-pi (`omp`) | Ancestor `AGENTS.md`; native user `.omp/agent` and ancestor `.omp` context/system files, `RULES.md`, `rules` and `instructions`; profile and nearest nonempty directory decide use |
| Kilo (`kilo`) | Global `~/.config/kilo/AGENTS.md`; ancestor `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`; global Claude fallback before migration |
| Hermes (`hermes`) | User `SOUL.md`, `memories/MEMORY.md` and `memories/USER.md`; ancestor `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md` context-type candidates |
| Qoder CLI (`qodercli`) | User `~/.qoder/AGENTS.md`, ancestor `AGENTS.md`, `AGENTS.local.md`, `.qoder/rules`; optional user `.qoder/memory` |
| Antigravity CLI (`antigravity-cli`) | Ancestor `AGENTS.md`, `GEMINI.md`, `.agents/AGENTS.md`, `.agents/GEMINI.md`, immediate `.agents/rules/*.md`; global `.gemini` instructions and `.gemini/config/rules` |
| Devin (`devin`) | User `~/.config/devin` and workspace `AGENTS.md`, `AGENTS.local.md`, `AGENT.md`, project `CLAUDE.md` and user Claude compatibility; observed subdirectory candidates load on demand |
| Mastra Code (`mastracode`) | Project root, `.claude`, `.mastracode` and user `.claude`, `.mastracode`, `.config/claude`, `.config/mastracode` instruction candidates; first location wins, `AGENTS.md` before `CLAUDE.md` |
| Grok (`grok`) | User `.grok` and ancestor compatible instruction filenames; `.grok/rules` and `.claude/rules` Markdown candidates |

Only observed agents whose harness has an adapter contribute sources. A project
with no such agent has no sources, even if an `AGENTS.md` exists on disk. Empty
projects do not synthesize every adapter's sources. The API still reports
unsupported agents explicitly; the Library omits unsupported hosts, projects and
agents from its choices, entry points and Town sign rather than showing zero
memories. Supported agents keep missing-source shelves and their creation actions.

For browser acceptance, open the preview with `?memoryFixture`, choose **Town** →
**Library**, then **opencode-app** (on a phone, use the reader picker). Its project
and user instructions have descriptions and load at start; **opencode-builder**
shows both in its startup list. **no-memory-app** and its unsupported agent are
absent from the picker. Open a fresh page with `?memoryFixture=unsupported` to
simulate an unsupported-only host: Town has no Library sign or ring entry, Board
has no Library hub entry, and Settings/search omit Library. Both parameters are
removed immediately; reload to return to real topology. Neither fixture reads
real files or starts agents.

The worker uses the owning host's `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and
`PI_CODING_AGENT_DIR`, plus `XDG_CONFIG_HOME`, `COPILOT_HOME`, `HERMES_HOME`,
`QWEN_HOME` and `KIMI_CODE_HOME`, never the service computer's home for an SSH
connection. Other harnesses expose their documented default roots; per-process
profiles and additional config locations are not inferred.
Claude's default project key uses the main repository path, including linked
worktree `commondir` metadata. A user `autoMemoryDirectory` or safe
`CLAUDE_CODE_PROJECT_DIR_NAME` overrides it. No repository-supplied path override
is followed. New harness support is one adapter emitting the common source model
and an entry in the shared capability registry (`shared/memory.ts`); a regression
keeps them aligned.

Sources are **candidates for a future load**, not a snapshot of an agent's
already-loaded context. The service does not read another process's environment,
expand imports, custom fallback names, additional roots, project settings or
trust policy, interpret path-scoped rules, or toggle memory. `warnings` preserves
these limits. Unknown harnesses appear in `unsupported`. Nonempty Codex overrides
shadow the matching `AGENTS.md`; Claude instructions can shadow its fallback.
`entry.harness_loads` reports this separately for each harness sharing a file.
OpenCode's `AGENTS.md` shadows its same-scope Claude fallback. Rule
folders describe conditional loading; bounded scalar frontmatter recognizes
Cursor/oh-my-pi `alwaysApply`, Qwen `paths` and Antigravity `trigger` without
interpreting globs or expanding imports. Other rule applicability stays with the
harness. `load` is the coarse default timing; `harness_loads` refines it. Claude
topic files are on demand, while `MEMORY.md` is a startup candidate. Nested subagent
folders remain on demand; their configuration determines the actual reader.

Harness load budgets differ from World's editing budget: Codex's default
instruction chain is 32 KiB, and Claude's auto-memory index has a 200-line/25 KB
startup limit. Larger entries can be editable here without being fully loaded.
Codex generated recall can overwrite manual edits. Databases, transcripts,
binary stores and skills are outside this v1's Markdown model. `.mdc` rules are
readable and searchable with the same limits and filesystem refusals, but remain
read-only in the CLI/API/Library; management still accepts only `.md`. Cursor
rules offer no Markdown creation action because Cursor ignores that extension.
Opaque per-project auto-memory keys (Qwen/Qoder), custom instruction globs/URLs,
non-Markdown legacy rule files, foreign oh-my-pi providers, Hermes profiles/other
context types, Kilo configured rules and Antigravity plugin/legacy rule roots are
not expanded in this slice. Reload or restart in the harness to use changed
instructions.

These defaults follow [Claude's memory documentation](https://code.claude.com/docs/en/memory),
[Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [Codex local memory storage](https://learn.chatgpt.com/docs/customization/memories).
Each adapter cites its maker's documentation in its code comment. Letta's
[MemFS](https://docs.letta.com/configuration/memory) requires agent-owned memory
identity not present in observed topology; no filesystem adapter is invented.
Mastra Code observational memory is database-backed and excluded; its documented
Markdown instructions are supported. Third-party memory systems remain outside
this slice.

## RPC calls for #1027

All six methods are bridge-global: put `connection_id` and
`connection_generation` **inside params**, with neither at the outer envelope.
Use the generation observed in `connections.list`, `world.snapshot`, or CLI
`ls`; no default connection or generation is inferred. For example:

```json
{"id":"m1","method":"world.memory.list","params":{"connection_id":"box","connection_generation":7}}
```

Replies use `{id,result}` or `{id,error:{code,message}}`, plus the standard
`command_evidence`. Read replies repeat their target. Examples below are
synthetic; identifiers are illustrative and paths are private response data.

| Method | Params in addition to connection ID and generation | Result |
| --- | --- | --- |
| `world.memory.list` | Optional `workspace_id`, `agent_id`, `harness` | `MemoryCatalog`: metadata, sharing, entries, warnings, limits, truncation |
| `world.memory.search` | `query`; optional same filters | Literal case-insensitive line matches, entry metadata, scanned bytes, skipped count, truncation |
| `world.memory.read` | `source_id`, `path` | Complete UTF-8 `content`, opaque `revision`, bytes, modification time |
| `world.memory.create` | `source_id`, `path`, `content`, `user_action:true` | `status:"created"`, new revision; existing entry conflicts |
| `world.memory.update` | Same, plus current `revision` | `status:"updated"`, new revision |
| `world.memory.delete` | `source_id`, `path`, current `revision`, `user_action:true`, `confirmed:true` | `status:"deleted"`, `revision:null` |

List result example (one-source excerpt; a real catalog includes every selected
source, including missing sources that can be created):

```json
{
  "connection_id":"box", "connection_generation":7, "observed_at":1800000000000,
  "projects":[{"id":"w1","label":"Example","path":"/workspace/example"}],
  "agents":[{"id":"p1","project_id":"w1","harness":"codex","path":"/workspace/example"}],
  "sources":[{
    "id":"111111111111111111111111", "harnesses":["codex"],
    "kind":"memory", "scope":"user", "path":"/users/example/.codex/memories",
    "shape":"directory", "load":"on-demand", "description":"Generated v1 recall",
    "details":{"codex":"Generated v1 recall; per-chat controls decide use"},
    "project_ids":["w1"], "agent_ids":["p1"], "state":"available"
  }],
  "entries":[{
    "id":"222222222222222222222222", "source_id":"111111111111111111111111",
    "path":"note.md", "size":10, "modified_at":1799999999000,
    "age_ms":1000, "stale":false, "state":"available", "load":"on-demand",
    "harness_loads":{"codex":{"mode":"on-demand"}}
  }],
  "unsupported":[], "warnings":["Candidates are not loaded-context receipts"],
  "truncated":false,
  "limits":{"projects":32,"agents":128,"sources":256,"entries":512,"depth":4,
    "file_bytes":262144,"search_bytes":2097152,"search_results":100,"query_chars":200,
    "stale_ms":2592000000,"timeout_ms":15000}
}
```

`source.state` is `available`, `missing` or `refused`; `reason` explains refusal.
`entry.state` is `available` or `refused` (with `too_large` or `unsupported_file`).
`stale` is only an age hint, never a judgment that a remembered fact is wrong.
`harness_loads[HARNESS].mode` is `startup-candidate`, `on-demand`, `shadowed` or
`empty`; a shadowed entry supplies a reason. `project_ids` and `agent_ids` are
the current sharing edges; do not invent edges across connections.

Search request/result example; each match carries the complete entry metadata
from list (abbreviated here):

```json
{"id":"m2","method":"world.memory.search","params":{"connection_id":"box","connection_generation":7,"query":"synthetic","workspace_id":"w1"}}
```

```json
{"connection_id":"box","connection_generation":7,"query":"synthetic","matches":[{"entry":{"id":"222222222222222222222222","source_id":"111111111111111111111111","path":"note.md"},"line":1,"excerpt":"Synthetic memory."}],"scanned_bytes":18,"skipped":0,"truncated":false}
```

Read request/result example:

```json
{"id":"m3","method":"world.memory.read","params":{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"note.md"}}
```

```json
{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"note.md","content":"Synthetic memory.\n","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":18,"modified_at":1799999999000}
```

Create request/result example:

```json
{"id":"m4","method":"world.memory.create","params":{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"new.md","content":"New memory.\n","user_action":true}}
```

```json
{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"new.md","status":"created","revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

Update request/result example:

```json
{"id":"m5","method":"world.memory.update","params":{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"new.md","revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","content":"Revised memory.\n","user_action":true}}
```

```json
{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"new.md","status":"updated","revision":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
```

Delete request/result example:

```json
{"id":"m6","method":"world.memory.delete","params":{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"new.md","revision":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","user_action":true,"confirmed":true}}
```

```json
{"connection_id":"box","connection_generation":7,"source_id":"111111111111111111111111","path":"new.md","status":"deleted","revision":null}
```

`user_action` must follow an explicit save/add/delete action. Present deletion
confirmation with the selected path and sharing before sending `confirmed:true`.
Never autosave, delete on browse, copy contents into Board elements, or retry a
write automatically. Refresh after success and discard results whose connection,
generation, selection or request has changed. Existing browser RPC rejects with
the error message; memory messages include their code prefix as well as the raw
wire `error.code`. Keep content and search excerpts out of logs and telemetry.

## Limits and refusals

Unix and Python 3 are required on the owning host. Each host request has a
15-second deadline; discovery needs two requests and search needs three. Allow
up to 60 seconds for a client call. At most eight service requests are active or
queued. Mutations serialize per connection; reads remain independent. There is
no background scan, persisted content cache or search index.

Only regular UTF-8 Markdown files with one link are supported. Every path
component is opened without following symlinks. Absolute entry names, traversal,
special files, hardlinks, symlinked sources and files over 256 KiB refuse. New
directories/files use private permissions; updates preserve existing permission
bits and atomically replace the file. Creates never overwrite. Revisions include
file identity, metadata and content, so replacing a file with identical text
still invalidates the old revision. Advisory directory locks coordinate World
writes; external tools do not share those locks, so revision checks are not a
filesystem-wide transaction against an editor writing at the exact commit instant.

Discovery scans at most 32 projects, 128 agents, 256 sources, 512 entries and
2048 directory items; recursion is four levels below a source. Paths under
already-observed ancestor chains are bounded to 32 ancestors. Search takes a
nonblank query of at most 200 characters, stops at 2 MiB/100 matches, returns
1-based line numbers and excerpts of at most 240 characters, and counts refused
or changed entries as skipped. Count/byte/depth limits set `truncated`; missing
and refused sources retain their own states. Partial catalogs never justify a
claim that no other memories or sharing agents exist.

Memory service errors use `invalid`, `unavailable`, `not_found`, `refused`,
`conflict`, `too_large` or `uncertain`. Admission can also reject malformed
parameters/absent acknowledgements before the service, with the standard RPC
error message. Example conflict:

```json
{"id":"m5","error":{"code":"conflict","message":"conflict: Memory changed; read it again before editing"}}
```

On conflict, read again and ask the person to reconcile. On `uncertain`, timeout,
disconnect or changed generation after a save, reacquire the exact connection and
read before deciding whether another write is needed. A failed host is never
answered with cached topology, the service host's filesystem or another connection.

The tutorial and first-run README steps remain accurate: no visual or first-run
flow changes. Acceptance is exercised with focused filesystem, routing, admission,
CLI and synthetic-demo tests; no browser behaviour is added by this item.
