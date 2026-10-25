import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runBinaryProcessWithTimeout } from "../workspace/process";
import { createHerdrConversationSource } from "./herdr-conversation";
import { createAgentSessionFileAccess } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";

const sessionId = "019a0000-1111-7222-8333-444455556666";
const otherId = "019a0000-1111-7222-8333-444455559999";
const roots: string[] = [];
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

function isolatedPayload(shell: string, projects: string) {
  const ordinary =
    shell.startsWith("\nset -eu\npath=") ||
    shell.startsWith("set -eu\ncat ") ||
    shell === "date +%s%N";
  if (ordinary) {
    if (/\$(?:HOME\b|\{HOME\b)/.test(shell))
      throw new Error("Unexpected home access in a fixture file operation.");
    return shell;
  }
  const anchor = 'root="$HOME/.claude/projects"';
  if (shell.split(anchor).length !== 2)
    throw new Error("Expected exactly one fixture home substitution.");
  return shell.replace(anchor, `root=${quote(projects)}`);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function entry(
  type: "user" | "assistant",
  uuid: string,
  parent: string | null,
  text: string,
  time = Date.now(),
) {
  return (
    JSON.stringify({
      type,
      uuid,
      parentUuid: parent,
      sessionId,
      timestamp: new Date(time).toISOString(),
      message: { role: type, content: text },
    }) + "\n"
  );
}

async function fixture(host = "claude-fixture.example") {
  const root = await mkdtemp(join(tmpdir(), "world-claude-ssh-"));
  roots.push(root);
  const projects = join(root, "projects");
  const directory = join(projects, "project's name\nsecond line");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${sessionId}.jsonl`);
  await writeFile(
    path,
    entry("user", "u1", null, "Read the example README.") +
      entry("assistant", "a1", "u1", "It describes a synthetic project."),
  );
  const commands: string[][] = [];
  let discoveredPath: string | null = null;
  const files = createAgentSessionFileAccess({
    sshHost: host,
    shQuote: quote,
    async runBinaryProcessWithTimeout(argv, timeout) {
      commands.push(argv);
      expect(argv[0]).toBe("ssh");
      expect(argv[argv.length - 2]).toBe(host);
      expect(argv).toContain("BatchMode=yes");
      expect(argv).toContain("StrictHostKeyChecking=yes");
      expect(timeout).toBe(15_000);
      // Execute the production POSIX payload locally. Only the remote home
      // boundary is replaced; this is not a native OpenSSH acceptance test.
      const command = argv[argv.length - 1]!;
      expect(command.startsWith("bash -lc '")).toBe(true);
      const shell = command
        .slice("bash -lc '".length, -1)
        .replaceAll("'\\''", "'");
      const result = await runBinaryProcessWithTimeout(
        [
          "bash",
          "--noprofile",
          "--norc",
          "-c",
          isolatedPayload(shell, projects),
        ],
        timeout,
      );
      if (
        discoveredPath !== null &&
        shell.includes("find ") &&
        result.code === 0
      ) {
        const records = result.stdout.toString("utf8").split("\0");
        const last = records.length - 2;
        expect([path, await realpath(path)]).toContain(records[last]!);
        records[last] = discoveredPath;
        result.stdout = Buffer.from(records.join("\0"));
      }
      return result;
    },
  });
  let currentId = sessionId;
  const prompts: Record<string, unknown>[] = [];
  const pane = () => ({
    pane_id: "w7:p2",
    terminal_id: "terminal",
    workspace_id: "w7",
    tab_id: "w7:t1",
    agent: "claude",
    agent_status: "idle",
    cwd: "/project/example",
    revision: 1,
    agent_session: {
      agent: "claude",
      source: "herdr:claude",
      kind: "id",
      value: currentId,
    },
  });
  const chat = createHerdrConversationSource({
    files,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(files),
    async herdrCall(method, params) {
      if (method === "agent.get") return { agent: pane() };
      if (method === "agent.list") return { agents: [pane()] };
      if (method === "agent.prompt") {
        prompts.push(params!);
        // A controlled receipt clearly after the measured clock uncertainty.
        await appendFile(
          path,
          entry("user", "u2", "a1", String(params?.text), Date.now() + 1000),
        );
        return { agent: pane() };
      }
      throw new Error(`Unexpected synthetic Herdr method: ${method}`);
    },
  });
  return {
    root,
    projects,
    directory,
    path,
    files,
    chat,
    commands,
    prompts,
    discoverPath(value: string) {
      discoveredPath = value;
    },
    switchSession() {
      currentId = otherId;
    },
  };
}

describe.skipIf(process.platform === "win32" || !Bun.which("bash"))(
  "Claude SSH session resolution",
  () => {
    test("reads a reported remote UUID, sends to that pane, and observes its transcript receipt", async () => {
      const f = await fixture();
      try {
        const shown = await f.chat.read({ pane_id: "w7:p2" });
        expect(shown.status).toBe("ok");
        expect(shown.messages.map((message) => message.text)).toEqual([
          "Read the example README.",
          "It describes a synthetic project.",
        ]);
        expect(shown.session_binding).toBe("reported");
        expect(shown.session_fingerprint).toBeTruthy();
        const result = await f.chat.send({
          pane_id: "w7:p2",
          text: "Explain the setup.",
          session_fingerprint: shown.session_fingerprint!,
          baseline: [shown.messages[0]!.id],
        });
        expect(result.status).toBe("sent");
        expect(f.prompts).toEqual([
          { target: "w7:p2", text: "Explain the setup." },
        ]);
        const refreshed = await f.chat.read({ pane_id: "w7:p2" });
        expect(refreshed.messages[refreshed.messages.length - 1]?.text).toBe(
          "Explain the setup.",
        );
        expect(refreshed.deliveries[0]?.state).toBe("matched");
        expect(
          f.commands.some((argv) => argv[argv.length - 1]?.includes("find ")),
        ).toBe(true);
        expect(
          f.commands.some((argv) => argv[argv.length - 1]?.includes("cat ")),
        ).toBe(true);
      } finally {
        f.chat.dispose();
      }
    });

    test("rejects sends after the reported remote session changes", async () => {
      const f = await fixture();
      try {
        const shown = await f.chat.read({ pane_id: "w7:p2" });
        expect(shown.status).toBe("ok");
        f.switchSession();
        const result = await f.chat.send({
          pane_id: "w7:p2",
          text: "Do not send this.",
          session_fingerprint: shown.session_fingerprint!,
          baseline: [],
        });
        expect(result).toMatchObject({ status: "refused", reason: "changed" });
        expect(f.prompts).toEqual([]);
      } finally {
        f.chat.dispose();
      }
    });

    test("rejects duplicate UUIDs and ignores nested subagent files", async () => {
      const f = await fixture();
      try {
        const nested = join(f.directory, sessionId, "subagents");
        await mkdir(nested, { recursive: true });
        await writeFile(join(nested, `${sessionId}.jsonl`), "{}\n");
        expect((await f.files.findClaudeSessionById!(sessionId))?.path).toBe(
          await realpath(f.path),
        );
        const second = join(f.projects, "another-project");
        await mkdir(second);
        await writeFile(join(second, `${sessionId}.jsonl`), "{}\n");
        await expect(f.files.findClaudeSessionById!(sessionId)).rejects.toThrow(
          "Multiple",
        );
      } finally {
        f.chat.dispose();
      }
    });

    test("follows a symlinked projects root on the selected host", async () => {
      const f = await fixture();
      try {
        const relocated = join(f.root, "relocated-projects\n");
        await rename(f.projects, relocated);
        await symlink(relocated, f.projects);
        expect((await f.files.findClaudeSessionById!(sessionId))?.path).toBe(
          await realpath(f.path),
        );
        expect((await f.chat.read({ pane_id: "w7:p2" })).status).toBe("ok");
      } finally {
        f.chat.dispose();
      }
    });

    test("adapter and conversation refuse mismatched UUIDs and out-of-scope paths before stat/read", async () => {
      for (const variant of ["other-id", "outside-root", "nested"]) {
        const f = await fixture();
        try {
          const bad =
            variant === "other-id"
              ? join(f.directory, `${otherId}.jsonl`)
              : variant === "outside-root"
                ? join(f.root, "outside", `${sessionId}.jsonl`)
                : join(f.projects, "nested", "extra", `${sessionId}.jsonl`);
          await mkdir(dirname(bad), { recursive: true });
          await writeFile(
            bad,
            entry(
              "user",
              "unrelated",
              null,
              "Another conversation.",
            ).replaceAll(sessionId, otherId),
          );
          f.discoverPath(bad);
          await expect(
            f.files.findClaudeSessionById!(sessionId),
          ).rejects.toThrow("Invalid Claude session lookup path");
          await expect(f.chat.read({ pane_id: "w7:p2" })).rejects.toThrow(
            "Invalid Claude session lookup path",
          );
          expect(
            f.commands.some((argv) =>
              /(?:cat |\npath=)/.test(argv[argv.length - 1]!),
            ),
          ).toBe(false);
          expect(f.prompts).toEqual([]);
        } finally {
          f.chat.dispose();
        }
      }
    });

    test("returns missing for an absent remote UUID or projects directory", async () => {
      const f = await fixture();
      try {
        expect(await f.files.findClaudeSessionById!(otherId)).toBeNull();
        await rm(f.projects, { recursive: true });
        const shown = await f.chat.read({ pane_id: "w7:p2" });
        expect(shown.status).toBe("unavailable");
        if (shown.status === "unavailable")
          expect(shown.unavailable.reason).toBe("file_missing");
        expect(f.prompts).toEqual([]);
      } finally {
        f.chat.dispose();
      }
    });

    test("isolates the same session UUID across two captured SSH connections", async () => {
      const a = await fixture("host-a.example");
      const b = await fixture("host-b.example");
      try {
        await writeFile(b.path, entry("user", "other-u", null, "Host B only."));
        expect((await a.chat.read({ pane_id: "w7:p2" })).latest?.text).toBe(
          "It describes a synthetic project.",
        );
        expect(
          (await b.chat.read({ pane_id: "w7:p2" })).messages.map(
            (message) => message.text,
          ),
        ).toEqual(["Host B only."]);
        expect(
          a.commands.every(
            (argv) => argv[argv.length - 2] === "host-a.example",
          ),
        ).toBe(true);
        expect(
          b.commands.every(
            (argv) => argv[argv.length - 2] === "host-b.example",
          ),
        ).toBe(true);
      } finally {
        a.chat.dispose();
        b.chat.dispose();
      }
    });
  },
);

test("Claude UUID validation rejects shell syntax before starting SSH", async () => {
  let calls = 0;
  const files = createAgentSessionFileAccess({
    sshHost: "host.example",
    shQuote: quote,
    async runBinaryProcessWithTimeout() {
      calls++;
      return { code: 0, stdout: Buffer.alloc(0), stderr: "" };
    },
  });
  for (const invalid of [
    "../session",
    "$(echo injected)",
    "*",
    "session-1",
    "",
  ]) {
    await expect(files.findClaudeSessionById!(invalid)).rejects.toThrow(
      "Claude session ID",
    );
  }
  expect(calls).toBe(0);
});

test("fixture home substitution refuses changed or duplicated anchors before execution", () => {
  for (const shell of [
    'root="${HOME}/.claude/projects"\nfind "$root"',
    'root=~/.claude/projects\nfind "$root"',
    'root="$HOME/.claude/projects"\nroot="$HOME/.claude/projects"',
  ]) {
    expect(() => isolatedPayload(shell, "/fixture/projects")).toThrow(
      "exactly one fixture home substitution",
    );
  }
});

test("SSH lookup failures propagate instead of returning partial matches", async () => {
  const files = createAgentSessionFileAccess({
    sshHost: "host.example",
    shQuote: quote,
    async runBinaryProcessWithTimeout() {
      return {
        code: 1,
        stdout: Buffer.from(`/remote/projects/example/${sessionId}.jsonl\0`),
        stderr: "permission denied",
      };
    },
  });
  await expect(files.findClaudeSessionById!(sessionId)).rejects.toThrow(
    "permission denied",
  );
});

test("remote stat metadata cannot replace the validated session path", async () => {
  let calls = 0;
  const root = "/remote/projects";
  const wanted = `${root}/example/${sessionId}.jsonl`;
  const wrong = `${root}/example/${otherId}.jsonl`;
  const files = createAgentSessionFileAccess({
    sshHost: "host.example",
    shQuote: quote,
    async runBinaryProcessWithTimeout() {
      calls++;
      return {
        code: 0,
        stderr: "",
        stdout: Buffer.from(
          calls === 1
            ? `${root}\0${wanted}\0`
            : `1\t1784872800\t${Buffer.from(wrong).toString("base64")}\t1:2\tchange\n`,
        ),
      };
    },
  });
  await expect(files.findClaudeSessionById!(sessionId)).rejects.toThrow(
    "Invalid Claude session lookup path",
  );
  expect(calls).toBe(2);
});

test("malformed lookup output is refused before reading a transcript", async () => {
  for (const response of ["/remote/no-terminator", "relative/path\0", "\0"]) {
    let calls = 0;
    const files = createAgentSessionFileAccess({
      sshHost: "host.example",
      shQuote: quote,
      async runBinaryProcessWithTimeout() {
        calls++;
        return { code: 0, stdout: Buffer.from(response), stderr: "" };
      },
    });
    await expect(files.findClaudeSessionById!(sessionId)).rejects.toThrow(
      "Invalid Claude session lookup",
    );
    expect(calls).toBe(1);
  }
});
