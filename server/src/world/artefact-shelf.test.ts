import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentArtefact } from "../../../shared/agentArtefacts";
import type { ApartmentResident } from "../../../shared/apartments";
import { artefactId } from "../agent/artefacts";
import type { AgentQuest } from "../agent/quest";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import {
  SHELF_RESIDENT_TTL_MS,
  createArtefactShelf,
  type ArtefactShelfHost,
  type ArtefactShelfRoom,
} from "./artefact-shelf";

const SESSION = "0f0e0d0c-0000-4000-8000-0000000000b7";
const REPORT = "/srv/example/project-alpha/docs/weekly-report.md";
const PLAN = "/srv/example/project-alpha/docs/plan.md";
let root = "";
let transcript = "";
let reads = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hcw-artefact-shelf-"));
  transcript = join(root, `${SESSION}.jsonl`);
  const write = (id: string, path: string, second: number) => ({
    type: "assistant",
    timestamp: new Date(Date.UTC(2026, 10, 20, 9, 0, second)).toISOString(),
    sessionId: SESSION,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name: "Write",
          input: { file_path: path, content: "# synthetic" },
        },
      ],
    },
  });
  const lines = [
    {
      type: "user",
      timestamp: new Date(Date.UTC(2026, 10, 20, 9, 0, 0)).toISOString(),
      sessionId: SESSION,
      message: { role: "user", content: "Write the synthetic report" },
    },
    write("toolu_1", REPORT, 5),
    write("toolu_2", PLAN, 9),
  ];
  await writeFile(
    transcript,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A remote host whose only Claude transcript is the synthetic one. */
function files(): AgentSessionFileAccess {
  const file = async (path: string) => {
    const info = await stat(path).catch(() => null);
    return info
      ? {
          path,
          name: path.split("/").at(-1)!,
          size: info.size,
          mtimeMs: info.mtimeMs,
          identity: path,
          changeToken: String(info.mtimeMs),
        }
      : null;
  };
  return {
    remote: true,
    statFile: file,
    readText: (path: string) => Bun.file(path).text(),
    readPrefix: async (path: string, limit: number) =>
      new Uint8Array(await Bun.file(path).arrayBuffer()).slice(0, limit),
    readDownloadBody: (path: string) => Bun.file(path).text(),
    findPiSessionById: async () => null,
    findClaudeSessionById: async (id: string) => {
      reads += 1;
      return id === SESSION ? file(transcript) : null;
    },
    findClaudeSuccessor: async () => null,
  } as unknown as AgentSessionFileAccess;
}

const resident = (
  over: Partial<ApartmentResident> = {},
): ApartmentResident => ({
  id: "r-1",
  name: "ada",
  harness: "claude",
  cwd: "/srv/example/project-alpha",
  room: "Project Alpha",
  tab: "builder",
  connection_id: "local",
  connection_label: "This computer",
  runtime: "herdr",
  terminal_id: "t1",
  first_seen_at: 1,
  moved_out_at: 2,
  move_out: "ended",
  summary: null,
  last_report: null,
  links: [],
  session_id: SESSION,
  appearance: null,
  ...over,
});

const liveLink: AgentArtefact = {
  id: artefactId("local", "link:https://github.com/example/app/pull/7"),
  title: "example/app#7",
  kind: "page",
  where: {
    type: "link",
    url: "https://github.com/example/app/pull/7",
    link_kind: "pull_request",
  },
  made_at: "2026-11-20T10:00:00.000Z",
  evidence: "publish_command",
  exists: null,
  made_by: {
    connection_id: "local",
    pane_id: "p2",
    agent: "codex",
    workspace_id: "w-beta",
    session: null,
  },
};

function shelfOver({
  quests = [] as AgentArtefact[][],
  residents = [resident()],
  now = { value: 1_000 },
  rooms = [
    { workspace_id: "w-alpha", label: "Project Alpha" },
    { workspace_id: "w-beta", label: "Project Beta" },
  ] as ArtefactShelfRoom[] | Error,
} = {}) {
  const host: ArtefactShelfHost = {
    quests: async () =>
      quests.map((artefacts) => ({ artefacts }) as unknown as AgentQuest),
    files: files(),
    rooms: async () => {
      if (rooms instanceof Error) throw rooms;
      return rooms;
    },
  };
  return createArtefactShelf({
    host: (connectionId, generation) =>
      connectionId === "local" && generation === 4 ? host : null,
    residents: () => residents,
    now: () => now.value,
  });
}

test("a gone agent's work stays on the shelf, its maker named as it was", async () => {
  const shelf = await shelfOver({ quests: [[liveLink]] }).list("local", 4);
  expect(shelf.connection_generation).toBe(4);
  expect(shelf.truncated).toBe(false);
  expect(
    shelf.artefacts.map((one) => [
      one.title,
      one.gone_maker,
      one.made_by.pane_id,
    ]),
  ).toEqual([
    ["example/app#7", null, "p2"],
    ["plan.md", "ada", "t1"],
    ["weekly-report.md", "ada", "t1"],
  ]);
  const report = shelf.artefacts.at(-1)!;
  // Apartments keeps the room's label; the shelf names the room by its ID.
  expect(report.made_by.workspace_id).toBe("w-alpha");
  expect(report.gone_room).toBe("Project Alpha");
  expect(report.where).toEqual({ type: "file", path: REPORT });
  // A remote host's files are not checked here: presence stays unknown.
  expect(report.exists).toBeNull();
});

test("a running maker's record of the same place wins over a gone one's", async () => {
  const id = artefactId("local", `file:${REPORT}`);
  const running: AgentArtefact = {
    ...liveLink,
    id,
    title: "weekly-report.md",
    kind: "report",
    where: { type: "file", path: REPORT },
    made_at: "2026-11-19T00:00:00.000Z",
    evidence: "file_write",
    exists: true,
  };
  const shelf = await shelfOver({ quests: [[running]] }).list("local", 4);
  const report = shelf.artefacts.filter((one) => one.id === id);
  expect(report).toHaveLength(1);
  expect(report[0]!.gone_maker).toBeNull();
  expect(report[0]!.made_by.pane_id).toBe("p2");
});

test("another generation or host is refused, never answered from another", async () => {
  const shelf = shelfOver();
  await expect(shelf.list("local", 3)).rejects.toThrow("not connected");
  await expect(shelf.list("other", 4)).rejects.toThrow("not connected");
});

test("residents of other hosts or without a session add nothing", async () => {
  const shelf = await shelfOver({
    residents: [
      resident({ connection_id: "other" }),
      resident({ id: "r-2", session_id: null }),
    ],
  }).list("local", 4);
  expect(shelf.artefacts).toEqual([]);
});

test("a gone agent's transcript is read again only after a while", async () => {
  const now = { value: 50_000 };
  const shelf = shelfOver({ now });
  const before = reads;
  await shelf.list("local", 4);
  const first = reads;
  expect(first).toBeGreaterThan(before);
  await shelf.list("local", 4);
  expect(reads).toBe(first);
  now.value += SHELF_RESIDENT_TTL_MS;
  const again = await shelf.list("local", 4);
  expect(reads).toBeGreaterThan(first);
  expect(again.artefacts).toHaveLength(2);
});

test("a gone maker's room label that no single room has now stays unknown", async () => {
  for (const rooms of [
    [{ workspace_id: "w-beta", label: "Project Beta" }],
    [
      { workspace_id: "w-alpha", label: "Project Alpha" },
      { workspace_id: "w-other", label: "Project Alpha" },
    ],
    new Error("listWorkspaces timed out"),
  ]) {
    const shelf = await shelfOver({ rooms }).list("local", 4);
    expect(shelf.artefacts).toHaveLength(2);
    for (const artefact of shelf.artefacts) {
      expect(artefact.made_by.workspace_id).toBeNull();
      expect(artefact.gone_room).toBe("Project Alpha");
    }
  }
});
