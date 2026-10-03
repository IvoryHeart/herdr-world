## Why

Herdr World already observes several local and SSH runtimes, but its browser admits
operations for only one selected host and replaces the visible world when that host
changes. Users need to see and control agents across machines together, with host
selection acting as a view filter and each operation targeting its owning runtime.

## What Changes

- **BREAKING product interaction:** replace the operational host selector with an
  All hosts / selected hosts filter. Keep connection management separate and retain
  the existing managed profiles and same-origin service.
- Admit concurrent, independently qualified browser contexts for terminals,
  Inspectors and workspace operations. Opening another host or changing filters
  does not retire unrelated contexts or redirect pending operations.
- Present aggregate Office, Tree and Graph views with consistent filters, search,
  counts, host labels, observation coverage and explicit overflow reporting.
- Route resource, launcher, navigation, notification and keyboard actions through
  explicit entity contexts. Creation without an owning entity names a destination.
- Isolate reconnects and failures by runtime generation while retaining the current
  single-owner terminal presentation and capability checks.
- Schedule bounded observation for open and visible contexts with background
  progress; a slow host must not block another host's controls.

## Capabilities

### New Capabilities

None. This extends the existing federation and World surface contracts.

### Modified Capabilities

- `runtime-federation`: concurrent operational contexts, independent admission and
  invalidation, qualified resources and fair bounded aggregate observation.
- `world-surfaces`: aggregate presentation and filters, independent Inspectors,
  explicit action destinations, qualified focus, window arrangements and watches.

## Impact

The principal changes are in browser API leases, operational store ownership,
terminal/resource components and the World shell. Existing service routing,
runtime isolation and aggregate observation remain the foundation. See
[design](design.md) for source owners and migration, [tasks](tasks.md) for delivery,
and the [federation](specs/runtime-federation/spec.md) and
[surface](specs/world-surfaces/spec.md) deltas for acceptance scenarios.

No new runtime dependency, remote World service, Herdr protocol, profile credential
format or cross-origin connection is proposed. Automatic placement, agent migration,
cross-host command broadcasting and multi-user permissions are outside this change.

This artifact proposes future behavior. Implementation has not started; current
specs and user documentation continue to describe the delivered product. The owner
has chosen the aggregate control-plane direction. There are no unresolved product
decisions blocking this proposal; implementation verification remains required.
