import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRemoteDetection, remoteDetectScript } from "./remote";

/**
 * Detection on an SSH host, run here under the local `sh` with fake IDE
 * programs: what the host does is the same, only the transport (ssh) is
 * left out.
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
