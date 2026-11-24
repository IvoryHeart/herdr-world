### Documentation

- Reconcile November architecture contracts, active OpenSpec lifecycles and verification ownership, with an audit of all 85 first-parent source changes.

### Fixed

- Restore the last successfully saved Town reception filter when a newer optimistic save fails, including when the earlier save finished while it was pending.

### Known issues

- Concurrent offline connection edits can acknowledge success while losing an addition (#1084). Live CLI and Settings edits use the service's serialized queue.
- A Claude limits tap suspended across stale-lock recovery can overwrite a newer reading (#1086). The verification inventory retains its counterexample.
