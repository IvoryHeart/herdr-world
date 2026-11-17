import { expect, test } from "bun:test";
import { RuntimeGenerationCatalogue } from "./runtimeGenerations";
test("a TUI catalogue refresh preserves core Files; core staleness retires only its lease", () => {
  const generations = new Map<string, number>(),
    leases = new Map<string, object>();
  const catalog = new RuntimeGenerationCatalogue(generations, leases);
  catalog.setHosts([{ id: "tui", generation: 1 }]);
  const tui = leases.get("tui");
  catalog.setCore([{ id: "core", generation: 2 }]);
  const core = leases.get("core");
  catalog.setHosts([{ id: "tui", generation: 1 }]);
  expect(leases.get("core")).toBe(core);
  catalog.setCore([]);
  expect(leases.has("core")).toBe(false);
  expect(leases.get("tui")).toBe(tui);
  catalog.setCore([{ id: "core", generation: 2 }]);
  expect(leases.get("core")).not.toBe(core);
});
