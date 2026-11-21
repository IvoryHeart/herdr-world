import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Every World storage open starts a fresh worker, which parses its whole import
// graph again. Pulling in the service composition root (adapters, connections,
// terminal bridge) once made each start load ~900 modules, enough for a slow
// Windows arm64 runner to stall an open past a test's 5 s budget (#1126).
test("the storage worker loads storage code, not the service composition", async () => {
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./world-worker.ts", import.meta.url))],
    target: "bun",
    metafile: true,
  });
  expect(build.success).toBe(true);
  const modules = Object.keys(build.metafile!.inputs).map((path) =>
    path.replaceAll("\\", "/"),
  );
  expect(modules.some((path) => path.endsWith("storage/world-writer.ts"))).toBe(
    true,
  );
  expect(
    modules.filter((path) =>
      /(?:^|\/)server\/src\/(?:service\/ports|adapters|connections|bridge|workspace|usage)(?:\/|\.ts$)/.test(
        path,
      ),
    ),
  ).toEqual([]);
}, 20000);
