# Shared acquisition consumer evidence

The approved shared-acquisition change requires one observer per held runtime,
interest independent of operation authority, and notices compared with each
socket's received focused lists. This checkpoint delivers the service observer
and catalogue notices; it does not advertise `world_shared_acquisition` or claim
browser timer removal, pushed recency or shared Desk reads.

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
remote filesystem timing, or browser parity. Browser T2 expected failures remain
unchanged until their browser consumers land. Q15 and Q24 additions belong to
the recency/browser and Desk checkpoints respectively.
