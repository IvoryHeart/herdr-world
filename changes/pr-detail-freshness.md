### Fixed

- Retire cached PR-detail readiness and open merge sheets at the original expiry
  deadline, including idle cards that have not received another source poll.

- Label cached pull request detail with its own freshness and read time after
  failed or expired reads, retain useful evidence links, and require fresh
  head-qualified detail before World dispatches a merge.
