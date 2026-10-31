# Shared acquisition consumer evidence

The approved shared-acquisition change requires one observer per held runtime,
interest independent of operation authority, and notices compared with each
socket's received focused lists. The observer checkpoint delivers the service
observer and catalogue notices; the recency checkpoint below adds shared readings
and the browser maximum merge. The capability is not advertised yet, and browser
timer removal and shared Desk reads remain pending.

## Required properties and scenarios

- Two sockets holding one owner share one observation. Releasing one socket
  preserves the other's acquisition; the last release stops scheduling.
- Whole declarations replace interest atomically. Malformed input changes
  nothing, duplicates count once, and unknown or obsolete owners are ignored.
  Interest never starts or selects a runtime.
- A retired lease, released observation or stopped service cannot publish a
  pending result. Releasing and reacquiring an in-flight owner does not overlap
  reads or reuse its previous result.
- Only successfully delivered marked list replies update a socket's record.
  A different socket's event re-list, an unmarked dialog read, or a failed send
  cannot hide that socket's unseen change.
- Activity timestamps and output-only pane scroll changes do not cause notices.
  Enriched workspace fields, tabs, pane identities and agent status still do.
- A failed read waits for all sibling reads before releasing its slot and
  retries after the next period. Hosts progress independently.
- Profile mutation callbacks observe the committed catalogue, and socket cleanup
  releases interest once while reporting the new browser count.

## Direct evidence and bounds

`server/src/world/focused-acquisition.test.ts` enumerates all 343 length-three
traces over seven actions: two sockets declaring either of two owners, hiding
the first, closing the second, and a generation bump. After each action, reads
must equal the union of current declared owners. Named cases exercise holding
both owners, duplicate/invalid declarations, missed-event changes, per-socket
records, output/activity exclusions, failures, and deferred release, retirement,
stop and reacquisition schedules.

`server/src/service/focused-acquisition.test.ts` drives the real dispatcher and
connection manager with two synthetic sockets and two synthetic runtimes. It
checks actual enriched replies, frame-marker isolation from Herdr params,
unmarked callers, failed sends and retirement. It also exercises the actual
browser cleanup tracker and count callback.

`server/src/world/focused-lists.test.ts` covers failed siblings draining before
the observation settles and Windows avoiding local session enrichment.
`server/src/connections/profile-notices.test.ts` uses the actual profile service
and private temporary persistence to check create/edit/default/remove callbacks
and rejection without a success notice.

These direct finite traces exercise the actual registry and publication paths;
adding a model that repeats this registry would not establish its socket/reply
consumers. Q04's maintained runtime lease models remain binding for runtime
ownership. This evidence does not prove arbitrary scheduler or transport liveness,
remote filesystem timing, or browser parity. At the observer checkpoint, browser
T2 cases remained expected failures. The recency checkpoint below implements the
recency and hide/show cases as normal tests. Q15 maps that checkpoint; Q24 remains
with the Desk checkpoint.

## Recency checkpoint

The service cache keeps activity separately from live status. Concurrent readers
share a pending session-file reading; fresh lists reuse only its timestamps.
The observer refreshes activity through the existing four-read/1.5-second bounded
enricher, retaining its remote-session restrictions. Every changed reading sends
the owner's complete activity map to current holders, never a placeholder before
the first reading. Last release clears the cache; release/reacquire drains old
work before starting another reading, and old leases cannot publish.

`server/src/world/agent-activity-cache.test.ts` directly checks freshness, shared
pending work, unchanged-map suppression, session replacement, failure recovery,
and pending release/reacquire and retirement. The two-socket/two-host consumer in
`server/src/service/agent-activity.test.ts` drives the actual focused observer and
list reader with this cache. Existing `server/src/agent/agent-activity.test.ts`
retains actual filesystem, remote-session, concurrency and deadline coverage.

For one pane/terminal/agent/session identity, the browser merge must equal the
maximum valid time received from either a list or a push. An entry for another
identity cannot apply; a new runtime partition starts empty while separate
read-only full-identity maxima remain available to rejoin after fresh admission.
World restarting and resetting its generation counters cannot lower the same
external session's time or grant operation authority. The merge runs at
publication after layout acquisition, so a push received during that wait cannot
be overwritten. Status agreement continues to gate the native sequence only.

`web/src/agentRecency.test.ts` covers all 48 combinations of three timestamps'
arrival order and list/push origin, plus identity replacements, early pushes,
missing readings and invalid entries. `web/src/store/agentActivity.test.ts` uses
the real Bridge and focused store on two ready synthetic hosts. It checks scoped
push admission without re-listing or focus changes, rejected sessions/generations,
an older re-list, and a push during a deferred layout read. These direct tests
establish the maximum operation and the real publication boundary; they do not
claim transport liveness or enable the remaining browser T2 expected failures,
whose remaining flows need Inspector interest, notices or timer removal. The
original recency and hide/show T2 cases are normal passing tests through actual
active-owner declarations and holder-routed pushes; five unrelated expected
failures remain. `web/src/store/recencyReconnect.test.ts` checks ordinary reconnect
and generation-counter resets with older and unavailable readings, preserved
ordering, and obsolete-generation rejection. `web/src/store/recencyCapability.test.ts`
checks both initial capability absence and removal on reconnect. The real store
initial-layout race retains A's maximum when B pushes for the same pane before A
publishes. Active declarations retry a failed release once per period and stop
on success. Q24 and Desk acquisition remain a later checkpoint.
