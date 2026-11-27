import { expect, test } from "bun:test";
import { testFeatureKernel } from "../../testing/features";
import type { FeatureKernel } from "../contract";
import { feature } from "./register";

test("registry feature creation is inert and retains HTTP routing ahead of Sources", async () => {
  const reads: unknown[] = [];
  const snapshot = {
    observedAt: 0,
    refreshing: false,
    sources: [],
    items: [],
    links: [],
    actions: [],
  };
  const instance = feature.create(
    testFeatureKernel({
      profiles: {
        list: () => {
          reads.push("runtimes");
          return [];
        },
        coreList: () => [],
      },
      sources: () =>
        ({
          snapshot: async (refresh?: boolean) => {
            reads.push(refresh);
            return snapshot;
          },
        }) as unknown as ReturnType<FeatureKernel["sources"]>,
    }),
    () => {
      throw new Error("no feature dependencies");
    },
  );
  expect(reads).toEqual([]);
  expect(instance.stop).toBeUndefined();
  const request = (path: string, method = "GET") =>
    instance.api.http(
      new Request(`http://world.test${path}`, { method }),
      path,
    );
  const refused = await request("/api/world/integrations", "PUT");
  expect(refused?.status).toBe(405);
  expect(refused?.headers.get("allow")).toBe("GET");
  expect(reads).toEqual([]);
  expect(await request("/api/world/unknown")).toBeNull();
  expect(await (await request("/api/world/sources"))!.json()).toEqual(snapshot);
  expect(
    await (await request("/api/world/sources/refresh", "POST"))!.json(),
  ).toEqual(snapshot);
  expect(reads).toEqual([undefined, true]);
});
