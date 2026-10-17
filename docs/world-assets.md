# Office town art and asset provenance

## Office town

The Office town's art is original work generated at runtime. Pixel definitions in
[`townSprites.ts`](../web/src/world/town/townSprites.ts) draw characters,
furniture, trees and status bubbles into canvases; [`townPaint.ts`](../web/src/world/town/townPaint.ts)
paints the ground, building interiors, façades and roofs. The renderer uploads
those canvases as textures. There are no binary art assets and no third-party
art in the application.

- **Style**: 3/4 top-down pixel art on a 16-pixel tile grid with nearest-neighbour
  scaling, a one-pixel dark outline per sprite and shading derived from one base
  colour per material.
- **Characters**: 12 by 18 pixels plus outline, with down, up and side views
  (left mirrored from right), and stand, four-frame walk, sit (two typing frames)
  and carry poses. Appearance is a deterministic function of the agent's identity.
- **Status colours** are reserved: working blue, waiting amber, done green, idle
  sand and shell green, always paired with text or an accessible name.

New art must be original, CC0 or MIT-licensed with a recorded source. Imported
assets go under `web/public/world/` with their licence file and an entry in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

PixiJS is pinned as an npm dependency. Its MIT licence is retained at
`web/public/world/LICENSE-PixiJS.txt`.

## Retired Pixel Office

The previous Pixel Office used character sprites and drawing code adapted from
the Claw-Empire repository at revision `66a24ea7df2435ef897c48c147deb7ec572c01c2`
(Apache License 2.0, `Copyright 2026 GreenSheep01201 (seowongil@gmail.com)`). The
Office town replaced that renderer, and the sprites and adapted drawing modules
were removed from the application.

The website film still embeds downscaled copies of those character sprites, so
the release notice bundle keeps the Apache-2.0 licence in
[`LICENSES/CLAW-EMPIRE-APACHE-2.0.txt`](../LICENSES/CLAW-EMPIRE-APACHE-2.0.txt)
and the attribution in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The
copied sprites had these SHA-256 values:

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
