import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionHandlers } from "./agent-sessions";
import {
  createAgentSessionFileAccess,
  localAgentSessionFiles,
  type AgentSessionFileAccess,
} from "./session-file-access";
import { shQuote } from "../utils/process-utils";

const id = "019a0000-0000-7000-8000-000000000001";
const answer = "Synthetic compressed reply.";
const transcript =
  [
    {
      type: "session_meta",
      payload: { id, cwd: "/work/synthetic", cli_version: "0.164.0" },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Synthetic compatibility check." },
        ],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: answer }],
      },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n") + "\n";
let root: string;
let plain: string;
const previousHome = process.env.CODEX_HOME;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "codex compression's-"));
  process.env.CODEX_HOME = root;
  const day = join(root, "sessions", "2026", "10", "20");
  await mkdir(day, { recursive: true });
  plain = join(day, `rollout-2026-10-20T10-00-00-${id}.jsonl`);
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

async function compressed() {
  await writeFile(plain + ".zst", Bun.zstdCompressSync(transcript));
}

function handlers(files: AgentSessionFileAccess, title = "") {
  const agent = {
    pane_id: "fixture:p1",
    workspace_id: "fixture",
    tab_id: "fixture:t1",
    agent: "codex",
    agent_status: "done",
    title,
    agent_session: { source: "herdr:codex", kind: "id", value: id },
  };
  return createAgentSessionHandlers({
    files,
    herdrCall: async (method) => {
      if (method === "agent.get") return { agent };
      if (method === "agent.list") return { agents: [agent] };
      throw new Error(`Unexpected ${method}`);
    },
  });
}

async function assertHistoryAndChat(files: AgentSessionFileAccess, title = "") {
  const source = handlers(files, title);
  try {
    const history = await source.readHistory({
      pane_id: "fixture:p1",
      history_version: 2,
    });
    expect(history.status).toBe("ok");
    expect(
      "entries" in history &&
        history.entries?.some((entry) => entry.text === answer),
    ).toBe(true);
    const chat = await source.conversation.read({ pane_id: "fixture:p1" });
    expect(chat.status).toBe("ok");
    expect(
      "messages" in chat &&
        chat.messages.some((message) => message.text === answer),
    ).toBe(true);
  } finally {
    source.conversationWatch.stop();
  }
}

async function shellHost(observeRead?: (bytes: number) => void) {
  const bin = join(root, "bin");
  await mkdir(bin);
  for (const name of ["bash", "find", "stat", "base64", "tr", "cat", "head"])
    await symlink(Bun.which(name)!, join(bin, name));
  return createAgentSessionFileAccess({
    sshHost: "fixture.example",
    shQuote,
    async runBinaryProcessWithTimeout(argv) {
      const command = argv.at(-1)!.replace(/^bash -lc /, "bash -c ");
      const proc = Bun.spawn(["/bin/sh", "-c", command], {
        env: { ...process.env, PATH: bin },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (command.includes("cat ") || command.includes("head -c"))
        observeRead?.(stdout.byteLength);
      return { code, stdout: Buffer.from(stdout), stderr };
    },
  });
}

test("SSH compressed metadata prefixes bound transfer for large cold rollouts", async () => {
  const text =
    transcript +
    JSON.stringify({
      type: "fixture_noise",
      data: randomBytes(3 * 1024 * 1024).toString("base64"),
    }) +
    "\n";
  const bytes = Bun.zstdCompressSync(text);
  expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
  await writeFile(plain + ".zst", bytes);
  let transferred = 0;
  const files = await shellHost((size) => {
    transferred += size;
  });
  expect(
    Buffer.from(await files.readPrefix(plain + ".zst", 37)).toString(),
  ).toBe(transcript.slice(0, 37));
  expect(transferred).toBeLessThanOrEqual(1024 * 1024);
  transferred = 0;
  await expect(
    files.readPrefix(plain + ".zst", 4 * 1024 * 1024),
  ).rejects.toThrow("transfer budget");
  expect(transferred).toBeLessThanOrEqual(1024 * 1024);
});

for (const remote of [false, true]) {
  const label = remote ? "SSH without a remote zstd tool" : "local";
  test(`${label}: compressed rollouts support ID/title discovery, History, Chat and bounded prefixes`, async () => {
    await compressed();
    const files = remote ? await shellHost() : localAgentSessionFiles;
    expect((await files.findCodexSessionById(id))?.path).toBe(plain + ".zst");
    const prefix = await files.findCodexSessionByPrefix(id.slice(0, -4));
    expect(prefix !== "ambiguous" && prefix?.path).toBe(plain + ".zst");
    expect(await files.readText(plain + ".zst")).toBe(transcript);
    expect(
      Buffer.from(await files.readPrefix(plain + ".zst", 37)).toString(),
    ).toBe(transcript.slice(0, 37));
    await assertHistoryAndChat(files);
    await assertHistoryAndChat(files, id);
  });

  test(`${label}: representation changes preserve lookup, plain wins, distinct transcripts remain ambiguous`, async () => {
    const files = remote ? await shellHost() : localAgentSessionFiles;
    await compressed();
    expect((await files.statFile(plain))?.path).toBe(plain + ".zst");
    await writeFile(plain, transcript);
    expect((await files.statFile(plain + ".zst"))?.path).toBe(plain);
    expect((await files.findCodexSessionById(id))?.path).toBe(plain);
    const prefix = await files.findCodexSessionByPrefix(id.slice(0, -4));
    expect(prefix !== "ambiguous" && prefix?.path).toBe(plain);
    await rm(plain);
    await assertHistoryAndChat(files);
    const archived = join(root, "archived_sessions");
    await mkdir(archived);
    await writeFile(
      join(archived, `rollout-other-${id}.jsonl.zst`),
      Bun.zstdCompressSync(transcript),
    );
    await expect(files.findCodexSessionById(id)).rejects.toThrow("Multiple");
    expect(await files.findCodexSessionByPrefix(id.slice(0, -4))).toBe(
      "ambiguous",
    );
    await rm(plain + ".zst");
    expect((await files.findCodexSessionById(id))?.path).toContain(
      "archived_sessions",
    );
  });
}

test("one History/Chat source follows cold compression and plain materialization", async () => {
  await writeFile(plain, transcript);
  const source = handlers(localAgentSessionFiles);
  try {
    for (const state of ["plain", "compressed", "materialized"]) {
      if (state === "compressed") {
        await compressed();
        await rm(plain);
      }
      if (state === "materialized") {
        await writeFile(plain, transcript);
        await rm(plain + ".zst");
      }
      const history = await source.readHistory({
        pane_id: "fixture:p1",
        history_version: 2,
      });
      expect(history.status).toBe("ok");
      expect(
        "entries" in history &&
          history.entries?.some((entry) => entry.text === answer),
      ).toBe(true);
      const chat = await source.conversation.read({ pane_id: "fixture:p1" });
      expect(chat.status).toBe("ok");
      expect(
        "messages" in chat &&
          chat.messages.some((message) => message.text === answer),
      ).toBe(true);
    }
  } finally {
    source.conversationWatch.stop();
  }
});

test("compressed downloads retain original bytes and a matching media type", async () => {
  await compressed();
  const source = handlers(localAgentSessionFiles);
  try {
    const response = await source.downloadFile({ pane_id: "fixture:p1" });
    expect(response.headers.get("content-type")).toBe("application/zstd");
    expect(response.headers.get("content-disposition")).toContain(".jsonl.zst");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      await readFile(plain + ".zst"),
    );
  } finally {
    source.conversationWatch.stop();
  }
});

test("malformed compressed data rejects instead of showing an empty conversation", async () => {
  await writeFile(plain + ".zst", "not zstd");
  await expect(
    localAgentSessionFiles.readText(plain + ".zst"),
  ).rejects.toThrow();
});
