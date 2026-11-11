### Added

- herdr-core connections reach Windows SSH hosts: choose **A Windows host over
  SSH** in **Add herdr-core**. World reads core's `core.lock` there and relays
  its named pipe through two fixed Windows PowerShell scripts, so it never
  starts a core; a pipe owned by or open to another account is refused.
