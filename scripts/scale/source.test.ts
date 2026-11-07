import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HerdrClient } from "../../server/src/bridge/herdr-client";
import { shapes } from "./fixture";
import { syntheticSources } from "./source";
import { deadline } from "./support";

test("synthetic events use native envelopes and mutate only their own connection input", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hws-source-test-"));
  const sources = await syntheticSources(shapes[0]!, scratch);
  const client = new HerdrClient(sources.profiles[0]!.control_socket_path);
  try {
    const next = Promise.withResolvers<any>();
    client.once("event", next.resolve);
    const subscription = client.subscribe(["workspace.renamed"]);
    await subscription.ready;
    const previous = sources.hosts[1]!.workspaces[0]!.label;
    const label = sources.emit(0);
    expect(await deadline(next.promise, "synthetic native event")).toEqual({
      event: "workspace.renamed",
      data: { workspace_id: "w0", label },
    });
    expect(sources.hosts[1]!.workspaces[0]!.label).toBe(previous);
    const result = await client.call("workspace.list");
    expect(result.workspaces[0].label).toBe(label);
    subscription.close();
  } finally {
    client.close();
    await sources.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
