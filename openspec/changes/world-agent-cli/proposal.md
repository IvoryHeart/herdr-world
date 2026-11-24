## Why

Agents with only World installed need one command set for every connected runtime.
Only World can disambiguate repeated native addresses and preserve connection authority.

## What Changes

- Deliver runtime discovery, agent listing and screen reads through typed runtime ports.
- Define qualified targets, verified screen-read authority and explicit refusal reasons.
- Plan send, wait and start in the same active change; implement those in the follow-up.
- Document commands in the versioned World skill and deployment guide.

## Capabilities

### New Capabilities

- `world-agent-cli`: Runtime-neutral agent discovery, reads and future control.

### Modified Capabilities

None. Existing caller verification, runtime fences and installation commands remain applicable.

## Impact

World CLI and authenticated local service route, runtime capability metadata, verb policy,
OpenSpec and usage documentation. No storage, browser surface, new native CLI dependency,
raw RPC forwarding, message log or inbox. No unresolved owner decisions.
