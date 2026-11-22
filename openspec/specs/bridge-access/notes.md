# bridge-access notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Service startup, private-network access, uploads and qualified RPC admission.

**Code:**

- `server/src/herdr/cli.ts`
- `server/src/http/herdr-setup.test.ts`
- `server/src/verbs/registry.ts`
- `server/src/verbs/policy.test.ts`
- `server/src/service/world-service.test.ts`
- `server/src/bridge/`
- `server/src/verbs/`
- `server/src/http/`
- `server/src/http/static-files.ts`: built web files; `/assets/*` caching and
  precompressed variants (`shared/precompressedAssets.ts`, written by
  `scripts/precompress-assets.ts` from `web/vite.config.ts`)
- `server/src/index.ts`

**Pitfalls:**

- Keep one browser origin; shell and transport operations need qualified authority.
- Only content-hashed `/assets/*` may be cached long or served precompressed, and
  always `private`: assets sit behind login, so a shared cache must not keep them.
  Never compress a response that carries secrets or user data. Classify the
  canonical resolved path (`canonicalStaticPathname`), never the request's
  spelling: `/assets/..%2Findex.html` is the entry page, not an asset.
- `check-web-assets.mjs` budgets raw bytes; `.br`/`.gz` variants are reported
  beside it, not counted. Bun's `fetch` decodes by default: tests that read a
  compressed body pass `decompress: false`.
