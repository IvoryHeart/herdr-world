### Added

- Town shows each agent's context fill like a needs bar: a slim bar with the
  percent in the peek and under the icon in the agent's window, read from
  Claude, Codex, Pi and Gemini logs against the model's context window. At
  85% or more an agent shows a sweat drop at its desk. Agents without a
  reading show no bar. `world.usage.get` reports it as `contexts`.
