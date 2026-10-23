### Fixed

- Windows: installing or upgrading the Herdr plugin no longer reports a failure
  when the installer cannot yet delete its temporary copy of the new binary
  (for example while an antivirus scan holds it). The folder is removed by a
  later install; a real install failure is still reported as one.
