import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import {
  harnessReadiness,
  loginCommand,
  openHarnessLogin,
} from "./harness-readiness";

/** A host with fake harnesses: some on PATH, one in a default location. */
function host(
  fakes: Record<string, string>,
  inHome: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "world-harness-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const write = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  for (const [name, body] of Object.entries(fakes))
    write(join(bin, name), body);
  for (const [name, body] of Object.entries(inHome))
    write(join(home, ".local", "bin", name), body);
  const env = ["env", "-i", `HOME=${home}`, `PATH=${bin}:/usr/bin:/bin`];
  return Object.assign(
    (kinds: string[]) =>
      harnessReadiness({
        kinds,
        windows: false,
        shQuote,
        run: (argv, timeout) =>
          runProcessWithCodeTimeout([...env, ...argv], timeout),
      }),
    {
      /** Run a line as a login shell on this host would. */
      type: (line: string) =>
        runProcessWithCodeTimeout([...env, "sh", "-c", line], 10_000),
    },
  );
}

describe("Harness readiness", () => {
  test("reads each harness's own status without forwarding its output", async () => {
    const check = host(
      {
        claude: `[ "$1 $2" = "auth status" ] && echo '{"loggedIn": true, "authMethod": "claude.ai", "email": "dev@example.com"}'`,
        codex: `[ "$1 $2" = "login status" ] && { echo "Not logged in"; exit 1; }`,
      },
      { pi: "exit 0" },
    );
    const readiness = await check(["claude", "codex", "pi", "gemini"]);
    expect(readiness).toEqual([
      {
        kind: "claude",
        installed: true,
        logged_in: true,
        method: "claude.ai",
        can_log_in: true,
      },
      { kind: "codex", installed: true, logged_in: false, can_log_in: true },
      { kind: "pi", installed: true, logged_in: null, can_log_in: false },
      { kind: "gemini", installed: false, logged_in: null, can_log_in: false },
    ]);
    expect(JSON.stringify(readiness)).not.toContain("example.com");
  });

  test("a logged-in Codex reports how; a logged-out Claude says so", async () => {
    const check = host({
      claude: `echo '{"loggedIn": false}'; exit 1`,
      codex: `echo "Logged in using ChatGPT"`,
    });
    expect(await check(["claude", "codex"])).toMatchObject([
      { kind: "claude", installed: true, logged_in: false },
      { kind: "codex", logged_in: true, method: "ChatGPT" },
    ]);
  });

  test("a Windows host is not probed and reports nothing", async () => {
    // Nothing known blocks no kind: the launcher keeps every kind Herdr
    // supports there.
    expect(
      await harnessReadiness({
        kinds: ["claude"],
        windows: true,
        shQuote,
        run: () => {
          throw new Error("probed");
        },
      }),
    ).toEqual([]);
  });

  test("login opens a tab and types nothing; the user runs the command", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const call = async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params]);
      return method === "tab.create"
        ? {
            tab: { tab_id: "w1:t3" },
            root_pane: { pane_id: "w1:p3", terminal_id: "term_3" },
          }
        : {};
    };
    const opened = await openHarnessLogin(call, {
      workspace_id: "w1",
      kind: "codex",
      windows: false,
      isCurrent: () => true,
    });
    expect(opened).toEqual({
      tab_id: "w1:t3",
      pane_id: "w1:p3",
      terminal_id: "term_3",
      command: loginCommand("codex")!,
    });
    // A startup script reading one key (`read -n 1`) would take any typed
    // text as its answer, so World never writes to the tab.
    expect(calls.map(([method]) => method)).toEqual(["tab.create"]);

    const refused = (kind: string, windows: boolean, current = true) =>
      openHarnessLogin(call, {
        workspace_id: "w1",
        kind,
        windows,
        isCurrent: () => current,
      });
    await expect(refused("pi", false)).rejects.toThrow(/no login command/);
    await expect(refused("codex", true)).rejects.toThrow(/Windows/);
    await expect(refused("codex", false, false)).rejects.toThrow(/reconnected/);
    await expect(
      openHarnessLogin(async () => ({}), {
        workspace_id: "w1",
        kind: "codex",
        windows: false,
        isCurrent: () => true,
      }),
    ).rejects.toThrow(/did not confirm/);
    expect(calls.map(([method]) => method)).toEqual(["tab.create"]);
  });

  test("login runs an install found only in its default location", async () => {
    // Not on the shell's PATH: only in ~/.local/bin, as readiness finds it.
    const fake = host(
      {},
      {
        claude: `case "$1 $2" in "auth status") echo '{"loggedIn": false}'; exit 1;; "auth login") echo "LOGIN FLOW";; esac`,
      },
    );
    expect(await fake(["claude"])).toMatchObject([
      { kind: "claude", installed: true, logged_in: false, can_log_in: true },
    ]);
    const login = await fake.type(loginCommand("claude")!);
    expect(login.stdout.trim()).toBe("LOGIN FLOW");
    const missing = await host({}).type(loginCommand("codex")!);
    expect(missing.code).toBe(127);
    expect(missing.stdout).toContain("codex is not installed here.");
  });
});
