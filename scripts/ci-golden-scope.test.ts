import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { buildGraph } from "./affected";
import { goldenInputsChanged } from "./ci-golden-scope";

test("goldens follow renderer imports and assets while unrelated browser and server edits stay cheap", () => {
  const files = execFileSync("git", ["ls-files", "-z"])
    .toString()
    .split("\0")
    .filter(Boolean);
  const graph = buildGraph(process.cwd(), files);
  for (const path of [
    "web/src/world/town/town.css",
    "web/src/world/town/TownCanvas.tsx",
    "web/src/world/testing/town-golden/images/phone.png",
    "web/public/herdr-icon.png",
    "bun.lock",
    "tools/chrome/test-chrome.json",
  ])
    expect(goldenInputsChanged(graph, [path])).toBe(true);
  for (const path of [
    "server/src/agent/conversation.ts",
    "web/src/instanceName.ts",
    "docs/release.md",
  ])
    expect(goldenInputsChanged(graph, [path])).toBe(false);
});
