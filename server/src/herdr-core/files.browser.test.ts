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
import { callCoreHost } from "../rpc/core-host";
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
  await world.settle();
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
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      const profile = join(dir, "profile"),
        log = join(dir, "chrome.log");
      child = Bun.spawn(
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
        "file.list",
        "file.read",
        "world.core.worktree.create",
        "world.core.worktree.open",
        "world.core.kill_plan",
        "world.core.worktree.remove",
      ])
        expect(outcome.calls).toContain(method);
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
      for (const stage of ["files", "dialog", "remove"] as const)
        for (const theme of ["light", "dark"] as const)
          for (const viewport of VIEWPORTS) {
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
