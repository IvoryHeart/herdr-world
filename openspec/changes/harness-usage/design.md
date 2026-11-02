# Usage collection design

The shared API, accounting, privacy, health, pricing and fixed limits are defined
in [the usage guide](../../../docs/usage.md). Town and Board consume that contract.

A runtime owns one persistent worker or SSH reader and its host-local cache.
Per-file stats and complete-line offsets avoid replaying unchanged JSONL; changed
containers and replaced/truncated files rebuild only their canonical session.
The cache retains numeric parser state and hashed identity evidence, with fixed
entry/byte limits and whole-session eviction. No conversation content is retained.
Runtime generation replacement or cancellation terminates and reaps that reader.

The service coalesces refreshes, checks one native post-read claim inventory, and
fences publication by the captured connection/generation. Digest-derived entity
IDs require no storage writes. Numeric discovery and identity completeness are
separate: pruning an old Codex tree cannot prove a title prefix unique.

Direct parser, collector, transport, service and RPC controls exercise these
read-only contracts; existing lease and verb-policy models retain their authority.
The scoped evidence boundary is [world usage](../../../verification/contracts/world-usage.md).
