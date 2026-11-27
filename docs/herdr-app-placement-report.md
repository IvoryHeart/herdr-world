# Upstream report: labelled terminals split into separate Android spaces

Prepared for forwarding; this report has not been posted upstream.
World issue: [#1435](https://github.com/IvoryHeart/herdr-world/issues/1435).

## Observation

The owner reported on 2026-11-27 that Herdr's Android **Spaces** lists each
`crew-<issue>` terminal as its own space, with no common Crew space. Native
records have `herdr.space=crew`, distinct `herdr.tab=crew-<issue>` values and
`where=Crew / crew-<issue>`. World and `hc ls` agree on their placement.
The Android app's product/build version was not supplied; no Android app was
available to reproduce its rendering during this investigation.

## Expected contract

Herdr's [app skill source](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/SKILL.md)
and [installed guide source](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/defaults/AGENTS.md)
say an unknown space/tab ID is adopted. In the desktop implementation,
`reconcile` / `adopt` group by those labels, without a UUID requirement or a
pre-existing layout entry. Two records sharing `herdr.space=crew` therefore
describe one space with two tabs. A consumer which instead groups by terminal,
tab ID or worktree folder would disagree with that contract.

The space need not be displayed as **Crew**: names belong to the app's layout;
`where` is a caption. The separate request for a supported external naming
mechanism is still open in [app #43](https://github.com/herdrdev/herdr-app/issues/43).
No extra `herdr.space.name` or `herdr.tab.name` label is currently documented.

## Minimal reproduction

Use a disposable core, with its own home, XDG state/config/runtime directories
and all inherited `HERDR_*` / `HC_*` variables cleared. Do not run these commands
against a person's default core. On that isolated core:

```sh
hc run --bg --keep --name first \
  --label herdr.space=crew --label herdr.tab=crew-first \
  --label 'where=Crew / First' --label herdr.seen=0 -- /bin/sleep 600
hc run --bg --keep --name second \
  --label herdr.space=crew --label herdr.tab=crew-second \
  --label 'where=Crew / Second' --label herdr.seen=0 -- /bin/sleep 600
hc get first --json
hc get second --json
```

Point the app under test at **that same disposable core** and open **Spaces**.
Expect one space with two tabs. Its default name may be the first terminal's
folder; a different default caption alone is not the grouping failure. The
reported Android failure is two spaces, one per terminal. Capture the app's
version and actual space/tab IDs with that result, including whether it already
had a saved layout. Also check a fresh layout: adoption and reconciliation of
previously placed terminals may be different paths in the affected client.

After the app check, close that disposable app connection, kill `first` and
`second` on the isolated core, stop only that core, and remove its scratch state.

## Executed evidence and World/dispatcher handoff

- The CLI reproduction above was run on an isolated **herdr-core 0.1.21**:
  both native records retained `herdr.space=crew`, distinct tab IDs, captions,
  `herdr.seen=0` and `keep=true`. No app document was created.
- `server/src/herdr-core/core.live.test.ts` additionally runs two real World
  launches into one World room, reads the native labels, moves both desks to
  another room, and confirms shared space IDs, distinct tabs and unchanged
  program identities. Scratch processes and state are removed afterwards.
- `server/src/herdr-core/operations.test.ts` pins launch labels in World-owned
  and app-owned rooms. `server/src/herdr-core/town-moves.test.ts` pins two desk
  moves into Crew, preserving unrelated labels and shared-desk membership.
- World's production grouping writes already match the published contract.
  No app-owned layout write, new storage or view workaround was introduced.
- The dispatcher should retain `herdr.space=crew`, one `herdr.tab=crew-<issue>`
  per desk, `where=Crew / crew-<issue>`, `--keep`, and initial `herdr.seen=0`.
  Existing matching terminals need no relabelling for grouping. Naming and the
  reported Android grouping need upstream work, not speculative labels.
