### Fixed

- Keep Herdr in its own Homebrew formula on every platform, reusing an existing
  installation and directing upgrades to its actual owner. World no longer
  exports a second Herdr command from its Intel Mac keg; Intel Macs may build
  the Herdr dependency from source when a bottle is unavailable.
