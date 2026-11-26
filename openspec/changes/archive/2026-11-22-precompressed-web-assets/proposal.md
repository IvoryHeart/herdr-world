## Why

Issue #1245: opening Town downloaded 73 files, 3.58 MiB, on every load. World
sent its web files uncompressed and without cache headers, so nothing came from
the browser cache on a repeat visit.

## What Changes

- The web build writes a brotli (`.br`) and a gzip (`.gz`) variant beside each
  compressible, content-hashed file under `/assets/`.
- World serves the variant the browser's `Accept-Encoding` accepts, with
  `Content-Encoding` and `Vary: Accept-Encoding`, and the file itself otherwise.
- `/assets/*` responses carry `private, max-age=31536000, immutable`. The entry
  page, manifest, service worker, API, login and every other response keep their
  headers.
- The compiled binary embeds the variants; `check-web-assets.mjs` keeps its
  budget on raw bytes and reports the compressed totals beside it.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bridge-access`: adds "Cached, precompressed build assets".

## Impact

Service static serving (`server/src/http/static-files.ts`), the web build
(`scripts/precompress-assets.ts`, `web/vite.config.ts`) and the asset budget
check. Login, admission, CSP and the origin are unchanged.
