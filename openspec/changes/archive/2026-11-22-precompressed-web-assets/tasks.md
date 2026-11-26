## Implementation
- [x] Build-time brotli and gzip variants for compressible `/assets/*` files.
- [x] Serve the accepted variant with Content-Encoding and Vary; raw fallback.
- [x] Year-long private immutable caching for `/assets/*` only.
- [x] Binary embeds variants (standalone test); budget on raw bytes, compressed reported.
- [x] bridge-access notes and changelog fragment.
