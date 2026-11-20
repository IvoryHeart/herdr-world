# Memory data service

## Why
Issue #1012 authorizes the data half of memory management. People need to inspect
and explicitly manage the instruction and memory files agents and projects share.
Issue #1027 will provide presentation using this contract.

## What changes
- One connection-qualified memory model, small Claude/Codex/Pi adapters, bounded
  host filesystem access, discovery/search/read/create/update/delete service.
- Same-origin World RPC and authenticated local CLI using the same service.
- Revision checks, explicit writes, confirmed deletion, privacy and refusal tests.
- FEATURES and API guide with examples and CLI acceptance steps.

## Capabilities
- New: world-memory.

## Scope
No screens, Board elements, Town art, remote installation or harness configuration
changes. No transcript ingestion, database copying or cross-connection aggregation.
Unknown harnesses and unobservable per-process overrides are explicitly reported.
The issue authorizes implementation; PR review remains the acceptance boundary.
