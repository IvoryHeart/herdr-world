import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSessionFileAccess,
  localAgentSessionFiles,
} from "./session-file-access";
import {
  codexIdsFromTitle,
  createAgentSessionResolverContext,
  resolveAgentSession,
} from "./session-resolver";

const tempDirectories: string[] = [];
const originalHome = process.env.HOME;
const originalXdgDataHome = process.env.XDG_DATA_HOME;
const originalPiDirectory = process.env.PI_CODING_AGENT_DIR;
const originalPiConfigDir = process.env.PI_CONFIG_DIR;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdgDataHome;
  if (originalPiDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiDirectory;
  if (originalPiConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
  else process.env.PI_CONFIG_DIR = originalPiConfigDir;
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

function resolveOmpSessionInFreshProcess(sessionId: string) {
  const resolverUrl = new URL("./session-resolver.ts", import.meta.url).href;
  const filesUrl = new URL("./session-file-access.ts", import.meta.url).href;
  const script = `
    import { resolveAgentSession } from ${JSON.stringify(resolverUrl)};
    import { localAgentSessionFiles } from ${JSON.stringify(filesUrl)};
    const result = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({ agent: { agent: "omp", agent_session: { agent: "omp", kind: "id", value: ${JSON.stringify(sessionId)} } } }),
      localAgentSessionFiles,
    );
    console.log(JSON.stringify({ status: result.status, path: result.path }));
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: process.env.HOME,
      PI_CODING_AGENT_DIR: "",
      XDG_DATA_HOME: "",
    },
  });
  if (child.status !== 0)
    throw new Error(child.stderr || "OMP resolver subprocess failed");
  return JSON.parse(child.stdout.trim()) as { status: string; path: string };
}

describe("agent session resolver context", () => {
  test("startup guidance follows reported readiness without a timer", async () => {
    for (const [state, ready] of [
      [{ agent_status: "unknown" }, false],
      [{ agent_status: "blocked" }, false],
      [{ agent_status: "idle" }, false],
      [{ agent_status: "working", launch_pending: true }, false],
      [{ agent_status: "working" }, true],
      [{ agent_status: "idle", interactive_ready: true }, true],
    ] as const) {
      const resolved = await resolveAgentSession(
        { pane_id: "p1" },
        async () => ({ agent: { agent: "claude", ...state } }),
        localAgentSessionFiles,
        createAgentSessionResolverContext(),
      );
      expect(resolved.status).toBe("missing_session");
      expect(resolved.detail.includes("integration")).toBe(ready);
      expect(Boolean(resolved.command)).toBe(ready);
      if (state.agent_status === "blocked")
        expect(resolved.detail).toContain("waiting for you in Terminal");
    }
  });

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
  let home = "";

  afterEach(() => {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  async function addRollout(id: string, directory = "sessions") {
    const day = join(home, directory, "2026", "10", "21");
    await mkdir(day, { recursive: true });
    await writeFile(
      join(day, `rollout-2026-10-21T10-00-00-${id}.jsonl`),
      "{}\n",
    );
  }

  async function codexHome(ids: string[]) {
    home = await mkdtemp(join(tmpdir(), "herdr-gui-codex-title-"));
    tempDirectories.push(home);
    process.env.CODEX_HOME = home;
    for (const id of ids) await addRollout(id);
  }

  function resolveTitle(
    title: string,
    session?: Record<string, unknown>,
    context = createAgentSessionResolverContext(),
  ) {
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
      context,
    );
  }

  const herdrReport = (value: string) => ({
    source: "herdr:codex",
    agent: "codex",
    kind: "id",
    value,
  });

  test("finds full and truncated IDs anywhere in the title", () => {
    expect(codexIdsFromTitle(`⠋ ${truncated(threadA)} | project`)).toEqual([
      { prefix: threadA.slice(0, 29), truncated: true },
    ]);
    expect(codexIdsFromTitle(`${threadA.slice(0, 29)}\u2026`)).toEqual([
      { prefix: threadA.slice(0, 29), truncated: true },
    ]);
    // An ID joined to other text, such as a project name, is not a token.
    expect(
      codexIdsFromTitle(`scratch-${threadB} | ${truncated(threadA)}`),
    ).toEqual([{ prefix: threadA.slice(0, 29), truncated: true }]);
    expect(codexIdsFromTitle(threadA.toUpperCase())).toEqual([
      { prefix: threadA, truncated: false },
    ]);
    // A partial ID without Codex's ellipsis is not a thread reference.
    expect(codexIdsFromTitle(threadA.slice(0, 29))).toEqual([]);
    expect(codexIdsFromTitle("Fix the login bug | project")).toEqual([]);
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

  test("finds archived transcripts too", async () => {
    await codexHome([]);
    await addRollout(threadA, "archived_sessions");
    const resolved = await resolveTitle(truncated(threadA));
    expect(resolved.status).toBe("ok");
    expect(resolved.path).toContain("archived_sessions");
  });

  test("shows nothing when the title prefix is ambiguous", async () => {
    await codexHome([threadA, threadB]);
    const resolved = await resolveTitle(truncated(threadA));
    expect(resolved.status).toBe("missing_file");
    expect(resolved.detail).toContain("More than one");
    expect(resolved.file).toBeNull();
  });

  test("rechecks uniqueness after a cached match", async () => {
    await codexHome([threadA]);
    const context = createAgentSessionResolverContext();
    expect(
      (await resolveTitle(truncated(threadA), undefined, context)).status,
    ).toBe("ok");
    await addRollout(threadB);
    const again = await resolveTitle(truncated(threadA), undefined, context);
    expect(again.status).toBe("missing_file");
    expect(again.file).toBeNull();
  });

  test("an ambiguous title never falls back to a matching Herdr report", async () => {
    await codexHome([threadA, threadB]);
    const resolved = await resolveTitle(
      truncated(threadA),
      herdrReport(threadB),
    );
    expect(resolved.status).toBe("missing_file");
    expect(resolved.file).toBeNull();
  });

  test("a new thread without a transcript does not show the old one", async () => {
    await codexHome(["019f1111-2222-7333-8444-555566667777"]);
    const resolved = await resolveTitle(
      truncated(threadA),
      herdrReport("019f1111-2222-7333-8444-555566667777"),
    );
    expect(resolved.status).toBe("missing_file");
    expect(resolved.detail).toBe(
      "This Codex conversation has no saved messages yet.",
    );
  });

  test("the title wins over a stale Herdr session after a switch", async () => {
    await codexHome(["019f1111-2222-7333-8444-555566667777", threadB]);
    const resolved = await resolveTitle(
      truncated(threadB),
      herdrReport("019f1111-2222-7333-8444-555566667777"),
    );
    expect(resolved.status).toBe("ok");
    expect(resolved.path).toContain(threadB);
  });

  test("a UUID joined to another title item does not hide Herdr's report", async () => {
    await codexHome([threadA]);
    const resolved = await resolveTitle(
      "scratch-1b4e28ba-2fa1-11d2-883f-0016d3cca427 | Working",
      herdrReport(threadA),
    );
    expect(resolved.status).toBe("ok");
    expect(resolved.session?.source).toBe("herdr:codex");
  });

  test("an unmatched full thread ID never falls back to a stale report", async () => {
    const fresh = "019f2222-3333-7444-8555-666677778888";
    await codexHome([threadA]);
    // A bare UUID could also be a project name; failing closed is the safe side.
    for (const title of [`${fresh} | project`, `${fresh}`]) {
      const resolved = await resolveTitle(title, herdrReport(threadA));
      expect(resolved.status).toBe("missing_file");
      expect(resolved.file).toBeNull();
    }
  });

  test("the truncated thread item wins over a full UUID elsewhere", async () => {
    await codexHome([threadA, "019f1111-2222-7333-8444-555566667777"]);
    const resolved = await resolveTitle(
      `019f1111-2222-7333-8444-555566667777 | ${truncated(threadA)}`,
    );
    expect(resolved.status).toBe("ok");
    expect(resolved.path).toContain(threadA);
  });

  test("without a title ID or report, explains startup without premature integration advice", async () => {
    await codexHome([threadA]);
    const resolved = await resolveTitle("project");
    expect(resolved.status).toBe("missing_session");
    expect(resolved.detail).toContain("Terminal");
    expect(resolved.detail).not.toContain("--no-daemon");
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
        async findCodexSessionByPrefix(prefix: string) {
          searched.push(prefix);
          return { path: remotePath, mtimeMs: 1 };
        },
      },
      createAgentSessionResolverContext(),
    );
    expect(searched).toEqual([threadA.slice(0, 29)]);
    expect(resolved.path).toBe(remotePath);
  });
});

describe("OMP session resolution", () => {
  test("finds ids in the default OMP session directory", async () => {
    delete process.env.PI_CONFIG_DIR;
    const root = await mkdtemp(join(tmpdir(), "roamgate-omp-"));
    tempDirectories.push(root);
    process.env.HOME = root;
    delete process.env.PI_CODING_AGENT_DIR;
    const sessionId = `session-${crypto.randomUUID()}`;
    const sessionDirectory = join(root, ".omp", "agent", "sessions");
    const sessionPath = join(sessionDirectory, `${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{}\n");
    const result = resolveOmpSessionInFreshProcess(sessionId);
    expect(result.status).toBe("ok");
    expect(result.path).toBe(sessionPath);
  });

  test("finds ids in a configured session directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-omp-configured-"));
    tempDirectories.push(root);
    process.env.HOME = root;
    const sessionId = `session-${crypto.randomUUID()}`;
    const sessionDirectory = join(root, "custom-agent", "sessions");
    const sessionPath = join(sessionDirectory, `prefix_${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{}\n");
    process.env.PI_CODING_AGENT_DIR = join(root, "custom-agent");
    const result = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
        agent: {
          agent: "omp",
          agent_session: { agent: "omp", kind: "id", value: sessionId },
        },
      }),
      localAgentSessionFiles,
      createAgentSessionResolverContext(),
    );
    expect(result.status).toBe("ok");
    expect(result.path).toBe(sessionPath);
  });

  test.each([".omp-custom", "/absolute-omp-custom"])(
    "finds sessions under PI_CONFIG_DIR=%s relative to home",
    async (configDir) => {
      const root = await mkdtemp(join(tmpdir(), "roamgate-omp-config-root-"));
      tempDirectories.push(root);
      process.env.HOME = root;
      delete process.env.PI_CODING_AGENT_DIR;
      delete process.env.XDG_DATA_HOME;
      process.env.PI_CONFIG_DIR = configDir;
      const sessionId = `session-${crypto.randomUUID()}`;
      const sessionDirectory = join(root, configDir, "agent", "sessions");
      const sessionPath = join(sessionDirectory, `${sessionId}.jsonl`);
      await mkdir(sessionDirectory, { recursive: true });
      await writeFile(sessionPath, "{}\n");
      const result = resolveOmpSessionInFreshProcess(sessionId);
      expect(result.status).toBe("ok");
      expect(result.path).toBe(sessionPath);
    },
  );

  test("finds ids under a profile agent session directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-omp-profile-"));
    tempDirectories.push(root);
    process.env.HOME = root;
    delete process.env.PI_CONFIG_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    const sessionId = `session-${crypto.randomUUID()}`;
    const sessionDirectory = join(
      root,
      ".omp",
      "profiles",
      "test-profile",
      "agent",
      "sessions",
    );
    const sessionPath = join(sessionDirectory, `${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{}\n");
    const result = resolveOmpSessionInFreshProcess(sessionId);
    expect(result.status).toBe("ok");
    expect(result.path).toBe(sessionPath);
  });

  test("finds ids in the default XDG OMP session directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-omp-xdg-"));
    tempDirectories.push(root);
    process.env.HOME = root;
    process.env.XDG_DATA_HOME = join(root, "data");
    delete process.env.PI_CODING_AGENT_DIR;
    const sessionId = `session-${crypto.randomUUID()}`;
    const sessionDirectory = join(root, "data", "omp", "sessions");
    const sessionPath = join(sessionDirectory, `${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{}\n");
    const result = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
        agent: {
          agent: "omp",
          agent_session: { agent: "omp", kind: "id", value: sessionId },
        },
      }),
      localAgentSessionFiles,
      createAgentSessionResolverContext(),
    );
    expect(result.status).toBe("ok");
    expect(result.path).toBe(sessionPath);
  });
  test("uses reported remote transcript paths without local ID discovery", async () => {
    const remotePath =
      "/remote/.omp/profiles/work/agent/sessions/session.jsonl";
    const files = {
      remote: true,
      statFile: async (path: string) => ({
        path,
        mtimeMs: 1,
        size: 1,
        sessionId: null,
      }),
    } as unknown as typeof localAgentSessionFiles;
    const direct = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
        agent: {
          agent: "omp",
          agent_session: { agent: "omp", kind: "path", value: remotePath },
        },
      }),
      files,
      createAgentSessionResolverContext(),
    );
    expect(direct.status).toBe("ok");
    expect(direct.path).toBe(remotePath);

    const remoteId = `remote-${crypto.randomUUID()}`;
    const byId = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
        agent: {
          agent: "omp",
          agent_session: { agent: "omp", kind: "id", value: remoteId },
        },
      }),
      files,
      createAgentSessionResolverContext(),
    );
    expect(byId.status).toBe("missing_file");
    expect(byId.path).toBe("");
  });
});

describe("session search", () => {
  test("follows a session folder that is a link", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-session-link-"));
    tempDirectories.push(root);
    process.env.PI_CODING_AGENT_DIR = root;
    const sessionId = `session-${crypto.randomUUID()}`;
    const kept = join(root, "kept", "project");
    await mkdir(kept, { recursive: true });
    await mkdir(join(root, "sessions"));
    await symlink(kept, join(root, "sessions", "project"));
    // A link to itself: skipped, not followed forever.
    await symlink(
      join(root, "sessions", "loop"),
      join(root, "sessions", "loop"),
    );
    await writeFile(join(kept, `${sessionId}.jsonl`), "{}\n");
    const result = await resolveAgentSession(
      { pane_id: "p1" },
      async () => ({
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
      }),
      localAgentSessionFiles,
      createAgentSessionResolverContext(),
    );
    expect(result.path).toBe(
      join(root, "sessions", "project", `${sessionId}.jsonl`),
    );
  });
});

describe("Pi without Herdr's Pi integration", () => {
  test("a Pi pane with no reported session takes its directory's newest", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-pi-cwd-"));
    tempDirectories.push(root);
    process.env.PI_CODING_AGENT_DIR = root;
    const dir = join(root, "sessions", "--repo-app--");
    await mkdir(dir, { recursive: true });
    const older = join(dir, "2026-10-01T10-00-00-000Z_older-id.jsonl");
    const newer = join(dir, "2026-10-02T10-00-00-000Z_newer-id.jsonl");
    await writeFile(older, "{}\n");
    await writeFile(newer, "{}\n");
    const old = new Date(Date.now() - 60_000);
    await utimes(older, old, old);
    const resolve = (cwd: string) =>
      resolveAgentSession(
        { pane_id: "p1" },
        async () => ({
          agent: { agent: "pi", workspace_id: "w1", tab_id: "t1", cwd },
        }),
        localAgentSessionFiles,
        createAgentSessionResolverContext(),
      );
    const found = await resolve("/repo/app");
    expect(found.path).toBe(newer);
    expect(found.session).toEqual({
      source: "pi-local",
      agent: "pi",
      kind: "id",
      value: "newer-id",
    });
    // Another directory has no session of its own.
    expect((await resolve("/repo/other")).status).toBe("missing_session");
  });
});

describe("Claude transcripts", () => {
  const id = "69775585-98cc-4cb1-9275-4956ebb07add";

  test("a resumed session is followed to the transcript it went on in", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-claude-successor-"));
    tempDirectories.push(root);
    const reported = join(root, `${id}.jsonl`);
    const resumed = join(root, "b6a8466c-831a-4cf8-9659-d65d02fa7db3.jsonl");
    const other = join(root, "0e3b0c44-298f-4c14-9a3b-2c1d9e5f0a11.jsonl");
    await writeFile(reported, `{"sessionId":"${id}"}\n`);
    await writeFile(
      resumed,
      `{"sessionId":"${id}"}\n{"sessionId":"b6a8466c-831a-4cf8-9659-d65d02fa7db3"}\n`,
    );
    await writeFile(other, '{"sessionId":"0e3b"}\n');
    const old = new Date(Date.now() - 60_000);
    await utimes(reported, old, old);

    expect(await localAgentSessionFiles.findClaudeSuccessor(reported, id)).toBe(
      resumed,
    );
    expect(
      await localAgentSessionFiles.findClaudeSuccessor(resumed, id),
    ).toBeNull();
  });

  test("mentioning another session in user text does not make a successor", async () => {
    const root = await mkdtemp(join(tmpdir(), "roamgate-claude-unrelated-"));
    tempDirectories.push(root);
    const reported = join(root, `${id}.jsonl`);
    const other = join(root, "b6a8466c-831a-4cf8-9659-d65d02fa7db3.jsonl");
    await writeFile(reported, JSON.stringify({ sessionId: id }) + "\n");
    await writeFile(
      other,
      JSON.stringify({
        sessionId: "b6a8466c-831a-4cf8-9659-d65d02fa7db3",
        message: {
          role: "user",
          content: `Check ${id} and {"sessionId":"${id}"}`,
        },
      }) + "\n",
    );
    const old = new Date(Date.now() - 60_000);
    await utimes(reported, old, old);
    expect(
      await localAgentSessionFiles.findClaudeSuccessor(reported, id),
    ).toBeNull();
  });

  test("a successor is found in a folder with spaces, and not on Windows", async () => {
    const parent = await mkdtemp(join(tmpdir(), "roamgate-claude-successor-"));
    tempDirectories.push(parent);
    const root = join(parent, "my project");
    await mkdir(root);
    const reported = join(root, `${id}.jsonl`);
    const resumed = join(root, "b6a8466c-831a-4cf8-9659-d65d02fa7db3.jsonl");
    await writeFile(reported, `{"sessionId":"${id}"}\n`);
    await writeFile(resumed, `{"sessionId":"${id}"}\n`);
    const old = new Date(Date.now() - 60_000);
    await utimes(reported, old, old);
    expect(await localAgentSessionFiles.findClaudeSuccessor(reported, id)).toBe(
      resumed,
    );
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(
        await localAgentSessionFiles.findClaudeSuccessor(reported, id),
      ).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  test("remote UUID authority is renewed while unchanged successors retain the 30s cache", async () => {
    const calls = { find: 0, successor: 0 };
    const reported = "/remote/p/old.jsonl";
    const resumed = "/remote/p/new.jsonl";
    let successor: string | null = null;
    const files = {
      remote: true,
      async statFile(path: string) {
        return { path, mtimeMs: 1, size: 1 };
      },
      async findClaudeSessionById() {
        calls.find += 1;
        return { path: reported, mtimeMs: 1, size: 1 };
      },
      async findClaudeSuccessor() {
        calls.successor += 1;
        return successor;
      },
    } as unknown as AgentSessionFileAccess;
    const herdrCall = async () => ({
      agent: {
        agent: "claude",
        workspace_id: "w1",
        tab_id: "t1",
        cwd: "/repo",
        agent_session: { agent: "claude", kind: "id", value: id },
      },
    });
    const context = createAgentSessionResolverContext();
    const read = () =>
      resolveAgentSession({ pane_id: "p1" }, herdrCall, files, context);

    expect((await read()).path).toBe(reported);
    successor = resumed;
    expect((await read()).path).toBe(reported);
    expect(calls).toEqual({ find: 2, successor: 1 });

    context.successorChecked.clear();
    expect((await read()).path).toBe(resumed);
    expect((await read()).path).toBe(resumed);
    expect(calls).toEqual({ find: 4, successor: 2 });
  });
});
