import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../scripts/testing/browser-session";
import {
  captureScene,
  resizeCapture,
} from "../../../web/src/world/testing/captureScene";
import { expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGuiSettings, repoSettingsKey } from "../config/gui-settings";
import { createCoreHostRuntime } from "../herdr-core/host-runtime";
import {
  coreRoomTerminals,
  parseCoreKillConfirmation,
  planCoreKill,
} from "../herdr-core/operations";
import { coreWorld } from "../herdr-core/testing/core-world";
import {
  createCoreWorktree,
  listCoreWorktrees,
  openCoreWorktree,
  removeCoreWorktree,
} from "../herdr-core/worktrees";
import { localAgentSessionFiles } from "../agent/session-file-access";
import { fixtures } from "../agent/testing/conversation-fixtures";
import { callCoreHost } from "../rpc/core-host";
import { handleCoreSharedRpc } from "../rpc/core-shared";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import { worldRuntimeRegistry } from "../world/runtime-registry";
import { WorldSnapshotService } from "../world/snapshot";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../../../web/src/browserChrome";
import { buildWorldBrowserBundle } from "../../../web/src/world/testing/browserBundles";
import { connectCapture } from "../../../web/src/world/testing/connectCapture";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);
const git = Bun.which("git");

/** The repository's standard capture viewports. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1512, height: 982, mobile: false },
  { name: "wide", width: 2560, height: 1440, mobile: false },
  { name: "half", width: 1280, height: 1440, mobile: false },
  { name: "portrait", width: 1440, height: 2560, mobile: false },
] as const;

async function sh(cwd: string, ...argv: string[]) {
  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Example",
      GIT_AUTHOR_EMAIL: "dev@example.com",
      GIT_COMMITTER_NAME: "Example",
      GIT_COMMITTER_EMAIL: "dev@example.com",
    },
  });
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(
      `${argv.join(" ")}: ${await new Response(proc.stderr).text()}`,
    );
}

/**
 * A disposable repository with Paseo hooks that leave marks, a worktree Git
 * already has, and a core agent working in it: World's real core side
 * (in-process core, read model, host consumers, worktree operations).
 */
async function coreSide(root: string) {
  const repo = join(root, "repo");
  const marks = join(root, "marks");
  const home = join(root, "home");
  await mkdir(repo, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(repo, "README.md"), "hello from core\n");
  const mark = (hook: string) =>
    `printf '%s %s\\n' ${hook} "$PASEO_CHECKOUT_PATH" >> ${marks}`;
  await writeFile(
    join(repo, "paseo.json"),
    JSON.stringify({
      worktree: {
        setup: mark("setup"),
        opened: mark("opened"),
        teardown: mark("teardown"),
        removed: mark("removed"),
      },
    }),
  );
  await sh(repo, git!, "init", "-q", "-b", "main");
  await sh(repo, git!, "add", ".");
  await sh(repo, git!, "commit", "-q", "-m", "start");
  const main = realpathSync(repo);
  const worktrees = join(realpathSync(root), "worktrees");
  await sh(
    repo,
    git!,
    "worktree",
    "add",
    "-q",
    "-b",
    "existing-wt",
    join(worktrees, "existing-wt"),
  );
  const world = await coreWorld();
  await world.connect("box");
  const agent = world.fake.create({
    name: "builder",
    argv: ["/usr/bin/claude"],
    cwd: main,
    keep: true,
    foreground: { pid: 1, name: "claude", argv: ["claude"], cwd: main },
  });
  world.fake.report(agent, { state: "working", app: "claude-code" });
  // Its first turn ended while nobody looked (opening its window is a look);
  // it is working on the next.
  world.fake.report(agent, { state: "done", app: "claude-code" });
  world.fake.report(agent, { state: "working", app: "claude-code" });
  // A second Claude whose conversation World can read: opening it follows
  // the Agents-open setting (Chat), as a Herdr agent's does.
  const transcript = await fixtures
    .find((fixture) => fixture.agent === "claude")!
    .write(root);
  const readerArgv = ["/usr/bin/claude", "--resume", transcript];
  world.fake.create({
    name: "reader",
    argv: readerArgv,
    cwd: main,
    keep: true,
    foreground: { pid: 2, name: "claude", argv: readerArgv, cwd: main },
  });
  await world.synchronize();
  const lease = world.lease("box");
  const settings = defaultGuiSettings();
  const key = repoSettingsKey(main, undefined, "box")!;
  settings.repositories[key] = {
    ...settings.repositories[key],
    worktree_directory: worktrees,
  };
  const host = createCoreHostRuntime({
    lease,
    host: null,
    readSettings: async () => settings,
    // Chat never reads the developer's own process records.
    agentSessionFiles: {
      ...localAgentSessionFiles,
      findClaudeSessionForProcess: async () => null,
    },
    // Belt and braces: nothing reaches the real home directory.
    processes: {
      runProcessWithCodeTimeout: (argv, timeoutMs, options = {}) =>
        runProcessWithCodeTimeout(argv, timeoutMs, {
          ...options,
          env: { ...process.env, ...options.env, HOME: home },
        }),
    },
  });
  const deps = { topology: world.topology, host };
  const snapshot = () =>
    new WorldSnapshotService(
      worldRuntimeRegistry(
        {
          list: () => [],
          has: () => false,
          status: () => {
            throw new Error("none");
          },
          readyRuntimeLease: () => null,
        } as never,
        world.core.manager as never,
      ),
    ).snapshot();
  /** One page request, as the service routes it (rpc-dispatch, rpc/core). */
  const answer = async (call: {
    connection_id: string | null;
    connection_generation: number | null;
    method: string;
    params: Record<string, unknown>;
  }) => {
    const p = call.params;
    // The Terminal tab's watch, as World's relay answers it; the page draws
    // its own pushes (CoreTerminalWatch's own test drives the stream).
    if (call.method === "world.core.watch")
      return {
        stream: p.stream,
        grid: { cols: 80, rows: 24 },
        moved_from: null,
      };
    if (call.method === "world.core.hold") return { held: true };
    if (call.method === "world.core.unwatch") return { closed: true };
    // Seen shared with Herdr's apps, as rpc-dispatch routes it.
    if (call.method === "world.core.seen") {
      const out: { result?: unknown; error?: unknown } = {};
      await handleCoreSharedRpc({
        id: "seen",
        method: call.method,
        params: p,
        sendReply: (message: Record<string, unknown>) => {
          out.result = message.result;
          return true;
        },
        sendError: (_context: string, error: unknown) => {
          out.error = error;
        },
        services: { core: { manager: world.core.manager } },
      } as never);
      if (out.error) throw out.error;
      return out.result;
    }
    if (call.connection_id !== null) {
      if (
        call.connection_id !== "box" ||
        call.connection_generation !== lease.generation
      )
        throw new Error("The host's herdr-core reconnected; look again.");
      return callCoreHost(host, call.method, p);
    }
    if (
      p.connection_id !== "box" ||
      p.connection_generation !== lease.generation
    )
      throw new Error("The host's herdr-core reconnected; look again.");
    const workspaceId = String(p.workspace_id ?? "");
    switch (call.method) {
      case "world.core.worktree.list":
        return listCoreWorktrees(lease, deps, workspaceId);
      case "world.core.worktree.create":
        return createCoreWorktree(lease, deps, {
          workspaceId,
          branch: String(p.branch ?? ""),
        });
      case "world.core.worktree.open":
        return openCoreWorktree(lease, deps, {
          workspaceId,
          path: String(p.path ?? ""),
        });
      case "world.core.worktree.remove":
        return removeCoreWorktree(lease, deps, {
          workspaceId,
          force: p.force === true,
          confirmation:
            p.confirmation === undefined
              ? null
              : parseCoreKillConfirmation(p.confirmation),
        });
      case "world.core.kill_plan":
        return planCoreKill(lease, await coreRoomTerminals(lease, workspaceId));
      default:
        throw new Error(`unexpected ${call.method}`);
    }
  };
  return {
    world,
    agent,
    main,
    worktrees,
    readMarks: () =>
      existsSync(marks) ? readFileSync(marks, "utf8").trim().split("\n") : [],
    snapshot,
    answer,
  };
}

test.skipIf(!chrome || !git || process.platform === "win32")(
  "a core agent's Files and its room's worktrees work end to end, under the core generation",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "core-files-"));
    const side = await coreSide(dir);
    const { assets } = await buildWorldBrowserBundle("CoreFiles", dir);
    let result = Promise.withResolvers<{
      failures: string[];
      calls: string[];
    }>();
    let requested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/snapshot") return Response.json(await side.snapshot());
        if (path === "/rpc") {
          try {
            return Response.json({
              result: await side.answer(await request.json()),
            });
          } catch (error) {
            return Response.json({
              error: { message: (error as Error).message },
            });
          }
        }
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "CoreFiles/index.html"))
            : assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let child: TestBrowser | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      const profile = join(dir, "profile"),
        log = join(dir, "chrome.log");
      child = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--disable-gpu",
          "--remote-debugging-port=0",
          "--window-size=1280,900",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      await child.start();
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      const outcome = await waitForBrowserFixture(
        requested.promise,
        result.promise,
        exited,
        "Core files",
        BROWSER_STARTUP_TIMEOUT_MS,
      );
      expect(outcome.failures).toEqual([]);
      // The page read the agent's checkout and drove every worktree step.
      for (const method of [
        "agent_worktree.get",
        "agent_conversation.latest",
        "file.list",
        "file.read",
        "world.core.worktree.create",
        "world.core.worktree.open",
        "world.core.kill_plan",
        "world.core.worktree.remove",
        "world.core.seen",
      ])
        expect(outcome.calls).toContain(method);
      // The open window shared the finished turn with Herdr's apps.
      const record = side.world.fake.terminal(side.agent);
      expect(record?.labels["herdr.seen"]).toBe(String(record?.turn));
      expect(Number(record?.turn)).toBeGreaterThan(0);
      // On disk: the new worktree was made and removed, the opened one
      // stays, and every hook ran where it should.
      const created = join(side.worktrees, "feature-x");
      const existing = join(side.worktrees, "existing-wt");
      expect(existsSync(created)).toBe(false);
      expect(existsSync(existing)).toBe(true);
      expect(side.readMarks()).toEqual([
        `setup ${created}`,
        `opened ${existing}`,
        `teardown ${created}`,
        `removed ${created}`,
      ]);
      // Evidence captures for the PR, only when asked for.
      const captures = Bun.env.HERDR_WORLD_CORE_CAPTURES;
      if (!captures) return;
      await mkdir(captures, { recursive: true });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      let run = 0;
      for (const stage of [
        "files",
        "chat",
        "terminal",
        "dialog",
        "remove",
        "open-chat",
      ] as const)
        for (const theme of ["light", "dark"] as const)
          for (const viewport of VIEWPORTS) {
            // An empty Chat is mostly background on a large screen.
            if (
              (stage === "chat" || stage === "open-chat") &&
              !["phone", "laptop"].includes(viewport.name)
            )
              continue;
            run += 1;
            await resizeCapture(
              connection.command,
              viewport.width,
              viewport.height,
            );
            result = Promise.withResolvers();
            requested = Promise.withResolvers<void>();
            await connection.command("Page.navigate", {
              url: `${server.url.href}?stage=${stage}&branch=capture-${run}`,
            });
            const shot = await waitForBrowserFixture(
              requested.promise,
              result.promise,
              exited,
              "Core files",
              BROWSER_STARTUP_TIMEOUT_MS,
            );
            expect(shot.failures).toEqual([]);
            await connection.command("Runtime.evaluate", {
              expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
              awaitPromise: true,
            });
            const capture = await captureScene(connection.command, {
              view: "desk",
              width: viewport.width,
              height: viewport.height,
              content: {
                scope: "document",
                selector:
                  stage === "files"
                    ? ".workspace-inspector-file-detail"
                    : stage === "chat" || stage === "open-chat"
                      ? ".agent-chat > *"
                      : stage === "terminal"
                        ? ".core-watch"
                        : stage === "dialog"
                          ? ".core-worktrees"
                          : '.modal[aria-label="Remove worktree"]',
              },
            });
            const stem = `${stage}-${viewport.name}-${theme}`;
            await writeFile(join(captures, `${stem}.png`), capture.bytes);
            await writeFile(
              join(captures, `${stem}.json`),
              JSON.stringify({
                receipt: capture.receipt,
                sanity: capture.sanity,
              }),
            );
          }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await side.world.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  },
  180000,
);
