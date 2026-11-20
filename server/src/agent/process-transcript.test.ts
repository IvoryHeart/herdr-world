import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROCESS_TRANSCRIPT_LIMIT,
  processTranscriptCommand,
  processTranscriptSession,
} from "./process-transcript";
import { createAgentSessionFileAccess } from "./session-file-access";

const ID = "019a0000-0000-7000-8000-000000000001";
const OTHER = "11111111-2222-4333-8444-555555555555";
const rollout = (id = ID) =>
  `/work/demo/rollout-2026-11-20T09-00-00-${id}.jsonl`;
const descriptor = (path: string, access = "w", type = "REG") =>
  `f7\0a${access}\0t${type}\0n${path}\0`;
const evidence = (fds: string, before = "12345", after = before) =>
  Buffer.from(`${before}\0c/config\0${fds}s${after}\0`);

test("only unique writable native sessions name the foreground conversation", () => {
  expect(
    processTranscriptSession("codex", evidence(descriptor(rollout()))),
  ).toEqual({ kind: "path", value: rollout() });
  // Duplicate file handles are one session; read-only history is not a writer.
  expect(
    processTranscriptSession(
      "codex",
      evidence(
        descriptor(rollout(), "u") +
          descriptor(rollout()) +
          descriptor(rollout(OTHER), "r"),
      ),
    ),
  ).toEqual({ kind: "path", value: rollout() });
  for (const fds of [
    descriptor(rollout(), "r"),
    descriptor(rollout(), "w", "DIR"),
    descriptor(rollout()) + descriptor(rollout(OTHER)),
    descriptor(rollout()) +
      descriptor(rollout().replace("09-00-00", "10-00-00")),
    descriptor(`${rollout()} (deleted)`),
    descriptor("/work/demo/notes.jsonl"),
  ]) {
    expect(processTranscriptSession("codex", evidence(fds))).toBeNull();
  }
  const transcript = `/config/projects/-work-demo/${ID}.jsonl`;
  const debug = `/config/debug/${ID}.txt`;
  expect(
    processTranscriptSession("claude", evidence(descriptor(transcript))),
  ).toEqual({ kind: "path", value: transcript });
  expect(
    processTranscriptSession("claude", evidence(descriptor(debug))),
  ).toEqual({ kind: "id", value: ID });
  expect(
    processTranscriptSession(
      "claude",
      evidence(descriptor(debug) + descriptor(transcript)),
    ),
  ).toEqual({ kind: "path", value: transcript });
  expect(
    processTranscriptSession(
      "claude",
      evidence(descriptor(debug) + descriptor(`/config/debug/${OTHER}.txt`)),
    ),
  ).toBeNull();
  expect(
    processTranscriptSession(
      "claude",
      evidence(descriptor(`/work/demo/${ID}.jsonl`)),
    ),
  ).toBeNull();
  expect(
    processTranscriptSession(
      "claude",
      evidence(descriptor(`/work/demo/debug/${ID}.txt`)),
    ),
  ).toBeNull();
});

test("macOS lsof field records preserve spaces and newlines in paths", () => {
  const path = rollout().replace("/demo/", "/demo space\n/preview/../");
  expect(
    processTranscriptSession(
      "codex",
      evidence(`p4242\0\n${descriptor(path)}\n`),
    ),
  ).toBeNull();
  const valid = rollout().replace("/demo/", "/demo space\n/");
  expect(
    processTranscriptSession(
      "codex",
      evidence(
        `p4242\0\nf7\0au\0tREG\0n${valid}\0\n`,
        "Fri Nov 20 09:00:00 2026",
      ),
    ),
  ).toEqual({ kind: "path", value: valid });
});

test("gone/reused processes, torn records and bounded lookup failure are no evidence", () => {
  const fd = descriptor(rollout());
  for (const output of [
    evidence(fd, "123", "456"),
    evidence(fd, "", ""),
    evidence(fd).subarray(0, -1),
    evidence(fd.repeat(513)),
    evidence(descriptor("x".repeat(PROCESS_TRANSCRIPT_LIMIT))),
  ]) {
    expect(processTranscriptSession("codex", output)).toBeNull();
  }
  for (const pid of [0, 1, -1, 1.1, NaN, 2 ** 60])
    expect(() => processTranscriptCommand(pid)).toThrow(
      "Expected a process ID",
    );
});

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "native process descriptors discover only the live writer, never the newer sibling",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "world-process-chat-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = join(root, rollout().split("/").at(-1)!);
    await writeFile(path, "synthetic\n");
    await writeFile(
      join(root, rollout(OTHER).split("/").at(-1)!),
      "newer but unrelated\n",
    );
    const claudeRoot = join(root, "projects", "-work-demo");
    await mkdir(claudeRoot, { recursive: true });
    const claude = join(claudeRoot, `${ID}.jsonl`);
    await writeFile(claude, "synthetic\n");
    for (const [agent, transcript] of [
      ["codex", path],
      ["claude", claude],
    ] as const) {
      const child = Bun.spawn(
        ["sh", "-c", `exec 3>>${quote(transcript)}; printf ready; read line`],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      cleanups.push(async () => {
        child.kill();
        await child.exited;
      });
      const reader = child.stdout.getReader();
      await reader.read();
      reader.releaseLock();
      const command = Bun.spawn(
        ["sh", "-c", processTranscriptCommand(child.pid)],
        { stdout: "pipe", stderr: "pipe" },
      );
      const output = Buffer.from(
        await new Response(command.stdout).arrayBuffer(),
      );
      expect(await command.exited).toBe(0);
      expect(processTranscriptSession(agent, output)).toEqual({
        kind: "path",
        value: transcript,
      });
      child.kill();
      await child.exited;
      const gone = Bun.spawn(
        ["sh", "-c", processTranscriptCommand(child.pid)],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await gone.exited).toBe(44);
    }
  },
);

test("SSH discovery runs against the captured agent host and fails closed", async () => {
  let result = { code: 0, stdout: evidence(descriptor(rollout())), stderr: "" };
  const files = createAgentSessionFileAccess({
    sshHost: "agent@example.com",
    shQuote: quote,
    async runBinaryProcessWithTimeout(argv, timeout) {
      expect(argv).toContain("agent@example.com");
      expect(argv.at(-1)).toContain("pid=4242");
      expect(timeout).toBe(3000);
      return result;
    },
  });
  expect(await files.findAgentSessionForProcess!("codex", 4242)).toEqual({
    kind: "path",
    value: rollout(),
  });
  result = {
    code: 1,
    stdout: evidence(descriptor(rollout())),
    stderr: "permission denied",
  };
  expect(await files.findAgentSessionForProcess!("codex", 4242)).toBeNull();
});
