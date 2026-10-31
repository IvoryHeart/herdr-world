import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localAgentSessionFiles } from "./session-file-access";
import {
  codexIdsFromTitle,
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

  test("without a title ID or report, says how to turn it on", async () => {
    await codexHome([threadA]);
    const resolved = await resolveTitle("project");
    expect(resolved.status).toBe("missing_session");
    expect(resolved.detail).toContain("/title");
    expect(resolved.detail).toContain("--no-daemon");
    expect(resolved.command).toBe("herdr integration install codex");
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
