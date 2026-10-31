### Added

- Manage Teams and Pods with `herdr-world group` and `pod`/`team` aliases,
  explicit role transfers and promotion, ordered Now lists and recent sender attribution.
  Read Herdr Rooms/Desks through the same Group vocabulary; `--herdr` membership
  moves show the complete effect first and report observed outcomes, preserving
  chosen desk colours and spawn-parent colour inheritance.
- Import a Pod crew table once with explicit confirmation and address mappings;
  render World's current roster as Markdown without file synchronization.
- Open Actions → Groups for a panel roster and detail with kind filters,
  member/role management, linked PR cards, Now and recent attribution; stale
  confirmations refresh the roster without changing membership.
- Set Team/Pod Focus or Mute without copying member preferences; agent bells
  and mobile Attention menus distinguish inherited Default from explicit Watch;
  agent bells explain the winning claim.
  Focus follows current resolved members, with unchanged reception counts.
- Read Pod status, Now and source-qualified PR warnings in Town Summary;
  tap a row to open or restore its Groups detail without changing reception counts.

### Fixed

- Reduce Interest overhead in dense views when there are no effective Focus claims.
- Keep Group Add, Edit and Roles drafts after conflicting edits, require explicit
  review before resubmission, and refuse replaced or ambiguously named agent selections.
- Keep reviewed Room/Desk moves valid across incidental status, focus and revision changes.
- Preserve live appearance edits when RPC or CLI moves a desk.
- Preserve appearance edits and resets saved at a move's new destination, and
  describe whole-Board form conflicts without claiming that the current Group changed.
