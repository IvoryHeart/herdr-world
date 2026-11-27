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
- `server/src/http/auth.ts`: per-World session cookie, legacy move, pruning, `safeReturnPath`
- `web/src/loginReturn.ts`: the app's own bounce to login keeps the page as `next`
- `server/src/http/static-files.ts`: built web files; `/assets/*` caching and
  precompressed variants (`shared/precompressedAssets.ts`, written by
  `scripts/precompress-assets.ts` from `web/vite.config.ts`)
- `server/src/index.ts`

**Pitfalls:**

- Keep one browser origin; shell and transport operations need qualified authority.
- Login (`server/src/http/auth.ts`): the session cookie is `herdr_world_auth_<12 hex>`, a digest
  of the signing secret, because cookies ignore ports; a port name breaks when Worlds swap ports.
  Its value is `<token>.h<hour>`: the unsigned hour only orders pruning. Fresh previews each add a
  cookie, and Bun answers 431 above ~16 KB of headers, so a World setting its cookie clears expired
  World cookies and keeps 48 live ones (~10 KB), least recently set first to go; fewer than 48
  are never touched, so a person switching between Worlds is never logged out by pruning. The
  first page load of an hour re-stamps it (on
  the page response, never a redirect, so a refused cookie cannot loop). Only the own name and
  the legacy `herdr_world_auth` (moved on the next page load) are accepted, so logout clears
  both. Unauthenticated page loads go to `/login?next=<path+query>`;
  `safeReturnPath` is the only validator (re-checks the parsed output: `/.//x` becomes `//x`);
  the app's own bounce (`web/src/loginReturn.ts`) only builds `next`. Explicit logout goes to a
  bare `/login`.
- Only content-hashed `/assets/*` may be cached long or served precompressed, and
  always `private`: assets sit behind login, so a shared cache must not keep them.
  Never compress a response that carries secrets or user data. Classify the
  canonical resolved path (`canonicalStaticPathname`), never the request's
  spelling: `/assets/..%2Findex.html` is the entry page, not an asset.
- `check-web-assets.mjs` budgets raw bytes; `.br`/`.gz` variants are reported
  beside it, not counted. Bun's `fetch` decodes by default: tests that read a
  compressed body pass `decompress: false`.
