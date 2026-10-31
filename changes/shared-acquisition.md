### Changed

- Reduce idle work across open World browsers by sharing focused observations,
  agent activity and Desk screen/turn reads in the service. Browser views refresh
  on changes and recover failed reads without repeatedly re-listing idle hosts.
  Older services retain the existing refresh timers.
