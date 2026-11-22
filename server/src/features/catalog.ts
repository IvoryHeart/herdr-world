import * as index from "./index.gen";
import type { Feature } from "./contract";

export const serverFeatures: readonly Feature[] = Object.values(index).flatMap(
  (entry) => ("feature" in entry ? [entry.feature] : []),
);
