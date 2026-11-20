## Why

Shipyard needs real release and deployment evidence before Town and Board can present it. Issue #1013 delivers the data contract for the separate visual work in #1028.

## What Changes

- Read repository releases, tags, main workflow runs and commit-qualified unreleased PRs through the existing GitHub source runner/sign-in and enabled setting.
- Add a bounded read-only service, same-origin HTTP API and local CLI.
- Record listening World instances in a private registry with expiring observations, versions and source checkout metadata; previews may opt into a shared registry.
- Document calls, examples, limits, refusals and synthetic CLI demonstrations. No release/tag creation, remote discovery or visual changes.

## Capabilities

### New Capabilities

- `world-shipyard`: read-only release pipeline and local deployment observations shared by future Town/Board consumers.

### Modified Capabilities

None. Existing source settings, browser admission and local CLI admission remain authoritative.

## Impact

Shared TypeScript contract, sources/GitHub runner, service composition/listener, instance lifecycle and CLI. No dependencies or database migration. FEATURES and a dedicated API guide change; no learner steps change.
