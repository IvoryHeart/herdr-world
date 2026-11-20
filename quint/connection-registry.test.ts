import { expect, test } from "bun:test";
import { replayRegistryMatrix } from "./connection-registry";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestCli } from "../server/src/cli/test-context";
import { createConnectionsCommand } from "../server/src/cli/connections";
import { runCli } from "../server/src/cli/index";

test("all 48 registry writer, arrival, persistence and retry schedules preserve successful edits", async () => {
  expect((await replayRegistryMatrix()).configurations).toBe(48);
});

test("two successful offline CLI writers preserve both additions", async () => {
  const cli = createTestCli();
  cli.writeConfig("");
  const add = (id: string) =>
    runCli(["connections", "add", id, "--core"], cli.context, [
      createConnectionsCommand({
        probe: async () => false,
        herdrInstalled: async () => false,
      }),
    ]);
  try {
    expect(await add("alpha")).toBe(0);
    expect(await Promise.all([add("beta"), add("gamma")])).toEqual([0, 0]);
    const saved = JSON.parse(
      readFileSync(
        join(cli.home, ".config", "herdr-world", "connections.json"),
        "utf8",
      ),
    );
    expect(saved.profiles.map((p: { id: string }) => p.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  } finally {
    cli.cleanup();
  }
});
