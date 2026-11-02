### Fixed

- Show an empty Chat for a newly started agent without a conversation yet,
  while retaining errors for missing or unreadable conversation records.
- Keep New agent progress and outcomes visible above harness checks, and
  prevent repeated clicks or a startup timeout from creating duplicate agents.
- Ignore replies from a dismissed New agent window and finish opening a login
  tab before accepting another start, preserving the active attempt's result.
- Open agents on Terminal until their conversation arrives, then switch to Chat
  unless a view was chosen manually. Describe startup questions honestly and
  delay integration guidance until a running agent has had a grace period.
  A replacement terminal or harness cannot inherit the old automatic switch.
