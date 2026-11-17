import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseCgroupResources,
  runResourceRegressions,
  verificationIdentityEnvironment,
} from "./verification-resources";

test("resource evidence requires actual aggregate peak, enforced limit and OOM accounting", () => {
  expect(
    parseCgroupResources(
      "123456\n",
      "low 0\nmax 3\noom 1\noom_kill 1\n",
      "67108864\n",
    ),
  ).toEqual({
    peakBytes: 123456,
    memoryMaxBytes: 67108864,
    oomKills: 1,
  });
  expect(() => parseCgroupResources("0", "oom_kill 0", "67108864")).toThrow(
    "peak",
  );
  expect(() => parseCgroupResources("123", "oom_kill 0", "max")).toThrow(
    "limit",
  );
  expect(() => parseCgroupResources("123", "oom 0", "67108864")).toThrow("OOM");
});

test("constrained workers receive run and attempt identity across a clean process environment", () => {
  const input = {
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_TOKEN: "synthetic-secret",
    PRIVATE_SESSION: "synthetic-session",
  };
  const args = verificationIdentityEnvironment(input);
  expect(args).toEqual([
    "--setenv=GITHUB_RUN_ID=12345",
    "--setenv=GITHUB_RUN_ATTEMPT=2",
  ]);
  const env = Object.fromEntries(
    args.map((arg) => {
      const value = arg.slice("--setenv=".length);
      const separator = value.indexOf("=");
      return [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
  const readIdentity =
    'console.log(JSON.stringify({run:process.env.GITHUB_RUN_ID||"local",attempt:Number(process.env.GITHUB_RUN_ATTEMPT||1),token:process.env.GITHUB_TOKEN,session:process.env.PRIVATE_SESSION}))';
  // Reproduce systemd's separate environment rather than inheriting the test process.
  const before = spawnSync(process.execPath, ["-e", readIdentity], {
    env: {},
    encoding: "utf8",
  });
  expect(before.status).toBe(0);
  expect(JSON.parse(before.stdout)).toEqual({ run: "local", attempt: 1 });
  const worker = spawnSync(process.execPath, ["-e", readIdentity], {
    env,
    encoding: "utf8",
  });
  expect(worker.status).toBe(0);
  expect(JSON.parse(worker.stdout)).toEqual({ run: "12345", attempt: 2 });
});

test("identity forwarding leaves local runs unchanged and rejects malformed metadata", () => {
  expect(verificationIdentityEnvironment({})).toEqual([]);
  for (const value of ["", "local", "0", "1\nGITHUB_TOKEN=synthetic", "1/2"]) {
    expect(() =>
      verificationIdentityEnvironment({ GITHUB_RUN_ID: value }),
    ).toThrow("Invalid GITHUB_RUN_ID");
    expect(() =>
      verificationIdentityEnvironment({ GITHUB_RUN_ATTEMPT: value }),
    ).toThrow("Invalid GITHUB_RUN_ATTEMPT");
  }
});

// A synthetic live file exercises the gate's actual subprocess route without
// contacting systemd or consuming the real-cgroup regression's resource budget.
test.each([false, true])(
  "resource controls use isolated live startup (system=%s)",
  async (system) => {
    const root = await mkdtemp(join(tmpdir(), "resource-runner-"));
    try {
      await mkdir(join(root, "scripts"));
      await writeFile(
        join(root, "scripts/verification-resources.live.test.ts"),
        `
import {expect, test} from "bun:test";
import {homedir} from "node:os";
test("selected resource manager reaches a fresh live fixture", () => {
  expect(process.env.HERDR_WORLD_TEST_LIVE).toBe("1");
  expect(process.env.HERDR_RESOURCE_MANAGER).toBe(${JSON.stringify(system ? "system" : "user")});
  expect(homedir()).toBe(process.env.HOME);
  expect(process.env.HOME).not.toBe(${JSON.stringify(process.env.HOME)});
});
`,
      );
      const result = runResourceRegressions(root, system);
      if (process.platform === "win32") {
        await expect(result).rejects.toThrow("requires a POSIX runner");
        return;
      }
      const completed = await result;
      expect(completed.stderr).toContain("1 pass");
      expect(completed.stderr).not.toContain("skip");
      expect(completed.code).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
