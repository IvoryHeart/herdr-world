import {
  GRAPH_PRESENTATION_BOUNDS,
  projectHerdrGraph,
} from "../graph/herdrGraphProjection";
import type { HerdrGraphProjection } from "../graph/herdrGraphProjection";
import type { WorldModel } from "../worldModel";

// Tree and Graph are presentations of the same bounded authoritative hierarchy.
// Keeping one projection prevents either theme from inventing ancestry or identity.
export const TREE_PRESENTATION_BOUNDS = GRAPH_PRESENTATION_BOUNDS;
export type HerdrTreeProjection = HerdrGraphProjection;

export function projectHerdrTree(model: WorldModel): HerdrTreeProjection {
  return projectHerdrGraph(model);
}
