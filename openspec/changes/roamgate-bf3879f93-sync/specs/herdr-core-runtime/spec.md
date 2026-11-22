## ADDED Requirements

### Requirement: Qualified transcript metadata on core hosts

Core host RPCs `agent_commands.get` and `agent_artifacts.get` SHALL use World's
existing core session readers on the named connection and generation. They SHALL
NOT fall back to a Herdr connection. Image-bearing History entries SHALL retain
bounded metadata; image data MAY be fetched only through the matching entry read.

#### Scenario: Runtime changes during a metadata read

- **WHEN** the named core runtime is replaced while metadata is being read
- **THEN** the old result SHALL NOT publish as metadata for its replacement
