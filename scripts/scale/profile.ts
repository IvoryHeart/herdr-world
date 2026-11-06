import { createRequire } from "node:module";
import { join, basename } from "node:path";
import { readFileSync, existsSync } from "node:fs";

type Profile = {
  nodes: {
    id: number;
    callFrame: {
      url: string;
      functionName: string;
      lineNumber: number;
      columnNumber: number;
    };
  }[];
  samples?: number[];
  timeDeltas?: number[];
  startTime: number;
  endTime: number;
};
export async function profileOwners(profile: Profile) {
  // Use Vite's already-resolved source-map implementation; do not change the lockfile.
  const require = createRequire(import.meta.url);
  const viteRequire = createRequire(
    require.resolve("vite", { paths: [join(process.cwd(), "web")] }),
  );
  const { SourceMapConsumer } = viteRequire("source-map-js");
  const consumers = new Map<string, any>();
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const totals = new Map<string, number>();
  let mapped = 0,
    unknown = 0;
  for (const [i, id] of (profile.samples ?? []).entries()) {
    const frame = nodes.get(id)!.callFrame,
      us = profile.timeDeltas?.[i] ?? 0;
    let label = frame.url
      ? basename(frame.url.split("?")[0]!)
      : frame.functionName || "native";
    const asset = frame.url.match(/\/assets\/([^/?]+\.js)/)?.[1];
    if (asset) {
      const mapPath = join(
        process.cwd(),
        "server/public/assets",
        asset + ".map",
      );
      if (!consumers.has(asset))
        consumers.set(
          asset,
          existsSync(mapPath)
            ? new SourceMapConsumer(JSON.parse(readFileSync(mapPath, "utf8")))
            : null,
        );
      const position = consumers.get(asset)?.originalPositionFor({
        line: frame.lineNumber + 1,
        column: frame.columnNumber,
      });
      if (position?.source) {
        const source: string = position.source;
        label = source.includes("/src/")
          ? source.slice(source.indexOf("/src/") + 1)
          : source.includes("node_modules/")
            ? "node_modules/" + source.split("node_modules/").at(-1)
            : basename(source);
        label += `:${position.line} ${position.name ?? frame.functionName}`;
        mapped += us;
      } else unknown += us;
    }
    totals.set(label, (totals.get(label) ?? 0) + us / 1000);
  }
  return {
    wallMs: (profile.endTime - profile.startTime) / 1000,
    mappedMs: mapped / 1000,
    unmappedAssetMs: unknown / 1000,
    selfOwners: [...totals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([owner, ms]) => ({ owner, ms })),
  };
}
