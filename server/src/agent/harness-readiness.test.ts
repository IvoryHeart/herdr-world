import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import {
  harnessReadiness,
  loginCommand,
  readReadiness,
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
    expect(readiness).toMatchObject([
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

  test("a Windows host reports unsupported evidence without probing", async () => {
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
    ).toMatchObject([
      {
        kind: "claude",
        installed: null,
        logged_in: null,
        can_log_in: false,
        probe: {
          source: "world-harness-probe",
          state: "unsupported",
          reason: "windows-unsupported",
        },
      },
    ]);
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

describe("Readiness evidence boundaries", () => {
  const probe = (run: Parameters<typeof harnessReadiness>[0]["run"]) =>
    harnessReadiness({ kinds: ["codex"], windows: false, shQuote, run });

  test("a transport exit never confirms absence or trusts partial success", async () => {
    for (const stdout of [
      "",
      "@@kind codex\n@@found\nLogged in using ChatGPT\n@@exit 0\n@@end\n",
    ]) {
      const [result] = await probe(async () => ({
        code: 255,
        stdout,
        stderr: "private account output",
      }));
      expect(result?.installed).toBeNull();
      expect(result?.logged_in).toBeNull();
      expect(JSON.stringify(result)).not.toContain("private account output");
    }
  });

  test("timeouts and rejected probes remain unknown without forwarding errors", async () => {
    for (const message of [
      "sh timed out after 20000ms",
      "private connection failure",
    ]) {
      const [result] = await probe(async () => {
        throw new Error(message);
      });
      expect(result?.installed).toBeNull();
      expect(result?.logged_in).toBeNull();
      expect(JSON.stringify(result)).not.toContain(message);
    }
  });

  test("missing, duplicate and incomplete sections cannot confirm absence", () => {
    for (const output of [
      "",
      "@@kind other\n@@missing\n@@end\n",
      "@@kind codex\n@@missing\n",
      "@@kind codex\n@@missing\n@@end\n@@kind codex\n@@missing\n@@end\n",
    ]) {
      expect(readReadiness(["codex"], output)[0]?.installed).toBeNull();
    }
    expect(
      readReadiness(["codex"], "@@kind codex\n@@missing\n@@end\n")[0]
        ?.installed,
    ).toBe(false);
  });

  test("arbitrary Codex status errors and mismatched Claude status stay unknown", () => {
    for (const [kind, text, code] of [
      ["codex", "Network unavailable", 1],
      ["codex", "Not logged in", 2],
      ["codex", "unexpected success", 0],
      ["claude", '{"loggedIn":false}', 2],
      ["claude", '{"loggedIn":true}', 1],
      ["claude", '{"loggedIn":"false"}', 0],
    ] as const) {
      const [result] = readReadiness(
        [kind],
        `@@kind ${kind}\n@@found\n${text}\n@@exit ${code}\n@@end\n`,
      );
      expect(result?.installed).toBe(true);
      expect(result?.logged_in).toBeNull();
    }
  });
});

test("complete supported status, malformed JSON and private methods are distinguished", () => {
  const record = (kind: string, text: string, code: number) =>
    `@@kind ${kind}\n@@found\n${text}\n@@exit ${code}\n@@end\n`;
  for (const [kind, text, code, loggedIn] of [
    ["codex", "Not logged in", 1, false],
    ["codex", "Logged in using ChatGPT", 0, true],
    ["codex", "Logged in using API key - synthetic-secret", 0, true],
    ...[
      "access token",
      "personal access token",
      "workload identity",
      "Amazon Bedrock API key",
      "Amazon Bedrock AWS access keys",
    ].map((label) => ["codex", `Logged in using ${label}`, 0, true] as const),
    [
      "codex",
      "API key configured - synthetic-secret\nAuthentication is checked when you send a request.",
      0,
      null,
    ],
    ["claude", '{"loggedIn":false}', 1, false],
    [
      "claude",
      '{"loggedIn":true,"authMethod":"private-account","email":"dev@example.com"}',
      0,
      true,
    ],
    ["claude", '{"loggedIn":', 0, null],
    ["claude", 'unexpected output\n{"loggedIn":false}', 1, null],
    ["codex", "Network unavailable\nNot logged in", 1, null],
  ] as const) {
    const result = readReadiness([kind], record(kind, text, code), 123)[0]!;
    expect(result.installed).toBe(true);
    expect(result.logged_in).toBe(loggedIn);
    expect(result.probe.observed_at).toBe(123);
    expect(result.probe.state).toBe(loggedIn === null ? "unknown" : "ok");
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-secret|private-account|example.com/,
    );
  }
});

test("safe failure provenance and per-kind partial output remain bounded", async () => {
  const result = await harnessReadiness({
    kinds: ["codex"],
    windows: false,
    shQuote,
    run: async () => {
      throw new Error("sh timed out after 20000ms");
    },
  });
  expect(result[0]?.probe).toMatchObject({
    source: "world-harness-probe",
    state: "unknown",
    reason: "timeout",
  });
  expect(Number.isSafeInteger(result[0]?.probe.observed_at)).toBe(true);
  const partial = readReadiness(
    ["codex", "claude"],
    "@@kind codex\n@@missing\n@@end\n@@kind claude\n",
    123,
  );
  expect(partial[0]?.installed).toBe(false);
  expect(partial[1]?.installed).toBeNull();
});

test("oversized, trailing and malformed records cannot report confirmed absence", () => {
  for (const output of [
    "@@kind codex\n@@missing\n@@end\ntrailing",
    "@@kind codex\n@@missing-extra\n@@end\n",
    "x".repeat(200_001),
  ]) {
    expect(readReadiness(["codex"], output, 123)[0]?.installed).toBeNull();
  }
});

test("oversized status cannot hide a trailing error after a recognized prefix", async () => {
  const check = host({
    codex: `printf 'Logged in using ChatGPT'; printf '%5000s' ''; echo 'Unrelated failure'; exit 0`,
  });
  const [result] = await check(["codex"]);
  expect(result?.installed).toBe(true);
  expect(result?.logged_in).toBeNull();
  expect(result?.probe.reason).toBe("unreadable-status");
});
