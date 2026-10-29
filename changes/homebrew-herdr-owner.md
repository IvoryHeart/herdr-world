### Fixed

- Reuse existing Herdr installations instead of requiring a second Homebrew-owned
  runtime. Homebrew installs a missing verified prebuilt Herdr on first normal
  World launch, outside its keg, including on Intel Macs without a source build.
- The standalone installer now installs Herdr only when missing and leaves existing
  versions and installation owners unchanged. Explicit upgrades remain available.
- A failed Homebrew runtime check or download warns and still starts World, keeping
  SSH profiles and in-app setup available. Fresh standalone installs leave harness
  integrations and the plugin to an explicit `herdr-world herdr upgrade`.
- Preserve Herdr even if another installation appears during automatic setup:
  missing-only bootstrap never upgrades or overwrites an intervening runtime.
- Keep safe standalone runtime setup when selecting an older World release that
  lacks the missing-only CLI option. Report broken Herdr links before downloading
  and preserve the blocking entry for its owner to repair.
- Validate the selected Herdr file before treating discovery as an installation;
  preserve unusable entries with repair guidance. Reuse a reachable Herdr server
  without installing a second copy when its executable is outside the installer's path.
