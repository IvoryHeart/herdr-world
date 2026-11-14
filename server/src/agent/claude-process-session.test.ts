import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_PROCESS_RECORD_LIMIT,
  claudeConfigDirectory,
  claudeProcessRecordCommand,
  claudeProcessSession,
} from "./claude-process-session";
import { createAgentSessionFileAccess } from "./session-file-access";

const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "11111111-2222-4333-8444-555555555555";

// The shape Claude Code writes, with synthetic values.
const record = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid: 4242,
    sessionId: SESSION,
    cwd: "/srv/example/project",
    startedAt: 1_700_000_000_000,
    procStart: "987654",
    version: "2.1.0",
    kind: "interactive",
    entrypoint: "cli",
    ...fields,
  });
const output = (before: string, after: string, text: string) =>
  `${before}\n${after}\n${text}`;

describe("Claude's own process record", () => {
  test("names the session only while the process is the one that wrote it", () => {
    expect(
      claudeProcessSession(4242, output("987654", "987654", record())),
    ).toBe(SESSION);
    // After /clear or /resume Claude rewrites the record: the current one wins.
    expect(
      claudeProcessSession(
        4242,
        output("987654", "987654", record({ sessionId: OTHER })),
      ),
    ).toBe(OTHER);
    // macOS reports the start as a date (C locale, UTC).
    const lstart = "Fri Nov  7 10:50:00 2026";
    expect(
      claudeProcessSession(
        4242,
        output(lstart, lstart, record({ procStart: lstart })),
      ),
    ).toBe(SESSION);
  });

  test("a record left by a killed agent never names a reused pid's conversation", () => {
    // Same pid, another process: its start time differs from the record's.
    expect(
      claudeProcessSession(4242, output("999999", "999999", record())),
    ).toBeNull();
    // The process changed while the record was read.
    expect(
      claudeProcessSession(4242, output("987654", "999999", record())),
    ).toBeNull();
    // The process is gone: no start time.
    expect(claudeProcessSession(4242, output("", "", record()))).toBeNull();
    // A record without a start time is no evidence.
    expect(
      claudeProcessSession(
        4242,
        output("987654", "987654", record({ procStart: undefined })),
      ),
    ).toBeNull();
  });

  test("anything torn, foreign or unexpected is no evidence", () => {
    const at = (text: string) =>
      claudeProcessSession(4242, output("987654", "987654", text));
    expect(at(record({ pid: 4243 }))).toBeNull();
    expect(at(record({ pid: "4242" }))).toBeNull();
    expect(at(record({ sessionId: "../../elsewhere" }))).toBeNull();
    expect(at(record({ sessionId: 7 }))).toBeNull();
    expect(at(record().slice(0, 40))).toBeNull();
    expect(at("null")).toBeNull();
    expect(at("[]")).toBeNull();
    expect(
      at(record({ pad: "x".repeat(CLAUDE_PROCESS_RECORD_LIMIT) })),
    ).toBeNull();
    expect(claudeProcessSession(4242, "987654")).toBeNull();
    expect(claudeProcessSession(4242, "")).toBeNull();
  });

  test("only a process ID is formatted into the host command", () => {
    for (const pid of [0, 1, -5, 1.5, Number.NaN, 2 ** 60])
      expect(() => claudeProcessRecordCommand(pid)).toThrow(
        "Expected a process ID.",
      );
    expect(claudeProcessRecordCommand(4242)).toContain("pid=4242\n");
  });
});

const scratch: string[] = [];
const children: { kill(): void }[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "linux")(
  "the host command on Linux",
  () => {
    async function run(pid: number, config: string) {
      const child = Bun.spawn(["sh", "-c", claudeProcessRecordCommand(pid)], {
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: config,
          CLAUDE_CONFIG_DIR: config,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(child.stdout).text();
      return { code: await child.exited, stdout };
    }

    test("binds the record to the live process, whatever its name", async () => {
      const dir = mkdtempSync(join(tmpdir(), "claude-process-"));
      scratch.push(dir);
      mkdirSync(join(dir, "sessions"));
      // A process name with spaces and ")" must not shift the start-time field.
      // The kernel names the process after the executed file, so link a
      // program that ignores its own name: multicall coreutils such as
      // uutils refuse to run `sleep` under another name. The shell blocks on
      // its open stdin until the test kills it.
      const odd = join(dir, "a) b c");
      symlinkSync(Bun.which("sh")!, odd);
      const child = Bun.spawn([odd, "-c", "read line"], { stdin: "pipe" });
      children.push(child);
      const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
      const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
      expect(stat).toContain("(a) b c)");

      expect((await run(child.pid, dir)).code).toBe(44);

      const file = join(dir, "sessions", `${child.pid}.json`);
      writeFileSync(file, record({ pid: child.pid, procStart: start }));
      const live = await run(child.pid, dir);
      expect(live.code).toBe(0);
      expect(claudeProcessSession(child.pid, live.stdout)).toBe(SESSION);

      // The same pid with another start time: a previous agent's record.
      writeFileSync(file, record({ pid: child.pid, procStart: `${start}1` }));
      expect(
        claudeProcessSession(child.pid, (await run(child.pid, dir)).stdout),
      ).toBeNull();

      // The agent exits; its record stays behind and names nothing.
      writeFileSync(file, record({ pid: child.pid, procStart: start }));
      child.kill();
      await child.exited;
      const gone = await run(child.pid, dir);
      expect(gone.code).toBe(0);
      expect(claudeProcessSession(child.pid, gone.stdout)).toBeNull();
    });
  },
);

test("an SSH host runs the same command through its login shell", async () => {
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const seen: string[][] = [];
  let reply = { code: 0, stdout: "", stderr: "" };
  const files = createAgentSessionFileAccess({
    sshHost: "host.example",
    shQuote: quote,
    async runBinaryProcessWithTimeout(argv) {
      seen.push(argv);
      return { ...reply, stdout: Buffer.from(reply.stdout) };
    },
  });
  reply = { code: 0, stdout: output("987654", "987654", record()), stderr: "" };
  expect(await files.findClaudeSessionForProcess!(4242)).toBe(SESSION);
  expect(seen[0]).toContain("host.example");
  expect(seen[0]!.at(-1)).toContain(
    `bash -lc ${quote(claudeProcessRecordCommand(4242))}`,
  );
  reply = { code: 44, stdout: "", stderr: "" };
  expect(await files.findClaudeSessionForProcess!(4242)).toBeNull();
  reply = { code: 1, stdout: "", stderr: "permission denied" };
  await expect(files.findClaudeSessionForProcess!(4242)).rejects.toThrow(
    "permission denied",
  );
});

test("the transcript directory is the one the host command reads records from", async () => {
  const cases = [
    { HOME: "/home/example" },
    { HOME: "/home/example", CLAUDE_CONFIG_DIR: "" },
    { HOME: "/home/example", CLAUDE_CONFIG_DIR: "/srv/example/claude" },
  ];
  for (const env of cases) {
    const child = Bun.spawn(
      ["sh", "-c", 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'],
      { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env } },
    );
    expect(claudeConfigDirectory(env)).toBe(
      await new Response(child.stdout).text(),
    );
  }
});
