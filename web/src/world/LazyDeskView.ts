import { lazyWithReload } from "../lazyWithReload";

/** Desk, like Board, loads when first shown; Town is the default view (#1479). */
export const LazyDeskView = lazyWithReload("world-desk", () =>
  import("./DeskView").then((module) => ({ default: module.DeskView })),
);
