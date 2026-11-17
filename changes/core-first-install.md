### Added

- With no runtime installed, the standalone installer and Homebrew's first
  launch install herdr-core (checksum-verified; on macOS only a release whose
  Herdr signature checks out), start it now and at login, and
  connect World to it. An installed Herdr or herdr-core is kept as it is.
- **Hosts → Manage connections** offers **Install herdr-core…** for this
  computer and each Unix SSH host, and on a core connection that found nothing
  running. Town's Set up card offers herdr-core first. Each install shows what
  will happen and waits for a confirmation.
- `herdr-world connections add <id> --core` adds a herdr-core connection;
  `herdr-world herdr setup` and `herdr upgrade --install` keep an installed
  herdr-core, or install it when no runtime exists, and never add Herdr beside
  it.
- Install herdr-core under a saved core connection starts that connection's
  session and connects it, and says so plainly if World still cannot connect.
