import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import type { ApartmentResident } from "../../../shared/apartments";
import { readApartmentHistory } from "./apartment-history";
import { apartmentResumeLaunch } from "./apartment-resume";

const SESSION = "0f0e0d0c-0000-4000-8000-0000000000a1";
let root = "";
let transcript = "";
const at = (second: number) =>
  new Date(Date.UTC(2026, 10, 19, 9, 0, second)).toISOString();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hcw-apartment-history-"));
  transcript = join(root, `${SESSION}.jsonl`);
  const lines = [
    {
      type: "user",
      timestamp: at(0),
      sessionId: SESSION,
      message: { role: "user", content: "Fix the synthetic widget" },
    },
    {
      type: "assistant",
      timestamp: at(5),
      sessionId: SESSION,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Fixed it and opened PR #42." }],
      },
    },
  ];
  await writeFile(
    transcript,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A host whose only Claude transcript is the synthetic one. */
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
    findClaudeSessionById: async (id: string) =>
      id === SESSION ? file(transcript) : null,
    findClaudeSuccessor: async () => null,
  } as unknown as AgentSessionFileAccess;
}

const resident: ApartmentResident = {
  id: "r-1",
  name: "ada",
  harness: "claude",
  cwd: "/srv/example/project-alpha",
  room: "alpha",
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
};

describe("a resident's history comes from its harness transcript", () => {
  test("the conversation and the closing report are read by session ID", async () => {
    const history = await readApartmentHistory(resident, files());
    expect(history.status).toBe("ok");
    expect(history.messages.map((message) => message.text)).toEqual([
      "Fix the synthetic widget",
      "Fixed it and opened PR #42.",
    ]);
    expect(history.report).toBe("Fixed it and opened PR #42.");
  });

  test("an unknown or missing session reads as unavailable", async () => {
    expect(
      (await readApartmentHistory({ ...resident, session_id: null }, files()))
        .status,
    ).toBe("unavailable");
    expect(
      (
        await readApartmentHistory(
          { ...resident, session_id: "0f0e0d0c-0000-4000-8000-0000000000ff" },
          files(),
        )
      ).status,
    ).toBe("unavailable");
  });
});

describe("resuming a resident", () => {
  test("starts its harness with the harness's own resume arguments", () => {
    expect(apartmentResumeLaunch(resident, "local")).toEqual({
      kind: "claude",
      label: "ada",
      args: ["--resume", SESSION],
      text: "",
    });
    expect(
      apartmentResumeLaunch(
        { ...resident, harness: "codex", session_id: "019a-b" },
        "local",
      ).args,
    ).toEqual(["resume", "019a-b"]);
  });

  test("is refused on another host, without a session or for unknown harnesses", () => {
    expect(() => apartmentResumeLaunch(resident, "other")).toThrow(
      /This computer/,
    );
    expect(() =>
      apartmentResumeLaunch({ ...resident, session_id: null }, "local"),
    ).toThrow(/resume/);
    expect(() =>
      apartmentResumeLaunch({ ...resident, harness: "pi" }, "local"),
    ).toThrow(/resume/);
    expect(() =>
      apartmentResumeLaunch({ ...resident, session_id: "-rm" }, "local"),
    ).toThrow(/resume/);
    expect(() => apartmentResumeLaunch(undefined, "local")).toThrow(
      /moved out/,
    );
  });
});
