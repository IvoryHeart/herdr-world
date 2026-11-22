import { expect, test } from "bun:test";
import { UsageError } from "./command";
import { parseBoardElementArgs } from "./world-elements";

test("put names a Library memory and a log's apartment", () => {
  expect(
    parseBoardElementArgs([
      "put",
      "memory",
      "decisions",
      "--title",
      "Decisions",
      "--connection",
      "studio",
      "--memory-source",
      "source-a",
      "--path",
      "decisions.md",
    ]).params.element,
  ).toEqual({
    id: "decisions",
    kind: "memory",
    title: "Decisions",
    x: 0,
    y: 0,
    source: {
      connection_id: "studio",
      memory_source_id: "source-a",
      path: "decisions.md",
    },
  });
  expect(
    parseBoardElementArgs([
      "put",
      "log",
      "run",
      "--title",
      "Run",
      "--connection",
      "studio",
      "--workspace",
      "project-a",
      "--path",
      "logs/run.jsonl",
      "--apartment",
      "resident-a",
    ]).params.element,
  ).toMatchObject({
    source: { path: "logs/run.jsonl", apartment_id: "resident-a" },
  });
  // A Library memory has no default entry, and each flag fits one kind.
  for (const args of [
    ["memory", "m", "--connection", "studio", "--memory-source", "source-a"],
    ["log", "l", "--connection", "studio", "--memory-source", "source-a"],
    ["memory", "m", "--connection", "studio", "--apartment", "resident-a"],
  ])
    expect(() =>
      parseBoardElementArgs(["put", ...args, "--title", "T"]),
    ).toThrow(UsageError);
});
