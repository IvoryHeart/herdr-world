/**
 * The three Town art directions (#1117, docs/design/town-art.md), as styles
 * for the landmark plans in townArtLandmarks.ts. Each shares the guide's
 * light, outline and palette roots with the agents and desks, and differs in
 * form and material:
 *
 * - storybook: hipped tile roofs seen from above, a colour per building,
 *   cream plaster between timber corners. Closest to the agents' rooms.
 * - harbour: gables to the street, painted boards with white trim under
 *   near-black shingles, like a fishing town.
 * - paper: a pop-up book: each part a flat card with a pale cut edge,
 *   casting a soft shadow on the card beneath.
 */

import type { ArtTiles, ArtWall } from "./townArtKit";
import type { TownArtDirection } from "./townArtDirection";

export type ArtBuilding = {
  wall: string;
  wallKind: ArtWall;
  roof: string;
  tiles: ArtTiles;
  trim: string;
  door: string;
  accent: string;
  gable?: string;
  frame?: string;
  sign?: string;
  chimney?: string;
};

export type ArtStyle = {
  name: TownArtDirection;
  roof: "hip" | "gable";
  finish: "ink" | "card";
  /** The cut edge of a paper card. */
  rim: string;
  corners: boolean;
  arches: boolean;
  shutters: boolean;
  flowers: boolean;
  barnX: boolean;
  barge?: string;
  plinth: string;
  column: string;
  banner: string;
  towerCap: string;
  horn: string;
  postRed: string;
  sack: string;
  paving: string;
  path: string;
  setts: string;
  lawn: string;
  deck: string;
  piling: string;
  lighthouse: readonly [light: string, band: string];
  post: ArtBuilding;
  library: ArtBuilding;
  warehouse: ArtBuilding;
  apartments: ArtBuilding;
  center: ArtBuilding;
  centerWing: ArtBuilding;
};

const CREAM = "#f1e4c8";
const TIMBER = "#6e4a2e";

const storybook: ArtStyle = {
  name: "storybook",
  roof: "hip",
  finish: "ink",
  rim: CREAM,
  corners: true,
  arches: false,
  shutters: false,
  flowers: true,
  barnX: true,
  plinth: "#b8ab90",
  column: CREAM,
  banner: "#c8553d",
  towerCap: "#b5623d",
  horn: "#e8c75a",
  postRed: "#d4252b",
  sack: "#d8c39a",
  paving: "#c2b393",
  path: "#ddd0b0",
  setts: "#a9a39a",
  lawn: "#6fae5a",
  deck: "#a8794a",
  piling: "#5a3d26",
  lighthouse: ["#f3efe4", "#c8553d"],
  post: {
    wall: CREAM,
    wallKind: "plaster",
    roof: "#b5623d",
    tiles: "round",
    trim: TIMBER,
    door: "#2f6b4f",
    accent: "#e8607a",
    sign: "#2f3a5e",
    chimney: "#a4553f",
  },
  library: {
    wall: CREAM,
    wallKind: "plaster",
    roof: "#5b7a55",
    tiles: "shingle",
    trim: TIMBER,
    door: "#7a3b2e",
    accent: "#3f7cac",
  },
  warehouse: {
    wall: "#b58a5a",
    wallKind: "boards",
    roof: "#4f5a80",
    tiles: "slate",
    trim: "#ece2c8",
    door: "#8a3b2e",
    accent: "#e04a3a",
    gable: "#b58a5a",
  },
  apartments: {
    wall: CREAM,
    wallKind: "plaster",
    roof: "#7a4a6e",
    tiles: "round",
    trim: TIMBER,
    door: "#3f5a8a",
    accent: "#f2d24b",
  },
  center: {
    wall: CREAM,
    wallKind: "stone",
    roof: "#b5623d",
    tiles: "round",
    trim: "#ece2c8",
    door: "#6e3a2a",
    accent: "#e8c75a",
    frame: TIMBER,
    gable: "#f7f2e6",
  },
  centerWing: {
    wall: CREAM,
    wallKind: "plaster",
    roof: "#4f6a9a",
    tiles: "slate",
    trim: TIMBER,
    door: "#6e3a2a",
    accent: "#e8c75a",
  },
};

const WHITE = "#f3efe4";
const SHINGLE = "#34303a";

const harbour: ArtStyle = {
  name: "harbour",
  roof: "gable",
  finish: "ink",
  rim: WHITE,
  corners: true,
  arches: false,
  shutters: true,
  flowers: false,
  barnX: false,
  barge: WHITE,
  plinth: "#8f8a82",
  column: WHITE,
  banner: "#2f5a8a",
  towerCap: SHINGLE,
  horn: "#f2c230",
  postRed: "#d4252b",
  sack: "#d8c39a",
  paving: "#a8a29a",
  path: "#c9c2b6",
  setts: "#9a948a",
  lawn: "#6a9e58",
  deck: "#6b5a4a",
  piling: "#2e2620",
  lighthouse: [WHITE, "#2f3a5e"],
  post: {
    wall: "#9e3a2a",
    wallKind: "boards",
    roof: SHINGLE,
    tiles: "shingle",
    trim: WHITE,
    door: "#2f4a6e",
    accent: "#2f4a6e",
    gable: "#9e3a2a",
    frame: WHITE,
    sign: "#2f4a6e",
    chimney: "#6b6560",
  },
  library: {
    wall: "#d9a441",
    wallKind: "boards",
    roof: SHINGLE,
    tiles: "shingle",
    trim: WHITE,
    door: "#2f5a46",
    accent: "#2f5a46",
    frame: WHITE,
  },
  warehouse: {
    wall: "#3f6f8f",
    wallKind: "boards",
    roof: SHINGLE,
    tiles: "seam",
    trim: WHITE,
    door: "#2a4a60",
    accent: "#e04a3a",
    frame: WHITE,
  },
  apartments: {
    wall: "#7f9e82",
    wallKind: "boards",
    roof: SHINGLE,
    tiles: "shingle",
    trim: WHITE,
    door: "#9e3a2a",
    accent: "#9e3a2a",
    frame: WHITE,
  },
  center: {
    wall: WHITE,
    wallKind: "boards",
    roof: SHINGLE,
    tiles: "shingle",
    trim: "#dcd6c8",
    door: "#2f4a6e",
    accent: "#2f4a6e",
    frame: "#c9c2b6",
    gable: WHITE,
  },
  centerWing: {
    wall: "#e6dfcf",
    wallKind: "boards",
    roof: SHINGLE,
    tiles: "shingle",
    trim: WHITE,
    door: "#2f4a6e",
    accent: "#2f4a6e",
    frame: WHITE,
  },
};

const CARD = "#fbf1dc";

const paper: ArtStyle = {
  name: "paper",
  roof: "hip",
  finish: "card",
  rim: "#fffaf0",
  corners: false,
  arches: true,
  shutters: false,
  flowers: false,
  barnX: false,
  plinth: "#d8cdb6",
  column: CARD,
  banner: "#e9786a",
  towerCap: "#5fa8a0",
  horn: "#f2c94c",
  postRed: "#e0503f",
  sack: "#e8d6b0",
  paving: "#d9ccb0",
  path: "#ece2cc",
  setts: "#c4bcae",
  lawn: "#8cc47a",
  deck: "#c9a378",
  piling: "#7a5c44",
  lighthouse: [CARD, "#e9786a"],
  post: {
    wall: "#f6d9c4",
    wallKind: "card",
    roof: "#e9786a",
    tiles: "plain",
    trim: "#c25a48",
    door: "#4f9a86",
    accent: "#f2c94c",
    gable: CARD,
    sign: "#3f5a8a",
    chimney: "#d9a08a",
  },
  library: {
    wall: "#dfe8c8",
    wallKind: "card",
    roof: "#6faa78",
    tiles: "plain",
    trim: "#4f8a5a",
    door: "#c25a48",
    accent: "#5a8ac8",
    gable: CARD,
  },
  warehouse: {
    wall: "#c8dce8",
    wallKind: "card",
    roof: "#5a7ab0",
    tiles: "plain",
    trim: "#3f5a8a",
    door: "#e9786a",
    accent: "#e9786a",
    gable: CARD,
  },
  apartments: {
    wall: "#eadcf0",
    wallKind: "card",
    roof: "#a878b8",
    tiles: "plain",
    trim: "#7a5a8a",
    door: "#5fa8a0",
    accent: "#f2c94c",
  },
  center: {
    wall: CARD,
    wallKind: "card",
    roof: "#5fa8a0",
    tiles: "plain",
    trim: "#f2c94c",
    door: "#c25a48",
    accent: "#f2c94c",
    frame: "#c9a378",
    gable: CARD,
  },
  centerWing: {
    wall: "#f3e6cc",
    wallKind: "card",
    roof: "#e9a86a",
    tiles: "plain",
    trim: "#c9a378",
    door: "#c25a48",
    accent: "#f2c94c",
  },
};

export const TOWN_ART_STYLES: Record<TownArtDirection, ArtStyle> = {
  storybook,
  harbour,
  paper,
};
