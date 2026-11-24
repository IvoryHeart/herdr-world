### Fixed

- An agent held in the Bin that ends by itself (killed or closed outside the
  Bin, on Herdr or herdr-core) now leaves the Bin as soon as World sees it
  gone, with "It ended before the bus came, so nothing was closed.", instead
  of staying held unseen until a bus finds it gone. A herdr-core host's new
  runtime now returns its held agents, as a Herdr host's already did. The
  service journal logs each Bin step.
