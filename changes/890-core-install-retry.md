### Fixed

- Installing herdr-core retries a dropped connection (such as "Connection reset
  by peer") up to three times instead of failing on the first one.
