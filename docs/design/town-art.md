# Town art guide

Town's landmarks are the town center, post office, library, apartments,
warehouse, piers and lighthouse. This guide is how they are drawn so that they
match the agents and desks beside them. The University (#1418) and any later
building follow it too.

The agents and desks set the standard. They are small, chunky and flat-filled,
seen from three-quarters above, lit from the top left and outlined in ink.

## The rules

| Topic | Rule |
| --- | --- |
| Palette | Flat fills from a small palette shared with the sprites: ink `#1c1722`, cream `#f1e4c8`, lit glass `#ffe39a` / `#f2c46a`, wood `#9b6a3f` / `#6e4a2e`, iron `#3a3f4a`, gold `#e8c75a`, leaf `#3f7a3a` / `#5c9a48`. Each building adds one or two colours of its own (post red, library green, harbour blue). No gradients. |
| Light | From the top left, as on agents and desks. A surface's top two rows are lighter (+0.22), its right edge darker (−0.16) and its underside darker (−0.28) (`face` in `townArtKit.ts`). Roofs: the left hip is lit, the right hip shaded, the eave darkest. |
| Outline | One pixel of ink around the building's outer silhouette only (`townOutline`). Lines inside the building are darker shades of their material, never ink. |
| Ground shadow | A soft shadow (black, 20% opacity) lies on the ground outside the outline, under the building's front edge. |
| Scale | One tile is 16 px. A door is 16–24 px wide and about 1.5 agents tall. A window is about 20 px. A storey is about 22 px. A building keeps today's lot size, door place and sign place. |
| Texture | Marks are at least 2 px, or 1 px lines no closer than 4 px apart. Texture stays within ±10–20% of its fill, so it reads as a material rather than noise. No single-pixel speckle. |
| Detail by zoom | **Overview (whole town, phone):** each building reads by silhouette and roof colour alone. Its one emblem (post horn, open book, clock, loft door) is at least 10 px. **Street (laptop default):** doors, lit windows, signs and yard props read. **Close:** panes, tiles, boards and flowers add charm, never information. |
| Night | Windows are lit warm glass, so the building glows when Town darkens. Nothing else needs to change at night. |
| Relation to agents | Buildings use the same ink, light and palette as the agents and desks. Shapes are chunkier than a façade drawing: fewer, bigger parts. Yard props (sacks, carts, benches) are drawn at the agents' scale. |

## Three directions to choose from

Each direction follows every rule above. They differ in form and material.

- **Storybook** (`storybook`): hipped tile roofs seen from above, like the
  rooms' roofs, with one colour per building: a clay post office, a moss
  library, a slate warehouse with barn doors, plum apartments, and a town hall
  with blue wings and a clock tower. Walls are cream plaster between timber
  corners. This direction is closest to the agents.
- **Harbour** (`harbour`): gables face the street. Walls are painted boards
  with white trim and shutters, under near-black shingles: a falu-red post
  office, an ochre library of three gables, a sea-blue boathouse warehouse,
  twin sage townhouses, and a white town hall under a black spire.
- **Paper** (`paper`): a pop-up book. Every part is a flat card with a pale
  2 px cut edge. It casts a soft shadow on the card behind it, with folded
  roofs and pastel colours. The ink outline stays.

### Try them

On any World, open Town with `?townArt=storybook`, `?townArt=harbour` or
`?townArt=paper`, for example `/town?townArt=harbour`. The page drops the
parameter at once, and the choice lasts until the page reloads. Any other
value, or none, shows today's art. Nothing is stored.

Add `&shipyardFixture&townWarehouseFixture` to see the piers, ships and
warehouse yard without GitHub.

Only the paint changes. Layout, signs, letters, parcels, ships and what each
building opens stay the same.

## After the choice

The chosen direction becomes the landmarks' only art:

1. Its painters in `townArtLandmarks.ts` replace today's painters.
2. The other two styles and the `?townArt=` switch are removed.
3. The Town goldens are captured again.

## Code

- `web/src/world/town/townArtKit.ts`: the rules as parts (light, roofs, walls,
  windows, doors, paving, paper cards).
- `web/src/world/town/townArtStyles.ts`: the three directions' palettes and
  forms.
- `web/src/world/town/townArtLandmarks.ts`: each landmark's plan, painted in a
  style.
- `web/src/world/town/townArtDirection.ts`: the testing-only `?townArt=`
  switch.
