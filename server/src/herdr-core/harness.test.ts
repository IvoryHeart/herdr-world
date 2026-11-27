import { expect, test } from "bun:test";
import { foregroundHarness, harnessName } from "./harness";

for (const argv of [
  ["python3", "-i", "tool.py", "claude"],
  ["node", "-i", "--title", "claude"],
  ["node", "--interactive", "/opt/claude.js"],
  ["node", "--inspect", "--interactive", "/opt/claude.js"],
  ["python3", "-ic", "claude"],
  ["node", "--eval", "claude"],
  ["node", "--print", "claude"],
  ["node", "--title", "claude", "tool.js"],
  ["node", "tool.js", "claude"],
  ["python3", "tool.py", "claude"],
  ["node", "-", "claude"],
])
  test(`input refuses interpreter argv ${JSON.stringify(argv)}`, () => {
    expect(foregroundHarness(argv[0], argv)).toBeNull();
  });

for (const [argv, harness] of [
  [["node", "/opt/codex.js"], "codex"],
  [["node", "--no-warnings", "/opt/gemini"], "gemini"],
  [["python3", "-u", "/opt/claude.py"], "claude"],
  [["node", "--", "/opt/pi.js"], "pi"],
  [["node", "/opt/node_modules/@anthropic-ai/claude-code/cli.js"], "claude"],
  [["node", "/opt/node_modules/@google/gemini-cli/dist/index.js"], "gemini"],
  [
    ["node", "/opt/node_modules/@mariozechner/pi-coding-agent/dist/cli.js"],
    "pi",
  ],
] as const)
  test(`input accepts the actual ${harness} script`, () => {
    expect(foregroundHarness("node", [...argv])).toBe(harness);
  });

test("muse-code is a supported alias", () => {
  expect(harnessName("muse-code")).toBe("muse");
  expect(foregroundHarness("muse-code")).toBe("muse");
});
