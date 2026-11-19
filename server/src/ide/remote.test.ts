import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRemoteDetection,
  REMOTE_EXIT,
  remoteDetectScript,
  remoteLaunchScript,
  remoteRuntimeDir,
  sshIdeArgv,
} from "./remote";

/**
 * The scripts an SSH host runs for the Code view, run here under the local
 * `sh` with fake IDE programs: what the host does is the same, only the
 * transport (ssh) is left out.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "hw-ide-remote-"));
  dirs.push(dir);
  return dir;
}

function program(path: string, body: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

async function runSh(script: string, env: Record<string, string>) {
  const child = Bun.spawn(["sh", "-c", script], {
    env: { PATH: "/usr/bin:/bin", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { code, stdout };
}

test("detection finds the standalone code CLI in ~/.local/bin", async () => {
  const home = scratch();
  program(
    join(home, ".local/bin/code"),
    'echo "code 1.147.0 (commit 0123abc)"',
  );
  const result = await runSh(remoteDetectScript("vscode", "/nonexistent"), {
    HOME: home,
  });
  expect(result.code).toBe(0);
  expect(parseRemoteDetection("vscode", "devbox", result)).toEqual({
    provider: "vscode",
    state: "detected",
    path: join(home, ".local/bin/code"),
    version: "1.147.0",
    configured: false,
  });
});

test("detection prefers the desktop app's code-tunnel beside its launcher", async () => {
  const home = scratch();
  const app = join(home, "app/bin");
  program(join(app, "code"), 'echo "1.147.0"; echo "0123abc"');
  program(join(app, "code-tunnel"), 'echo "code 1.147.0 (commit 0123abc)"');
  const result = await runSh(remoteDetectScript("vscode", "/nonexistent"), {
    HOME: home,
    PATH: `${app}:/usr/bin:/bin`,
  });
  expect(result.stdout.split("\n")[0]).toBe(join(app, "code-tunnel"));
});

test("a host without the IDE says so by name", async () => {
  const home = scratch();
  // The desktop launcher alone does not run serve-web.
  program(join(home, ".local/bin/code"), 'echo "1.147.0"');
  const result = await runSh(remoteDetectScript("vscode", "/nonexistent"), {
    HOME: home,
  });
  expect(result.code).toBe(3);
  const detection = parseRemoteDetection("vscode", "devbox", result);
  expect(detection.state).toBe("missing");
  if (detection.state !== "detected")
    expect(detection.reason).toContain("isn't installed on devbox");
  expect(
    parseRemoteDetection("code-server", "devbox", { code: 255, stdout: "" })
      .state,
  ).toBe("missing");
});

test("the launch keeps its token off the command line and stops when World's input ends", async () => {
  const top = scratch();
  const folder = join(top, "project");
  mkdirSync(folder);
  const record = join(top, "record");
  // A fake serve-web: records its arguments, folder and token, then waits.
  const binary = join(top, "bin/code");
  program(
    binary,
    [
      `printf '%s\\n' "$@" > '${record}.args'`,
      `pwd > '${record}.cwd'`,
      'while [ "$1" != "--connection-token-file" ]; do shift; done',
      `cat "$2" > '${record}.token'`,
      `touch '${record}.ready'`,
      "exec sleep 30",
    ].join("\n"),
  );
  const remoteId = `test${crypto.randomUUID().replaceAll("-", "")}`;
  const launch = {
    destination: "dev@devbox.example",
    provider: "vscode" as const,
    binary,
    basePath: "/ide/AAAAAAAAAAAAAAAAAAAAAA",
    folder,
    localSocket: join(top, "ide.sock"),
    remoteId,
    token: "secret-token-value",
  };
  const { argv, stdin } = sshIdeArgv(launch);
  expect(argv.join(" ")).not.toContain("secret-token-value");
  expect(argv).toContain(
    `${launch.localSocket}:${remoteRuntimeDir(remoteId)}/ide.sock`,
  );

  const child = Bun.spawn(["sh", "-c", remoteLaunchScript(launch)], {
    env: { PATH: "/usr/bin:/bin", HOME: top },
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.stdin.write(stdin);
  await child.stdin.flush();
  const dir = remoteRuntimeDir(remoteId);
  for (let i = 0; i < 200 && !existsSync(`${record}.ready`); i++)
    await Bun.sleep(10);
  expect(readFileSync(`${record}.token`, "utf8")).toBe("secret-token-value");
  expect(readFileSync(`${record}.cwd`, "utf8").trim()).toBe(folder);
  expect(readFileSync(`${record}.args`, "utf8").split("\n")).toContain(
    `${dir}/ide.sock`,
  );
  expect(statSync(dir).mode & 0o777).toBe(0o700);

  // World's ssh ends: the host sees end of input and stops the server.
  child.stdin.end();
  const code = await Promise.race([
    child.exited,
    Bun.sleep(5_000).then(() => "hung"),
  ]);
  expect(code).not.toBe("hung");
  expect(existsSync(dir)).toBe(false);
});

test("a missing project folder exits with its own code", async () => {
  const top = scratch();
  const remoteId = `test${crypto.randomUUID().replaceAll("-", "")}`;
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      remoteLaunchScript({
        destination: "devbox",
        provider: "code-server",
        binary: "/bin/true",
        basePath: "/ide/AAAAAAAAAAAAAAAAAAAAAA",
        folder: join(top, "missing"),
        localSocket: join(top, "ide.sock"),
        remoteId,
        token: null,
      }),
    ],
    { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
  );
  expect(await child.exited).toBe(REMOTE_EXIT.folder);
  expect(existsSync(remoteRuntimeDir(remoteId))).toBe(false);
});

test("a folder someone else made first is refused", async () => {
  const remoteId = `test${crypto.randomUUID().replaceAll("-", "")}`;
  const dir = remoteRuntimeDir(remoteId);
  mkdirSync(dir);
  try {
    const child = Bun.spawn(
      [
        "sh",
        "-c",
        remoteLaunchScript({
          destination: "devbox",
          provider: "code-server",
          binary: "/bin/true",
          basePath: "/ide/AAAAAAAAAAAAAAAAAAAAAA",
          folder: "/",
          localSocket: "/nonexistent/ide.sock",
          remoteId,
          token: null,
        }),
      ],
      { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
    );
    expect(await child.exited).toBe(REMOTE_EXIT.dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
