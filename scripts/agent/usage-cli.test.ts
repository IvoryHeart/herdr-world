import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prUsageMain } from "./usage-cli";
import type { Runner } from "./usage-github";

async function fixture(pr: boolean, invalidPrompt = false, json = false) {
  const root = await mkdtemp(join(tmpdir(), "usage-cli-"));
  const path = join(root, "00000000-0000-4000-8000-000000000007.jsonl");
  const config = join(root, "config.json");
  await Bun.write(
    config,
    JSON.stringify({ roster: { firstmate: { model: "claude-opus-5-5" } } }),
  );
  await Bun.write(
    path,
    [
      JSON.stringify({
        type: "user",
        timestamp: invalidPrompt ? "invalid" : "2020-01-01T10:00:00.000Z",
        message: { content: "Coordinate #7" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2020-01-01T10:01:00.000Z",
        message: {
          id: "message",
          model: "claude-opus-5-5",
          usage: { output_tokens: 5 },
        },
      }),
      "{broken complete record}",
      "",
    ].join("\n"),
  );
  const runner: Runner = async (args) => {
    if (args[0] === "git") return `${join(root, ".git")}\n`;
    if (args[0] === "herdr")
      return JSON.stringify({
        result: {
          agents: [
            {
              name: "firstmate",
              agent: "claude",
              agent_session: { value: path },
            },
          ],
        },
      });
    if (args[0] === "gh" && args[1] === "repo") return "example/project\n";
    if (args[0] === "gh" && args[1] === "api" && args[2]?.includes("/reviews?"))
      return "[]";
    if (args[0] === "gh" && args[1] === "api")
      return JSON.stringify({ merged_at: null });
    throw new Error("Unexpected synthetic tool invocation");
  };
  const output: string[] = [];
  try {
    const status = await prUsageMain(
      [
        "roster-check",
        ...(pr ? ["--pr", "7"] : []),
        ...(json ? ["--json"] : []),
        "--config",
        config,
        "--store",
        join(root, "usage.sqlite"),
      ],
      {
        run: runner,
        log: (message) => output.push(message),
        warn: (message) => output.push(message),
      },
    );
    return { status, text: output.join("\n") };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("human roster reports explain partial measurement in global and PR scopes", async () => {
  for (const pr of [false, true]) {
    const result = await fixture(pr);
    expect(result.status).toBe(2);
    expect(result.text).toContain("match");
    expect(result.text).toContain("incomplete sessions: 1");
  }
});

test("human PR report retains damage relevance without a usable prompt timestamp", async () => {
  const result = await fixture(true, true);
  expect(result.status).toBe(2);
  expect(result.text).toContain("incomplete sessions: 1");
});

test("partial measurements cannot claim a clean JSON result in either scope", async () => {
  for (const pr of [false, true]) {
    const result = await fixture(pr, false, true);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.text)).toMatchObject({
      clean: false,
      incompleteSessions: 1,
    });
  }
});
