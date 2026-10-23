### Changed

- Local checks from parallel worktrees share one machine-wide queue: one World
  browser lane and one behavioral verification at a time, at most two static or
  unit lanes, with a "waiting for" message naming the holder. A pre-push that only
  merges `origin/main` runs static checks only (`bun run check:static`); CI stays
  the full gate.
- `HERDR_WORLD_TEST_GPU=1` renders WebGL in local World browser suites on the GPU
  (hardware ANGLE over Vulkan), cutting their CPU use, with an automatic fallback
  to SwiftShader. CI keeps SwiftShader.
