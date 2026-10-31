import { expect, test } from "bun:test";
import { productionAdapters, productionAdapterDescriptors } from "./registry";

test("production registration is static and descriptor transport is data only", () => {
  expect(Object.keys(productionAdapters)).toEqual(["herdr"]);
  expect(Object.isFrozen(productionAdapters)).toBe(true);
  expect(Object.hasOwn(productionAdapters, "synthetic-test-only")).toBe(false);
  const data = JSON.parse(JSON.stringify(productionAdapterDescriptors()));
  expect(data).toEqual(productionAdapterDescriptors());
  expect(data[0]).toHaveProperty("version", 1);
  for (const verb of Object.values(productionAdapters.herdr.descriptor.verbs)) {
    expect(verb.recovery).toBe("read");
  }
  expect(data[0]).not.toHaveProperty("createRuntime");
  expect(data[0].configuration).toEqual(
    expect.objectContaining({ additionalProperties: false }),
  );
});

test("release entrypoint cannot include the synthetic source or browser presentation", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("../index.ts", import.meta.url).pathname],
    target: "bun",
    packages: "external",
  });
  expect(build.success).toBe(true);
  const bundled = (
    await Promise.all(build.outputs.map((output) => output.text()))
  ).join("\n");
  expect(bundled).toContain("productionAdapters");
  expect(bundled).not.toContain("synthetic-test-only");
  expect(bundled).not.toContain("SyntheticSource");
  expect(bundled).not.toContain("adapters/testing/");
  // A registration cannot eagerly pull React presentation into the service.
  expect(bundled).not.toContain("react-dom");
}, 20000);
