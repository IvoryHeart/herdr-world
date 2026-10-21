import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localAgentSessionFiles } from "./session-file-access";
import {
  codexThreadFromTitle,
  createAgentSessionResolverContext,
  resolveAgentSession,
} from "./session-resolver";

const tempDirectories: string[] = [];
const originalPiDirectory = process.env.PI_CODING_AGENT_DIR;

afterEach(async () => {
  if (originalPiDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiDirectory;
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("agent session resolver context", () => {
  test("keeps session path caches isolated per connection context", async () => {
    const root = await mkdtemp(join(tmpdir(), "herdr-gui-session-cache-"));
    tempDirectories.push(root);
    process.env.PI_CODING_AGENT_DIR = root;
    const sessionId = `session-${crypto.randomUUID()}`;
    const sessionDirectory = join(root, "sessions", "project");
    const sessionPath = join(sessionDirectory, `${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{}\n");
    const herdrCall = async () => ({
      agent: {
        agent: "pi",
        workspace_id: "w1",
        tab_id: "t1",
        cwd: "/repo",
        agent_session: {
          source: "herdr:pi",
          agent: "pi",
          kind: "id",
          value: sessionId,
        },
      },
    });
    const first = createAgentSessionResolverContext();
    const second = createAgentSessionResolverContext();

    const firstResult = await resolveAgentSession(
      { pane_id: "p1" },
      herdrCall,
      localAgentSessionFiles,
      first,
    );
    expect(firstResult.path).toBe(sessionPath);
    expect(first.pathCache.get(`pi:${sessionId}`)).toBe(sessionPath);
    expect(second.pathCache.size).toBe(0);

    const secondResult = await resolveAgentSession(
      { pane_id: "p1" },
      herdrCall,
      localAgentSessionFiles,
      second,
    );
    expect(secondResult.path).toBe(sessionPath);
    expect(second.pathCache.get(`pi:${sessionId}`)).toBe(sessionPath);
    expect(first.pathCache).not.toBe(second.pathCache);
  });
});

describe("Codex thread from the pane title", () => {
  const originalCodexHome = process.env.CODEX_HOME;
  const threadA = "019f0000-1111-7222-8333-444455556666";
  const threadB = "019f0000-1111-7222-8333-444455559999";
  const truncated = (id: string) => `${id.slice(0, 29)}...`;

  afterEach(() => {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  async function codexHome(ids: string[]) {
    const root = await mkdtemp(join(tmpdir(), "herdr-gui-codex-title-"));
    tempDirectories.push(root);
    process.env.CODEX_HOME = root;
    const day = join(root, "sessions", "2026", "10", "21");
    await mkdir(day, { recursive: true });
    for (const id of ids) {
      await writeFile(
        join(day, `rollout-2026-10-21T10-00-00-${id}.jsonl`),
        "{}\n",
      );
    }
  }

  function resolveTitle(title: string, session?: Record<string, unknown>) {
    return resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
        agent: {
          agent: "codex",
          cwd: "/repo",
          terminal_title: title,
          ...(session ? { agent_session: session } : {}),
        },
      }),
      localAgentSessionFiles,
      createAgentSessionResolverContext(),
    );
  }

  test("reads full and truncated thread IDs, and nothing else", () => {
    expect(codexThreadFromTitle(`${threadA} | project`)).toBe(threadA);
    expect(codexThreadFromTitle(`⠋ ${truncated(threadA)} | project`)).toBe(
      threadA.slice(0, 29),
    );
    expect(codexThreadFromTitle(`${threadA.slice(0, 29)}… | project`)).toBe(
      threadA.slice(0, 29),
    );
    expect(codexThreadFromTitle(threadA.toUpperCase())).toBe(threadA);
    // A partial ID without Codex's ellipsis is not a thread reference.
    expect(codexThreadFromTitle(threadA.slice(0, 29))).toBe("");
    expect(codexThreadFromTitle("Fix the login bug | project")).toBe("");
  });

  test("resolves a truncated title to its one transcript", async () => {
    await codexHome([threadA, "019f9999-0000-7000-8000-000000000000"]);
    const resolved = await resolveTitle(`${truncated(threadA)} | project`);
    expect(resolved.status).toBe("ok");
    expect(resolved.session).toMatchObject({
      source: "codex-title",
      value: threadA,
    });
    expect(resolved.path).toContain(threadA);
  });

  test("shows nothing when the title prefix is ambiguous", async () => {
    await codexHome([threadA, threadB]);
    const resolved = await resolveTitle(truncated(threadA));
    expect(resolved.status).toBe("missing_file");
    expect(resolved.file).toBeNull();
  });

  test("a new thread without a transcript yet has no messages", async () => {
    await codexHome([]);
    const resolved = await resolveTitle(truncated(threadA));
    expect(resolved.status).toBe("missing_file");
    expect(resolved.detail).toBe(
      "This Codex conversation has no saved messages yet.",
    );
  });

  test("the title wins over a stale Herdr session after a switch", async () => {
    await codexHome([threadA, threadB]);
    const resolved = await resolveTitle(threadB, {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: threadA,
    });
    expect(resolved.status).toBe("ok");
    expect(resolved.path).toContain(threadB);
  });

  test("without a title ID, says how to turn it on", async () => {
    await codexHome([threadA]);
    const resolved = await resolveTitle("project");
    expect(resolved.status).toBe("missing_session");
    expect(resolved.detail).toContain("/title");
    expect(resolved.command).toBeUndefined();
  });

  test("searches the remote host, not this machine, over SSH", async () => {
    await codexHome([threadA]);
    const searched: string[] = [];
    const remotePath = `/remote/sessions/rollout-${threadA}.jsonl`;
    const resolved = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
        agent: { agent: "codex", terminal_title: truncated(threadA) },
      }),
      {
        ...localAgentSessionFiles,
        remote: true,
        async findCodexSessions(fragment) {
          searched.push(fragment);
          return [remotePath];
        },
        async statFile(path) {
          return { path, mtimeMs: 1 };
        },
      },
      createAgentSessionResolverContext(),
    );
    expect(searched).toEqual([threadA.slice(0, 29)]);
    expect(resolved.path).toBe(remotePath);
  });
});
