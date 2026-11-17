### Changed

- On a computer without the Herdr TUI, the first herdr-core connection (from
  the installer, Town's **Set up herdr-core** or Manage connections) is saved
  alone as the default, so Town shows only the herdr-core building. With the
  Herdr TUI installed, its Local connection stays the default.
  `herdr-world connections add --core` accepts `--default`.

### Fixed

- Show whole line numbers in the herdr-core install log on desktop and phone.
- Keep the Town Master's greeting from covering Town's setup card: it waits
  until the card is gone.
