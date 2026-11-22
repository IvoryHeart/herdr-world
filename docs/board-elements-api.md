# Board element data API

Issue #1016 supplies the data contract; Board's own screens (#1030: cards,
**Add to Board** and the reader, in `web/src/world/board/elements/`) use exactly
these calls. Use the existing authenticated World
WebSocket RPC or the local `herdr-world` CLI. No new HTTP listener is needed.
Browser methods have the prefix `world.board.elements.`. Every method below
returns its result in the normal RPC `{id,result}` envelope; malformed requests
use the normal `{id,error}` envelope. The CLI uses the existing loopback,
bearer-authenticated `POST /api/world/cli`, with
`{"command":"board element list","params":{}}`, for example. Its JSON output is
`{"ok":true,"actor":{...},"result":{...},"command_evidence":{...}}`.

## Registry and existing kinds

`types` takes `{}` and returns every built-in type plus the enforced limits:

```json
{"types":[{"kind":"memory","renderer":"memory","source":"memory-library-or-project-files","actions":["read","edit","move","remove"],"placement":"element"}],"limits":{"count":500,"id":128,"title":200,"path":1024,"text":16000,"url":2048,"readBytes":65536,"directoryEntries":32,"concurrentReads":8}}
```

The example shows one entry; the real response contains all eleven. This is a
closed typed registry in `shared/boardElements.ts`, with no registration endpoint,
plugin loading, executable renderer or network embed protocol. `renderer` is a
semantic key for the UI. `actions` describe supported capabilities; they do not
authorize a call. Normal verb admission still applies.

| Kind | Source | Existing operation / presentation seam |
| --- | --- | --- |
| `host`, `workspace`, `tab`, `pane` | `world.snapshot` | Existing native topology, Inspector and layout operations |
| `note` | `world.board.get` → `notes` | Existing `note.put`/`note.delete`, strings and explicit send |
| `string` | `world.board.get` → `strings` | Existing `string.put`/`string.delete` |
| `work` | Existing World work sources | Existing work cards and forge actions |
| `memory`, `log`, `document`, `link` | Saved `elements` | The calls below |

Existing kinds report `placement:"existing"`; keep their current acquisition and
actions. Only `placement:"element"` kinds use `put`. An Add picker can enumerate
the whole registry and route each kind to its existing or new creation seam.
Source descriptors are semantic identifiers, not RPC method names.

## List, create, edit, move and remove

`list` takes `{}`. Example result:

```json
{"revision":1,"elements":[{"id":"plan","kind":"document","title":"Release plan","x":120,"y":80,"rev":1,"source":{"text":"Check the release criteria."}}]}
```

`put` takes `{element,rev?}`. Omit `rev` only for a new ID. To edit or move,
submit the complete element with the last returned `rev`; changing `x,y` moves it.
Example request:

```json
{"element":{"id":"plan","kind":"document","title":"Release plan","x":120,"y":80,"source":{"text":"Check the release criteria."}}}
```

Example result (the full existing Board document is returned):

```json
{"status":"saved","document":{"version":1,"revision":1,"layout":{"anchors":{},"offsets":{},"pinned":{},"folded":[],"colors":{},"desk_pins":{},"room_pins":{},"interest":{},"group_interest":{}},"notes":[],"strings":[],"relations":{"spawns":[],"groups":[]},"elements":[{"id":"plan","kind":"document","title":"Release plan","x":120,"y":80,"rev":1,"source":{"text":"Check the release criteria."}}]}}
```

`delete` takes `{"id":"plan","rev":1}`. Example result after removal:

```json
{"status":"saved","document":{"version":1,"revision":2,"layout":{"anchors":{},"offsets":{},"pinned":{},"folded":[],"colors":{},"desk_pins":{},"room_pins":{},"interest":{},"group_interest":{}},"notes":[],"strings":[],"relations":{"spawns":[],"groups":[]}}}
```

Both writes persist through the existing Board transaction and publish
`world_board_changed` only after commit. A stale write returns
`{"status":"conflict","message":"...","document":{...}}`, with current state.
Keep the draft and ask the user to reconcile. Revisions are opaque positive
integers; they need not be consecutive per element. Removing and recreating an
ID cannot admit an old edit. Deleting a reference leaves its file or URL intact.
These writes have revision conflicts but no CLI history/undo in v1.
`world.board.get` also includes optional `elements`; generic `world.board.patch`
accepts `{op:"element.put",element,rev?}` and `{op:"element.delete",id,rev}`.

## Sources and reads

Each element has `id`, `kind`, `title`, `x`, `y` and a typed `source`:

| Kind | Example source | v1 behavior |
| --- | --- | --- |
| `memory` | `{"connection_id":"studio","workspace_id":"project-a","path":"memory"}` or `{"connection_id":"studio","workspace_id":"project-a","memory_source_id":"source-example","path":"build-notes.md"}` | Read a project file or browse a memory directory; omitted path defaults to `MEMORY.md`. Or reference a Library memory: the source ID and entry path from `world.memory.list` (`herdr-world memory list`), with the project it was chosen from optional. Board does not read a Library memory itself; see below. |
| `log` | `{"connection_id":"studio","workspace_id":"project-a","path":"logs/finished-agent.jsonl","agent_ref":"session-example","apartment_id":"resident-example"}` | Read an explicitly selected saved log/transcript as text, including JSONL. No live pane lookup. `agent_ref` is optional descriptive session/agent identity; `apartment_id` optionally names the Apartments resident it belongs to. Neither grants authority or changes what is read. |
| `document` | `{"text":"Draft"}` or `{"connection_id":"studio","workspace_id":"project-a","path":"docs/plan.md"}` | Inline text is editable here. File-backed content is read through Files; the element API does not edit files. |
| `link` | `{"url":"https://github.com/example/project/pull/42"}` | Store an inert HTTP(S) target. Classify GitHub PR/issue URLs; do not fetch, resolve redirects, run forge actions or return iframe HTML. |

`read` takes `{"id":"memory","connection_generation":7}` for a project source,
or just `{"id":"plan"}` for inline text/links. Obtain IDs and the current
generation from World's existing connection/snapshot APIs. The saved connection
ID is immutable routing intent; a read must name its current generation after
reconnection. Neither the default host nor cached failed-host topology is used.
Herdr TUI and herdr-core use the same Files handlers and response contract.

Example file result:

```json
{"status":"ready","element":{"id":"memory","kind":"memory","title":"Memory","x":0,"y":0,"rev":3,"source":{"connection_id":"studio","workspace_id":"project-a","path":"MEMORY.md"}},"target":{"connection_id":"studio","connection_generation":7,"workspace_id":"project-a","path":"MEMORY.md"},"content":{"type":"text","text":"Remember the release criteria.","truncated":false,"size":30,"mtime_ms":1000}}
```

Inline docs have the same text content shape without `target`, `size` or
`mtime_ms`. `target` supplies the existing Files/Inspector selectors. A log read
has the same text shape and retains its optional `agent_ref` in `element`.
For a memory directory, the content is, for example:

```json
{"type":"directory","entries":[{"name":"decisions.md","type":"file","size":120}],"truncated":false}
```

Read a child using `{"id":"memory","connection_generation":7,"path":"decisions.md"}`.
Child paths are relative to the saved memory directory and may traverse its
subdirectories, but cannot traverse upward or escape the project through symlinks. Each listing contains at most 32 entries;
`truncated:true` explicitly reports more. There is no directory pagination in v1;
an explicitly known child path remains readable. Log/document sources must be files.
A link read instead has content:

```json
{"type":"link","url":"https://github.com/example/project/pull/42","link_kind":"pull_request","fetch":false}
```

`link_kind` is `url`, `pull_request` or `issue`. The UI owns presentation and
explicit navigation. Render text as content, never executable HTML.

A Library memory read (`{"id":"notes"}`, no generation needed) makes no host
read. Its content points at the memory service, which owns discovery, refusals
and its generation fence:

```json
{"type":"library","connection_id":"studio","memory_source_id":"source-example","path":"build-notes.md","read_with":"world.memory.read"}
```

Read it with `world.memory.read` (`herdr-world memory read`) on that
connection's current generation; Board's reader does so and shows at most the
same 64 KiB. Board's reader opens the Library there with **Open in Library**.

A log's apartment is the resident named by `apartment_id`, else the one whose
harness session ID or resident ID equals `agent_ref`, from `world.apartments`
on the log's own connection only. Board's reader opens it with **Open
apartment**; a named resident that has moved out of Apartments leaves the
action unavailable, never re-pointed to another resident.

## Limits and refusals

There are at most 500 new elements, subject also to the existing whole-Board
size and writer queue limits. IDs use letters, digits, `_`, `-`, `.` (128
characters); titles are 200, relative paths 1024, inline text 16,000 and URLs
2048 characters. Positions are finite, within ±10,000,000. Reads return at most
64 KiB of UTF-8 text without splitting codepoints. At most eight source reads
run concurrently per service. Reads use the bounded Files preview, not an
unlimited transcript import. Content is not cached in Board or automatically sent
to an agent. Credentials in URLs, non-HTTP(S) schemes, absolute paths, traversal,
backslashes, control characters in paths and symlink escapes are refused.

Source outcomes are data results, for example
`{"status":"unavailable","reason":"source_unavailable"}` or
`{"status":"refused","reason":"generation_required"}`. Other reasons:
`missing_element`, `not_text`, `not_a_file`, `busy`, `changed_or_unavailable`.
The latter includes offline/stale generations and changes during a read; retry
only after refreshing the element/connection. Filesystem errors omit absolute
paths. Invalid writes are RPC errors; conflicting writes are the explicit
conflict result above. CLI source/conflict refusals exit 3, unavailable sources
exit 1, parser errors exit 2; `--json` retains structured results.

## CLI try steps

With the candidate service already running, execute:

```sh
herdr-world board element types --json
herdr-world board element put document crew-1016-plan --title 'Release plan' --text 'Check the release criteria.' --at 120,80 --json
herdr-world board element list --json
herdr-world board element read crew-1016-plan --json
```

Expect all eleven registry kinds, a saved record, then its text. Copy the returned
element `rev` into `board element delete crew-1016-plan --rev REV --json` to remove
it. No file editing or rare runtime state is needed.

For a successful project-source read, first discover the selectors:

```sh
herdr-world ls --json
```

Example output (actor omitted):

```json
{"ok":true,"result":[{"connection_id":"studio","label":"Studio","generation":7,"current":true,"workspaces":[{"workspace_id":"project-a","label":"Project","tabs":[]}]}]}
```

Choose a `current: true` connection row and one of its workspaces. Copy that
row's `connection_id` and `generation`, and the workspace's `workspace_id`.
`generation` is the connection's current runtime generation, not the generation
of cached topology; `current: false` rows are not actionable. For the candidate
checkout workspace, use its existing `FEATURES.md` as a test memory source:

```sh
herdr-world board element put memory crew-1016-memory --title Memory --connection studio --workspace project-a --path FEATURES.md --json
herdr-world board element read crew-1016-memory --generation 7 --json
```

Replace `studio`, `project-a` and `7` with the values from the same `ls` row.
Expect `status: "ready"`, `content.type: "text"` and the beginning of the project's
`FEATURES.md`; the target repeats the selected connection, generation, workspace
and relative path. The same discovery works for logs and file-backed documents.
Copy the saved element's `rev` into `board element delete crew-1016-memory --rev
REV --json` to clean up. For normal memory use, omit `--path` to read `MEMORY.md`.

If the runtime reconnects between listing and reading, refresh `ls --json` and
use the new generation for the same connection. Never choose a different
connection to work around a refusal. Reading without `--generation`
deterministically demonstrates `generation_required` (exit 3). No new testing
switch is needed.
