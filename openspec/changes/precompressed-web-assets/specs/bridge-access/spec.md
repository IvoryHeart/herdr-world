## ADDED Requirements

### Requirement: Cached, precompressed build assets

World SHALL serve its content-hashed build files under `/assets/` with a
year-long, immutable browser cache, and SHALL send a compressed variant made at
build time when the browser accepts its coding. Caching and compression SHALL
NOT change login, admission, origin or content security policy.

#### Scenario: Cached, precompressed build assets acceptance rules

- **WHEN** an admitted browser requests a file under `/assets/` that exists
- **THEN** the response SHALL carry `Cache-Control: private, max-age=31536000,
  immutable`. When the build wrote a brotli or gzip variant beside the file and
  the request's `Accept-Encoding` accepts that coding (q-values honoured, brotli
  first on a tie), World SHALL send the variant with its `Content-Encoding` and
  the file's own content type; otherwise it SHALL send the file. A compressible
  asset's response SHALL carry `Vary: Accept-Encoding` either way. A variant
  SHALL be looked up only beside a file that exists and was resolved inside the
  public directory, so the lookup adds no path. Only static build files SHALL be
  compressed; responses carrying secrets or user data SHALL NOT be.

#### Scenario: Other responses keep their caching

- **WHEN** World answers with the entry page, the manifest, the service worker,
  an API, login or logout response, a missing asset or any file outside
  `/assets/`
- **THEN** it SHALL keep that response's existing cache headers and SHALL NOT
  mark it immutable, `public` or compressed, and an unadmitted request for an
  asset SHALL still be refused before any file is read
