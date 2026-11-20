# Design

One shared model owns sources, entries and project/agent associations. Harness
adapters describe documented candidates. Discovery is evidence of files on the
owning host, not proof a running harness loaded them. Imports, trust, settings,
per-process environments and runtime memory controls can change loading.

A bounded Python 3 standard-library worker runs on the owning Unix host, locally
or through the connection-bound SSH command runner. It uses directory descriptors
and no-follow file opens, refuses links and non-regular files, and never interprets
file text as commands. Content goes over stdin for mutations, never argv or logs.
Windows hosts and hosts without Python 3 refuse clearly. No persisted content cache
or World database migration is needed.

Every call captures an immutable connection ID and runtime generation. Fresh live
topology supplies roots; no failed-host cache or default connection fallback.
Mutation requests name a discovered source, relative Markdown entry and revision
(or absence for creates). Edits/adds require explicit user_action; deletion also
requires confirmed=true. World serializes mutations within this service and the
worker locks the parent directory. External editors do not participate in advisory
locks; revision checks occur immediately before atomic replacement/deletion.
A transport failure after mutation dispatch has unknown outcome; never auto-retry.

Source/entry counts, byte sizes, recursion, deadlines and search are bounded and
partial results say truncated. Modification age over 30 days is an age hint, not
an assessment of correctness. Sharing covers the current bounded topology on one
connection; no inference across connections, even on the same physical machine.
