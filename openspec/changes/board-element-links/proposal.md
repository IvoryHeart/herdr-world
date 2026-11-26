## Why

The Board element data change shipped Memory and Agent log elements that read
only project files, with no mapping to World's memory Library or to Apartments.
Both now exist, and #1030 asked that a memory element link to the memory model
and a log element to its apartment (#1221).

## What Changes

- A Memory element may reference one memory from World's memory Library
  instead of a project file. The browser reads it through the memory service;
  Board's own read makes no host read.
- An Agent log may name its Apartments resident, or match one by its agent
  reference on the same connection.
- Readers offer Open in Memory and Open past session. Board names them
  plainly; Town's names stay in Town.

## Impact

Shared element types and parsing, the Board service read pointer, the CLI
(`--memory-source`, `--apartment`), the Board form and readers, the Apartments
entry point, Board and Apartments notes, and `docs/board-elements-api.md`. The
memory service and Apartments keep owning reads and residents. No new storage
table, plugin protocol or screen.
