## Decisions

The pinned upstream app skill describes label adoption of terminals without
panes. `mirror::Document` and `mirror_sync` establish the machine-local
`herdr-app` document as the layout authority after adoption. `where` is written
by the desktop app, never read for names. The capability notes link sources.

Read `doc.get` on the existing framed connection after subscribing, and on local
app `doc` events and `missed` cuts. Project only spaces, names, folders, tab IDs
and terminal blocks (including nested containers/floats). Respect core's 1 MiB
limit and bound traversal; ignore unrelated document fields. Never write it or
persist a second copy. A missing document falls back to World placement and
labels. Invalid/unavailable reads retain the last observation for display but
refuse moves because app ownership is unknown.

The mirror's invalidation revision fences asynchronous replies. Coalesce reads;
a newer notification overtaking a read causes another read, with no timed retry.
Discard replies after runtime retirement. Terminal event ordering and the
existing lease/core/program fences remain unchanged.

The shared topology takes adopted membership first, then World's own placement,
then labels/ancestor placement. Names come from the app document; otherwise keep
World's existing folder/tab/agent derived-name memory. No caption is a naming
input. Every World view, float-shell room check and alert uses that projection.

World moves only unadopted terminals and rechecks app ownership before writes
and publication. Unknown ownership or an adopted source explains refusal in the
existing move result UI. Programs and unrelated labels remain unchanged.
A concurrent app adoption can still race a core label request: core has no atomic
cross-document/label condition. Stop later writes when observed; report partial
or uncertain outcomes using the existing move path, without rollback or retry.

Direct provider tests exercise app versus World authority, nested membership,
notification/recovery invalidation, overtaken replies, unreadable layouts and
move refusal. Isolated real-core readback pins two launches and moves; desktop
and phone rendering remain separate Q8 acceptance, never inferred from labels.
Run the full verification gate for Q52 consumers. No new model is justified:
the additional authority is a read-only membership predicate, checked directly;
existing composed-ordering/lease models cover the reused event and write fences.
