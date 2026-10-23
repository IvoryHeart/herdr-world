### Added

- Chat answers an agent's own permission prompt. For Claude Code's permission
  box and Codex's approval menu, Chat shows the complete request, the question
  and each option; picking one (or its number, with the card focused) presses
  that key in the agent's pane after checking the prompt, session and state
  have not changed, and Chat shows what it sent. It says "You answered" only
  when Herdr shows the agent moved on, and otherwise why it cannot confirm.
  Herdr cannot hold a prompt between the check and the key, and the card says
  so. Any other prompt offers the Terminal instead of a guess.
