### Fixed

- Fix macOS Homebrew acceptance to start signed herdr-core, preserve it across World reinstalls and recognise World's localhost listener.

<!-- detail -->

- Fix macOS Homebrew release acceptance to install and start the signed herdr-core
  release with a short temporary home, clean it up, and preserve it across World
  reinstallation. Keep the tap's acceptance check synchronized with each release.
  Recognize World's `localhost` listener URL so successful startups pass the check.
