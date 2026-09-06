Apply only the specialist lenses listed in supervisor context. Return concrete findings
within the normal reviewer result; a clean review is valid. These are scoped review skills,
not extra always-on agents. Use world-review-specialist for repository-specific checks.

- security: authentication/session boundaries, LAN exposure, command allow-lists, uploads,
  untrusted paths/content and exposure of local credentials or runtime sockets.
- protocol: browser TypeScript → HTTP → Rust → external Herdr; validation, host ownership,
  compatibility and reconnect behavior. Follow the actual path across languages.
- ux-accessibility: requested user flow, keyboard/focus behavior, accessible naming and
  loading/error/recovery states. Use fixture evidence where the behavior requires it.
- performance: identify the affected hot path and representative workload; request measured
  evidence for a concrete regression, not speculative optimization.
