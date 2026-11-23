import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localArtefactStat,
  sessionArtefacts,
  withArtefactPresence,
} from "./artefacts";
import type { AtifStep, AtifTrajectory } from "./session-types";
import {
  artefactKindForPath,
  parseAgentArtefact,
} from "../../../shared/agentArtefacts";

const trajectory = (steps: Omit<AtifStep, "step_id">[]): AtifTrajectory => ({
  schema_version: "ATIF-v1.7",
  agent: { name: "test", version: "1" },
  steps: steps.map((step, index) => ({ step_id: index + 1, ...step })),
});
const call = (
  id: string,
  name: string,
  args: Record<string, unknown>,
  at = "2026-11-23T10:00:00.000Z",
): Omit<AtifStep, "step_id"> => ({
  timestamp: at,
  source: "agent",
  message: `Tool call: ${name}`,
  tool_calls: [{ tool_call_id: id, function_name: name, arguments: args }],
});
const result = (
  id: string,
  content: string,
  at = "2026-11-23T10:01:00.000Z",
): Omit<AtifStep, "step_id"> => ({
  timestamp: at,
  source: "system",
  message: "Tool result",
  observation: { results: [{ source_call_id: id, content }] },
});
const say = (
  message: string,
  at = "2026-11-23T10:02:00.000Z",
): Omit<AtifStep, "step_id"> => ({ timestamp: at, source: "agent", message });

test("Claude Write of a report and Codex Add File are reliable file artefacts", () => {
  const found = sessionArtefacts(
    trajectory([
      call("1", "Write", {
        file_path: "/work/repo/docs/weekly-report.md",
        content: "# Report",
      }),
      call("2", "apply_patch", {
        input:
          "*** Begin Patch\n*** Add File: notes/diagram.svg\n+<svg/>\n*** Update File: src/a.ts\n*** End Patch",
      }),
      // Edits of existing files and code files are not artefacts.
      call("3", "Edit", { file_path: "/work/repo/README.md" }),
      call("4", "Write", { file_path: "/work/repo/src/index.ts" }),
    ]),
    "/work/repo",
  );
  expect(
    found.map((entry) => [entry.title, entry.kind, entry.evidence]),
  ).toEqual([
    ["diagram.svg", "image", "patch_add"],
    ["weekly-report.md", "report", "file_write"],
  ]);
  expect(found[0]!.where).toEqual({
    type: "file",
    path: "/work/repo/notes/diagram.svg",
  });
  expect(found[1]!.made_at).toBe("2026-11-23T10:00:00.000Z");
});

test("a relative path without the session cwd and harness bookkeeping are skipped", () => {
  expect(
    sessionArtefacts(
      trajectory([
        call("1", "apply_patch", { input: "*** Add File: plan.md\n" }),
        call("2", "Write", {
          file_path: "/work/.claude/projects/x/memory/note.md",
        }),
      ]),
    ),
  ).toEqual([]);
});

test("links: publishing output is reliable, a link in a reply is a guess", () => {
  const found = sessionArtefacts(
    trajectory([
      call("1", "Bash", { command: "gh pr create --fill" }),
      result("1", "https://github.com/example/repo/pull/12\n"),
      call("2", "Bash", { command: "ls" }),
      result("2", "https://example.com/not-published"),
      say("Published the page at https://example.org/report.html."),
      say("Secret https://user:pw@example.com/x is never kept."),
    ]),
  );
  expect(
    found.map((entry) => [
      entry.title,
      entry.kind,
      entry.evidence,
      entry.where,
    ]),
  ).toEqual([
    [
      "example.org/report.html",
      "page",
      "agent_message",
      {
        type: "link",
        url: "https://example.org/report.html",
        link_kind: "url",
      },
    ],
    [
      "example/repo#12",
      "page",
      "publish_command",
      {
        type: "link",
        url: "https://github.com/example/repo/pull/12",
        link_kind: "pull_request",
      },
    ],
  ]);
});

test("a place mentioned again keeps its strongest evidence and newest time", () => {
  const found = sessionArtefacts(
    trajectory([
      call("1", "Write", { file_path: "/w/a.md" }, "2026-11-23T09:00:00.000Z"),
      call("2", "Write", { file_path: "/w/b.md" }, "2026-11-23T09:30:00.000Z"),
      call("3", "Write", { file_path: "/w/a.md" }, "2026-11-23T10:00:00.000Z"),
    ]),
  );
  expect(found.map((entry) => [entry.title, entry.made_at])).toEqual([
    ["a.md", "2026-11-23T10:00:00.000Z"],
    ["b.md", "2026-11-23T09:30:00.000Z"],
  ]);
});

test("presence: a deleted file is gone, links and unchecked hosts are unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "artefacts-"));
  try {
    await writeFile(join(root, "kept.md"), "kept");
    const candidates = sessionArtefacts(
      trajectory([
        call("1", "Write", { file_path: join(root, "kept.md") }),
        call("2", "Write", { file_path: join(root, "gone.md") }),
        say("See https://example.com/page"),
      ]),
    );
    const local = await withArtefactPresence(candidates, localArtefactStat);
    expect(local.map((entry) => [entry.title, entry.exists])).toEqual([
      ["example.com/page", null],
      ["gone.md", false],
      ["kept.md", true],
    ]);
    const remote = await withArtefactPresence(candidates, null);
    expect(remote.every((entry) => entry.exists === null)).toBe(true);
    // Every record survives the browser's wire check unchanged.
    expect(local.map(parseAgentArtefact)).toEqual(local);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kinds come from the file name", () => {
  expect(artefactKindForPath("/a/plan.md")).toBe("report");
  expect(artefactKindForPath("/a/guide.md")).toBe("document");
  expect(artefactKindForPath("/a/site/index.html")).toBe("page");
  expect(artefactKindForPath("/a/shot.png")).toBe("image");
  expect(artefactKindForPath("/a/flow.mmd")).toBe("file");
  expect(artefactKindForPath("/a/main.go")).toBeNull();
  expect(artefactKindForPath("/a/.env")).toBeNull();
  expect(parseAgentArtefact({ id: "x" })).toBeNull();
});
