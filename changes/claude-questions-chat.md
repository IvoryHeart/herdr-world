### Added

- Chat answers Claude's folder-trust question before its session starts: the
  card shows **No, exit** and **Yes, I trust this folder**, and a click is
  checked against the same question and Claude process before each key.

### Fixed

- Show Claude's questions whole in Chat and Needs you, from its own record:
  every question, header, option, description and multi-select, instead of a
  clipped screen tail. Answer buttons appear only when the terminal shows the
  same question; otherwise Chat says why and offers the Terminal.
- Show an unrecognised prompt as the terminal draws it, with the reason Chat
  does not answer it, keeping the final prompt row in view. Keep history read
  errors visible beside question cards, and refuse malformed or mismatched
  transcript questions without discarding their authority checks.
