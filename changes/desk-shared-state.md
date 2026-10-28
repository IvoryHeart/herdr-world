### Changed

- Share Desk review marks, observed stops and recent opens across browsers of
  one World service, preserving exact Undo and agent-session scoping. Desk state
  now lives in bounded service memory and clears when the service restarts.
- Keep shared review marks consistent across different receipt polling coverage,
  reject late mutations from replaced sessions, and keep keyboard focus on the
  next Desk card after marking a stop reviewed.
