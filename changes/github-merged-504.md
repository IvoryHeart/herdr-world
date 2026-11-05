### Fixed

- Keep the GitHub source connected when many pull requests merged in the
  window: merged history is read fifty at a time, apart from open work,
  instead of in one request that GitHub stopped with a timeout.
