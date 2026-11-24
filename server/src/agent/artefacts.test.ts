import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artefactId,
  callWorkingDirectories,
  localArtefactStat,
  ownedArtefacts,
  sessionArtefacts,
  withArtefactPresence,
} from "./artefacts";
import { projectAgentTrajectory } from "./session-trajectory";
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
    const owned = ownedArtefacts(local, "host-a", () => ({
      connection_id: "host-a",
      pane_id: "w1:p1",
      agent: "claude",
      workspace_id: "w1",
      session: null,
    }));
    expect(owned.map(parseAgentArtefact)).toEqual(owned);
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

test("the same path on two connections is two artefacts; one host's place is one", () => {
  const found = sessionArtefacts(
    trajectory([call("1", "Write", { file_path: "/work/report.md" })]),
  );
  const maker = (connection_id: string) => () => ({
    connection_id,
    pane_id: "w1:p1",
    agent: "codex",
    workspace_id: "w1",
    session: null,
  });
  const present = found.map((entry) => ({ ...entry, exists: true }));
  const [first] = ownedArtefacts(present, "host-a", maker("host-a"));
  const [second] = ownedArtefacts(present, "host-b", maker("host-b"));
  expect(first!.id).not.toBe(second!.id);
  expect(first!.id).toBe(artefactId("host-a", "file:/work/report.md"));
  expect(first!.made_by.connection_id).toBe("host-a");
  expect(second!.made_by.connection_id).toBe("host-b");
});

const file = { path: "/sessions/rollout.jsonl", mtimeMs: 0 };

test("Codex: a relative Add File resolves against the cwd of its own turn", () => {
  const patch = (name: string) =>
    `*** Begin Patch\n*** Add File: ${name}\n+# x\n*** End Patch`;
  const records = [
    { type: "session_meta", payload: { cwd: "/work/first" } },
    { type: "turn_context", payload: { cwd: "/work/first" } },
    {
      type: "response_item",
      timestamp: "2026-11-23T10:00:00.000Z",
      payload: {
        type: "custom_tool_call",
        call_id: "c1",
        name: "apply_patch",
        input: patch("report.md"),
      },
    },
    { type: "turn_context", payload: { cwd: "/work/second" } },
    {
      type: "response_item",
      timestamp: "2026-11-23T10:05:00.000Z",
      payload: {
        type: "custom_tool_call",
        call_id: "c2",
        name: "apply_patch",
        input: patch("notes.md"),
      },
    },
    {
      type: "response_item",
      timestamp: "2026-11-23T10:06:00.000Z",
      payload: {
        type: "function_call",
        call_id: "c3",
        name: "shell",
        // A shell call's own workdir wins over its turn's cwd.
        arguments: JSON.stringify({
          command: ["apply_patch", patch("plan.md")],
          workdir: "/work/third",
        }),
      },
    },
  ];
  const found = sessionArtefacts(
    projectAgentTrajectory("codex", file, records),
    callWorkingDirectories("codex", records),
  );
  expect(found.map((entry) => entry.where)).toEqual([
    { type: "file", path: "/work/third/plan.md" },
    { type: "file", path: "/work/second/notes.md" },
    { type: "file", path: "/work/first/report.md" },
  ]);
});

test("Claude Code: each tool_use resolves against its own record's cwd", () => {
  const write = (id: string, cwd: string, path: string) => ({
    type: "assistant",
    uuid: id,
    cwd,
    timestamp: "2026-11-23T10:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name: "NotebookEdit",
          input: { notebook_path: path },
        },
      ],
    },
  });
  const records = [
    write("t1", "/work/first", "analysis.ipynb"),
    write("t2", "/work/second", "findings.ipynb"),
  ];
  const cwdOf = callWorkingDirectories("claude", records);
  expect([cwdOf("t1"), cwdOf("t2"), cwdOf("unknown")]).toEqual([
    "/work/first",
    "/work/second",
    // Two cwds: a call the records do not place is not guessed.
    undefined,
  ]);
  expect(
    sessionArtefacts(projectAgentTrajectory("claude", file, records), cwdOf)
      .map((entry) => entry.where)
      .reverse(),
  ).toEqual([
    { type: "file", path: "/work/first/analysis.ipynb" },
    { type: "file", path: "/work/second/findings.ipynb" },
  ]);
});
