### Fixed

- Show an empty Chat for a newly started agent without a conversation yet,
  while retaining errors for missing or unreadable conversation records.
- Keep New agent progress and outcomes visible above harness checks, and
  prevent repeated clicks or a startup timeout from creating duplicate agents.
  A definite failure allows a deliberate retry.
- Ignore replies from a dismissed New agent window and finish opening a login
  tab before accepting another start, preserving the active attempt's result.
- Open agents on Terminal until their conversation arrives, then switch to Chat
  unless a view was chosen manually. Describe startup questions honestly and
  show plain starting/waiting guidance instead of an installation hint.
  A replacement terminal or harness cannot inherit the old automatic switch.
