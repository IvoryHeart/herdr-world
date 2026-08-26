# Pixel Office asset provenance

The Herdr World Pixel Office port uses character assets traceable to the
Claw-Empire repository at revision
`66a24ea7df2435ef897c48c147deb7ec572c01c2`, under `public/sprites/`. The
tracked PNGs are byte-identical to those source files. That source carries the
Apache License 2.0 and the copyright notice `Copyright 2026 GreenSheep01201
(seowongil@gmail.com)`. Herdr World has no build or runtime dependency on the
reference workspace. The copied character sprites now live under
`web/public/world/characters/`.

The reference workspace is historical provenance only; contributors do not
need to clone or start another repository to build, test, or run Herdr World.
The release notice bundle MUST include the Apache-2.0 license and this
attribution. The adapted TypeScript geometry/drawing files are modified files
and MUST carry a prominent modification notice as required by Apache-2.0
Section 4(b); the provenance manifest will identify the exact source hashes,
copied-file hashes, and notices.

The historical reference Office directory was untracked in the source
checkout at port time, so that local directory has no source commit to cite.
The immutable Extension 001 approval commit authorizing this port is
`7be916e3c4713582c72665cd787ef0300658ea26`. The Claw-Empire revision and
these SHA-256 values identify the exact copied assets:

| Asset | SHA-256 |
| --- | --- |
| `1-D-1.png` | `97e11be5369a5865f9e0a7b1657af23fd5d7f4b244fb94010ebb7e9e66a3e004` |
| `2-D-1.png` | `f3053d7f6bc2959ad375b1cfd23eb9fb1e34e7329ba837fd7518268459d0a83d` |
| `3-D-1.png` | `eb8cb07677ec3ff81a43e019990b288ca3b858309fe51b2d5b52ccf3f8b855f5` |
| `4-D-1.png` | `23dab1383ef8f98af148885e5f01c25063ce0e7b6d0ae6a255c5bdb83dae01f2` |
| `5-D-1.png` | `32d8159b707fc64447fc6ab27a6a00ba2ddf318627fada114d43d5aef9c93fa9` |
| `6-D-1.png` | `7ae5935cf9f454f0ea8ee099111fde50da5055a50a7b05c53a98e5eb914b3739` |
| `7-D-1.png` | `4fb4bcf9046c66f7e4630edf636deb6d076a062e195c9dfb44caf713e9e46dcf` |
| `8-D-1.png` | `63d8d576aff2f9973d38d24c0d0ca87498af8880c1326aceaa0c644c5df03d66` |
| `9-D-1.png` | `1fc674238ce13ae382c07189d4422780e47bdd1417bf468bb492786cf211f4bf` |
| `10-D-1.png` | `c4d22e7ccec30505873469a2e1cef76cf8435be84d71d3f201d84147de8f5738` |
| `11-D-1.png` | `6e2c79f2fdb5afe8fd8c1537ba550a8ada9d301e4b493e4a528dbb37d3d4a549` |
| `12-D-1.png` | `334595aa69f05095faa88227413dcddd6d1a2f177fbaeb625bd78f8dc7bcef34` |

The geometry and drawing behavior are TypeScript adaptations of `office-geometry.js`,
`office-drawing.js`, and the rendering portions of `office-scene.js`; their source hashes at port
time were respectively:

- `6ab54a94369e8695c3bac2cf94ac76bab62613563382e4a712944ff0ff70e028`
- `56edfdd364ace64663e4a98c931d15d2ef5bfcb725acee8d8791e88f974fd210`
- `f4975a6e840506a003f39153dfa6e32830d311624402980a1884ecb5351a1e3f`

PixiJS `8.3.4` is pinned as an npm dependency. Its MIT license is retained at
`web/public/world/LICENSE-PixiJS.txt`. The Claw-Empire Apache-2.0 license is a
release requirement and is not inferred from PixiJS or any neighboring asset.
