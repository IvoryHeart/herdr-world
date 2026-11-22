### Changed

- World serves its web files brotli- or gzip-compressed and lets the browser
  keep them cached, so Town and the other views open faster, and repeat visits
  load them from the browser cache.
