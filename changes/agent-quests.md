### Added

- Show each agent's quest: read without a model from its own todo list
  (Claude Code `TodoWrite` and tasks, Codex `update_plan`, Kimi
  `SetTodoList`), approved plan, Codex goal or `/loop`. Chat shows a foldable
  quest log above the conversation, Town shows a progress flag over a seated
  agent, and Board shows a progress chip on the agent's card. The new
  `agent_quest.list` RPC returns quests for many panes at once.
