# Third-party notices

Herdr World contains code and assets from the projects below. The repository
history, lockfiles, and referenced manifests provide the exact version record.

## Herdr Web

Herdr World is derived from
[`kcosr/herdr-web`](https://github.com/kcosr/herdr-web), licensed under the MIT
License, Copyright (c) 2026 Kevin. The retained MIT terms are in the repository
[`LICENSE`](LICENSE). The current synchronized revision is recorded in
[`UPSTREAM.md`](UPSTREAM.md).

## Herdr compatibility source

`vendor/herdr-compat` contains copied or adapted source from
[`herdrdev/herdr`](https://github.com/herdrdev/herdr) v0.8.2 at commit
`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, licensed under Apache-2.0.
The exact source paths, hashes, and local dispositions are recorded in
[`vendor/herdr-compat/VENDOR-MANIFEST.toml`](vendor/herdr-compat/VENDOR-MANIFEST.toml).
The license text is retained in
[`third_party/licenses/Apache-2.0.txt`](third_party/licenses/Apache-2.0.txt).

## Claw-Empire character assets and Office adaptations

The character sprites in `web/public/world/characters` are copied from
[`GreenSheep01201/claw-empire`](https://github.com/GreenSheep01201/claw-empire)
at commit `66a24ea7df2435ef897c48c147deb7ec572c01c2`, licensed under
Apache-2.0, Copyright 2026 GreenSheep01201 (seowongil@gmail.com).

The Office geometry and drawing TypeScript files are modified adaptations of
the historical sources identified by hash in [`docs/world-assets.md`](docs/world-assets.md).
Herdr World's TypeScript port and subsequent modifications are documented
there as modified material. The Apache-2.0 text is retained in
[`third_party/licenses/Apache-2.0.txt`](third_party/licenses/Apache-2.0.txt).

## PixiJS

World rendering uses PixiJS 8.3.4, licensed under the MIT License, Copyright
(c) 2013-2023 Mathew Groves and Chad Engler. Its license is retained in
[`third_party/licenses/PixiJS-MIT.txt`](third_party/licenses/PixiJS-MIT.txt)
and alongside the shipped World assets.

## JetBrains Mono Nerd Font

The terminal includes `JetBrainsMonoNerdFontMono-Regular.woff2` as a fallback
for box-drawing, symbol, and private-use glyphs. The font is licensed under the
SIL Open Font License 1.1, Copyright 2020 The JetBrains Mono Project Authors.
The copyright notice and full license are retained in
[`web/public/fonts/OFL.txt`](web/public/fonts/OFL.txt) and shipped alongside
the font.

## Other dependencies

JavaScript and Rust dependency versions are pinned by `package-lock.json`,
`web/package-lock.json`, `bridge/Cargo.lock`, and
`vendor/herdr-compat/Cargo.lock`. The complete production npm and planned
desktop Cargo closures, their selected licences, copyright notices, and full
licence texts are checked in under
[`third_party/dependencies`](third_party/dependencies). Release assembly fails
when those generated inventories drift from the resolved dependency graphs.
