### Fixed

- Reuse existing Herdr installations instead of requiring a second Homebrew-owned
  runtime. Homebrew installs a missing verified prebuilt Herdr on first normal
  World launch, outside its keg, including on Intel Macs without a source build.
- The standalone installer now installs Herdr only when missing and leaves existing
  versions and installation owners unchanged. Explicit upgrades remain available.
