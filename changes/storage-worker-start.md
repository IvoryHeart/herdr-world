### Fixed

- Start World's storage worker without loading the rest of the service, so opening `world.sqlite` reads far fewer modules, notably on slow Windows disks.
