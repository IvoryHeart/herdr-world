### Changed

- Town, Desk and Needs you now use only the shared Desk review record. Missing
  stop metadata refreshes before marking and remains retryable when unavailable.
- Upgrade preserves Desk/watch records and transfers old completion checks only
  with fresh matching terminal, known session and native completion sequence.
  Work without session proof may need review once again after upgrade.

### Removed

- Retired the separate completion-check browser APIs. Unresolved old receipts
  drain privately on confirmed terminal absence or 30 days after upgrade.
