### Fixed

- Explicit Herdr setup now registers future user-service startup even when Herdr
  is already running, preserving the live server and reporting registration errors.
  Unusable executable entries are rejected before service registration and preserved
  for repair.
