# Usage collection design

The shared API, accounting, privacy, health, pricing and fixed limits are defined
in [the usage guide](../../../docs/usage.md). Town and Board consume that contract.

A runtime owns one persistent worker or SSH reader and its host-local cache.
Per-file stats and complete-line offsets avoid replaying unchanged JSONL; changed
containers and replaced/truncated files rebuild only their canonical session.
The cache retains numeric parser state and hashed identity evidence, with fixed
entry/byte limits and whole-session eviction. No conversation content is retained.
Runtime generation replacement or cancellation terminates and reaps that reader.
Changed plain files compare bounded head/offset samples, with a full UTC-day
rebuild; a pathological same-inode rewrite preserving those samples may remain
undetected until then. Verified file descriptors own identity and numeric reads.
Budget retries preserve the first unprocessed offset and parser/cursor consistency.
Protocol/numeric failures also own termination while the reader is idle.

The service coalesces refreshes, checks one native post-read claim inventory, and
fences publication by the captured connection/generation. Digest-derived entity
IDs require no storage writes. Numeric discovery and identity completeness are
separate: an older Codex date triggers bounded metadata inspection for activity,
not proof of expiry or unique title identity.

Direct parser, collector, transport, service and RPC controls exercise these
read-only contracts; existing lease and verb-policy models retain their authority.
The scoped evidence boundary is [world usage](../../../verification/contracts/world-usage.md).
