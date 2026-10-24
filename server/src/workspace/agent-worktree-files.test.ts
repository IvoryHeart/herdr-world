import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileHandlers } from "./files";
import { createAgentWorktree } from "../agent/worktree";
import { createWorktreeGit } from "../agent/worktree-git";
import { agentCheckoutSessionFingerprint } from "../herdr/agent-checkout";
import { workspaceFileParams } from "../http/workspace-file-params";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import type { HerdrClient } from "../bridge/herdr-client";

test("Inspector Files, Changes and HTTP downloads use the agent's linked checkout rather than the launch checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-worktree-fixture-"));
  const main = join(directory, "main checkout");
  const linked = join(directory, "agent checkout");
  const alias = join(directory, "agent alias");
  const session = {
    source: "herdr:codex",
    agent: "codex",
    kind: "id",
    value: "synthetic-session",
  };
  const pane = {
    pane_id: "pane",
    terminal_id: "terminal",
    workspace_id: "workspace",
    agent: "codex",
    agent_session: session,
    cwd: main,
    foreground_cwd: alias,
  };
  const run = async (...argv: string[]) => {
    const result = await runProcessWithCodeTimeout(argv, 8000);
    if (result.code) throw new Error(result.stderr);
    return result.stdout;
  };
  try {
    await mkdir(main);
    await run("git", "-C", main, "init", "-b", "main");
    await writeFile(join(main, "README.md"), "Main checkout\n");
    await run("git", "-C", main, "add", "README.md");
    await run(
      "git",
      "-C",
      main,
      "-c",
      "user.name=Example Agent",
      "-c",
      "user.email=agent@example.test",
      "commit",
      "-m",
      "Example base",
    );
    await run(
      "git",
      "-C",
      main,
      "worktree",
      "add",
      "-b",
      "agent/topic",
      linked,
    );
    await writeFile(join(linked, "README.md"), "Agent checkout change\n");
    await symlink(linked, alias);
    const herdr = {
      async call(method: string) {
        if (method === "pane.get") return { pane };
        if (method === "workspace.get") return { workspace: { cwd: main } };
        if (method === "pane.list") return { panes: [pane] };
        throw new Error(method);
      },
    };
    const git = createWorktreeGit({
      sshHost: () => undefined,
      runProcessWithCodeTimeout,
      shQuote,
    });
    const model = createAgentWorktree({
      connectionId: "alpha",
      generation: 7,
      herdr,
      ...git,
      readSessionMetadata: async () => null,
    });
    const observation = await model.get({
      connectionId: "alpha",
      generation: 7,
      paneId: "pane",
      terminalId: "terminal",
      sessionFingerprint: agentCheckoutSessionFingerprint(session),
    });
    expect(observation.state).toBe("resolved");
    const selected = observation.candidates.find(
      (entry) => entry.candidateId === observation.selectedCandidateId,
    )!;
    expect(selected.canonicalRoot).toBe(linked);
    expect(selected.branch).toBe("agent/topic");
    const target = {
      subject: observation.subject,
      revision: observation.revision,
      candidateId: selected.candidateId,
    };
    const files = createFileHandlers({
      herdr: herdr as HerdrClient,
      sshHost: () => undefined,
      runProcessWithCodeTimeout,
      shQuote,
      resolveAgentWorktreeTarget: model.resolve,
    });
    const params = { workspace_id: "workspace", agent_worktree: target };
    // Reproduces the old workspace-only root alongside the selected agent root.
    expect(
      (await files.listWorkspaceFiles({ workspace_id: "workspace" })).root,
    ).toBe(main);
    expect((await files.listWorkspaceFiles(params)).root).toBe(linked);
    expect(
      (await files.readWorkspaceFile({ ...params, path: "README.md" })).text,
    ).toBe("Agent checkout change\n");
    const changes = await files.readGitDiffSummary(params);
    expect(changes.root).toBe(linked);
    expect(changes.entries.some((entry) => entry.path === "README.md")).toBe(
      true,
    );
    const url = new URL("https://world.example.test/file/download");
    url.searchParams.set("workspace_id", "workspace");
    url.searchParams.set("path", "README.md");
    url.searchParams.set("agent_worktree", JSON.stringify(target));
    const download = await files.downloadWorkspaceFile(
      workspaceFileParams(url),
    );
    expect(await download.text()).toBe("Agent checkout change\n");
    await files.uploadWorkspaceFile(
      { ...params, directory: "", filename: "notes.txt" },
      new Request("https://world.example.test/file/upload", {
        method: "POST",
        body: "Linked notes",
      }),
    );
    expect(await Bun.file(join(linked, "notes.txt")).text()).toBe(
      "Linked notes",
    );
    expect(await Bun.file(join(main, "notes.txt")).exists()).toBe(false);
    await files.deleteWorkspaceFile({ ...params, path: "notes.txt" });
    expect(await Bun.file(join(linked, "notes.txt")).exists()).toBe(false);
    const mainChoice = observation.candidates.find(
      (entry) => entry.canonicalRoot === main,
    )!;
    const manual = {
      ...params,
      agent_worktree: { ...target, candidateId: mainChoice.candidateId },
    };
    expect((await files.listWorkspaceFiles(manual)).root).toBe(main);
    await expect(
      files.listWorkspaceFiles({
        ...params,
        agent_worktree: { ...target, candidateId: "forged-root" },
      }),
    ).rejects.toThrow("expired");
    await rm(alias);
    await symlink(main, alias);
    await expect(files.listWorkspaceFiles(params)).rejects.toThrow(
      "moved or changed",
    );
    pane.agent_session = { ...session, value: "replacement-session" };
    await expect(
      files.readWorkspaceFile({ ...params, path: "README.md" }),
    ).rejects.toThrow("session changed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test("SSH worktree canonicalization executes on the target host", async () => {
  const commands: string[][] = [];
  const git = createWorktreeGit({
    sshHost: () => "example-host",
    shQuote,
    runProcessWithCodeTimeout: async (argv) => {
      commands.push(argv);
      return {
        code: 0,
        stdout: "/remote/canonical\0/remote/repo/.git\0agent/topic\0abc123\0",
        stderr: "",
      };
    },
  });
  expect(await git.inspect("/remote/alias")).toMatchObject({
    canonicalRoot: "/remote/canonical",
    gitCommonDir: "/remote/repo/.git",
  });
  expect(commands[0]?.[0]).toBe("ssh");
  expect(commands[0]?.join(" ")).toContain("example-host");
});
