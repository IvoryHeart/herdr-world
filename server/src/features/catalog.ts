import * as index from "./index.gen";
import type { Feature } from "./contract";

export const serverFeatures: readonly Feature[] = Object.values(index).flatMap(
  (entry) => ("feature" in entry ? [entry.feature] : []),
);
export const featureMethods = new Set(
  serverFeatures.flatMap((feature) =>
    feature.verbs
      .filter((verb) => verb.channel === "rpc")
      .map((verb) => verb.name),
  ),
);
