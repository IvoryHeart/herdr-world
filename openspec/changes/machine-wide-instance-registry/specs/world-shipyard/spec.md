## MODIFIED Requirements

### Requirement: Local World instance observations

A listening World SHALL publish its version, actual bound port, generation and known source branch/repository in a private expiring local registry, and revoke its record on graceful shutdown. Worlds running as the same user on the same machine SHALL share a registry by default, independently of their data folders; `HERDR_WORLD_INSTANCE_REGISTRY_DIR` MAY select a different private registry. Reads SHALL be bounded and SHALL NOT scan ports, contact advertised addresses, infer World deployments from agent runtimes or expose paths, PIDs or credentials. Expired observations SHALL be stale and SHALL have no open action. Only fresh loopback observations SHALL provide preview links; browser clients SHALL open links by ordinary navigation, preserving the one-origin application boundary.

#### Scenario: Preview is observed then expires

- **WHEN** an isolated preview reports into the shared registry and its report subsequently expires
- **THEN** its known version, port and branch can be displayed as stale, but its open URL is null
