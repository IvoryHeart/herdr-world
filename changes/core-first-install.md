### Added

- With no runtime installed, the standalone installer and Homebrew's first
  launch install herdr-core (checksum-verified), start it now and at login, and
  connect World to it. An installed Herdr or herdr-core is kept as it is.
- **Hosts → Manage connections** offers **Install herdr-core…** for this
  computer and each Unix SSH host, and on a core connection that found nothing
  running. Town's Set up card offers herdr-core first. Each install shows what
  will happen and waits for a confirmation.
- `herdr-world connections add <id> --core` adds a herdr-core connection;
  `herdr-world herdr upgrade --install` installs herdr-core first when no
  runtime exists (not on Windows).
