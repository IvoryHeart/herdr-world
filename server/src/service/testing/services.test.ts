import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testServerConfig, testServicePaths } from "./services";

test("test services seal their ports and registry unless peers explicitly share a scratch store", () => {
  const root = mkdtempSync(join(tmpdir(), "service-paths-"));
  try {
    const first = join(root, "first"),
      second = join(root, "second");
    expect(testServicePaths(first).instanceRegistry).toBe(
      join(first, "instances"),
    );
    expect(testServicePaths(second).instanceRegistry).toBe(
      join(second, "instances"),
    );
    expect(testServicePaths(first).root).toBe(first);
    const registry = join(root, "shared-instances");
    for (const path of [first, second]) {
      expect(
        testServicePaths(path, { HERDR_WORLD_INSTANCE_REGISTRY_DIR: registry })
          .instanceRegistry,
      ).toBe(registry);
      expect(testServerConfig(path)).toMatchObject({
        host: "127.0.0.1",
        port: 0,
        socketPath: join(path, "missing-control.sock"),
        clientSocketPath: join(path, "missing-render.sock"),
      });
    }
    // Setting unrelated platform roots never opts a test into discovery sharing.
    const platformRoots = {
      XDG_STATE_HOME: join(root, "state"),
      LOCALAPPDATA: join(root, "local"),
    };
    expect(testServicePaths(first, platformRoots).instanceRegistry).toBe(
      join(first, "instances"),
    );
    expect(testServicePaths(second, platformRoots).instanceRegistry).toBe(
      join(second, "instances"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
